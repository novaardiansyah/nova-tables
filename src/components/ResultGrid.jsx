import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'

const RENDER_LIMIT = 2000
const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
}

export default function ResultGrid({
  columns,
  rows,
  relations,
  onRelationClick,
  onRowClick,
  selectedIndex,
}) {
  const [sort, setSort] = useState(null)

  useEffect(() => {
    setSort(null)
  }, [rows])

  const orderedRows = useMemo(() => {
    const entries = rows.map((row, index) => ({ row, index }))
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

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[var(--grid-font-size)] text-slate-500">
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
            <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-line bg-elevated px-2 py-1.5 text-right text-[length:calc(var(--grid-font-size)-2px)] font-medium text-slate-600">
              #
            </th>
            {columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                className={`sticky top-0 z-20 whitespace-nowrap border-b border-line bg-elevated text-[length:calc(var(--grid-font-size)-1px)] font-semibold tracking-wide text-slate-400 ${
                  numericColumns[index] ? 'text-right' : 'text-left'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSort(index)}
                  title={`Sort by ${column.name}`}
                  className={`group/sort flex w-full items-center gap-1.5 px-3 py-1.5 hover:text-slate-200 ${
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
                        : 'text-slate-600 opacity-0 group-hover/sort:opacity-100'
                    }`}
                  />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, index }, rowIndex) => (
            <tr
              key={index}
              onClick={() => onRowClick(index)}
              className={`group cursor-pointer ${selectedIndex === index ? 'bg-white/[0.04]' : ''}`}
            >
              <td
                className={`sticky left-0 z-10 border-b border-r border-line px-2 py-[5px] text-right font-mono text-[length:calc(var(--grid-font-size)-2px)] text-slate-600 group-hover:bg-row-hover ${
                  selectedIndex === index ? 'bg-white/[0.04]' : 'bg-surface'
                }`}
              >
                {rowIndex + 1}
              </td>
              {columns.map((_, index) => (
                <td
                  key={index}
                  className={`whitespace-nowrap border-b border-line/70 px-3 py-[5px] group-hover:bg-row-hover ${
                    numericColumns[index] ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {columnRelations[index] && row[index] !== null && row[index] !== undefined ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRelationClick(columnRelations[index], row[index])
                      }}
                      className="cursor-pointer border-b border-dashed border-slate-500/50 hover:border-slate-300"
                    >
                      {String(row[index])}
                    </button>
                  ) : (
                    <Cell value={row[index]} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {orderedRows.length > RENDER_LIMIT ? (
        <p className="px-3 py-2 text-[length:calc(var(--grid-font-size)-1px)] text-slate-500">
          Showing the first {RENDER_LIMIT.toLocaleString()} of {orderedRows.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  )
}

function Cell({ value }) {
  if (value === null || value === undefined) {
    return <span className="font-mono text-[length:calc(var(--grid-font-size)-1px)] italic text-slate-600">NULL</span>
  }

  if (typeof value === 'number') {
    return <span className="text-slate-200">{String(value)}</span>
  }

  const text = String(value)
  const isDate = DATE_RE.test(text)
  const isLong = text.length > 64

  return (
    <span
      className={`inline-block max-w-[420px] truncate align-bottom ${
        isDate ? 'text-sky-300' : 'text-slate-300'
      }`}
      title={isLong ? text : undefined}
    >
      {text}
    </span>
  )
}
