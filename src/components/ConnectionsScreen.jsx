import { Fragment, useEffect, useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import ContextMenu from './ContextMenu.jsx'
import EnvironmentBadge from './EnvironmentBadge.jsx'
import ExportConnectionsDialog from './ExportConnectionsDialog.jsx'
import Icon, { BrandMark, Spinner } from './Icon.jsx'
import ImportConnectionsDialog from './ImportConnectionsDialog.jsx'
import PromptDialog from './PromptDialog.jsx'
import { api } from '../api.js'

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

function flattenRows(connections, folders, openFolders, parentId = null, depth = 0, result = []) {
  for (const connection of connections.filter((item) => (item.folderId ?? null) === parentId)) {
    result.push({ kind: 'connection', id: connection.id, depth })
  }
  const children = folders.filter((folder) => (folder.parentId ?? null) === parentId).sort(byName)
  for (const folder of children) {
    result.push({ kind: 'folder', id: folder.id, depth })
    if (openFolders.has(folder.id)) {
      flattenRows(connections, folders, openFolders, folder.id, depth + 1, result)
    }
  }
  return result
}

function folderSubtree(folders, id) {
  const ids = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const folder of folders) {
      if (folder.parentId === current && !ids.has(folder.id)) {
        ids.add(folder.id)
        queue.push(folder.id)
      }
    }
  }
  return ids
}

function DragHandle({ title, onDragStart, onDragEnd }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={title}
      aria-label={title}
      className="icon-btn h-6 w-6 cursor-grab text-text-faint hover:text-text active:cursor-grabbing"
    >
      <Icon name="grip" size={12} />
    </button>
  )
}

function DropLine({ depth }) {
  return (
    <div style={{ marginLeft: depth * 14 + 8 }} className="mr-2 h-0.5 rounded-full bg-accent" />
  )
}

