import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sqlite from 'node-sqlite3-wasm'

const SCHEMA_VERSION = 2
const SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb']
const ORDER_META_KEY = 'tree_order'
const MAX_FOLDER_DEPTH = 8
const ENVIRONMENTS = ['local', 'staging', 'production']
const { Database } = sqlite

let dbFile = null
let db = null
const sessionPasswords = new Map()

function getDbFile() {
  if (!dbFile) dbFile = path.join(app.getPath('userData'), 'nova-tables.db')
  return dbFile
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

function createSchema(handle) {
  handle.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES folders(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      database_name TEXT NOT NULL DEFAULT '',
      folder_id TEXT REFERENCES folders(id),
      environment TEXT NOT NULL DEFAULT '',
      encrypt INTEGER NOT NULL DEFAULT 1,
      trust_server_certificate INTEGER NOT NULL DEFAULT 1,
      password_cipher TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      database_name TEXT NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL COLLATE NOCASE,
      sql TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (connection_id, database_name, name)
    );

    CREATE INDEX IF NOT EXISTS saved_queries_scope
      ON saved_queries (connection_id, database_name, updated_at DESC);
  `)
}

function ensureSchema(handle) {
  try {
    handle.get('SELECT environment FROM connections LIMIT 1')
  } catch {
    handle.run("ALTER TABLE connections ADD COLUMN environment TEXT NOT NULL DEFAULT ''")
  }
}

function readMeta(handle, key) {
  const row = handle.get('SELECT value FROM meta WHERE key = ?', key)
  return row ? row.value : null
}

function writeMeta(handle, key, value) {
  handle.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    String(value),
  ])
}

function byName(left, right) {
  return String(left.name).localeCompare(String(right.name))
}

function readOrder(handle) {
  const raw = readMeta(handle, ORDER_META_KEY)
  if (!raw) return { connections: [], folders: [] }
  try {
    const parsed = JSON.parse(raw)
    return {
      connections: Array.isArray(parsed.connections) ? parsed.connections.map(String) : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders.map(String) : [],
    }
  } catch {
    return { connections: [], folders: [] }
  }
}

function orderRank(handle, key) {
  const order = readOrder(handle)[key]
  return new Map(order.map((id, index) => [id, index]))
}

function normalizeOrder(handle, table, ids) {
  const rows = handle.all(`SELECT id, name FROM ${table}`)
  const known = new Set(rows.map((row) => row.id))
  const ordered = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id)
    if (!known.has(key) || ordered.includes(key)) continue
    ordered.push(key)
  }
  const rest = rows
    .filter((row) => !ordered.includes(row.id))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map((row) => row.id)
  return [...ordered, ...rest]
}

function restrictPermissions(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(`${file}${suffix}`, 0o600)
    } catch {}
  }
}

function getDb() {
  if (db) return db
  const file = getDbFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new Database(file)
  createSchema(db)
  ensureSchema(db)
  restrictPermissions(file)
  writeMeta(db, 'schema_version', SCHEMA_VERSION)
  return db
}

function folderExists(handle, id) {
  return Boolean(handle.get('SELECT 1 AS found FROM folders WHERE id = ?', id))
}

function toConnection(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    database: row.database_name || '',
    folderId: row.folder_id ?? null,
    environment: row.environment ?? '',
    encrypt: row.encrypt !== 0,
    trustServerCertificate: row.trust_server_certificate !== 0,
    passwordCipher: row.password_cipher ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    database: row.database || '',
    folderId: row.folderId ?? null,
    environment: row.environment ?? '',
    encrypt: row.encrypt !== false,
    trustServerCertificate: row.trustServerCertificate !== false,
    hasPassword: Boolean(row.passwordCipher) || sessionPasswords.has(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function readConnection(id) {
  const row = getDb().get('SELECT * FROM connections WHERE id = ?', id)
  return row ? toConnection(row) : null
}

function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value).trim()
}

function cleanEnvironment(value) {
  const id = cleanText(value).toLowerCase()
  return ENVIRONMENTS.includes(id) ? id : ''
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
    environment: cleanEnvironment(input.environment),
    encrypt: input.encrypt !== false,
    trustServerCertificate: input.trustServerCertificate !== false,
  }
}

export function listConnections() {
  const handle = getDb()
  const rank = orderRank(handle, 'connections')
  return handle
    .all('SELECT * FROM connections')
    .map((row) => toPublic(toConnection(row)))
    .map((item) => ({ ...item, position: rank.get(item.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.position - right.position || byName(left, right))
}

export function getConnection(id) {
  return readConnection(id)
}

export function getPassword(id) {
  if (sessionPasswords.has(id)) return sessionPasswords.get(id)
  const connection = readConnection(id)
  if (!connection) return null
  const decrypted = decryptPassword(connection.passwordCipher)
  if (decrypted !== null) sessionPasswords.set(id, decrypted)
  return decrypted
}

export function setPassword(id, plain) {
  if (plain === undefined || plain === null) return
  sessionPasswords.set(id, plain)
  if (!readConnection(id)) return
  getDb().run('UPDATE connections SET password_cipher = ?, updated_at = ? WHERE id = ?', [
    encryptPassword(plain),
    new Date().toISOString(),
    id,
  ])
}

export function hasStoredPassword(id) {
  const connection = readConnection(id)
  if (!connection) return false
  return Boolean(connection.passwordCipher) || sessionPasswords.has(id)
}

export function saveConnection(input = {}) {
  const fields = validateConnectionInput(input)
  const handle = getDb()
  const now = new Date().toISOString()
  const existing = input.id ? readConnection(input.id) : null

  if (existing) {
    handle.run(
      `UPDATE connections SET
        name = ?, host = ?, port = ?, username = ?, database_name = ?, environment = ?,
        encrypt = ?, trust_server_certificate = ?, updated_at = ?
      WHERE id = ?`,
      [
        fields.name,
        fields.host,
        fields.port,
        fields.username,
        fields.database,
        fields.environment,
        fields.encrypt ? 1 : 0,
        fields.trustServerCertificate ? 1 : 0,
        now,
        existing.id,
      ],
    )
    if (input.password) setPassword(existing.id, input.password)
    return toPublic(readConnection(existing.id))
  }

  const id = crypto.randomUUID()
  handle.run(
    `INSERT INTO connections (
      id, name, host, port, username, database_name, folder_id, environment,
      encrypt, trust_server_certificate, password_cipher, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.name,
      fields.host,
      fields.port,
      fields.username,
      fields.database,
      input.folderId ?? null,
      fields.environment,
      fields.encrypt ? 1 : 0,
      fields.trustServerCertificate ? 1 : 0,
      null,
      now,
      now,
    ],
  )
  if (input.password) setPassword(id, input.password)
  return toPublic(readConnection(id))
}

