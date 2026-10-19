import sql from 'mssql'
import {
  getConnection,
  getPassword,
  setPassword,
  isSystemDatabase,
} from './connectionStore.js'
import { toPlainValue } from './serialize.js'

const MAX_ROWS = 20000

const runtimeConnections = new Map()
const databasePools = new Map()
const pendingPools = new Map()

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function buildConfig(connection, password, database) {
  return {
    server: connection.host,
    port: Number(connection.port) || 1433,
    user: connection.username,
    password,
    database: database || connection.database || 'master',
    connectionTimeout: 10000,
    requestTimeout: 0,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: connection.encrypt !== false,
      trustServerCertificate: connection.trustServerCertificate !== false,
      enableArithAbort: true,
      appName: 'Nova Tables',
    },
  }
}

function resolvePassword({ id, password }) {
  if (password !== undefined && password !== null) return password
  if (id) {
    const stored = getPassword(id)
    if (stored !== null) return stored
    throw codedError(
      'PASSWORD_MISSING',
      'No saved password for this connection. Edit it and enter the password to continue.',
    )
  }
  return ''
}

async function createPool(connection, password, database) {
  const pool = new sql.ConnectionPool(buildConfig(connection, password, database))
  pool.on('error', () => {})
  await pool.connect()
  return pool
}

async function closePool(pool) {
  try {
    await pool.close()
  } catch {}
}

async function getRuntime(connectionId) {
  const runtime = runtimeConnections.get(connectionId)
  if (!runtime) {
    throw codedError('NOT_CONNECTED', 'This connection is not open. Connect to it first.')
  }
  return runtime
}

async function getDatabasePool(connectionId, database) {
  const runtime = await getRuntime(connectionId)
  const baseName = String(runtime.connection.database || 'master')
  const name = database || baseName

  if (String(name).toLowerCase() === baseName.toLowerCase()) return runtime.pool

  const key = `${connectionId}::${String(name).toLowerCase()}`

  const cached = databasePools.get(key)
  if (cached) return cached

  const pending = pendingPools.get(key)
  if (pending) return pending

  const promise = createPool(runtime.connection, runtime.password, name)
    .then((pool) => {
      if (!runtimeConnections.has(connectionId)) {
        closePool(pool)
        throw codedError('NOT_CONNECTED', 'This connection is not open. Connect to it first.')
      }
      databasePools.set(key, pool)
      return pool
    })
    .finally(() => pendingPools.delete(key))

  pendingPools.set(key, promise)
  return promise
}

async function dropDatabasePool(connectionId, database) {
  const name = database || 'master'
  const key = `${connectionId}::${String(name).toLowerCase()}`
  const pool = databasePools.get(key)
  if (!pool) return
  databasePools.delete(key)
  await closePool(pool)
}

async function readServerInfo(pool) {
  const result = await pool
    .request()
    .query(
      `SELECT @@SERVERNAME AS serverName,
              CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
              CAST(SERVERPROPERTY('Edition') AS nvarchar(256)) AS edition`,
    )
  const row = (result.recordset && result.recordset[0]) || {}
  const serverName = toPlainValue(row.serverName)
  const productVersion = toPlainValue(row.productVersion)
  const edition = toPlainValue(row.edition)
  return {
    serverName: serverName || 'Microsoft SQL Server',
    productVersion: productVersion || '',
    edition: edition || '',
  }
}

async function readDatabases(pool) {
  const result = await pool
    .request()
    .query('SELECT name, state_desc AS state FROM sys.databases ORDER BY name')
  return (result.recordset || []).map((row) => ({
    name: String(row.name),
    isSystem: isSystemDatabase(row.name),
    isOnline: String(row.state).toUpperCase() === 'ONLINE',
  }))
}

export async function testConnection(input = {}) {
  const { id } = input
  const saved = id ? getConnection(id) : null

  const connection = {
    host: String(input.host ?? saved?.host ?? '').trim(),
    port: Number.parseInt(input.port, 10) || saved?.port || 1433,
    username: String(input.username ?? saved?.username ?? '').trim(),
    database: String(input.database ?? saved?.database ?? '').trim(),
    encrypt: input.encrypt !== undefined ? input.encrypt !== false : saved?.encrypt !== false,
    trustServerCertificate:
      input.trustServerCertificate !== undefined
        ? input.trustServerCertificate !== false
        : saved?.trustServerCertificate !== false,
  }

  const password = resolvePassword({ id, password: input.password })
  const started = Date.now()
  const pool = new sql.ConnectionPool(buildConfig(connection, password, connection.database || 'master'))
  pool.on('error', () => {})

  try {
    await pool.connect()
    const info = await readServerInfo(pool)
    return { ...info, elapsedMs: Date.now() - started }
  } finally {
    await closePool(pool)
  }
}

