import { useEffect, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'
import Select from './Select.jsx'
import {
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  FONT_SIZES,
  QUERY_SIZES,
  THEMES,
  applySettings,
  normalizeSettings,
} from '../settings.js'

const THEME_OPTIONS = THEMES.map((theme) => ({ value: theme.id, label: theme.label }))

const FONT_OPTIONS = FONT_FAMILIES.map((family) => ({ value: family.id, label: family.label }))

const SIZE_OPTIONS = FONT_SIZES.map((size) => ({ value: String(size), label: `${size} px` }))

const QUERY_SIZE_OPTIONS = QUERY_SIZES.map((size) => ({ value: String(size), label: `${size} px` }))

function Row({ label, hint, children }) {
  return (
    <div className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-[length:var(--app-text-12)] text-text">{label}</p>
        {hint ? <p className="text-[length:var(--app-text-11)] text-text-muted">{hint}</p> : null}
      </div>
      <div className="flex items-center justify-end gap-2">{children}</div>
    </div>
  )
}

export default function SettingsDialog({ open, settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(settings)
    setSaving(false)
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    applySettings(draft)
  }, [open, draft])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const update = (key) => (value) => setDraft((prev) => ({ ...prev, [key]: value }))

  const handleCancel = () => {
    applySettings(settings)
    onClose()
  }

  const handleReset = () => setDraft({ ...DEFAULT_SETTINGS })

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(normalizeSettings(draft))
    } catch {
      setSaving(false)
      return
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) handleCancel()
      }}
    >
      <div className="max-h-[92vh] w-full max-w-xl animate-fade-in overflow-auto rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/70">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="settings" size={16} />
          </span>
          <div className="flex-1">
            <h2 className="text-[length:var(--app-text-14)] font-semibold text-text-strong">Preferences</h2>
            <p className="text-[length:var(--app-text-11)] text-text-muted">Theme and typography for the workspace.</p>
          </div>
          <button type="button" className="icon-btn" onClick={handleCancel} title="Close" disabled={saving}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-4">
          <section>
            <p className="field-label">Appearance</p>
            <Row label="Color theme">
              <Select
                value={draft.theme}
                options={THEME_OPTIONS}
                onChange={update('theme')}
                icon="settings"
                placeholder="Select theme"
                emptyLabel="No themes"
                className="w-56"
              />
            </Row>
          </section>

          <section className="border-t border-line pt-4">
            <p className="field-label">App</p>
            <Row label="Font" hint="Sidebar, tabs, headers and dialogs">
              <div className="flex items-center gap-2">
                <Select
                  value={draft.appFontFamily}
                  options={FONT_OPTIONS}
                  onChange={update('appFontFamily')}
                  icon="settings"
                  placeholder="Select font"
                  emptyLabel="No fonts"
                  className="w-44"
                />
                <Select
                  value={String(draft.appFontSize)}
                  options={SIZE_OPTIONS}
                  onChange={(value) => update('appFontSize')(Number(value))}
                  icon="settings"
                  placeholder="Select size"
                  emptyLabel="No sizes"
                  className="w-24"
                />
              </div>
            </Row>
          </section>

          <section className="border-t border-line pt-4">
            <p className="field-label">Result grid</p>
            <Row label="Font">
              <div className="flex items-center gap-2">
                <Select
                  value={draft.gridFontFamily}
                  options={FONT_OPTIONS}
                  onChange={update('gridFontFamily')}
                  icon="grid"
                  placeholder="Select font"
                  emptyLabel="No fonts"
                  className="w-44"
                />
                <Select
                  value={String(draft.gridFontSize)}
                  options={SIZE_OPTIONS}
                  onChange={(value) => update('gridFontSize')(Number(value))}
                  icon="grid"
                  placeholder="Select size"
                  emptyLabel="No sizes"
                  className="w-24"
                />
              </div>
            </Row>
          </section>

          <section className="border-t border-line pt-4">
            <p className="field-label">JSON viewer</p>
            <Row label="Font">
              <div className="flex items-center gap-2">
                <Select
                  value={draft.jsonFontFamily}
                  options={FONT_OPTIONS}
                  onChange={update('jsonFontFamily')}
                  icon="folder"
                  placeholder="Select font"
                  emptyLabel="No fonts"
                  className="w-44"
                />
                <Select
                  value={String(draft.jsonFontSize)}
                  options={SIZE_OPTIONS}
                  onChange={(value) => update('jsonFontSize')(Number(value))}
                  icon="folder"
                  placeholder="Select size"
                  emptyLabel="No sizes"
                  className="w-24"
                />
              </div>
            </Row>
          </section>

          <section className="border-t border-line pt-4">
            <p className="field-label">Query editor</p>
            <Row label="Font" hint="SQL editor and its line numbers">
              <div className="flex items-center gap-2">
                <Select
                  value={draft.queryFontFamily}
                  options={FONT_OPTIONS}
                  onChange={update('queryFontFamily')}
                  icon="code"
                  placeholder="Select font"
                  emptyLabel="No fonts"
                  className="w-44"
                />
                <Select
                  value={String(draft.queryFontSize)}
                  options={QUERY_SIZE_OPTIONS}
                  onChange={(value) => update('queryFontSize')(Number(value))}
                  icon="code"
                  placeholder="Select size"
                  emptyLabel="No sizes"
                  className="w-24"
                />
              </div>
            </Row>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <button type="button" className="btn-ghost" onClick={handleReset} disabled={saving}>
              <Icon name="refresh" size={13} />
              Reset to defaults
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-soft" onClick={handleCancel} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Spinner size={13} /> : <Icon name="check-circle" size={13} />}
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
