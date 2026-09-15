/** Synchronous user-gesture handoff on the viewing client, never the server. */
export function openClientExternal(raw: string, client: Window = window) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('Only website URLs can open externally.');
  let shell = client;
  try { if (client.parent.location.origin === client.location.origin) shell = client.parent; } catch {}
  const desktop = (shell as Window & { bbDesktop?: { openExternalUrl(url: string): unknown } }).bbDesktop;
  if (desktop?.openExternalUrl) return desktop.openExternalUrl(url.href);
  client.open(url.href, '_blank', 'noopener,noreferrer');
}
