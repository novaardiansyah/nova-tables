import { useState } from 'react'
import ContextMenu from './ContextMenu.jsx'
import Icon, { BrandMark, Spinner } from './Icon.jsx'

export default function Sidebar({
  sessions,
  activeConnectionId,
  appVersion,
  pinnedTables,
  onActivateSession,
  onCloseSession,
  onBrowseTable,
  onCopyObjectName,
  onCopyStructure,
  onRefreshDatabases,
  onOpenStructure,
  onOpenModule,
  onCopyModuleDefinition,
  onNewFunction,
  onNewTable,
  onRenameTable,
  onCloneTable,
  onTruncateTable,
  onDropTable,
  onTogglePin,
  onOpenConnections,
  selectedTable,
  onSelectTable,
  selectedModule,
  onSelectModule,
}) {
  const [expanded, setExpanded] = useState(true)
  const [collapsed, setCollapsed] = useState({})
  const [menu, setMenu] = useState(null)

  const handleTableContextMenu = (event, table) => {
    event.preventDefault()
    onSelectTable(`${table.schema}.${table.name}`)
    setMenu({ x: event.clientX, y: event.clientY, kind: 'table', table })
  }

  const handleModuleContextMenu = (event, module) => {
    event.preventDefault()
    onSelectModule(`${module.schema}.${module.name}`)
    setMenu({ x: event.clientX, y: event.clientY, kind: 'module', module })
  }

  const pinned = new Set(pinnedTables)

  const renderTable = (table) => {
    const key = `${table.schema}.${table.name}`
    return (
      <div
        key={key}
        onDoubleClick={() => onBrowseTable(table)}
        onContextMenu={(event) => handleTableContextMenu(event, table)}
        className="group/table flex items-center gap-1.5 rounded px-2 py-[3px] text-[length:var(--app-text-12)] text-text hover:bg-tint/[0.04]"
      >
        <Icon name="table" size={11} className="shrink-0 text-text-faint" />
        <button
          type="button"
          onClick={() => onSelectTable(key)}
          className={`flex min-w-0 flex-1 items-center truncate text-left ${
            selectedTable === key ? 'text-accent' : ''
          }`}
          title={`${table.schema}.${table.name}`}
        >
          {table.schema !== 'dbo' ? <span className="text-text-faint">{table.schema}.</span> : null}
          <span className="truncate">{table.name}</span>
        </button>
        <button
          type="button"
          className={`icon-btn h-5 w-5 shrink-0 ${
            pinned.has(key) ? 'text-accent' : 'opacity-0 group-hover/table:opacity-100'
          }`}
          title={pinned.has(key) ? 'Unpin from top' : 'Pin to top'}
          onClick={() => onTogglePin(table)}
        >
          <Icon name="pin" size={10} />
        </button>
      </div>
    )
  }

  const renderModule = (module) => {
    const key = `${module.schema}.${module.name}`
    return (
      <div
        key={key}
        onDoubleClick={() => onOpenModule(module)}
        onContextMenu={(event) => handleModuleContextMenu(event, module)}
        className="group/module flex items-center gap-1.5 rounded px-2 py-[3px] text-[length:var(--app-text-12)] text-text hover:bg-tint/[0.04]"
      >
        <Icon
          name={module.type === 'function' ? 'function' : 'procedure'}
          size={11}
          className="shrink-0 text-text-faint"
        />
        <button
          type="button"
          onClick={() => onSelectModule(key)}
          className={`flex min-w-0 flex-1 items-center truncate text-left ${
            selectedModule === key ? 'text-accent' : ''
          }`}
          title={`${module.schema}.${module.name}`}
        >
          {module.schema !== 'dbo' ? <span className="text-text-faint">{module.schema}.</span> : null}
          <span className="truncate">{module.name}</span>
        </button>
        <span className="shrink-0 text-[length:var(--app-text-9)] uppercase tracking-wider text-text-faint">
          {module.type === 'function' ? 'fn' : 'sp'}
        </span>
      </div>
    )
  }

  const orderedTablesFor = (tables) =>
    tables
      .map((table, index) => ({ table, index }))
      .sort((left, right) => {
        const leftRank = pinned.has(`${left.table.schema}.${left.table.name}`) ? 0 : 1
        const rightRank = pinned.has(`${right.table.schema}.${right.table.name}`) ? 0 : 1
        return leftRank - rightRank || left.index - right.index
      })
      .map((entry) => entry.table)

  const renderGroup = (item, group) => {
    const key = `${item.connectionId}:${group}`
    const isOpen = !collapsed[key]
    const state = group === 'tables' ? item.tables : item.modules
    const items = group === 'tables' ? state.tables : state.modules
    const count = state.status === 'ready' ? items.length : null

    return (
      <div key={group}>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
          className="tree-row"
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          <Icon
            name="chevron-right"
            size={11}
            className={`shrink-0 text-text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
          <Icon
            name={group === 'tables' ? 'table' : 'code'}
            size={12}
            className="shrink-0 text-text-muted"
          />
          <span className="truncate">{group === 'tables' ? 'Tables' : 'Procedures & functions'}</span>
          {count !== null ? (
            <span className="ml-auto tabular-nums text-[length:var(--app-text-10)] text-text-faint">{count}</span>
          ) : null}
        </button>

        {isOpen ? (
          <div className="ml-3 space-y-px border-l border-line pl-1.5">
            {state.status === 'loading' ? (
              <div className="flex items-center gap-2 px-2 py-1 text-[length:var(--app-text-11)] text-text-muted">
                <Spinner size={11} />
                {group === 'tables' ? 'Loading tables…' : 'Loading routines…'}
              </div>
            ) : null}

            {state.status === 'error' ? (
              <p className="px-2 py-1 text-[length:var(--app-text-11)] leading-[calc(var(--app-text-12)+4px)] text-text-danger">
                {state.error}
              </p>
            ) : null}

            {state.status === 'ready' && items.length === 0 ? (
              <p className="px-2 py-1 text-[length:var(--app-text-11)] text-text-faint">
                No {group === 'tables' ? 'tables' : 'routines'}
              </p>
            ) : null}

            {state.status === 'ready' ? (
              group === 'tables' ? (
                orderedTablesFor(items).map(renderTable)
              ) : (
                items.map(renderModule)
              )
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const renderSession = (item) => {
    const isActive = item.connectionId === activeConnectionId

    return (
      <div key={item.connectionId} className="mb-1">
        <div
          className={`group relative flex items-center gap-1.5 rounded-md pr-1 ${
            isActive ? 'bg-accent-soft' : 'hover:bg-tint/[0.03]'
          }`}
        >
          <button
            type="button"
            onClick={() => (isActive ? setExpanded((value) => !value) : onActivateSession(item.connectionId))}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left"
            title={isActive ? `Collapse ${item.connection.name}` : `Switch to ${item.connection.name}`}
          >
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                isActive ? 'bg-success shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-line-strong'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-[length:var(--app-text-12)] font-medium ${
                  isActive ? 'text-text-strong' : 'text-text-soft'
                }`}
              >
                {item.connection.name}
              </span>
              <span className="block truncate text-[length:var(--app-text-10)] leading-[calc(var(--app-text-12)+4px)] text-text-muted">
                {item.connection.host}:{item.connection.port}
                {item.activeDatabase ? ` · ${item.activeDatabase}` : ''}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              className="icon-btn h-6 w-6"
              title="Refresh databases"
              onClick={() => onRefreshDatabases(item.connectionId)}
            >
              <Icon name="refresh" size={13} />
            </button>
            <button
              type="button"
              className="icon-btn h-6 w-6"
              title="Close connection"
              onClick={() => onCloseSession(item.connectionId)}
            >
              <Icon name="power" size={13} />
            </button>
          </div>
        </div>

        {isActive ? (
          expanded ? (
            <div className="mt-0.5 space-y-px pl-3">
              {renderGroup(item, 'tables')}
              {renderGroup(item, 'modules')}
            </div>
          ) : null
        ) : (
          <p className="mt-0.5 truncate px-2 py-1 pl-4 text-[length:var(--app-text-10)] font-semibold uppercase tracking-wider text-text-faint">
            {item.databases.length} {item.databases.length === 1 ? 'database' : 'databases'}
          </p>
        )}
      </div>
    )
  }

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <BrandMark size={20} />
        <span className="text-[length:var(--app-text-13)] font-semibold tracking-tight text-text-strong">Nova Tables</span>
        <span className="ml-auto rounded border border-line-strong bg-tint/[0.03] px-1.5 py-0.5 text-[length:var(--app-text-9)] font-semibold uppercase tracking-wider text-text-muted">
          MSSQL
        </span>
      </div>

      <div className="space-y-1.5 p-3">
        <button type="button" className="btn-soft w-full" onClick={onOpenConnections}>
          <Icon name="server" size={14} />
          Add Connection
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 ? (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-line-strong px-3 py-6 text-center">
            <Icon name="server" size={18} className="mx-auto mb-2 text-text-faint" />
            <p className="text-[length:var(--app-text-12)] text-text-muted">No connection open</p>
            <p className="mt-1 text-[length:var(--app-text-11)] text-text-faint">Pick one to browse its databases.</p>
          </div>
        ) : (
          sessions.map(renderSession)
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-4 text-[length:var(--app-text-10)] text-text-faint">
        <span>Microsoft SQL Server</span>
        <span>{appVersion ? `v${appVersion}` : ''}</span>
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === 'module'
              ? [
                  {
                    id: 'open-new-tab',
                    label: 'Open new tab',
                    onSelect: () => onOpenModule(menu.module),
                  },
                  {
                    id: 'copy-object-name',
                    label: 'Copy object name',
                    onSelect: () => onCopyObjectName(menu.module),
                  },
                  {
                    id: 'copy-module-definition',
                    label: 'Copy definition',
                    onSelect: () => onCopyModuleDefinition(menu.module),
                  },
                  {
                    id: 'new-function',
                    label: 'New function',
                    onSelect: () => onNewFunction(),
                  },
                ]
              : [
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
                  {
                    id: 'open-structure',
                    label: 'Open structure',
                    onSelect: () => onOpenStructure(menu.table),
                  },
                  {
                    id: 'new-table',
                    label: 'New table',
                    onSelect: () => onNewTable(menu.table),
                  },
                  {
                    id: 'rename',
                    label: 'Rename',
                    onSelect: () => onRenameTable(menu.table),
                  },
                  {
                    id: 'clone',
                    label: 'Clone',
                    onSelect: () => onCloneTable(menu.table),
                  },
                  {
                    id: 'pin-to-top',
                    label: pinnedTables.includes(`${menu.table.schema}.${menu.table.name}`)
                      ? 'Unpin from top'
                      : 'Pin to top',
                    onSelect: () => onTogglePin(menu.table),
                  },
                  {
                    id: 'truncate',
                    label: 'Truncate',
                    onSelect: () => onTruncateTable(menu.table),
                  },
                  {
                    id: 'drop-table',
                    label: 'Drop Table',
                    onSelect: () => onDropTable(menu.table),
                  },
                ]
          }
          onClose={() => setMenu(null)}
        />
      ) : null}
    </aside>
  )
}
