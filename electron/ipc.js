import { app, clipboard, ipcMain } from 'electron'
import {
  deleteConnection,
  deleteFolder,
  deleteSavedQuery,
  listConnections,
  listFolders,
  listSavedQueries,
  moveConnection,
  readSettings,
  renameSavedQuery,
  saveConnection,
  saveFolder,
  saveSavedQuery,
  updateTreeOrder,
  writeSettings,
} from './connectionStore.js'
import {
  connect,
  createDatabaseUser,
  describeResult,
  disconnectConnection,
  dropDatabase,
  dropDatabaseUser,
  listDatabaseUsers,
  listDatabases,
  listColumns,
  listModules,
  listTables,
  moduleDefinition,
  runQuery,
  tableRelations,
  tableStructure,
  testConnection,
  updateDatabaseUserRoles,
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

  handle('db:drop-database', (input) => dropDatabase(input))

  handle('security:users', (input) => listDatabaseUsers(input))

  handle('security:create-user', (input) => createDatabaseUser(input))

  handle('security:update-user-roles', (input) => updateDatabaseUserRoles(input))

  handle('security:drop-user', (input) => dropDatabaseUser(input))

  handle('db:tables', (input) => listTables(input))

  handle('db:columns', (input) => listColumns(input))

  handle('db:modules', (input) => listModules(input))

  handle('db:module-definition', (input) => moduleDefinition(input))

  handle('db:table-structure', async (input) => tableStructure(input))

  handle('db:table-relations', (input) => tableRelations(input))

  handle('db:result-columns', (input) => describeResult(input))

  handle('query:run', (input) => runQuery(input))

  handle('saved-queries:list', (input) => ({
    queries: listSavedQueries(input.connectionId, input.database),
  }))

  handle('saved-queries:save', (input) => ({ query: saveSavedQuery(input) }))

  handle('saved-queries:rename', (input) => ({ query: renameSavedQuery(input) }))

  handle('saved-queries:delete', (id) => ({ deleted: deleteSavedQuery(id), queryId: id }))

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
