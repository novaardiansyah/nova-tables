export const ORDER_META_KEY = 'tree_order'

export function readMeta(handle, key) {
  const row = handle.get('SELECT value FROM meta WHERE key = ?', key)
  return row ? row.value : null
}

export function writeMeta(handle, key, value) {
  handle.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    String(value),
  ])
}

export function byName(left, right) {
  return String(left.name).localeCompare(String(right.name))
}

export function readOrder(handle) {
  const raw = readMeta(handle, ORDER_META_KEY)
  if (!raw) return { connections: [], folders: [] }
  try {
    const parsed = JSON.parse(raw)
    return {
      connections: Array.isArray(parsed.connections) ? parsed.connections.map(String) : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders.map(String) : [],
    }
  } catch {
    return { connections: [], folders: [] }
  }
}

export function orderRank(handle, key) {
  const order = readOrder(handle)[key]
  return new Map(order.map((id, index) => [id, index]))
}

export function normalizeOrder(handle, table, ids) {
  const rows = handle.all(`SELECT id, name FROM ${table}`)
  const known = new Set(rows.map((row) => row.id))
  const ordered = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id)
    if (!known.has(key) || ordered.includes(key)) continue
    ordered.push(key)
  }
  const rest = rows
    .filter((row) => !ordered.includes(row.id))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map((row) => row.id)
  return [...ordered, ...rest]
}

export function removeTreeOrderEntries(handle, connectionIds, folderIds) {
  const order = readOrder(handle)
  const nextConnections = order.connections.filter((id) => !connectionIds.includes(id))
  const nextFolders = order.folders.filter((id) => !folderIds.includes(id))
  writeMeta(handle, ORDER_META_KEY, JSON.stringify({ connections: nextConnections, folders: nextFolders }))
}

export function folderSubtreeIds(handle, ids) {
  const found = new Set()
  const queue = [...ids]
  while (queue.length > 0) {
    const id = queue.shift()
    if (found.has(id)) continue
    if (!handle.get('SELECT 1 AS found FROM folders WHERE id = ?', id)) continue
    found.add(id)
    for (const row of handle.all('SELECT id FROM folders WHERE parent_id = ?', [id])) queue.push(row.id)
  }
  return found
}
