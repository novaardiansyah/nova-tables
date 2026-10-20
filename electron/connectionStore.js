import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sqlite from 'node-sqlite3-wasm'

const SCHEMA_VERSION = 1
const SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb']
const { Database } = sqlite

let dbFile = null
let legacyFile = null
let db = null
const sessionPasswords = new Map()

function getDbFile() {
  if (!dbFile) dbFile = path.join(app.getPath('userData'), 'nova-tables.db')
  return dbFile
}

function getLegacyFile() {
  if (!legacyFile) legacyFile = path.join(app.getPath('userData'), 'connections.json')
  return legacyFile
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
      encrypt INTEGER NOT NULL DEFAULT 1,
      trust_server_certificate INTEGER NOT NULL DEFAULT 1,
      password_cipher TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
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

function migrateLegacyJson(handle) {
  if (readMeta(handle, 'legacy_import') === 'done') return
  try {
    const parsed = JSON.parse(fs.readFileSync(getLegacyFile(), 'utf8'))
    const folders = Array.isArray(parsed?.folders) ? parsed.folders : []
    const connections = Array.isArray(parsed?.connections) ? parsed.connections : []

    if (folders.length > 0 || connections.length > 0) {
      handle.exec('BEGIN')
      try {
        for (const folder of folders) {
          handle.run('INSERT OR IGNORE INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)', [
            folder.id,
            folder.name,
            folder.parentId ?? null,
            folder.createdAt ?? new Date().toISOString(),
          ])
        }
        for (const connection of connections) {
          handle.run(
            `INSERT OR IGNORE INTO connections (
              id, name, host, port, username, database_name, folder_id,
              encrypt, trust_server_certificate, password_cipher, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              connection.id,
              connection.name,
              connection.host,
              connection.port,
              connection.username,
              connection.database ?? '',
              connection.folderId ?? null,
              connection.encrypt === false ? 0 : 1,
              connection.trustServerCertificate === false ? 0 : 1,
              connection.passwordCipher ?? null,
              connection.createdAt ?? new Date().toISOString(),
              connection.updatedAt ?? new Date().toISOString(),
            ],
          )
        }
        handle.exec('COMMIT')
      } catch (error) {
        handle.exec('ROLLBACK')
        throw error
      }
    }

    fs.renameSync(getLegacyFile(), `${getLegacyFile()}.migrated`)
  } catch {}
  writeMeta(handle, 'legacy_import', 'done')
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
  restrictPermissions(file)
  migrateLegacyJson(db)
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
  return getDb()
    .all('SELECT * FROM connections')
    .map((row) => toPublic(toConnection(row)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
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
        name = ?, host = ?, port = ?, username = ?, database_name = ?,
        encrypt = ?, trust_server_certificate = ?, updated_at = ?
      WHERE id = ?`,
      [
        fields.name,
        fields.host,
        fields.port,
        fields.username,
        fields.database,
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
      id, name, host, port, username, database_name, folder_id,
      encrypt, trust_server_certificate, password_cipher, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.name,
      fields.host,
      fields.port,
      fields.username,
      fields.database,
      input.folderId ?? null,
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
  return getDb()
    .all('SELECT * FROM folders')
    .map(toPublicFolder)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
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

  if (parentId && folderDepth(handle, parentId) >= 8) {
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

export function closeStore() {
  if (!db) return
  try {
    db.close()
  } catch {}
  db = null
}

export function isSystemDatabase(name) {
  return SYSTEM_DATABASES.includes(String(name || '').toLowerCase())
}
