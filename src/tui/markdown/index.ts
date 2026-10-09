import { renderMarkdown as renderClassic } from './classic.js';
import { renderMarkdown as renderNew } from './new.js';

export const RENDERERS = ['new', 'classic'] as const;
export type Renderer = (typeof RENDERERS)[number];

export const RENDERER_DESCRIPTIONS: Record<Renderer, string> = {
  new: 'achat’s own layout: wrapped lists, fitted tables, no # on headings',
  classic: 'the original marked-terminal look',
};

export function isRenderer(value: string): value is Renderer {
  return (RENDERERS as readonly string[]).includes(value);
}

/** Renders markdown to ANSI-styled text that fits within `width` columns. */
export function renderMarkdown(text: string, width: number, renderer: Renderer = 'new'): string {
  return renderer === 'classic' ? renderClassic(text, width) : renderNew(text, width);
}
