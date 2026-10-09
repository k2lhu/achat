// Renders markdown to styled terminal text. `marked` only tokenizes; layout,
// wrapping and styling happen here so lists, quotes and tables wrap with
// proper hanging indents.

import chalk, { type ChalkInstance } from 'chalk';
import hljs from 'highlight.js/lib/common';
import { lexer, type Token, type Tokens } from 'marked';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

const style = {
  heading1: chalk.bold.underline,
  heading: chalk.bold,
  strong: chalk.bold,
  em: chalk.italic,
  del: chalk.strikethrough,
  code: chalk.cyan,
  link: chalk.blueBright.underline,
  url: chalk.gray,
  quote: chalk.italic,
  muted: chalk.gray,
};

const BULLETS = ['•', '◦', '▪'];
const MIN_WIDTH = 10;

type Lines = string[];

// --- Inline ---------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
    const hex = entity[1] === 'x' || entity[1] === 'X';
    const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

// Inline HTML tags models commonly use, rendered as styles instead of raw tags.
const HTML_STYLES: Record<string, (text: string) => string> = {
  u: chalk.underline,
  ins: chalk.underline,
  b: style.strong,
  strong: style.strong,
  i: style.em,
  em: style.em,
  s: style.del,
  del: style.del,
  strike: style.del,
  code: style.code,
  kbd: style.code,
  mark: chalk.inverse,
  sub: (text) => text,
  sup: (text) => text,
  small: (text) => text,
  span: (text) => text,
};

function htmlTag(token: Token): { name: string; closing: boolean } | undefined {
  if (token.type !== 'html') return undefined;
  const match = (token as Tokens.HTML).text.trim().match(/^<(\/?)([a-z]+)\b[^>]*>$/i);
  return match ? { closing: match[1] === '/', name: match[2]!.toLowerCase() } : undefined;
}

function renderInline(tokens: Token[] = []): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        // A single newline inside a paragraph is a soft break, i.e. a space.
        out += text.tokens ? renderInline(text.tokens) : decodeEntities(text.text).replace(/\n/g, ' ');
        break;
      }
      case 'escape':
        out += (token as Tokens.Escape).text;
        break;
      case 'strong':
        out += style.strong(renderInline((token as Tokens.Strong).tokens));
        break;
      case 'em':
        out += style.em(renderInline((token as Tokens.Em).tokens));
        break;
      case 'del':
        out += style.del(renderInline((token as Tokens.Del).tokens));
        break;
      case 'codespan':
        out += style.code((token as Tokens.Codespan).text);
        break;
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const label = renderInline(link.tokens);
        const plainLabel = label.replace(/\x1b\[[0-9;]*m/g, '');
        const showUrl = plainLabel !== link.href && !link.href.startsWith('mailto:');
        out += style.link(label) + (showUrl ? ' ' + style.url(`(${link.href})`) : '');
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        out += style.url(`[image: ${image.text || image.href}]`);
        break;
      }
      case 'html': {
        const tag = htmlTag(token);
        if (tag?.name === 'br') {
          out += '\n';
          break;
        }
        const apply = tag && HTML_STYLES[tag.name];
        if (tag && apply) {
          if (tag.closing) break; // Unmatched closing tag: drop it.
          // Find the matching closing tag, allowing nesting of the same tag.
          let depth = 1;
          let end = i + 1;
          for (; end < tokens.length; end++) {
            const other = htmlTag(tokens[end]!);
            if (other?.name !== tag.name) continue;
            depth += other.closing ? -1 : 1;
            if (depth === 0) break;
          }
          out += apply(renderInline(tokens.slice(i + 1, end)));
          i = end;
          break;
        }
        out += style.muted((token as Tokens.HTML).text);
        break;
      }
      default:
        out += 'raw' in token ? String(token.raw) : '';
    }
  }
  return out;
}

// --- Code -----------------------------------------------------------------------

