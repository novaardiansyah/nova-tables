import { useState } from 'react'
import { api } from '../api.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import PromptDialog from './PromptDialog.jsx'

const PREVIEW_LIMIT = 400

export default function QueryGuardDialog({ open, kind, sql, mode, connectionId, onCancel, onConfirm }) {
  const [error, setError] = useState('')

  const preview = String(sql || '').trim().slice(0, PREVIEW_LIMIT)

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
        title="Connection password"
        description={mode?.description}
        detail={preview}
        label="Password"
        type="password"
        placeholder="••••••••"
        error={error}
        confirmLabel="Unlock & send"
        onCancel={onCancel}
        onConfirm={handlePassword}
      />
    )
  }

  return (
    <ConfirmDialog
      open={open}
      title="Send query to the server?"
      message={mode?.description}
      detail={preview}
      confirmLabel="Send"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