export async function connect({ id, password }) {
  const connection = getConnection(id)
  if (!connection) throw codedError('NOT_FOUND', 'Connection not found.')

  const resolved = resolvePassword({ id, password })
  if (password !== undefined && password !== null) setPassword(id, password)

  await disconnectConnection(id)

  const baseDatabase = connection.database || 'master'
  const pool = await createPool(connection, resolved, baseDatabase)
  runtimeConnections.set(id, { connection, password: resolved, pool })

  let databases = []
  let info = { serverName: connection.host, productVersion: '', edition: '' }
  try {
    databases = await readDatabases(pool)
    info = await readServerInfo(pool)
  } catch {}

  return {
    connectionId: id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: baseDatabase,
    databases,
    serverVersion: info.productVersion,
    serverName: info.serverName,
    edition: info.edition,
  }
}

export async function disconnectConnection(connectionId) {
  const runtime = runtimeConnections.get(connectionId)
  runtimeConnections.delete(connectionId)

  for (const key of Array.from(databasePools.keys())) {
    if (key.startsWith(`${connectionId}::`)) {
      const pool = databasePools.get(key)
      databasePools.delete(key)
      await closePool(pool)
    }
  }

  if (runtime) await closePool(runtime.pool)

  return { connectionId }
}

export async function closeAllConnections() {
  const pools = [Array.from(databasePools.values()), Array.from(runtimeConnections.values()).map((item) => item.pool)]
  databasePools.clear()
  runtimeConnections.clear()
  await Promise.all(pools.flat().map(closePool))
}

export async function listDatabases({ connectionId }) {
  const runtime = await getRuntime(connectionId)
  return { databases: await readDatabases(runtime.pool) }
}

export async function listTables({ connectionId, database }) {
  await getRuntime(connectionId)
  const pool = await getDatabasePool(connectionId, database)

  const result = await pool.request().query(
    `SELECT s.name AS schemaName,
            t.name AS tableName,
            c.name AS columnName
       FROM sys.tables t
       JOIN sys.schemas s ON s.schema_id = t.schema_id
       LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
       LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      ORDER BY s.name, t.name, ic.key_ordinal`,
  )

  const tables = new Map()

  for (const row of result.recordset || []) {
    const schema = String(row.schemaName)
    const name = String(row.tableName)
    const key = JSON.stringify([schema, name])

    let table = tables.get(key)
    if (!table) {
      table = { schema, name, primaryKey: [] }
      tables.set(key, table)
    }
    if (row.columnName !== null && row.columnName !== undefined) {
      table.primaryKey.push(String(row.columnName))
    }
  }

  return { database: database || null, tables: Array.from(tables.values()) }
}

function columnNames(recordset) {
  const columns = recordset?.columns
  if (columns && typeof columns === 'object') {
    const names = Object.values(columns).map((column) => column?.name)
    if (names.every(Boolean)) return names
  }
  const firstRow = Array.isArray(recordset) ? recordset[0] : null
  return firstRow ? Object.keys(firstRow) : []
}

function serializeResultSets(recordsets) {
  let truncated = false

  const resultSets = (recordsets || []).map((recordset) => {
    const names = columnNames(recordset)
    const rows = Array.isArray(recordset) ? recordset : []
    const limited = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows
    if (limited.length < rows.length) truncated = true

    return {
      columns: names.map((name) => ({ name })),
      rows: limited.map((row) => names.map((name) => toPlainValue(row[name]))),
      rowCount: rows.length,
    }
  })

  return { resultSets, truncated }
}

export async function runQuery({ connectionId, database, sql: text }) {
  const statement = typeof text === 'string' ? text.trim() : ''
  if (!statement) throw codedError('EMPTY_QUERY', 'Nothing to run — the editor is empty.')

  const pool = await getDatabasePool(connectionId, database)
  const started = Date.now()

  try {
    const result = await pool.request().batch(statement)
    const { resultSets, truncated } = serializeResultSets(result.recordsets)
    const rowsAffected = (result.rowsAffected || []).map((count) => Number(count) || 0)

    return {
      elapsedMs: Date.now() - started,
      resultSets,
      rowsAffected,
      rowCount: resultSets.reduce((total, set) => total + set.rowCount, 0),
      truncated,
      maxRows: MAX_ROWS,
    }
  } catch (error) {
    const code = String(error?.code || '')
    if (code === 'ECONNCLOSED' || /connection is closed/i.test(String(error?.message))) {
      await dropDatabasePool(connectionId, database)
    }
    throw error
  }
}
