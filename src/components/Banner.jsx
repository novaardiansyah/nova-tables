import Icon from './Icon.jsx'

const STYLES = {
  info: {
    icon: 'info',
    wrap: 'border-accent/25 bg-accent-soft text-slate-200',
    iconClass: 'text-accent',
  },
  success: {
    icon: 'check-circle',
    wrap: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
    iconClass: 'text-emerald-400',
  },
  warn: {
    icon: 'alert-triangle',
    wrap: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
    iconClass: 'text-amber-400',
  },
  error: {
    icon: 'alert-triangle',
    wrap: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    iconClass: 'text-rose-400',
  },
}

export default function Banner({ type = 'info', message, onDismiss }) {
  if (!message) return null
  const style = STYLES[type] || STYLES.info

  return (
    <div
      className={`flex items-start gap-2.5 border-b px-4 py-2 text-[length:calc(12.5px*var(--app-font-scale))] animate-fade-in ${style.wrap}`}
      role="status"
    >
      <Icon name={style.icon} size={14} className={`mt-0.5 shrink-0 ${style.iconClass}`} />
      <p className="flex-1 leading-5">{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="icon-btn h-5 w-5" title="Dismiss">
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </div>
  )
}
