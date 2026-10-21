import assert from 'node:assert/strict'
import { EXECUTION_MODES, executionGuard, getModeById, isReadOnlyQuery } from '../src/queryModes.js'

assert.equal(EXECUTION_MODES.length, 3)
assert.deepEqual(
  EXECUTION_MODES.map((mode) => mode.id),
  ['silent', 'alert-readonly', 'alert'],
)

assert.equal(isReadOnlyQuery('SELECT * FROM dbo.Users'), true)
assert.equal(isReadOnlyQuery('  with cte as (select 1) select * from cte'), true)
assert.equal(isReadOnlyQuery('-- select 1\nselect 2'), true)
assert.equal(isReadOnlyQuery('/* insert */ select 1'), true)
assert.equal(isReadOnlyQuery('INSERT INTO dbo.Users VALUES (1)'), false)
assert.equal(isReadOnlyQuery('select * from dbo.Users; delete from dbo.Users'), false)
assert.equal(isReadOnlyQuery('UPDATE dbo.Users SET name = 1'), false)
assert.equal(isReadOnlyQuery('exec dbo.sp_Who'), false)
assert.equal(isReadOnlyQuery('CREATE TABLE t (id int)'), false)
assert.equal(isReadOnlyQuery(''), true)

assert.equal(executionGuard('silent', 'DELETE FROM dbo.Users'), null)
assert.deepEqual(executionGuard('alert', 'SELECT 1'), { kind: 'confirm' })
assert.equal(executionGuard('alert-readonly', 'SELECT 1'), null)
assert.deepEqual(executionGuard('alert-readonly', 'DELETE FROM dbo.Users'), { kind: 'confirm' })
assert.equal(executionGuard('unknown', 'SELECT 1'), null)

assert.equal(getModeById('nope').id, 'silent')
assert.equal(getModeById('alert').label, 'Full Alert Mode')

console.log('queryModes self-check passed')
