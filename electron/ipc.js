import { app, clipboard, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  addQueryHistory,
  clearQueryHistory,
  deleteConnection,
  deleteConnections,
  deleteFolder,
  deleteFolders,
  deleteQueryHistoryItem,
  deleteSavedQuery,
  exportConnections,
  getLastConnectedId,
  importConnections,
  listConnections,
  listFolders,
  listQueryHistory,
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
  describeResult,
  disconnectConnection,
  dropDatabase,
  listDatabases,
  listColumns,
  listModules,
  listTables,
  moduleDefinition,
  runQuery,
  getExecutionPlan,
  tableRelations,
  tableStructure,
  testConnection,
} from './sqlServer.js'
import {
  createDatabaseUser,
  dropDatabaseUser,
  listDatabaseUsers,
  updateDatabaseUserRoles,
} from './databaseUsers.js'
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

  handle('connections:last-connected', () => ({ lastConnectedId: getLastConnectedId() }))

  handle('connections:save', (input) => ({ connection: saveConnection(input) }))

  handle('connections:delete', (id) => ({ deleted: deleteConnection(id), connectionId: id }))

  handle('connections:move', (input) => ({
    moved: moveConnection(input.id, input.folderId),
    connectionId: input.id,
  }))

  handle('connections:export', async ({ connectionIds, password }) => {
    const { content, count } = exportConnections(connectionIds, password)
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'nova-tables-connections.json',
      filters: [{ name: 'Nova Tables Connections (*.json)', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { saved: false, canceled: true }
    await fs.promises.writeFile(filePath, content, 'utf8')
    return { saved: true, filePath, count }
  })

  handle('connections:select-import-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Nova Tables Connections (*.json)', extensions: ['json'] },
        { name: 'All Files (*.*)', extensions: ['*'] },
      ],
    })
    if (canceled || !filePaths?.length) return { canceled: true }
    const filePath = filePaths[0]
    const content = await fs.promises.readFile(filePath, 'utf8')
    return { canceled: false, filePath, fileName: path.basename(filePath), content }
  })

  handle('connections:import', async ({ content, password }) => {
    return importConnections(content, password)
  })

  handle('folders:list', () => ({ folders: listFolders() }))

  handle('folders:save', (input) => ({ folder: saveFolder(input) }))

  handle('folders:delete', (id) => ({ deleted: deleteFolder(id), folderId: id }))

  handle('tree:reorder', (input) => updateTreeOrder(input))

  handle('tree:delete', (input) => {
    const folders = deleteFolders(input?.folderIds ?? [])
    const connections = deleteConnections(input?.connectionIds ?? [])
    return {
      folderIds: folders.folderIds,
      connectionIds: [...folders.connectionIds, ...connections],
      connections: listConnections(),
      folders: listFolders(),
    }
  })

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

  handle('query:run', async (input) => {
    const started = Date.now()
    const record = (entry) => {
      if (!input.recordHistory) return
      try {
        addQueryHistory({ connectionId: input.connectionId, database: input.database, sql: input.sql, ...entry })
      } catch {}
    }
    try {
      const result = await runQuery(input)
      record({ status: 'success', durationMs: result.elapsedMs, rowCount: result.rowCount })
      return result
    } catch (error) {
      record({ status: 'error', durationMs: Date.now() - started, errorMessage: error.message })
      throw error
    }
  })

  handle('query:plan', (input) => getExecutionPlan(input))

  handle('query-history:list', (input) => ({
    history: listQueryHistory(input.connectionId, input.database, input.limit),
  }))

  handle('query-history:clear', (input) => ({
    cleared: clearQueryHistory(input.connectionId, input.database),
  }))

  handle('query-history:delete', (id) => ({
    deleted: deleteQueryHistoryItem(id),
    id,
  }))

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

  handle('file:save', async ({ defaultPath, filters, content }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    if (canceled || !filePath) return { saved: false, canceled: true }
    await fs.promises.writeFile(filePath, content, 'utf8')
    return { saved: true, filePath }
  })
}
