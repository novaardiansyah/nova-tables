import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sqlite from 'node-sqlite3-wasm'
import {
  decryptImportPayload,
  decryptPassword,
  encryptExportPayload,
  encryptPassword,
} from './cryptoStore.js'
import {
  byName,
  folderSubtreeIds,
  normalizeOrder,
  ORDER_META_KEY,
  orderRank,
  readMeta,
  readOrder,
  removeTreeOrderEntries,
  writeMeta,
} from './treeOrder.js'

const SCHEMA_VERSION = 2
const SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb']
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

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      database_name TEXT NOT NULL COLLATE NOCASE,
      sql TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_history_scope
      ON query_history (connection_id, database_name, created_at DESC);
  `)
}

function ensureSchema(handle) {
  try {
    handle.get('SELECT environment FROM connections LIMIT 1')
  } catch {
    handle.run("ALTER TABLE connections ADD COLUMN environment TEXT NOT NULL DEFAULT ''")
  }
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
  return deleteConnections([id]).length > 0
}

export function deleteConnections(ids) {
  const handle = getDb()
  const requested = (Array.isArray(ids) ? ids : [ids]).map(String)
  const removed = []

  handle.exec('BEGIN')
  try {
    for (const id of requested) {
      if (!readConnection(id)) continue
      handle.run('DELETE FROM connections WHERE id = ?', id)
      removed.push(id)
    }
    if (removed.length > 0) removeTreeOrderEntries(handle, removed, [])
    handle.exec('COMMIT')
  } catch (error) {
    handle.exec('ROLLBACK')
    throw error
  }

  for (const id of removed) sessionPasswords.delete(id)
  return removed
}

export function deleteFolders(ids) {
  const handle = getDb()
  const requested = (Array.isArray(ids) ? ids : [ids]).map(String)
  const folderIds = [...folderSubtreeIds(handle, requested)]
  if (folderIds.length === 0) return { folderIds: [], connectionIds: [] }

  const connectionIds = folderIds.flatMap((id) =>
    handle.all('SELECT id FROM connections WHERE folder_id = ?', [id]).map((row) => row.id),
  )

  const folderMarks = folderIds.map(() => '?').join(',')
  handle.exec('BEGIN')
  try {
    if (connectionIds.length > 0) {
      const connectionMarks = connectionIds.map(() => '?').join(',')
      handle.run(`DELETE FROM connections WHERE id IN (${connectionMarks})`, connectionIds)
    }
    handle.run(`DELETE FROM folders WHERE id IN (${folderMarks})`, folderIds)
    removeTreeOrderEntries(handle, connectionIds, folderIds)
    handle.exec('COMMIT')
  } catch (error) {
    handle.exec('ROLLBACK')
    throw error
  }

  for (const id of connectionIds) sessionPasswords.delete(id)
  return { folderIds, connectionIds }
}

function exportFolderChain(folderId, folderById) {
  const chain = []
  let current = folderId ? folderById.get(folderId) : null
  while (current && !chain.includes(current.id)) {
    chain.unshift(current.id)
    current = current.parentId ? folderById.get(current.parentId) : null
  }
  return chain
}

function importFolderKey(parentId, name) {
  return `${parentId ?? ''}::${String(name).toLowerCase()}`
}

function importFolderDepth(folder, folderById) {
  let depth = 0
  let current = folder
  while (current?.parentId && folderById.has(String(current.parentId)) && depth < 64) {
    current = folderById.get(String(current.parentId))
    depth += 1
  }
  return depth
}

export function exportConnections(connectionIds, password) {
  const secret = String(password ?? '')
  if (!secret) {
    const error = new Error('Password is required to encrypt export')
    error.code = 'PASSWORD_REQUIRED'
    throw error
  }

  const allConnections = listConnections()
  const allSelected = !Array.isArray(connectionIds) || connectionIds.length === 0
  const targetIds = new Set(
    allSelected ? allConnections.map((conn) => conn.id) : connectionIds.map(String),
  )

  const allFolders = listFolders()
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]))
  const folderIds = new Set()
  const folderOrder = []

  if (allSelected) {
    for (const folder of allFolders) folderIds.add(folder.id)
  } else {
    for (const connection of allConnections) {
      if (!targetIds.has(connection.id) || !connection.folderId) continue
      for (const id of exportFolderChain(connection.folderId, folderById)) folderIds.add(id)
    }
  }

  for (const folder of allFolders) {
    if (folderIds.has(folder.id)) folderOrder.push(folder.id)
  }

  const list = []
  const connectionOrder = []
  for (const item of allConnections) {
    if (!targetIds.has(item.id)) continue
    const full = readConnection(item.id)
    if (!full) continue
    connectionOrder.push(full.id)
    list.push({
      name: full.name,
      host: full.host,
      port: full.port,
      username: full.username,
      database: full.database,
      environment: full.environment,
      encrypt: full.encrypt,
      trustServerCertificate: full.trustServerCertificate,
      password: getPassword(item.id) || null,
      folderId: full.folderId ?? null,
    })
  }

  if (list.length === 0) {
    const error = new Error('No connections found to export')
    error.code = 'NO_CONNECTIONS'
    throw error
  }

  const folders = folderOrder.map((id) => {
    const folder = folderById.get(id)
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
    }
  })

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    connections: list,
    folders,
    order: {
      connections: connectionOrder,
      folders: folderOrder,
    },
  }

  return {
    content: encryptExportPayload(payload, secret),
    count: list.length,
  }
}

export function importConnections(fileContent, password) {
  const secret = String(password ?? '')
  if (!secret) {
    const error = new Error('Password is required to decrypt connections')
    error.code = 'PASSWORD_REQUIRED'
    throw error
  }

  const payload = decryptImportPayload(fileContent, secret)
  const items = payload.connections
  const sourceFolders = Array.isArray(payload.folders) ? payload.folders : []

  const existingConnections = listConnections()
  const existingNames = new Set(existingConnections.map((conn) => conn.name.toLowerCase()))
  const existingFolders = listFolders()
  const reusableFolders = new Map()
  for (const folder of existingFolders) {
    const key = importFolderKey(folder.parentId ?? null, folder.name)
    if (!reusableFolders.has(key)) reusableFolders.set(key, folder.id)
  }

  const folderIdMap = new Map()
  const importedFolderIds = []

  const sourceFolderById = new Map(
    sourceFolders
      .filter((folder) => folder && folder.id)
      .map((folder) => [String(folder.id), folder]),
  )
  const orderedSourceFolders = [...sourceFolderById.values()].sort(
    (left, right) => importFolderDepth(left, sourceFolderById) - importFolderDepth(right, sourceFolderById),
  )

  for (const folder of orderedSourceFolders) {
    const name = cleanText(folder.name)
    if (!name) continue
    const sourceParentId = folder.parentId ? String(folder.parentId) : null
    const parentId = sourceParentId ? folderIdMap.get(sourceParentId) ?? null : null
    const key = importFolderKey(parentId, name)
    const reusableId = reusableFolders.get(key)
    let targetId = reusableId

    if (reusableId) {
      reusableFolders.delete(key)
    } else {
      targetId = saveFolder({ name, parentId }).id
      importedFolderIds.push(targetId)
    }

    folderIdMap.set(String(folder.id), targetId)
  }

  const nameFolderCache = new Map()
  const resolveLegacyFolder = (folderName) => {
    const name = cleanText(folderName)
    if (!name) return null
    const key = importFolderKey(null, name)
    if (nameFolderCache.has(key)) return nameFolderCache.get(key)
    const fine = reusableFolders.get(key) ?? null
    if (fine) {
      reusableFolders.delete(key)
      nameFolderCache.set(key, fine)
      return fine
    }
    const created = saveFolder({ name }).id
    importedFolderIds.push(created)
    nameFolderCache.set(key, created)
    return created
  }

  const imported = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    let name = cleanText(item.name)
    if (!name) continue

    if (existingNames.has(name.toLowerCase())) {
      name = `(new) ${name}`
      while (existingNames.has(name.toLowerCase())) {
        name = `(new) ${name}`
      }
    }
    existingNames.add(name.toLowerCase())

    let folderId = null
    if (item.folderId && folderIdMap.has(String(item.folderId))) {
      folderId = folderIdMap.get(String(item.folderId))
    } else if (item.folderName) {
      folderId = resolveLegacyFolder(item.folderName)
    }

    const saved = saveConnection({
      name,
      host: item.host,
      port: item.port,
      username: item.username,
      database: item.database || '',
      environment: item.environment || '',
      encrypt: item.encrypt !== false,
      trustServerCertificate: item.trustServerCertificate !== false,
      folderId,
      password: item.password || null,
    })

    imported.push(saved)
  }

  if (imported.length > 0 || importedFolderIds.length > 0) {
    const handle = getDb()
    const currentOrder = readOrder(handle)
    const connectionOrder = imported.map((connection) => connection.id)
    const sourceOrder = Array.isArray(payload.order?.folders) ? payload.order.folders : []
    const orderedFolders = []

    for (const id of sourceOrder) {
      const mapped = folderIdMap.get(String(id))
      if (mapped && importedFolderIds.includes(mapped) && !orderedFolders.includes(mapped)) {
        orderedFolders.push(mapped)
      }
    }
    for (const id of importedFolderIds) {
      if (!orderedFolders.includes(id)) orderedFolders.push(id)
    }

    updateTreeOrder({
      connections: [...currentOrder.connections, ...connectionOrder],
      folders: [...currentOrder.folders, ...orderedFolders],
      connectionFolders: {},
      folderParents: {},
    })
  }

  return {
    importedCount: imported.length,
    importedFolderCount: importedFolderIds.length,
    connections: listConnections(),
    folders: listFolders(),
  }
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
  return deleteFolders([id]).folderIds.length > 0
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

function toQueryHistoryItem(row) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    database: row.database_name,
    sql: row.sql,
    status: row.status,
    durationMs: Number(row.duration_ms || 0),
    rowCount: Number(row.row_count || 0),
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
  }
}

export function addQueryHistory(input = {}) {
  const connectionId = cleanText(input.connectionId)
  const database = cleanText(input.database)
  const sql = String(input.sql ?? '').trim()
  if (!connectionId || !database || !sql) return null

  const handle = getDb()
  const id = crypto.randomUUID()
  const status = input.status === 'error' ? 'error' : 'success'
  const durationMs = Math.max(0, Math.round(Number(input.durationMs) || 0))
  const rowCount = Math.max(0, Math.round(Number(input.rowCount) || 0))
  const errorMessage = input.errorMessage ? String(input.errorMessage) : null
  const now = new Date().toISOString()

  handle.run(
    `INSERT INTO query_history (
      id, connection_id, database_name, sql, status, duration_ms, row_count, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, connectionId, database, sql, status, durationMs, rowCount, errorMessage, now],
  )

  handle.run(
    `DELETE FROM query_history
     WHERE connection_id = ?
       AND id NOT IN (
         SELECT id FROM query_history
         WHERE connection_id = ?
         ORDER BY created_at DESC
         LIMIT 500
       )`,
    [connectionId, connectionId],
  )

  const row = handle.get('SELECT * FROM query_history WHERE id = ?', [id])
  return row ? toQueryHistoryItem(row) : null
}

