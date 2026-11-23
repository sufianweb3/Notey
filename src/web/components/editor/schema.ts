import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from '@blocknote/core';
import { Callout, InlineMath, MathBlock, MermaidBlock, PageLink } from './blocks';

// PRD 6.3 block set: no video or audio blocks, headings H1–H3 only.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { video, audio, ...baseBlocks } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...baseBlocks,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3] }),
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    callout: Callout(),
    math: MathBlock(),
    mermaid: MermaidBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    inlineMath: InlineMath,
    pageLink: PageLink,
  },
});

export type NoteyEditor = typeof schema.BlockNoteEditor;
export type NoteyBlock = typeof schema.Block;
export type NoteyPartialBlock = typeof schema.PartialBlock;
