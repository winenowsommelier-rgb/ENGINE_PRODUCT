import { NextRequest, NextResponse } from 'next/server';
import { signToken, COOKIE_NAME, MAX_AGE } from '@/lib/auth';

const B2B_PASSWORD = process.env.B2B_PASSWORD ?? '';

// Pure-JS constant-time string comparison — prevents timing attacks.
// Works in both Edge and Node without any crypto API.
function timingSafeEqual(a: string, b: string): boolean {
  // Always iterate over the longer length to avoid short-circuit on length mismatch.
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submitted = body.password ?? '';

  if (!B2B_PASSWORD || !timingSafeEqual(submitted, B2B_PASSWORD)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = await signToken();
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
