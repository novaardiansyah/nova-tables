import ConfirmDialog from './ConfirmDialog.jsx'

export default function QueryGuardDialog({ open, sql, onCancel, onConfirm }) {
  if (!open) return null

  return (
    <ConfirmDialog
      open={open}
      title="Send query to the server?"
      detail={String(sql || '').trim()}
      confirmLabel="Send"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
