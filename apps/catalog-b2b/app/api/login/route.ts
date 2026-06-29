import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { signToken, COOKIE_NAME, MAX_AGE } from '@/lib/auth';

const B2B_PASSWORD = process.env.B2B_PASSWORD ?? '';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submitted = body.password ?? '';

  // Constant-time comparison — prevents timing attacks even when B2B_PASSWORD is unset
  const equal = (() => {
    if (!B2B_PASSWORD) return false;
    const a = Buffer.from(submitted);
    const b = Buffer.from(B2B_PASSWORD);
    if (a.length !== b.length) {
      // Still run a dummy comparison to avoid length-based timing leak
      crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  })();

  if (!equal) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = signToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
  return res;
}
