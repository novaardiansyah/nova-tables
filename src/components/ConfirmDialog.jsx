import { useEffect } from 'react'
import Icon from './Icon.jsx'

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]">
      <div className="w-full max-w-sm animate-fade-in rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70">
        <div className="flex items-start gap-3 p-5">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              danger ? 'bg-rose-500/15 text-rose-400' : 'bg-accent-soft text-accent'
            }`}
          >
            <Icon name={danger ? 'alert-triangle' : 'info'} size={15} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[length:var(--app-text-14)] font-semibold text-slate-100">{title}</h2>
            {message ? <p className="mt-1 text-[length:var(--app-text-12)] leading-[calc(var(--app-text-12)+8px)] text-slate-400">{message}</p> : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" className="btn-soft" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
