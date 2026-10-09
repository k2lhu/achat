import { Text, useInput } from 'ink';
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
}

/** Index just after the end of the previous word, for word deletion. */
function previousWordStart(chars: string[], from: number): number {
  let i = from;
  while (i > 0 && chars[i - 1] === ' ') i--;
  while (i > 0 && chars[i - 1] !== ' ') i--;
  return i;
}

/**
 * Single-line input with shell-style editing and inline completion.
 * Works on code points so emoji count as one character.
 * Keys: ←/→ move, Home/End or Ctrl+A/E jump, Backspace/Delete, Option+Backspace
 * or Ctrl+W delete a word, Ctrl+U clears to the start, Tab or → (at the end)
 * accepts the completion. Up/Down and Esc are left to the parent.
 */
export function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  completion,
  transformPaste,
  onPasteRequest,
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
    const typed = [...text.replace(/\r\n?|\n/g, ' ')];
    update([...chars.slice(0, cursor), ...typed, ...chars.slice(cursor)], cursor + typed.length);
  };

  useInput((input, key) => {
    const chars = [...state.current.value];
    const cursor = Math.min(state.current.cursor, chars.length);
    const atEnd = cursor === chars.length;

    if (key.upArrow || key.downArrow || key.escape || key.pageUp || key.pageDown) return;
    if (key.return) return onSubmit(state.current.value);

    if ((key.tab || (key.rightArrow && atEnd)) && completion) {
      const next = [...chars, ...completion];
      return update(next, next.length);
    }
    if (key.tab) return;

    if (key.leftArrow) return update(chars, Math.max(0, cursor - 1));
    if (key.rightArrow) return update(chars, Math.min(chars.length, cursor + 1));
    if (key.home || (key.ctrl && input === 'a')) return update(chars, 0);
    if (key.end || (key.ctrl && input === 'e')) return update(chars, chars.length);

    if (key.ctrl && input === 'u') return update(chars.slice(cursor), 0);
    if (key.ctrl && input === 'v' && onPasteRequest) {
      void onPasteRequest().then((text) => text && insert(text));
      return;
    }
    if ((key.backspace && key.meta) || (key.ctrl && input === 'w')) {
      const start = previousWordStart(chars, cursor);
      return update([...chars.slice(0, start), ...chars.slice(cursor)], start);
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

  const before = chars.slice(0, cursor).join('');
  if (cursor < chars.length) {
    return (
      <Text>
        {before}
        <Text inverse>{chars[cursor]}</Text>
        {chars.slice(cursor + 1).join('')}
      </Text>
    );
  }

  // Cursor at the end: it sits on the first ghost character, if any.
  const ghost = [...(completion ?? '')];
  return (
    <Text>
      {before}
      <Text inverse color={ghost.length ? 'gray' : undefined}>
        {ghost[0] ?? ' '}
      </Text>
      <Text color="gray">{ghost.slice(1).join('')}</Text>
    </Text>
  );
}
