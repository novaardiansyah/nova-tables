import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'
import ContextMenu from './ContextMenu.jsx'
import FilterDialog from './FilterDialog.jsx'
import ResultGrid from './ResultGrid.jsx'
import ValueInspectorDialog from './ValueInspectorDialog.jsx'
import { cleanText, formatDuration, formatNumber, jsonRecords, sqlInsertRows } from '../resultFormats.js'
import { editEditableColumns, editHasKeys } from '../edits.js'

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
  onApplyFilter,
  onActiveDataChange,
  onExport,
  tabTitle,
}) {
  const { status, result, error } = state
  const resultSets = result?.resultSets ?? []
  const messages = result?.messages ?? []
  const activeIndex = Math.min(activeSet ?? 0, Math.max(resultSets.length - 1, 0))
  const activeResultSet = resultSets[activeIndex]
  const rowsAffected = (result?.rowsAffected ?? []).reduce((total, count) => total + count, 0)
  const [selection, setSelection] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [view, setView] = useState('results')
  const [menu, setMenu] = useState(null)
  const [headerMenu, setHeaderMenu] = useState(null)
  const [filterColumn, setFilterColumn] = useState(null)
  const [exportMenu, setExportMenu] = useState(null)
  const [inspectTarget, setInspectTarget] = useState({ columnIndex: null, row: -1 })

  const columnNames = useMemo(
    () => (activeResultSet?.columns ?? []).map((column) => column.name),
    [activeResultSet],
  )

  const hasKey = editHasKeys(editSource)
  const editableColumns = useMemo(() => editEditableColumns(editSource), [editSource])
  const keyInResult =
    hasKey &&
    editSource.tables.some((source) =>
      (source.keyColumns ?? source.primaryKey).every((name) =>
        columnNames.some((column) => column.toLowerCase() === name.toLowerCase()),
      ),
    )
  const editable = keyInResult && Boolean(activeResultSet) && resultSets.length === 1
  const deletable = editable && editSource.tables.length === 1
  const changeCount = Object.keys(edits).length

  useEffect(() => {
    setSelection(null)
  }, [result])

  useEffect(() => {
    const sets = result?.resultSets ?? []
    const lines = result?.messages ?? []
    setView(sets.length === 0 && lines.length > 0 ? 'messages' : 'results')
  }, [result])

  useEffect(() => {
    setEditMode(false)
  }, [result, editSource])

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

  const allRows = useMemo(() => {
    if (!activeResultSet?.rows) return []
    return activeResultSet.rows.map((values, row) =>
      activeResultSet.columns.map((column, col) => {
        const edit = edits[`${row}:${column.name}`]
        return edit ? edit.value : values[col]
      }),
    )
  }, [activeResultSet, edits])

  const handleExportAll = useCallback(
    (format) => {
      if (!activeResultSet || !onExport) return
      setExportMenu(null)
      onExport({
        format,
        filename: tabTitle || 'query_results',
        columnNames,
        rows: allRows,
      })
    },
    [activeResultSet, allRows, columnNames, onExport, tabTitle],
  )

  useEffect(() => {
    if (!activeResultSet || !selectionBounds) {
      onActiveDataChange?.(null)
      return
    }
    const label =
      selectionBounds.rowStart === selectionBounds.rowEnd
        ? `Row ${selectionBounds.rowStart + 1}`
        : `Rows ${selectionBounds.rowStart + 1}–${selectionBounds.rowEnd + 1}`
    onActiveDataChange?.({
      columnNames,
      rows: selectionRows,
      label,
    })
  }, [activeResultSet, columnNames, onActiveDataChange, selectionBounds, selectionRows])

  const copy = useCallback(
    (payload, message) => {
      onCopyText?.(payload, message)
    },
    [onCopyText],
  )

  const handleCellContextMenu = useCallback(
    (x, y, columnIndex, origIndex) => {
      const column = activeResultSet?.columns[columnIndex] ?? null
      setMenu({ x, y, column, columnIndex, row: origIndex })
    },
    [activeResultSet],
  )

  const handleHeaderContextMenu = useCallback(
    (x, y, columnIndex) => {
      const column = activeResultSet?.columns[columnIndex] ?? null
      if (!column) return
      setHeaderMenu({ x, y, column })
    },
    [activeResultSet],
  )

  const table = useMemo(() => {
    const source = editSource?.tables[0]
    return source ? { schema: source.schema, name: source.table } : null
  }, [editSource])

  const wholeRowSelection = Boolean(
    selectionBounds &&
      activeResultSet &&
      selectionBounds.colStart === 0 &&
      selectionBounds.colEnd === activeResultSet.columns.length - 1,
  )
  const selectionMatrix = wholeRowSelection ? selectionRows : selectionCells
  const selectionColumnNames = wholeRowSelection ? columnNames : selectedColumns
  const selectionLabel = wholeRowSelection ? 'rows' : 'cells'

  const openInspector = useCallback((columnIndex, row) => {
    setInspectTarget({ columnIndex, row })
  }, [])

  const menuItems = useMemo(() => {
    if (!menu) return []
    const items = [
      {
        id: 'inspect-value',
        label: 'Inspect Value',
        onSelect: () => {
          const row = menu.row >= 0 ? menu.row : (selectionBounds?.rowStart ?? 0)
          const colIndex = menu.columnIndex !== null && menu.columnIndex !== undefined
            ? menu.columnIndex
            : (selectionBounds?.colStart ?? 0)
          openInspector(colIndex, row)
        },
      },
      {
        id: 'copy-text',
        label: 'Copy Text',
        onSelect: () =>
          copy(cleanText(selectionMatrix), `Copied selected ${selectionLabel} as clean text.`),
      },
      {
        id: 'copy-json',
        label: 'Copy JSON',
        onSelect: () =>
          copy(
            jsonRecords(selectionColumnNames, selectionMatrix),
            `Copied selected ${selectionLabel} as JSON.`,
          ),
      },
      {
        id: 'copy-sql-insert',
        label: 'Copy SQL Insert',
        onSelect: () => {
          if (!table) return
          copy(
            sqlInsertRows(table, selectionColumnNames, selectionMatrix),
            `Copied selected ${selectionLabel} as INSERT statements.`,
          )
        },
      },
      {
        id: 'export-selected',
        label: 'Export Selection',
        children: [
          {
            id: 'export-selected-csv',
            label: 'CSV File (.csv)',
            onSelect: () =>
              onExport?.({
                format: 'csv',
                filename: `${tabTitle || 'selection'}_selected`,
                columnNames: selectionColumnNames,
                rows: selectionMatrix,
              }),
          },
          {
            id: 'export-selected-json',
            label: 'JSON File (.json)',
            onSelect: () =>
              onExport?.({
                format: 'json',
                filename: `${tabTitle || 'selection'}_selected`,
                columnNames: selectionColumnNames,
                rows: selectionMatrix,
              }),
          },
        ],
      },
    ]

    if (editable && menu.column && (!editableColumns || editableColumns.has(menu.column.name))) {
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

    if (editable) {
      items.push({
        id: 'edit-result',
        label: editMode ? 'Stop Editing' : 'Edit Result',
        onSelect: () => {
          setSelection(null)
          setEditMode(!editMode)
        },
      })
    }

    if (deletable && onDeleteRows && selectionBounds) {
      items.push({
        id: 'delete-rows',
        label: 'Delete',
        onSelect: () => onDeleteRows(selectionBounds.rowStart, selectionBounds.rowEnd),
      })
    }

    return items
  }, [
    copy,
    deletable,
    editMode,
    editable,
    editableColumns,
    menu,
    onDeleteRows,
    onExport,
    onSetCellValue,
    openInspector,
    selectionBounds,
    selectionColumnNames,
    selectionLabel,
    selectionMatrix,
    tabTitle,
    table,
  ])

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)] bg-surface">
      {status === 'running' ? (
        <div className="progress-track col-span-2 row-start-1 shrink-0" />
      ) : (
        <div className="col-span-2 row-start-1 h-px shrink-0 bg-line" />
      )}

      <div className="col-start-1 row-start-2 flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2">
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

        {status !== 'error' && status !== 'running' && resultSets.length === 0 && view !== 'messages' ? (
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
                  setView('results')
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

        {status !== 'error' && status !== 'running' ? (
          <button
            type="button"
            onClick={() => setView(view === 'messages' ? 'results' : 'messages')}
            className={`flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[length:var(--app-text-11)] transition-colors ${
              view === 'messages'
                ? 'bg-tint/[0.06] text-text-strong'
                : 'text-text-muted hover:bg-tint/[0.03] hover:text-text'
            }`}
          >
            Messages
            <span className="rounded bg-tint/[0.06] px-1 text-[length:var(--app-text-10)] tabular-nums text-text-muted">
              {formatNumber(messages.length)}
            </span>
          </button>
        ) : null}

        {status === 'success' && activeResultSet?.rows?.length > 0 && view !== 'messages' ? (
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setExportMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            title="Export query results to file"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[length:var(--app-text-11)] text-text-muted transition-colors hover:bg-tint/[0.03] hover:text-text"
          >
            <Icon name="download" size={11} />
            Export
          </button>
        ) : null}

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
            changeCount === 0 ? (
              <button
                type="button"
                onClick={() => setEditMode(false)}
                title="Stop editing"
                className="flex h-6 items-center gap-1 rounded bg-accent/15 px-1.5 text-[length:var(--app-text-10)] font-medium text-accent transition-colors hover:bg-accent/25"
              >
                <Icon name="x" size={10} />
                Cancel
              </button>
            ) : (
              <span className="flex items-center gap-1 rounded bg-accent/15 px-1.5 text-[length:var(--app-text-10)] font-medium text-accent">
                <Icon name="pencil" size={10} />
                Editing
              </span>
            )
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
          {status === 'error' && error?.code ? (
            <span className="font-mono text-[length:var(--app-text-10)] text-text-faint">{error.code}</span>
          ) : null}
        </div>
      </div>

      <div className="col-start-1 row-start-3 min-h-0 overflow-hidden">
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
          view === 'messages' ? (
            <MessageList messages={messages} />
          ) : resultSets.length === 0 ? (
            <CompletedState rowsAffected={rowsAffected} elapsedMs={result.elapsedMs} />
          ) : (
            <div className="flex h-full flex-col">
              {result.truncated ? (
                <p className="border-b border-line bg-warning/[0.06] px-3 py-1.5 text-[length:var(--app-text-11)] text-warning/90">
                  Result set was larger than the transfer limit. Only the first{' '}
                  {formatNumber(result.maxRows)} rows of each set were loaded.
                </p>
              ) : null}
              <div className="min-h-0 flex-1">
                <ResultGrid
                  key={activeIndex}
                  columns={activeResultSet.columns}
                  rows={activeResultSet.rows}
                  relations={relations}
                  onRelationClick={onRelationClick}
                  selection={selection}
                  onSelectionChange={setSelection}
                  onCellContextMenu={handleCellContextMenu}
                  onHeaderContextMenu={handleHeaderContextMenu}
                  editable={editable}
                  editableColumns={editableColumns}
                  editing={editMode}
                  edits={edits}
                  onCellChange={onCellChange}
                  onStartEdit={() => setEditMode(true)}
                  onInspectCell={openInspector}
                />
              </div>
            </div>
          )
        ) : null}
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}

      {exportMenu ? (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          items={[
            {
              id: 'export-csv',
              label: 'Export CSV (.csv)',
              onSelect: () => handleExportAll('csv'),
            },
            {
              id: 'export-json',
              label: 'Export JSON (.json)',
              onSelect: () => handleExportAll('json'),
            },
          ]}
          onClose={() => setExportMenu(null)}
        />
      ) : null}

      {headerMenu ? (
        <ContextMenu
          x={headerMenu.x}
          y={headerMenu.y}
          items={[
            {
              id: 'copy-object-name',
              label: 'Copy object name',
              onSelect: () => copy(headerMenu.column.name, `Copied column name ${headerMenu.column.name}.`),
            },
            {
              id: 'filter-by-column',
              label: 'Filter by column',
              onSelect: () => setFilterColumn(headerMenu.column.name),
            },
          ]}
          onClose={() => setHeaderMenu(null)}
        />
      ) : null}

      <FilterDialog
        open={filterColumn !== null}
        columns={activeResultSet?.columns ?? []}
        initialColumn={filterColumn ?? ''}
        onCancel={() => setFilterColumn(null)}
        onApply={(conditions) => {
          setFilterColumn(null)
          onApplyFilter?.(conditions)
        }}
      />

      <ValueInspectorDialog
        open={inspectTarget.columnIndex !== null && inspectTarget.row >= 0}
        column={activeResultSet?.columns?.[inspectTarget.columnIndex] ?? null}
        rowIndex={inspectTarget.row}
        value={
          inspectTarget.columnIndex !== null && inspectTarget.row >= 0
            ? (edits[`${inspectTarget.row}:${activeResultSet?.columns?.[inspectTarget.columnIndex]?.name}`]?.value ??
                activeResultSet?.rows?.[inspectTarget.row]?.[inspectTarget.columnIndex] ??
                null)
            : null
        }
        editable={
          editable &&
          inspectTarget.columnIndex !== null &&
          Boolean(activeResultSet?.columns?.[inspectTarget.columnIndex]) &&
          (!editableColumns ||
            editableColumns.has(activeResultSet.columns[inspectTarget.columnIndex].name))
        }
        onSave={(newValue) => {
          if (
            inspectTarget.columnIndex === null ||
            inspectTarget.row < 0 ||
            !activeResultSet?.columns?.[inspectTarget.columnIndex]
          ) {
            return
          }
          const colName = activeResultSet.columns[inspectTarget.columnIndex].name
          const origValue = activeResultSet.rows?.[inspectTarget.row]?.[inspectTarget.columnIndex]
          setEditMode(true)
          onCellChange?.(inspectTarget.row, colName, newValue, origValue)
        }}
        onClose={() => setInspectTarget({ columnIndex: null, row: -1 })}
        onCopy={onCopyText}
      />
    </section>
  )
}

function MessageList({ messages }) {
  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center text-[length:var(--app-text-12)] text-text-faint">
        No messages.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3">
      <ul className="space-y-1 font-mono text-[length:var(--app-text-12)] leading-[calc(var(--app-text-12)+8px)] text-text-soft">
        {messages.map((message, index) => (
          <li key={index} className="whitespace-pre-wrap break-words">
            {message.type === 'rows'
              ? `(${formatNumber(message.count)} row${message.count === 1 ? '' : 's'} affected)`
              : message.text}
          </li>
        ))}
      </ul>
    </div>
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
