function bridge() {
  const api = typeof window !== 'undefined' ? window.nova : undefined
  if (!api) {
    const error = new Error('IPC bridge unavailable. Start the app with `npm run dev`.')
    error.code = 'NO_BRIDGE'
    throw error
  }
  return api
}

export class IpcError extends Error {
  constructor(payload) {
    super(payload?.message || 'Unexpected error')
    this.name = 'IpcError'
    this.code = payload?.code || null
    this.number = payload?.number ?? null
    this.lineNumber = payload?.lineNumber ?? null
    this.state = payload?.state ?? null
    this.severity = payload?.severity ?? null
    this.fields = payload?.fields || null
  }
}

async function call(invoke) {
  const response = await invoke()
  if (!response || response.ok !== true) throw new IpcError(response?.error)
  return response
}

export const api = {
  listConnections: async () =>
    (await call(() => bridge().connections.list())).connections,

  saveConnection: async (input) =>
    (await call(() => bridge().connections.save(input))).connection,

  deleteConnection: async (id) =>
    call(() => bridge().connections.remove(id)),

  moveConnection: async (id, folderId) =>
    call(() => bridge().connections.move({ id, folderId })),

  exportConnections: async (connectionIds, password) =>
    call(() => bridge().connections.export({ connectionIds, password })),

  selectImportFile: async () =>
    call(() => bridge().connections.selectImportFile()),

  importConnections: async (content, password) =>
    call(() => bridge().connections.import({ content, password })),

  listFolders: async () => (await call(() => bridge().folders.list())).folders,

  saveFolder: async (input) => (await call(() => bridge().folders.save(input))).folder,

  deleteFolder: async (id) => call(() => bridge().folders.remove(id)),

  reorderTree: async (input) => call(() => bridge().tree.reorder(input)),

  testConnection: async (input) => call(() => bridge().connections.test(input)),

  connect: async (input) => call(() => bridge().connections.connect(input)),

  disconnect: async (connectionId) =>
    call(() => bridge().connections.disconnect(connectionId)),

  listDatabases: async (connectionId) =>
    (await call(() => bridge().databases.list({ connectionId }))).databases,

  dropDatabase: async (input) => call(() => bridge().databases.drop(input)),

  listDatabaseUsers: async (connectionId, database) =>
    call(() => bridge().security.list({ connectionId, database })),

  createDatabaseUser: async (input) => call(() => bridge().security.create(input)),

  updateDatabaseUserRoles: async (input) => call(() => bridge().security.updateRoles(input)),

  dropDatabaseUser: async (input) => call(() => bridge().security.drop(input)),

  listTables: async (connectionId, database) =>
    (await call(() => bridge().tables.list({ connectionId, database }))).tables,

  listColumns: async (connectionId, database) =>
    (await call(() => bridge().tables.columns({ connectionId, database }))).tables,

  tableStructure: async (connectionId, database, schema, table) =>
    call(() => bridge().tables.structure({ connectionId, database, schema, table })),

  tableRelations: async (connectionId, database, schema, table) =>
    (await call(() => bridge().tables.relations({ connectionId, database, schema, table }))).relations,

  listModules: async (connectionId, database) =>
    (await call(() => bridge().modules.list({ connectionId, database }))).modules,

  moduleDefinition: async (connectionId, database, schema, name) =>
    call(() => bridge().modules.definition({ connectionId, database, schema, name })),

  describeResult: async (connectionId, database, sql) =>
    (await call(() => bridge().results.columns({ connectionId, database, sql }))).columns,

  runQuery: async (input) => call(() => bridge().query.run(input)),

  getExecutionPlan: async (input) => call(() => bridge().query.plan(input)),

  listQueryHistory: async (connectionId, database, limit) =>
    (await call(() => bridge().queryHistory.list({ connectionId, database, limit }))).history,

  clearQueryHistory: async (connectionId, database) =>
    call(() => bridge().queryHistory.clear({ connectionId, database })),

  deleteQueryHistory: async (id) =>
    call(() => bridge().queryHistory.remove(id)),

  listSavedQueries: async (connectionId, database) =>
    (await call(() => bridge().savedQueries.list({ connectionId, database }))).queries,

  saveSavedQuery: async (input) =>
    (await call(() => bridge().savedQueries.save(input))).query,

  renameSavedQuery: async (input) =>
    (await call(() => bridge().savedQueries.rename(input))).query,

  deleteSavedQuery: async (id) => call(() => bridge().savedQueries.remove(id)),

  copyText: async (text) => call(() => bridge().clipboard.writeText(text)),

  saveFile: async (input) => call(() => bridge().file.save(input)),

  loadSettings: async () => (await call(() => bridge().settings.get())).settings,

  saveSettings: async (settings) =>
    (await call(() => bridge().settings.save(settings))).settings,

  onOpenConnection: (handler) => bridge().events.onOpenConnection(handler),

  onNewConnection: (handler) => bridge().events.onNewConnection(handler),

  onPreferences: (handler) => bridge().events.onPreferences(handler),

  appInfo: async () => call(() => bridge().app.info()),
}
