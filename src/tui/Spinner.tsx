import { Text } from 'ink';
import { useEffect, useState } from 'react';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const VERBS = [
  'Cooking',
  'Brewing',
  'Simmering',
  'Pondering',
  'Mulling',
  'Conjuring',
  'Percolating',
  'Marinating',
  'Tinkering',
  'Noodling',
  'Crafting',
  'Steeping',
];

const ACCENT = '#D97757';
const SHIMMER = '#F5C4AE';
const TICK_MS = 100;

export function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]!;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

interface Props {
  /** e.g. "Cooking"; an ellipsis is added. */
  label: string;
  startedAt: number;
  /** Rough count of tokens received so far, shown once the reply starts. */
  tokens?: number;
  /** Show the "esc to stop" hint. */
  stoppable?: boolean;
}

/** Animated "working" line: pulsing glyph, shimmering label, elapsed time. */
export function Spinner({ label, startedAt, tokens, stoppable }: Props) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const frame = FRAMES[Math.floor(tick / 1.5) % FRAMES.length];
  const text = `${label}…`;
  // A soft highlight sweeps across the label, with a pause between passes.
  const sweep = (tick % (text.length + 12)) - 3;

  const details = [
    formatElapsed(Date.now() - startedAt),
    tokens ? `↓ ${tokens.toLocaleString('en-US')} tokens` : undefined,
    stoppable ? 'esc to stop' : undefined,
  ].filter(Boolean);

  return (
    <Text>
      <Text color={ACCENT}>{frame} </Text>
      {[...text].map((char, i) => (
        <Text key={i} color={Math.abs(i - sweep) <= 1 ? SHIMMER : ACCENT}>
          {char}
        </Text>
      ))}
      <Text dimColor> ({details.join(' · ')})</Text>
    </Text>
  );
}
