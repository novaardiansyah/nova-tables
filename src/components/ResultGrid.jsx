import { useMemo } from 'react'

// Rendering every row of a large result set would freeze the UI. The full data
// still crosses IPC, only the DOM is limited.
const RENDER_LIMIT = 2000
const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/

export default function ResultGrid({ columns, rows }) {
  const visibleRows = useMemo(
    () => (rows.length > RENDER_LIMIT ? rows.slice(0, RENDER_LIMIT) : rows),
    [rows],
  )

  const numericColumns = useMemo(
    () =>
      columns.map((_, index) => {
        let hasNumber = false
        for (const row of visibleRows) {
          const value = row[index]
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
        <p className="text-[12.5px] text-slate-500">
          Query returned no rows
          {columns.length > 0 ? ` (${columns.length} columns)` : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-line bg-elevated px-2 py-1.5 text-right text-[10.5px] font-medium text-slate-600">
              #
            </th>
            {columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                className={`sticky top-0 z-20 whitespace-nowrap border-b border-line bg-elevated px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-400 ${
                  numericColumns[index] ? 'text-right' : 'text-left'
                }`}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="group">
              <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-[5px] text-right font-mono text-[10.5px] text-slate-600 group-hover:bg-[#161c26]">
                {rowIndex + 1}
              </td>
              {columns.map((_, index) => (
                <td
                  key={index}
                  className={`whitespace-nowrap border-b border-line/70 px-3 py-[5px] group-hover:bg-[#161c26] ${
                    numericColumns[index] ? 'text-right tabular-nums' : ''
                  }`}
                >
                  <Cell value={row[index]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > RENDER_LIMIT ? (
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Showing the first {RENDER_LIMIT.toLocaleString()} of {rows.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  )
}

function Cell({ value }) {
  if (value === null || value === undefined) {
    return <span className="font-mono text-[11.5px] italic text-slate-600">NULL</span>
  }

  if (typeof value === 'number') {
    return <span className="text-slate-200">{String(value)}</span>
  }

  if (typeof value === 'boolean') {
    return <span className={value ? 'text-emerald-400' : 'text-rose-400'}>{String(value)}</span>
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
