import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

export default function Select({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  icon = 'database',
  placeholder = 'Select database',
  emptyLabel = 'No databases',
  panelAlign = 'left',
  panelClassName = 'w-64',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const current = options.find((option) => option.value === value)

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-full max-w-[240px] items-center gap-2 rounded-md border border-line-strong bg-elevated px-2.5 text-[length:var(--app-text-12)] text-text transition-colors hover:border-accent/50 disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon name={icon} size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? value ?? placeholder}</span>
        <Icon
          name="chevron-down"
          size={13}
          className={`ml-auto shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          className={`absolute top-[calc(100%+6px)] z-40 max-h-80 animate-fade-in overflow-auto rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl shadow-black/60 ${panelAlign === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} ${panelClassName}`}
        >
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-[length:var(--app-text-12)] text-text-muted">{emptyLabel}</p>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[length:var(--app-text-12)] transition-colors hover:bg-tint/[0.05] ${
                  option.value === value ? 'text-accent' : 'text-text'
                }`}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? <Icon name="check-circle" size={13} /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
