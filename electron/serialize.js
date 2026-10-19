// Converts values returned by the SQL Server driver into plain values that can
// safely cross the Electron IPC boundary (structured clone).
export function toPlainValue(value) {
  if (value === null || value === undefined) return null

  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : String(value)
  if (type === 'bigint') return value.toString()

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatDate(value)
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `<binary ${value.length} bytes>`
  }

  if (ArrayBuffer.isView(value)) {
    return `<binary ${value.byteLength} bytes>`
  }

  if (type === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[object]'
    }
  }

  return String(value)
}

export function formatDate(date) {
  const pad = (value, length = 2) => String(value).padStart(length, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${day} ${time}.${pad(date.getMilliseconds(), 3)}`
}

export function toErrorPayload(error) {
  const payload = {
    message: error?.message ? String(error.message) : String(error),
  }
  if (error?.code) payload.code = String(error.code)
  if (typeof error?.number === 'number') payload.number = error.number
  if (typeof error?.lineNumber === 'number') payload.lineNumber = error.lineNumber
  if (typeof error?.state === 'number') payload.state = error.state
  if (typeof error?.severity === 'number') payload.severity = error.severity
  if (error?.fields) payload.fields = error.fields
  return payload
}
