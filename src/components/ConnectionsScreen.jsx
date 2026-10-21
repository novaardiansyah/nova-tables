import { useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import ContextMenu from './ContextMenu.jsx'
import Icon, { BrandMark, Spinner } from './Icon.jsx'
import PromptDialog from './PromptDialog.jsx'

function byName(left, right) {
  return String(left.name).localeCompare(String(right.name))
}

function folderTree(folders, parentId = null, depth = 0, result = []) {
  const children = folders.filter((folder) => (folder.parentId ?? null) === parentId).sort(byName)
  for (const folder of children) {
    result.push({ folder, depth })
    folderTree(folders, folder.id, depth + 1, result)
  }
  return result
}

export default function ConnectionsScreen({
  connections,
  folders,
  openIds,
  connectingId,
  appVersion,
  onOpen,
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveConnection,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [prompt, setPrompt] = useState(null)
  const [promptBusy, setPromptBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [menu, setMenu] = useState(null)

  const flatFolders = useMemo(() => folderTree(folders), [folders])

  const toggleFolder = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreatePrompt = (parentId = null) => {
    const parent = folders.find((folder) => folder.id === parentId)
    setPrompt({ mode: 'create', parentId, parentName: parent?.name ?? null })
  }

  const openMoveMenu = (event, connection) => {
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    setMenu({
      x: bounds.left,
      y: bounds.bottom + 4,
      connection,
    })
  }

  const handlePromptConfirm = async (value) => {
    setPromptBusy(true)
    try {
      if (prompt.mode === 'rename') await onRenameFolder(prompt.folder, value)
      else await onCreateFolder(value, prompt.parentId)
      setPrompt(null)
    } finally {
      setPromptBusy(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    try {
      await onDeleteFolder(deleteTarget)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const renderConnection = (connection, depth) => {
    const isConnecting = connectingId === connection.id
    const isOpen = openIds.includes(connection.id)

    return (
      <div
        key={connection.id}
        style={{ marginLeft: depth * 14 }}
        className="group/conn flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-tint/[0.04]"
      >
        <button
          type="button"
          disabled={isConnecting}
          onClick={() => onOpen(connection)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-70"
          title={isOpen ? `Switch to ${connection.name}` : `Connect to ${connection.name} (${connection.host}:${connection.port})`}
        >
          {isConnecting ? (
            <Spinner size={12} className="shrink-0 text-accent" />
          ) : (
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                isOpen ? 'bg-success shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-line-strong'
              }`}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[length:var(--app-text-12)] text-text">{connection.name}</span>
              {isOpen ? (
                <span className="shrink-0 rounded border border-success/30 bg-success/10 px-1 text-[length:var(--app-text-9)] font-semibold uppercase tracking-wide text-success">
                  open
                </span>
              ) : null}
            </span>
            <span className="block truncate text-[length:var(--app-text-10)] leading-[calc(var(--app-text-12)+4px)] text-text-faint">
              {connection.host}:{connection.port}
              {connection.database ? ` · ${connection.database}` : ''}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/conn:opacity-100">
          <button
            type="button"
            className="icon-btn h-6 w-6"
            title="Move to folder"
            onClick={(event) => openMoveMenu(event, connection)}
          >
            <Icon name="folder" size={12} />
          </button>
          <button
            type="button"
            className="icon-btn h-6 w-6"
            title="Edit connection"
            onClick={() => onEditConnection(connection)}
          >
            <Icon name="pencil" size={12} />
          </button>
          <button
            type="button"
            className="icon-btn h-6 w-6 hover:text-danger"
            title="Delete connection"
            onClick={() => onDeleteConnection(connection)}
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>
    )
  }

  const renderFolder = (folder, depth) => {
    const isOpen = !collapsed.has(folder.id)
    const childFolders = folders.filter((item) => item.parentId === folder.id).sort(byName)
    const childConnections = connections.filter((item) => item.folderId === folder.id).sort(byName)
    const childCount = childFolders.length + childConnections.length

    return (
      <div key={folder.id}>
        <div
          style={{ marginLeft: depth * 14 }}
          className="group/folder flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-tint/[0.03]"
        >
          <button
            type="button"
            onClick={() => toggleFolder(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={isOpen ? 'Collapse folder' : 'Expand folder'}
          >
            <Icon
              name="chevron-right"
              size={11}
              className={`shrink-0 text-text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
            <Icon name="folder" size={13} className="shrink-0 text-warning/70" />
            <span className="truncate text-[length:var(--app-text-12)] font-medium text-text">{folder.name}</span>
            <span className="shrink-0 text-[length:var(--app-text-10)] tabular-nums text-text-faint">{childCount}</span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100">
            <button
              type="button"
              className="icon-btn h-6 w-6"
              title="New subfolder"
              onClick={() => openCreatePrompt(folder.id)}
            >
              <Icon name="plus" size={12} />
            </button>
            <button
              type="button"
              className="icon-btn h-6 w-6"
              title="Rename folder"
              onClick={() => setPrompt({ mode: 'rename', folder })}
            >
              <Icon name="pencil" size={12} />
            </button>
            <button
              type="button"
              className="icon-btn h-6 w-6 hover:text-danger"
              title="Delete folder"
              onClick={() => setDeleteTarget(folder)}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>

        {isOpen ? (
          <div className="space-y-px">
            {childConnections.map((connection) => renderConnection(connection, depth + 1))}
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childCount === 0 ? (
              <p
                style={{ marginLeft: (depth + 1) * 14 }}
                className="px-2 py-1 text-[length:var(--app-text-11)] text-text-faint"
              >
                Empty folder
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const rootFolders = folders.filter((folder) => (folder.parentId ?? null) === null).sort(byName)
  const rootConnections = connections.filter((connection) => (connection.folderId ?? null) === null).sort(byName)
  const isEmpty = connections.length === 0 && folders.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <BrandMark size={22} />
        <span className="text-[length:var(--app-text-13)] font-semibold tracking-tight text-text-strong">Nova Tables</span>
        <span className="rounded border border-line-strong bg-tint/[0.03] px-1.5 py-0.5 text-[length:var(--app-text-9)] font-semibold uppercase tracking-wider text-text-muted">
          MSSQL
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn-soft" onClick={() => openCreatePrompt(null)}>
            <Icon name="folder" size={14} />
            New folder
          </button>
          <button type="button" className="btn-primary" onClick={onNewConnection}>
            <Icon name="plus" size={14} />
            New connection
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-[length:var(--app-text-15)] font-semibold text-text-strong">Connections</h1>
          <p className="mt-1 text-[length:var(--app-text-12)] text-text-muted">
            Pick a connection to open it, or group them into folders.
          </p>

          {isEmpty ? (
            <div className="mt-8 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
              <Icon name="server" size={22} className="mx-auto mb-3 text-text-faint" />
              <p className="text-[length:var(--app-text-13)] text-text-soft">No saved connections</p>
              <p className="mt-1 text-[length:var(--app-text-12)] text-text-faint">
                Create one to start browsing your databases.
              </p>
              <button type="button" className="btn-primary mt-4" onClick={onNewConnection}>
                <Icon name="plus" size={14} />
                New connection
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-px rounded-lg border border-line bg-panel/60 p-2">
              {rootConnections.map((connection) => renderConnection(connection, 0))}
              {rootFolders.map((folder) => renderFolder(folder, 0))}
            </div>
          )}
        </div>
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-line px-6 text-[length:var(--app-text-10)] text-text-faint">
        <span>
          {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
          {folders.length > 0 ? ` · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}` : ''}
        </span>
        <span>{appVersion ? `v${appVersion}` : ''}</span>
      </footer>

      <PromptDialog
        open={Boolean(prompt)}
        title={prompt?.mode === 'rename' ? 'Rename folder' : 'New folder'}
        description={
          prompt?.mode === 'rename'
            ? `Rename “${prompt.folder.name}”.`
            : prompt?.parentName
              ? `Create a folder inside “${prompt.parentName}”.`
              : 'Create a folder at the top level.'
        }
        label="Folder name"
        confirmLabel={promptBusy ? 'Saving…' : prompt?.mode === 'rename' ? 'Rename' : 'Create'}
        initialValue={prompt?.mode === 'rename' ? prompt.folder.name : ''}
        busy={promptBusy}
        onCancel={() => setPrompt(null)}
        onConfirm={handlePromptConfirm}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete folder"
        message={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed. Connections and subfolders inside it move to the parent folder.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete folder'}
        danger
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: 'move-root',
              label: 'Move to top level',
              onSelect: () => onMoveConnection(menu.connection, null),
            },
            ...flatFolders.map(({ folder, depth }) => ({
              id: `move-${folder.id}`,
              label: `${'— '.repeat(depth)}${folder.name}`,
              onSelect: () => onMoveConnection(menu.connection, folder.id),
            })),
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
