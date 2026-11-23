import type { Workspace } from '@shared/schemas';

/*
 * Dev-only data fixtures. Append `?fixture=<name>` to any URL in `pnpm dev`
 * to render a view against worst-case or edge-case data. Stripped from
 * production builds (import.meta.env.DEV is false there).
 */

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

function ws(id: string, name: string, icon: string | null, sort: number, deletedDaysAgo?: number): Workspace {
  return {
    id,
    name,
    icon,
    sort,
    aiEnabled: true,
    createdAt: iso(-90 + sort),
    deletedAt: deletedDaysAgo === undefined ? null : iso(-deletedDaysAgo),
  };
}

export const fixtures = {
  ideal: {
    workspaces: [
      ws('fx-1', 'Personal', '🏡', 0),
      ws('fx-2', 'Fevgo', 'F', 1),
      ws('fx-3', 'CRG Attire', 'C', 2),
      ws('fx-4', 'Tomás & Mei: research', null, 3),
    ],
    trash: [ws('fx-9', 'Old client', 'O', 9, 26)],
  },
  worst: {
    workspaces: [
      ws('fx-1', 'A', null, 0),
      ws('fx-2', 'Nadia Rahman-Østergaard’s extremely long workspace name for the Q4 rebrand', '🧪', 1),
      ws('fx-3', 'Rafi', 'Rf', 2),
      ...Array.from({ length: 14 }, (_, i) => ws(`fx-x${i}`, `Client workspace ${i + 4}`, null, i + 3)),
    ],
    trash: [
      ws('fx-8', 'Deleted 29 days ago, purges tomorrow', null, 8, 29),
      ws('fx-9', 'Ünïcödé — 名前 — مساحة العمل', '名', 9, 1),
    ],
  },
  one: { workspaces: [ws('fx-1', 'Personal', null, 0)], trash: [] },
} satisfies Record<string, { workspaces: Workspace[]; trash: Workspace[] }>;

type Kind = 'workspaces' | 'trash';

/** In dev, `?fixture=ideal|worst|one|loading|error` replaces API data. */
export async function fixtureOverride(kind: Kind): Promise<Workspace[] | null> {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(location.search).get('fixture');
  if (!name) return null;
  if (name === 'loading') return new Promise(() => {});
  if (name === 'error') throw new Error('Fixture: simulated failure');
  const set = fixtures[name as keyof typeof fixtures];
  return set ? set[kind] : null;
}
