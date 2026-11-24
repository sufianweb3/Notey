import type { Page } from '@playwright/test';

let n = 0;

/** Each test signs in from its own documentation-range address (RFC 5737), one rate-limit bucket each. */
export async function ownAddress(page: Page) {
  n++;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(process.pid + n) % 250 + 1}` });
}
