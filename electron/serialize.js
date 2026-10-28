const dtfCache = new Map()

function getFormatter(timeZone) {
  let dtf = dtfCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    })
    dtfCache.set(timeZone, dtf)
  }
  return dtf
}

export function toPlainValue(value, timeZone = 'UTC') {
  if (value === null || value === undefined) return null

  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : String(value)
  if (type === 'bigint') return value.toString()

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatDate(value, timeZone)
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

export function formatDate(date, timeZone = 'UTC') {
  const pad = (value, length = 2) => String(value).padStart(length, '0')
  if (!timeZone || timeZone === 'UTC') {
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    return `${day} ${time}.${pad(date.getUTCMilliseconds(), 3)}`
  }

  try {
    const dtf = getFormatter(timeZone)
    const parts = {}
    for (const part of dtf.formatToParts(date)) {
      parts[part.type] = part.value
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond || '000'}`
  } catch {
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    return `${day} ${time}.${pad(date.getUTCMilliseconds(), 3)}`
  }
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
