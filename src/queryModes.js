export const EXECUTION_MODES = [
  {
    id: 'silent',
    label: 'Silent Mode',
    description: 'Send queries to the server without any warnings.',
    tone: 'success',
  },
  {
    id: 'alert',
    label: 'Alert Mode',
    description: 'Warn before sending queries to the server.',
    tone: 'warning',
  },
  {
    id: 'safe',
    label: 'Safe Mode',
    description: 'Prompt for the connection password before sending queries to the server.',
    tone: 'danger',
  },
]

export function executionGuard(modeId) {
  if (modeId === 'alert') return { kind: 'confirm' }
  if (modeId === 'safe') return { kind: 'password' }
  return null
}

export function getModeById(id) {
  return EXECUTION_MODES.find((mode) => mode.id === id) ?? EXECUTION_MODES[0]
}
