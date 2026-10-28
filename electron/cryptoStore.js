import { safeStorage } from 'electron'
import crypto from 'node:crypto'

const EXPORT_KDF_ITERATIONS = 100000

export function encryptPassword(plain) {
  if (!plain) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.encryptString(plain).toString('base64')
  } catch {
    return null
  }
}

export function decryptPassword(cipher) {
  if (!cipher) return null
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

export function encryptExportPayload(payload, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.pbkdf2Sync(password, salt, EXPORT_KDF_ITERATIONS, 32, 'sha256')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const raw = JSON.stringify(payload)
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return JSON.stringify({
    version: 1,
    app: 'nova-tables',
    kdf: 'pbkdf2',
    algorithm: 'aes-256-gcm',
    iterations: EXPORT_KDF_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  }, null, 2)
}

export function decryptImportPayload(fileContent, password) {
  let container
  try {
    container = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent
  } catch {
    const error = new Error('File is not a valid JSON document')
    error.code = 'INVALID_FORMAT'
    throw error
  }

  if (!container?.salt || !container?.iv || !container?.tag || !container?.data) {
    const error = new Error('Invalid or unrecognized export file format')
    error.code = 'INVALID_FORMAT'
    throw error
  }

  const salt = Buffer.from(container.salt, 'base64')
  const iv = Buffer.from(container.iv, 'base64')
  const tag = Buffer.from(container.tag, 'base64')
  const data = Buffer.from(container.data, 'base64')
  const iterations = Number(container.iterations) || EXPORT_KDF_ITERATIONS

  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  let decrypted
  try {
    decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    const error = new Error('Incorrect password or corrupted file')
    error.code = 'INVALID_PASSWORD'
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(decrypted)
  } catch {
    const error = new Error('Decrypted content is not valid JSON')
    error.code = 'INVALID_FORMAT'
    throw error
  }

  if (!parsed || !Array.isArray(parsed.connections)) {
    const error = new Error('No connections found in export file')
    error.code = 'INVALID_FORMAT'
    throw error
  }

  return parsed
}
