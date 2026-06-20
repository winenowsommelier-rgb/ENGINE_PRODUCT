/**
 * Contact-handle env reader — the ONE place in the catalog app that reads
 * process.env for contact handles. SERVER-ONLY.
 *
 * Server components call getContactEnv(), pass the result to buildContactLinks()
 * (lib/contact.ts), and hand the resulting STRINGS down to the client
 * <ContactButtons> component. Client components must NEVER import this — they
 * receive ready-made link strings as props instead.
 *
 * Missing vars degrade gracefully to '' (never undefined) so buildContactLinks
 * returns '' for any unconfigured channel and <ContactButtons> simply omits that
 * button. No crash, no half-broken link.
 *
 * The handles (LINE url, WhatsApp number, FB Messenger page) are PUBLIC contact
 * identifiers, not secrets.
 */

import type { ContactEnv } from '@/lib/contact';

export function getContactEnv(): ContactEnv {
  return {
    line: process.env.LINE_OFFICIAL_URL ?? '',
    wa: process.env.WHATSAPP_NUMBER ?? '',
    fb: process.env.FB_MESSENGER_PAGE ?? '',
  };
}
