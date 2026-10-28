import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { DEFAULT_SETTINGS, applySettings } from './settings.js'
import { generateCreateTable } from './designSql.js'
import { csvRecords, jsonRecords, quoteIdentifier, sqlLiteral } from './resultFormats.js'
import { buildFilteredSql, buildFilterWhere } from './filters.js'
import {
  buildDeleteStatements,
  buildEditSource,
  buildQueryEditSource,
  editAllows,
  editSqlHeader,
  editTableFromSql,
} from './edits.js'
import { executionGuard } from './queryModes.js'
import { parseShowPlanXml } from './planParser.js'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import ConnectionDialog from './components/ConnectionDialog.jsx'
import ConnectionsScreen from './components/ConnectionsScreen.jsx'
import DatabaseUsersDialog from './components/DatabaseUsersDialog.jsx'
import DropDatabaseDialog from './components/DropDatabaseDialog.jsx'
import PromptDialog from './components/PromptDialog.jsx'
import QueryEditor from './components/QueryEditor.jsx'
import QueryGuardDialog from './components/QueryGuardDialog.jsx'
import JsonPanel, { JSON_PANEL_DEFAULT_WIDTH } from './components/JsonPanel.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import SaveQueryDialog from './components/SaveQueryDialog.jsx'
import SavedQueriesDialog from './components/SavedQueriesDialog.jsx'
import QueryHistoryDialog from './components/QueryHistoryDialog.jsx'
import Sidebar, { SIDEBAR_DEFAULT_WIDTH } from './components/Sidebar.jsx'
import ShortcutPanel from './components/ShortcutPanel.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import StatusBar from './components/StatusBar.jsx'
import TabBar from './components/TabBar.jsx'
import TableDesigner from './components/TableDesigner.jsx'
import WorkspaceHeader from './components/WorkspaceHeader.jsx'

const STARTER_SQL = `-- Nova Tables
-- Pick a table in the sidebar or write a query, then press Ctrl+Enter to run it.

SELECT TOP (100) *
FROM sys.databases;
`

const NEW_FUNCTION_SQL = `CREATE FUNCTION dbo.fn_name()
RETURNS INT
AS
BEGIN
    RETURN 0
END
`

const EMPTY_TABLES = { status: 'idle', database: null, tables: [], error: null }
const EMPTY_MODULES = { status: 'idle', database: null, modules: [], error: null }
const EMPTY_COLUMNS = { status: 'idle', database: null, tables: [], error: null }
const EMPTY_DATABASE_USERS = { status: 'idle', users: [], roles: [], logins: [], error: null }
const IDLE_QUERY = { status: 'idle', result: null, error: null }
const EDITOR_DEFAULT_HEIGHT = 320
const BROWSE_ROWS = 300

function createTab(id, title, sql, editSource = null, savedQuery = null) {
  return {
    id,
    kind: 'query',
    title,
    sql,
    savedQueryId: savedQuery?.id ?? null,
    savedQueryName: savedQuery?.name ?? null,
    state: IDLE_QUERY,
    activeSet: 0,
    relations: [],
    editSource,
    edits: {},
    lastExecutedSql: null,
  }
}

function createDesignTab(id, title, target) {
  return {
    id,
    kind: 'design',
    title,
    target,
    design: null,
    loading: true,
    error: null,
    busy: false,
    sql: '',
    state: IDLE_QUERY,
    activeSet: 0,
  }
}

function pickDatabase(databases, configured) {
  const names = databases.map((database) => database.name)
  if (configured && names.includes(configured)) return configured
  const online = databases.find((database) => !database.isSystem && database.isOnline)
  return online?.name || names[0] || configured || 'master'
}

function dropDatabaseState(session, database, running) {
  if (!session) return { allowed: false, hint: 'Open a connection first.' }
  if (!database) return { allowed: false, hint: 'Select a database first.' }
  if (database.isSystem) return { allowed: false, hint: 'System databases cannot be dropped.' }
  if (!database.isOnline) return { allowed: false, hint: 'The database must be online.' }
  if (String(database.name).toLowerCase() === String(session.database || '').toLowerCase()) {
    return { allowed: false, hint: 'The connection default database cannot be dropped.' }
  }
  if (running) return { allowed: false, hint: 'Wait for the running query to finish.' }
  return { allowed: true, hint: 'Drop database' }
}

function manageUsersState(session, database) {
  if (!session) return { allowed: false, hint: 'Open a connection first.' }
  if (!database) return { allowed: false, hint: 'Select a database first.' }
  if (database.isSystem) return { allowed: false, hint: 'System databases cannot be managed here.' }
  if (!database.isOnline) return { allowed: false, hint: 'The database must be online.' }
  return { allowed: true, hint: 'Users & permissions' }
}

