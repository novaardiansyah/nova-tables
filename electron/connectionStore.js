import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const STORE_VERSION = 1
const SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb']

let storeFile = null
let cache = null
const sessionPasswords = new Map()

function getStoreFile() {
  if (!storeFile) storeFile = path.join(app.getPath('userData'), 'connections.json')
  return storeFile
}

function readStore() {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(getStoreFile(), 'utf8')
    const parsed = JSON.parse(raw)
    cache = {
      version: STORE_VERSION,
      connections: Array.isArray(parsed?.connections) ? parsed.connections : [],
    }
  } catch {
    cache = { version: STORE_VERSION, connections: [] }
  }
  return cache
}

function writeStore() {
  const file = getStoreFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function encryptPassword(plain) {
  if (!plain) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.encryptString(plain).toString('base64')
  } catch {
    return null
  }
}

function decryptPassword(cipher) {
  if (!cipher) return null
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

function toPublic(connection) {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    database: connection.database || '',
    encrypt: connection.encrypt !== false,
    trustServerCertificate: connection.trustServerCertificate !== false,
    hasPassword: Boolean(connection.passwordCipher) || sessionPasswords.has(connection.id),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value).trim()
}

export function validateConnectionInput(input = {}) {
  const name = cleanText(input.name)
  const host = cleanText(input.host)
  const username = cleanText(input.username)
  const port = Number.parseInt(input.port, 10)

  const errors = {}
  if (!name) errors.name = 'Name is required'
  if (!host) errors.host = 'Host is required'
  if (!username) errors.username = 'Username is required'
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'Port must be between 1 and 65535'

  const message = Object.values(errors)[0]
  if (message) {
    const error = new Error(message)
    error.code = 'INVALID_CONNECTION'
    error.fields = errors
    throw error
  }

  return {
    name,
    host,
    username,
    port,
    database: cleanText(input.database),
    encrypt: input.encrypt !== false,
    trustServerCertificate: input.trustServerCertificate !== false,
  }
}

export function listConnections() {
  const store = readStore()
  return store.connections
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(toPublic)
}

export function getConnection(id) {
  const store = readStore()
  return store.connections.find((item) => item.id === id) || null
}

export function getPassword(id) {
  if (sessionPasswords.has(id)) return sessionPasswords.get(id)
  const connection = getConnection(id)
  if (!connection) return null
  const decrypted = decryptPassword(connection.passwordCipher)
  if (decrypted !== null) sessionPasswords.set(id, decrypted)
  return decrypted
}

export function setPassword(id, plain) {
  if (plain === undefined || plain === null) return
  sessionPasswords.set(id, plain)
  const connection = getConnection(id)
  if (!connection) return
  connection.passwordCipher = encryptPassword(plain)
  connection.updatedAt = new Date().toISOString()
  writeStore()
}

export function hasStoredPassword(id) {
  const connection = getConnection(id)
  if (!connection) return false
  return Boolean(connection.passwordCipher) || sessionPasswords.has(id)
}

export function saveConnection(input = {}) {
  const fields = validateConnectionInput(input)
  const store = readStore()
  const now = new Date().toISOString()

  const existing = input.id ? store.connections.find((item) => item.id === input.id) : null

  if (existing) {
    Object.assign(existing, fields, { updatedAt: now })
    if (input.password) setPassword(existing.id, input.password)
    writeStore()
    return toPublic(existing)
  }

  const connection = {
    id: crypto.randomUUID(),
    ...fields,
    passwordCipher: null,
    createdAt: now,
    updatedAt: now,
  }
  store.connections.push(connection)
  writeStore()
  if (input.password) setPassword(connection.id, input.password)
  return toPublic(connection)
}

export function deleteConnection(id) {
  const store = readStore()
  const index = store.connections.findIndex((item) => item.id === id)
  if (index === -1) return false
  store.connections.splice(index, 1)
  sessionPasswords.delete(id)
  writeStore()
  return true
}

export function isSystemDatabase(name) {
  return SYSTEM_DATABASES.includes(String(name || '').toLowerCase())
}
