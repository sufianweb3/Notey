/*
 * The subset of BlockNote's document JSON that Notey stores in
 * page.content_json. Kept loose on purpose: the editor owns the exact shape,
 * the server only needs enough to derive Markdown and search text.
 */
export type Styles = Partial<{
  bold: true;
  italic: true;
  underline: true;
  strike: true;
  code: true;
  textColor: string;
  backgroundColor: string;
}>;

export type StyledText = { type: 'text'; text: string; styles?: Styles };
export type LinkContent = { type: 'link'; href: string; content: StyledText[] };
/** Inline LaTeX, `$…$` in Markdown. */
export type MathInline = { type: 'inlineMath'; props: { latex: string }; content?: undefined };
/** Link to another page. Markdown: [Title](notey://page/<id>) */
export type PageLinkInline = { type: 'pageLink'; props: { pageId: string; title: string }; content?: undefined };

export type InlineContent = StyledText | LinkContent | MathInline | PageLinkInline;

export type TableCell = {
  type: 'tableCell';
  props?: { textAlignment?: 'left' | 'center' | 'right' | 'justify'; [k: string]: unknown };
  content: InlineContent[];
};

export type TableContent = {
  type: 'tableContent';
  columnWidths?: (number | null | undefined)[];
  headerRows?: number;
  rows: { cells: (TableCell | InlineContent[])[] }[];
};

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export type Block = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | TableContent;
  children?: Block[];
};

export const PAGE_LINK_SCHEME = 'notey://page/';