function SelectBox({ checked, active, label, onClick }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-all duration-150 ${
        checked
          ? 'border-accent bg-accent text-on-accent'
          : `border-line-strong text-transparent hover:border-accent/70 ${
              active
                ? 'opacity-60 hover:opacity-100'
                : 'opacity-0 group-hover/row:opacity-60 focus-visible:opacity-100'
            }`
      }`}
    >
      <Icon name="check" size={9} strokeWidth={3} />
    </button>
  )
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
  onDeleteSelection,
  onMoveConnection,
  onReorderTree,
  onReloadConnections,
  onNotify,
}) {
  const [openFolders, setOpenFolders] = useState(() => new Set())
  const [prompt, setPrompt] = useState(null)
  const [promptBusy, setPromptBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [menu, setMenu] = useState(null)
  const [drag, setDrag] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [exportTarget, setExportTarget] = useState(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState(null)
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(() => new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(null)
  const [bulkDelete, setBulkDelete] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionMoveMenu, setActionMoveMenu] = useState(null)

  const flatFolders = useMemo(() => folderTree(folders), [folders])
  const connectionOrder = useMemo(() => connections.map((item) => item.id), [connections])
  const folderOrder = useMemo(() => folders.map((item) => item.id), [folders])
  const visibleRows = useMemo(
    () => flattenRows(connections, folders, openFolders),
    [connections, folders, openFolders],
  )
  const selectedCount = selectedConnectionIds.size + selectedFolderIds.size
  const selectedExportIds = useMemo(() => {
    const ids = new Set(selectedConnectionIds)
    if (selectedFolderIds.size > 0) {
      const folderIds = new Set()
      for (const id of selectedFolderIds) {
        for (const child of folderSubtree(folders, id)) folderIds.add(child)
      }
      for (const connection of connections) {
        if (connection.folderId && folderIds.has(connection.folderId)) ids.add(connection.id)
      }
    }
    return [...ids]
  }, [connections, folders, selectedConnectionIds, selectedFolderIds])
  const selectedSummary = [
    selectedConnectionIds.size > 0
      ? `${selectedConnectionIds.size} connection${selectedConnectionIds.size === 1 ? '' : 's'}`
      : null,
    selectedFolderIds.size > 0
      ? `${selectedFolderIds.size} folder${selectedFolderIds.size === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const toggleFolder = (id) => {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    const allowedConnections = new Set(connections.map((item) => item.id))
    const allowedFolders = new Set(folders.map((item) => item.id))
    setSelectedConnectionIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedConnections.has(id)))
      return next.size === prev.size ? prev : next
    })
    setSelectedFolderIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedFolders.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [connections, folders])

  const isRowSelected = (kind, id) =>
    kind === 'connection' ? selectedConnectionIds.has(id) : selectedFolderIds.has(id)

  const clearSelection = () => {
    setSelectedConnectionIds(new Set())
    setSelectedFolderIds(new Set())
    setSelectionAnchor(null)
  }

  const selectOnly = (kind, id) => {
    setSelectedConnectionIds(new Set(kind === 'connection' ? [id] : []))
    setSelectedFolderIds(new Set(kind === 'folder' ? [id] : []))
    setSelectionAnchor({ kind, id })
  }

  const toggleSelection = (kind, id) => {
    if (kind === 'connection') {
      setSelectedConnectionIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedFolderIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    setSelectionAnchor({ kind, id })
  }

  const selectRange = (kind, id) => {
    const target = visibleRows.findIndex((row) => row.kind === kind && row.id === id)
    const anchor = selectionAnchor
      ? visibleRows.findIndex(
          (row) => row.kind === selectionAnchor.kind && row.id === selectionAnchor.id,
        )
      : -1
    if (target < 0 || anchor < 0) {
      selectOnly(kind, id)
      return
    }

    const [start, end] = anchor <= target ? [anchor, target] : [target, anchor]
    const nextConnections = new Set()
    const nextFolders = new Set()
    for (const row of visibleRows.slice(start, end + 1)) {
      if (row.kind === 'connection') nextConnections.add(row.id)
      else nextFolders.add(row.id)
    }
    setSelectedConnectionIds(nextConnections)
    setSelectedFolderIds(nextFolders)
  }

  const applyModifierClick = (event, kind, id) => {
    if (event.shiftKey) {
      selectRange(kind, id)
      return true
    }
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(kind, id)
      return true
    }
    return false
  }

  const handleSelectClick = (event, kind, id) => {
    event.stopPropagation()
    if (event.shiftKey) selectRange(kind, id)
    else toggleSelection(kind, id)
  }

  const openRowMenu = (event, kind, item) => {
    event.preventDefault()
    event.stopPropagation()
    if (!isRowSelected(kind, item.id)) selectOnly(kind, item.id)
    const bounds = event.currentTarget.getBoundingClientRect()
    const fromPointer = event.type === 'contextmenu'
    setMenu({
      x: fromPointer ? event.clientX : Math.min(bounds.left, window.innerWidth - 208),
      y: fromPointer ? event.clientY : bounds.bottom + 4,
      kind,
      item,
    })
  }

  const moveSelectionTo = (folderId) => {
    const ids = [...selectedConnectionIds]
    if (ids.length === 0) return
    setActionMoveMenu(null)
    const next = connectionOrder.filter((id) => !ids.includes(id))
    onReorderTree({
      connections: [...next, ...ids],
      folders: folderOrder,
      connectionFolders: Object.fromEntries(ids.map((id) => [id, folderId])),
      folderParents: {},
    })
  }

  const moveFolderTo = (folder, parentId) => {
    const next = folderOrder.filter((id) => id !== folder.id)
    onReorderTree({
      connections: connectionOrder,
      folders: [...next, folder.id],
      connectionFolders: {},
      folderParents: { [folder.id]: parentId },
    })
  }

  const moveTargets = (excludeFolderId = null) => {
    const blocked = excludeFolderId ? folderSubtree(folders, excludeFolderId) : new Set()
    return flatFolders.filter(({ folder }) => !blocked.has(folder.id))
  }

  const folderMoveItems = (onSelect, { excludeFolderId = null, skipFolderId = null } = {}) => [
    {
      id: 'move-root',
      label: 'Top level',
      onSelect: () => onSelect(null),
    },
    ...moveTargets(excludeFolderId)
      .filter(({ folder }) => folder.id !== skipFolderId)
      .map(({ folder, depth }) => ({
        id: `move-${folder.id}`,
        label: `${'— '.repeat(depth)}${folder.name}`,
        onSelect: () => onSelect(folder.id),
      })),
  ]

  const openCreatePrompt = (parentId = null) => {
    const parent = folders.find((folder) => folder.id === parentId)
    setPrompt({ mode: 'create', parentId, parentName: parent?.name ?? null })
  }

  const handleDragStart = (event, kind, id) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    const ids =
      kind === 'connection' && selectedConnectionIds.has(id)
        ? [...selectedConnectionIds]
        : [id]
    setDrag({ kind, id, ids })
  }

  const handleDragEnd = () => {
    setDrag(null)
    setDropTarget(null)
  }

  const resolveTarget = (event, kind, item) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (kind === 'connection') {
      const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
      return { kind: 'connection', id: item.id, position }
    }
    if (drag.kind === 'folder') {
      const offset = (event.clientY - bounds.top) / bounds.height
      const position = offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside'
      return { kind: 'folder', id: item.id, position }
    }
    return { kind: 'folder', id: item.id, position: 'inside' }
  }

  const applyDrop = (dragged, target) => {
    setDrag(null)
    setDropTarget(null)

    if (dragged.kind === 'connection') {
      const moveIds = dragged.ids ?? [dragged.id]
      if (target.kind === 'connection' && moveIds.includes(target.id)) return
      const next = connectionOrder.filter((id) => !moveIds.includes(id))
      let folderId = null
      let index = next.length

      if (target.kind === 'connection') {
        const targetIndex = next.indexOf(target.id)
        if (targetIndex < 0) return
        index = target.position === 'before' ? targetIndex : targetIndex + 1
        folderId = connections.find((item) => item.id === target.id)?.folderId ?? null
      } else if (target.kind === 'folder') {
        folderId = target.id
        setOpenFolders((prev) => new Set(prev).add(target.id))
      }

      next.splice(index, 0, ...moveIds)
      onReorderTree({
        connections: next,
        folders: folderOrder,
        connectionFolders: Object.fromEntries(moveIds.map((id) => [id, folderId])),
        folderParents: {},
      })
      return
    }

    const next = folderOrder.filter((id) => id !== dragged.id)
    let parentId = null
    let index = next.length

    if (target.kind === 'folder') {
      const targetFolder = folders.find((item) => item.id === target.id)
      if (!targetFolder) return
      if (target.position === 'inside') {
        parentId = target.id
        setOpenFolders((prev) => new Set(prev).add(target.id))
      } else {
        const targetIndex = next.indexOf(target.id)
        if (targetIndex < 0) return
        index = target.position === 'before' ? targetIndex : targetIndex + 1
        parentId = targetFolder.parentId ?? null
      }
    }

    next.splice(index, 0, dragged.id)
    onReorderTree({
      connections: connectionOrder,
      folders: next,
      connectionFolders: {},
      folderParents: { [dragged.id]: parentId },
    })
  }

  const handleRowDragOver = (event, kind, item) => {
    if (!drag) return
    event.stopPropagation()
    if (kind === 'connection' && (drag.kind !== 'connection' || drag.ids.includes(item.id))) return
    if (kind === 'folder' && drag.kind === 'folder' && drag.id === item.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(resolveTarget(event, kind, item))
  }

  const handleRowDrop = (event, kind, item) => {
    if (!drag) return
    event.preventDefault()
    event.stopPropagation()
    applyDrop(drag, resolveTarget(event, kind, item))
  }

  const handleRootDragOver = (event) => {
    if (!drag) return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget({ kind: 'root' })
  }

  const handleRootDrop = (event) => {
    if (!drag) return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.stopPropagation()
    applyDrop(drag, { kind: 'root' })
  }

  const handlePromptConfirm = async (value) => {
    setPromptBusy(true)
    try {
      if (prompt.mode === 'rename') await onRenameFolder(prompt.folder, value)
      else {
        await onCreateFolder(value, prompt.parentId)
        if (prompt.parentId) {
          setOpenFolders((prev) => new Set(prev).add(prompt.parentId))
        }
      }
      setPrompt(null)
    } finally {
      setPromptBusy(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await onDeleteSelection({ folderIds: [deleteTarget.id] })
      setDeleteTarget(null)
      clearSelection()
    } catch (error) {
      onNotify?.('error', error.message)
    } finally {
      setDeleting(false)
    }
  }

  const openBulkDelete = () => {
    setBulkDelete({
      connectionIds: [...selectedConnectionIds],
      folderIds: [...selectedFolderIds],
    })
  }

  const handleBulkDeleteConfirm = async () => {
    if (!bulkDelete) return
    setBulkBusy(true)
    try {
      await onDeleteSelection(bulkDelete)
      setBulkDelete(null)
      clearSelection()
    } catch (error) {
      onNotify?.('error', error.message)
    } finally {
      setBulkBusy(false)
    }
  }

  const handleOpenExport = (connectionIds = null) => {
    const ids =
      connectionIds ??
      (selectedConnectionIds.size > 0
        ? [...selectedConnectionIds]
        : connections.map((conn) => conn.id))
    setExportTarget(ids)
  }

  const handleExportConfirm = async (selectedIds, password) => {
    setExportBusy(true)
    try {
      const result = await api.exportConnections(selectedIds, password)
      if (result.saved) {
        setExportTarget(null)
        onNotify?.('success', `Exported ${result.count} connection(s) successfully.`)
      }
    } catch (error) {
      onNotify?.('error', error.message)
    } finally {
      setExportBusy(false)
    }
  }

  const handleStartImport = async () => {
    try {
      const file = await api.selectImportFile()
      if (file.canceled) return
      setImportFile(file)
      setImportError(null)
    } catch (error) {
      onNotify?.('error', error.message)
    }
  }

  const handleImportConfirm = async (password) => {
    if (!importFile?.content) return
    setImportBusy(true)
    setImportError(null)
    try {
      const result = await api.importConnections(importFile.content, password)
      setImportFile(null)
      await onReloadConnections?.()
      const folders = result.importedFolderCount
      const suffix = folders > 0 ? ` and ${folders} folder(s)` : ''
      onNotify?.('success', `Imported ${result.importedCount} connection(s)${suffix} successfully.`)
    } catch (error) {
      setImportError(error.message)
    } finally {
      setImportBusy(false)
    }
  }

  const connectionMenuItems = (connection) => [
    { id: 'open', label: 'Open connection', onSelect: () => onOpen(connection) },
    { id: 'edit', label: 'Edit connection', onSelect: () => onEditConnection(connection) },
    {
      id: 'move',
      label: 'Move to folder',
      children: folderMoveItems((folderId) => onMoveConnection(connection, folderId), {
        skipFolderId: connection.folderId ?? null,
      }),
    },
    {
      id: 'export',
      label: 'Export connection',
      onSelect: () => handleOpenExport([connection.id]),
    },
    { id: 'delete', label: 'Delete connection', onSelect: () => onDeleteConnection(connection) },
  ]

  const folderMenuItems = (folder) => [
    {
      id: 'toggle',
      label: openFolders.has(folder.id) ? 'Collapse folder' : 'Expand folder',
      onSelect: () => toggleFolder(folder.id),
    },
    { id: 'new', label: 'New subfolder', onSelect: () => openCreatePrompt(folder.id) },
    {
      id: 'rename',
      label: 'Rename folder',
      onSelect: () => setPrompt({ mode: 'rename', folder }),
    },
    {
      id: 'move',
      label: 'Move folder',
      children: folderMoveItems((parentId) => moveFolderTo(folder, parentId), {
        excludeFolderId: folder.id,
        skipFolderId: folder.parentId ?? null,
      }),
    },
    {
      id: 'delete',
      label: 'Delete folder',
      onSelect: () => {
        selectOnly('folder', folder.id)
        setDeleteTarget(folder)
      },
    },
  ]

  const selectionMenuItems = () => [
    ...(selectedExportIds.length > 0
      ? [
          {
            id: 'bulk-export',
            label: `Export ${selectedExportIds.length} connection${
              selectedExportIds.length === 1 ? '' : 's'
            }`,
            onSelect: () => handleOpenExport(selectedExportIds),
          },
          {
            id: 'bulk-move',
            label: 'Move connections to folder',
            children: folderMoveItems(moveSelectionTo),
          },
        ]
      : []),
    { id: 'bulk-delete', label: 'Delete selected', onSelect: openBulkDelete },
    { id: 'bulk-clear', label: 'Clear selection', onSelect: clearSelection },
  ]

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      if (prompt || exportTarget || importFile || deleteTarget || bulkDelete || menu) return

      if (event.key === 'Escape' && selectedCount > 0) {
        event.preventDefault()
        clearSelection()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        if (visibleRows.length === 0) return
        event.preventDefault()
        setSelectedConnectionIds(
          new Set(visibleRows.filter((row) => row.kind === 'connection').map((row) => row.id)),
        )
        setSelectedFolderIds(
          new Set(visibleRows.filter((row) => row.kind === 'folder').map((row) => row.id)),
        )
        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCount > 0) {
        event.preventDefault()
        openBulkDelete()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  const renderConnection = (connection, depth) => {
    const isConnecting = connectingId === connection.id
    const isOpen = openIds.includes(connection.id)
    const isSelected = selectedConnectionIds.has(connection.id)
    const isDragged = drag?.kind === 'connection' && drag.ids.includes(connection.id)
    const isDropLine = (position) =>
      dropTarget?.kind === 'connection' &&
      dropTarget.id === connection.id &&
      dropTarget.position === position

    return (
      <Fragment key={connection.id}>
        {isDropLine('before') ? <DropLine depth={depth} /> : null}
        <div
          style={{ marginLeft: depth * 14 }}
          className={`group/row group/conn flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
            isSelected ? 'bg-accent/[0.08]' : 'hover:bg-tint/[0.04]'
          } ${isDragged ? 'opacity-40' : ''}`}
          onContextMenu={(event) => openRowMenu(event, 'connection', connection)}
          onDragOver={(event) => handleRowDragOver(event, 'connection', connection)}
          onDrop={(event) => handleRowDrop(event, 'connection', connection)}
        >
          <SelectBox
            checked={isSelected}
            active={selectedCount > 0}
            label={isSelected ? `Deselect ${connection.name}` : `Select ${connection.name}`}
            onClick={(event) => handleSelectClick(event, 'connection', connection.id)}
          />
          <DragHandle
            title="Drag to reorder or move into a folder"
            onDragStart={(event) => handleDragStart(event, 'connection', connection.id)}
            onDragEnd={handleDragEnd}
          />
          <button
            type="button"
            disabled={isConnecting}
            onClick={(event) => {
              if (applyModifierClick(event, 'connection', connection.id)) return
              onOpen(connection)
            }}
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
              <span className="flex items-center gap-2">
                <span className="truncate text-[length:var(--app-text-12)] text-text">{connection.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <EnvironmentBadge environment={connection.environment} />
                  {isOpen ? (
                    <span className="shrink-0 rounded border border-success/30 bg-success/10 px-1 text-[length:var(--app-text-9)] font-semibold uppercase tracking-wide text-success">
                      open
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="block truncate text-[length:var(--app-text-10)] leading-[calc(var(--app-text-12)+4px)] text-text-faint">
                {connection.host}:{connection.port}
                {connection.database ? ` · ${connection.database}` : ''}
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`icon-btn h-6 w-6 shrink-0 transition-opacity ${
              menu?.kind === 'connection' && menu.item.id === connection.id
                ? 'opacity-100'
                : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'
            }`}
            title="Connection actions"
            aria-label={`Actions for ${connection.name}`}
            onClick={(event) => openRowMenu(event, 'connection', connection)}
          >
            <Icon name="more-horizontal" size={13} />
          </button>
        </div>
        {isDropLine('after') ? <DropLine depth={depth} /> : null}
      </Fragment>
    )
  }

  const renderFolder = (folder, depth) => {
    const isOpen = openFolders.has(folder.id)
    const isSelected = selectedFolderIds.has(folder.id)
    const childFolders = folders.filter((item) => item.parentId === folder.id)
    const childConnections = connections.filter((item) => item.folderId === folder.id)
    const childCount = childFolders.length + childConnections.length
    const isDragged = drag?.kind === 'folder' && drag.id === folder.id
    const isDropLine = (position) =>
      dropTarget?.kind === 'folder' &&
      dropTarget.id === folder.id &&
      dropTarget.position === position
    const isDropInside = isDropLine('inside')

    return (
      <Fragment key={folder.id}>
        {isDropLine('before') ? <DropLine depth={depth} /> : null}
        <div
          style={{ marginLeft: depth * 14 }}
          className={`group/row group/folder flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
            isSelected ? 'bg-accent/[0.08]' : 'hover:bg-tint/[0.03]'
          } ${isDropInside ? 'bg-accent/10 ring-1 ring-accent/40' : ''} ${isDragged ? 'opacity-40' : ''}`}
          onContextMenu={(event) => openRowMenu(event, 'folder', folder)}
          onDragOver={(event) => handleRowDragOver(event, 'folder', folder)}
          onDrop={(event) => handleRowDrop(event, 'folder', folder)}
        >
          <SelectBox
            checked={isSelected}
            active={selectedCount > 0}
            label={isSelected ? `Deselect ${folder.name}` : `Select ${folder.name}`}
            onClick={(event) => handleSelectClick(event, 'folder', folder.id)}
          />
          <DragHandle
            title="Drag to reorder or move into a folder"
            onDragStart={(event) => handleDragStart(event, 'folder', folder.id)}
            onDragEnd={handleDragEnd}
          />
          <button
            type="button"
            onClick={(event) => {
              if (applyModifierClick(event, 'folder', folder.id)) return
              toggleFolder(folder.id)
            }}
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

          <button
            type="button"
            className={`icon-btn h-6 w-6 shrink-0 transition-opacity ${
              menu?.kind === 'folder' && menu.item.id === folder.id
                ? 'opacity-100'
                : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'
            }`}
            title="Folder actions"
            aria-label={`Actions for ${folder.name}`}
            onClick={(event) => openRowMenu(event, 'folder', folder)}
          >
            <Icon name="more-horizontal" size={13} />
          </button>
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
        {isDropLine('after') ? <DropLine depth={depth} /> : null}
      </Fragment>
    )
  }

  const rootFolders = folders.filter((folder) => (folder.parentId ?? null) === null)
  const rootConnections = connections.filter((connection) => (connection.folderId ?? null) === null)
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
          <button
            type="button"
            className="btn-soft"
            onClick={handleStartImport}
            title="Import connections from encrypted JSON file"
          >
            <Icon name="upload" size={14} />
            Import
          </button>
          <button
            type="button"
            className="btn-soft"
            onClick={() => handleOpenExport(selectedCount > 0 ? selectedExportIds : null)}
            disabled={connections.length === 0 || (selectedCount > 0 && selectedExportIds.length === 0)}
            title={
              selectedCount > 0
                ? 'Export the selected connections to an encrypted JSON file'
                : 'Export all connections to an encrypted JSON file'
            }
          >
            <Icon name="download" size={14} />
            {selectedCount > 0 ? 'Export selected' : 'Export'}
          </button>
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
            Pick a connection to open it. Tick a row on hover, or use Ctrl/Cmd-click, Shift-click
            and right-click to work on several at once.
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
            <div
              className={`mt-5 space-y-px rounded-lg border border-line bg-panel/60 p-2 ${
                dropTarget?.kind === 'root' ? 'bg-accent/[0.04] ring-1 ring-accent/40' : ''
              }`}
              onDragOver={handleRootDragOver}
              onDrop={handleRootDrop}
            >
              {rootConnections.map((connection) => renderConnection(connection, 0))}
              {rootFolders.map((folder) => renderFolder(folder, 0))}
            </div>
          )}
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-6">
          <div className="animate-fade-in pointer-events-auto flex items-center gap-1 rounded-full border border-line-strong bg-elevated/95 py-1.5 pl-4 pr-1.5 shadow-2xl shadow-black/50 backdrop-blur">
            <span className="text-[length:var(--app-text-11)] font-semibold text-text-strong">
              {selectedCount} selected
            </span>
            {selectedFolderIds.size > 0 ? (
              <span className="ml-2 hidden text-[length:var(--app-text-10)] text-text-faint sm:inline">
                {selectedSummary}
              </span>
            ) : null}
            <span className="mx-2 h-4 w-px bg-line" />
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[length:var(--app-text-11)]"
              disabled={selectedExportIds.length === 0}
              onClick={() => handleOpenExport(selectedExportIds)}
              title="Export the selected connections"
            >
              <Icon name="download" size={13} />
              Export
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[length:var(--app-text-11)]"
              disabled={selectedConnectionIds.size === 0}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                setActionMoveMenu({ x: bounds.left, y: bounds.top - 6 })
              }}
              title="Move the selected connections into a folder"
            >
              <Icon name="folder" size={13} />
              Move
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[length:var(--app-text-11)] text-danger hover:bg-danger/10 hover:text-danger"
              onClick={openBulkDelete}
              title="Delete the selection (Delete)"
            >
              <Icon name="trash" size={13} />
              Delete
            </button>
            <button
              type="button"
              className="icon-btn ml-0.5 h-7 w-7 rounded-full"
              onClick={clearSelection}
              title="Clear selection (Esc)"
              aria-label="Clear selection"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
      ) : null}

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
            ? `“${deleteTarget.name}” and everything inside it will be removed from this device, including its connections, subfolders and saved passwords.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete folder'}
        danger
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ConfirmDialog
        open={Boolean(bulkDelete)}
        title="Delete selection"
        message={
          bulkDelete
            ? `${[
                bulkDelete.connectionIds.length > 0
                  ? `${bulkDelete.connectionIds.length} connection${
                      bulkDelete.connectionIds.length === 1 ? '' : 's'
                    }`
                  : null,
                bulkDelete.folderIds.length > 0
                  ? `${bulkDelete.folderIds.length} folder${
                      bulkDelete.folderIds.length === 1 ? '' : 's'
                    }`
                  : null,
              ]
                .filter(Boolean)
                .join(' and ')} will be removed from this device. Connections inside the selected folders are deleted too, along with their saved passwords.`
            : ''
        }
        confirmLabel={bulkBusy ? 'Deleting…' : 'Delete'}
        danger
        busy={bulkBusy}
        onCancel={() => setBulkDelete(null)}
        onConfirm={handleBulkDeleteConfirm}
      />

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            selectedCount > 1
              ? selectionMenuItems()
              : menu.kind === 'connection'
                ? connectionMenuItems(menu.item)
                : folderMenuItems(menu.item)
          }
          onClose={() => setMenu(null)}
        />
      ) : null}

      {actionMoveMenu ? (
        <ContextMenu
          x={actionMoveMenu.x}
          y={actionMoveMenu.y}
          items={folderMoveItems(moveSelectionTo)}
          onClose={() => setActionMoveMenu(null)}
        />
      ) : null}

      <ExportConnectionsDialog
        open={Boolean(exportTarget)}
        connections={connections}
        folders={folders}
        selectedIds={exportTarget ?? []}
        busy={exportBusy}
        onClose={() => setExportTarget(null)}
        onExport={handleExportConfirm}
      />

      <ImportConnectionsDialog
        open={Boolean(importFile)}
        fileName={importFile?.fileName ?? ''}
        busy={importBusy}
        error={importError}
        onClose={() => {
          setImportFile(null)
          setImportError(null)
        }}
        onImport={handleImportConfirm}
      />
    </div>
  )
}
