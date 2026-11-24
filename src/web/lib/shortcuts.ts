import { useEffect, useRef } from 'react';
import { isMac } from './workspace-memory';

/** True when typing in a field or the editor, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  // Canvas and mindmap use single keys for their own tools.
  return !!el.closest?.('[data-own-keys]');
}

export const mod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

type Binding = {
  /** e.g. 'mod+k', 'mod+\\', 'mod+shift+p', '?' */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** Single-key shortcuts are skipped while typing; mod combos run anywhere unless false. */
  whileTyping?: boolean;
};

function matches(combo: string, e: KeyboardEvent) {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  if (wantMod !== mod(e) || wantAlt !== e.altKey) return false;
  // '?' is shift+/ on most layouts; compare the produced key and ignore shift for it.
  if (key !== '?' && wantShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key || (key === '\\' && e.code === 'Backslash');
}

/** Global keyboard shortcuts. Bindings are read from a ref so callers can pass inline closures. */
export function useShortcuts(bindings: Binding[]) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      for (const b of ref.current) {
        if (!matches(b.combo, e)) continue;
        const single = !b.combo.includes('mod');
        if (isTyping(e.target) && (single || b.whileTyping === false)) continue;
        e.preventDefault();
        b.handler(e);
        return;
      }
    }
    // Canvas and mindmap claim keys for their own tools (Excalidraw takes ⌘K
    // for links). App-wide ⌘ combos go first there, before the engine sees them.
    function onKeyFirst(e: KeyboardEvent) {
      if (e.isComposing || !mod(e) || !(e.target as HTMLElement | null)?.closest?.('[data-own-keys]')) return;
      const b = ref.current.find((x) => x.combo.includes('mod') && x.whileTyping !== false && matches(x.combo, e));
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      b.handler(e);
    }
    window.addEventListener('keydown', onKeyFirst, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyFirst, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
