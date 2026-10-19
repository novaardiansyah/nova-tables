import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import ConnectionDialog from './components/ConnectionDialog.jsx'
import QueryEditor from './components/QueryEditor.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import Sidebar from './components/Sidebar.jsx'
import StatusBar from './components/StatusBar.jsx'
import WorkspaceHeader from './components/WorkspaceHeader.jsx'

const STARTER_SQL = `-- Nova Tables
-- Pick a table in the sidebar or write a query, then press Ctrl+Enter to run it.

SELECT TOP (100) *
FROM sys.databases;
`

const EMPTY_TABLES = { status: 'idle', database: null, tables: [], error: null }
const IDLE_QUERY = { status: 'idle', result: null, error: null }
const EDITOR_DEFAULT_HEIGHT = 320

function pickDatabase(databases, configured) {
  const names = databases.map((database) => database.name)
  if (configured && names.includes(configured)) return configured
  const online = databases.find((database) => !database.isSystem && database.isOnline)
  return online?.name || names[0] || configured || 'master'
}

function quoteIdentifier(name) {
  return `[${String(name).replace(/]/g, ']]')}]`
}

export default function App() {
  const [connections, setConnections] = useState([])
  const [session, setSession] = useState(null)
  const [activeDatabase, setActiveDatabase] = useState(null)
  const [tablesState, setTablesState] = useState(EMPTY_TABLES)
  const [query, setQuery] = useState({ id: 0, value: STARTER_SQL })
  const [queryState, setQueryState] = useState(IDLE_QUERY)
  const [activeSet, setActiveSet] = useState(0)
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
    // Only the newest request may write to the tree, otherwise a slow answer
    // for a database the user already left would replace the current one.
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
      } catch {
        // Closing a connection is best-effort.
      }
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
        // Only one connection is open at a time, so release the previous one.
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

  const handleRun = useCallback(async () => {
    const current = sessionRef.current
    if (!current) {
      showBanner('warn', 'Open a connection before running a query.')
      return
    }
    if (!activeDatabase) {
      showBanner('warn', 'Select a database before running a query.')
      return
    }

    setQueryState({ status: 'running', result: null, error: null })
    setActiveSet(0)
    try {
      const result = await api.runQuery({
        connectionId: current.connectionId,
        database: activeDatabase,
        sql: sqlRef.current,
      })
      setQueryState({ status: 'success', result, error: null })
    } catch (error) {
      setQueryState({
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
      })
    }
  }, [activeDatabase, showBanner])

  const handleQueryTable = useCallback((table) => {
    seedIdRef.current += 1
    const sql = `SELECT TOP (1000) *\nFROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)};`
    sqlRef.current = sql
    setQuery({ id: seedIdRef.current, value: sql })
  }, [])

  const handleSqlChange = useCallback((value) => {
    sqlRef.current = value
  }, [])

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

  const running = queryState.status === 'running'

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
          onQueryTable={handleQueryTable}
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

            <ResultsPanel state={queryState} activeSet={activeSet} onSelectSet={setActiveSet} />
          </div>

          <StatusBar session={session} activeDatabase={activeDatabase} queryStatus={queryState.status} />
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
