import { describe, it, expect } from 'vitest';
import { sanitizeDescription } from '@/lib/sanitize-html';

describe('sanitizeDescription', () => {
  it('allows <p>, <strong>, <em>, <br> and keeps their text', () => {
    const out = sanitizeDescription('<p>Hello <strong>world</strong></p>');
    expect(out).toContain('<p>');
    expect(out).toContain('</p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('world');

    const br = sanitizeDescription('a<br>b<br/>c<em>d</em>');
    expect(br).toContain('<br/>');
    expect(br).toContain('<em>');
    expect(br).toContain('d');
  });

  it('strips disallowed tags but keeps inner text', () => {
    const out = sanitizeDescription('<div><span>hi</span></div>');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('<span');
    expect(out).toContain('hi');
  });

  it('strips ALL attributes from allowed tags', () => {
    const out = sanitizeDescription('<p class="x" onclick="alert(1)">y</p>');
    expect(out).toBe('<p>y</p>');
    expect(out).not.toContain('class');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
  });

  it('removes <script> entirely including its content', () => {
    const out = sanitizeDescription('<script>alert(1)</script>safe');
    expect(out).toBe('safe');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('script');
  });

  it('removes <style> blocks including content', () => {
    const out = sanitizeDescription('<style>p{color:red}</style>text');
    expect(out).toBe('text');
    expect(out).not.toContain('color');
    expect(out).not.toContain('style');
  });

  it('neutralizes an onerror <img>', () => {
    const out = sanitizeDescription('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('preserves literal "<5°C" as visible text, not a tag', () => {
    const out = sanitizeDescription('milled at <5°C today');
    // '<5' is not a real tag (digit after '<'), so it must survive as text.
    expect(out).toContain('5°C');
    expect(out).toContain('today');
    // The '<' is escaped to render literally — no <5 tag is produced.
    expect(out).toContain('&lt;5°C');
  });

  it('returns "" for null / undefined / empty', () => {
    expect(sanitizeDescription(null)).toBe('');
    expect(sanitizeDescription(undefined)).toBe('');
    expect(sanitizeDescription('')).toBe('');
    expect(sanitizeDescription('   ')).toBe('');
  });

  it('handles the real WRW2106AC <p> description shape', () => {
    const out = sanitizeDescription(
      '<p>Coastal Ridge Cabernet Sauvignon is a full-bodied California red wine.</p>',
    );
    expect(out).toBe(
      '<p>Coastal Ridge Cabernet Sauvignon is a full-bodied California red wine.</p>',
    );
  });

  it('strips a stray onerror even when wrapped in an allowed tag', () => {
    const out = sanitizeDescription('<p onerror="alert(1)">hi <em onclick="x()">there</em></p>');
    expect(out).toBe('<p>hi <em>there</em></p>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
  });
});
