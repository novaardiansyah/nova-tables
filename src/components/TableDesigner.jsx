import { useEffect, useRef, useState } from 'react'
import Icon, { Spinner } from './Icon.jsx'
import Select from './Select.jsx'
import { generateAlterTable, generateCreateTable } from '../designSql.js'

const COLUMN_TYPES = [
  { value: 'bigint', length: false },
  { value: 'binary', length: true },
  { value: 'bit', length: false },
  { value: 'char', length: true },
  { value: 'date', length: false },
  { value: 'datetime', length: false },
  { value: 'datetime2', scale: true },
  { value: 'datetimeoffset', scale: true },
  { value: 'decimal', precision: true },
  { value: 'float', length: false },
  { value: 'image', length: false },
  { value: 'int', length: false },
  { value: 'money', length: false },
  { value: 'nchar', length: true },
  { value: 'ntext', length: false },
  { value: 'numeric', precision: true },
  { value: 'nvarchar', length: true },
  { value: 'real', length: false },
  { value: 'smalldatetime', length: false },
  { value: 'smallint', length: false },
  { value: 'smallmoney', length: false },
  { value: 'text', length: false },
  { value: 'time', scale: true },
  { value: 'tinyint', length: false },
  { value: 'uniqueidentifier', length: false },
  { value: 'varbinary', length: true },
  { value: 'varchar', length: true },
  { value: 'xml', length: false },
]

const TYPE_BY_NAME = new Map(COLUMN_TYPES.map((type) => [type.value, type]))
const TYPE_OPTIONS = COLUMN_TYPES.map((type) => ({ value: type.value, label: type.value }))

const BLANK_COLUMN = {
  name: '',
  typeName: 'int',
  maxLength: 4,
  precision: 18,
  scale: 0,
  isNullable: true,
  isIdentity: false,
  isComputed: false,
  computedDefinition: null,
  seedValue: 1,
  incrementValue: 1,
  collation: null,
  databaseCollation: null,
}

const NEW_TABLE_TEMPLATE = {
  schema: 'dbo',
  table: '',
  columns: [{ ...BLANK_COLUMN, name: 'id', isIdentity: true, isNullable: false }],
  primaryKey: [],
  uniqueKeys: [],
  foreignKeys: [],
  indexes: [],
  statement: '',
}

function Editor({ label, value, onChange, placeholder, className = '', disabled = false }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      <input
        className="field"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
      />
    </label>
  )
}

