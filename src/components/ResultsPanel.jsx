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
                  setSelectedRow(null)
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
                        <Icon name="grid" size={12} className="shrink-0 text-text-muted" />
                        <span className="text-[length:var(--app-text-11)] font-medium text-text-soft">
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
