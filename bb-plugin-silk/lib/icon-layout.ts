// BB's custom-icon API adds a span around artwork. Extend host SVG selectors
// to that wrapper, preserving their specificity, media queries and cascade layers.
// Only Silk's registered artwork opts into this compatibility stylesheet.
export function mountIconLayout(signal: AbortSignal) {
  const style = document.createElement("style");
  style.dataset.silkIconLayout = "";
  document.head.append(style);
  const wrapper = ':is(svg,:where(span[data-icon]:has(>svg[data-silk-icon])))';
  function copyRules(rules: CSSRuleList): string {
    return Array.from(rules).map((rule) => {
      if (rule instanceof CSSStyleRule) {
        // Match type selectors, not class names, attributes or escaped Tailwind utilities.
        const selector = rule.selectorText.replace(/(^|[\s>+~,(])svg(?=$|[\s>+~.#:[),])/g, `$1${wrapper}`);
        return selector !== rule.selectorText ? `${selector}{${rule.style.cssText}}` : "";
      }
      if ("cssRules" in rule) {
        const children = copyRules((rule as CSSGroupingRule).cssRules);
        return children ? `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${children}}` : "";
      }
      return "";
    }).join("\n");
  }
  const cache = new WeakMap<CSSStyleSheet, string>();
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const css = Array.from(document.styleSheets).filter((sheet) => sheet.ownerNode !== style).map((sheet) => {
      const hit = cache.get(sheet);
      if (hit !== undefined) return hit;
      try { const value = copyRules(sheet.cssRules); cache.set(sheet, value); return value; }
      catch { return ""; } // Retry unreadable sheets after their load event.
    }).join("\n");
    const next = css
      + '\nspan[data-icon].inline:has(> svg[data-silk-icon]) { display: inline-block; }'
      + '\nspan[data-icon] > svg[data-silk-icon] { display: block; width: 100% !important; height: 100% !important; flex-shrink: 0; }';
    if (style.textContent !== next) style.textContent = next;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const invalidate = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    const owner = element?.closest('style,link[rel="stylesheet"]');
    if (!owner || owner === style) return false;
    const sheet = (owner as HTMLStyleElement | HTMLLinkElement).sheet;
    if (sheet) cache.delete(sheet);
    return true;
  };
  const observer = new MutationObserver((records) => {
    let dirty = false;
    for (const record of records) {
      if (record.target === style || style.contains(record.target)) continue;
      if (invalidate(record.target)) dirty = true;
      for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
        if (node !== style && node instanceof Element &&
          (node.matches('style,link[rel="stylesheet"]') || node.querySelector('style,link[rel="stylesheet"]'))) {
          invalidate(node);
          node.querySelectorAll('style,link[rel="stylesheet"]').forEach(invalidate);
          dirty = true;
        }
      }
    }
    if (dirty) schedule();
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel', 'media', 'disabled'] });
  const loaded = (event: Event) => { if (event.target instanceof Node && invalidate(event.target)) schedule(); };
  document.head.addEventListener("load", loaded, true);
  refresh();
  const dispose = () => { observer.disconnect(); document.head.removeEventListener("load", loaded, true); cancelAnimationFrame(frame); style.remove(); };
  signal.addEventListener("abort", dispose, { once: true });
  return () => { signal.removeEventListener("abort", dispose); dispose(); };
}
