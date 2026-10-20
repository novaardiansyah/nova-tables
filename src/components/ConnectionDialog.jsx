import { useEffect, useRef, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'

const DEFAULTS = {
  name: '',
  host: 'localhost',
  port: '1433',
  username: 'sa',
  password: '',
  database: '',
  encrypt: true,
  trustServerCertificate: true,
}

function buildInitial(connection) {
  if (!connection) return { ...DEFAULTS }
  return {
    name: connection.name || '',
    host: connection.host || '',
    port: String(connection.port || 1433),
    username: connection.username || '',
    password: '',
    database: connection.database || '',
    encrypt: connection.encrypt !== false,
    trustServerCertificate: connection.trustServerCertificate !== false,
  }
}

export default function ConnectionDialog({
  mode,
  connection,
  notice,
  onClose,
  onSubmit,
  onTest,
}) {
  const isEdit = mode === 'edit' && Boolean(connection?.id)
  const [form, setForm] = useState(() => buildInitial(connection))
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  const update = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
    setTestResult(null)
  }

  function validate() {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Name is required'
    if (!form.host.trim()) errors.host = 'Host is required'
    if (!form.username.trim()) errors.username = 'Username is required'
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'Invalid port'
    return errors
  }

  function payload() {
    const data = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      database: form.database.trim(),
      encrypt: form.encrypt,
      trustServerCertificate: form.trustServerCertificate,
    }
    if (isEdit) data.id = connection.id
    if (!isEdit || form.password !== '') data.password = form.password
    return data
  }

  async function handleTest() {
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    if (!onTest) return

    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const result = await onTest(payload())
      const details = [result.serverName, result.productVersion ? `SQL Server ${result.productVersion}` : null, result.edition]
        .filter(Boolean)
        .join(' · ')
      setTestResult({
        ok: true,
        message: `${details} — connected in ${result.elapsedMs} ms`,
      })
    } catch (testError) {
      setTestResult({ ok: false, message: testError.message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    setError(null)
    try {
      await onSubmit(payload())
    } catch (submitError) {
      setError(submitError.message)
      if (submitError.fields) setFieldErrors(submitError.fields)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg animate-fade-in overflow-auto rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="server" size={16} />
          </span>
          <div className="flex-1">
            <h2 className="text-[length:var(--app-text-14)] font-semibold text-slate-100">
              {isEdit ? 'Edit connection' : 'New SQL Server connection'}
            </h2>
            <p className="text-[length:var(--app-text-11)] text-slate-500">
              {isEdit ? 'Update the connection details below.' : 'Connect to a Microsoft SQL Server instance.'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close" disabled={saving}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {notice ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[length:var(--app-text-12)] leading-5 text-amber-200">
              <Icon name="info" size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <span>{notice}</span>
            </div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="conn-name">
              Connection name
            </label>
            <input
              id="conn-name"
              className="field"
              value={form.name}
              onChange={update('name')}
              placeholder="Production database"
              autoFocus
            />
            <FieldError message={fieldErrors.name} />
          </div>

          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div>
              <label className="field-label" htmlFor="conn-host">
                Host
              </label>
              <input
                id="conn-host"
                className="field"
                value={form.host}
                onChange={update('host')}
                placeholder="localhost"
                spellCheck={false}
              />
              <FieldError message={fieldErrors.host} />
            </div>
            <div>
              <label className="field-label" htmlFor="conn-port">
                Port
              </label>
              <input
                id="conn-port"
                className="field"
                value={form.port}
                onChange={update('port')}
                placeholder="1433"
                inputMode="numeric"
              />
              <FieldError message={fieldErrors.port} />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="conn-database">
              Database <span className="normal-case text-slate-600">(optional)</span>
            </label>
            <input
              id="conn-database"
              className="field"
              value={form.database}
              onChange={update('database')}
              placeholder="Leave blank to browse all databases"
              spellCheck={false}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="conn-username">
                Username
              </label>
              <input
                id="conn-username"
                className="field"
                value={form.username}
                onChange={update('username')}
                placeholder="sa"
                spellCheck={false}
                autoComplete="off"
              />
              <FieldError message={fieldErrors.username} />
            </div>
            <div>
              <label className="field-label" htmlFor="conn-password">
                Password
              </label>
              <div className="relative">
                <input
                  id="conn-password"
                  className="field pr-9"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={update('password')}
                  placeholder={isEdit && connection?.hasPassword ? 'Unchanged' : 'Password'}
                  autoComplete="new-password"
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
          </div>

          {isEdit && connection?.hasPassword ? (
            <p className="-mt-2 text-[length:var(--app-text-11)] text-slate-500">
              Leave the password blank to keep the saved password.
            </p>
          ) : null}

          <div className="space-y-2 rounded-lg border border-line bg-base px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2.5 text-[length:var(--app-text-12)] text-slate-300">
              <input
                type="checkbox"
                checked={form.encrypt}
                onChange={update('encrypt')}
                className="h-3.5 w-3.5 accent-accent"
              />
              Encrypt connection (TLS)
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 text-[length:var(--app-text-12)] text-slate-300">
              <input
                type="checkbox"
                checked={form.trustServerCertificate}
                onChange={update('trustServerCertificate')}
                className="h-3.5 w-3.5 accent-accent"
              />
              Trust server certificate
            </label>
          </div>

          <p className="text-[length:var(--app-text-11)] leading-4 text-slate-600">
            Passwords are protected with Electron safeStorage and are never exposed to the interface.
          </p>

          {testResult ? (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[length:var(--app-text-12)] leading-5 ${
                testResult.ok
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
              }`}
            >
              <Icon
                name={testResult.ok ? 'check-circle' : 'alert-triangle'}
                size={13}
                className={`mt-0.5 shrink-0 ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}
              />
              <span className="break-words">{testResult.message}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[length:var(--app-text-12)] leading-5 text-rose-200">
              <Icon name="alert-triangle" size={13} className="mt-0.5 shrink-0 text-rose-400" />
              <span className="break-words">{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <button type="button" className="btn-ghost" onClick={handleTest} disabled={testing || saving}>
              {testing ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
              Test connection
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-soft" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving || testing}>
                {saving ? <Spinner size={13} /> : <Icon name="check-circle" size={13} />}
                {isEdit ? 'Save changes' : 'Create connection'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-[length:var(--app-text-11)] text-rose-400">{message}</p>
}
