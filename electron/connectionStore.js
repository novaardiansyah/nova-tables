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
      folders: Array.isArray(parsed?.folders) ? parsed.folders : [],
    }
  } catch {
    cache = { version: STORE_VERSION, connections: [], folders: [] }
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
    folderId: connection.folderId ?? null,
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
    folderId: input.folderId ?? null,
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

function folderDepth(folders, id) {
  let depth = 0
  let current = folders.find((folder) => folder.id === id)
  while (current?.parentId && depth < folders.length) {
    current = folders.find((folder) => folder.id === current.parentId)
    depth += 1
  }
  return depth
}

function missingFolderError() {
  const error = new Error('Folder not found')
  error.code = 'FOLDER_MISSING'
  return error
}

function invalidFolderNameError() {
  const error = new Error('Folder name is required')
  error.code = 'INVALID_FOLDER'
  error.fields = { name: 'Folder name is required' }
  return error
}

export function listFolders() {
  return readStore()
    .folders.slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      createdAt: folder.createdAt,
    }))
}

export function saveFolder(input = {}) {
  const store = readStore()
  const name = cleanText(input.name)
  if (!name) throw invalidFolderNameError()

  const parentId = input.parentId ? String(input.parentId) : null
  if (parentId && !store.folders.some((folder) => folder.id === parentId)) throw missingFolderError()

  if (input.id) {
    const existing = store.folders.find((folder) => folder.id === input.id)
    if (!existing) throw missingFolderError()
    existing.name = name
    writeStore()
    return { id: existing.id, name: existing.name, parentId: existing.parentId ?? null }
  }

  if (parentId && folderDepth(store.folders, parentId) >= 8) {
    const error = new Error('Folders can be nested up to 9 levels')
    error.code = 'INVALID_FOLDER'
    throw error
  }

  const folder = {
    id: crypto.randomUUID(),
    name,
    parentId,
    createdAt: new Date().toISOString(),
  }
  store.folders.push(folder)
  writeStore()
  return { id: folder.id, name: folder.name, parentId: folder.parentId }
}

export function deleteFolder(id) {
  const store = readStore()
  const folder = store.folders.find((item) => item.id === id)
  if (!folder) return false

  const parentId = folder.parentId ?? null
  for (const child of store.folders) {
    if (child.parentId === folder.id) child.parentId = parentId
  }
  for (const connection of store.connections) {
    if (connection.folderId === folder.id) connection.folderId = parentId
  }

  store.folders = store.folders.filter((item) => item.id !== folder.id)
  writeStore()
  return true
}

export function moveConnection(id, folderId) {
  const store = readStore()
  const connection = store.connections.find((item) => item.id === id)
  if (!connection) return false

  const nextFolderId = folderId ? String(folderId) : null
  if (nextFolderId && !store.folders.some((folder) => folder.id === nextFolderId)) {
    throw missingFolderError()
  }

  connection.folderId = nextFolderId
  connection.updatedAt = new Date().toISOString()
  writeStore()
  return true
}

export function isSystemDatabase(name) {
  return SYSTEM_DATABASES.includes(String(name || '').toLowerCase())
}
