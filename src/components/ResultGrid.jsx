import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const RENDER_LIMIT = 2000
const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/

const SPECIAL_VALUES = [
  { label: 'NULL', hint: 'null', value: null },
  { label: 'DEFAULT', hint: 'column default', value: { special: 'DEFAULT' } },
  { label: 'GETDATE()', hint: 'now', value: { special: 'GETDATE()' } },
]

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
}

export default function ResultGrid({
  columns,
  rows,
  relations,
  onRelationClick,
  selection = null,
  onSelectionChange,
  onCellContextMenu,
  editable = false,
  edits = {},
  onCellChange,
}) {
  const [sort, setSort] = useState(null)
  const [active, setActive] = useState(null)
  const draggingRef = useRef(false)
  const draggedRef = useRef(false)

  useEffect(() => {
    setSort(null)
  }, [rows])

  useEffect(() => {
    setActive(null)
  }, [editable, rows])

  useEffect(() => {
    const stop = () => {
      draggingRef.current = false
      window.setTimeout(() => {
        draggedRef.current = false
      }, 0)
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const orderedRows = useMemo(() => {
    const entries = rows.map((row, origIndex) => ({ row, origIndex }))
    if (!sort || sort.index >= columns.length) return entries

    const factor = sort.direction === 'asc' ? 1 : -1
    const columnIndex = sort.index

    return entries.sort((left, right) => {
      const leftValue = left.row[columnIndex]
      const rightValue = right.row[columnIndex]
      const leftEmpty = leftValue === null || leftValue === undefined
      const rightEmpty = rightValue === null || rightValue === undefined
      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) return 0
        return leftEmpty ? 1 : -1
      }
      return factor * compareValues(leftValue, rightValue)
    })
  }, [columns.length, rows, sort])

  const visibleRows = useMemo(
    () => (orderedRows.length > RENDER_LIMIT ? orderedRows.slice(0, RENDER_LIMIT) : orderedRows),
    [orderedRows],
  )

  const handleSort = (index) => {
    setSort((prev) => {
      if (!prev || prev.index !== index) return { index, direction: 'asc' }
      return { index, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
    })
  }

  const relationMap = useMemo(() => {
    const map = new Map()
    for (const relation of relations ?? []) {
      map.set(String(relation.column).toLowerCase(), relation)
    }
    return map
  }, [relations])

  const columnRelations = useMemo(
    () => columns.map((column) => relationMap.get(String(column.name).toLowerCase()) ?? null),
    [columns, relationMap],
  )

  const numericColumns = useMemo(
    () =>
      columns.map((_, index) => {
        let hasNumber = false
        for (const entry of visibleRows) {
          const value = entry.row[index]
          if (value === null || value === undefined) continue
          if (typeof value !== 'number') return false
          hasNumber = true
        }
        return hasNumber
      }),
    [columns, visibleRows],
  )

  const cellValue = (origIndex, columnIndex) => rows[origIndex]?.[columnIndex]

  const bounds = useMemo(() => {
    if (!selection) return null
    return {
      rowStart: Math.min(selection.anchor.row, selection.focus.row),
      rowEnd: Math.max(selection.anchor.row, selection.focus.row),
      colStart: Math.min(selection.anchor.col, selection.focus.col),
      colEnd: Math.max(selection.anchor.col, selection.focus.col),
    }
  }, [selection])

  const inSelection = (origIndex, colIndex) =>
    Boolean(
      bounds &&
        origIndex >= bounds.rowStart &&
        origIndex <= bounds.rowEnd &&
        colIndex >= bounds.colStart &&
        colIndex <= bounds.colEnd,
    )

  const rowSelected = (origIndex) =>
    Boolean(bounds && origIndex >= bounds.rowStart && origIndex <= bounds.rowEnd)

  const handleCellClick = (origIndex, columnIndex) => {
    if (draggedRef.current) return
    if (!editable || !onCellChange) return
    if (columnRelations[columnIndex]) return
    setActive({ row: origIndex, col: columnIndex })
  }

  const handleCellContextMenu = (event, origIndex, columnIndex) => {
    event.preventDefault()
    setActive(null)
    if (!inSelection(origIndex, columnIndex) && onSelectionChange) {
      onSelectionChange({ anchor: { row: origIndex, col: columnIndex }, focus: { row: origIndex, col: columnIndex } })
    }
    onCellContextMenu?.(event.clientX, event.clientY, origIndex, columnIndex)
  }

  const handleCellMouseDown = (event, origIndex, columnIndex) => {
    if (event.button !== 0 || !onSelectionChange) return
    event.stopPropagation()
    draggingRef.current = true
    if (event.shiftKey) {
      onSelectionChange((current) =>
        current ? { anchor: current.anchor, focus: { row: origIndex, col: columnIndex } } : current,
      )
      return
    }
    onSelectionChange({ anchor: { row: origIndex, col: columnIndex }, focus: { row: origIndex, col: columnIndex } })
  }

  const handleCellMouseEnter = (origIndex, columnIndex) => {
    if (!draggingRef.current || !onSelectionChange) return
    draggedRef.current = true
    onSelectionChange((current) =>
      current ? { anchor: current.anchor, focus: { row: origIndex, col: columnIndex } } : current,
    )
  }

  const handleRowHeaderMouseDown = (event, origIndex) => {
    if (event.button !== 0 || !onSelectionChange) return
    event.stopPropagation()
    draggingRef.current = true
    const last = Math.max(columns.length - 1, 0)
    onSelectionChange({ anchor: { row: origIndex, col: 0 }, focus: { row: origIndex, col: last } })
  }

  const handleRowHeaderMouseEnter = (origIndex) => {
    if (!draggingRef.current || !onSelectionChange) return
    draggedRef.current = true
    const last = Math.max(columns.length - 1, 0)
    onSelectionChange((current) =>
      current ? { anchor: current.anchor, focus: { row: origIndex, col: last } } : current,
    )
  }

  const commitEdit = (value) => {
    if (!active || !onCellChange) return
    const column = columns[active.col]
    if (!column) return
    onCellChange(active.row, column.name, value, cellValue(active.row, active.col))
    setActive(null)
  }

  const cancelEdit = () => setActive(null)

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[var(--grid-font-size)] text-text-muted">
          Query returned no rows
          {columns.length > 0 ? ` (${columns.length} columns)` : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table
        className="min-w-full border-separate border-spacing-0"
        style={{ fontFamily: 'var(--grid-font-family)', fontSize: 'var(--grid-font-size)' }}
      >
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-line bg-elevated px-2 py-1.5 text-right text-[length:calc(var(--grid-font-size)-2px)] font-medium text-text-faint">
              #
            </th>
            {columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                className={`sticky top-0 z-20 whitespace-nowrap border-b border-line bg-elevated text-[length:calc(var(--grid-font-size)-1px)] font-semibold tracking-wide text-text-soft ${
                  numericColumns[index] ? 'text-right' : 'text-left'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSort(index)}
                  title={`Sort by ${column.name}`}
                  className={`group/sort flex w-full items-center gap-1.5 px-3 py-1.5 hover:text-text ${
                    numericColumns[index] ? 'justify-end' : ''
                  }`}
                >
                  <span>{column.name}</span>
                  <Icon
                    name={
                      sort?.index === index
                        ? sort.direction === 'asc'
                          ? 'sort-asc'
                          : 'sort-desc'
                        : 'sort-idle'
                    }
                    size={11}
                    className={`shrink-0 ${
                      sort?.index === index
                        ? 'text-accent'
                        : 'text-text-faint opacity-0 group-hover/sort:opacity-100'
                    }`}
                  />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, origIndex }, visibleIdx) => (
            <tr key={origIndex} className={`group ${rowSelected(origIndex) ? 'bg-tint/[0.04]' : ''}`}>
              <td
                onMouseDown={(event) => handleRowHeaderMouseDown(event, origIndex)}
                onMouseEnter={() => handleRowHeaderMouseEnter(origIndex)}
                className={`sticky left-0 z-10 cursor-pointer border-b border-r border-line px-2 py-[5px] text-right font-mono text-[length:calc(var(--grid-font-size)-2px)] text-text-faint group-hover:bg-row-hover ${
                  rowSelected(origIndex) ? 'bg-tint/[0.04]' : 'bg-surface'
                }`}
              >
                {visibleIdx + 1}
              </td>
              {columns.map((column, colIndex) => {
                const cellKey = `${origIndex}:${column.name}`
                const dirty = cellKey in edits
                const display = dirty ? edits[cellKey].value : row[colIndex]
                return (
                  <td
                    key={column.name}
                    onClick={() => handleCellClick(origIndex, colIndex)}
                    onMouseDown={(event) => handleCellMouseDown(event, origIndex, colIndex)}
                    onMouseEnter={() => handleCellMouseEnter(origIndex, colIndex)}
                    onContextMenu={(event) => handleCellContextMenu(event, origIndex, colIndex)}
                    title={dirty ? 'Pending update' : undefined}
                    className={`relative whitespace-nowrap border-b border-line/70 px-3 py-[5px] group-hover:bg-row-hover ${
                      numericColumns[colIndex] ? 'text-right tabular-nums' : ''
                    } ${inSelection(origIndex, colIndex) ? 'bg-accent/[0.12]' : dirty ? 'bg-warning/[0.08]' : ''} ${
                      editable && !columnRelations[colIndex] ? 'cursor-text' : ''
                    }`}
                  >
                    {active?.row === origIndex && active?.col === colIndex ? (
                      <CellEditor
                        value={display}
                        onCommit={commitEdit}
                        onCancel={cancelEdit}
                      />
                    ) : columnRelations[colIndex] && display !== null && display !== undefined ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onRelationClick(columnRelations[colIndex], display)
                        }}
                        className="cursor-pointer border-b border-dashed border-text-muted/50 hover:border-text-soft"
                      >
                        {String(display)}
                      </button>
                    ) : (
                      <Cell value={display} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {orderedRows.length > RENDER_LIMIT ? (
        <p className="px-3 py-2 text-[length:calc(var(--grid-font-size)-1px)] text-text-muted">
          Showing the first {RENDER_LIMIT.toLocaleString()} of {orderedRows.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  )
}

function Cell({ value }) {
  if (value && value.special) {
    return <span className="font-mono text-[length:calc(var(--grid-font-size)-1px)] text-warning">{value.special}</span>
  }

  if (value === null || value === undefined) {
    return <span className="font-mono text-[length:calc(var(--grid-font-size)-1px)] italic text-text-faint">NULL</span>
  }

  if (typeof value === 'number') {
    return <span className="text-text">{String(value)}</span>
  }

  const text = String(value)
  const isDate = DATE_RE.test(text)
  const isLong = text.length > 64

  return (
    <span
      className={`inline-block max-w-[420px] truncate align-bottom ${
        isDate ? 'text-info' : 'text-text'
      }`}
      title={isLong ? text : undefined}
    >
      {text}
    </span>
  )
}

function CellEditor({ value, onCommit, onCancel }) {
  const isSpecial = Boolean(value && value.special)
  const isNull = !isSpecial && (value === null || value === undefined)
  const initial = isSpecial ? value.special : isNull ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  const [highlight, setHighlight] = useState(-1)

  const query = draft.trim().toLowerCase()
  const matches = SPECIAL_VALUES.filter((option) => option.label.toLowerCase().includes(query))

  const finish = (next) => {
    const text = next.trim()
    const exact = SPECIAL_VALUES.find((option) => option.label.toLowerCase() === text.toLowerCase())
    if (exact) {
      onCommit(exact.value)
      return
    }
    if (isSpecial) {
      onCommit(text === '' ? null : next)
      return
    }
    if (isNull) {
      onCommit(text === '' ? null : next)
      return
    }
    if (typeof value === 'number') {
      if (text === '') {
        onCommit(null)
        return
      }
      const parsed = Number(text)
      if (Number.isFinite(parsed)) {
        onCommit(parsed)
        return
      }
    }
    onCommit(next)
  }

  return (
    <span
      className="absolute inset-0 z-[15] flex items-center bg-base px-0.5"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        type="text"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setHighlight(-1)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!matches.length) return
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setHighlight((prev) => (prev + step + matches.length) % matches.length)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (highlight >= 0) {
              onCommit(matches[highlight].value)
              return
            }
            finish(draft)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => finish(draft)}
        autoFocus
        className="h-full w-full min-w-0 rounded border border-accent/60 bg-base px-1 text-[length:inherit] text-text outline-none"
        style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
      />

      {matches.length ? (
        <span className="absolute left-0 top-[calc(100%+2px)] z-40 flex w-52 flex-col rounded-md border border-line-strong bg-elevated p-1 shadow-2xl shadow-black/60">
          {matches.map((option, index) => (
            <button
              key={option.label}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => onCommit(option.value)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[length:var(--app-text-11)] transition-colors hover:bg-tint/[0.05] ${
                index === highlight ? 'bg-tint/[0.05] text-accent' : 'text-text'
              }`}
            >
              <span className="font-mono">{option.label}</span>
              <span className="text-[length:var(--app-text-10)] text-text-faint">{option.hint}</span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}
