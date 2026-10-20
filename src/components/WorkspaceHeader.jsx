import Icon, { Spinner } from './Icon.jsx'
import Select from './Select.jsx'

export default function WorkspaceHeader({
  session,
  activeDatabase,
  running,
  onSelectDatabase,
  onRun,
  onDisconnect,
  onShowShortcuts,
}) {
  const options = (session?.databases ?? []).map((database) => ({
    value: database.name,
    label: database.isOnline ? database.name : `${database.name} (offline)`,
  }))

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
      {session ? (
        <>
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          <span className="max-w-[220px] truncate text-[length:var(--app-text-13)] font-medium text-slate-100" title={session.name}>
            {session.name}
          </span>
          <span className="text-slate-700">/</span>
          <Select
            value={activeDatabase}
            options={options}
            onChange={onSelectDatabase}
            disabled={options.length === 0}
          />
          <span className="hidden truncate text-[length:var(--app-text-11)] text-slate-600 lg:block">
            {session.host}:{session.port}
          </span>
        </>
      ) : (
        <>
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-slate-700" />
          <span className="text-[length:var(--app-text-13)] text-slate-400">No connection open</span>
          <span className="hidden text-[length:var(--app-text-11)] text-slate-600 lg:block">
            Pick a saved connection in the sidebar to start browsing.
          </span>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="icon-btn"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts (F1)"
        >
          <Icon name="question" size={15} />
        </button>

        <button
          type="button"
          className="btn-primary"
          onClick={onRun}
          disabled={!session || running}
          title="Run query (Ctrl+Enter)"
        >
          {running ? <Spinner size={13} /> : <Icon name="play" size={12} />}
          Run
          <span className="kbd border-white/25 bg-white/10 text-white/80">Ctrl</span>
          <span className="kbd border-white/25 bg-white/10 text-white/80">↵</span>
        </button>

        {session ? (
          <button type="button" className="icon-btn" onClick={onDisconnect} title="Close connection">
            <Icon name="power" size={15} />
          </button>
        ) : null}
      </div>
    </header>
  )
}
