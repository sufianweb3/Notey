import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Change } from '@shared/schemas';
import { api } from './api';
import { base, ck } from './content';

export const PAGE_CHANGED = 'notey:page-changed';
export type PageChangedDetail = { ws: string; pageId: string; change: Change };

/**
 * Live refresh (PRD §8): polls the change feed every 4 s while the tab is
 * visible and every 30 s in the background. Changes refresh the tree and
 * trash, and open docs hear about edits to their page through PAGE_CHANGED.
 */
export function useLiveRefresh(ws: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws) return;
    let seq: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, document.visibilityState === 'visible' ? 4_000 : 30_000);
    };

    async function tick() {
      try {
        const res = await api<{ seq: number; changes: Change[] }>(`${base(ws!)}/changes${seq === null ? '' : `?since=${seq}`}`);
        if (stopped) return;
        if (seq !== null && res.changes.length) {
          void qc.invalidateQueries({ queryKey: ck.tree(ws!) });
          void qc.invalidateQueries({ queryKey: ck.trash(ws!) });
          void qc.invalidateQueries({ queryKey: ['ws', ws, 'search'] });
          for (const change of res.changes) {
            if (change.entity === 'page') {
              void qc.invalidateQueries({ queryKey: ck.versions(ws!, change.entityId) });
              window.dispatchEvent(new CustomEvent<PageChangedDetail>(PAGE_CHANGED, { detail: { ws: ws!, pageId: change.entityId, change } }));
            }
          }
        }
        seq = res.seq;
      } catch {
        /* offline or signed out: try again on the next tick */
      }
      schedule();
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
      else schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ws, qc]);
}
