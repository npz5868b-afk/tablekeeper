const SAFE_POSTGRES_CODE = /^[0-9A-Z]{5}$/;

export function attachPoolErrorHandler(pool, { writeDiagnostic = value => process.stderr.write(value) } = {}) {
  if (!pool?.on || typeof writeDiagnostic !== 'function') throw new TypeError('pool event source and diagnostic writer required');
  const handler = error => {
    const code = SAFE_POSTGRES_CODE.test(error?.code ?? '') ? error.code : 'UNKNOWN';
    try {
      writeDiagnostic(`${JSON.stringify({ component: 'reservation-core-postgres-pool', event: 'idle-client-error', code })}\n`);
    } catch {
      // The listener's primary job is to keep an idle client error from becoming
      // an unhandled EventEmitter error; diagnostics must not reintroduce that crash.
    }
  };
  pool.on('error', handler);
  return () => pool.off?.('error', handler);
}
