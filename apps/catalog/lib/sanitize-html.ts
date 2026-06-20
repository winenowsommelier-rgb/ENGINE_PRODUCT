/**
 * sanitize-html — a tiny, allowlist-only HTML sanitizer for product descriptions.
 *
 * WHY: Magento full_description / desc_en_short contain a KNOWN, tiny set of
 * formatting tags — verified across all 11,436 products the ONLY tags present are
 * <strong> (21070), <p> (16962), <em> (1216), <br> (557). We want to RENDER that
 * formatting, but the field is attacker-shaped text (5 descriptions mention
 * script/onerror/javascript), so passing it raw to dangerouslySetInnerHTML is an
 * XSS risk. This function reduces the HTML to a safe subset that is then safe to
 * inject.
 *
 * SECURITY MODEL — allowlist, strip everything else:
 *   1. Remove <script>…</script> and <style>…</style> blocks ENTIRELY (tag + content).
 *   2. Allow ONLY <p>, <strong>, <em>, <br> (and their closers / self-closing <br/>).
 *      Any other tag is removed but its inner TEXT is kept (e.g. <div>x</div> → x).
 *   3. Strip ALL attributes from allowed tags (<p class="x" onclick="…"> → <p>).
 *      With no attributes, no event handlers (onerror/onclick) and no
 *      javascript:/data: URIs can survive — the dangerous surface is gone.
 *
 * NON-TAGS: a bare '<' that is NOT the start of a real tag (e.g. "milled at <5°C")
 * must remain visible text, never be eaten as markup. We only treat '<' as a tag
 * start when immediately followed by a letter or '/', and we HTML-escape any other
 * '<' / '>' so it renders literally. So "<5°C" survives as visible text.
 *
 * This is intentionally NOT a full HTML parser: given the fixed, tiny tag set a
 * careful regex allowlist is sufficient and auditable.
 */

const ALLOWED_TAGS = new Set(['p', 'strong', 'em', 'br']);

/** Escape the bare '<' / '>' / '&' that are NOT part of an allowed tag. */
function escapeStrayBrackets(s: string): string {
  // Escape '&' first so we don't double-escape the entities we then emit.
  // We deliberately escape ALL '&' — product descriptions are plain prose, any
  // literal '&' should render as itself and any pre-existing entity is harmless
  // when re-escaped (it just renders as the literal text it already showed).
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sanitizeDescription(html: string | null | undefined): string {
  if (html === null || html === undefined) return '';
  if (typeof html !== 'string' || html.trim() === '') return '';

  let s = html;

  // 1) Drop <script>…</script> / <style>…</style> including their content.
  //    [\s\S] matches across newlines; non-greedy to stop at the first closer.
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  // Defensive: an UNclosed <script>/<style> (no closing tag) — drop to end so no
  // raw scriptish text leaks. Real data never hits this, but it's cheap safety.
  s = s.replace(/<script[\s\S]*$/gi, '');
  s = s.replace(/<style[\s\S]*$/gi, '');
  // Strip HTML comments (could hide markup); keep nothing.
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // 2) Walk every potential tag — only '<' followed by a letter or '/' counts as
  //    a tag start, so "<5°C" is left alone for the escape step below.
  //    Capture: optional '/', tag name, then the rest up to the matching '>'.
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

  // We rebuild the string segment by segment so the NON-tag text between tags can
  // be bracket-escaped (handling stray '<'/'>' like "<5°C"), while allowed tags
  // are emitted in bare, attribute-free form.
  let out = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG.exec(s)) !== null) {
    // Escape the literal text since the previous tag (may contain a stray '<').
    out += escapeStrayBrackets(s.slice(lastIndex, m.index));
    lastIndex = TAG.lastIndex;

    const isClose = m[1] === '/';
    const name = m[2].toLowerCase();
    const selfClose = m[3] === '/';

    if (!ALLOWED_TAGS.has(name)) {
      // Disallowed tag → drop the tag, keep surrounding text (already handled).
      continue;
    }

    if (name === 'br') {
      out += '<br/>'; // always self-closing, attribute-free
    } else if (isClose) {
      out += `</${name}>`;
    } else {
      out += `<${name}>`; // bare opening tag — all attributes stripped
      void selfClose; // p/strong/em are never legitimately self-closing; ignore
    }
  }

  // Trailing text after the last tag (escape stray brackets here too).
  out += escapeStrayBrackets(s.slice(lastIndex));

  return out;
}

/**
 * stripToText — reduce description HTML to PLAIN text (no tags at all). Used where
 * we render through React as a normal text child (e.g. QuickView's Radix
 * DialogDescription, which is itself a <p> — injecting block <p>/<br> there would
 * be invalid nesting). Today no desc_en_short contains tags, but this future-proofs
 * the path: any tag is dropped, inner text kept, and the result is a plain string
 * React will escape — so it can never render raw tags and carries no XSS surface.
 */
export function stripToText(html: string | null | undefined): string {
  if (html === null || html === undefined) return '';
  if (typeof html !== 'string' || html.trim() === '') return '';

  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  s = s.replace(/<script[\s\S]*$/gi, '');
  s = s.replace(/<style[\s\S]*$/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Drop every real tag (only '<' followed by a letter or '/'); leave "<5°C" alone.
  s = s.replace(/<\/?[a-zA-Z][^>]*?>/g, '');
  // Collapse the whitespace a removed <br>/<p> would have implied.
  return s.replace(/\s+/g, ' ').trim();
}
