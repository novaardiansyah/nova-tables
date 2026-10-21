import Icon from './Icon.jsx'

const STYLES = {
  info: {
    icon: 'info',
    wrap: 'border-accent/25 bg-accent-soft text-text',
    iconClass: 'text-accent',
  },
  success: {
    icon: 'check-circle',
    wrap: 'border-success/25 bg-success/10 text-success',
    iconClass: 'text-success',
  },
  warn: {
    icon: 'alert-triangle',
    wrap: 'border-warning/25 bg-warning/10 text-warning',
    iconClass: 'text-warning',
  },
  error: {
    icon: 'alert-triangle',
    wrap: 'border-danger/30 bg-danger/10 text-danger',
    iconClass: 'text-danger',
  },
}

export default function Banner({ type = 'info', message, onDismiss }) {
  if (!message) return null
  const style = STYLES[type] || STYLES.info

  return (
    <div
      className={`flex items-start gap-2.5 border-b px-4 py-2 text-[length:var(--app-text-12)] animate-fade-in ${style.wrap}`}
      role="status"
    >
      <Icon name={style.icon} size={14} className={`mt-0.5 shrink-0 ${style.iconClass}`} />
      <p className="flex-1 leading-[calc(var(--app-text-12)+8px)]">{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="icon-btn h-5 w-5" title="Dismiss">
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </div>
  )
}
