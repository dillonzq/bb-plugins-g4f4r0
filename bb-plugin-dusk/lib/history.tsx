import { useEffect } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server';

// Enrich BB's existing user-message buttons; BB keeps all navigation and paging.
export function HistoryPreview() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    let disposed = false, frame = 0;
    type Pair = { question: string; answer: string };
    const cache = new Map<string, { at: number; pairs: Pair[] }>();
    const pending = new Set<string>();
    const attempted = new Map<string, number>();
    const panels = new Map<HTMLElement, HTMLButtonElement | undefined>();
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(sync); };
    const sync = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>('[data-thread-toc] [id^="thread-toc-panel-"]').forEach(panel => {
        const threadId = panel.id.slice('thread-toc-panel-'.length);
        if (!/^thr_[a-zA-Z0-9]+$/.test(threadId)) return;
        const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
        const userTab = tabs.find(b => b.textContent === 'Your messages');
        if (!userTab) return;
        if (!panels.has(panel)) panels.set(panel, tabs.find(b => b.getAttribute('aria-pressed') === 'true'));
        const hit = cache.get(threadId);
        if ((!hit || Date.now() - hit.at > 15000) && !pending.has(threadId) && Date.now() - (attempted.get(threadId) ?? 0) > 15000) {
          pending.add(threadId); attempted.set(threadId, Date.now());
          void rpc.call('history', { threadId }).then(pairs => {
            if (!disposed) { if (cache.size >= 12) cache.delete(cache.keys().next().value!); cache.set(threadId, { at: Date.now(), pairs }); schedule(); }
          }, () => { /* Native history remains available if the outline fails. */ }).finally(() => pending.delete(threadId));
        }
        if (!hit) return;
        if (userTab.getAttribute('aria-pressed') !== 'true') { userTab.click(); return; }
        const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('li > button'));
        // Never guess a pairing if BB's loaded outline or context differs.
        if (buttons.length !== hit.pairs.length || buttons.some((b, i) => {
          const label = normalize(b.firstElementChild?.textContent || '');
          const question = normalize(hit.pairs[i].question);
          return !label || !question || label.slice(0, 64) !== question.slice(0, 64);
        })) {
          panel.removeAttribute('data-dusk-history');
          panel.querySelectorAll('.dusk-history-answer').forEach(n => n.remove());
          return;
        }
        const firstPairing = !panel.hasAttribute('data-dusk-history');
        panel.setAttribute('data-dusk-history', '');
        buttons.forEach((button, i) => {
          let answer = button.querySelector<HTMLElement>('.dusk-history-answer');
          const text = hit.pairs[i].answer;
          if (!text) { answer?.remove(); return; }
          if (!answer) { answer = document.createElement('span'); answer.className = 'dusk-history-answer'; button.append(answer); }
          if (answer.textContent !== text) answer.textContent = text;
        });
        if (firstPairing) {
          const active = buttons.find(b => b.classList.contains('bg-state-hover'));
          const scroller = active?.closest('ul')?.parentElement;
          if (active && scroller) {
            const a = active.getBoundingClientRect(), c = scroller.getBoundingClientRect();
            if (a.top < c.top || a.bottom > c.bottom) scroller.scrollTop += a.top - c.top;
          }
        }
      });
      for (const panel of panels.keys()) if (!panel.isConnected) panels.delete(panel);
    };
    const observer = new MutationObserver(records => {
      if (records.some(r => !(r.target instanceof Element && r.target.closest('.dusk-history-answer')))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      disposed = true; observer.disconnect(); cancelAnimationFrame(frame);
      for (const [panel, previous] of panels) {
        panel.removeAttribute('data-dusk-history');
        panel.querySelectorAll('.dusk-history-answer').forEach(n => n.remove());
        if (previous?.isConnected) previous.click();
      }
    };
  }, [rpc]);
  return null;
}
