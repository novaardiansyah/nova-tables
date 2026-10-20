import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { generateCreateTable } from './designSql.js'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import ConnectionDialog from './components/ConnectionDialog.jsx'
import ConnectionsScreen from './components/ConnectionsScreen.jsx'
import PromptDialog from './components/PromptDialog.jsx'
import QueryEditor from './components/QueryEditor.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import Sidebar from './components/Sidebar.jsx'
import ShortcutPanel from './components/ShortcutPanel.jsx'
import StatusBar from './components/StatusBar.jsx'
import TabBar from './components/TabBar.jsx'
import TableDesigner from './components/TableDesigner.jsx'
import WorkspaceHeader from './components/WorkspaceHeader.jsx'

const STARTER_SQL = `-- Nova Tables
-- Pick a table in the sidebar or write a query, then press Ctrl+Enter to run it.

SELECT TOP (100) *
FROM sys.databases;
`

const EMPTY_TABLES = { status: 'idle', database: null, tables: [], error: null }
const IDLE_QUERY = { status: 'idle', result: null, error: null }
const EDITOR_DEFAULT_HEIGHT = 320
const BROWSE_ROWS = 300

function createTab(id, title, sql) {
  return { id, kind: 'query', title, sql, state: IDLE_QUERY, activeSet: 0, relations: [] }
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

function quoteIdentifier(name) {
  return `[${String(name).replace(/]/g, ']]')}]`
}

function qualifiedName(table) {
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`
}

function browseSql(table) {
  const order = table.primaryKey.map((column) => `${quoteIdentifier(column)} DESC`).join(', ')
  const orderBy = order ? `\nORDER BY ${order}` : ''
  return `SELECT TOP (${BROWSE_ROWS}) *\nFROM ${qualifiedName(table)}${orderBy};`
}

function relatedSql(relation, value) {
  const column = quoteIdentifier(relation.referencedColumn)
  const filter =
    value === null || value === undefined
      ? `${column} IS NULL`
      : `${column} = ${sqlLiteral(value)}`
  return `SELECT TOP (${BROWSE_ROWS}) *\nFROM ${quoteIdentifier(relation.referencedSchema)}.${quoteIdentifier(relation.referencedTable)}\nWHERE ${filter};`
}

function sqlLiteral(value) {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `N'${String(value).replace(/'/g, "''")}'`
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
    tabs: [tab],
    activeTabId: tab.id,
    selectedTable: null,
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
  const [editorHeight, setEditorHeight] = useState(EDITOR_DEFAULT_HEIGHT)
  const [appVersion, setAppVersion] = useState('')
  const [tablePrompt, setTablePrompt] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [tableBusy, setTableBusy] = useState(false)
  const [pinnedTables, setPinnedTables] = useState([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const sqlRef = useRef(STARTER_SQL)
  const sessionsRef = useRef({})
  const activeIdRef = useRef(null)
  const seedIdRef = useRef(0)
  const tabIdRef = useRef(1)
  const splitRef = useRef(null)
  const tablesRequestRef = useRef({})

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeIdRef.current = activeConnectionId
  }, [activeConnectionId])

  const showBanner = useCallback((type, message) => {
    setBanner({ type, message })
  }, [])

  const activeSession = useCallback(() => {
    const id = activeIdRef.current
    return id ? sessionsRef.current[id] || null : null
  }, [])

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
          tabs: current.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
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
    [activateSession, loadTables, seedEditor, showBanner],
  )

  const openConnectionScreen = useCallback(() => {
    setScreen('connections')
    setBanner(null)
  }, [])

  const handleSelectDatabase = useCallback(
    async (database) => {
      const current = activeSession()
      if (!current || !database) return
      patchSession(current.connectionId, { activeDatabase: database })
      await loadTables(current.connectionId, database)
    },
    [activeSession, loadTables, patchSession],
  )

  const handleRefreshDatabases = useCallback(
    async (connectionId) => {
      const current = sessionsRef.current[connectionId]
      if (!current) return
      try {
        const databases = await api.listDatabases(connectionId)
        patchSession(connectionId, { databases })
        showBanner('success', `Refreshed databases (${databases.length}).`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [patchSession, showBanner],
  )

  const handleSelectTable = useCallback(
    (key) => {
      const current = activeSession()
      if (!current) return
      patchSession(current.connectionId, { selectedTable: key })
    },
    [activeSession, patchSession],
  )

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

      updateTab(current.connectionId, tabId, {
        state: { status: 'running', result: null, error: null },
        activeSet: 0,
      })
      try {
        const result = await api.runQuery({
          connectionId: current.connectionId,
          database: current.activeDatabase,
          sql,
        })
        updateTab(current.connectionId, tabId, { state: { status: 'success', result, error: null } })
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
    [activeSession, showBanner, updateTab],
  )

  const handleRun = useCallback(() => {
    const current = activeSession()
    if (!current) {
      showBanner('warn', 'Open a connection before running a query.')
      return
    }
    execute(sqlRef.current, current.activeTabId)
  }, [activeSession, execute, showBanner])

  const openTab = useCallback(
    (connectionId, title, sql) => {
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
              createTab(id, title, sql),
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
      const tabId = openTab(current.connectionId, relation.referencedTable, sql)
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
      const tabId = openTab(current.connectionId, table.name, sql)
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
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [showBanner],
  )

  const handleCopyStructure = useCallback(
    async (table) => {
      const current = activeSession()
      if (!current) {
        showBanner('warn', 'Open a connection before copying a structure.')
        return
      }
      if (!current.activeDatabase) {
        showBanner('warn', 'Select a database before copying a structure.')
        return
      }
      try {
        const structure = await api.tableStructure(
          current.connectionId,
          current.activeDatabase,
          table.schema,
          table.name,
        )
        await api.copyText(structure.statement)
        showBanner('success', `Copied structure of ${table.schema}.${table.name}.`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, showBanner],
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
        const tabId = openTab(current.connectionId, copyName, sql)
        patchSession(current.connectionId, { selectedTable: `${structure.schema}.${copyName}` })
        execute(sql, tabId)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeSession, execute, openTab, patchSession, showBanner],
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
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        setTableBusy(false)
      }
    },
    [activeSession, loadTables, patchSession, showBanner, tablePrompt],
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
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setTableBusy(false)
    }
  }, [activeSession, dropTarget, loadTables, patchSession, showBanner])

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
        await reloadDesign(tabId, draft.schema, draft.table)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(current.connectionId, tabId, { busy: false })
      }
    },
    [activeSession, loadTables, reloadDesign, showBanner, updateTab],
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
        await reloadDesign(tabId, draft.schema, nextName)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(current.connectionId, tabId, { busy: false })
      }
    },
    [activeSession, loadTables, reloadDesign, showBanner, updateTab],
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

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteConnection(deleteTarget.id)
      setConnections(await api.listConnections())
      if (sessionsRef.current[deleteTarget.id]) await closeSession(deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setDeleting(false)
    }
  }, [closeSession, deleteTarget, showBanner])

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

  const handleDeleteFolder = useCallback(
    async (folder) => {
      try {
        await api.deleteFolder(folder.id)
        const [nextFolders, nextConnections] = await Promise.all([
          api.listFolders(),
          api.listConnections(),
        ])
        setFolders(nextFolders)
        setConnections(nextConnections)
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
        shortcutsOpen

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

      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault()
        setDialog({ mode: 'create' })
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
    handleCloseActiveTab,
    handleCycleTab,
    handleNewTab,
    handleRun,
    handleSelectTabIndex,
    screen,
    shortcutsOpen,
    tablePrompt,
  ])

  const session = activeConnectionId ? sessions[activeConnectionId] || null : null
  const activeTab = session
    ? session.tabs.find((tab) => tab.id === session.activeTabId) || null
    : null
  const running = activeTab?.state.status === 'running'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {banner ? (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}

      {session && screen === 'workspace' ? (
        <div className="flex min-h-0 flex-1">
          <Sidebar
            sessions={Object.values(sessions)}
            activeConnectionId={activeConnectionId}
            session={session}
            activeDatabase={session.activeDatabase}
            tablesState={session.tables}
            appVersion={appVersion}
            pinnedTables={pinnedTables}
            onActivateSession={activateSession}
            onCloseSession={closeSession}
            onSelectDatabase={handleSelectDatabase}
            onBrowseTable={handleBrowseTable}
            onCopyObjectName={handleCopyObjectName}
            onCopyStructure={handleCopyStructure}
            onOpenStructure={handleOpenStructure}
            onNewTable={handleNewTable}
            onRenameTable={handleRenameTable}
            onCloneTable={handleCloneTable}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
            onTogglePin={handleTogglePin}
            onOpenConnections={openConnectionScreen}
            selectedTable={session.selectedTable}
            onSelectTable={handleSelectTable}
            onEditConnection={(connection) => setDialog({ mode: 'edit', connection })}
            onDeleteConnection={(connection) => setDeleteTarget(connection)}
            onRefreshDatabases={handleRefreshDatabases}
          />

          <main className="flex min-w-0 flex-1 flex-col bg-base">
            <WorkspaceHeader
              session={session}
              activeDatabase={session.activeDatabase}
              running={running}
              onSelectDatabase={handleSelectDatabase}
              onRun={handleRun}
              onDisconnect={() => closeSession(session.connectionId)}
              onShowShortcuts={() => setShortcutsOpen(true)}
            />

            <TabBar
              tabs={session.tabs}
              activeTabId={session.activeTabId}
              onSelect={handleSelectTab}
              onClose={handleCloseTab}
              onNewTab={handleNewTab}
            />

            {activeTab?.kind === 'design' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <TableDesigner
                  design={activeTab.design}
                  mode={activeTab.target?.mode}
                  loading={activeTab.loading}
                  error={activeTab.error}
                  busy={activeTab.busy}
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
                  <QueryEditor seed={query} onChange={handleSqlChange} onRun={handleRun} />
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
                />
              </div>
            )}

            <StatusBar
              session={session}
              activeDatabase={session.activeDatabase}
              queryStatus={activeTab?.state.status || 'idle'}
            />
          </main>
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
          onDeleteFolder={handleDeleteFolder}
          onMoveConnection={handleMoveConnection}
        />
      )}

      <ShortcutPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

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
    </div>
  )
}
