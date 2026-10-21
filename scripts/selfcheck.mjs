import assert from 'node:assert/strict'
import { EXECUTION_MODES, executionGuard, getModeById } from '../src/queryModes.js'

assert.equal(EXECUTION_MODES.length, 3)
assert.deepEqual(
  EXECUTION_MODES.map((mode) => mode.id),
  ['silent', 'alert', 'safe'],
)

assert.equal(executionGuard('silent'), null)
assert.deepEqual(executionGuard('alert'), { kind: 'confirm' })
assert.deepEqual(executionGuard('safe'), { kind: 'password' })
assert.equal(executionGuard('unknown'), null)

assert.equal(getModeById('nope').id, 'silent')
assert.equal(getModeById('safe').label, 'Safe Mode')

console.log('queryModes self-check passed')
