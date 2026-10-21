import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'
import ContextMenu from './ContextMenu.jsx'
import JsonView from './JsonView.jsx'
import ResultGrid from './ResultGrid.jsx'
import { cleanText, jsonRecords, sqlInsertRows } from '../resultFormats.js'

const ROW_PANEL_DEFAULT_WIDTH = 360

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

const SPECIAL_OPTIONS = [
  { id: 'null', label: 'NULL', value: null },
  { id: 'default', label: 'Default', value: { special: 'DEFAULT' } },
  { id: 'getdate', label: 'GETDATE()', value: { special: 'GETDATE()' } },
]

export default function ResultsPanel({
  state,
  activeSet,
  onSelectSet,
  relations,
  onRelationClick,
  onCopyText,
  editSource,
  edits = {},
  onCellChange,
  onSetCellValue,
  onDiscardEdits,
  onCopyUpdate,
  onOpenUpdate,
  onDeleteRows,
}) {
  const { status, result, error } = state
  const resultSets = result?.resultSets ?? []
  const activeIndex = Math.min(activeSet ?? 0, Math.max(resultSets.length - 1, 0))
  const activeResultSet = resultSets[activeIndex]
  const rowsAffected = (result?.rowsAffected ?? []).reduce((total, count) => total + count, 0)
  const [selection, setSelection] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [menu, setMenu] = useState(null)
  const [panelWidth, setPanelWidth] = useState(ROW_PANEL_DEFAULT_WIDTH)
  const splitRef = useRef(null)

  const hasKey = Boolean(editSource && editSource.primaryKey.length)
  const editable = hasKey && Boolean(activeResultSet) && resultSets.length === 1
  const changeCount = Object.keys(edits).length

  useEffect(() => {
    setSelection(null)
  }, [result])

  useEffect(() => {
    setEditMode(false)
  }, [result, editSource])

  const columnNames = useMemo(
    () => (activeResultSet?.columns ?? []).map((column) => column.name),
    [activeResultSet],
  )

  const selectionBounds = useMemo(() => {
    if (!selection || !activeResultSet) return null
    return {
      rowStart: Math.min(selection.anchor.row, selection.focus.row),
      rowEnd: Math.max(selection.anchor.row, selection.focus.row),
      colStart: Math.min(selection.anchor.col, selection.focus.col),
      colEnd: Math.max(selection.anchor.col, selection.focus.col),
    }
  }, [activeResultSet, selection])

  const selectionCells = useMemo(() => {
    if (!selectionBounds || !activeResultSet) return []
    const cells = []
    for (let row = selectionBounds.rowStart; row <= selectionBounds.rowEnd; row += 1) {
      const values = activeResultSet.rows[row]
      if (!values) continue
      const cellsInRow = []
      for (let col = selectionBounds.colStart; col <= selectionBounds.colEnd; col += 1) {
        const column = activeResultSet.columns[col]
        if (!column) continue
        const edit = edits[`${row}:${column.name}`]
        cellsInRow.push(edit ? edit.value : values[col])
      }
      cells.push(cellsInRow)
    }
    return cells
  }, [activeResultSet, edits, selectionBounds])

  const selectionRows = useMemo(() => {
    if (!selectionBounds || !activeResultSet) return []
    const rows = []
    for (let row = selectionBounds.rowStart; row <= selectionBounds.rowEnd; row += 1) {
      const values = activeResultSet.rows[row]
      if (!values) continue
      rows.push(
        activeResultSet.columns.map((column, col) => {
          const edit = edits[`${row}:${column.name}`]
          return edit ? edit.value : values[col]
        }),
      )
    }
    return rows
  }, [activeResultSet, edits, selectionBounds])

  const selectedColumns = useMemo(
    () =>
      !selectionBounds
        ? []
        : (activeResultSet?.columns ?? [])
            .slice(selectionBounds.colStart, selectionBounds.colEnd + 1)
            .map((column) => column.name),
    [activeResultSet, selectionBounds],
  )

  const handlePanelPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return
      const container = splitRef.current
      if (!container) return
      event.preventDefault()

      const bounds = container.getBoundingClientRect()
      const startX = event.clientX
      const startWidth = panelWidth
      const move = (moveEvent) => {
        const next = Math.min(Math.max(startWidth + (startX - moveEvent.clientX), 240), bounds.width - 240)
        setPanelWidth(next)
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
    },
    [panelWidth],
  )

  const selectedJson = selectionRows.length ? jsonRecords(columnNames, selectionRows) : ''

  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)

  useEffect(() => {
    setCopied(false)
  }, [selectedJson])

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const handleCopy = useCallback(async () => {
    if (!selectedJson || !onCopyText) return
    const written = await onCopyText(selectedJson, 'Copied row JSON.')
    if (!written) return
    setCopied(true)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }, [onCopyText, selectedJson])

  const copy = useCallback(
    (payload, message) => {
      onCopyText?.(payload, message)
    },
    [onCopyText],
  )

  const handleCellContextMenu = useCallback(
    (x, y, columnIndex) => {
      const column = activeResultSet?.columns[columnIndex] ?? null
      setMenu({ x, y, column })
    },
    [activeResultSet],
  )

  const table = editSource ? { schema: editSource.schema, name: editSource.table } : null

  const menuItems = useMemo(() => {
    if (!menu) return []
    const items = []

    if (editable) {
      items.push({
        id: 'edit-result',
        label: editMode ? 'Stop editing' : 'Edit Result',
        onSelect: () => {
          setSelection(null)
          setEditMode(!editMode)
        },
      })
    }

    if (editable && menu.column) {
      items.push({
        id: 'set-value',
        label: 'Set Value',
        children: SPECIAL_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
          onSelect: () => {
            if (!selectionBounds) return
            setEditMode(true)
            for (let row = selectionBounds.rowStart; row <= selectionBounds.rowEnd; row += 1) {
              onSetCellValue?.(row, menu.column.name, option.value)
            }
          },
        })),
      })
    }

    items.push({
      id: 'copy-cells-as',
      label: 'Copy Cells As',
      children: [
        {
          id: 'cells-clean-text',
          label: 'Clean Text',
          onSelect: () => copy(cleanText(selectionCells), 'Copied selected cells as clean text.'),
        },
        {
          id: 'cells-sql-insert',
          label: 'SQL Insert',
          onSelect: () => {
            if (!table) return
            copy(
              sqlInsertRows(table, selectedColumns, selectionCells),
              'Copied selected cells as INSERT statements.',
            )
          },
        },
        {
          id: 'cells-json',
          label: 'JSON',
          onSelect: () =>
            copy(
              jsonRecords(selectedColumns, selectionCells),
              'Copied selected cells as JSON.',
            ),
        },
      ],
    })

    items.push({
      id: 'copy-rows-as',
      label: 'Copy Rows As',
      children: [
        {
          id: 'rows-clean-text',
          label: 'Clean Text',
          onSelect: () => copy(cleanText(selectionRows), 'Copied selected rows as clean text.'),
        },
        {
          id: 'rows-sql-insert',
          label: 'SQL Insert',
          onSelect: () => {
            if (!table) return
            copy(sqlInsertRows(table, columnNames, selectionRows), 'Copied selected rows as INSERT statements.')
          },
        },
        {
          id: 'rows-json',
          label: 'JSON',
          onSelect: () => copy(jsonRecords(columnNames, selectionRows), 'Copied selected rows as JSON.'),
        },
      ],
    })

    if (hasKey && onDeleteRows && selectionBounds) {
      items.push({
        id: 'delete-rows',
        label: 'Delete Rows',
        onSelect: () => onDeleteRows(selectionBounds.rowStart, selectionBounds.rowEnd),
      })
    }

    return items
  }, [
    columnNames,
    copy,
    editMode,
    editable,
    hasKey,
    menu,
    onDeleteRows,
    onSetCellValue,
    selectedColumns,
    selectionBounds,
    selectionCells,
    selectionRows,
    table,
  ])

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      {status === 'running' ? <div className="progress-track shrink-0" /> : <div className="h-px shrink-0 bg-line" />}

      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2">
        {status === 'error' ? (
          <span className="flex items-center gap-1.5 px-2 text-[length:var(--app-text-11)] font-medium text-danger">
            <Icon name="alert-triangle" size={12} />
            Error
          </span>
        ) : null}

        {status === 'running' ? (
          <span className="flex items-center gap-1.5 px-2 text-[length:var(--app-text-11)] text-text-soft">
            <Spinner size={12} />
            Running query…
          </span>
        ) : null}

        {status !== 'error' && status !== 'running' && resultSets.length === 0 ? (
          <span className="px-2 text-[length:var(--app-text-11)] font-medium text-text-soft">Results</span>
        ) : null}

        {status !== 'error' && resultSets.length > 0
          ? resultSets.map((set, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onSelectSet(index)
                  setSelection(null)
                }}
                className={`flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[length:var(--app-text-11)] transition-colors ${
                  index === activeIndex
                    ? 'bg-tint/[0.06] text-text-strong'
                    : 'text-text-muted hover:bg-tint/[0.03] hover:text-text'
                }`}
              >
                Result {index + 1}
                <span className="rounded bg-tint/[0.06] px-1 text-[length:var(--app-text-10)] tabular-nums text-text-muted">
                  {formatNumber(set.rowCount)}
                </span>
              </button>
            ))
          : null}

        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-[length:var(--app-text-11)] text-text-muted">
          {status === 'success' && editSource && !hasKey ? (
            <span
              title="Editing needs a primary key so each row can be identified in the UPDATE WHERE clause."
              className="flex items-center gap-1 rounded bg-tint/[0.05] px-1.5 text-[length:var(--app-text-10)] text-text-faint"
            >
              <Icon name="lock" size={10} />
              Read-only · no primary key
            </span>
          ) : null}
          {status === 'success' && editMode ? (
            <span className="flex items-center gap-1 rounded bg-accent/15 px-1.5 text-[length:var(--app-text-10)] font-medium text-accent">
              <Icon name="pencil" size={10} />
              Editing
            </span>
          ) : null}
          {status === 'success' && changeCount > 0 ? (
            <div className="flex items-center gap-1">
              <span className="rounded bg-warning/15 px-1.5 text-[length:var(--app-text-10)] font-medium tabular-nums text-warning">
                {changeCount} change{changeCount === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={onCopyUpdate}
                title="Copy UPDATE statements for the changes"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[length:var(--app-text-11)] text-text-soft hover:bg-tint/[0.05] hover:text-text"
              >
                <Icon name="copy" size={11} />
                Copy update
              </button>
              <button
                type="button"
                onClick={onOpenUpdate}
                title="Open the UPDATE statements in a new query tab"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[length:var(--app-text-11)] text-text-soft hover:bg-tint/[0.05] hover:text-text"
              >
                <Icon name="code" size={11} />
                Open update
              </button>
              <button
                type="button"
                onClick={onDiscardEdits}
                title="Discard pending changes"
                className="flex h-6 items-center rounded px-1.5 text-[length:var(--app-text-11)] text-text-muted hover:bg-tint/[0.05] hover:text-text"
              >
                Discard
              </button>
            </div>
          ) : null}
          {status === 'success' && result ? (
            <>
              <span className="tabular-nums">{formatNumber(result.rowCount)} rows</span>
              <span className="text-text-faint">•</span>
              <span className="tabular-nums">{formatDuration(result.elapsedMs)}</span>
              {resultSets.length > 1 ? (
                <>
                  <span className="text-text-faint">•</span>
                  <span>{resultSets.length} result sets</span>
                </>
              ) : null}
            </>
          ) : null}
          {status === 'error' && error?.code ? (
            <span className="font-mono text-[length:var(--app-text-10)] text-text-faint">{error.code}</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {status === 'idle' ? <IdleState /> : null}
        {status === 'running' ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-[length:var(--app-text-12)] text-text-muted">
              <Spinner size={14} />
              Executing against SQL Server…
            </div>
          </div>
        ) : null}
        {status === 'error' ? <ErrorState error={error} /> : null}
        {status === 'success' && result ? (
          resultSets.length === 0 ? (
            <CompletedState rowsAffected={rowsAffected} elapsedMs={result.elapsedMs} />
          ) : (
            <div className="flex h-full flex-col">
              {result.truncated ? (
                <p className="border-b border-line bg-warning/[0.06] px-3 py-1.5 text-[length:var(--app-text-11)] text-warning/90">
                  Result set was larger than the transfer limit. Only the first{' '}
                  {formatNumber(result.maxRows)} rows of each set were loaded.
                </p>
              ) : null}
              <div ref={splitRef} className="flex min-h-0 flex-1">
                <div className="min-h-0 min-w-0 flex-1">
                  <ResultGrid
                    key={activeIndex}
                    columns={activeResultSet.columns}
                    rows={activeResultSet.rows}
                    relations={relations}
                    onRelationClick={onRelationClick}
                    selection={selection}
                    onSelectionChange={setSelection}
                    onCellContextMenu={handleCellContextMenu}
                    editable={editMode && editable}
                    edits={edits}
                    onCellChange={onCellChange}
                  />
                </div>

                {!editMode && selectionBounds ? (
                  <>
                    <div
                      onPointerDown={handlePanelPointerDown}
                      className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-base"
                      title="Drag to resize"
                    >
                      <span className="h-full w-px bg-line transition-colors group-hover:bg-accent/60" />
                    </div>

                    <div
                      style={{ width: panelWidth }}
                      className="flex min-h-0 shrink-0 flex-col border-l border-line bg-panel"
                    >
                      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
                        <Icon name="grid" size={12} className="shrink-0 text-text-muted" />
                        <span className="text-[length:var(--app-text-11)] font-medium text-text-soft">
                          {selection.anchor.row === selection.focus.row
                            ? `Row ${selection.focus.row + 1}`
                            : `Rows ${selectionBounds.rowStart + 1}–${selectionBounds.rowEnd + 1}`}
                        </span>
                        <button
                          type="button"
                          className="icon-btn ml-auto h-5 w-5"
                          title="Copy JSON"
                          onClick={handleCopy}
                        >
                          <Icon
                            name="copy"
                            size={12}
                            className={copied ? 'text-success' : undefined}
                          />
                        </button>
                        <button
                          type="button"
                          className="icon-btn h-5 w-5"
                          title="Close"
                          onClick={() => setSelection(null)}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                      <JsonView text={selectedJson} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )
        ) : null}
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}
    </section>
  )
}

function IdleState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-elevated text-text-faint">
        <Icon name="grid" size={19} />
      </span>
      <div>
        <p className="text-[length:var(--app-text-13)] text-text-soft">No query results yet</p>
        <p className="mt-1 text-[length:var(--app-text-11)] text-text-faint">
          Run a query with <span className="kbd">Ctrl</span> + <span className="kbd">↵</span> to see the
          output here.
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  const details = [
    error?.number ? `Error ${error.number}` : null,
    error?.severity ? `Level ${error.severity}` : null,
    error?.lineNumber ? `Line ${error.lineNumber}` : null,
    error?.state ? `State ${error.state}` : null,
  ].filter(Boolean)

  return (
    <div className="h-full overflow-auto p-4">
      <div className="rounded-lg border border-danger/25 bg-danger/[0.06] p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
            <Icon name="alert-triangle" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[length:var(--app-text-10)] font-semibold uppercase tracking-wider text-danger/80">
              Query failed
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[length:var(--app-text-12)] leading-[calc(var(--app-text-12)+8px)] text-danger">
              {error?.message || 'Unknown error'}
            </p>
            {details.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--app-text-10)] text-danger/60">
                {details.map((detail) => (
                  <span key={detail}>{detail}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function CompletedState({ rowsAffected, elapsedMs }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
        <Icon name="check-circle" size={18} />
      </span>
      <p className="text-[length:var(--app-text-13)] text-text">Query completed successfully</p>
      <p className="text-[length:var(--app-text-11)] text-text-muted">
        {rowsAffected > 0 ? `${formatNumber(rowsAffected)} rows affected` : 'No rows returned'} ·{' '}
        {formatDuration(elapsedMs)}
      </p>
    </div>
  )
}
