import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nova', {
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (input) => ipcRenderer.invoke('connections:save', input),
    remove: (id) => ipcRenderer.invoke('connections:delete', id),
    test: (input) => ipcRenderer.invoke('connections:test', input),
    connect: (input) => ipcRenderer.invoke('connections:connect', input),
    disconnect: (connectionId) => ipcRenderer.invoke('connections:disconnect', connectionId),
  },
  databases: {
    list: (input) => ipcRenderer.invoke('db:databases', input),
  },
  tables: {
    list: (input) => ipcRenderer.invoke('db:tables', input),
  },
  query: {
    run: (input) => ipcRenderer.invoke('query:run', input),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
})
