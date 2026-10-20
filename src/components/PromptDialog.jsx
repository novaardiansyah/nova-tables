import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export default function PromptDialog({
  open,
  title,
  description,
  label,
  hint,
  confirmLabel = 'Confirm',
  initialValue,
  placeholder,
  busy,
  onCancel,
  onConfirm,
}) {
  const [value, setValue] = useState(initialValue ?? '')

  useEffect(() => {
    if (open) setValue(initialValue ?? '')
  }, [open, initialValue])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        const next = value.trim()
        if (next) { event.preventDefault(); onConfirm(next) }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, value, onCancel, onConfirm])

  if (!open) return null

  const submit = (event) => {
    event.preventDefault()
    const next = value.trim()
    if (next) onConfirm(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]">
      <form
        onSubmit={submit}
        className="animate-fade-in w-full max-w-sm overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70"
      >
        <div className="flex items-start gap-3 p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="pencil" size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[length:var(--app-text-14)] font-semibold text-slate-100">{title}</h2>
            {description ? (
              <p className="mt-1 text-[length:var(--app-text-12)] leading-5 text-slate-400">{description}</p>
            ) : null}
          </div>
          <button type="button" className="icon-btn h-6 w-6" onClick={onCancel} disabled={busy}>
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="border-t border-line px-5 py-4">
          <label className="field-label block" htmlFor="prompt-dialog-input">
            {label}
          </label>
          <input
            id="prompt-dialog-input"
            className="field"
            value={value}
            autoFocus
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
          {hint ? <p className="mt-2 text-[length:var(--app-text-11)] leading-4 text-slate-500">{hint}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" className="btn-soft" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!value || busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
