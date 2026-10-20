import Icon, { Spinner } from './Icon.jsx'

export default function StatusBar({ session, activeDatabase, queryStatus }) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-[length:var(--app-text-10)] text-slate-500">
      <div className="flex min-w-0 items-center gap-3">
        {session ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="server" size={11} className="shrink-0 text-slate-600" />
              <span className="truncate">{session.serverName}</span>
            </span>
            {session.serverVersion ? (
              <>
                <span className="text-slate-700">•</span>
                <span className="shrink-0">SQL Server {session.serverVersion}</span>
              </>
            ) : null}
            {session.edition ? (
              <>
                <span className="text-slate-700">•</span>
                <span className="hidden truncate xl:block">{session.edition}</span>
              </>
            ) : null}
          </>
        ) : (
          <span>Ready</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {activeDatabase ? (
          <span className="flex items-center gap-1.5">
            <Icon name="database" size={10} className="text-slate-600" />
            {activeDatabase}
          </span>
        ) : null}

        {queryStatus === 'running' ? (
          <span className="flex items-center gap-1.5 text-accent">
            <Spinner size={10} />
            Executing
          </span>
        ) : null}
        {queryStatus === 'success' ? (
          <span className="flex items-center gap-1.5 text-emerald-400/80">
            <Icon name="check-circle" size={10} />
            Query succeeded
          </span>
        ) : null}
        {queryStatus === 'error' ? (
          <span className="flex items-center gap-1.5 text-rose-400">
            <Icon name="alert-triangle" size={10} />
            Query failed
          </span>
        ) : null}
      </div>
    </footer>
  )
}
