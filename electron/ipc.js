import { app, clipboard, ipcMain } from 'electron'
import {
  deleteConnection,
  deleteFolder,
  listConnections,
  listFolders,
  moveConnection,
  readSettings,
  saveConnection,
  saveFolder,
  updateTreeOrder,
  writeSettings,
} from './connectionStore.js'
import {
  connect,
  disconnectConnection,
  listDatabases,
  listModules,
  listTables,
  moduleDefinition,
  runQuery,
  tableRelations,
  tableStructure,
  testConnection,
} from './sqlServer.js'
import { toErrorPayload } from './serialize.js'

const ok = (data) => ({ ok: true, ...(data || {}) })
const fail = (error) => ({ ok: false, error: toErrorPayload(error) })

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

  handle('connections:move', (input) => ({
    moved: moveConnection(input.id, input.folderId),
    connectionId: input.id,
  }))

  handle('folders:list', () => ({ folders: listFolders() }))

  handle('folders:save', (input) => ({ folder: saveFolder(input) }))

  handle('folders:delete', (id) => ({ deleted: deleteFolder(id), folderId: id }))

  handle('tree:reorder', (input) => updateTreeOrder(input))

  handle('connections:test', (input) => testConnection(input))

  handle('connections:connect', (input) => connect(input))

  handle('connections:disconnect', (connectionId) => disconnectConnection(connectionId))

  handle('db:databases', (input) => listDatabases(input))

  handle('db:tables', (input) => listTables(input))

  handle('db:modules', (input) => listModules(input))

  handle('db:module-definition', (input) => moduleDefinition(input))

  handle('db:table-structure', async (input) => tableStructure(input))

  handle('db:table-relations', (input) => tableRelations(input))

  handle('query:run', (input) => runQuery(input))

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
  }))

  handle('settings:get', () => ({ settings: readSettings() }))

  handle('settings:save', (settings) => ({ settings: writeSettings(settings) }))

  handle('clipboard:write-text', (text) => {
    clipboard.writeText(String(text ?? ''))
    return { written: true }
  })
}