function qualifiedName(table) {
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`
}

function browseSql(table) {
  const order = table.primaryKey.map((column) => `${quoteIdentifier(column)} DESC`).join(', ')
  const orderBy = order ? `\nORDER BY ${order}` : ''
  return `SELECT TOP (${BROWSE_ROWS}) *\nFROM ${qualifiedName(table)}${orderBy};`
}

function sessionTableFor(session, schema, name) {
  const tables = session.tables?.tables ?? []
  return tables.find((table) => table.schema === schema && table.name === name) ?? null
}

function relatedSql(relation, value) {
  const column = quoteIdentifier(relation.referencedColumn)
  const filter =
    value === null || value === undefined
      ? `${column} IS NULL`
      : `${column} = ${sqlLiteral(value)}`
  return `SELECT TOP (${BROWSE_ROWS}) *\nFROM ${quoteIdentifier(relation.referencedSchema)}.${quoteIdentifier(relation.referencedTable)}\nWHERE ${filter};`
}

function queryTitle(index) {
  return `Query ${index}`
}

function nextQueryTitle(tabs) {
  const highest = tabs.reduce((max, tab) => {
    const match = /^Query (\d+)$/.exec(tab.title)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return queryTitle(highest + 1)
}

function constraintName(prefix, table, columns) {
  return `${prefix}_${table}_${columns.join('_')}`.slice(0, 128)
}

function cloneDesign(structure, name) {
  return {
    schema: structure.schema,
    table: name,
    columns: structure.columns.map((column) => ({ ...column, defaultName: null, originalName: null })),
    primaryKey: structure.primaryKey[0]?.columns ?? [],
    uniqueKeys: structure.uniqueKeys.map((key) => ({
      ...key,
      name: constraintName('UQ', name, key.columns),
    })),
    foreignKeys: structure.foreignKeys.map((key) => ({
      ...key,
      name: constraintName('FK', name, key.columns.map((item) => item.column)),
    })),
    indexes: structure.indexes.map((index) => ({
      ...index,
      name: constraintName('IX', name, index.columns),
    })),
  }
}

function createSession(result, connection, database, tab) {
  return {
    ...result,
    connection,
    activeDatabase: database,
    tables: EMPTY_TABLES,
    columns: EMPTY_COLUMNS,
    modules: EMPTY_MODULES,
    tabs: [tab],
    activeTabId: tab.id,
    selectedTable: null,
    selectedModule: null,
  }
}

export default function App() {
  const [connections, setConnections] = useState([])
  const [folders, setFolders] = useState([])
  const [sessions, setSessions] = useState({})
  const [activeConnectionId, setActiveConnectionId] = useState(null)
  const [screen, setScreen] = useState('connections')
  const [query, setQuery] = useState({ id: 0, value: STARTER_SQL })
  const [banner, setBanner] = useState(null)
  const [connectingId, setConnectingId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [databaseDrop, setDatabaseDrop] = useState(null)
  const [databaseDropBusy, setDatabaseDropBusy] = useState(false)
  const [databaseUsersOpen, setDatabaseUsersOpen] = useState(false)
  const [databaseUsers, setDatabaseUsers] = useState(EMPTY_DATABASE_USERS)
  const [databaseUsersBusy, setDatabaseUsersBusy] = useState(false)
  const [editorHeight, setEditorHeight] = useState(EDITOR_DEFAULT_HEIGHT)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [jsonPanelWidth, setJsonPanelWidth] = useState(JSON_PANEL_DEFAULT_WIDTH)
  const [jsonPanelCollapsed, setJsonPanelCollapsed] = useState(true)
  const [jsonPanelHovered, setJsonPanelHovered] = useState(false)
  const [activeResultData, setActiveResultData] = useState(null)
  const [appVersion, setAppVersion] = useState('')
  const [tablePrompt, setTablePrompt] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [tableBusy, setTableBusy] = useState(false)
  const [pinnedTables, setPinnedTables] = useState([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [runGuard, setRunGuard] = useState(null)
  const [savedQueriesOpen, setSavedQueriesOpen] = useState(false)
  const [savedQueries, setSavedQueries] = useState([])
  const [savedQueriesLoading, setSavedQueriesLoading] = useState(false)
  const [savedQueriesError, setSavedQueriesError] = useState(null)
  const [saveQueryDialog, setSaveQueryDialog] = useState(null)
  const [queryRenameTarget, setQueryRenameTarget] = useState(null)
  const [queryDeleteTarget, setQueryDeleteTarget] = useState(null)
  const [queryBusy, setQueryBusy] = useState(false)
  const [history, setHistory] = useState({ open: false, items: [], loading: false, error: null })

  const scopeDatabase = activeConnectionId
    ? sessions[activeConnectionId]?.activeDatabase ?? null
    : null

  const sqlRef = useRef(STARTER_SQL)
  const selectionRef = useRef('')
  const sessionsRef = useRef({})
  const activeIdRef = useRef(null)
  const seedIdRef = useRef(0)
  const tabIdRef = useRef(1)
  const splitRef = useRef(null)
  const tablesRequestRef = useRef({})
  const columnsRequestRef = useRef({})
  const modulesRequestRef = useRef({})
  const databaseUsersRequestRef = useRef(0)
  const editSourceRequestsRef = useRef({})

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeIdRef.current = activeConnectionId
  }, [activeConnectionId])

  const showBanner = useCallback((type, message) => {
    setBanner({ type, message })
  }, [])

  useEffect(() => {
    if (!banner) return undefined
    const timer = setTimeout(() => setBanner(null), 2500)
    return () => clearTimeout(timer)
  }, [banner])

  const activeSession = useCallback(() => {
    const id = activeIdRef.current
    return id ? sessionsRef.current[id] || null : null
  }, [])

  const activeQueryTab = useCallback(() => {
    const current = activeSession()
    if (!current) return null
    const tab = current.tabs.find((item) => item.id === current.activeTabId)
    return tab ? { connectionId: current.connectionId, tab } : null
  }, [activeSession])

  const patchSession = useCallback((connectionId, patch) => {
    setSessions((prev) => {
      const current = prev[connectionId]
      if (!current) return prev
      return { ...prev, [connectionId]: { ...current, ...patch } }
    })
  }, [])

  const updateTab = useCallback((connectionId, tabId, patch) => {
    setSessions((prev) => {
      const current = prev[connectionId]
      if (!current) return prev
      return {
        ...prev,
        [connectionId]: {
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== tabId) return tab
            return { ...tab, ...(typeof patch === 'function' ? patch(tab) : patch) }
          }),
        },
      }
    })
  }, [])

  const syncLiveSql = useCallback((connectionId, tabId) => {
    const sql = sqlRef.current
    setSessions((prev) => {
      const current = prev[connectionId]
      if (!current) return prev
      return {
        ...prev,
        [connectionId]: {
          ...current,
          tabs: current.tabs.map((tab) => (tab.id === tabId ? { ...tab, sql } : tab)),
        },
      }
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    api
      .listConnections()
      .then((list) => {
        if (!cancelled) setConnections(list)
      })
      .catch((error) => showBanner('error', error.message))

    api
      .listFolders()
      .then((list) => {
        if (!cancelled) setFolders(list)
      })
      .catch((error) => showBanner('error', error.message))

    api
      .appInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.version)
      })
      .catch(() => {})

    api
      .loadSettings()
      .then((stored) => {
        if (!cancelled) setSettings(applySettings(stored))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [showBanner])

  const loadTables = useCallback(
    async (connectionId, database) => {
      const requestId = (tablesRequestRef.current[connectionId] || 0) + 1
      tablesRequestRef.current[connectionId] = requestId
      patchSession(connectionId, { tables: { status: 'loading', database, tables: [], error: null } })
      try {
        const tables = await api.listTables(connectionId, database)
        if (tablesRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { tables: { status: 'ready', database, tables, error: null } })
      } catch (error) {
        if (tablesRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { tables: { status: 'error', database, tables: [], error: error.message } })
      }
    },
    [patchSession],
  )

  const loadColumns = useCallback(
    async (connectionId, database) => {
      const requestId = (columnsRequestRef.current[connectionId] || 0) + 1
      columnsRequestRef.current[connectionId] = requestId
      try {
        const columns = await api.listColumns(connectionId, database)
        if (columnsRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { columns: { status: 'ready', database, tables: columns, error: null } })
      } catch {
        if (columnsRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { columns: { status: 'ready', database, tables: [], error: null } })
      }
    },
    [patchSession],
  )

  const loadModules = useCallback(
    async (connectionId, database) => {
      const requestId = (modulesRequestRef.current[connectionId] || 0) + 1
      modulesRequestRef.current[connectionId] = requestId
      patchSession(connectionId, { modules: { status: 'loading', database, modules: [], error: null } })
      try {
        const modules = await api.listModules(connectionId, database)
        if (modulesRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { modules: { status: 'ready', database, modules, error: null } })
      } catch (error) {
        if (modulesRequestRef.current[connectionId] !== requestId) return
        patchSession(connectionId, { modules: { status: 'error', database, modules: [], error: error.message } })
      }
    },
    [patchSession],
  )

  const loadDatabaseUsers = useCallback(async (connectionId, database) => {
    const requestId = databaseUsersRequestRef.current + 1
    databaseUsersRequestRef.current = requestId
    setDatabaseUsers((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const data = await api.listDatabaseUsers(connectionId, database)
      if (databaseUsersRequestRef.current !== requestId) return
      setDatabaseUsers({
        status: 'ready',
        users: data.users,
        roles: data.roles,
        logins: data.logins,
        error: null,
      })
    } catch (error) {
      if (databaseUsersRequestRef.current !== requestId) return
      setDatabaseUsers((current) => ({ ...current, status: 'error', error: error.message }))
    }
  }, [])

  const seedEditor = useCallback((sql, focus = true) => {
    seedIdRef.current += 1
    sqlRef.current = sql
    setQuery({ id: seedIdRef.current, value: sql, focus })
  }, [])

  const seedSessionEditor = useCallback(
    (target) => {
      if (!target) return
      const tab = target.tabs.find((item) => item.id === target.activeTabId) || target.tabs[0]
      if (tab) seedEditor(tab.sql, false)
    },
    [seedEditor],
  )

  const closeSession = useCallback(
    async (connectionId) => {
      const target = connectionId || activeIdRef.current
      if (!target) return

      try {
        await api.disconnect(target)
      } catch {}

      const remaining = { ...sessionsRef.current }
      delete remaining[target]
      sessionsRef.current = remaining
      setSessions(remaining)

      if (activeIdRef.current !== target) return

      const nextId = Object.keys(remaining)[0] || null
      activeIdRef.current = nextId
      setActiveConnectionId(nextId)
      if (nextId) seedSessionEditor(remaining[nextId])
      else setScreen('connections')
    },
    [seedSessionEditor],
  )

  const activateSession = useCallback(
    (connectionId) => {
      if (!sessionsRef.current[connectionId]) return
      const current = activeSession()
      if (current && current.connectionId !== connectionId) {
        syncLiveSql(current.connectionId, current.activeTabId)
      }
      setActiveConnectionId(connectionId)
      setScreen('workspace')
      seedSessionEditor(sessionsRef.current[connectionId])
    },
    [activeSession, seedSessionEditor, syncLiveSql],
  )

  const handleConnect = useCallback(
    async (connection) => {
      if (sessionsRef.current[connection.id]) {
        activateSession(connection.id)
        return
      }

      setConnectingId(connection.id)
      setBanner(null)
      try {
        const result = await api.connect({ id: connection.id })
        const database = pickDatabase(result.databases, result.database)

        tabIdRef.current += 1
        const tab = createTab(`tab-${tabIdRef.current}`, queryTitle(1), STARTER_SQL)
        const created = createSession(result, connection, database, tab)

        setSessions((prev) => ({ ...prev, [connection.id]: created }))
        setActiveConnectionId(connection.id)
        setScreen('workspace')
        seedEditor(tab.sql)
        await loadTables(connection.id, database)
        await loadColumns(connection.id, database)
        await loadModules(connection.id, database)
      } catch (error) {
        if (error.code === 'PASSWORD_MISSING') {
          setDialog({
            mode: 'edit',
            connection,
            notice: 'Enter the password for this connection to finish opening it.',
          })
        } else {
          showBanner('error', `Could not connect to “${connection.name}”. ${error.message}`)
        }
      } finally {
        setConnectingId(null)
      }
    },
    [activateSession, loadColumns, loadModules, loadTables, seedEditor, showBanner],
  )

  const openConnectionScreen = useCallback(() => {
    setScreen('connections')
    setBanner(null)
    setSavedQueriesOpen(false)
    setHistory((prev) => ({ ...prev, open: false }))
    setSaveQueryDialog(null)
    setQueryRenameTarget(null)
    setQueryDeleteTarget(null)
  }, [])

  const saveSettings = useCallback(
    async (next) => {
      try {
        const saved = await api.saveSettings(next)
        setSettings(applySettings(saved))
        setSettingsOpen(false)
      } catch (error) {
        applySettings(settings)
        showBanner('error', error.message)
        throw error
      }
    },
    [settings, showBanner],
  )

  useEffect(() => {
    try {
      const offOpen = api.onOpenConnection(openConnectionScreen)
      const offNew = api.onNewConnection(() => setDialog({ mode: 'create' }))
      const offPreferences = api.onPreferences(() => setSettingsOpen(true))
      return () => {
        offOpen()
        offNew()
        offPreferences()
      }
    } catch {
      return undefined
    }
  }, [openConnectionScreen])

  const handleSelectDatabase = useCallback(
    async (database) => {
      const current = activeSession()
      if (!current || !database) return
      patchSession(current.connectionId, { activeDatabase: database })
      await loadTables(current.connectionId, database)
      await loadColumns(current.connectionId, database)
      await loadModules(current.connectionId, database)
    },
    [activeSession, loadColumns, loadModules, loadTables, patchSession],
  )

  const handleRefreshDatabases = useCallback(
    async (connectionId) => {
      const current = sessionsRef.current[connectionId]
      if (!current) return
      try {
        const databases = await api.listDatabases(connectionId)
        patchSession(connectionId, { databases })
        const database = current.activeDatabase
        if (database) {
          await loadTables(connectionId, database)
          await loadColumns(connectionId, database)
          await loadModules(connectionId, database)
        }
        showBanner('success', `Refreshed databases (${databases.length}).`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [loadColumns, loadModules, loadTables, patchSession, showBanner],
  )

  const handleOpenDropDatabase = useCallback(() => {
    const current = activeSession()
    if (!current?.activeDatabase) return
    setDatabaseDrop({ database: current.activeDatabase, error: null })
  }, [activeSession])

  const handleDropDatabaseConfirm = useCallback(
    async (confirmName) => {
      const target = databaseDrop?.database
      if (!target || !activeConnectionId) return

      setDatabaseDropBusy(true)
      setDatabaseDrop((prev) => (prev ? { ...prev, error: null } : prev))

      try {
        await api.dropDatabase({
          connectionId: activeConnectionId,
          database: target,
          confirmName,
          acknowledged: true,
        })
      } catch (error) {
        setDatabaseDrop((prev) => (prev ? { ...prev, error: error.message } : prev))
        setDatabaseDropBusy(false)
        return
      }

      setDatabaseDrop(null)
      setDatabaseDropBusy(false)
      showBanner('success', `Dropped database “${target}”.`)

      try {
        const databases = await api.listDatabases(activeConnectionId)
        const current = sessionsRef.current[activeConnectionId]
        if (!current) return
        const database = pickDatabase(databases, current.database)
        patchSession(activeConnectionId, { databases, activeDatabase: database })
        await loadTables(activeConnectionId, database)
        await loadColumns(activeConnectionId, database)
        await loadModules(activeConnectionId, database)
      } catch (error) {
        showBanner('error', `Database dropped, but the list could not refresh. ${error.message}`)
      }
    },
    [activeConnectionId, databaseDrop, loadColumns, loadModules, loadTables, patchSession, showBanner],
  )

  const handleOpenDatabaseUsers = useCallback(() => {
    const current = activeSession()
    if (!current?.activeDatabase) return
    const info = (current.databases ?? []).find(
      (database) => database.name === current.activeDatabase,
    )
    if (!info?.isOnline || info.isSystem) return
    setDatabaseUsersOpen(true)
    loadDatabaseUsers(current.connectionId, current.activeDatabase)
  }, [activeSession, loadDatabaseUsers])

  const handleCloseDatabaseUsers = useCallback(() => {
    if (databaseUsersBusy) return
    databaseUsersRequestRef.current += 1
    setDatabaseUsersOpen(false)
    setDatabaseUsers(EMPTY_DATABASE_USERS)
  }, [databaseUsersBusy])

  const handleRefreshDatabaseUsers = useCallback(() => {
    const current = activeSession()
    if (!current?.activeDatabase) return
    loadDatabaseUsers(current.connectionId, current.activeDatabase)
  }, [activeSession, loadDatabaseUsers])

  const handleCreateDatabaseUser = useCallback(
    async (login, roles) => {
      const current = activeSession()
      if (!current?.activeDatabase) return false
      setDatabaseUsersBusy(true)
      setDatabaseUsers((value) => ({ ...value, error: null }))
      try {
        await api.createDatabaseUser({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          login,
          roles,
        })
        await loadDatabaseUsers(current.connectionId, current.activeDatabase)
        showBanner('success', `Created database user “${login}”.`)
        return true
      } catch (error) {
        setDatabaseUsers((value) => ({ ...value, error: error.message }))
        return false
      } finally {
        setDatabaseUsersBusy(false)
      }
    },
    [activeSession, loadDatabaseUsers, showBanner],
  )

  const handleUpdateDatabaseUserRoles = useCallback(
    async (user, roles) => {
      const current = activeSession()
      if (!current?.activeDatabase) return false
      setDatabaseUsersBusy(true)
      setDatabaseUsers((value) => ({ ...value, error: null }))
      try {
        await api.updateDatabaseUserRoles({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          user: user.name,
          roles,
        })
        await loadDatabaseUsers(current.connectionId, current.activeDatabase)
        showBanner('success', `Updated roles for “${user.name}”.`)
        return true
      } catch (error) {
        setDatabaseUsers((value) => ({ ...value, error: error.message }))
        return false
      } finally {
        setDatabaseUsersBusy(false)
      }
    },
    [activeSession, loadDatabaseUsers, showBanner],
  )

  const handleDropDatabaseUser = useCallback(
    async (user) => {
      const current = activeSession()
      if (!current?.activeDatabase) return false
      setDatabaseUsersBusy(true)
      setDatabaseUsers((value) => ({ ...value, error: null }))
      try {
        await api.dropDatabaseUser({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          user: user.name,
        })
        await loadDatabaseUsers(current.connectionId, current.activeDatabase)
        showBanner('success', `Dropped database user “${user.name}”.`)
        return true
      } catch (error) {
        setDatabaseUsers((value) => ({ ...value, error: error.message }))
        return false
      } finally {
        setDatabaseUsersBusy(false)
      }
    },
    [activeSession, loadDatabaseUsers, showBanner],
  )

  const handleSelectTable = useCallback(
    (key) => {
      const current = activeSession()
      if (!current) return
      patchSession(current.connectionId, { selectedTable: key })
    },
    [activeSession, patchSession],
  )

  const handleSelectModule = useCallback(
    (key) => {
      const current = activeSession()
      if (!current) return
      patchSession(current.connectionId, { selectedModule: key })
    },
    [activeSession, patchSession],
  )

  const describeEditSource = useCallback(async (connectionId, database, sql, tables) => {
    try {
      const columns = await api.describeResult(connectionId, database, sql)
      return buildQueryEditSource({ sql, columns, tables })
    } catch {
      return null
    }
  }, [])

  const execute = useCallback(
    async (sql, tabId) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before running a query.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before running a query.')
        return
      }

      const tab = current.tabs.find((item) => item.id === tabId)
      const patch = {
        state: { status: 'running', result: null, error: null },
        activeSet: 0,
        edits: {},
        lastExecutedSql: sql,
      }
      const source = tab?.editSource && tab.editSource.sql === sql ? tab.editSource : null
      if (tab && !source) {
        const table = editTableFromSql(sql, current.tables?.tables ?? [])
        patch.editSource = table ? buildEditSource(table, sql) : null
      }
      const requestId = (editSourceRequestsRef.current[tabId] ?? 0) + 1
      editSourceRequestsRef.current[tabId] = requestId

      updateTab(current.connectionId, tabId, patch)
      try {
        const result = await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql,
          recordHistory: true,
        })
        const firstFilled = result.resultSets.findIndex((set) => set.rowCount > 0)
        updateTab(current.connectionId, tabId, {
          state: { status: 'success', result, error: null },
          activeSet: firstFilled === -1 ? 0 : firstFilled,
        })
        if (
          tab &&
          !source &&
          !patch.editSource &&
          result.resultSets.length === 1 &&
          (result.resultSets[0]?.columns?.length ?? 0) > 0
        ) {
          const editSource = await describeEditSource(
            current.connectionId,
            current.activeDatabase,
            sql,
            current.tables?.tables ?? [],
          )
          if (editSource && editSourceRequestsRef.current[tabId] === requestId) {
            updateTab(current.connectionId, tabId, (latest) =>
              latest.editSource ? {} : { editSource },
            )
          }
        }
      } catch (error) {
        updateTab(current.connectionId, tabId, {
          state: {
            status: 'error',
            result: null,
            error: {
              message: error.message,
              code: error.code,
              number: error.number,
              lineNumber: error.lineNumber,
              severity: error.severity,
              state: error.state,
            },
          },
        })
      }
    },
    [activeSession, describeEditSource, showBanner, updateTab],
  )

  const runWithGuard = useCallback(
    (sql, tabId) => {
      const guard = executionGuard(settings.queryExecutionMode, sql)
      if (guard) {
        setRunGuard({ kind: guard.kind, sql, tabId })
        return
      }
      execute(sql, tabId)
    },
    [execute, settings.queryExecutionMode],
  )

  const handleRun = useCallback(() => {
    const current = activeSession()
    if (!current) {
      showBanner('warn', 'Open a connection before running a query.')
      return
    }
    const sql = selectionRef.current || sqlRef.current
    runWithGuard(sql, current.activeTabId)
  }, [activeSession, runWithGuard, showBanner])

  const handleReRun = useCallback(() => {
    const current = activeSession()
    if (!current) {
      showBanner('warn', 'Open a connection before running a query.')
      return
    }
    const tab = current.tabs.find((item) => item.id === current.activeTabId)
    if (!tab || tab.kind !== 'query') return
    const sql = tab.lastExecutedSql
    if (!sql || !sql.trim()) {
      showBanner('warn', 'No query has been run on this tab yet.')
      return
    }
    runWithGuard(sql, current.activeTabId)
  }, [activeSession, runWithGuard, showBanner])

  const handleEstimatedPlan = useCallback(async () => {
    const current = activeSession()
    if (!current) {
      showBanner('warn', 'Open a connection before generating an execution plan.')
      return
    }
    const target = activeQueryTab()
    if (!target) return
    const sql = (selectionRef.current || sqlRef.current || '').trim()
    if (!sql) {
      showBanner('warn', 'Nothing to analyze — write or select a query first.')
      return
    }

    updateTab(current.connectionId, target.tab.id, { busy: true })
    try {
      const res = await api.getExecutionPlan({
        connectionId: current.connectionId,
        database: current.activeDatabase,
        sql,
      })
      const parsed = parseShowPlanXml(res.xml)
      updateTab(current.connectionId, target.tab.id, { executionPlan: parsed, busy: false })
      showBanner('success', 'Generated estimated execution plan.')
    } catch (error) {
      updateTab(current.connectionId, target.tab.id, { busy: false })
      showBanner('error', error.message)
    }
  }, [activeQueryTab, activeSession, showBanner, updateTab])

  const handleSelectionChange = useCallback((text) => {
    selectionRef.current = text
  }, [])

  const handleGuardConfirm = useCallback(() => {
    const pending = runGuard
    setRunGuard(null)
    if (!pending) return
    execute(pending.sql, pending.tabId)
  }, [execute, runGuard])

  const handleChangeExecutionMode = useCallback(
    async (modeId) => {
      const next = applySettings({ ...settings, queryExecutionMode: modeId })
      setSettings(next)
      try {
        const saved = await api.saveSettings(next)
        setSettings(applySettings(saved))
      } catch (error) {
        applySettings(settings)
        showBanner('error', error.message)
      }
    },
    [settings, showBanner],
  )

  const openTab = useCallback(
    (connectionId, title, sql, editSource = null, savedQuery = null) => {
      tabIdRef.current += 1
      const id = `tab-${tabIdRef.current}`
      const liveSql = sqlRef.current
      setSessions((prev) => {
        const current = prev[connectionId]
        if (!current) return prev
        return {
          ...prev,
          [connectionId]: {
            ...current,
            tabs: [
              ...current.tabs.map((tab) => (tab.id === current.activeTabId ? { ...tab, sql: liveSql } : tab)),
              createTab(id, title, sql, editSource, savedQuery),
            ],
            activeTabId: id,
          },
        }
      })
      seedEditor(sql)
      return id
    },
    [seedEditor],
  )

  const refreshSavedQueries = useCallback(async () => {
    const current = activeSession()
    if (!current?.activeDatabase) return
    try {
      const items = await api.listSavedQueries(current.connectionId, current.activeDatabase)
      setSavedQueries(items)
      setSavedQueriesError(null)
    } catch (error) {
      setSavedQueriesError(error.message)
    }
  }, [activeSession])

  useEffect(() => {
    if (screen !== 'workspace' || !activeConnectionId || !scopeDatabase) {
      setSavedQueries([])
      setSavedQueriesError(null)
      setSavedQueriesLoading(false)
      return undefined
    }

    let cancelled = false
    setSavedQueriesLoading(true)
    setSavedQueriesError(null)
    api
      .listSavedQueries(activeConnectionId, scopeDatabase)
      .then((items) => {
        if (!cancelled) setSavedQueries(items)
      })
      .catch((error) => {
        if (!cancelled) setSavedQueriesError(error.message)
      })
      .finally(() => {
        if (!cancelled) setSavedQueriesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeConnectionId, scopeDatabase, screen])

  const handleSaveQuery = useCallback(async () => {
    const current = activeSession()
    if (!current || !current.activeDatabase) {
      showBanner('warn', 'Open a connection and pick a database before saving a query.')
      return
    }

    const tab = current.tabs.find((item) => item.id === current.activeTabId)
    if (!tab || tab.kind !== 'query') return

    const sql = sqlRef.current
    if (!sql.trim()) {
      showBanner('warn', 'Write a query before saving it.')
      return
    }

    if (tab.savedQueryId) {
      setQueryBusy(true)
      try {
        const saved = await api.saveSavedQuery({
          id: tab.savedQueryId,
          connectionId: current.connectionId,
          database: current.activeDatabase,
          name: tab.savedQueryName,
          sql,
        })
        updateTab(current.connectionId, tab.id, {
          savedQueryId: saved.id,
          savedQueryName: saved.name,
          title: saved.name,
        })
        await refreshSavedQueries()
        showBanner('success', `Saved “${saved.name}”.`)
      } catch (error) {
        if (error.code === 'SAVED_QUERY_MISSING') {
          updateTab(current.connectionId, tab.id, { savedQueryId: null, savedQueryName: null })
        }
        showBanner('error', error.message)
      } finally {
        setQueryBusy(false)
      }
      return
    }

    setSaveQueryDialog({
      tabId: tab.id,
      sql,
      initialName: /^Query \d+$/.test(tab.title) ? '' : tab.title,
      existingNames: savedQueries.map((item) => item.name),
    })
  }, [activeSession, refreshSavedQueries, savedQueries, showBanner, updateTab])

  const handleSaveQuerySubmit = useCallback(
    async (name) => {
      const pending = saveQueryDialog
      const current = activeSession()
      if (!pending || !current || !current.activeDatabase) return

      setQueryBusy(true)
      try {
        const saved = await api.saveSavedQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          name,
          sql: pending.sql,
        })
        updateTab(current.connectionId, pending.tabId, {
          savedQueryId: saved.id,
          savedQueryName: saved.name,
          title: saved.name,
        })
        setSaveQueryDialog(null)
        await refreshSavedQueries()
        showBanner('success', `Saved “${saved.name}” to ${current.activeDatabase}.`)
      } catch (error) {
        setSaveQueryDialog((prev) => (prev ? { ...prev, error: error.message } : prev))
      } finally {
        setQueryBusy(false)
      }
    },
    [activeSession, refreshSavedQueries, saveQueryDialog, showBanner, updateTab],
  )

  const handleOpenSavedQueries = useCallback(() => {
    const current = activeSession()
    if (!current || !current.activeDatabase) {
      showBanner('warn', 'Open a connection and pick a database to see its saved queries.')
      return
    }
    setSavedQueriesOpen(true)
    refreshSavedQueries()
  }, [activeSession, refreshSavedQueries, showBanner])

  const loadHistory = useCallback(async (connectionId, database) => {
    setHistory((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const items = await api.listQueryHistory(connectionId, database)
      setHistory((prev) => ({ ...prev, items, loading: false }))
    } catch (error) {
      setHistory((prev) => ({ ...prev, loading: false, error: error.message }))
    }
  }, [])

  const handleOpenQueryHistory = useCallback(() => {
    const current = activeSession()
    if (!current || !current.activeDatabase) {
      showBanner('warn', 'Open a connection and pick a database to see its query history.')
      return
    }
    setHistory({ open: true, items: [], loading: true, error: null })
    loadHistory(current.connectionId, current.activeDatabase)
  }, [activeSession, loadHistory, showBanner])

  const handleOpenHistoryItem = useCallback(
    (item) => {
      const current = activeSession()
      if (!current) return
      setHistory((prev) => ({ ...prev, open: false }))
      openTab(current.connectionId, 'History', item.sql)
    },
    [activeSession, openTab],
  )

  const handleDeleteHistoryItem = useCallback(
    async (item) => {
      try {
        await api.deleteQueryHistory(item.id)
        setHistory((prev) => ({ ...prev, items: prev.items.filter((entry) => entry.id !== item.id) }))
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleClearHistory = useCallback(async () => {
    const current = activeSession()
    if (!current?.activeDatabase) return
    try {
      await api.clearQueryHistory(current.connectionId, current.activeDatabase)
      setHistory((prev) => ({ ...prev, items: [] }))
    } catch (error) {
      showBanner('error', error.message)
    }
  }, [activeSession, showBanner])

  const handleOpenSavedQuery = useCallback(
    (item) => {
      const current = activeSession()
      if (!current || !current.activeDatabase) return
      if (
        item.connectionId !== current.connectionId ||
        item.database.toLowerCase() !== current.activeDatabase.toLowerCase()
      ) {
        showBanner('warn', 'This saved query belongs to another connection or database.')
        return
      }
      setSavedQueriesOpen(false)
      openTab(current.connectionId, item.name, item.sql, null, { id: item.id, name: item.name })
      showBanner('success', `Opened “${item.name}”.`)
    },
    [activeSession, openTab, showBanner],
  )

  const handleRenameSavedQuery = useCallback(
    async (name) => {
      const target = queryRenameTarget
      if (!target) return

      setQueryBusy(true)
      try {
        const saved = await api.renameSavedQuery({ id: target.id, name })
        const current = sessionsRef.current[target.connectionId]
        for (const tab of current?.tabs ?? []) {
          if (tab.savedQueryId !== saved.id) continue
          updateTab(target.connectionId, tab.id, { savedQueryName: saved.name, title: saved.name })
        }
        setQueryRenameTarget(null)
        await refreshSavedQueries()
        showBanner('success', `Renamed saved query to “${saved.name}”.`)
      } catch (error) {
        setQueryRenameTarget((prev) => (prev ? { ...prev, error: error.message } : prev))
      } finally {
        setQueryBusy(false)
      }
    },
    [queryRenameTarget, refreshSavedQueries, showBanner, updateTab],
  )

  const handleDeleteSavedQuery = useCallback(async () => {
    const target = queryDeleteTarget
    if (!target) return

    setQueryBusy(true)
    try {
      await api.deleteSavedQuery(target.id)
      const current = sessionsRef.current[target.connectionId]
      for (const tab of current?.tabs ?? []) {
        if (tab.savedQueryId !== target.id) continue
        updateTab(target.connectionId, tab.id, { savedQueryId: null, savedQueryName: null })
      }
      setQueryDeleteTarget(null)
      await refreshSavedQueries()
      showBanner('success', `Deleted “${target.name}”.`)
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setQueryBusy(false)
    }
  }, [queryDeleteTarget, refreshSavedQueries, showBanner, updateTab])

  const loadRelations = useCallback(
    async (tabId, table) => {
      const current = activeSession()
      if (!current || !current.activeDatabase) return
      try {
        const relations = await api.tableRelations(
          current.connectionId,
          current.activeDatabase,
          table.schema,
          table.name,
        )
        updateTab(current.connectionId, tabId, { relations })
      } catch {}
    },
    [activeSession, updateTab],
  )

  const handleOpenRelation = useCallback(
    (relation, value) => {
      const current = activeSession()
      if (!current) return
      const sql = relatedSql(relation, value)
      const table = sessionTableFor(
        current,
        relation.referencedSchema,
        relation.referencedTable,
      )
      const editSource = table ? buildEditSource(table, sql) : null
      const tabId = openTab(current.connectionId, relation.referencedTable, sql, editSource)
      patchSession(current.connectionId, {
        selectedTable: `${relation.referencedSchema}.${relation.referencedTable}`,
      })
      execute(sql, tabId)
      loadRelations(tabId, {
        schema: relation.referencedSchema,
        name: relation.referencedTable,
      })
    },
    [activeSession, execute, loadRelations, openTab, patchSession],
  )

  const handleBrowseTable = useCallback(
    (table) => {
      const current = activeSession()
      if (!current) return
      const sql = browseSql(table)
      const editSource = buildEditSource(table, sql)
      const tabId = openTab(current.connectionId, table.name, sql, editSource)
      patchSession(current.connectionId, { selectedTable: `${table.schema}.${table.name}` })
      execute(sql, tabId)
      loadRelations(tabId, table)
    },
    [activeSession, execute, loadRelations, openTab, patchSession],
  )

  const handleCopyObjectName = useCallback(
    async (table) => {
      try {
        await api.copyText(table.name)
        showBanner('success', `Copied object name of ${table.schema}.${table.name}.`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleScriptTable = useCallback(
    async (table) => {
      const current = activeSession()
      if (!current) return
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before generating table script.')
        return
      }
      try {
        const structure = await api.tableStructure(
          current.connectionId,
          current.activeDatabase,
          table.schema,
          table.name,
        )
        openTab(current.connectionId, `${table.name}.sql`, `${structure.statement}\n`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, openTab, showBanner],
  )

  const handleOpenModule = useCallback(
    async (module) => {
      const current = activeSession()
      if (!current) return
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before opening a routine.')
        return
      }
      try {
        const result = await api.moduleDefinition(
          current.connectionId,
          current.activeDatabase,
          module.schema,
          module.name,
        )
        openTab(current.connectionId, module.name, `${result.statement}\n`)
        showBanner(
          'warn',
          `ALTER statement for ${module.schema}.${module.name} is not executed. Review and run it manually.`,
        )
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, openTab, showBanner],
  )

  const handleCopyModuleDefinition = useCallback(
    async (module) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before copying a definition.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before copying a definition.')
        return
      }
      try {
        const result = await api.moduleDefinition(
          current.connectionId,
          current.activeDatabase,
          module.schema,
          module.name,
        )
        await api.copyText(result.definition)
        showBanner('success', `Copied definition of ${module.schema}.${module.name}.`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, showBanner],
  )

  const handleNewFunction = useCallback(() => {
    const current = activeSession()
    if (!current) return
    openTab(current.connectionId, 'New function', NEW_FUNCTION_SQL)
  }, [activeSession, openTab])

  const handleCopyText = useCallback(
    async (text, message = 'Copied to clipboard.') => {
      if (!text) return false
      try {
        await api.copyText(text)
        showBanner('success', message)
        return true
      } catch (error) {
        showBanner('error', error.message)
        return false
      }
    },
    [showBanner],
  )

  const handleCopyQuery = useCallback(async () => {
    const current = activeSession()
    if (!current || !current.activeDatabase) {
      showBanner('warn', 'Open a connection and pick a database before copying a query.')
      return
    }

    const tab = current.tabs.find((item) => item.id === current.activeTabId)
    if (!tab || tab.kind !== 'query') return

    const sql = selectionRef.current || sqlRef.current
    if (!sql.trim()) {
      showBanner('warn', 'Write a query before copying it.')
      return
    }

    const ok = await handleCopyText(sql, 'Copied query to clipboard.')
    if (!ok) return
  }, [activeSession, handleCopyText, showBanner])

  const handleExportResult = useCallback(
    async ({ format, filename, columnNames, rows }) => {
      try {
        const isCsv = format === 'csv'
        const content = isCsv ? csvRecords(columnNames, rows) : jsonRecords(columnNames, rows)
        const ext = isCsv ? 'csv' : 'json'
        const filterName = isCsv ? 'CSV Files (*.csv)' : 'JSON Files (*.json)'
        const defaultName = `${filename ? filename.replace(/[^a-zA-Z0-9_-]/g, '_') : 'query_results'}.${ext}`

        const response = await api.saveFile({
          defaultPath: defaultName,
          filters: [
            { name: filterName, extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
          content,
        })

        if (response.saved && response.filePath) {
          showBanner('success', `Exported to ${response.filePath}.`)
        }
      } catch (error) {
        showBanner('error', `Export failed: ${error.message}`)
      }
    },
    [showBanner],
  )

  const tabResultSet = (tab) => {
    const resultSets = tab.state?.result?.resultSets ?? []
    return resultSets[tab.activeSet ?? 0] ?? null
  }

  const setCellEdit = useCallback(
    (connectionId, tab, rowIndex, column, value, original) => {
      const sameValue = value?.special ? value.special === original?.special : value === original
      if (sameValue) {
        updateTab(connectionId, tab.id, (current) => {
          const edits = { ...(current.edits || {}) }
          delete edits[`${rowIndex}:${column}`]
          return { edits }
        })
        return
      }
      updateTab(connectionId, tab.id, (current) => ({
        edits: {
          ...(current.edits || {}),
          [`${rowIndex}:${column}`]: { value, original },
        },
      }))
    },
    [updateTab],
  )

  const handleCellChange = useCallback(
    (rowIndex, column, value, original) => {
      const target = activeQueryTab()
      if (!target) return
      const { connectionId, tab } = target
      if (!editAllows(tab.editSource, column)) return
      setCellEdit(connectionId, tab, rowIndex, column, value, original)
    },
    [activeQueryTab, setCellEdit],
  )

  const handleSetCellValue = useCallback(
    (rowIndex, column, value) => {
      const target = activeQueryTab()
      if (!target) return
      const { connectionId, tab } = target
      const resultSet = tabResultSet(tab)
      if (!resultSet || !editAllows(tab.editSource, column)) return
      const columnIndex = resultSet.columns.findIndex((item) => item.name === column)
      if (columnIndex === -1) return
      const row = resultSet.rows[rowIndex]
      if (!row) return
      setCellEdit(connectionId, tab, rowIndex, column, value, row[columnIndex])
    },
    [activeQueryTab, setCellEdit],
  )

  const handleDeleteRows = useCallback(
    (rowStart, rowEnd) => {
      const target = activeQueryTab()
      if (!target) return
      const { connectionId, tab } = target
      const resultSet = tabResultSet(tab)
      const statements = buildDeleteStatements(tab.editSource, resultSet, rowStart, rowEnd)
      if (!statements.length) return
      const count = statements.length
      const table = tab.editSource?.tables[0]?.table ?? 'rows'
      openTab(
        connectionId,
        `Delete ${table}`,
        `${editSqlHeader(tab.editSource)}${statements.join('\n\n')}\n`,
      )
      showBanner(
        'warn',
        `Delete preview for ${count} row${count === 1 ? '' : 's'} is not executed. Review and run it manually.`,
      )
    },
    [activeQueryTab, openTab, showBanner],
  )

  const handleDiscardEdits = useCallback(() => {
    const target = activeQueryTab()
    if (!target) return
    updateTab(target.connectionId, target.tab.id, { edits: {} })
  }, [activeQueryTab, updateTab])

  const handleRunUpdate = useCallback(
    async (sql) => {
      if (!sql || !sql.trim()) return false
      const current = activeSession()
      if (!current || !current.activeDatabase) return false
      try {
        await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql,
          recordHistory: true,
        })
        const tab = current.tabs.find((item) => item.id === current.activeTabId)
        if (tab) updateTab(current.connectionId, tab.id, { edits: {} })
        showBanner('success', 'Changes applied to the database.')
        return true
      } catch (error) {
        showBanner('error', error.message)
        return false
      }
    },
    [activeSession, showBanner, updateTab],
  )

  const handleCopyUpdateQuery = useCallback(
    async (sql) => {
      if (!sql || !sql.trim()) return
      await handleCopyText(sql, 'Copied UPDATE query to clipboard.')
    },
    [handleCopyText],
  )

  const handleApplyFilter = useCallback(
    async (conditions) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before filtering a result.')
        return
      }
      const source = sqlRef.current.trim()
      if (!source) {
        showBanner('warn', 'There is no query to filter.')
        return
      }
      const where = buildFilterWhere(conditions)
      if (!where) return
      const tab = activeQueryTab()?.tab ?? null
      const inherited = tab?.editSource && tab.editSource.sql === source ? tab.editSource : null
      const sql = buildFilteredSql(source, where)
      const editSource =
        (inherited && { ...inherited, sql }) ||
        (await describeEditSource(
          current.connectionId,
          current.activeDatabase,
          sql,
          current.tables?.tables ?? [],
        ))
      const column = conditions[0]?.column ?? null
      const tabId = openTab(
        current.connectionId,
        column ? `Filter ${column}` : 'Filtered',
        sql,
        editSource,
      )
      execute(sql, tabId)
    },
    [activeQueryTab, activeSession, describeEditSource, execute, openTab, showBanner],
  )

  const openDesignTab = useCallback(
    (connectionId, title, target) => {
      tabIdRef.current += 1
      const id = `tab-${tabIdRef.current}`
      const liveSql = sqlRef.current
      setSessions((prev) => {
        const current = prev[connectionId]
        if (!current) return prev
        return {
          ...prev,
          [connectionId]: {
            ...current,
            tabs: [
              ...current.tabs.map((tab) => (tab.id === current.activeTabId ? { ...tab, sql: liveSql } : tab)),
              createDesignTab(id, title, target),
            ],
            activeTabId: id,
          },
        }
      })
      return id
    },
    [],
  )

  const reloadDesign = useCallback(
    async (tabId, schema, table) => {
      const current = activeSession()
      if (!current || !current.activeDatabase) return
      const structure = await api.tableStructure(
        current.connectionId,
        current.activeDatabase,
        schema,
        table,
      )
      updateTab(current.connectionId, tabId, {
        loading: false,
        error: null,
        title: `Design ${table}`,
        target: { mode: 'edit', schema, table },
        design: {
          schema: structure.schema,
          table: structure.table,
          columns: structure.columns.map((column) => ({ ...column, originalName: column.name })),
          primaryKey: structure.primaryKey[0]?.columns ?? [],
          primaryKeyName: structure.primaryKey[0]?.name ?? null,
          uniqueKeys: structure.uniqueKeys,
          foreignKeys: structure.foreignKeys,
          indexes: structure.indexes,
        },
      })
    },
    [activeSession, updateTab],
  )

  const handleOpenStructure = useCallback(
    async (table) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before opening a structure.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before opening a structure.')
        return
      }

      const tabId = openDesignTab(current.connectionId, `Design ${table.name}`, {
        mode: 'edit',
        schema: table.schema,
        table: table.name,
      })

      try {
        await reloadDesign(tabId, table.schema, table.name)
      } catch (error) {
        updateTab(current.connectionId, tabId, { loading: false, error: error.message })
      }
    },
    [activeSession, openDesignTab, reloadDesign, showBanner, updateTab],
  )

  const handleNewTable = useCallback(
    (table) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before creating a table.')
        return
      }

      const tabId = openDesignTab(current.connectionId, 'New table', {
        mode: 'new',
        schema: table?.schema || 'dbo',
        table: '',
      })

      updateTab(current.connectionId, tabId, {
        loading: false,
        design: {
          schema: table?.schema || 'dbo',
          table: '',
          columns: [
            {
              name: 'id',
              typeName: 'bigint',
              maxLength: 8,
              precision: 19,
              scale: 0,
              isNullable: false,
              isIdentity: true,
              isComputed: false,
              computedDefinition: null,
              seedValue: 1,
              incrementValue: 1,
              collation: null,
              databaseCollation: null,
              defaultName: null,
              defaultDefinition: null,
              originalName: null,
            },
          ],
          primaryKey: ['id'],
          primaryKeyName: null,
          uniqueKeys: [],
          foreignKeys: [],
          indexes: [],
        },
      })
    },
    [activeSession, openDesignTab, showBanner, updateTab],
  )

  const handleRenameTable = useCallback((table) => {
    setTablePrompt({ kind: 'rename', table })
  }, [])

  const handleTogglePin = useCallback((table) => {
    const key = `${table.schema}.${table.name}`
    setPinnedTables((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }, [])

  const handleCloneTable = useCallback(
    async (table) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before cloning a table.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before cloning a table.')
        return
      }

      try {
        const structure = await api.tableStructure(
          current.connectionId,
          current.activeDatabase,
          table.schema,
          table.name,
        )
        const copyName = `${table.name}_copy`
        const sql = generateCreateTable(cloneDesign(structure, copyName))
        openTab(current.connectionId, copyName, sql)
        patchSession(current.connectionId, { selectedTable: `${structure.schema}.${copyName}` })
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, openTab, patchSession, showBanner],
  )

  const handleTruncateTable = useCallback((table) => {
    setTablePrompt({ kind: 'truncate', table })
  }, [])

  const handleDropTable = useCallback((table) => {
    setDropTarget(table)
  }, [])

  const handleTablePromptConfirm = useCallback(
    async (value) => {
      const current = activeSession()
      const prompt = tablePrompt
      if (!current || !prompt || !current.activeDatabase) return

      const table = prompt.table
      if (prompt.kind === 'truncate' && value !== table.name) {
        showBanner('warn', `Type “${table.name}” to confirm the truncate.`)
        return
      }

      const statement =
        prompt.kind === 'rename'
          ? `EXEC sp_rename N'${qualifiedName(table)}', N'${value.replace(/'/g, "''")}';`
          : `TRUNCATE TABLE ${qualifiedName(table)};`

      setTableBusy(true)
      try {
        await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql: statement,
        })
        const nextName = prompt.kind === 'rename' ? value : table.name
        showBanner('success', prompt.kind === 'rename' ? `Renamed to ${value}.` : `Truncated ${table.name}.`)
        patchSession(current.connectionId, { selectedTable: `${table.schema}.${nextName}` })
        if (prompt.kind === 'rename') {
          const previousKey = `${table.schema}.${table.name}`
          setPinnedTables((prev) =>
            prev.map((item) => (item === previousKey ? `${table.schema}.${value}` : item)),
          )
        }
        setTablePrompt(null)
        await loadTables(current.connectionId, current.activeDatabase)
        await loadColumns(current.connectionId, current.activeDatabase)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        setTableBusy(false)
      }
    },
    [activeSession, loadTables, loadColumns, patchSession, showBanner, tablePrompt],
  )

  const handleDropConfirm = useCallback(async () => {
    const current = activeSession()
    if (!current || !dropTarget || !current.activeDatabase) return

    setTableBusy(true)
    try {
      await api.runQuery({
        connectionId: current.connectionId,
        database: current.activeDatabase,
        sql: `DROP TABLE ${qualifiedName(dropTarget)};`,
      })
      showBanner('success', `Dropped ${dropTarget.schema}.${dropTarget.name}.`)
      patchSession(current.connectionId, { selectedTable: null })
      setPinnedTables((prev) => prev.filter((item) => item !== `${dropTarget.schema}.${dropTarget.name}`))
      setDropTarget(null)
      await loadTables(current.connectionId, current.activeDatabase)
      await loadColumns(current.connectionId, current.activeDatabase)
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setTableBusy(false)
    }
  }, [activeSession, dropTarget, loadTables, loadColumns, patchSession, showBanner])

  const handleDesignGenerate = useCallback(
    (sql) => {
      const current = activeSession()
      if (!current) return
      openTab(current.connectionId, 'Generated SQL', sql)
    },
    [activeSession, openTab],
  )

  const handleDesignApply = useCallback(
    async (tabId, sql, draft) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before applying changes.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before applying changes.')
        return
      }

      updateTab(current.connectionId, tabId, { busy: true })
      try {
        await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql,
        })
        showBanner('success', 'Structure applied.')
        await loadTables(current.connectionId, current.activeDatabase)
        await loadColumns(current.connectionId, current.activeDatabase)
        await reloadDesign(tabId, draft.schema, draft.table)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(current.connectionId, tabId, { busy: false })
      }
    },
    [activeSession, loadTables, loadColumns, reloadDesign, showBanner, updateTab],
  )

  const handleDesignRename = useCallback(
    async (tabId, draft, nextName) => {
      const current = activeSession()
      if (!current || !current.activeDatabase) return
      if (!nextName || nextName === draft.table) return

      updateTab(current.connectionId, tabId, { busy: true })
      try {
        await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql: `EXEC sp_rename N'${quoteIdentifier(draft.schema)}.${quoteIdentifier(draft.table)}', N'${nextName.replace(/'/g, "''")}';`,
        })
        showBanner('success', `Renamed table to ${nextName}.`)
        await loadTables(current.connectionId, current.activeDatabase)
        await loadColumns(current.connectionId, current.activeDatabase)
        await reloadDesign(tabId, draft.schema, nextName)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(current.connectionId, tabId, { busy: false })
      }
    },
    [activeSession, loadTables, loadColumns, reloadDesign, showBanner, updateTab],
  )

  const handleSqlChange = useCallback((value) => {
    sqlRef.current = value
  }, [])

  const handleSelectTab = useCallback(
    (tabId) => {
      const current = activeSession()
      if (!current || tabId === current.activeTabId) return
      const next = current.tabs.find((tab) => tab.id === tabId)
      if (!next) return
      syncLiveSql(current.connectionId, current.activeTabId)
      patchSession(current.connectionId, { activeTabId: tabId })
      seedEditor(next.sql)
    },
    [activeSession, patchSession, seedEditor, syncLiveSql],
  )

  const handleCloseTab = useCallback(
    (tabId) => {
      const current = activeSession()
      if (!current) return
      const index = current.tabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return

      const remaining = current.tabs.filter((tab) => tab.id !== tabId)

      if (remaining.length === 0) {
        tabIdRef.current += 1
        const tab = createTab(`tab-${tabIdRef.current}`, queryTitle(1), '')
        patchSession(current.connectionId, { tabs: [tab], activeTabId: tab.id })
        seedEditor(tab.sql)
        return
      }

      if (tabId !== current.activeTabId) {
        patchSession(current.connectionId, { tabs: remaining })
        return
      }

      const neighbour = remaining[Math.min(index, remaining.length - 1)]
      patchSession(current.connectionId, { tabs: remaining, activeTabId: neighbour.id })
      seedEditor(neighbour.sql)
    },
    [activeSession, patchSession, seedEditor],
  )

  const handleNewTab = useCallback(() => {
    const current = activeSession()
    if (!current) return
    openTab(current.connectionId, nextQueryTitle(current.tabs), '')
  }, [activeSession, openTab])

  const handleSelectSet = useCallback(
    (index) => {
      const current = activeSession()
      if (!current) return
      updateTab(current.connectionId, current.activeTabId, { activeSet: index })
    },
    [activeSession, updateTab],
  )

  const handleSaveConnection = useCallback(
    async (input) => {
      const saved = await api.saveConnection(input)
      setConnections(await api.listConnections())
      setDialog(null)

      const current = sessionsRef.current[saved.id]
      if (!current) return

      const reconnectKeys = ['host', 'port', 'username', 'database', 'encrypt', 'trustServerCertificate', 'hasPassword']
      const needsReconnect = reconnectKeys.some(
        (key) => (current.connection?.[key] ?? null) !== (saved[key] ?? null),
      )

      if (needsReconnect) {
        await closeSession(saved.id)
        showBanner('info', 'Connection settings changed — reconnect to apply them.')
      } else {
        patchSession(saved.id, { name: saved.name, connection: saved })
      }
    },
    [closeSession, patchSession, showBanner],
  )

  const handleDeleteSelection = useCallback(
    async ({ connectionIds = [], folderIds = [] }) => {
      const result = await api.deleteTree({ connectionIds, folderIds })
      setConnections(result.connections)
      setFolders(result.folders)
      for (const id of result.connectionIds) {
        if (sessionsRef.current[id]) await closeSession(id)
      }
      return result
    },
    [closeSession],
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await handleDeleteSelection({ connectionIds: [deleteTarget.id] })
      setDeleteTarget(null)
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, handleDeleteSelection, showBanner])

  const handleCreateFolder = useCallback(
    async (name, parentId) => {
      try {
        await api.saveFolder({ name, parentId })
        setFolders(await api.listFolders())
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleRenameFolder = useCallback(
    async (folder, name) => {
      try {
        await api.saveFolder({ id: folder.id, name })
        setFolders(await api.listFolders())
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleMoveConnection = useCallback(
    async (connection, folderId) => {
      try {
        await api.moveConnection(connection.id, folderId)
        setConnections(await api.listConnections())
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleReorderTree = useCallback(
    async (payload) => {
      try {
        const result = await api.reorderTree(payload)
        setConnections(result.connections)
        setFolders(result.folders)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleReloadConnections = useCallback(async () => {
    try {
      const [nextFolders, nextConnections] = await Promise.all([
        api.listFolders(),
        api.listConnections(),
      ])
      setFolders(nextFolders)
      setConnections(nextConnections)
    } catch (error) {
      showBanner('error', error.message)
    }
  }, [showBanner])

  const handleSplitPointerDown = useCallback((event) => {
    if (event.button !== 0) return
    const container = splitRef.current
    if (!container) return
    event.preventDefault()

    const bounds = container.getBoundingClientRect()
    const move = (moveEvent) => {
      const next = Math.min(Math.max(moveEvent.clientY - bounds.top, 140), bounds.height - 160)
      setEditorHeight(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }, [])

  const handleCloseActiveTab = useCallback(() => {
    const current = activeSession()
    if (!current) return
    handleCloseTab(current.activeTabId)
  }, [activeSession, handleCloseTab])

  const handleCycleTab = useCallback(
    (direction) => {
      const current = activeSession()
      if (!current || current.tabs.length === 0) return
      const index = current.tabs.findIndex((tab) => tab.id === current.activeTabId)
      const next = (index + direction + current.tabs.length) % current.tabs.length
      handleSelectTab(current.tabs[next].id)
    },
    [activeSession, handleSelectTab],
  )

  const handleSelectTabIndex = useCallback(
    (index) => {
      const current = activeSession()
      if (!current) return
      const tab = current.tabs[index]
      if (!tab) return
      handleSelectTab(tab.id)
    },
    [activeSession, handleSelectTab],
  )

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'F1') {
        event.preventDefault()
        setShortcutsOpen((value) => !value)
        return
      }

      const target = event.target
      const inEditor = Boolean(target?.closest?.('.monaco-editor'))
      const tagName = target?.tagName
      const isFormField =
        !inEditor &&
        (tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          Boolean(target?.isContentEditable))
      const hasDialog =
        Boolean(dialog) ||
        Boolean(tablePrompt) ||
        Boolean(dropTarget) ||
        Boolean(deleteTarget) ||
        Boolean(databaseDrop) ||
        databaseUsersOpen ||
        Boolean(runGuard) ||
        Boolean(saveQueryDialog) ||
        Boolean(queryRenameTarget) ||
        Boolean(queryDeleteTarget) ||
        savedQueriesOpen ||
        history.open ||
        shortcutsOpen ||
        settingsOpen

      if (!event.ctrlKey && !event.metaKey) {
        if (event.key === 'F5' && !hasDialog && !isFormField) {
          event.preventDefault()
          handleRun()
        }
        return
      }

      if (event.altKey) return

      if (event.key === 'Enter') {
        if (inEditor || hasDialog || isFormField) return
        event.preventDefault()
        handleRun()
        return
      }

      if (isFormField || hasDialog) return

      if (event.key.toLowerCase() === 's' && !event.shiftKey) {
        event.preventDefault()
        handleSaveQuery()
        return
      }

      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault()
        setDialog({ mode: 'create' })
        return
      }

      if (event.key.toLowerCase() === 'o' && !event.shiftKey) {
        event.preventDefault()
        openConnectionScreen()
        return
      }

      if (event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }

      if (screen !== 'workspace') return

      const key = event.key.toLowerCase()

      if (key === 'w') {
        event.preventDefault()
        handleCloseActiveTab()
        return
      }

      if (key === 't') {
        event.preventDefault()
        handleNewTab()
        return
      }

      if (key === 'r') {
        event.preventDefault()
        handleReRun()
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        handleCycleTab(event.shiftKey ? -1 : 1)
        return
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        handleSelectTabIndex(Number(event.key) - 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    deleteTarget,
    dialog,
    dropTarget,
    databaseDrop,
    databaseUsersOpen,
    handleCloseActiveTab,
    handleCycleTab,
    handleNewTab,
    handleReRun,
    handleRun,
    handleSaveQuery,
    handleSelectTabIndex,
    openConnectionScreen,
    queryDeleteTarget,
    queryRenameTarget,
    runGuard,
    saveQueryDialog,
    savedQueriesOpen,
    history.open,
    screen,
    settingsOpen,
    shortcutsOpen,
    tablePrompt,
  ])

  const session = activeConnectionId ? sessions[activeConnectionId] || null : null
  const completionCatalog = useMemo(
    () => ({
      tables: session?.tables?.tables ?? [],
      columns: session?.columns?.tables ?? [],
    }),
    [session?.tables, session?.columns],
  )
  const activeTab = session
    ? session.tabs.find((tab) => tab.id === session.activeTabId) || null
    : null
  const running = activeTab?.state.status === 'running'
  const activeDatabaseInfo = session
    ? (session.databases ?? []).find((database) => database.name === session.activeDatabase) ?? null
    : null
  const dropState = dropDatabaseState(session, activeDatabaseInfo, running)
  const manageUsers = manageUsersState(session, activeDatabaseInfo)

  const jsonPanelVisible = !jsonPanelCollapsed || jsonPanelHovered
  const jsonText = useMemo(
    () => (jsonPanelVisible && activeResultData ? jsonRecords(activeResultData.columnNames, activeResultData.rows) : ''),
    [jsonPanelVisible, activeResultData],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {banner ? (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}

      {session && screen === 'workspace' ? (
        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            sessions={Object.values(sessions)}
            activeConnectionId={activeConnectionId}
            appVersion={appVersion}
            pinnedTables={pinnedTables}
            onActivateSession={activateSession}
            onCloseSession={closeSession}
            onSelectDatabase={handleSelectDatabase}
            onBrowseTable={handleBrowseTable}
            onCopyObjectName={handleCopyObjectName}
            onScriptTable={handleScriptTable}
            onOpenStructure={handleOpenStructure}
            onOpenModule={handleOpenModule}
            onCopyModuleDefinition={handleCopyModuleDefinition}
            onNewFunction={handleNewFunction}
            onNewTable={handleNewTable}
            onRenameTable={handleRenameTable}
            onCloneTable={handleCloneTable}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
            onTogglePin={handleTogglePin}
            onOpenConnections={openConnectionScreen}
            selectedTable={session.selectedTable}
            onSelectTable={handleSelectTable}
            selectedModule={session.selectedModule}
            onSelectModule={handleSelectModule}
            onRefreshDatabases={handleRefreshDatabases}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={setSidebarCollapsed}
          />

          <main className="flex min-w-0 flex-1 flex-col bg-base">
            <WorkspaceHeader
              session={session}
              activeDatabase={session.activeDatabase}
              running={running}
              queryExecutionMode={settings.queryExecutionMode}
              canDropDatabase={dropState.allowed}
              dropDatabaseHint={dropState.hint}
              canManageUsers={manageUsers.allowed}
              manageUsersHint={manageUsers.hint}
              onSelectDatabase={handleSelectDatabase}
              onChangeExecutionMode={handleChangeExecutionMode}
              onDropDatabase={handleOpenDropDatabase}
              onManageUsers={handleOpenDatabaseUsers}
              onRun={handleRun}
              onEstimatedPlan={handleEstimatedPlan}
              onDisconnect={() => closeSession(session.connectionId)}
              onShowShortcuts={() => setShortcutsOpen(true)}
            />

            <TabBar
              tabs={session.tabs}
              activeTabId={session.activeTabId}
              canSave={Boolean(session.activeDatabase && activeTab?.kind === 'query')}
              onSelect={handleSelectTab}
              onClose={handleCloseTab}
              onNewTab={handleNewTab}
              onSaveQuery={handleSaveQuery}
              onOpenSavedQueries={handleOpenSavedQueries}
              onOpenQueryHistory={handleOpenQueryHistory}
              onCopyQuery={handleCopyQuery}
            />

            {activeTab?.kind === 'design' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <TableDesigner
                  design={activeTab.design}
                  mode={activeTab.target?.mode}
                  loading={activeTab.loading}
                  error={activeTab.error}
                  busy={activeTab.busy}
                  availableTables={session?.tables?.tables ?? []}
                  availableColumns={session?.columns?.tables ?? []}
                  onGenerate={handleDesignGenerate}
                  onApply={(sql, draft) => handleDesignApply(activeTab.id, sql, draft)}
                  onRenameTable={(nextName) =>
                    handleDesignRename(activeTab.id, activeTab.design, nextName)
                  }
                />
              </div>
            ) : (
              <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
                <div style={{ height: editorHeight }} className="min-h-[140px] shrink-0 overflow-hidden">
                  <QueryEditor
                    seed={query}
                    theme={settings.theme}
                    settings={settings}
                    catalog={completionCatalog}
                    onChange={handleSqlChange}
                    onRun={handleRun}
                    onSelectionChange={handleSelectionChange}
                  />
                </div>

                <div
                  onPointerDown={handleSplitPointerDown}
                  onDoubleClick={() => setEditorHeight(EDITOR_DEFAULT_HEIGHT)}
                  className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-base"
                  title="Drag to resize"
                >
                  <span className="h-px w-full bg-line transition-colors group-hover:bg-accent/60" />
                </div>

                <ResultsPanel
                  key={`${session.connectionId}:${activeTab?.id ?? 'empty'}`}
                  state={activeTab?.state || IDLE_QUERY}
                  activeSet={activeTab?.activeSet ?? 0}
                  onSelectSet={handleSelectSet}
                  relations={activeTab?.relations || []}
                  onRelationClick={handleOpenRelation}
                  onCopyText={handleCopyText}
                  editSource={activeTab?.editSource ?? null}
                  edits={activeTab?.edits ?? {}}
                  onCellChange={handleCellChange}
                  onSetCellValue={handleSetCellValue}
                  onDiscardUpdate={handleDiscardEdits}
                  onRunUpdate={handleRunUpdate}
                  onCopyUpdateQuery={handleCopyUpdateQuery}
                  onDeleteRows={handleDeleteRows}
                  onApplyFilter={handleApplyFilter}
                  onActiveDataChange={setActiveResultData}
                  onExport={handleExportResult}
                  tabTitle={activeTab?.title}
                  executionPlan={activeTab?.executionPlan ?? null}
                  onCopyXml={(xml) => handleCopyText(xml, 'Copied execution plan XML.')}
                  onOpenStructure={handleOpenStructure}
                />
              </div>
            )}

            <StatusBar
              result={activeTab?.state.result ?? null}
              editSource={activeTab?.editSource ?? null}
              activeDatabase={session.activeDatabase}
              queryStatus={activeTab?.state.status || 'idle'}
            />
          </main>

          <JsonPanel
            collapsed={jsonPanelCollapsed}
            onToggleCollapsed={setJsonPanelCollapsed}
            width={jsonPanelWidth}
            onWidthChange={setJsonPanelWidth}
            jsonText={jsonText}
            selectionLabel={activeResultData?.label ?? 'Selection'}
            onCopyJson={async () => {
              if (!jsonText) return
              await handleCopyText(jsonText, 'Copied row JSON.')
            }}
            onHoverVisibleChange={setJsonPanelHovered}
          />
        </div>
      ) : (
        <ConnectionsScreen
          connections={connections}
          folders={folders}
          openIds={Object.keys(sessions)}
          connectingId={connectingId}
          appVersion={appVersion}
          onOpen={handleConnect}
          onNewConnection={() => setDialog({ mode: 'create' })}
          onEditConnection={(connection) => setDialog({ mode: 'edit', connection })}
          onDeleteConnection={(connection) => setDeleteTarget(connection)}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteSelection={handleDeleteSelection}
          onMoveConnection={handleMoveConnection}
          onReorderTree={handleReorderTree}
          onReloadConnections={handleReloadConnections}
          onNotify={showBanner}
        />
      )}

      <ShortcutPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} session={session} />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />

      <SavedQueriesDialog
        open={savedQueriesOpen}
        connectionName={session?.name ?? ''}
        database={session?.activeDatabase ?? ''}
        queries={savedQueries}
        loading={savedQueriesLoading}
        error={savedQueriesError}
        blocked={Boolean(queryRenameTarget || queryDeleteTarget)}
        onOpen={handleOpenSavedQuery}
        onRename={(item) => setQueryRenameTarget({ ...item, error: null })}
        onDelete={(item) => setQueryDeleteTarget(item)}
        onClose={() => setSavedQueriesOpen(false)}
      />

      <QueryHistoryDialog
        open={history.open}
        connectionName={session?.name ?? ''}
        database={session?.activeDatabase ?? ''}
        items={history.items}
        loading={history.loading}
        error={history.error}
        onOpen={handleOpenHistoryItem}
        onDelete={handleDeleteHistoryItem}
        onClear={handleClearHistory}
        onClose={() => setHistory((prev) => ({ ...prev, open: false }))}
      />

      <SaveQueryDialog
        open={Boolean(saveQueryDialog)}
        initialName={saveQueryDialog?.initialName}
        connectionName={session?.name ?? ''}
        database={session?.activeDatabase ?? ''}
        existingNames={saveQueryDialog?.existingNames ?? []}
        error={saveQueryDialog?.error ?? null}
        busy={queryBusy}
        onCancel={() => setSaveQueryDialog(null)}
        onSave={handleSaveQuerySubmit}
      />

      {dialog ? (
        <ConnectionDialog
          mode={dialog.mode}
          connection={dialog.connection}
          notice={dialog.notice}
          onClose={() => setDialog(null)}
          onSubmit={handleSaveConnection}
          onTest={api.testConnection}
        />
      ) : null}

      <PromptDialog
        open={Boolean(tablePrompt)}
        title={tablePrompt?.kind === 'rename' ? 'Rename table' : 'Truncate table'}
        description={
          tablePrompt?.kind === 'rename'
            ? `Rename ${tablePrompt.table.schema}.${tablePrompt.table.name}.`
            : `All rows in ${tablePrompt?.table.schema}.${tablePrompt?.table.name} will be removed. This cannot be undone.`
        }
        label={tablePrompt?.kind === 'rename' ? 'New name' : 'Table name'}
        hint={
          tablePrompt?.kind === 'rename'
            ? null
            : `Type "${tablePrompt?.table.name}" to confirm this action.`
        }
        confirmLabel={tableBusy ? 'Working…' : tablePrompt?.kind === 'rename' ? 'Rename' : 'Truncate'}
        initialValue={tablePrompt?.kind === 'rename' ? tablePrompt.table.name : ''}
        placeholder={tablePrompt?.kind === 'rename' ? tablePrompt.table.name : ''}
        busy={tableBusy}
        onCancel={() => setTablePrompt(null)}
        onConfirm={handleTablePromptConfirm}
      />

      <QueryGuardDialog
        open={Boolean(runGuard)}
        sql={runGuard?.sql}
        onCancel={() => setRunGuard(null)}
        onConfirm={handleGuardConfirm}
      />

      <ConfirmDialog
        open={Boolean(dropTarget)}
        title="Drop table"
        message={
          dropTarget
            ? `“${dropTarget.schema}.${dropTarget.name}” will be permanently dropped. This cannot be undone.`
            : ''
        }
        confirmLabel={tableBusy ? 'Dropping…' : 'Drop Table'}
        danger
        busy={tableBusy}
        onCancel={() => setDropTarget(null)}
        onConfirm={handleDropConfirm}
      />

      <DropDatabaseDialog
        open={Boolean(databaseDrop)}
        database={databaseDrop?.database ?? ''}
        connectionName={session?.name ?? ''}
        server={session ? `${session.host}:${session.port}` : ''}
        error={databaseDrop?.error ?? null}
        busy={databaseDropBusy}
        onCancel={() => {
          if (!databaseDropBusy) setDatabaseDrop(null)
        }}
        onConfirm={handleDropDatabaseConfirm}
      />

      <DatabaseUsersDialog
        open={databaseUsersOpen}
        database={session?.activeDatabase ?? ''}
        connectionName={session?.name ?? ''}
        state={databaseUsers}
        busy={databaseUsersBusy}
        onClose={handleCloseDatabaseUsers}
        onRefresh={handleRefreshDatabaseUsers}
        onCreate={handleCreateDatabaseUser}
        onUpdateRoles={handleUpdateDatabaseUserRoles}
        onDrop={handleDropDatabaseUser}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete connection"
        message={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed from this device. Saved passwords for it are deleted as well.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <PromptDialog
        open={Boolean(queryRenameTarget)}
        title="Rename saved query"
        description={
          queryRenameTarget
            ? `Rename “${queryRenameTarget.name}” in ${session?.name ?? ''} / ${queryRenameTarget.database}.`
            : ''
        }
        label="Query name"
        hint="Names are unique within this connection and database."
        confirmLabel={queryBusy ? 'Renaming…' : 'Rename'}
        initialValue={queryRenameTarget?.name ?? ''}
        error={queryRenameTarget?.error ?? null}
        busy={queryBusy}
        onCancel={() => setQueryRenameTarget(null)}
        onConfirm={handleRenameSavedQuery}
      />

      <ConfirmDialog
        open={Boolean(queryDeleteTarget)}
        title="Delete saved query"
        message={
          queryDeleteTarget
            ? `“${queryDeleteTarget.name}” will be removed from ${session?.name ?? ''} / ${queryDeleteTarget.database}. Open tabs keep their SQL.`
            : ''
        }
        confirmLabel={queryBusy ? 'Deleting…' : 'Delete'}
        danger
        busy={queryBusy}
        onCancel={() => setQueryDeleteTarget(null)}
        onConfirm={handleDeleteSavedQuery}
      />
    </div>
  )
}
