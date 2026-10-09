import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

const renderers = new Map<number, Marked>();

/** Renders markdown to ANSI-styled text for the terminal. */
export function renderMarkdown(text: string, width: number): string {
  let marked = renderers.get(width);
  if (!marked) {
    marked = new Marked(markedTerminal({ width, tab: 2 }) as MarkedExtension);
    renderers.set(width, marked);
  }
  return (marked.parse(text) as string).trimEnd();
}
