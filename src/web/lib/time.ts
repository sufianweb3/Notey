const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }) : null;

/** "just now", "5 min ago", "yesterday", then a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (!rtf) return new Date(iso).toLocaleDateString();
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Edited by Claude" for agent edits; null for the owner's own edits. */
export function editedByLabel(actor: string): string | null {
  return actor.startsWith('agent:') ? `Edited by ${actor.slice(6)}` : null;
}
