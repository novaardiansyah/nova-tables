import { useEffect } from 'react'
import Icon from './Icon.jsx'

const GROUPS = [
  {
    title: 'Workspace',
    items: [
      { keys: ['Ctrl', 'W'], label: 'Close the active tab' },
      { keys: ['Ctrl', 'T'], label: 'Open a new query tab' },
      { keys: ['Ctrl', 'Tab'], label: 'Next tab' },
      { keys: ['Ctrl', 'Shift', 'Tab'], label: 'Previous tab' },
      { keys: ['Ctrl', '1…9'], label: 'Jump to tab by position' },
    ],
  },
  {
    title: 'Query',
    items: [
      { keys: ['Ctrl', '↵'], label: 'Run the active tab' },
      { keys: ['F5'], label: 'Run the active tab' },
    ],
  },
  {
    title: 'Connections',
    items: [{ keys: ['Ctrl', 'N'], label: 'Open the new connection dialog' }],
  },
  {
    title: 'Help',
    items: [{ keys: ['F1'], label: 'Toggle this panel' }],
  },
]

export default function ShortcutPanel({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg animate-fade-in rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <Icon name="question" size={15} className="text-accent" />
          <h2 className="text-[14px] font-semibold text-slate-100">Keyboard shortcuts</h2>
          <button type="button" className="icon-btn ml-auto h-6 w-6" title="Close" onClick={onClose}>
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-4 last:mb-0">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {group.title}
              </p>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.label + item.keys.join()} className="flex items-center gap-3">
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <span key={key} className="kbd">
                          {key}
                        </span>
                      ))}
                    </span>
                    <span className="text-[12.5px] text-slate-400">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="mt-1 border-t border-line pt-3 text-[11.5px] text-slate-600">
            In the editor, Monaco keeps its own keys, so Ctrl+F, Ctrl+D and friends still work there.
          </p>
        </div>
      </div>
    </div>
  )
}
