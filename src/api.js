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

  testConnection: async (input) => call(() => bridge().connections.test(input)),

  connect: async (input) => call(() => bridge().connections.connect(input)),

  disconnect: async (connectionId) =>
    call(() => bridge().connections.disconnect(connectionId)),

  listDatabases: async (connectionId) =>
    (await call(() => bridge().databases.list({ connectionId }))).databases,

  listTables: async (connectionId, database) =>
    (await call(() => bridge().tables.list({ connectionId, database }))).tables,

  runQuery: async (input) => call(() => bridge().query.run(input)),

  appInfo: async () => call(() => bridge().app.info()),
}
