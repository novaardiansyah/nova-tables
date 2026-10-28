import sql from 'mssql'
import { isSystemDatabase } from './connectionStore.js'
import { codedError, getDatabasePool, getRuntime, quoteName } from './sqlServer.js'

async function userDatabasePool(connectionId, database) {
  await getRuntime(connectionId)
  const name = String(database || '').trim()
  if (!name) throw codedError('INVALID_DATABASE', 'Choose a database first.')
  if (isSystemDatabase(name)) {
    throw codedError('SYSTEM_DATABASE', 'System databases cannot be managed here.')
  }
  return getDatabasePool(connectionId, name)
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return []
  return [...new Set(roles.map((role) => String(role || '').trim()).filter(Boolean))]
}

async function readFixedRoles(pool) {
  const result = await pool.request().query(
    `SELECT name
       FROM sys.database_principals
      WHERE type = 'R' AND is_fixed_role = 1 AND name <> 'public'`,
  )
  return new Set((result.recordset || []).map((row) => String(row.name)))
}

function assertAllowedRoles(roles, allowed) {
  const invalid = roles.find((role) => !allowed.has(role))
  if (invalid) throw codedError('ROLE_NOT_ALLOWED', `Role “${invalid}” cannot be managed here.`)
}

async function assertManagedUser(pool, user) {
  const name = String(user || '').trim()
  if (!name) throw codedError('INVALID_USER', 'Choose a database user.')

  const result = await pool
    .request()
    .input('name', sql.NVarChar(128), name)
    .query(
      `SELECT dp.name, USER_NAME() AS currentUser
         FROM sys.database_principals dp
        WHERE dp.name = @name AND dp.type IN ('S', 'U', 'G', 'E', 'X')`,
    )
  const row = (result.recordset || [])[0]
  if (!row) throw codedError('USER_NOT_FOUND', `Database user “${name}” does not exist.`)

  const lower = String(row.name).toLowerCase()
  if (['dbo', 'guest', 'sys', 'information_schema'].includes(lower)) {
    throw codedError('USER_PROTECTED', 'This system user cannot be changed.')
  }
  if (lower === String(row.currentUser || '').toLowerCase()) {
    throw codedError('USER_PROTECTED', 'The current connection user cannot be changed.')
  }
  return String(row.name)
}

export async function listDatabaseUsers({ connectionId, database }) {
  const pool = await userDatabasePool(connectionId, database)

  const [userResult, roleResult, loginResult, membershipResult] = await Promise.all([
    pool.request().query(
      `SELECT dp.principal_id AS id,
              dp.name,
              dp.type_desc AS type,
              dp.default_schema_name AS defaultSchema,
              dp.authentication_type_desc AS authenticationType,
              sp.name AS loginName,
              USER_NAME() AS currentUser
         FROM sys.database_principals dp
         LEFT JOIN sys.server_principals sp ON sp.sid = dp.sid
        WHERE dp.type IN ('S', 'U', 'G', 'E', 'X')
          AND dp.name NOT IN ('sys', 'INFORMATION_SCHEMA')
          AND dp.name NOT LIKE '##%'
        ORDER BY dp.name`,
    ),
    pool.request().query(
      `SELECT name
         FROM sys.database_principals
        WHERE type = 'R' AND is_fixed_role = 1 AND name <> 'public'
        ORDER BY name`,
    ),
    pool.request().query(
      `SELECT sp.name, sp.type_desc AS type
         FROM sys.server_principals sp
        WHERE sp.type IN ('S', 'U', 'G')
          AND sp.is_disabled = 0
          AND sp.name NOT LIKE '##%'
          AND NOT EXISTS (
            SELECT 1
              FROM sys.database_principals dp
             WHERE dp.sid = sp.sid OR dp.name = sp.name
          )
        ORDER BY sp.name`,
    ),
    pool.request().query(
      `SELECT rm.member_principal_id AS userId, r.name AS role
         FROM sys.database_role_members rm
         JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
        WHERE r.is_fixed_role = 1 AND r.name <> 'public'`,
    ),
  ])

  const memberships = new Map()
  for (const row of membershipResult.recordset || []) {
    const id = Number(row.userId)
    if (!memberships.has(id)) memberships.set(id, [])
    memberships.get(id).push(String(row.role))
  }

  const currentUser = String((userResult.recordset || [])[0]?.currentUser || '').toLowerCase()
  const systemUsers = new Set(['dbo', 'guest', 'sys', 'information_schema'])
  const users = (userResult.recordset || []).map((row) => {
    const name = String(row.name)
    const lower = name.toLowerCase()
    const system = systemUsers.has(lower)
    const current = lower === currentUser
    return {
      id: Number(row.id),
      name,
      type: String(row.type || ''),
      authenticationType: String(row.authenticationType || ''),
      defaultSchema: row.defaultSchema ? String(row.defaultSchema) : null,
      loginName: row.loginName ? String(row.loginName) : null,
      roles: (memberships.get(Number(row.id)) || []).sort(),
      canManage: !system && !current,
      reason: system ? 'system' : current ? 'current' : null,
    }
  })

  const roles = (roleResult.recordset || []).map((row) => String(row.name))
  const logins = (loginResult.recordset || []).map((row) => ({
    name: String(row.name),
    type: String(row.type || ''),
  }))

  return { users, roles, logins }
}

