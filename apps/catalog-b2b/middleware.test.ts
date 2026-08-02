import { describe, it, expect, vi } from 'vitest';

// Mock auth module
vi.mock('@/lib/auth', () => ({
  verifyToken: (t: string | undefined) => Promise.resolve(t === 'valid-token'),
  COOKIE_NAME: 'b2b_auth',
}));

import { middleware } from './middleware';
import { NextRequest } from 'next/server';

function makeReq(pathname: string, cookie?: string): NextRequest {
  const url = `http://localhost:3200${pathname}`;
  const headers = new Headers();
  if (cookie) headers.set('cookie', `b2b_auth=${cookie}`);
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  it('redirects / to /login without cookie', async () => {
    const res = await middleware(makeReq('/'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects /_next/data routes to /login without cookie', async () => {
    const res = await middleware(makeReq('/_next/data/BUILD_ID/index.json'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows / with valid cookie', async () => {
    const res = await middleware(makeReq('/', 'valid-token'));
    expect(res.status).not.toBe(307);
  });

  it('allows /login without cookie', async () => {
    const res = await middleware(makeReq('/login'));
    expect(res.status).not.toBe(307);
  });

  it('allows /api/login without cookie', async () => {
    const res = await middleware(makeReq('/api/login'));
    expect(res.status).not.toBe(307);
  });

  it('allows /_next/static without cookie', async () => {
    const res = await middleware(makeReq('/_next/static/chunks/main.js'));
    expect(res.status).not.toBe(307);
  });
});
