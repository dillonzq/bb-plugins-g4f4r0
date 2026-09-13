// BB's custom-icon API adds a span around artwork. Extend host SVG selectors
// to that wrapper, preserving their specificity, media queries and cascade layers.
// Only Silk's registered artwork opts into this compatibility stylesheet.
export function mountRemixLayout(signal: AbortSignal) {
  const style = document.createElement("style");
  style.dataset.silkIconLayout = "";
  document.head.append(style);
  const wrapper = ':is(svg,:where(span[data-icon]:has(>svg[data-silk-remix])))';
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
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const css = Array.from(document.styleSheets).filter((sheet) => sheet.ownerNode !== style).map((sheet) => {
      try { return copyRules(sheet.cssRules); } catch { return ""; } // Cross-origin sheets may be unreadable.
    }).join("\n");
    style.textContent = css + '\nspan[data-icon] > svg[data-silk-remix] { display: block; width: 100% !important; height: 100% !important; flex-shrink: 0; }';
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target !== style && !style.contains(record.target))) schedule();
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  document.head.addEventListener("load", schedule, true);
  refresh();
  const dispose = () => { observer.disconnect(); document.head.removeEventListener("load", schedule, true); cancelAnimationFrame(frame); style.remove(); };
  signal.addEventListener("abort", dispose, { once: true });
  return () => { signal.removeEventListener("abort", dispose); dispose(); };
}
