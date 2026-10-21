export function quoteIdentifier(name) {
  return `[${String(name).replace(/]/g, ']]')}]`
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value.special) return value.special
  if (value instanceof Date) return `N'${value.toISOString().replace('T', ' ').slice(0, 23)}'`
  return `N'${String(value).replace(/'/g, "''")}'`
}

export function rowCondition(primaryKey, keyIndexes, row) {
  return primaryKey
    .map((name, position) => {
      const value = row[keyIndexes[position]]
      if (value === null || value === undefined) return `${quoteIdentifier(name)} IS NULL`
      return `${quoteIdentifier(name)} = ${sqlLiteral(value)}`
    })
    .join('\n   AND ')
}

export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value.special) return value.special
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function cleanText(matrix) {
  return matrix.map((cells) => cells.map(cellText).join('\t')).join('\n')
}

export function sqlInsertRows(table, columnNames, matrix) {
  const target = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`
  const columns = columnNames.map(quoteIdentifier).join(', ')
  return matrix
    .map(
      (cells) =>
        `INSERT INTO ${target} (${columns})\nVALUES (${cells.map(sqlLiteral).join(', ')});`,
    )
    .join('\n\n')
}

export function jsonRecords(columnNames, matrix) {
  const records = matrix.map((cells) => {
    const record = {}
    columnNames.forEach((name, index) => {
      record[name] = cells[index] ?? null
    })
    return record
  })
  return JSON.stringify(records, null, 2)
}
