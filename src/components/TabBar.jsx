import Icon, { Spinner } from './Icon.jsx'

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onNewTab }) {
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-panel">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const status = tab.state.status

          return (
            <div
              key={tab.id}
              className={`group flex min-w-0 max-w-[220px] shrink-0 items-center border-r border-line ${
                isActive ? 'bg-base' : 'hover:bg-white/[0.03]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                title={tab.title}
                className={`flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-3 pr-1 text-left text-[12px] ${
                  isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {status === 'running' ? (
                  <Spinner size={11} className="shrink-0 text-accent" />
                ) : (
                  <span
                    className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                      status === 'error'
                        ? 'bg-rose-400'
                        : status === 'success'
                          ? 'bg-emerald-400/80'
                          : 'bg-slate-700'
                    }`}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                title="Close tab (Ctrl+W)"
                className={`icon-btn mr-1 h-5 w-5 shrink-0 ${
                  isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-60'
                } hover:opacity-100`}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={onNewTab}
          title="New tab (Ctrl+T)"
          className="icon-btn ml-1 my-1.5 h-6 w-6 shrink-0"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
    </div>
  )
}
