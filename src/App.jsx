import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import ConnectionDialog from './components/ConnectionDialog.jsx'
import QueryEditor from './components/QueryEditor.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import Sidebar from './components/Sidebar.jsx'
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
  return { id, kind: 'query', title, sql, state: IDLE_QUERY, activeSet: 0 }
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

function queryTitle(index) {
  return `Query ${index}`
}

const FIRST_TAB = createTab('tab-1', queryTitle(1), STARTER_SQL)

export default function App() {
  const [connections, setConnections] = useState([])
  const [session, setSession] = useState(null)
  const [activeDatabase, setActiveDatabase] = useState(null)
  const [tablesState, setTablesState] = useState(EMPTY_TABLES)
  const [tabs, setTabs] = useState([FIRST_TAB])
  const [activeTabId, setActiveTabId] = useState(FIRST_TAB.id)
  const [query, setQuery] = useState({ id: 0, value: STARTER_SQL })
  const [banner, setBanner] = useState(null)
  const [connectingId, setConnectingId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [editorHeight, setEditorHeight] = useState(EDITOR_DEFAULT_HEIGHT)
  const [appVersion, setAppVersion] = useState('')

  const sqlRef = useRef(STARTER_SQL)
  const sessionRef = useRef(null)
  const seedIdRef = useRef(0)
  const tabIdRef = useRef(1)
  const queryIdRef = useRef(1)
  const splitRef = useRef(null)
  const tablesRequestIdRef = useRef(0)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const showBanner = useCallback((type, message) => {
    setBanner({ type, message })
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
      .appInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.version)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [showBanner])

  const loadTables = useCallback(async (connectionId, database) => {
    const requestId = ++tablesRequestIdRef.current
    setTablesState({ status: 'loading', database, tables: [], error: null })
    try {
      const tables = await api.listTables(connectionId, database)
      if (requestId !== tablesRequestIdRef.current) return
      setTablesState({ status: 'ready', database, tables, error: null })
    } catch (error) {
      if (requestId !== tablesRequestIdRef.current) return
      setTablesState({ status: 'error', database, tables: [], error: error.message })
    }
  }, [])

  const closeSession = useCallback(async () => {
    const current = sessionRef.current
    sessionRef.current = null
    if (current) {
      try {
        await api.disconnect(current.connectionId)
      } catch {}
    }
    setSession(null)
    setActiveDatabase(null)
    setTablesState(EMPTY_TABLES)
  }, [])

  const handleConnect = useCallback(
    async (connection) => {
      setConnectingId(connection.id)
      setBanner(null)
      try {
        if (sessionRef.current && sessionRef.current.connectionId !== connection.id) {
          await closeSession()
        }

        const result = await api.connect({ id: connection.id })
        setSession({ ...result, connection })
        const database = pickDatabase(result.databases, result.database)
        setActiveDatabase(database)
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
    [closeSession, loadTables, showBanner],
  )

  const handleSelectDatabase = useCallback(
    async (database) => {
      if (!sessionRef.current || !database) return
      setActiveDatabase(database)
      await loadTables(sessionRef.current.connectionId, database)
    },
    [loadTables],
  )

  const handleRefreshDatabases = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      const databases = await api.listDatabases(current.connectionId)
      setSession((prev) => (prev ? { ...prev, databases } : prev))
      showBanner('success', `Refreshed databases (${databases.length}).`)
    } catch (error) {
      showBanner('error', error.message)
    }
  }, [showBanner])

  const updateTab = useCallback((tabId, patch) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)))
  }, [])

  const execute = useCallback(
    async (sql, tabId) => {
      const current = sessionRef.current
      if (!current) {
        showBanner('warn', 'Open a connection before running a query.')
        return
      }
      if (!activeDatabase) {
        showBanner('warn', 'Select a database before running a query.')
        return
      }

      updateTab(tabId, { state: { status: 'running', result: null, error: null }, activeSet: 0 })
      try {
        const result = await api.runQuery({
          connectionId: current.connectionId,
          database: activeDatabase,
          sql,
        })
        updateTab(tabId, { state: { status: 'success', result, error: null } })
      } catch (error) {
        updateTab(tabId, {
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
    [activeDatabase, showBanner, updateTab],
  )

  const handleRun = useCallback(() => execute(sqlRef.current, activeTabId), [activeTabId, execute])

  const seedEditor = useCallback((sql) => {
    seedIdRef.current += 1
    sqlRef.current = sql
    setQuery({ id: seedIdRef.current, value: sql })
  }, [])

  const openTab = useCallback(
    (title, sql) => {
      tabIdRef.current += 1
      const id = `tab-${tabIdRef.current}`
      const liveSql = sqlRef.current
      setTabs((prev) => [
        ...prev.map((tab) => (tab.id === activeTabId ? { ...tab, sql: liveSql } : tab)),
        createTab(id, title, sql),
      ])
      setActiveTabId(id)
      seedEditor(sql)
      return id
    },
    [activeTabId, seedEditor],
  )

  const handleBrowseTable = useCallback(
    (table) => {
      const sql = browseSql(table)
      const tabId = openTab(table.name, sql)
      execute(sql, tabId)
    },
    [execute, openTab],
  )

  const handleQueryTable = useCallback(
    (table) => {
      const sql = `SELECT TOP (1000) *\nFROM ${qualifiedName(table)};`
      updateTab(activeTabId, { sql })
      seedEditor(sql)
    },
    [activeTabId, seedEditor, updateTab],
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
      const current = sessionRef.current
      if (!current) {
        showBanner('warn', 'Open a connection before copying a structure.')
        return
      }
      if (!activeDatabase) {
        showBanner('warn', 'Select a database before copying a structure.')
        return
      }
      try {
        const structure = await api.tableStructure(
          current.connectionId,
          activeDatabase,
          table.schema,
          table.name,
        )
        await api.copyText(structure.statement)
        showBanner('success', `Copied structure of ${table.schema}.${table.name}.`)
      } catch (error) {
        showBanner('error', error.message)
      }
    },
    [activeDatabase, showBanner],
  )

  const openDesignTab = useCallback(
    (title, target) => {
      tabIdRef.current += 1
      const id = `tab-${tabIdRef.current}`
      const liveSql = sqlRef.current
      setTabs((prev) => [
        ...prev.map((tab) => (tab.id === activeTabId ? { ...tab, sql: liveSql } : tab)),
        createDesignTab(id, title, target),
      ])
      setActiveTabId(id)
      return id
    },
    [activeTabId],
  )

  const reloadDesign = useCallback(
    async (tabId, schema, table) => {
      const current = sessionRef.current
      if (!current || !activeDatabase) return
      const structure = await api.tableStructure(current.connectionId, activeDatabase, schema, table)
      updateTab(tabId, {
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
    [activeDatabase, updateTab],
  )

  const handleOpenStructure = useCallback(
    async (table) => {
      const current = sessionRef.current
      if (!current) {
        showBanner('warn', 'Open a connection before opening a structure.')
        return
      }
      if (!activeDatabase) {
        showBanner('warn', 'Select a database before opening a structure.')
        return
      }

      const tabId = openDesignTab(`Design ${table.name}`, {
        mode: 'edit',
        schema: table.schema,
        table: table.name,
      })

      try {
        await reloadDesign(tabId, table.schema, table.name)
      } catch (error) {
        updateTab(tabId, { loading: false, error: error.message })
      }
    },
    [activeDatabase, openDesignTab, reloadDesign, showBanner, updateTab],
  )

  const handleNewTable = useCallback(
    (table) => {
      const current = sessionRef.current
      if (!current) {
        showBanner('warn', 'Open a connection before creating a table.')
        return
      }

      const tabId = openDesignTab('New table', {
        mode: 'new',
        schema: table?.schema || 'dbo',
        table: '',
      })

      updateTab(tabId, {
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
    [openDesignTab, showBanner, updateTab],
  )

  const handleDesignGenerate = useCallback(
    (sql) => {
      openTab('Generated SQL', sql)
    },
    [openTab],
  )

  const handleDesignApply = useCallback(
    async (tabId, sql, draft) => {
      const current = sessionRef.current
      if (!current) {
        showBanner('warn', 'Open a connection before applying changes.')
        return
      }
      if (!activeDatabase) {
        showBanner('warn', 'Select a database before applying changes.')
        return
      }

      updateTab(tabId, { busy: true })
      try {
        await api.runQuery({ connectionId: current.connectionId, database: activeDatabase, sql })
        showBanner('success', 'Structure applied.')
        await loadTables(current.connectionId, activeDatabase)
        await reloadDesign(tabId, draft.schema, draft.table)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(tabId, { busy: false })
      }
    },
    [activeDatabase, loadTables, reloadDesign, showBanner, updateTab],
  )

  const handleDesignRename = useCallback(
    async (tabId, draft, nextName) => {
      const current = sessionRef.current
      if (!current || !activeDatabase) return
      if (!nextName || nextName === draft.table) return

      updateTab(tabId, { busy: true })
      try {
        await api.runQuery({
          connectionId: current.connectionId,
          database: activeDatabase,
          sql: `EXEC sp_rename N'${quoteIdentifier(draft.schema)}.${quoteIdentifier(draft.table)}', N'${nextName.replace(/'/g, "''")}';`,
        })
        showBanner('success', `Renamed table to ${nextName}.`)
        await loadTables(current.connectionId, activeDatabase)
        await reloadDesign(tabId, draft.schema, nextName)
      } catch (error) {
        showBanner('error', error.message)
      } finally {
        updateTab(tabId, { busy: false })
      }
    },
    [activeDatabase, loadTables, reloadDesign, showBanner, updateTab],
  )

  const handleSqlChange = useCallback((value) => {
    sqlRef.current = value
  }, [])

  const handleSelectTab = useCallback(
    (tabId) => {
      if (tabId === activeTabId) return
      const next = tabs.find((tab) => tab.id === tabId)
      if (!next) return
      const liveSql = sqlRef.current
      setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, sql: liveSql } : tab)))
      setActiveTabId(tabId)
      seedEditor(next.sql)
    },
    [activeTabId, seedEditor, tabs],
  )

  const handleCloseTab = useCallback(
    (tabId) => {
      const index = tabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return

      const remaining = tabs.filter((tab) => tab.id !== tabId)

      if (remaining.length === 0) {
        queryIdRef.current += 1
        tabIdRef.current += 1
        const tab = createTab(`tab-${tabIdRef.current}`, queryTitle(queryIdRef.current), '')
        setTabs([tab])
        setActiveTabId(tab.id)
        seedEditor(tab.sql)
        return
      }

      setTabs(remaining)

      if (tabId === activeTabId) {
        const neighbour = remaining[Math.min(index, remaining.length - 1)]
        setActiveTabId(neighbour.id)
        seedEditor(neighbour.sql)
      }
    },
    [activeTabId, seedEditor, tabs],
  )

  const handleNewTab = useCallback(() => {
    queryIdRef.current += 1
    openTab(queryTitle(queryIdRef.current), '')
  }, [openTab])

  const handleSelectSet = useCallback(
    (index) => updateTab(activeTabId, { activeSet: index }),
    [activeTabId, updateTab],
  )

  const handleSaveConnection = useCallback(
    async (input) => {
      const saved = await api.saveConnection(input)
      setConnections(await api.listConnections())
      setDialog(null)

      const current = sessionRef.current
      if (!current || current.connectionId !== saved.id) return

      const reconnectKeys = ['host', 'port', 'username', 'database', 'encrypt', 'trustServerCertificate', 'hasPassword']
      const needsReconnect = reconnectKeys.some(
        (key) => (current.connection?.[key] ?? null) !== (saved[key] ?? null),
      )

      if (needsReconnect) {
        await closeSession()
        showBanner('info', 'Connection settings changed — reconnect to apply them.')
      } else {
        setSession((prev) =>
          prev && prev.connectionId === saved.id
            ? { ...prev, name: saved.name, connection: saved }
            : prev,
        )
      }
    },
    [closeSession, showBanner],
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteConnection(deleteTarget.id)
      setConnections(await api.listConnections())
      if (sessionRef.current?.connectionId === deleteTarget.id) await closeSession()
      setDeleteTarget(null)
    } catch (error) {
      showBanner('error', error.message)
    } finally {
      setDeleting(false)
    }
  }, [closeSession, deleteTarget, showBanner])

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

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const running = activeTab.state.status === 'running'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {banner ? (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          connections={connections}
          session={session}
          connectingId={connectingId}
          activeDatabase={activeDatabase}
          tablesState={tablesState}
          appVersion={appVersion}
          onConnect={handleConnect}
          onSelectDatabase={handleSelectDatabase}
          onBrowseTable={handleBrowseTable}
          onQueryTable={handleQueryTable}
          onCopyObjectName={handleCopyObjectName}
          onCopyStructure={handleCopyStructure}
          onOpenStructure={handleOpenStructure}
          onNewTable={handleNewTable}
          onNewConnection={() => setDialog({ mode: 'create' })}
          onEditConnection={(connection) => setDialog({ mode: 'edit', connection })}
          onDeleteConnection={(connection) => setDeleteTarget(connection)}
          onRefreshDatabases={handleRefreshDatabases}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-base">
          <WorkspaceHeader
            session={session}
            activeDatabase={activeDatabase}
            running={running}
            onSelectDatabase={handleSelectDatabase}
            onRun={handleRun}
            onDisconnect={closeSession}
          />

          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
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
                onRenameTable={(nextName) => handleDesignRename(activeTab.id, activeTab.design, nextName)}
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
                key={activeTab.id}
                state={activeTab.state}
                activeSet={activeTab.activeSet}
                onSelectSet={handleSelectSet}
              />
            </div>
          )}

          <StatusBar session={session} activeDatabase={activeDatabase} queryStatus={activeTab.state.status} />
        </main>
      </div>

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