const CODE_STYLES: Record<string, ChalkInstance> = {
  keyword: chalk.magenta,
  'selector-tag': chalk.magenta,
  built_in: chalk.cyan,
  type: chalk.cyan,
  'title.class': chalk.yellow,
  'title.function': chalk.blueBright,
  title: chalk.blueBright,
  literal: chalk.blue,
  number: chalk.yellow,
  symbol: chalk.yellow,
  bullet: chalk.yellow,
  string: chalk.green,
  regexp: chalk.red,
  'template-variable': chalk.red,
  variable: chalk.red,
  attr: chalk.cyan,
  attribute: chalk.cyan,
  property: chalk.cyan,
  'selector-class': chalk.yellow,
  'selector-id': chalk.yellow,
  name: chalk.red,
  tag: chalk.gray,
  meta: chalk.gray,
  comment: chalk.gray.italic,
  doctag: chalk.gray.italic,
  quote: chalk.gray.italic,
  addition: chalk.green,
  deletion: chalk.red,
  section: chalk.bold.blue,
  emphasis: chalk.italic,
  strong: chalk.bold,
  link: chalk.underline,
};

function codeStyle(classNames: string): ChalkInstance | undefined {
  // highlight.js classes look like "hljs-keyword" or "hljs-title function_".
  const [first = '', second] = classNames.split(/\s+/);
  const base = first.replace(/^hljs-/, '');
  const scoped = second?.endsWith('_') ? `${base}.${second.slice(0, -1)}` : undefined;
  return (scoped && CODE_STYLES[scoped]) || CODE_STYLES[base];
}

/** Converts highlight.js HTML output into ANSI-styled text. */
function htmlToAnsi(html: string): string {
  const stack: (ChalkInstance | undefined)[] = [];
  let out = '';
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (match[1] !== undefined) {
      stack.push(codeStyle(match[1]) ?? stack.at(-1));
    } else if (match[2] === undefined) {
      stack.pop();
    } else {
      const text = decodeEntities(match[2]);
      const current = stack.at(-1);
      out += current ? current(text) : text;
    }
  }
  return out;
}

function renderCode(code: string, lang: string | undefined, width: number): Lines {
  const language = lang?.trim().split(/\s+/)[0]?.toLowerCase();
  let text = code.replace(/\t/g, '  ');
  if (language && hljs.getLanguage(language)) {
    text = htmlToAnsi(hljs.highlight(text, { language, ignoreIllegals: true }).value);
  }
  return text
    .split('\n')
    .flatMap((line) => wrapAnsi(line, Math.max(MIN_WIDTH, width - 2), { hard: true, trim: false }).split('\n'))
    .map((line) => `  ${line}`);
}

// --- Tables ---------------------------------------------------------------------

function widest(text: string): number {
  return Math.max(0, ...text.split('\n').map((line) => stringWidth(line)));
}

