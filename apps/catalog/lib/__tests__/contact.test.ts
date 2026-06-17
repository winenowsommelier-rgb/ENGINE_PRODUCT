import { describe, it, expect } from 'vitest';
import { buildContactLinks } from '@/lib/contact';

const env = { line: 'https://line.me/R/ti/p/@wnlq9', wa: '66812345678', fb: 'wnlq9' };

describe('buildContactLinks', () => {
  it('per-product WhatsApp pre-fills name + sku', () => {
    const l = buildContactLinks(env, { name: 'Château Test', sku: 'WRW2106AC' });
    expect(l.whatsapp).toContain('wa.me/66812345678');
    const decoded = decodeURIComponent(l.whatsapp);
    expect(decoded).toContain('Château Test');
    expect(decoded).toContain('WRW2106AC');
  });
  it('per-product Facebook is m.me/<page>', () => {
    const l = buildContactLinks(env, { name: 'X', sku: 'Y' });
    expect(l.facebook).toContain('m.me/wnlq9');
  });
  it('LINE passthrough', () => {
    expect(buildContactLinks(env).line).toBe('https://line.me/R/ti/p/@wnlq9');
  });
  it('global (no product) builds general links without product text', () => {
    const l = buildContactLinks(env);
    expect(l.whatsapp).toContain('wa.me/66812345678');
    expect(l.facebook).toContain('m.me/wnlq9');
    // global WhatsApp may have a generic greeting but must NOT contain "interested in"
    expect(decodeURIComponent(l.whatsapp)).not.toContain('interested in');
  });
  it('gracefully handles missing/empty handles (returns empty strings, no crash)', () => {
    const l = buildContactLinks({ line: '', wa: '', fb: '' });
    expect(l.line).toBe('');
    expect(l.whatsapp).toBe('');
    expect(l.facebook).toBe('');
  });
  it('special characters in product name are URL-encoded', () => {
    const l = buildContactLinks(env, { name: 'A & B 100%', sku: 'S/1' });
    // must be valid encoded URL, not contain raw & or % breaking the query
    expect(l.whatsapp).not.toContain('A & B 100%');
    expect(decodeURIComponent(l.whatsapp)).toContain('A & B 100%');
  });
});