function Section({ title, count, onAdd, addLabel, children }) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[length:var(--app-text-11)] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        {count !== undefined ? <span className="text-[length:var(--app-text-11)] text-slate-600">{count}</span> : null}
        {onAdd ? (
          <button type="button" className="btn-ghost ml-auto h-6 px-2 text-[length:var(--app-text-11)]" onClick={onAdd}>
            <Icon name="plus" size={12} />
            {addLabel}
          </button>
        ) : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

export default function TableDesigner({
  design,
  mode,
  loading,
  error,
  busy,
  onRenameTable,
  onGenerate,
  onApply,
}) {
  const [draft, setDraft] = useState(design ?? NEW_TABLE_TEMPLATE)
  const [notice, setNotice] = useState(null)
  const originalRef = useRef(design)

  useEffect(() => {
    originalRef.current = design
    setDraft(design ?? NEW_TABLE_TEMPLATE)
    setNotice(null)
  }, [design])

  const discard = () => {
    setDraft(originalRef.current ?? NEW_TABLE_TEMPLATE)
    setNotice(null)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[length:var(--app-text-12)] text-slate-500">
        <Spinner size={14} />
        Reading table definition…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[length:var(--app-text-12)] leading-5 text-rose-400">
        {error}
      </div>
    )
  }

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }))

  const updateColumn = (index, patch) =>
    setDraft((prev) => ({
      ...prev,
      columns: prev.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    }))

  const addColumn = () =>
    setDraft((prev) => ({ ...prev, columns: [...prev.columns, { ...BLANK_COLUMN, name: `column_${prev.columns.length + 1}` }] }))

  const removeColumn = (index) =>
    setDraft((prev) => {
      const removed = prev.columns[index]
      return {
        ...prev,
        columns: prev.columns.filter((_, position) => position !== index),
        primaryKey: prev.primaryKey.filter((column) => column !== removed.name),
        uniqueKeys: prev.uniqueKeys
          .map((key) => ({ ...key, columns: key.columns.filter((column) => column !== removed.name) }))
          .filter((key) => key.columns.length > 0),
        foreignKeys: prev.foreignKeys
          .map((key) => ({
            ...key,
            columns: key.columns.filter((item) => item.column !== removed.name),
          }))
          .filter((key) => key.columns.length > 0),
        indexes: prev.indexes
          .map((index) => ({ ...index, columns: index.columns.filter((column) => column !== removed.name) }))
          .filter((index) => index.columns.length > 0),
      }
    })

  const columnOptions = draft.columns
    .filter((column) => column.name)
    .map((column) => ({ value: column.name, label: column.name }))

  const primaryNames = draft.primaryKey

  const togglePrimaryColumn = (name) =>
    setDraft((prev) => ({
      ...prev,
      primaryKey: prev.primaryKey.includes(name)
        ? prev.primaryKey.filter((column) => column !== name)
        : [...prev.primaryKey, name],
    }))

  const addUnique = () =>
    setDraft((prev) => ({
      ...prev,
      uniqueKeys: [
        ...prev.uniqueKeys,
        { name: `UQ_${prev.table || 'table'}_${prev.uniqueKeys.length + 1}`, columns: [], clustered: false },
      ],
    }))

  const updateUnique = (index, patch) =>
    setDraft((prev) => ({
      ...prev,
      uniqueKeys: prev.uniqueKeys.map((key, position) => (position === index ? { ...key, ...patch } : key)),
    }))

  const removeUnique = (index) =>
    setDraft((prev) => ({ ...prev, uniqueKeys: prev.uniqueKeys.filter((_, position) => position !== index) }))

  const addForeign = () =>
    setDraft((prev) => ({
      ...prev,
      foreignKeys: [
        ...prev.foreignKeys,
        {
          name: `FK_${prev.table || 'table'}_${prev.foreignKeys.length + 1}`,
          referencedSchema: 'dbo',
          referencedTable: '',
          columns: [{ column: '', referencedColumn: '' }],
        },
      ],
    }))

  const updateForeign = (index, patch) =>
    setDraft((prev) => ({
      ...prev,
      foreignKeys: prev.foreignKeys.map((key, position) => (position === index ? { ...key, ...patch } : key)),
    }))

  const updateForeignColumn = (index, columnIndex, patch) =>
    setDraft((prev) => ({
      ...prev,
      foreignKeys: prev.foreignKeys.map((key, position) =>
        position === index
          ? { ...key, columns: key.columns.map((item, itemPosition) => (itemPosition === columnIndex ? { ...item, ...patch } : item)) }
          : key,
      ),
    }))

  const addForeignColumn = (index) =>
    setDraft((prev) => ({
      ...prev,
      foreignKeys: prev.foreignKeys.map((key, position) =>
        position === index ? { ...key, columns: [...key.columns, { column: '', referencedColumn: '' }] } : key,
      ),
    }))

  const removeForeignColumn = (index, columnIndex) =>
    setDraft((prev) => ({
      ...prev,
      foreignKeys: prev.foreignKeys.map((key, position) =>
        position === index ? { ...key, columns: key.columns.filter((_, itemPosition) => itemPosition !== columnIndex) } : key,
      ),
    }))

  const removeForeign = (index) =>
    setDraft((prev) => ({ ...prev, foreignKeys: prev.foreignKeys.filter((_, position) => position !== index) }))

  const addIndex = () =>
    setDraft((prev) => ({
      ...prev,
      indexes: [
        ...prev.indexes,
        { name: `IX_${prev.table || 'table'}_${prev.indexes.length + 1}`, columns: [], descending: [], unique: false, clustered: false },
      ],
    }))

  const updateIndex = (index, patch) =>
    setDraft((prev) => ({
      ...prev,
      indexes: prev.indexes.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    }))

  const removeIndex = (index) =>
    setDraft((prev) => ({ ...prev, indexes: prev.indexes.filter((_, position) => position !== index) }))

  const toggleIndexColumn = (index, column) =>
    setDraft((prev) => ({
      ...prev,
      indexes: prev.indexes.map((item, position) => {
        if (position !== index) return item
        const at = item.columns.indexOf(column)
        if (at === -1) return { ...item, columns: [...item.columns, column] }
        return {
          ...item,
          columns: item.columns.filter((_, itemPosition) => itemPosition !== at),
          descending: item.descending.filter((_, itemPosition) => itemPosition !== at),
        }
      }),
    }))

  const buildSql = () => {
    if (mode === 'new') return generateCreateTable(draft)
    if (!originalRef.current) return '-- Loading'
    return generateAlterTable(originalRef.current, draft)
  }

  const preview = () => {
    try {
      const text = buildSql()
      setNotice(null)
      return text
    } catch (buildError) {
      setNotice(buildError.message)
      return null
    }
  }

  const handleGenerate = () => {
    const text = preview()
    if (text) onGenerate(text)
  }

  const handleApply = () => {
    const text = preview()
    if (!text) return
    onApply(text, draft)
  }

  const handleRename = () => {
    const next = draft.table.trim()
    if (!next || next === design?.table) return
    onRenameTable(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <Icon name="table" size={13} className="shrink-0 text-slate-500" />
        <span className="text-[length:var(--app-text-11)] text-slate-500">{draft.schema}</span>
        <button
          type="button"
          onClick={() => {}}
          title={mode === 'new' ? 'New table' : 'Click to load the name into the picker below'}
          className="text-[length:var(--app-text-12)] text-slate-200"
        >
          {draft.table || '(untitled)'}
        </button>
        <span className="rounded border border-line-strong bg-white/[0.03] px-1.5 py-0.5 text-[length:var(--app-text-9)] font-semibold uppercase tracking-wider text-slate-500">
          {mode === 'new' ? 'new' : 'design'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {mode === 'edit' ? (
            <button type="button" className="btn-ghost h-6 px-2 text-[length:var(--app-text-11)]" onClick={handleRename} disabled={!draft.table.trim() || draft.table === design?.table}>
              Rename
            </button>
          ) : null}
          <button type="button" className="btn-ghost h-6 px-2 text-[length:var(--app-text-11)]" onClick={discard} disabled={busy}>
            Discard
          </button>
          <button type="button" className="btn-soft h-6 px-2 text-[length:var(--app-text-11)]" onClick={handleGenerate} disabled={busy}>
            Generate SQL
          </button>
          <button type="button" className="btn-primary h-6 px-2.5 text-[length:var(--app-text-11)]" onClick={handleApply} disabled={busy || (mode === 'new' && !draft.table.trim())}>
            {busy ? <Spinner size={11} /> : <Icon name="check-circle" size={12} />}
            Apply
          </button>
        </div>
      </div>

      {notice ? (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[length:var(--app-text-11)] leading-5 text-amber-200">
          <Icon name="alert-triangle" size={12} className="mt-0.5 shrink-0 text-amber-400" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-3">
          <Editor label="Table name" value={draft.table} onChange={(value) => update({ table: value })} placeholder="my_table" />
          <Editor label="Schema" value={draft.schema} onChange={(value) => update({ schema: value })} disabled={mode === 'edit'} placeholder="dbo" />
        </div>

        <section className="rounded-lg border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[length:var(--app-text-11)] font-semibold uppercase tracking-wider text-slate-500">Columns</span>
            <span className="text-[length:var(--app-text-11)] text-slate-600">{draft.columns.length}</span>
            <button type="button" className="btn-ghost ml-auto h-6 px-2 text-[length:var(--app-text-11)]" onClick={addColumn}>
              <Icon name="plus" size={12} />
              Add column
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[length:var(--app-text-12)]">
              <thead>
                <tr className="text-left text-[length:var(--app-text-10)] uppercase tracking-wider text-slate-600">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Length</th>
                  <th className="px-2 py-2 font-medium">Default</th>
                  <th className="px-2 py-2 text-center font-medium">Null</th>
                  <th className="px-2 py-2 text-center font-medium">Identity</th>
                  <th className="px-2 py-2 text-center font-medium">PK</th>
                  <th className="px-2 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {draft.columns.map((column, index) => {
                  const type = TYPE_BY_NAME.get(column.typeName)
                  return (
                    <tr key={index} className="border-t border-line align-top">
                      <td className="px-3 py-1.5">
                        <input
                          className="field"
                          value={column.name}
                          onChange={(event) => updateColumn(index, { name: event.target.value })}
                          placeholder="column_name"
                          spellCheck={false}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={column.typeName}
                          options={TYPE_OPTIONS}
                          onChange={(value) => updateColumn(index, { typeName: value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {type?.precision ? (
                          <div className="flex items-center gap-1">
                            <input
                              className="field w-16"
                              type="number"
                              value={column.precision ?? ''}
                              onChange={(event) => updateColumn(index, { precision: Number(event.target.value) })}
                              placeholder="18"
                            />
                            <span className="text-slate-600">,</span>
                            <input
                              className="field w-14"
                              type="number"
                              value={column.scale ?? ''}
                              onChange={(event) => updateColumn(index, { scale: Number(event.target.value) })}
                              placeholder="0"
                            />
                          </div>
                        ) : type?.scale ? (
                          <input
                            className="field w-16"
                            type="number"
                            value={column.scale ?? ''}
                            onChange={(event) => updateColumn(index, { scale: Number(event.target.value) })}
                            placeholder="7"
                          />
                        ) : type?.length ? (
                          <input
                            className="field w-20"
                            value={column.maxLength === -1 ? 'MAX' : column.maxLength ?? ''}
                            onChange={(event) => {
                              const raw = event.target.value.trim().toUpperCase()
                              if (raw === 'MAX') updateColumn(index, { maxLength: -1 })
                              else updateColumn(index, { maxLength: Number(event.target.value) || 0 })
                            }}
                            placeholder="50"
                            spellCheck={false}
                          />
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="field"
                          value={column.defaultDefinition ?? ''}
                          onChange={(event) => updateColumn(index, { defaultDefinition: event.target.value || null })}
                          placeholder="(getdate())"
                          spellCheck={false}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={column.isNullable}
                          onChange={(event) => updateColumn(index, { isNullable: event.target.checked })}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={column.isIdentity}
                          onChange={(event) => updateColumn(index, { isIdentity: event.target.checked })}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={primaryNames.includes(column.name)}
                          onChange={() => togglePrimaryColumn(column.name)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" className="icon-btn h-6 w-6 hover:text-rose-400" onClick={() => removeColumn(index)} title="Remove column">
                          <Icon name="trash" size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <Section title="Unique keys" count={draft.uniqueKeys.length} onAdd={addUnique} addLabel="Add unique key">
          {draft.uniqueKeys.length === 0 ? (
            <p className="text-[length:var(--app-text-11)] text-slate-600">No unique keys.</p>
          ) : (
            <div className="space-y-2">
              {draft.uniqueKeys.map((key, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Editor label="Name" value={key.name} onChange={(value) => updateUnique(index, { name: value })} className="w-64" />
                  <div className="flex-1">
                    <span className="field-label">Columns</span>
                    <div className="flex flex-wrap gap-1.5">
                      {columnOptions.length === 0 ? (
                        <span className="text-[length:var(--app-text-11)] text-slate-600">No columns.</span>
                      ) : (
                        columnOptions.map((option) => (
                          <label key={option.value} className="flex items-center gap-1 rounded border border-line-strong px-2 py-1 text-[length:var(--app-text-11)] text-slate-300">
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-accent"
                              checked={key.columns.includes(option.value)}
                              onChange={() =>
                                updateUnique(index, {
                                  columns: key.columns.includes(option.value)
                                    ? key.columns.filter((column) => column !== option.value)
                                    : [...key.columns, option.value],
                                })
                              }
                            />
                            {option.label}
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <button type="button" className="icon-btn h-8 w-8 hover:text-rose-400" onClick={() => removeUnique(index)} title="Remove unique key">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Foreign keys" count={draft.foreignKeys.length} onAdd={addForeign} addLabel="Add foreign key">
          {draft.foreignKeys.length === 0 ? (
            <p className="text-[length:var(--app-text-11)] text-slate-600">No foreign keys.</p>
          ) : (
            <div className="space-y-3">
              {draft.foreignKeys.map((key, index) => (
                <div key={index} className="rounded-md border border-line bg-base p-2.5">
                  <div className="flex items-end gap-2">
                    <Editor label="Name" value={key.name} onChange={(value) => updateForeign(index, { name: value })} className="w-64" />
                    <Editor label="Referenced schema" value={key.referencedSchema} onChange={(value) => updateForeign(index, { referencedSchema: value })} className="w-40" />
                    <Editor label="Referenced table" value={key.referencedTable} onChange={(value) => updateForeign(index, { referencedTable: value })} />
                    <button type="button" className="icon-btn h-8 w-8 hover:text-rose-400" onClick={() => removeForeign(index)} title="Remove foreign key">
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {key.columns.map((item, columnIndex) => (
                      <div key={columnIndex} className="flex items-center gap-2">
                        <Select
                          value={item.column}
                          options={columnOptions}
                          onChange={(value) => updateForeignColumn(index, columnIndex, { column: value })}
                        />
                        <Icon name="chevron-right" size={12} className="shrink-0 text-slate-600" />
                        <input
                          className="field w-40"
                          value={item.referencedColumn}
                          onChange={(event) => updateForeignColumn(index, columnIndex, { referencedColumn: event.target.value })}
                          placeholder="referenced column"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="icon-btn h-6 w-6 hover:text-rose-400"
                          onClick={() => removeForeignColumn(index, columnIndex)}
                          disabled={key.columns.length === 1}
                          title="Remove column pair"
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn-ghost h-6 px-2 text-[length:var(--app-text-11)]" onClick={() => addForeignColumn(index)}>
                      <Icon name="plus" size={11} />
                      Add column pair
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Indexes" count={draft.indexes.length} onAdd={addIndex} addLabel="Add index">
          {draft.indexes.length === 0 ? (
            <p className="text-[length:var(--app-text-11)] text-slate-600">No indexes.</p>
          ) : (
            <div className="space-y-2">
              {draft.indexes.map((index, position) => (
                <div key={position} className="flex items-end gap-2">
                  <Editor label="Name" value={index.name} onChange={(value) => updateIndex(position, { name: value })} className="w-64" />
                  <div className="flex-1">
                    <span className="field-label">Columns</span>
                    <div className="flex flex-wrap gap-1.5">
                      {columnOptions.length === 0 ? (
                        <span className="text-[length:var(--app-text-11)] text-slate-600">No columns.</span>
                      ) : (
                        columnOptions.map((option) => (
                          <label key={option.value} className="flex items-center gap-1 rounded border border-line-strong px-2 py-1 text-[length:var(--app-text-11)] text-slate-300">
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-accent"
                              checked={index.columns.includes(option.value)}
                              onChange={() => toggleIndexColumn(position, option.value)}
                            />
                            {option.label}
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[length:var(--app-text-11)] text-slate-400">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={index.unique} onChange={(event) => updateIndex(position, { unique: event.target.checked })} />
                    Unique
                  </label>
                  <button type="button" className="icon-btn h-8 w-8 hover:text-rose-400" onClick={() => removeIndex(position)} title="Remove index">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
