import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';

interface Props {
  value: string;
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

  if (chars.length === 0) {
    return (
      <Text>
        <Text inverse>{placeholder[0] ?? ' '}</Text>
        <Text color="gray">{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  // Draw line by line; the cursor (or the first ghost character at the very end) is inverted.
  const lines: string[][] = [[]];
  for (const char of chars) {
    if (char === '\n') lines.push([]);
    else lines.at(-1)!.push(char);
  }
  let offset = 0;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        const start = offset;
        offset += line.length + 1;
        const hasCursor = cursor >= start && cursor <= start + line.length;
        if (!hasCursor) return <Text key={i}>{line.join('') || ' '}</Text>;

        const column = cursor - start;
        const before = line.slice(0, column).join('');
        if (column < line.length) {
          return (
            <Text key={i}>
              {before}
              <Text inverse>{line[column]}</Text>
              {line.slice(column + 1).join('')}
            </Text>
          );
        }
        const ghost = cursor === chars.length ? [...(completion ?? '')] : [];
        return (
          <Text key={i}>
            {before}
            <Text inverse color={ghost.length ? 'gray' : undefined}>
              {ghost[0] ?? ' '}
            </Text>
            <Text color="gray">{ghost.slice(1).join('')}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
