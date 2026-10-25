import { useEffect, useState } from 'react'
import EnvironmentBadge from './EnvironmentBadge.jsx'
import Icon from './Icon.jsx'

export default function ExportConnectionsDialog({
  open,
  connections = [],
  initialSelectedIds = [],
  busy = false,
  onClose,
  onExport,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    const ids = initialSelectedIds.length > 0
      ? initialSelectedIds
      : connections.map((conn) => conn.id)
    setSelectedIds(new Set(ids))
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setError(null)
  }, [open, connections, initialSelectedIds])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === connections.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(connections.map((conn) => conn.id)))
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (selectedIds.size === 0) {
      setError('Select at least one connection to export.')
      return
    }
    if (!password) {
      setError('Password is required to encrypt the export.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setError(null)
    onExport(Array.from(selectedIds), password)
  }

  const allSelected = connections.length > 0 && selectedIds.size === connections.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-[2px]">
      <form
        onSubmit={handleSubmit}
        className="animate-fade-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70"
      >
        <div className="flex items-start gap-3 p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="download" size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[length:var(--app-text-14)] font-semibold text-text-strong">
              Export connections
            </h2>
            <p className="mt-1 text-[length:var(--app-text-12)] leading-[calc(var(--app-text-12)+8px)] text-text-soft">
              Connections and their folder structure are encrypted into a JSON file with your
              chosen password.
            </p>
          </div>
          <button type="button" className="icon-btn h-6 w-6" onClick={onClose} disabled={busy}>
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4 space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[length:var(--app-text-11)] font-medium text-text-muted">
                Connections ({selectedIds.size} of {connections.length} selected)
              </span>
              <button
                type="button"
                className="btn-ghost h-6 px-2 text-[length:var(--app-text-11)]"
                onClick={toggleAll}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-panel/50 p-1 divide-y divide-line/40">
              {connections.map((conn) => {
                const checked = selectedIds.has(conn.id)
                return (
                  <label
                    key={conn.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-tint/[0.04]"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-line-strong accent-accent"
                      checked={checked}
                      onChange={() => toggleSelect(conn.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[length:var(--app-text-12)] font-medium text-text">
                          {conn.name}
                        </span>
                        <EnvironmentBadge environment={conn.environment} />
                      </div>
                      <span className="block truncate text-[length:var(--app-text-10)] text-text-faint">
                        {conn.host}:{conn.port}
                        {conn.database ? ` · ${conn.database}` : ''}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <div>
              <label className="field-label block" htmlFor="export-password">
                Encryption password
              </label>
              <div className="relative">
                <input
                  id="export-password"
                  className="field pr-9"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password to encrypt file"
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={14} />
                </button>
              </div>
            </div>

            <div>
              <label className="field-label block" htmlFor="export-confirm-password">
                Confirm password
              </label>
              <input
                id="export-confirm-password"
                className="field"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
              />
            </div>
          </div>

          {error ? (
            <p className="text-[length:var(--app-text-11)] text-danger">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" className="btn-soft" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={selectedIds.size === 0 || !password || busy}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </form>
    </div>
  )
}