function pad(text: string, width: number, align: Tokens.TableCell['align'] | undefined): string {
  const gap = Math.max(0, width - stringWidth(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
  return text + ' '.repeat(gap);
}

function renderTable(table: Tokens.Table, width: number): Lines {
  const header = table.header.map((cell) => style.strong(renderInline(cell.tokens)));
  const rows = table.rows.map((row) => row.map((cell) => renderInline(cell.tokens)));
  const columns = header.length;

  // Shrink the widest columns until the table fits; cells then wrap.
  const widths = header.map((h, i) => Math.max(3, widest(h), ...rows.map((row) => widest(row[i] ?? ''))));
  const available = width - (3 * columns + 1);
  while (widths.reduce((a, b) => a + b, 0) > available) {
    const index = widths.indexOf(Math.max(...widths));
    if (widths[index]! <= 6) return renderTableAsRecords(header, rows, width);
    widths[index]!--;
  }

  const border = (left: string, middle: string, right: string) =>
    style.muted(left + widths.map((w) => '─'.repeat(w + 2)).join(middle) + right);
  const bar = style.muted('│');

  const renderRow = (cells: string[]): Lines => {
    const wrapped = widths.map((w, i) => wrapAnsi(cells[i] ?? '', w, { hard: true }).split('\n'));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    return Array.from({ length: height }, (_, line) =>
      bar + wrapped.map((lines, i) => ` ${pad(lines[line] ?? '', widths[i]!, table.align[i])} `).join(bar) + bar,
    );
  };

  return [
    border('┌', '┬', '┐'),
    ...renderRow(header),
    border('├', '┼', '┤'),
    ...rows.flatMap(renderRow),
    border('└', '┴', '┘'),
  ];
}

/** Fallback for tables too wide for the terminal: one "Header: value" block per row. */
function renderTableAsRecords(header: string[], rows: string[][], width: number): Lines {
  const out: Lines = [];
  rows.forEach((row, r) => {
    if (r > 0) out.push(style.muted('─'.repeat(Math.min(width, 20))));
    header.forEach((name, i) => {
      out.push(...wrap(`${name}${style.muted(':')} ${row[i] ?? ''}`, width));
    });
  });
  return out;
}

// --- Blocks ---------------------------------------------------------------------

function wrap(text: string, width: number): Lines {
  return wrapAnsi(text, Math.max(MIN_WIDTH, width), { hard: true }).split('\n');
}

function renderList(list: Tokens.List, width: number, depth: number): Lines {
  const start = typeof list.start === 'number' ? list.start : 1;
  const markers = list.items.map((_, i) =>
    list.ordered ? `${start + i}.` : BULLETS[depth % BULLETS.length]!,
  );
  const markerWidth = Math.max(...markers.map((m) => stringWidth(m)));

  const out: Lines = [];
  list.items.forEach((item, i) => {
    let prefix = list.ordered ? markers[i]!.padStart(markerWidth) : markers[i]!;
    if (item.task) prefix += item.checked ? ' [x]' : ' [ ]';
    const indent = stringWidth(prefix) + 1;
    const body = renderBlocks(item.tokens, width - indent, depth + 1, item.loose);

    if (i > 0 && list.loose) out.push('');
    body.forEach((line, n) => {
      if (n === 0) out.push(`${prefix} ${line}`);
      else out.push(line ? ' '.repeat(indent) + line : '');
    });
    if (body.length === 0) out.push(prefix);
  });
  return out;
}

function renderBlock(token: Token, width: number, depth: number): Lines | null {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      const heading = token as Tokens.Heading;
      const apply = heading.depth === 1 ? style.heading1 : style.heading;
      return wrap(apply(renderInline(heading.tokens)), width);
    }
    case 'paragraph':
      return wrap(renderInline((token as Tokens.Paragraph).tokens), width);
    case 'text': {
      const text = token as Tokens.Text;
      return wrap(text.tokens ? renderInline(text.tokens) : decodeEntities(text.text), width);
    }
    case 'code': {
      const code = token as Tokens.Code;
      return renderCode(code.text, code.lang, width);
    }
    case 'blockquote': {
      const inner = renderBlocks((token as Tokens.Blockquote).tokens, width - 2, depth);
      return inner.map((line) => style.muted('│ ') + style.quote(line));
    }
    case 'list':
      return renderList(token as Tokens.List, width, depth);
    case 'table':
      return renderTable(token as Tokens.Table, width);
    case 'hr':
      return [style.muted('─'.repeat(Math.max(MIN_WIDTH, width)))];
    case 'html':
      return wrap(style.muted((token as Tokens.HTML).text.trim()), width);
    default:
      return 'raw' in token ? wrap(String(token.raw).trimEnd(), width) : null;
  }
}

/** Lays out blocks, separated by blank lines unless `spaced` is false. */
function renderBlocks(tokens: Token[], width: number, depth = 0, spaced = true): Lines {
  const out: Lines = [];
  for (const token of tokens) {
    const lines = renderBlock(token, width, depth);
    if (!lines) continue;
    if (out.length && spaced) out.push('');
    out.push(...lines);
  }
  return out;
}

/** Renders markdown to ANSI-styled text that fits within `width` columns. */
export function renderMarkdown(text: string, width: number): string {
  return renderBlocks(lexer(text), width).join('\n');
}
