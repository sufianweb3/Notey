import { FileText, ListChecks, Shapes, Workflow } from 'lucide-react';
import type { PageType } from '@shared/schemas';

/** One icon per page type, everywhere a page is listed. */
export const PAGE_ICONS: Record<PageType, typeof FileText> = { doc: FileText, canvas: Shapes, mindmap: Workflow, tasklist: ListChecks };

export const PAGE_TYPE_LABEL: Record<PageType, string> = { doc: 'Doc', canvas: 'Canvas', mindmap: 'Mindmap', tasklist: 'Task list' };
