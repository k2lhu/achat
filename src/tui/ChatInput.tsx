import { Box, Text, useInput } from 'ink';
import { type ReactNode, useRef, useState } from 'react';
import stringWidth from 'string-width';

interface Props {
  value: string;
  /** Columns available to the input; it wraps its own rows to this width. */
  width: number;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** Ghost text shown after the cursor; Tab or → accepts it. */
  completion?: string;
  /** Rewrites pasted text (several characters arriving at once), e.g. dropped file paths. */
  transformPaste?: (text: string) => string;
  /** Called on Ctrl+V; the text it resolves to is inserted at the cursor. */
  onPasteRequest?: () => Promise<string | undefined>;
  /** Up on the first line / Down on the last line: step through earlier prompts. */
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** Start of the word before `from` (skipping whitespace first). */
function wordStartBefore(chars: string[], from: number): number {
  let i = from;
  while (i > 0 && isSpace(chars[i - 1])) i--;
  while (i > 0 && !isSpace(chars[i - 1])) i--;
  return i;
}

/** End of the word after `from` (skipping whitespace first). */
function wordEndAfter(chars: string[], from: number): number {
  let i = from;
  while (i < chars.length && isSpace(chars[i])) i++;
  while (i < chars.length && !isSpace(chars[i])) i++;
  return i;
}

function lineStart(chars: string[], at: number): number {
  let i = at;
  while (i > 0 && chars[i - 1] !== '\n') i--;
  return i;
}

function lineEnd(chars: string[], at: number): number {
  let i = at;
  while (i < chars.length && chars[i] !== '\n') i++;
  return i;
}

/**
 * Multi-line input with shell-style editing and inline completion. Works on
 * code points so emoji count as one character.
 *
 * - ←/→ move; Option+←/→ (or Ctrl+←/→) jump by word.
 * - Home/End or Ctrl+A/E jump to the start/end of the line; again for the whole text.
 * - ↑/↓ move between lines, and step through history from the first/last line.
 * - Enter sends. Shift+Enter (where the terminal reports it), Option+Enter, or a
 *   "\" before Enter add a new line. Pasted text keeps its line breaks.
 * - Backspace/Delete, Option+Backspace or Ctrl+W delete a word back, Option+D a word
 *   forward, Ctrl+U deletes to the start of the line.
 * - Tab, or → at the end, accepts the completion.
 */
export function ChatInput({
  value,
  width,
  onChange,
  onSubmit,
  placeholder = '',
  completion,
  transformPaste,
  onPasteRequest,
  onHistoryUp,
  onHistoryDown,
}: Props) {
  // Held in a ref so keys arriving before the next render see the latest text.
  const state = useRef({ value, cursor: [...value].length });
  if (state.current.value !== value) {
    // Changed from outside (sent, cleared, or recalled with Up/Down): cursor to the end.
    state.current = { value, cursor: [...value].length };
  }
  const [, rerender] = useState(0);

  const update = (chars: string[], cursor: number) => {
    const next = chars.join('');
    state.current = { value: next, cursor };
    rerender((n) => n + 1);
    if (next !== value) onChange(next);
  };

  /** Inserts text at the current cursor position. */
  const insert = (text: string) => {
    const chars = [...state.current.value];
    const cursor = Math.min(state.current.cursor, chars.length);
    const typed = [...text.replace(/\r\n?/g, '\n')];
    update([...chars.slice(0, cursor), ...typed, ...chars.slice(cursor)], cursor + typed.length);
  };

  /** Moves to the same column on the line above (-1) or below (+1). */
  const moveLine = (chars: string[], cursor: number, direction: -1 | 1): number => {
    const start = lineStart(chars, cursor);
    const column = cursor - start;
    const targetStart = direction < 0 ? lineStart(chars, start - 1) : lineEnd(chars, cursor) + 1;
    return Math.min(targetStart + column, lineEnd(chars, targetStart));
  };

  useInput((input, key) => {
    const chars = [...state.current.value];
    const cursor = Math.min(state.current.cursor, chars.length);
    const atEnd = cursor === chars.length;

    if (key.escape || key.pageUp || key.pageDown) return;

    if (key.upArrow) {
      if (lineStart(chars, cursor) === 0) return onHistoryUp?.();
      return update(chars, moveLine(chars, cursor, -1));
    }
    if (key.downArrow) {
      if (lineEnd(chars, cursor) === chars.length) return onHistoryDown?.();
      return update(chars, moveLine(chars, cursor, 1));
    }

    if (key.return) {
      if (key.shift || key.meta) return insert('\n');
      // A backslash right before the cursor turns Enter into a new line, as in Claude Code.
      if (chars[cursor - 1] === '\\') {
        return update([...chars.slice(0, cursor - 1), '\n', ...chars.slice(cursor)], cursor);
      }
      return onSubmit(state.current.value);
    }

    if ((key.tab || (key.rightArrow && atEnd && !key.meta && !key.ctrl)) && completion) {
      const next = [...chars, ...completion];
      return update(next, next.length);
    }
    if (key.tab) return;

    // Word jumps: Option+arrows arrive as meta+arrow or as Esc b / Esc f.
    if ((key.leftArrow && (key.meta || key.ctrl)) || (key.meta && input === 'b')) {
      return update(chars, wordStartBefore(chars, cursor));
    }
    if ((key.rightArrow && (key.meta || key.ctrl)) || (key.meta && input === 'f')) {
      return update(chars, wordEndAfter(chars, cursor));
    }
    if (key.leftArrow) return update(chars, Math.max(0, cursor - 1));
    if (key.rightArrow) return update(chars, Math.min(chars.length, cursor + 1));

    // Start/end of the line; pressed again at the edge, the whole text.
    if (key.home || (key.ctrl && input === 'a')) {
      const start = lineStart(chars, cursor);
      return update(chars, cursor === start ? 0 : start);
    }
    if (key.end || (key.ctrl && input === 'e')) {
      const end = lineEnd(chars, cursor);
      return update(chars, cursor === end ? chars.length : end);
    }

    if (key.ctrl && input === 'u') {
      const start = lineStart(chars, cursor);
      return update([...chars.slice(0, start), ...chars.slice(cursor)], start);
    }
    if (key.ctrl && input === 'v' && onPasteRequest) {
      void onPasteRequest().then((text) => text && insert(text));
      return;
    }
    if ((key.backspace && key.meta) || (key.ctrl && input === 'w')) {
      const start = wordStartBefore(chars, cursor);
      return update([...chars.slice(0, start), ...chars.slice(cursor)], start);
    }
    if (key.meta && input === 'd') {
      const end = wordEndAfter(chars, cursor);
      return update([...chars.slice(0, cursor), ...chars.slice(end)], cursor);
    }
    if (key.backspace) {
      if (cursor === 0) return;
      return update([...chars.slice(0, cursor - 1), ...chars.slice(cursor)], cursor - 1);
    }
    if (key.delete) {
      return update([...chars.slice(0, cursor), ...chars.slice(cursor + 1)], cursor);
    }

    if (key.ctrl || key.meta || !input) return;
    // Several characters at once means a paste (or a file dragged onto the terminal).
    insert(input.length > 1 && transformPaste ? transformPaste(input) : input);
  });

  const chars = [...state.current.value];
  const cursor = Math.min(state.current.cursor, chars.length);
  const cols = Math.max(2, width);

  if (chars.length === 0) {
    return (
      <Text>
        <Text inverse>{placeholder[0] ?? ' '}</Text>
        <Text color="gray">{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  // Draw row by row; the cursor (or the first ghost character at the very end) is inverted.
  // Rows are wrapped here rather than by Ink: Ink lets a space at a wrap point (such as
  // the cursor block) spill one column past the edge, the terminal then wraps it onto a
  // line Ink doesn't know about, and every redraw leaves a stale copy of the input behind.
  const lines: string[][] = [[]];
  for (const char of chars) {
    if (char === '\n') lines.push([]);
    else lines.at(-1)!.push(char);
  }
  const rows: ReactNode[] = [];
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    const column = cursor >= start && cursor <= start + line.length ? cursor - start : -1;
    const segments = wrapRow(line, cols);
    const last = segments.at(-1)!;
    // A cursor after a full last row needs a row of its own.
    if (column === line.length && cellWidth(line.slice(last[0])) >= cols) segments.push([line.length, line.length]);

    segments.forEach(([from, to], n) => {
      const key = `${start}:${from}:${n}`;
      const isLast = n === segments.length - 1;
      const here = column >= from && (column < to || (isLast && column === to)) ? column : -1;
      if (here < 0) {
        rows.push(<Text key={key}>{line.slice(from, to).join('') || ' '}</Text>);
      } else if (here < to) {
        rows.push(
          <Text key={key}>
            {line.slice(from, here).join('')}
            <Text inverse>{line[here]}</Text>
            {line.slice(here + 1, to).join('')}
          </Text>,
        );
      } else {
        const before = line.slice(from, to);
        // Ghost text only at the very end, cut to fit the row.
        const room = cols - cellWidth(before);
        const ghost = cursor === chars.length ? fit([...(completion ?? '')], room) : [];
        rows.push(
          <Text key={key}>
            {before.join('')}
            <Text inverse color={ghost.length ? 'gray' : undefined}>
              {ghost[0] ?? ' '}
            </Text>
            <Text color="gray">{ghost.slice(1).join('')}</Text>
          </Text>,
        );
      }
    });
  }
  return <Box flexDirection="column">{rows}</Box>;
}

const cellWidth = (chars: string[]) => chars.reduce((sum, char) => sum + stringWidth(char), 0);

/** The longest start of `chars` that fits in `room` cells. */
function fit(chars: string[], room: number): string[] {
  let used = 0;
  let n = 0;
  while (n < chars.length && used + stringWidth(chars[n]!) <= room) used += stringWidth(chars[n++]!);
  return chars.slice(0, n);
}

/**
 * Splits a line into [from, to) rows at most `width` cells wide, breaking after a
 * space where possible and mid-word only when a word is wider than the row.
 */
export function wrapRow(line: string[], width: number): [number, number][] {
  const rows: [number, number][] = [];
  let from = 0;
  while (from < line.length) {
    let to = from;
    let used = 0;
    while (to < line.length && used + stringWidth(line[to]!) <= width) used += stringWidth(line[to++]!);
    if (to === from) to++; // A character wider than the row: show it anyway.
    if (to < line.length) {
      let space = to;
      while (space > from && !isSpace(line[space - 1])) space--;
      if (space > from) to = space;
    }
    rows.push([from, to]);
    from = to;
  }
  if (rows.length === 0) rows.push([0, 0]);
  return rows;
}
