// ============================================================================
// S25-05: Error Boundaries — React error boundaries on all major panels
// S25-06: Crash recovery integration
// L5-error-boundary: rich diagnostic UI + structured logging
// ============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  panelName?: string
}

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string | null
  showDetails: boolean
  copied: boolean
}

// Module-level log of recent panel crashes — surfaced by a dev panel later.
export const panelCrashLog: Array<{
  panelName: string
  message: string
  stack: string | null
  componentStack: string | null
  time: number
}> = []

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null, showDetails: false, copied: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null, showDetails: false, copied: false }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const panelName = this.props.panelName ?? 'Panel'
    console.error(`[ErrorBoundary — ${panelName}]`, error)
    if (errorInfo.componentStack) console.error('Component stack:', errorInfo.componentStack)
    this.setState({ componentStack: errorInfo.componentStack ?? null })
    panelCrashLog.push({
      panelName,
      message: error.message,
      stack: error.stack ?? null,
      componentStack: errorInfo.componentStack ?? null,
      time: Date.now(),
    })
    // Keep last 50 crashes; trim older ones.
    if (panelCrashLog.length > 50) panelCrashLog.splice(0, panelCrashLog.length - 50)
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null, showDetails: false, copied: false })
  }

  private toggleDetails = (): void => {
    this.setState((s) => ({ showDetails: !s.showDetails }))
  }

  private copy = async (): Promise<void> => {
    const { error, componentStack } = this.state
    const panelName = this.props.panelName ?? 'Panel'
    const text =
      `[${panelName}] ${error?.message ?? 'unknown error'}\n\n` +
      `Stack:\n${error?.stack ?? '(none)'}\n\n` +
      `Component stack:${componentStack ?? '\n(none)'}`
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      window.setTimeout(() => this.setState({ copied: false }), 1500)
    } catch {
      // clipboard blocked; nothing to do
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const { error, componentStack, showDetails, copied } = this.state
      return (
        <div className="h-full flex flex-col items-center justify-center p-4 text-center overflow-auto">
          <div className="text-red-400 text-sm font-semibold mb-2">
            {this.props.panelName ?? 'Panel'} Error
          </div>
          <div className="text-xs text-white/50 mb-3 max-w-md break-words">
            {error?.message ?? 'An unexpected error occurred'}
          </div>
          <div className="flex gap-2 mb-2">
            <button
              onClick={this.reset}
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white/70 rounded transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={this.toggleDetails}
              className="px-3 py-1 text-xs bg-white/5 hover:bg-white/15 text-white/50 rounded transition-colors"
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            <button
              onClick={this.copy}
              className="px-3 py-1 text-xs bg-white/5 hover:bg-white/15 text-white/50 rounded transition-colors"
            >
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>
          {showDetails && (
            <pre className="text-left text-micro leading-tight text-white/40 max-w-xl max-h-64 overflow-auto bg-black/30 rounded p-2 whitespace-pre-wrap">
              {error?.stack ?? '(no stack)'}
              {componentStack ? `\n\n— component stack —${componentStack}` : ''}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
