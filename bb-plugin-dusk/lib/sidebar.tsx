import { observeRoots } from "./observe-roots";
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { experimental_useSidebarThreads, experimental_useSidebarThreadActions, experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

type Mount = { id: string; link: HTMLElement; row: HTMLElement; meta: HTMLElement; pin: HTMLElement | null; pinClass: string; nativeMeta?: HTMLElement };
export function relativeMessageTime(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function PinAction({ id, pinned, className }: { id: string; pinned: boolean; className: string }) {
  const actions = experimental_useSidebarThreadActions();
  const [busy, setBusy] = useState(false);
  return <TooltipProvider><Tooltip disableHoverableContent><TooltipTrigger asChild><Button variant="ghost" size="icon" className={className} aria-label={pinned ? 'Unpin thread' : 'Pin thread'} aria-pressed={pinned} disabled={busy}
    onPointerDown={e => e.stopPropagation()} onClick={async e => {
      e.preventDefault(); e.stopPropagation(); if (busy) return;
      setBusy(true);
      try { await actions.setPinned(id, !pinned); }
      catch { toast.error('Could not update the pin. Try again.'); }
      finally { setBusy(false); }
    }}><Icon name={pinned ? 'PinOff' : 'Pin'} className="size-4" aria-hidden /></Button></TooltipTrigger><TooltipContent side="bottom">{pinned ? 'Unpin' : 'Pin'}</TooltipContent></Tooltip></TooltipProvider>;
}

export function SidebarDetails() {
  const { threads } = experimental_useSidebarThreads();
  const rpc = useRpc<typeof rpcContract>();
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [times, setTimes] = useState<Record<string, number | null>>({});
  const [now, setNow] = useState(Date.now);
  useLayoutEffect(() => {
    const entries = new Map<HTMLElement, Mount>(); let frame = 0;
    const knownIds = new Set(threads.map(t => t.id));
    const dispose = (m: Mount) => { m.meta.remove(); m.pin?.remove(); m.row.removeAttribute('data-dusk-thread-row'); m.nativeMeta?.removeAttribute('data-dusk-native-meta'); };
    const sync = () => {
      frame = 0; let changed = false; const found = new Set<HTMLElement>();
      document.querySelectorAll<HTMLElement>('[data-sidebar="sidebar"] a[data-sidebar-thread-id]').forEach(link => {
        const row = link.parentElement, id = link.dataset.sidebarThreadId;
        if (!row || !id || !row.querySelector('.bb-thread-title')) return;
        found.add(link);
        const controls = row.querySelector<HTMLElement>('[data-sidebar-row-controls]');
        const old = entries.get(link);
        if (old && old.id === id && old.meta.parentElement === row && (old.pin?.parentElement ?? null) === controls) return;
        if (old) dispose(old);
        const meta = document.createElement('span'); meta.className = 'dusk-thread-meta';
        row.setAttribute('data-dusk-thread-row', ''); row.append(meta);
        let pin: HTMLElement | null = null;
        const pinClass = controls?.querySelector('button')?.className || 'size-7 p-0';
        if (controls) { pin = document.createElement('span'); pin.className = 'dusk-pin-slot'; controls.prepend(pin); }
        entries.set(link, { id, link, row, meta, pin, pinClass }); changed = true;
      });
      document.querySelectorAll<HTMLElement>('[data-root-compose-mobile-recents] a[href]').forEach(link => {
        const id = link.getAttribute('href')?.match(/\/threads\/(thr_[^/?#]+)/)?.[1];
        const row = link.parentElement;
        const text = link.querySelector<HTMLElement>(':scope > span.min-w-0');
        const nativeMeta = text?.querySelector<HTMLElement>(':scope > span:nth-child(2):not(.dusk-thread-meta)');
        if (!id || !row || !text || !nativeMeta || !knownIds.has(id)) return;
        found.add(link);
        const old = entries.get(link);
        if (old && old.meta.parentElement === text && old.nativeMeta === nativeMeta) return;
        if (old) dispose(old);
        const meta = document.createElement('span'); meta.className = 'dusk-thread-meta';
        nativeMeta.setAttribute('data-dusk-native-meta', ''); text.append(meta);
        entries.set(link, { id, link, row, meta, nativeMeta, pin: null, pinClass: '' }); changed = true;
      });
      for (const [link, entry] of entries) if (!found.has(link)) { dispose(entry); entries.delete(link); changed = true; }
      if (changed) setMounts([...entries.values()]);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const roots = '[data-sidebar="sidebar"], [data-root-compose-mobile-recents], #root-compose-prompt';
    let stopObserving = observeRoots(roots, schedule);
    const homepageReady = () => { stopObserving(); stopObserving = observeRoots(roots, schedule); schedule(); };
    window.addEventListener('dusk:homepage-ready', homepageReady);
    sync();
    return () => { window.removeEventListener('dusk:homepage-ready', homepageReady); stopObserving(); cancelAnimationFrame(frame); entries.forEach(dispose); };
  }, [threads.map(t => t.id).sort().join(',')]);
  const ids = [...new Set(mounts.map(m => m.id))].sort().join(',');
  useEffect(() => {
    let cancelled = false, pending = false;
    const refresh = async () => {
      if (document.hidden || pending || !ids || cancelled) return;
      setNow(Date.now());
      pending = true;
      try {
        const list = ids.split(','); const result: Record<string, number | null> = {};
        for (let i = 0; i < list.length; i += 50) Object.assign(result, await rpc.call('sidebarTimes', { ids: list.slice(i, i + 50) }));
        if (!cancelled) setTimes(result);
      } catch { /* Keep the last known timestamp; do not invent a message age. */ }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [ids, rpc]);
  const byId = new Map(threads.map(t => [t.id, t]));
  return <>{mounts.map(m => {
    const thread = byId.get(m.id); if (!thread) return null;
    const branch = thread.environment?.branchName;
    const location = branch || thread.environment?.name || thread.host?.name;
    const at = times[m.id];
    return <span key={m.id + '-' + mounts.indexOf(m)} style={{ display: 'contents' }}>
      {createPortal(<>{location && <><Icon name={branch ? 'GitBranch' : thread.environment?.name ? 'Folder' : 'Laptop'} aria-hidden /><span className="dusk-thread-location">{location}</span></>}
        {location && at != null && <span aria-hidden>·</span>}
        {at != null && <time dateTime={new Date(at).toISOString()} title={`Last message: ${new Date(at).toLocaleString()}`}>{relativeMessageTime(at, now)}</time>}
      </>, m.meta)}
      {m.pin && createPortal(<PinAction id={m.id} pinned={thread.isPinned} className={m.pinClass} />, m.pin)}
    </span>;
  })}</>;
}