export function deleteConnection(id) {
  const handle = getDb()
  if (!readConnection(id)) return false
  handle.run('DELETE FROM connections WHERE id = ?', id)
  sessionPasswords.delete(id)
  return true
}

function folderDepth(handle, id) {
  let depth = 0
  let current = handle.get('SELECT id, parent_id FROM folders WHERE id = ?', id)
  while (current?.parent_id && depth < 64) {
    current = handle.get('SELECT id, parent_id FROM folders WHERE id = ?', current.parent_id)
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

function toPublicFolder(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? null,
    createdAt: row.created_at,
  }
}

export function listFolders() {
  const handle = getDb()
  const rank = orderRank(handle, 'folders')
  return handle
    .all('SELECT * FROM folders')
    .map(toPublicFolder)
    .map((item) => ({ ...item, position: rank.get(item.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.position - right.position || byName(left, right))
}

export function saveFolder(input = {}) {
  const handle = getDb()
  const name = cleanText(input.name)
  if (!name) throw invalidFolderNameError()

  const parentId = input.parentId ? String(input.parentId) : null
  if (parentId && !folderExists(handle, parentId)) throw missingFolderError()

  if (input.id) {
    const existing = handle.get('SELECT * FROM folders WHERE id = ?', input.id)
    if (!existing) throw missingFolderError()
    handle.run('UPDATE folders SET name = ? WHERE id = ?', [name, existing.id])
    return toPublicFolder({ ...existing, name })
  }

  if (parentId && folderDepth(handle, parentId) >= MAX_FOLDER_DEPTH) {
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
  handle.run('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)', [
    folder.id,
    folder.name,
    folder.parentId,
    folder.createdAt,
  ])
  return { id: folder.id, name: folder.name, parentId: folder.parentId }
}

export function deleteFolder(id) {
  const handle = getDb()
  const folder = handle.get('SELECT * FROM folders WHERE id = ?', id)
  if (!folder) return false

  const parentId = folder.parent_id ?? null
  handle.exec('BEGIN')
  try {
    handle.run('UPDATE folders SET parent_id = ? WHERE parent_id = ?', [parentId, id])
    handle.run('UPDATE connections SET folder_id = ? WHERE folder_id = ?', [parentId, id])
    handle.run('DELETE FROM folders WHERE id = ?', id)
    handle.exec('COMMIT')
  } catch (error) {
    handle.exec('ROLLBACK')
    throw error
  }
  return true
}

export function moveConnection(id, folderId) {
  const handle = getDb()
  const connection = readConnection(id)
  if (!connection) return false

  const nextFolderId = folderId ? String(folderId) : null
  if (nextFolderId && !folderExists(handle, nextFolderId)) throw missingFolderError()

  handle.run('UPDATE connections SET folder_id = ?, updated_at = ? WHERE id = ?', [
    nextFolderId,
    new Date().toISOString(),
    id,
  ])
  return true
}

function isDescendant(handle, ancestorId, candidateId) {
  let current = handle.get('SELECT id, parent_id FROM folders WHERE id = ?', candidateId)
  let depth = 0
  while (current?.parent_id && depth < 64) {
    if (current.parent_id === ancestorId) return true
    current = handle.get('SELECT id, parent_id FROM folders WHERE id = ?', current.parent_id)
    depth += 1
  }
  return false
}

function subtreeHeight(handle, id) {
  const children = handle.all('SELECT id FROM folders WHERE parent_id = ?', [id])
  let height = 1
  for (const child of children) {
    height = Math.max(height, 1 + subtreeHeight(handle, child.id))
  }
  return height
}

function invalidFolderMoveError() {
  const error = new Error('Folder cannot be moved into itself')
  error.code = 'INVALID_FOLDER'
  return error
}

export function updateTreeOrder(input = {}) {
  const handle = getDb()
  const connectionOrder = normalizeOrder(handle, 'connections', input.connections)
  const folderOrder = normalizeOrder(handle, 'folders', input.folders)
  const connectionFolders = input.connectionFolders && typeof input.connectionFolders === 'object' ? input.connectionFolders : {}
  const folderParents = input.folderParents && typeof input.folderParents === 'object' ? input.folderParents : {}

  handle.exec('BEGIN')
  try {
    for (const [id, folderId] of Object.entries(connectionFolders)) {
      const connection = readConnection(id)
      if (!connection) continue
      const nextFolderId = folderId ? String(folderId) : null
      if (nextFolderId && !folderExists(handle, nextFolderId)) throw missingFolderError()
      handle.run('UPDATE connections SET folder_id = ?, updated_at = ? WHERE id = ?', [
        nextFolderId,
        new Date().toISOString(),
        id,
      ])
    }

    for (const [id, parentId] of Object.entries(folderParents)) {
      const folder = handle.get('SELECT id, parent_id FROM folders WHERE id = ?', id)
      if (!folder) continue
      const nextParentId = parentId ? String(parentId) : null
      if (nextParentId && !folderExists(handle, nextParentId)) throw missingFolderError()
      if (nextParentId && nextParentId === folder.id) throw invalidFolderMoveError()
      if (nextParentId && isDescendant(handle, folder.id, nextParentId)) throw invalidFolderMoveError()
      if (nextParentId && folderDepth(handle, nextParentId) + subtreeHeight(handle, folder.id) > MAX_FOLDER_DEPTH) {
        throw invalidFolderMoveError()
      }
      handle.run('UPDATE folders SET parent_id = ? WHERE id = ?', [nextParentId, folder.id])
    }

    writeMeta(handle, ORDER_META_KEY, JSON.stringify({ connections: connectionOrder, folders: folderOrder }))
    handle.exec('COMMIT')
  } catch (error) {
    handle.exec('ROLLBACK')
    throw error
  }

  return { connections: listConnections(), folders: listFolders() }
}

export function closeStore() {
  if (!db) return
  try {
    db.close()
  } catch {}
  db = null
}

export function readSettings() {
  const raw = readMeta(getDb(), 'settings')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeSettings(settings) {
  writeMeta(getDb(), 'settings', JSON.stringify(settings ?? {}))
  return readSettings()
}

function invalidSavedQueryError(message, code = 'INVALID_SAVED_QUERY') {
  const error = new Error(message)
  error.code = code
  return error
}

function toSavedQuery(row) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    database: row.database_name,
    name: row.name,
    sql: row.sql,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readSavedQuery(handle, id) {
  const row = handle.get('SELECT * FROM saved_queries WHERE id = ?', [id])
  if (!row) throw invalidSavedQueryError('Saved query not found', 'SAVED_QUERY_MISSING')
  return row
}

function savedQueryScope(handle, connectionId, database, name, excludeId = null) {
  const params = [connectionId, database, name]
  let sql = 'SELECT id FROM saved_queries WHERE connection_id = ? AND database_name = ? AND name = ?'
  if (excludeId) {
    sql += ' AND id <> ?'
    params.push(excludeId)
  }
  return handle.get(sql, params)
}

export function listSavedQueries(connectionId, database) {
  const id = cleanText(connectionId)
  const scope = cleanText(database)
  if (!id || !scope) return []
  return getDb()
    .all(
      'SELECT * FROM saved_queries WHERE connection_id = ? AND database_name = ? ORDER BY updated_at DESC, name ASC',
      [id, scope],
    )
    .map(toSavedQuery)
}

export function saveSavedQuery(input = {}) {
  const connectionId = cleanText(input.connectionId)
  const database = cleanText(input.database)
  const name = cleanText(input.name)
  const sql = String(input.sql ?? '')
  if (!connectionId) throw invalidSavedQueryError('Connection is required')
  if (!database) throw invalidSavedQueryError('Database is required')
  if (!name) throw invalidSavedQueryError('Query name is required')

  const handle = getDb()
  if (!handle.get('SELECT 1 AS found FROM connections WHERE id = ?', [connectionId])) {
    throw invalidSavedQueryError('Connection not found', 'CONNECTION_MISSING')
  }

  const now = new Date().toISOString()

  if (input.id) {
    const existing = readSavedQuery(handle, String(input.id))
    if (existing.connection_id !== connectionId) {
      throw invalidSavedQueryError('Saved query belongs to another connection', 'SAVED_QUERY_MISSING')
    }
    if (savedQueryScope(handle, connectionId, existing.database_name, name, existing.id)) {
      throw invalidSavedQueryError('A saved query with this name already exists', 'QUERY_EXISTS')
    }
    handle.run('UPDATE saved_queries SET name = ?, sql = ?, updated_at = ? WHERE id = ?', [
      name,
      sql,
      now,
      existing.id,
    ])
    return toSavedQuery(readSavedQuery(handle, existing.id))
  }

  const existing = savedQueryScope(handle, connectionId, database, name)
  if (existing) {
    handle.run('UPDATE saved_queries SET sql = ?, updated_at = ? WHERE id = ?', [sql, now, existing.id])
    return toSavedQuery(readSavedQuery(handle, existing.id))
  }

  const id = crypto.randomUUID()
  handle.run(
    'INSERT INTO saved_queries (id, connection_id, database_name, name, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, connectionId, database, name, sql, now, now],
  )
  return toSavedQuery(readSavedQuery(handle, id))
}

export function renameSavedQuery(input = {}) {
  const id = cleanText(input.id)
  const name = cleanText(input.name)
  if (!id) throw invalidSavedQueryError('Saved query is required', 'SAVED_QUERY_MISSING')
  if (!name) throw invalidSavedQueryError('Query name is required')

  const handle = getDb()
  const existing = readSavedQuery(handle, id)
  if (savedQueryScope(handle, existing.connection_id, existing.database_name, name, existing.id)) {
    throw invalidSavedQueryError('A saved query with this name already exists', 'QUERY_EXISTS')
  }
  handle.run('UPDATE saved_queries SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    new Date().toISOString(),
    id,
  ])
  return toSavedQuery(readSavedQuery(handle, id))
}

export function deleteSavedQuery(id) {
  const key = cleanText(id)
  if (!key) return false
  const handle = getDb()
  if (!handle.get('SELECT 1 AS found FROM saved_queries WHERE id = ?', [key])) return false
  handle.run('DELETE FROM saved_queries WHERE id = ?', [key])
  return true
}

export function isSystemDatabase(name) {
  return SYSTEM_DATABASES.includes(String(name || '').toLowerCase())
}
