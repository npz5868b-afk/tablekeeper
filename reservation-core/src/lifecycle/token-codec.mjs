import { createHmac, timingSafeEqual } from 'node:crypto';
import { LifecycleError } from './errors.mjs';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export class ConfirmationTokenCodec {
  constructor(secret) {
    if (!Buffer.isBuffer(secret) || secret.length < 32) throw new TypeError('confirmation token secret must be at least 32 bytes');
    this.secret = secret;
  }

  issue(claims) {
    const body = encode(claims);
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `tkc2.${body}.${signature}`;
  }

  verify(token, { tenantId, now }) {
    const [prefix, body, signature, extra] = String(token).split('.');
    if (prefix !== 'tkc2' || !body || !signature || extra) throw new LifecycleError('TOKEN_INVALID');
    const expected = createHmac('sha256', this.secret).update(body).digest();
    let supplied;
    try { supplied = Buffer.from(signature, 'base64url'); } catch { throw new LifecycleError('TOKEN_INVALID'); }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new LifecycleError('TOKEN_INVALID');
    let claims;
    try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new LifecycleError('TOKEN_INVALID'); }
    if (claims.tenantId !== tenantId) throw new LifecycleError('TOKEN_SCOPE_MISMATCH');
    if (new Date(claims.expiresAt) <= now) throw new LifecycleError('TOKEN_EXPIRED');
    return claims;
  }
}
