import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PageDetail } from '@shared/schemas';
import { api, ApiError } from './api';
import { base, ck } from './content';
import { PAGE_CHANGED, type PageChangedDetail } from './live';

export type SaveState = 'saved' | 'saving' | 'error' | 'offline';

const DEBOUNCE_MS = 600;
/** Edits within this window count as "still typing": remote changes wait. */
const QUIET_MS = 3_000;

type Options = {
  ws: string;
  page: PageDetail;
  /** The current content to save. */
  read: () => unknown;
  /** Replace local content with the server's (reload, remote edit). */
  apply: (page: PageDetail) => void;
  /**
   * Optional: combine a remote version with local unsaved edits. Returning
   * content saves it on top of the remote rev; without it, a remote edit
   * during local edits shows the conflict bar.
   */
  merge?: (remote: PageDetail) => unknown;
  onSaveState: (s: SaveState) => void;
  onRemote: (page: PageDetail) => void;
};

/**
 * Autosave for canvas and mindmap pages, with the same rules as the doc
 * editor: debounced saves carry the last rev, a stale rev (409) never
 * overwrites, remote edits load when you're idle.
 */
export function usePageSync({ ws, page, read, apply, merge, onSaveState, onRemote }: Options) {
  const qc = useQueryClient();
  const rev = useRef(page.rev);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const lastEdit = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryDelay = useRef(2_000);
  const merging = useRef(false);
  const [conflict, setConflict] = useState<{ by: string } | null>(null);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const opts = useRef({ read, apply, merge, onSaveState, onRemote });
  opts.current = { read, apply, merge, onSaveState, onRemote };

  const schedule = (ms = DEBOUNCE_MS) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), ms);
  };

  async function save(content?: unknown) {
    if (content === undefined && (merging.current || !dirty.current)) return;
    if (inFlight.current || conflictRef.current) return;
    dirty.current = false;
    inFlight.current = true;
    opts.current.onSaveState('saving');
    const body = content ?? opts.current.read();
    try {
      const res = await api<{ rev: number; updatedAt: string; contentMd: string }>(`${base(ws)}/pages/${page.id}/content`, {
        method: 'PUT',
        body: { rev: rev.current, content: body },
      });
      rev.current = res.rev;
      retryDelay.current = 2_000;
      qc.setQueryData<PageDetail>(ck.page(ws, page.id), (old) =>
        old ? { ...old, rev: res.rev, updatedAt: res.updatedAt, contentMd: res.contentMd, content: body } : old,
      );
      opts.current.onSaveState(dirty.current ? 'saving' : 'saved');
    } catch (e) {
      dirty.current = true;
      if (e instanceof ApiError && e.status === 409) {
        inFlight.current = false;
        if (opts.current.merge) return void resolveByMerge();
        setConflict({ by: String(e.details?.updatedBy ?? '') });
        opts.current.onSaveState('error');
      } else {
        opts.current.onSaveState(e instanceof ApiError && e.status === 0 ? 'offline' : 'error');
        schedule(retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
      }
    } finally {
      inFlight.current = false;
      if (dirty.current && !conflictRef.current) schedule();
    }
  }

  async function fetchLatest() {
    return (await api<{ page: PageDetail }>(`${base(ws)}/pages/${page.id}`)).page;
  }

  async function resolveByMerge() {
    if (merging.current) return;
    merging.current = true;
    try {
      const latest = await fetchLatest();
      const merged = opts.current.merge!(latest);
      rev.current = latest.rev;
      dirty.current = true;
      merging.current = false;
      await save(merged);
    } catch {
      merging.current = false;
      schedule(retryDelay.current);
    }
  }

  function load(next: PageDetail) {
    opts.current.apply(next);
    rev.current = next.rev;
    dirty.current = false;
    setConflict(null);
    conflictRef.current = null;
    opts.current.onSaveState('saved');
  }

  /** Call on every local edit. */
  function markDirty() {
    dirty.current = true;
    lastEdit.current = Date.now();
    schedule();
  }

  useEffect(() => {
    const onOnline = () => dirty.current && void save();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', beforeUnload);
      clearTimeout(timer.current);
      if (dirty.current) void save(); // leaving the page: flush
    };
  }, []);

  // Edits from another tab or an agent.
  useEffect(() => {
    async function onChanged(e: Event) {
      const { ws: w, pageId } = (e as CustomEvent<PageChangedDetail>).detail;
      if (w !== ws || pageId !== page.id) return;
      let latest: PageDetail;
      try {
        latest = await fetchLatest();
      } catch {
        return;
      }
      opts.current.onRemote(latest);
      if (latest.rev <= rev.current) return; // our own save
      const busy = dirty.current || inFlight.current || Date.now() - lastEdit.current < QUIET_MS;
      if (!busy) load(latest);
      else if (opts.current.merge) void resolveByMerge();
      else setConflict({ by: latest.updatedBy });
    }
    window.addEventListener(PAGE_CHANGED, onChanged);
    return () => window.removeEventListener(PAGE_CHANGED, onChanged);
  }, [ws, page.id]);

  async function reload() {
    try {
      load(await fetchLatest());
    } catch {
      toast.error("Couldn't load the latest version. Try again.");
    }
  }

  async function keepMine() {
    try {
      const latest = await fetchLatest();
      rev.current = latest.rev;
      setConflict(null);
      conflictRef.current = null;
      dirty.current = true;
      await save();
      toast('Kept your version', { description: 'The other version is in page history.' });
    } catch {
      toast.error("Couldn't save your version. Try again.");
    }
  }

  return { markDirty, load, conflict, reload, keepMine };
}
