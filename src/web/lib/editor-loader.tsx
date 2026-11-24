import { lazy, type ComponentProps } from 'react';
import type * as EditorModule from '@web/components/editor/doc-editor';

/*
 * The doc page's loader awaits the editor module, then the page renders it
 * directly. Rendering through lazy() would still suspend for one render, long
 * enough for fast typing after Enter in the title to land in the title.
 * Lives in its own module because route code-splitting separates a route's
 * loader from its component.
 */
let loaded: typeof EditorModule | undefined;

export const loadEditor = () =>
  import('@web/components/editor/doc-editor').then((m) => {
    loaded = m;
    return m;
  });

const LazyDocEditor = lazy(loadEditor);

type Props = ComponentProps<typeof EditorModule.default>;

/** The doc editor: rendered directly once loaded, through Suspense otherwise. */
export function DocEditorSlot(props: Props) {
  const Loaded = loaded?.default;
  return Loaded ? <Loaded {...props} /> : <LazyDocEditor {...props} />;
}
