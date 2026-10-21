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

export async function listModules({ connectionId, database }) {
  await getRuntime(connectionId)
  const pool = await getDatabasePool(connectionId, database)

  const result = await pool.request().query(
    `SELECT s.name AS schemaName,
            o.name AS moduleName,
            o.type_desc AS typeDesc
       FROM sys.objects o
       JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('P', 'FN', 'IF', 'TF') AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name`,
  )

  const modules = (result.recordset || []).map((row) => ({
    schema: String(row.schemaName),
    name: String(row.moduleName),
    type: moduleKind(row.typeDesc),
  }))

  return { database: database || null, modules }
}

function moduleKind(typeDesc) {
  return String(typeDesc).toLowerCase().includes('function') ? 'function' : 'procedure'
}

function toAlterStatement(definition) {
  const text = String(definition).trim()
  if (/^CREATE\s+OR\s+ALTER\b/i.test(text)) {
    return text.replace(/^CREATE\s+OR\s+ALTER\b/i, 'ALTER')
  }
  if (/^CREATE\b/i.test(text)) return text.replace(/^CREATE\b/i, 'ALTER')
  return text
}

export async function moduleDefinition({ connectionId, database, schema, name }) {
  await getRuntime(connectionId)
  const pool = await getDatabasePool(connectionId, database)

  const result = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('name', sql.NVarChar(128), name)
    .query(
      `SELECT m.definition AS definition,
              o.type_desc AS typeDesc
         FROM sys.sql_modules m
         JOIN sys.objects o ON o.object_id = m.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @schema AND o.name = @name`,
    )

  const row = (result.recordset || [])[0]
  if (!row || !row.definition) {
    throw codedError('NOT_FOUND', `No source found for ${schema}.${name}.`)
  }

  const definition = String(row.definition)

  return {
    database: database || null,
    schema,
    name,
    type: moduleKind(row.typeDesc),
    definition,
    statement: toAlterStatement(definition),
  }
}

export async function tableRelations({ connectionId, database, schema, table }) {
  await getRuntime(connectionId)
  const pool = await getDatabasePool(connectionId, database)

  const result = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query(
      `SELECT pc.name AS columnName,
              rs.name AS referencedSchema,
              rt.name AS referencedTable,
              rc.name AS referencedColumn
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @schema AND t.name = @table
        ORDER BY fk.name, fkc.constraint_column_id`,
    )

  return {
    relations: (result.recordset || []).map((row) => ({
      column: String(row.columnName),
      referencedSchema: String(row.referencedSchema),
      referencedTable: String(row.referencedTable),
      referencedColumn: String(row.referencedColumn),
    })),
  }
}

const PRECISION_SCALE_TYPES = new Set(['decimal', 'numeric'])
const SCALE_TYPES = new Set(['datetime2', 'datetimeoffset', 'time'])
const LENGTH_TYPES = new Set(['char', 'varchar', 'binary', 'varbinary'])

function quoteName(value) {
  return `[${String(value).replace(/]/g, ']]')}]`
}

function buildColumnDefinition(column) {
  if (column.isComputed) {
    return `${quoteName(column.name)} AS ${String(column.computedDefinition)}`
  }

  const typeName = String(column.typeName).toLowerCase()
  let type = String(column.typeName)

  if (PRECISION_SCALE_TYPES.has(typeName)) {
    type = `${type}(${Number(column.precision)}, ${Number(column.scale)})`
  } else if (SCALE_TYPES.has(typeName)) {
    type = `${type}(${Number(column.scale)})`
  } else if (LENGTH_TYPES.has(typeName)) {
    type = `${type}(${Number(column.maxLength) === -1 ? 'MAX' : Number(column.maxLength)})`
  } else if (typeName === 'nvarchar' || typeName === 'nchar') {
    type = `${type}(${Number(column.maxLength) === -1 ? 'MAX' : Number(column.maxLength) / 2})`
  }

  let definition = `${quoteName(column.name)} ${type}`

  if (column.isIdentity) {
    definition += ` IDENTITY(${Number(column.seedValue)}, ${Number(column.incrementValue)})`
  }

  const nullability = column.isNullable ? '' : ' NOT NULL'
  const collation =
    column.collation && column.collation !== column.databaseCollation
      ? ` COLLATE ${String(column.collation)}`
      : ''

  return `${definition}${collation}${nullability}`
}

