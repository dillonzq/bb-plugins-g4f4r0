/** App-shell links only: viewer iframe navigation stays in its own session. */
export function browseLink(
  event: MouseEvent,
  location: Location,
  modified = false,
): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    (!modified && (event.ctrlKey || event.metaKey)) ||
    event.shiftKey
  )
    return null;
  const anchor = event
    .composedPath()
    .find(
      (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
    );
  if (
    !anchor ||
    anchor.hasAttribute("download") ||
    anchor.closest('[data-browse-link-routing="off"], [contenteditable="true"]')
  )
    return null;
  // _blank is common on chat links; an ordinary click still opens a Browse tab.
  // Named frames and explicit parent/top navigation retain browser semantics.
  if (
    anchor.target &&
    !["_self", "_blank"].includes(anchor.target.toLowerCase())
  )
    return null;
  const href = anchor.getAttribute("href");
  if (!href || (!/^https?:\/\//i.test(href) && !href.startsWith("/api/v1/plugins/browse/http/viewer?"))) return null;
  let url: URL;
  try { url = new URL(href, location.href); } catch { return null; }
  const viewer = url.origin === location.origin && url.pathname === "/api/v1/plugins/browse/http/viewer" && !!url.searchParams.get("id");
  if ((!viewer && url.origin === location.origin) || url.username || url.password)
    return null;
  return url.href;
}
