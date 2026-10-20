import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'
import JsonView from './JsonView.jsx'
import ResultGrid from './ResultGrid.jsx'

const ROW_PANEL_DEFAULT_WIDTH = 360

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function rowJson(columns, row) {
  if (!row) return ''
  const record = {}
  columns.forEach((column, index) => {
    record[column.name] = row[index] ?? null
  })
  return JSON.stringify(record, null, 2)
}

export default function ResultsPanel({ state, activeSet, onSelectSet, relations, onRelationClick }) {
  const { status, result, error } = state
  const resultSets = result?.resultSets ?? []
  const activeIndex = Math.min(activeSet ?? 0, Math.max(resultSets.length - 1, 0))
  const activeResultSet = resultSets[activeIndex]
  const rowsAffected = (result?.rowsAffected ?? []).reduce((total, count) => total + count, 0)
  const [selectedRow, setSelectedRow] = useState(null)
  const [panelWidth, setPanelWidth] = useState(ROW_PANEL_DEFAULT_WIDTH)
  const splitRef = useRef(null)

  const handleSelectRow = useCallback((index) => {
    setSelectedRow((prev) => (prev === index ? null : index))
  }, [])

  useEffect(() => {
    setSelectedRow(null)
  }, [result])

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

  const selectedValues =
    selectedRow === null || !activeResultSet ? null : activeResultSet.rows[selectedRow] ?? null

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      {status === 'running' ? <div className="progress-track shrink-0" /> : <div className="h-px shrink-0 bg-line" />}

      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2">
        {status === 'error' ? (
          <span className="flex items-center gap-1.5 px-2 text-[length:calc(11.5px*var(--app-font-scale))] font-medium text-rose-400">
            <Icon name="alert-triangle" size={12} />
            Error
          </span>
        ) : null}

        {status === 'running' ? (
          <span className="flex items-center gap-1.5 px-2 text-[length:calc(11.5px*var(--app-font-scale))] text-slate-400">
            <Spinner size={12} />
            Running query…
          </span>
        ) : null}

        {status !== 'error' && status !== 'running' && resultSets.length === 0 ? (
          <span className="px-2 text-[length:calc(11.5px*var(--app-font-scale))] font-medium text-slate-400">Results</span>
        ) : null}

        {status !== 'error' && resultSets.length > 0
          ? resultSets.map((set, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onSelectSet(index)
                  setSelectedRow(null)
                }}
                className={`flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[length:calc(11.5px*var(--app-font-scale))] transition-colors ${
                  index === activeIndex
                    ? 'bg-white/[0.06] text-slate-100'
                    : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300'
                }`}
              >
                Result {index + 1}
                <span className="rounded bg-black/25 px-1 text-[length:calc(10px*var(--app-font-scale))] tabular-nums text-slate-500">
                  {formatNumber(set.rowCount)}
                </span>
              </button>
            ))
          : null}

        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-[length:calc(11px*var(--app-font-scale))] text-slate-500">
          {status === 'success' && result ? (
            <>
              <span className="tabular-nums">{formatNumber(result.rowCount)} rows</span>
              <span className="text-slate-700">•</span>
              <span className="tabular-nums">{formatDuration(result.elapsedMs)}</span>
              {resultSets.length > 1 ? (
                <>
                  <span className="text-slate-700">•</span>
                  <span>{resultSets.length} result sets</span>
                </>
              ) : null}
            </>
          ) : null}
          {status === 'error' && error?.code ? (
            <span className="font-mono text-[length:calc(10.5px*var(--app-font-scale))] text-slate-600">{error.code}</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {status === 'idle' ? <IdleState /> : null}
        {status === 'running' ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-[length:calc(12.5px*var(--app-font-scale))] text-slate-500">
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
                <p className="border-b border-line bg-amber-500/[0.06] px-3 py-1.5 text-[length:calc(11px*var(--app-font-scale))] text-amber-300/90">
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
                    onRowClick={handleSelectRow}
                    selectedIndex={selectedRow}
                  />
                </div>

                {selectedRow !== null && selectedValues ? (
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
                        <Icon name="grid" size={12} className="shrink-0 text-slate-500" />
                        <span className="text-[length:calc(11px*var(--app-font-scale))] font-medium text-slate-400">
                          Row {selectedRow + 1}
                        </span>
                        <button
                          type="button"
                          className="icon-btn ml-auto h-5 w-5"
                          title="Close"
                          onClick={() => setSelectedRow(null)}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                      <JsonView text={rowJson(activeResultSet.columns, selectedValues)} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  )
}

function IdleState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-elevated text-slate-600">
        <Icon name="grid" size={19} />
      </span>
      <div>
        <p className="text-[length:calc(13px*var(--app-font-scale))] text-slate-400">No query results yet</p>
        <p className="mt-1 text-[length:calc(11.5px*var(--app-font-scale))] text-slate-600">
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
      <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
            <Icon name="alert-triangle" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[length:calc(10.5px*var(--app-font-scale))] font-semibold uppercase tracking-wider text-rose-400/80">
              Query failed
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[length:calc(12px*var(--app-font-scale))] leading-5 text-rose-100">
              {error?.message || 'Unknown error'}
            </p>
            {details.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:calc(10.5px*var(--app-font-scale))] text-rose-300/60">
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
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
        <Icon name="check-circle" size={18} />
      </span>
      <p className="text-[length:calc(13px*var(--app-font-scale))] text-slate-300">Query completed successfully</p>
      <p className="text-[length:calc(11.5px*var(--app-font-scale))] text-slate-500">
        {rowsAffected > 0 ? `${formatNumber(rowsAffected)} rows affected` : 'No rows returned'} ·{' '}
        {formatDuration(elapsedMs)}
      </p>
    </div>
  )
}
