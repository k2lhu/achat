// The original renderer, built on marked-terminal. Kept as an alternative to
// the native renderer in ./new.ts; switch with /renderer or `renderer` in the config.

import { Marked, type MarkedExtension, type Tokens } from 'marked';
import { markedTerminal } from 'marked-terminal';

const renderers = new Map<number, Marked>();

// marked-terminal renders the text of compact ("tight") list items verbatim,
// so **bold**, *italic*, `code` and links inside them show up raw. Those text
// tokens carry their parsed inline tokens; render those instead.
const listItemInlineFix: MarkedExtension = {
  renderer: {
    text(token: Tokens.Text | Tokens.Escape) {
      if ('tokens' in token && token.tokens?.length) {
        return this.parser.parseInline(token.tokens);
      }
      return false;
    },
  },
};

/** Renders markdown to ANSI-styled text for the terminal. */
export function renderMarkdown(text: string, width: number): string {
  let marked = renderers.get(width);
  if (!marked) {
    marked = new Marked(markedTerminal({ width, tab: 2 }) as MarkedExtension, listItemInlineFix);
    renderers.set(width, marked);
  }
  return (marked.parse(text) as string).trimEnd();
}