export function listQueryHistory(connectionId, database = null, limit = 100) {
  const id = cleanText(connectionId)
  if (!id) return []
  const handle = getDb()
  const maxRows = Math.min(500, Math.max(1, Number(limit) || 100))
  const scope = cleanText(database)

  if (scope) {
    return handle
      .all(
        'SELECT * FROM query_history WHERE connection_id = ? AND database_name = ? ORDER BY created_at DESC LIMIT ?',
        [id, scope, maxRows],
      )
      .map(toQueryHistoryItem)
  }

  return handle
    .all(
      'SELECT * FROM query_history WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?',
      [id, maxRows],
    )
    .map(toQueryHistoryItem)
}

export function clearQueryHistory(connectionId, database = null) {
  const id = cleanText(connectionId)
  if (!id) return false
  const handle = getDb()
  const scope = cleanText(database)

  if (scope) {
    handle.run('DELETE FROM query_history WHERE connection_id = ? AND database_name = ?', [id, scope])
  } else {
    handle.run('DELETE FROM query_history WHERE connection_id = ?', [id])
  }
  return true
}

export function deleteQueryHistoryItem(id) {
  const cleanId = cleanText(id)
  if (!cleanId) return false
  getDb().run('DELETE FROM query_history WHERE id = ?', [cleanId])
  return true
}