export async function tableStructure({ connectionId, database, schema, table }) {
  await getRuntime(connectionId)
  const pool = await getDatabasePool(connectionId, database)

  const columnsResult = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query(
      `SELECT c.name AS columnName,
              c.is_nullable AS isNullable,
              c.is_identity AS isIdentity,
              c.is_computed AS isComputed,
              cc.definition AS computedDefinition,
              ic.seed_value AS seedValue,
              ic.increment_value AS incrementValue,
              c.collation_name AS collation,
              CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS databaseCollation,
              ty.name AS typeName,
              c.max_length AS maxLength,
              c.precision AS precision,
              c.scale AS scale
         FROM sys.columns c
         JOIN sys.types ty ON ty.user_type_id = c.user_type_id
         LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
         JOIN sys.tables t ON t.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @schema AND t.name = @table
        ORDER BY c.column_id`,
    )

  const columns = (columnsResult.recordset || []).map((row) => ({
    name: String(row.columnName),
    typeName: String(row.typeName),
    maxLength: row.maxLength === null ? null : Number(row.maxLength),
    precision: row.precision === null ? null : Number(row.precision),
    scale: row.scale === null ? null : Number(row.scale),
    isNullable: Boolean(row.isNullable),
    isIdentity: Boolean(row.isIdentity),
    isComputed: Boolean(row.isComputed),
    computedDefinition: row.computedDefinition === null ? null : String(row.computedDefinition),
    seedValue: row.seedValue === null ? null : Number(row.seedValue),
    incrementValue: row.incrementValue === null ? null : Number(row.incrementValue),
    collation: row.collation === null ? null : String(row.collation),
    databaseCollation: row.databaseCollation === null ? null : String(row.databaseCollation),
  }))

  const defaultsResult = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query(
      `SELECT c.name AS columnName, d.name AS constraintName, d.definition AS definition
         FROM sys.default_constraints d
         JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
         JOIN sys.tables t ON t.object_id = d.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @schema AND t.name = @table`,
    )

  const defaults = new Map(
    (defaultsResult.recordset || []).map((row) => [
      String(row.columnName),
      { name: String(row.constraintName), definition: String(row.definition) },
    ]),
  )

  const keysResult = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query(
      `SELECT i.is_primary_key AS isPrimaryKey,
              i.is_unique AS isUnique,
              i.is_unique_constraint AS isUniqueConstraint,
              i.type_desc AS typeDesc,
              i.name AS indexName,
              col.name AS columnName,
              ic.is_descending_key AS isDescending
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @schema AND t.name = @table AND ic.is_included_column = 0
          AND i.is_hypothetical = 0 AND i.type IN (1, 2)
        ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`,
    )

  const keys = []
  const indexes = []
  const keyColumns = new Map()
  for (const row of keysResult.recordset || []) {
    const key = `${row.isUniqueConstraint ? 'uq' : row.isPrimaryKey ? 'pk' : 'ix'}::${row.indexName}`
    let entry = keyColumns.get(key)
    if (!entry) {
      entry = {
        name: String(row.indexName),
        primary: Boolean(row.isPrimaryKey),
        unique: Boolean(row.isUnique),
        uniqueConstraint: Boolean(row.isUniqueConstraint),
        clustered: String(row.typeDesc).startsWith('CLUSTERED'),
        columns: [],
        columnNames: [],
        descending: [],
      }
      keyColumns.set(key, entry)
      if (entry.primary || entry.uniqueConstraint) keys.push(entry)
      else indexes.push(entry)
    }
    entry.columns.push(
      row.isDescending ? `${quoteName(row.columnName)} DESC` : quoteName(row.columnName),
    )
    entry.columnNames.push(String(row.columnName))
    entry.descending.push(Boolean(row.isDescending))
  }

  const foreignResult = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query(
      `SELECT fk.name AS foreignKeyName,
              pc.name AS parentColumn,
              rs.name AS referencedSchema,
              rt.name AS referencedTable,
              rc.name AS referencedColumn
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = @schema AND t.name = @table
        ORDER BY fk.name, fkc.constraint_column_id`,
    )

  const foreignKeys = []
  const foreignColumns = new Map()
  for (const row of foreignResult.recordset || []) {
    const name = String(row.foreignKeyName)
    let entry = foreignColumns.get(name)
    if (!entry) {
      entry = {
        name,
        referencedSchema: String(row.referencedSchema),
        referencedTable: String(row.referencedTable),
        columns: [],
      }
      foreignColumns.set(name, entry)
      foreignKeys.push(entry)
    }
    entry.columns.push({
      column: String(row.parentColumn),
      referencedColumn: String(row.referencedColumn),
    })
  }

  const lines = columns.map((column) => {
    const entry = defaults.get(column.name)
    const definition = buildColumnDefinition(column)
    if (!entry || column.isComputed) return definition
    return `${definition} DEFAULT ${entry.definition}`
  })

  for (const foreign of foreignKeys) {
    const columnsList = foreign.columns.map((item) => quoteName(item.column)).join(', ')
    const referencedList = foreign.columns.map((item) => quoteName(item.referencedColumn)).join(', ')
    lines.push(
      `CONSTRAINT ${quoteName(foreign.name)} FOREIGN KEY (${columnsList}) REFERENCES ${quoteName(
        foreign.referencedSchema,
      )}.${quoteName(foreign.referencedTable)} (${referencedList})`,
    )
  }

  for (const key of keys) {
    if (key.primary) {
      lines.push(`PRIMARY KEY (${key.columns.join(', ')})`)
    } else {
      const modifier = key.clustered ? ' CLUSTERED' : ''
      lines.push(`CONSTRAINT ${quoteName(key.name)} UNIQUE${modifier} (${key.columns.join(', ')})`)
    }
  }

  const body = lines.map((line) => `  ${line}`).join(', \n')
  const statement = `CREATE TABLE ${quoteName(schema)}.${quoteName(table)} (\n${body}\n);`

  const toDesignKey = (key) => ({
    name: key.name,
    columns: key.columnNames,
    descending: key.descending,
    clustered: key.clustered,
  })
  const primaryColumns = keys.filter((key) => key.primary).map(toDesignKey)
  const uniqueColumns = keys.filter((key) => !key.primary).map(toDesignKey)
  const indexList = indexes.map((index) => ({
    name: index.name,
    columns: index.columnNames,
    descending: index.descending,
    unique: index.unique,
    clustered: index.clustered,
  }))

  return {
    database: database || null,
    schema,
    table,
    objectName: `${quoteName(schema)}.${quoteName(table)}`,
    statement,
    columns: columns.map((column) => {
      const entry = defaults.get(column.name)
      return {
        name: column.name,
        typeName: column.typeName,
        maxLength: column.maxLength,
        precision: column.precision,
        scale: column.scale,
        isNullable: column.isNullable,
        isIdentity: column.isIdentity,
        isComputed: column.isComputed,
        computedDefinition: column.computedDefinition,
        seedValue: column.seedValue,
        incrementValue: column.incrementValue,
        collation: column.collation,
        databaseCollation: column.databaseCollation,
        defaultName: entry ? entry.name : null,
        defaultDefinition: entry ? entry.definition : null,
      }
    }),
    foreignKeys: foreignKeys.map((foreign) => ({
      name: foreign.name,
      referencedSchema: foreign.referencedSchema,
      referencedTable: foreign.referencedTable,
      columns: foreign.columns.map((item) => ({
        column: item.column,
        referencedColumn: item.referencedColumn,
      })),
    })),
    primaryKey: primaryColumns,
    uniqueKeys: uniqueColumns,
    indexes: indexList,
  }
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
      rows: limited.map((row) =>
        names.map((name) => {
          const value = toPlainValue(row[name])
          if (typeof value === 'boolean') return value ? 1 : 0
          return value
        }),
      ),
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
    const request = pool.request()
    const messages = []
    request.on('info', (info) => {
      const message = String(info?.message || '').trim()
      if (!message) return
      if (/^Changed database context/i.test(message)) return
      messages.push({ type: 'print', text: message })
    })

    const result = await request.batch(statement)
    const { resultSets, truncated } = serializeResultSets(result.recordsets)
    const rowsAffected = (result.rowsAffected || []).map((count) => Number(count) || 0)
    for (const count of rowsAffected) messages.push({ type: 'rows', count })

    return {
      elapsedMs: Date.now() - started,
      resultSets,
      rowsAffected,
      messages,
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
