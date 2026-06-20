/**
 * Contact deep-link builder.
 *
 * PURE function: takes handle values (from env, passed in by caller) plus an
 * optional product, and returns the three contact URLs (LINE / WhatsApp /
 * Facebook Messenger). It NEVER reads process.env itself — server components
 * read process.env.LINE_OFFICIAL_URL / WHATSAPP_NUMBER / FB_MESSENGER_PAGE and
 * pass the values in. This keeps the function testable and lets server
 * components compute links at build time and hand strings to client components.
 *
 * Empty/missing handles return '' (never undefined, never a crash) so callers
 * can safely render-or-hide each button.
 */

export interface ContactEnv {
  /** Full LINE URL, e.g. https://line.me/R/ti/p/@wnlq9 (passthrough) */
  line: string;
  /** WhatsApp number, digits only with country code, e.g. 66812345678 */
  wa: string;
  /** Facebook Messenger page handle, e.g. wnlq9 */
  fb: string;
}

export interface ContactProduct {
  name: string;
  sku: string;
}

export interface ContactLinks {
  line: string;
  whatsapp: string;
  facebook: string;
}

const GLOBAL_GREETING = 'Hello, I have a question about your products.';

/**
 * Build the three contact deep-links.
 * @param env  Handle values (LINE url, WhatsApp number, FB page).
 * @param product  Optional product to pre-fill the WhatsApp message.
 * @returns The three URLs; any with a missing handle is ''.
 */
export function buildContactLinks(
  env: ContactEnv,
  product?: ContactProduct,
): ContactLinks {
  // LINE: already a full URL — passthrough, or '' if not configured.
  const line = env.line ? env.line : '';

  // WhatsApp: https://wa.me/<number>?text=<encoded message>
  let whatsapp = '';
  if (env.wa) {
    // Em-dash (U+2014) between name and sku, as specified.
    const text = product
      ? `I'm interested in ${product.name} — ${product.sku}`
      : GLOBAL_GREETING;
    whatsapp = `https://wa.me/${env.wa}?text=${encodeURIComponent(text)}`;
  }

  // Facebook Messenger: https://m.me/<page>. Messenger deep-links can't
  // reliably pre-fill text, so product info is intentionally NOT appended.
  const facebook = env.fb ? `https://m.me/${env.fb}` : '';

  return { line, whatsapp, facebook };
}
