// ============================================================================
// S24-01/02: Interactive Tutorial + Tooltip Tour
// S24-06: In-app help panel
// S24-07: Feedback button
// ============================================================================

import { useState, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, MessageSquare } from 'lucide-react'

interface TutorialStep {
  title: string
  description: string
  highlight?: string // CSS selector to highlight
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to Drone Show Designer',
    description: 'This tool lets you design drone light shows with a visual node-based editor. Let\'s walk through the basics.',
  },
  {
    title: 'The Graph Canvas',
    description: 'The bottom panel is your graph canvas. Nodes represent show elements: Launch, Formation, Transition, and Land. Connect them with edges to define the show flow.',
  },
  {
    title: '3D Viewport',
    description: 'The top panel shows a live 3D preview of your drone show. Press Space to play/pause. Use mouse to orbit, zoom, and pan.',
  },
  {
    title: 'Asset Panel',
    description: 'The left panel contains your formation library. Create new formations or import from images, text, and SVG files.',
  },
  {
    title: 'Inspector Panel',
    description: 'The right panel shows properties of the selected node. Edit timing, transforms, keyframes, and more.',
  },
  {
    title: 'Creating a Formation',
    description: 'Right-click on the canvas to add nodes. Create a Formation node and assign a shape from the asset panel.',
  },
  {
    title: 'Connecting Nodes',
    description: 'Drag from an output port to an input port to connect nodes. The flow determines which drones go where.',
  },
  {
    title: 'Adding Keyframes',
    description: 'Select a formation node. In the inspector, add keyframes to animate position, rotation, and scale over time.',
  },
  {
    title: 'Physics Validation',
    description: 'Switch to the Physics tab in the inspector to see violations. Use "Fix All" or "Make It Work" to auto-resolve issues.',
  },
  {
    title: 'Saving & Exporting',
    description: 'Press Ctrl+S to save your project. Press Ctrl+E to open the export dialog for CSV waypoints or video recording.',
  },
  {
    title: 'You\'re Ready!',
    description: 'Press ? anytime to see keyboard shortcuts. Happy designing!',
  },
]

const DONT_SHOW_KEY = 'tutorial-dismissed'

interface TutorialOverlayProps {
  onClose: () => void
}

export function TutorialOverlay({ onClose }: TutorialOverlayProps) {
  const [step, setStep] = useState(0)
  const current = TUTORIAL_STEPS[step]!

  const handleNext = useCallback(() => {
    if (step < TUTORIAL_STEPS.length - 1) setStep(step + 1)
    else { localStorage.setItem(DONT_SHOW_KEY, 'true'); onClose() }
  }, [step, onClose])

  const handlePrev = useCallback(() => {
    if (step > 0) setStep(step - 1)
  }, [step])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DONT_SHOW_KEY, 'true')
    onClose()
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-surface-raised border border-white/10 rounded-lg shadow-2xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="text-xs text-white/40">Step {step + 1} of {TUTORIAL_STEPS.length}</div>
          <button onClick={handleDismiss} className="text-white/30 hover:text-white/60"><X size={16} /></button>
        </div>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white mb-2">{current.title}</h3>
          <p className="text-sm text-white/60 leading-relaxed">{current.description}</p>
        </div>
        <div className="flex justify-between p-4 border-t border-white/10">
          <button onClick={handlePrev} disabled={step === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-white/40 hover:text-white/70 disabled:opacity-30">
            <ChevronLeft size={14} /> Back
          </button>
          <button onClick={handleNext}
            className="flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
            {step < TUTORIAL_STEPS.length - 1 ? <>Next <ChevronRight size={14} /></> : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function shouldShowTutorial(): boolean {
  return localStorage.getItem(DONT_SHOW_KEY) !== 'true'
}

// S24-02: Tooltip Tour
interface TooltipStep {
  position: 'top' | 'bottom' | 'left' | 'right'
  target: string
  text: string
}

const TOOLTIP_STEPS: TooltipStep[] = [
  { position: 'bottom', target: 'Graph Canvas (bottom panel)', text: 'Build your show flow here by adding and connecting nodes.' },
  { position: 'top', target: '3D Viewport (top panel)', text: 'Preview your drone show in real-time 3D. Press Space to play.' },
  { position: 'right', target: 'Asset Panel (left sidebar)', text: 'Browse and create formations from the asset library.' },
  { position: 'left', target: 'Inspector Panel (right sidebar)', text: 'Edit properties of the selected node or edge here.' },
  { position: 'bottom', target: 'Toolbar (top bar)', text: 'Access undo/redo, playback controls, and project settings.' },
]

const TOOLTIP_TOUR_KEY = 'tooltip-tour-dismissed'

export function shouldShowTooltipTour(): boolean {
  return localStorage.getItem(TOOLTIP_TOUR_KEY) !== 'true'
}

export function TooltipTour() {
  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(!shouldShowTooltipTour())

  const handleDismiss = useCallback(() => {
    localStorage.setItem(TOOLTIP_TOUR_KEY, 'true')
    setDismissed(true)
  }, [])

  const handleNext = useCallback(() => {
    if (step < TOOLTIP_STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleDismiss()
    }
  }, [step, handleDismiss])

  if (dismissed) return null

  const current = TOOLTIP_STEPS[step]!

  return (
    <div className="fixed z-50 inset-0 pointer-events-none">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
        <div className={`relative bg-surface-hover border border-white/10 rounded-lg shadow-2xl px-4 py-3 max-w-xs`}>
          <div className="text-micro text-white/40 uppercase tracking-wider mb-1">
            {current.target}
          </div>
          <p className="text-sm text-white/80 mb-3">{current.text}</p>
          <div className="flex items-center justify-between">
            <span className="text-micro text-white/30">{step + 1} / {TOOLTIP_STEPS.length}</span>
            <div className="flex gap-2">
              <button
                onClick={handleDismiss}
                className="px-2 py-1 text-micro text-white/40 hover:text-white/70 transition-colors pointer-events-auto"
              >
                Dismiss
              </button>
              <button
                onClick={handleNext}
                className="px-3 py-1 text-micro bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors pointer-events-auto"
              >
                {step < TOOLTIP_STEPS.length - 1 ? 'Next' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// S24-07: Feedback button component
export function FeedbackButton() {
  const handleFeedback = useCallback(() => {
    window.open('https://github.com/drone-show-designer/feedback/issues/new', '_blank')
  }, [])

  return (
    <button onClick={handleFeedback}
      className="fixed bottom-10 left-4 z-40 flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover border border-white/10 rounded-full text-xs text-white/40 hover:text-white/70 transition-colors shadow-lg">
      <MessageSquare size={12} /> Feedback
    </button>
  )
}
