import { useEffect, useState } from 'react'
import ContextMenu from './ContextMenu.jsx'
import Icon, { BrandMark, Spinner } from './Icon.jsx'

const TABLE_MENU_ITEMS = [
  'Open structure',
  'Rename',
  'New table',
  'Pin to top',
  'Clone',
  'Truncate',
  'Delete',
]

export default function Sidebar({
  connections,
  session,
  connectingId,
  activeDatabase,
  tablesState,
  appVersion,
  onConnect,
  onSelectDatabase,
  onBrowseTable,
  onQueryTable,
  onCopyObjectName,
  onCopyStructure,
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  onRefreshDatabases,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [expandedDatabase, setExpandedDatabase] = useState(null)
  const [selectedTable, setSelectedTable] = useState(null)
  const [menu, setMenu] = useState(null)

  useEffect(() => {
    if (session?.connectionId) setExpandedId(session.connectionId)
  }, [session?.connectionId])

  useEffect(() => {
    if (activeDatabase) setExpandedDatabase(activeDatabase)
  }, [activeDatabase])

  const handleConnectionClick = (connection) => {
    const isConnected = session?.connectionId === connection.id
    if (isConnected) {
      setExpandedId((prev) => (prev === connection.id ? null : connection.id))
    } else {
      onConnect(connection)
    }
  }

  const handleDatabaseClick = (name) => {
    const isOpen = expandedDatabase === name
    setExpandedDatabase(isOpen ? null : name)
    onSelectDatabase(name)
  }

  const handleTableContextMenu = (event, table) => {
    event.preventDefault()
    setSelectedTable(`${table.schema}.${table.name}`)
    setMenu({ x: event.clientX, y: event.clientY, table })
  }

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <BrandMark size={20} />
        <span className="text-[13px] font-semibold tracking-tight text-slate-100">Nova Tables</span>
        <span className="ml-auto rounded border border-line-strong bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
          MSSQL
        </span>
      </div>

      <div className="p-3">
        <button type="button" className="btn-soft w-full" onClick={onNewConnection}>
          <Icon name="plus" size={14} />
          New connection
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Connections</span>
        <span className="text-[10px] text-slate-600">{connections.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {connections.length === 0 ? (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-line-strong px-3 py-6 text-center">
            <Icon name="server" size={18} className="mx-auto mb-2 text-slate-600" />
            <p className="text-[12px] text-slate-500">No saved connections</p>
            <p className="mt-1 text-[11px] text-slate-600">Create one to browse your databases.</p>
          </div>
        ) : (
          connections.map((connection) => {
            const isConnected = session?.connectionId === connection.id
            const isExpanded = expandedId === connection.id
            const isConnecting = connectingId === connection.id

            return (
              <div key={connection.id} className="mb-0.5">
                <div
                  className={`group relative flex items-center gap-1.5 rounded-md pr-1 transition-colors ${
                    isConnected ? 'bg-accent-soft' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleConnectionClick(connection)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left"
                    title={
                      isConnected
                        ? `${connection.name} — click to expand`
                        : `Connect to ${connection.name} (${connection.host}:${connection.port})`
                    }
                  >
                    {isConnecting ? (
                      <Spinner size={12} className="shrink-0 text-accent" />
                    ) : (
                      <span
                        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                          isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-slate-700'
                        }`}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[12.5px] ${
                          isConnected ? 'font-medium text-slate-100' : 'text-slate-300'
                        }`}
                      >
                        {connection.name}
                      </span>
                      <span className="block truncate text-[10.5px] leading-4 text-slate-600">
                        {connection.host}:{connection.port}
                        {connection.database ? ` · ${connection.database}` : ''}
                      </span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    {isConnected ? (
                      <button
                        type="button"
                        className="icon-btn h-6 w-6"
                        title="Refresh databases"
                        onClick={() => onRefreshDatabases(connection)}
                      >
                        <Icon name="refresh" size={13} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-btn h-6 w-6"
                      title="Edit connection"
                      onClick={() => onEditConnection(connection)}
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn h-6 w-6 hover:text-rose-400"
                      title="Delete connection"
                      onClick={() => onDeleteConnection(connection)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>

                {isExpanded && isConnected ? (
                  <div className="mt-0.5 space-y-px pl-3">
                    {session.databases.length === 0 ? (
                      <p className="px-2 py-1 text-[11px] text-slate-600">No databases visible</p>
                    ) : (
                      session.databases.map((database) => {
                        const isOpen = expandedDatabase === database.name
                        const isActive = activeDatabase === database.name
                        const showTables = isOpen && tablesState.database === database.name

                        return (
                          <div key={database.name}>
                            <button
                              type="button"
                              onClick={() => handleDatabaseClick(database.name)}
                              className={`tree-row ${isActive ? 'tree-row-active' : ''}`}
                              title={database.isOnline ? database.name : `${database.name} (offline)`}
                            >
                              <Icon
                                name="chevron-right"
                                size={11}
                                className={`shrink-0 text-slate-600 transition-transform ${
                                  isOpen ? 'rotate-90' : ''
                                }`}
                              />
                              <Icon name="database" size={12} className="shrink-0 text-slate-500" />
                              <span className="truncate">{database.name}</span>
                              {!database.isOnline ? (
                                <span className="ml-auto rounded bg-amber-500/15 px-1 text-[9.5px] font-medium uppercase text-amber-400">
                                  offline
                                </span>
                              ) : null}
                            </button>

                            {showTables ? (
                              <div className="ml-3 space-y-px border-l border-line pl-1.5">
                                {tablesState.status === 'loading' ? (
                                  <div className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-slate-500">
                                    <Spinner size={11} />
                                    Loading tables…
                                  </div>
                                ) : null}

                                {tablesState.status === 'error' ? (
                                  <div className="px-2 py-1 text-[11.5px] leading-4 text-rose-400">
                                    {tablesState.error}
                                  </div>
                                ) : null}

                                {tablesState.status === 'ready' && tablesState.tables.length === 0 ? (
                                  <p className="px-2 py-1 text-[11.5px] text-slate-600">No tables</p>
                                ) : null}

                                {tablesState.status === 'ready'
                                  ? tablesState.tables.map((table) => {
                                      const key = `${table.schema}.${table.name}`
                                      return (
                                        <div
                                          key={key}
                                          onDoubleClick={() => onBrowseTable(table)}
                                          onContextMenu={(event) => handleTableContextMenu(event, table)}
                                          className="group/table flex items-center gap-1.5 rounded px-2 py-[3px] text-[12px] text-slate-400 hover:bg-white/[0.04]"
                                        >
                                          <Icon name="table" size={11} className="shrink-0 text-slate-600" />
                                          <button
                                            type="button"
                                            onClick={() => setSelectedTable(key)}
                                            className={`flex min-w-0 flex-1 items-center truncate text-left ${
                                              selectedTable === key ? 'text-accent' : ''
                                            }`}
                                            title={`${table.schema}.${table.name}`}
                                          >
                                            {table.schema !== 'dbo' ? (
                                              <span className="text-slate-600">{table.schema}.</span>
                                            ) : null}
                                            <span className="truncate">{table.name}</span>
                                          </button>
                                          <button
                                            type="button"
                                            className="icon-btn h-5 w-5 opacity-0 group-hover/table:opacity-100"
                                            title="Load into editor"
                                            onClick={() => onQueryTable(table)}
                                          >
                                            <Icon name="play" size={10} />
                                          </button>
                                        </div>
                                      )
                                    })
                                  : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-4 text-[10.5px] text-slate-600">
        <span>Microsoft SQL Server</span>
        <span>{appVersion ? `v${appVersion}` : ''}</span>
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: 'open-new-tab',
              label: 'Open new tab',
              onSelect: () => onBrowseTable(menu.table),
            },
            {
              id: 'copy-object-name',
              label: 'Copy object name',
              onSelect: () => onCopyObjectName(menu.table),
            },
            {
              id: 'copy-structure',
              label: 'Copy structure',
              onSelect: () => onCopyStructure(menu.table),
            },
            ...TABLE_MENU_ITEMS.map((label) => ({ id: label, label })),
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </aside>
  )
}
