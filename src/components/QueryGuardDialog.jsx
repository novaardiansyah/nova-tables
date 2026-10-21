import { useState } from 'react'
import { api } from '../api.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import PromptDialog from './PromptDialog.jsx'

export default function QueryGuardDialog({ open, kind, sql, connectionId, onCancel, onConfirm }) {
  const [error, setError] = useState('')

  const query = String(sql || '').trim()

  const handlePassword = async (password) => {
    setError('')
    try {
      await api.verifyPassword(connectionId, password)
      onConfirm()
    } catch (failure) {
      setError(failure.message)
    }
  }

  if (!open) return null

  if (kind === 'password') {
    return (
      <PromptDialog
        open={open}
        title="Send query to the server?"
        detail={query}
        label="Password"
        type="password"
        placeholder="••••••••"
        error={error}
        confirmLabel="Send"
        onCancel={onCancel}
        onConfirm={handlePassword}
      />
    )
  }

  return (
    <ConfirmDialog
      open={open}
      title="Send query to the server?"
      detail={query}
      confirmLabel="Send"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
