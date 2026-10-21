import assert from 'node:assert/strict'
import { executionGuard, getModeById, isReadOnlyQuery } from '../src/queryModes.js'

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
assert.deepEqual(executionGuard('alert-readonly', 'SELECT 1'), null)
assert.deepEqual(executionGuard('alert-readonly', 'DELETE FROM dbo.Users'), { kind: 'confirm' })
assert.deepEqual(executionGuard('safe', 'SELECT 1'), { kind: 'password' })
assert.deepEqual(executionGuard('safe-readonly', 'SELECT 1'), null)
assert.deepEqual(executionGuard('safe-readonly', 'DROP TABLE dbo.Users'), { kind: 'password' })

assert.equal(getModeById('nope').id, 'silent')
assert.equal(getModeById('safe-readonly').label, 'Safe Mode 2')

console.log('queryModes self-check passed')
