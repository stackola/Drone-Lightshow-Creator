import { getState } from '@/state/store'

/** Open the copilot tab and put the cursor in its message box. */
export function openCopilot() {
  getState().set({ rightTab: 'copilot' })
  setTimeout(() => document.querySelector<HTMLTextAreaElement>('.cp-input textarea')?.focus(), 50)
}
