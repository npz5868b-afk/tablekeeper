import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachPoolErrorHandler } from '../../src/http/pool-safety.mjs';

test('idle pooled-client dependency loss is handled without leaking error details', () => {
  const pool = new EventEmitter();
  const diagnostics = [];
  const detach = attachPoolErrorHandler(pool, { writeDiagnostic: value => diagnostics.push(value) });
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('postgres://user:secret@db/private-token'), { code: '57P01' })));
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(JSON.parse(diagnostics[0]), { component: 'reservation-core-postgres-pool', event: 'idle-client-error', code: '57P01' });
  assert.doesNotMatch(diagnostics[0], /secret|private-token|postgres:\/\//);
  detach();
  assert.equal(pool.listenerCount('error'), 0);
});

test('unexpected pool error codes are redacted', () => {
  const pool = new EventEmitter(); const diagnostics = [];
  attachPoolErrorHandler(pool, { writeDiagnostic: value => diagnostics.push(value) });
  pool.emit('error', { code: 'credential=value' });
  assert.equal(JSON.parse(diagnostics[0]).code, 'UNKNOWN');
});

test('diagnostic writer failure cannot crash the process-level pool listener', () => {
  const pool = new EventEmitter();
  attachPoolErrorHandler(pool, { writeDiagnostic() { throw new Error('diagnostic sink unavailable'); } });
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('database shutdown'), { code: '57P01' })));
});
