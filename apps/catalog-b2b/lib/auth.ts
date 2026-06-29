import crypto from 'crypto';

const SECRET = process.env.B2B_AUTH_SECRET ?? 'dev-secret-change-in-prod';
const VERSION = process.env.B2B_AUTH_VERSION ?? '1';
const COOKIE_NAME = 'b2b_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function signToken(): string {
  const payload = JSON.stringify({ v: VERSION, t: Date.now() });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;
  const expected = sign(b64);
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  } catch {
    return false;
  }
  // Check version
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (parsed.v !== VERSION) return false;
  } catch {
    return false;
  }
  return true;
}

export { COOKIE_NAME, MAX_AGE };
