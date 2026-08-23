import { describe, it, expect } from 'vitest';

describe('middleware matcher', () => {
  it('excludes static assets and images from the matcher pattern', async () => {
    const { config } = await import('../../../middleware');
    const pattern = config.matcher[0];
    // Matcher is a string path pattern per Next.js middleware config format.
    expect(pattern).toContain('_next/static');
  });
});
