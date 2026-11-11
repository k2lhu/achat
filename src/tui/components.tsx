import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

interface SelectListProps<T> {
  title: string;
  choices: Choice<T>[];
  onSelect: (value: T) => void;
  onCancel: () => void;
  initialValue?: T;
  /** Typing narrows the list. */
  filterable?: boolean;
  /** When filtering, offer the typed text itself as a choice. */
  customChoice?: (text: string) => Choice<T>;
  limit?: number;
}

export function SelectList<T>({
  title,
  choices,
  onSelect,
  onCancel,
  initialValue,
  filterable = false,
  customChoice,
  limit = 10,
}: SelectListProps<T>) {
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(() =>
    Math.max(0, choices.findIndex((c) => c.value === initialValue)),
  );

  const needle = filter.trim().toLowerCase();
  let visible = needle ? choices.filter((c) => c.label.toLowerCase().includes(needle)) : choices;
  if (needle && customChoice && !visible.some((c) => c.label.toLowerCase() === needle)) {
    visible = [customChoice(filter.trim()), ...visible];
  }
  const current = Math.min(index, Math.max(0, visible.length - 1));

  useInput((input, key) => {
    if (key.escape) return onCancel();
    // Update from the latest index, so presses that arrive before a re-render aren't lost.
    const last = Math.max(0, visible.length - 1);
    if (key.upArrow) return setIndex((i) => Math.max(0, Math.min(i, last) - 1));
    if (key.downArrow) return setIndex((i) => Math.min(last, Math.min(i, last) + 1));
    if (key.return) {
      const choice = visible[current];
      if (choice) onSelect(choice.value);
      return;
    }
    if (!filterable) return;
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setIndex(0);
    } else if (input && !key.ctrl && !key.meta && !key.tab) {
      setFilter((f) => f + input);
      setIndex(0);
    }
  });

  const start = Math.min(
    Math.max(0, current - Math.floor(limit / 2)),
    Math.max(0, visible.length - limit),
  );
  const shown = visible.slice(start, start + limit);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      {filterable && (
        <Text dimColor>
          Filter: {filter ? <Text color="white">{filter}</Text> : '(type to narrow the list)'}
        </Text>
      )}
      {shown.map((choice, i) => {
        const active = start + i === current;
        return (
          <Text key={`${start + i}:${choice.label}`} color={active ? 'cyan' : undefined}>
            {active ? '❯ ' : '  '}
            {choice.label}
            {choice.hint && <Text dimColor>{`  ${choice.hint}`}</Text>}
          </Text>
        );
      })}
      {visible.length === 0 && <Text dimColor>  No matches</Text>}
      {visible.length > limit && (
        <Text dimColor>{`  ${current + 1} of ${visible.length}`}</Text>
      )}
      <Text dimColor>↑↓ move · Enter select · Esc cancel</Text>
    </Box>
  );
}

interface PromptProps {
  label: string;
  hint?: string;
  initial?: string;
  placeholder?: string;
  /** Hide what's typed, e.g. for API keys. */
  secret?: boolean;
  /** Return an error message to reject the value. */
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function Prompt({
  label,
  hint,
  initial = '',
  placeholder,
  secret,
  validate,
  onSubmit,
  onCancel,
}: PromptProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  function submit(raw: string) {
    const trimmed = raw.trim();
    const problem = validate?.(trimmed);
    if (problem) setError(problem);
    else onSubmit(trimmed);
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{label}</Text>
      {hint && <Text dimColor>{hint}</Text>}
      <Box>
        <Text color="cyan">{'❯ '}</Text>
        <TextInput
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(undefined);
          }}
          onSubmit={submit}
          placeholder={placeholder}
          mask={secret ? '•' : undefined}
        />
      </Box>
      {error && <Text color="red">{error}</Text>}
      <Text dimColor>Enter confirm · Esc cancel</Text>
    </Box>
  );
}
