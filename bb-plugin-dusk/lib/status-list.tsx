import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { experimental_Icon as Icon, experimental_ProviderIcon as ProviderIcon, experimental_useProviders, experimental_useSidebarThreadActions, experimental_useSidebarThreads, experimental_useSidebarThreadSplit, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginSidebarProject, PluginSidebarThread, PluginThreadListProps } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { rpcContract } from '../server';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { buildFamilies, canSnooze, lastActivity, SECTIONS, snoozePresets, wakeLabel, type Family, type SectionId, type SnoozeRow } from './status';
import { relativeMessageTime } from './sidebar';

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
const COLLAPSED_KEY = 'dusk:status-collapsed';
export const SNOOZE_EVENT = 'dusk:snooze-thread';
export let statusListMounted = 0;

function useSnoozes(rpc: Rpc) {
  const [rows, setRows] = useState<SnoozeRow[]>([]);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    rpc.call('snoozes', null).then(next => { if (request === generation.current) setRows(next); }, () => {});
  }, [rpc]);
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [refresh]);
  useRealtime('snoozes', refresh);
  const connection = useRealtimeConnectionState();
  useEffect(() => { if (connection === 'connected') refresh(); }, [connection, refresh]);
  const apply = useCallback((next: SnoozeRow[]) => { generation.current++; setRows(next); }, []);
  return [rows, apply] as const;
}

function usePinOrder(rpc: Rpc, pinnedIds: string) {
  const [keys, setKeys] = useState<Map<string, string | null>>(new Map());
  const refresh = useCallback(() => {
    rpc.call('pinOrder', null).then(pins => setKeys(new Map(pins.map(p => [p.threadId, p.key]))), () => {});
  }, [rpc]);
  useEffect(refresh, [refresh, pinnedIds]);
  useRealtime('pins', refresh);
  return keys;
}

