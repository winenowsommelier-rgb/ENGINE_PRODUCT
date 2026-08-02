// Web Crypto API — available in both Edge Runtime (middleware) and Node.js serverless.
// We cannot use Node's `crypto` module here because middleware runs on the Edge Runtime.

const VERSION = process.env.B2B_AUTH_VERSION ?? '1';
export const COOKIE_NAME = 'b2b_auth';
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secretBytes(): Uint8Array {
  const secret = process.env.B2B_AUTH_SECRET ?? 'dev-secret-change-in-prod';
  return new TextEncoder().encode(secret);
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secretBytes().buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return atob(pad ? padded + '='.repeat(4 - pad) : padded);
}

export async function signToken(): Promise<string> {
  const payload = JSON.stringify({ v: VERSION, t: Date.now() });
  const b64 = base64urlEncode(payload);
  const key = await importKey();
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64));
  const sig = toHex(sigBuf);
  return `${b64}.${sig}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;

  let sigBytes: Uint8Array;
  try {
    sigBytes = fromHex(sig);
  } catch {
    return false;
  }

  const key = await importKey();
  const data = new TextEncoder().encode(b64);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, data);
  if (!valid) return false;

  try {
    const parsed = JSON.parse(base64urlDecode(b64));
    if (parsed.v !== VERSION) return false;
  } catch {
    return false;
  }
  return true;
}
