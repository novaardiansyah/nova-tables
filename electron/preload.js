import { contextBridge, ipcRenderer } from 'electron'

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
  databases: {
    list: (input) => ipcRenderer.invoke('db:databases', input),
  },
  tables: {
    list: (input) => ipcRenderer.invoke('db:tables', input),
    structure: (input) => ipcRenderer.invoke('db:table-structure', input),
    relations: (input) => ipcRenderer.invoke('db:table-relations', input),
  },
  query: {
    run: (input) => ipcRenderer.invoke('query:run', input),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },
})
