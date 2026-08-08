// Sommelier copy is stored as one flowing paragraph (no line breaks). This
// splits it into sentences so callers can render one sentence per line
// instead of one dense wall of text.
//
// A plain `/(?<=[.!?])\s+(?=[A-Z])/` split is too naive for real region copy:
// it breaks abbreviations like "St.-Émilion" and the closing quote in
// `'claret.'` ends up leading the next sentence. This walks the string and
// only treats a run of [.!?] as a boundary when it's followed by whitespace
// + a capital/quote (or end of string) AND isn't a short capitalized token
// immediately followed by a hyphen/lowercase letter (abbreviation-like).
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?]/.test(text[i])) continue;
    let j = i;
    while (j < text.length && /[.!?]/.test(text[j])) j++;
    while (j < text.length && /['")”]/.test(text[j])) j++;

    const after = text.slice(j);
    const nextNonSpace = after.match(/^\s+(\S)/);
    if (!nextNonSpace && j < text.length) {
      i = j - 1;
      continue;
    }
    const followedByCapitalOrEnd = j >= text.length || (!!nextNonSpace && /[A-Z"'“]/.test(nextNonSpace[1]));

    const before = text.slice(Math.max(0, start), i + 1);
    const lastWord = before.match(/(\S+)$/)?.[1] ?? '';
    const looksLikeAbbrev = /^[A-Z][a-zA-Z]{0,3}\.$/.test(lastWord) && /^[-a-z]/.test(after);

    if (followedByCapitalOrEnd && !looksLikeAbbrev) {
      out.push(text.slice(start, j).trim());
      start = j;
      i = j - 1;
    } else {
      i = j - 1;
    }
  }
  if (start < text.length) {
    const rest = text.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out.length > 0 ? out : [text];
}
