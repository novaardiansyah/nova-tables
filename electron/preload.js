import { contextBridge, ipcRenderer } from 'electron'

function subscribe(channel, handler) {
  const listener = () => handler()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('nova', {
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (input) => ipcRenderer.invoke('connections:save', input),
    remove: (id) => ipcRenderer.invoke('connections:delete', id),
    move: (input) => ipcRenderer.invoke('connections:move', input),
    test: (input) => ipcRenderer.invoke('connections:test', input),
    connect: (input) => ipcRenderer.invoke('connections:connect', input),
    disconnect: (connectionId) => ipcRenderer.invoke('connections:disconnect', connectionId),
  },
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    save: (input) => ipcRenderer.invoke('folders:save', input),
    remove: (id) => ipcRenderer.invoke('folders:delete', id),
  },
  tree: {
    reorder: (input) => ipcRenderer.invoke('tree:reorder', input),
  },
  databases: {
    list: (input) => ipcRenderer.invoke('db:databases', input),
    drop: (input) => ipcRenderer.invoke('db:drop-database', input),
  },
  security: {
    list: (input) => ipcRenderer.invoke('security:users', input),
    create: (input) => ipcRenderer.invoke('security:create-user', input),
    updateRoles: (input) => ipcRenderer.invoke('security:update-user-roles', input),
    drop: (input) => ipcRenderer.invoke('security:drop-user', input),
  },
  tables: {
    list: (input) => ipcRenderer.invoke('db:tables', input),
    columns: (input) => ipcRenderer.invoke('db:columns', input),
    structure: (input) => ipcRenderer.invoke('db:table-structure', input),
    relations: (input) => ipcRenderer.invoke('db:table-relations', input),
  },
  modules: {
    list: (input) => ipcRenderer.invoke('db:modules', input),
    definition: (input) => ipcRenderer.invoke('db:module-definition', input),
  },
  results: {
    columns: (input) => ipcRenderer.invoke('db:result-columns', input),
  },
  query: {
    run: (input) => ipcRenderer.invoke('query:run', input),
  },
  queryHistory: {
    list: (input) => ipcRenderer.invoke('query-history:list', input),
    clear: (input) => ipcRenderer.invoke('query-history:clear', input),
    remove: (id) => ipcRenderer.invoke('query-history:delete', id),
  },
  savedQueries: {
    list: (input) => ipcRenderer.invoke('saved-queries:list', input),
    save: (input) => ipcRenderer.invoke('saved-queries:save', input),
    rename: (input) => ipcRenderer.invoke('saved-queries:rename', input),
    remove: (id) => ipcRenderer.invoke('saved-queries:delete', id),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },
  file: {
    save: (input) => ipcRenderer.invoke('file:save', input),
  },
  events: {
    onOpenConnection: (handler) => subscribe('menu:open-connection', handler),
    onNewConnection: (handler) => subscribe('menu:new-connection', handler),
    onPreferences: (handler) => subscribe('menu:preferences', handler),
  },
})