function useNow(snoozes: SnoozeRow[]) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  // Wake a snoozed thread on time instead of on the next 30s tick.
  useEffect(() => {
    const next = Math.min(...snoozes.map(s => s.until).filter(until => until > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [snoozes, now]);
  return now;
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(() => {
    try { const stored = localStorage.getItem(COLLAPSED_KEY); return new Set(stored ? JSON.parse(stored) : ['snoozed']); }
    catch { return new Set(['snoozed']); }
  });
  const toggle = useCallback((id: SectionId) => setCollapsed(current => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch {}
    return next;
  }), []);
  return [collapsed, toggle] as const;
}

// Opening an unread thread marks it read at once. Keep its unread look for a
// few seconds, and if the user leaves before then, mark it unread again, so a
// mis-click doesn't file a result under Done.
const READ_HOLD_MS = 5000;
type Hold = { indicator: PluginSidebarThread['indicator']; indicatorLabel: string | null; openedAt: number };

function useReadHold(threads: readonly PluginSidebarThread[], activeThreadId: string | null) {
  const threadActions = experimental_useSidebarThreadActions();
  const [holds, setHolds] = useState<ReadonlyMap<string, Hold>>(new Map());
  const snapshot = useRef(new Map<string, PluginSidebarThread>());
  const previous = useRef<string | null>(null);
  // Declared before the snapshot refresh so it still sees the pre-open state.
  useEffect(() => {
    const left = previous.current;
    previous.current = activeThreadId;
    if (left === activeThreadId) return;
    const opened = activeThreadId ? snapshot.current.get(activeThreadId) : undefined;
    const now = Date.now();
    setHolds(current => {
      const next = new Map(current);
      const leftHold = left ? next.get(left) : undefined;
      if (left && leftHold) {
        if (now - leftHold.openedAt < READ_HOLD_MS) void threadActions.setRead(left, false).catch(() => {});
        next.delete(left);
      }
      if (opened?.isUnread) next.set(opened.id, { indicator: opened.indicator, indicatorLabel: opened.indicatorLabel, openedAt: now });
      return next;
    });
  }, [activeThreadId, threadActions]);
  useEffect(() => { snapshot.current = new Map(threads.map(t => [t.id, t])); }, [threads]);
  useEffect(() => {
    if (holds.size === 0) return;
    const soonest = Math.min(...[...holds.values()].map(h => h.openedAt)) + READ_HOLD_MS;
    const timer = window.setTimeout(() => setHolds(current => {
      const next = new Map([...current].filter(([, h]) => Date.now() - h.openedAt < READ_HOLD_MS));
      return next.size === current.size ? current : next;
    }), Math.max(0, soonest - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [holds]);
  return useMemo(() => holds.size === 0 ? threads : threads.map(t => {
    const hold = holds.get(t.id);
    // Only paint over the read state; new work or a question shows as usual.
    if (!hold || t.isUnread || (t.indicator !== 'none' && t.indicator !== 'draft')) return t;
    return { ...t, isUnread: true, indicator: hold.indicator, indicatorLabel: hold.indicatorLabel };
  }), [threads, holds]);
}

type RowActions = {
  snooze(ids: string, until: number): void;
  unsnooze(id: string): void;
  custom(id: string): void;
  onNavigate(): void;
};

function SnoozeItems({ family, now, actions }: { family: Family; now: number; actions: RowActions }) {
  const id = family.root.id;
  if (family.snooze) return <DropdownMenuItem onSelect={() => actions.unsnooze(id)}><Icon name="Clock" className="size-4" aria-hidden />Unsnooze</DropdownMenuItem>;
  if (!canSnooze([family.root, ...family.children])) return <DropdownMenuItem disabled>Can't snooze while it's working or asking</DropdownMenuItem>;
  return <>
    {snoozePresets(new Date(now)).map(p => <DropdownMenuItem key={p.id} className="gap-6" onSelect={() => actions.snooze(id, p.until)}>
      {p.label}
      <DropdownMenuShortcut className="dusk-snooze-time">{new Date(p.until).toLocaleString([], { ...(p.showDay ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' })}</DropdownMenuShortcut>
    </DropdownMenuItem>)}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => actions.custom(id)}>Custom</DropdownMenuItem>
  </>;
}

const title = (thread: PluginSidebarThread) => thread.title || thread.titleFallback || 'New thread';

type Details = { model: string | null; reasoning: string | null; provider: string | null; modelProviderId: string | null; fullTitle: string | null };
const detailsCache = new Map<string, { at: number; value: Promise<Details> }>();
function useThreadDetails(rpc: Rpc, threadId: string, enabled: boolean) {
  // Callers enable this on pointer enter, so the model is usually loaded
  // before the card opens and the card doesn't change height.
  const [details, setDetails] = useState<Details | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cached = detailsCache.get(threadId);
    if (!cached || Date.now() - cached.at > 60_000) {
      cached = { at: Date.now(), value: rpc.call('threadDetails', { threadId }) };
      cached.value.catch(() => detailsCache.delete(threadId));
      detailsCache.set(threadId, cached);
    }
    let live = true;
    cached.value.then(value => { if (live) setDetails(value); }, () => { if (live) setDetails({ model: null, reasoning: null, provider: null, modelProviderId: null, fullTitle: null }); });
    return () => { live = false; };
  }, [rpc, threadId, enabled]);
  return details;
}

function ThreadCard({ thread, location, details, now }: { thread: PluginSidebarThread; location: string; details: Details | null; now: number }) {
  const at = lastActivity(thread);
  const env = thread.environment;
  // A provider-made environment is an isolated worktree; null is the project checkout.
  const worktree = env?.providerId ? env.name : null;
  const reasoning = details?.reasoning ? details.reasoning[0].toUpperCase() + details.reasoning.slice(1) : null;

  const ago = relativeMessageTime(at, now);
  // Prefer the provider that actually serves the model (a routed model), then the thread's.
  const { providers } = experimental_useProviders();
  const provider = providers.find(p => p.id === details?.modelProviderId) ?? providers.find(p => p.id === thread.providerId) ?? { id: thread.providerId };
  return <div className="dusk-card">
    <div className="dusk-card-head">
      <span className="dusk-card-project"><Icon name="Folder" className="dusk-card-icon" aria-hidden /><span>{location}</span></span>
      <time dateTime={new Date(at).toISOString()}>{ago === 'now' ? 'now' : `${ago} ago`}</time>
    </div>
    <p className="dusk-card-title">{thread.title || details?.fullTitle || title(thread)}</p>
    <div className="dusk-card-facts">
      {/* Same layout as the composer's model button: logo, model, reasoning. */}
      <span className="dusk-card-fact" title={details?.provider && details.model ? `${details.provider}: ${details.model}${reasoning ? ` · ${reasoning} reasoning` : ''}` : undefined}>
        <ProviderIcon providerKind="agent" provider={provider} className="dusk-card-icon" />
        {details === null ? <span className="dusk-card-muted">Loading model</span>
          : details.model ? <><span>{details.model}</span>{reasoning && <span className="dusk-card-muted">{reasoning}</span>}</>
          : <span className="dusk-card-muted">{details.provider ?? 'Unknown model'}</span>}
      </span>
      {(env?.branchName || worktree) && <span className="dusk-card-fact">
        <Icon name="GitBranch" className="dusk-card-icon" aria-hidden />
        <span>{env?.branchName}</span>
        {worktree && worktree !== env?.branchName && <span className="dusk-card-muted">{worktree}</span>}
      </span>}
    </div>
  </div>;
}

const StatusRow = memo(function StatusRow({ thread, project, family, child, active, now, actions }: { thread: PluginSidebarThread; project: PluginSidebarProject | undefined; family: Family; child: boolean; active: boolean; now: number; actions: RowActions }) {
  const threadActions = experimental_useSidebarThreadActions();
  const split = experimental_useSidebarThreadSplit(thread.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  // Stays true after the first hover so the card keeps its content while it
  // fades out instead of collapsing to an empty box.
  const [wanted, setWanted] = useState(false);
  const rpc = useRpc<typeof rpcContract>();
  const details = useThreadDetails(rpc, thread.id, wanted);
  const [busy, setBusy] = useState(false);
  // No project headings here, so the project replaces the branch.
  const location = !project || project.isPersonal ? 'Personal' : project.name;
  const snooze = child ? null : family.snooze;
  const at = lastActivity(thread);
  const stop = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };
  const pin = async (event: React.MouseEvent) => {
    stop(event); if (busy) return;
    setBusy(true);
    try { await threadActions.setPinned(thread.id, !thread.isPinned); }
    catch { toast.error('Could not update the pin. Try again.'); }
    finally { setBusy(false); }
  };
  const label = title(thread);
  const hasState = thread.indicator !== 'none' && !!thread.indicatorLabel;
  return <HoverCard open={cardOpen && !menuOpen} onOpenChange={setCardOpen} openDelay={400} closeDelay={60}>
  <HoverCardTrigger asChild>
  <div className="dusk-status-row" data-child={child || undefined} data-active={active || undefined} data-menu-open={menuOpen || undefined} data-has-state={hasState || undefined} onPointerEnter={() => setWanted(true)}>
    <a className="dusk-status-link" href={`/projects/${thread.projectId}/threads/${thread.id}`} aria-label={`Open ${label}`} aria-current={active ? 'page' : undefined}
      data-sidebar-thread-shortcut-target="" {...split.splitProps}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        threadActions.open(thread.id, { split: event.altKey && split.isAvailable });
        actions.onNavigate();
      }} />
    <span className="dusk-status-title">{label}</span>
    <span className="dusk-status-trailing">
      <span className="dusk-status-state">
        {hasState && <span data-sidebar-thread-trailing-indicator="" className="dusk-status-indicator">
          <span role="img" aria-label={thread.indicatorLabel ?? undefined} />
        </span>}
      </span>
      <span className="dusk-status-actions">
      <TooltipProvider>
        <Tooltip disableHoverableContent open={menuOpen ? false : undefined}>
          <TooltipTrigger asChild>
        <button type="button" className="dusk-status-action" aria-label={thread.isPinned ? 'Unpin thread' : 'Pin thread'} aria-pressed={thread.isPinned} disabled={busy} onClick={pin} onPointerDown={e => e.stopPropagation()}>
          <Icon name={thread.isPinned ? 'PinOff' : 'Pin'} className="size-4" aria-hidden />
        </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{thread.isPinned ? 'Unpin' : 'Pin'}</TooltipContent>
        </Tooltip>
        {!child && <DropdownMenu onOpenChange={setMenuOpen}>
          <Tooltip disableHoverableContent open={menuOpen ? false : undefined}>
            <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild><button type="button" className="dusk-status-action" aria-label={snooze ? 'Snoozed thread' : 'Snooze thread'} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <Icon name="Clock" className="size-4" aria-hidden />
          </button></DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{snooze ? `Snoozed · ${wakeLabel(snooze.until, now)}` : 'Snooze'}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" side="bottom"><SnoozeItems family={family} now={now} actions={actions} /></DropdownMenuContent>
        </DropdownMenu>}
        <Tooltip disableHoverableContent open={menuOpen ? false : undefined}>
          <TooltipTrigger asChild>
        <button type="button" className="dusk-status-action" aria-label="Archive thread" onPointerDown={e => e.stopPropagation()} onClick={event => { stop(event); threadActions.archive(thread.id); }}>
          <Icon name="Archive" className="size-4" aria-hidden />
        </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Archive</TooltipContent>
        </Tooltip>
        <DropdownMenu onOpenChange={setMenuOpen}>
          <Tooltip disableHoverableContent open={menuOpen ? false : undefined}>
            <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild><button type="button" className="dusk-status-action" aria-label="Thread actions" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <Icon name="MoreHorizontal" className="size-4" aria-hidden />
          </button></DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Thread actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" side="bottom">
            {split.isAvailable && <DropdownMenuItem onSelect={() => threadActions.open(thread.id, { split: true })}><Icon name="Columns2" className="size-4" aria-hidden />Open in split</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void threadActions.setRead(thread.id, thread.isUnread).catch(() => toast.error('Could not update the thread.'))}><Icon name={thread.isUnread ? 'MailOpen' : 'Mail'} className="size-4" aria-hidden />{thread.isUnread ? 'Mark as read' : 'Mark as unread'}</DropdownMenuItem>
            {!child && <DropdownMenuSub>
              <DropdownMenuSubTrigger><Icon name="Clock" className="size-4" aria-hidden />{snooze ? `Snoozed · ${wakeLabel(snooze.until, now)}` : 'Snooze'}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent><SnoozeItems family={family} now={now} actions={actions} /></DropdownMenuSubContent>
            </DropdownMenuSub>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => threadActions.archive(thread.id)}><Icon name="Archive" className="size-4" aria-hidden />Archive</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => threadActions.requestDelete(thread.id)}><Icon name="Trash2" className="size-4" aria-hidden />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
      </span>
    </span>
    <span className="dusk-thread-meta">
      <span className="dusk-thread-loc-icon" aria-hidden><Icon name="Folder" className="size-3" /></span>
      <span className="dusk-thread-location">{location}</span>
      <span className="dusk-thread-sep" aria-hidden>·</span>
      {snooze
        ? <time dateTime={new Date(snooze.until).toISOString()} title={`Wakes ${new Date(snooze.until).toLocaleString()}`}>wakes in {wakeLabel(snooze.until, now)}</time>
        : <time dateTime={new Date(at).toISOString()}>{relativeMessageTime(at, now)}</time>}
    </span>
  </div>
  </HoverCardTrigger>
  <HoverCardContent side="right" align="start" sideOffset={12} className="dusk-card-popover w-72 p-0" onPointerDown={e => e.stopPropagation()}>
    {wanted && <ThreadCard thread={thread} location={location} details={details} now={now} />}
  </HoverCardContent>
  </HoverCard>;
});

function CustomSnooze({ threadId, onClose, onSnooze }: { threadId: string | null; onClose(): void; onSnooze(id: string, until: number): void }) {
  const [day, setDay] = useState<Date | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [time, setTime] = useState('09:00');
  useEffect(() => {
    if (!threadId) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDay(tomorrow);
    setTime('09:00');
  }, [threadId]);
  const until = useMemo(() => {
    if (!day || !/^\d{2}:\d{2}$/.test(time)) return NaN;
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date(day);
    next.setHours(hours, minutes, 0, 0);
    return next.getTime();
  }, [day, time]);
  const valid = Number.isFinite(until) && until > Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return <Dialog open={threadId !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="w-auto max-w-fit">
      <DialogHeader><DialogTitle>Custom snooze</DialogTitle></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (threadId && valid) { onSnooze(threadId, until); onClose(); } }} className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="dusk-snooze-date" className="text-sm font-medium">Date</label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" id="dusk-snooze-date" className="w-40 justify-between font-normal">
                  {day ? day.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select date'}
                  <Icon name="ChevronDown" className="size-4 text-muted-foreground" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar mode="single" selected={day} captionLayout="dropdown" defaultMonth={day} disabled={{ before: today }}
                  startMonth={today} endMonth={new Date(today.getFullYear() + 2, 11)}
                  onSelect={next => { setDay(next); setCalendarOpen(false); }} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex w-32 flex-col gap-2">
            <label htmlFor="dusk-snooze-time" className="text-sm font-medium">Time</label>
            <Input id="dusk-snooze-time" type="time" step={60} value={time} onChange={event => setTime(event.target.value)}
              className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {Number.isFinite(until) ? (valid ? new Date(until).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Pick a time in the future') : 'Pick a day'}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!valid}>Snooze</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function StatusThreadList({ activeThreadId, onNavigate, Original }: PluginThreadListProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { status, threads: liveThreads, projects } = experimental_useSidebarThreads();
  const threads = useReadHold(liveThreads, activeThreadId);
  const projectsById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const [snoozes, setSnoozes] = useSnoozes(rpc);
  const pinnedIds = useMemo(() => threads.filter(t => t.isPinned).map(t => t.id).sort().join(','), [threads]);
  const pinKeys = usePinOrder(rpc, pinnedIds);
  const now = useNow(snoozes);
  const [collapsed, toggle] = useCollapsed();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const snoozeMap = useMemo(() => new Map(snoozes.map(s => [s.threadId, s])), [snoozes]);
  const sections = useMemo(() => buildFamilies(threads, snoozeMap, pinKeys, now), [threads, snoozeMap, pinKeys, now]);

  const actions = useMemo<RowActions>(() => ({
    snooze: (threadId, until) => { rpc.call('snooze', { threadId, until }).then(setSnoozes, error => toast.error(error instanceof Error ? error.message : 'Could not snooze the thread.')); },
    unsnooze: threadId => { rpc.call('unsnooze', { threadId }).then(setSnoozes, () => toast.error('Could not unsnooze the thread.')); },
    custom: setCustomFor,
    onNavigate,
  }), [rpc, setSnoozes, onNavigate]);

  // Snoozes that woke from new activity are finished; drop them so they
  // don't hide the thread again later.
  useEffect(() => {
    const live = new Set([...sections.get('snoozed')!].map(f => f.root.id));
    const stale = snoozes.filter(s => s.until > now && !live.has(s.threadId) && threads.some(t => t.id === s.threadId && !t.isPinned && (t.latestAttentionAt > s.at)));
    for (const s of stale) rpc.call('unsnooze', { threadId: s.threadId }).then(setSnoozes, () => {});
  }, [sections, snoozes, threads, now, rpc, setSnoozes]);

  useEffect(() => {
    statusListMounted++;
    const open = (event: Event) => setCustomFor((event as CustomEvent<string>).detail);
    window.addEventListener(SNOOZE_EVENT, open);
    return () => { statusListMounted--; window.removeEventListener(SNOOZE_EVENT, open); };
  }, []);

  if (status === 'error') return <Original />;
  if (status === 'loading' && threads.length === 0) return <div className="dusk-status-list" aria-busy="true" />;
  const empty = SECTIONS.every(({ id }) => sections.get(id)!.length === 0);
  return <div className="dusk-status-list">
    {empty && <p className="dusk-status-empty">No threads yet</p>}
    {SECTIONS.map(({ id, label }) => {
      const families = sections.get(id)!;
      if (families.length === 0) return null;
      const holdsActive = families.some(f => f.root.id === activeThreadId || f.children.some(c => c.id === activeThreadId));
      const open = !collapsed.has(id) || holdsActive;
      return <section key={id} className="dusk-status-section" data-section={id}>
        <button type="button" className="dusk-status-heading" aria-expanded={open} onClick={() => toggle(id)}>
          <span>{label}</span><span className="dusk-status-count">{families.length}</span>
          <Icon name="ChevronRight" className="dusk-status-chevron" aria-hidden />
        </button>
        {open && families.map(family => <div key={family.root.id} className="dusk-status-family" data-has-children={family.children.length > 0 || undefined}>
          <StatusRow thread={family.root} project={projectsById.get(family.root.projectId)} family={family} child={false} active={family.root.id === activeThreadId} now={now} actions={actions} />
          {family.children.length > 0 && <div className="dusk-status-children">
            {family.children.map(child => <StatusRow key={child.id} thread={child} project={projectsById.get(child.projectId)} family={family} child active={child.id === activeThreadId} now={now} actions={actions} />)}
          </div>}
        </div>)}
      </section>;
    })}
    <CustomSnooze threadId={customFor} onClose={() => setCustomFor(null)} onSnooze={actions.snooze} />
  </div>;
}
