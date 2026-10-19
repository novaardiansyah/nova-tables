import { app, ipcMain } from 'electron'
import {
  deleteConnection,
  listConnections,
  saveConnection,
} from './connectionStore.js'
import {
  connect,
  disconnectConnection,
  listDatabases,
  listTables,
  runQuery,
  testConnection,
} from './sqlServer.js'
import { toErrorPayload } from './serialize.js'

const ok = (data) => ({ ok: true, ...(data || {}) })
const fail = (error) => ({ ok: false, error: toErrorPayload(error) })

// Every handler answers with { ok: true, ...data } or { ok: false, error } so
// the renderer never has to deal with raw exceptions crossing IPC.
function handle(channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return ok(await handler(payload))
    } catch (error) {
      return fail(error)
    }
  })
}

export function registerIpcHandlers() {
  handle('connections:list', () => ({ connections: listConnections() }))

  handle('connections:save', (input) => ({ connection: saveConnection(input) }))

  handle('connections:delete', (id) => ({ deleted: deleteConnection(id), connectionId: id }))

  handle('connections:test', (input) => testConnection(input))

  handle('connections:connect', (input) => connect(input))

  handle('connections:disconnect', (connectionId) => disconnectConnection(connectionId))

  handle('db:databases', (input) => listDatabases(input))

  handle('db:tables', (input) => listTables(input))

  handle('query:run', (input) => runQuery(input))

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}
