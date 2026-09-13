// Observe owned areas deeply, but only direct children along their ancestor
// paths. Streaming elsewhere in the app does not reach this observer.
export function observeRoots(selector: string, changed: () => void, subtree = true) {
  let frame = 0, disposed = false;
  let roots: Element[] = [];
  const bind = () => {
    observer.disconnect();
    roots = Array.from(document.querySelectorAll(selector));
    if (!roots.length) {
      observer.observe(document.body, { childList: true, subtree: true });
      return;
    }
    const ancestors = new Set<Element>();
    for (const root of roots) {
      observer.observe(root, { childList: true, subtree });
      for (let parent = root.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
    }
    for (const ancestor of ancestors) if (!roots.includes(ancestor)) observer.observe(ancestor, { childList: true });
  };
  const observer = new MutationObserver(records => {
    if (!roots.length && !records.some(r => Array.from(r.addedNodes).some(n => n instanceof Element &&
      (n.matches(selector) || n.querySelector(selector))))) return;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      bind(); changed();
    });
  });
  bind();
  return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); };
}