export async function createDatabaseUser({ connectionId, database, login, roles }) {
  const pool = await userDatabasePool(connectionId, database)
  const loginName = String(login || '').trim()
  if (!loginName) throw codedError('INVALID_LOGIN', 'Choose a login to map.')
  const requested = normalizeRoles(roles)
  assertAllowedRoles(requested, await readFixedRoles(pool))

  const loginResult = await pool
    .request()
    .input('login', sql.NVarChar(128), loginName)
    .query(
      `SELECT sp.name
         FROM sys.server_principals sp
        WHERE sp.name = @login
          AND sp.type IN ('S', 'U', 'G')
          AND sp.is_disabled = 0
          AND NOT EXISTS (
            SELECT 1
              FROM sys.database_principals dp
             WHERE dp.sid = sp.sid OR dp.name = sp.name
          )`,
    )
  const loginRow = (loginResult.recordset || [])[0]
  if (!loginRow) {
    throw codedError('LOGIN_NOT_FOUND', `Login “${loginName}” is not available.`)
  }
  const name = String(loginRow.name)

  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  try {
    await new sql.Request(transaction).query(
      `CREATE USER ${quoteName(name)} FOR LOGIN ${quoteName(name)}`,
    )
    for (const role of requested) {
      await new sql.Request(transaction).query(
        `ALTER ROLE ${quoteName(role)} ADD MEMBER ${quoteName(name)}`,
      )
    }
    await transaction.commit()
  } catch (error) {
    try {
      await transaction.rollback()
    } catch {}
    throw error
  }

  return { user: name, roles: requested }
}

export async function updateDatabaseUserRoles({ connectionId, database, user, roles }) {
  const pool = await userDatabasePool(connectionId, database)
  const name = await assertManagedUser(pool, user)
  const requested = normalizeRoles(roles)
  assertAllowedRoles(requested, await readFixedRoles(pool))

  const currentResult = await pool
    .request()
    .input('name', sql.NVarChar(128), name)
    .query(
      `SELECT r.name
         FROM sys.database_role_members rm
         JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
         JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
        WHERE m.name = @name AND r.is_fixed_role = 1 AND r.name <> 'public'`,
    )
  const current = new Set((currentResult.recordset || []).map((row) => String(row.name)))
  const desired = new Set(requested)

  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  try {
    for (const role of current) {
      if (!desired.has(role)) {
        await new sql.Request(transaction).query(
          `ALTER ROLE ${quoteName(role)} DROP MEMBER ${quoteName(name)}`,
        )
      }
    }
    for (const role of desired) {
      if (!current.has(role)) {
        await new sql.Request(transaction).query(
          `ALTER ROLE ${quoteName(role)} ADD MEMBER ${quoteName(name)}`,
        )
      }
    }
    await transaction.commit()
  } catch (error) {
    try {
      await transaction.rollback()
    } catch {}
    throw error
  }

  return { user: name, roles: requested }
}

export async function dropDatabaseUser({ connectionId, database, user }) {
  const pool = await userDatabasePool(connectionId, database)
  const name = await assertManagedUser(pool, user)
  await pool.request().query(`DROP USER ${quoteName(name)}`)
  return { user: name }
}
