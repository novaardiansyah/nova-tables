export const EXECUTION_MODES = [
  {
    id: 'silent',
    label: 'Silent Mode',
    description: 'Send queries to the server without any warnings.',
    tone: 'success',
  },
  {
    id: 'alert',
    label: 'Alert Mode 1',
    description: 'Warn before sending queries to the server.',
    tone: 'warning',
  },
  {
    id: 'alert-readonly',
    label: 'Alert Mode 2',
    description: 'Warn before sending queries to the server except SELECT queries.',
    tone: 'warning-outline',
  },
  {
    id: 'safe',
    label: 'Safe Mode 1',
    description: 'Prompt for the connection password before sending queries to the server.',
    tone: 'danger',
  },
  {
    id: 'safe-readonly',
    label: 'Safe Mode 2',
    description: 'Prompt for the connection password before sending queries except SELECT queries.',
    tone: 'danger-outline',
  },
]

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|revoke|backup|restore)\b/i

export function isReadOnlyQuery(sql) {
  const text = String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (!text.trim()) return true
  if (WRITE_KEYWORDS.test(text)) return false
  return /^\s*(select|with)\b/i.test(text)
}

export function executionGuard(modeId, sql) {
  if (modeId === 'silent') return null
  if (modeId === 'alert') return { kind: 'confirm' }
  if (modeId === 'safe') return { kind: 'password' }
  if (modeId === 'alert-readonly' || modeId === 'safe-readonly') {
    if (isReadOnlyQuery(sql)) return null
    return { kind: modeId === 'safe-readonly' ? 'password' : 'confirm' }
  }
  return { kind: 'confirm' }
}

export function getModeById(id) {
  return EXECUTION_MODES.find((mode) => mode.id === id) ?? EXECUTION_MODES[0]
}
