import { Text } from 'ink';
import type { ReactNode } from 'react';
import type { Usage } from '../core/types.js';

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function contextColor(fraction: number): string {
  if (fraction < 0.5) return 'green';
  if (fraction < 0.8) return 'yellow';
  return 'red';
}

interface Segment {
  /** Lower numbers are dropped first when the bar doesn't fit. */
  priority: number;
  width: number;
  node: ReactNode;
}

interface Props {
  provider: string;
  model: string;
  turns: number;
  /** Usage of the latest reply; its input + output is the conversation's size. */
  lastUsage?: Usage;
  contextWindow?: number;
  /** Total spent this session, when at least one reply's cost was known. */
  sessionCost?: number;
  columns: number;
}

export function StatusBar({ provider, model, turns, lastUsage, contextWindow, sessionCost, columns }: Props) {
  const segments: Segment[] = [];
  const add = (priority: number, plain: string, node: ReactNode) =>
    segments.push({ priority, width: plain.length, node });

  add(
    9,
    `${provider} ${model}`,
    <Text>
      <Text color="cyan" bold>
        {provider}
      </Text>{' '}
      <Text color="magenta">{model}</Text>
    </Text>,
  );

  if (lastUsage) {
    const used = lastUsage.inputTokens + lastUsage.outputTokens;
    if (contextWindow) {
      const fraction = Math.min(1, used / contextWindow);
      const cells = 8;
      const filled = Math.max(used > 0 ? 1 : 0, Math.round(fraction * cells));
      const percent = `${Math.round(fraction * 100)}%`;
      const label = `ctx ${formatTokens(used)}/${formatTokens(contextWindow)} `;
      add(
        5,
        `${label}${'▰'.repeat(cells)} ${percent}`,
        <Text>
          <Text dimColor>{label}</Text>
          <Text color={contextColor(fraction)}>{'▰'.repeat(filled)}</Text>
          <Text dimColor>{'▱'.repeat(cells - filled)}</Text>
          <Text color={contextColor(fraction)}> {percent}</Text>
        </Text>,
      );
    } else {
      const label = `ctx ${formatTokens(used)}`;
      add(5, label, <Text dimColor>{label}</Text>);
    }

    const tokensIn = formatTokens(lastUsage.inputTokens);
    const tokensOut = formatTokens(lastUsage.outputTokens);
    add(
      3,
      `↑ ${tokensIn} ↓ ${tokensOut}`,
      <Text>
        <Text color="blue">↑ {tokensIn}</Text> <Text color="green">↓ {tokensOut}</Text>
      </Text>,
    );
  }

  if (sessionCost !== undefined) {
    const cost = formatCost(sessionCost);
    add(4, cost, <Text color="yellow">{cost}</Text>);
  }

  if (turns > 0) {
    const label = `${turns} turn${turns === 1 ? '' : 's'}`;
    add(1, label, <Text dimColor>{label}</Text>);
  }

  // Drop the least important segments until the bar fits on one line.
  const separator = 3;
  const total = () => segments.reduce((sum, s) => sum + s.width, 0) + separator * (segments.length - 1);
  while (segments.length > 1 && total() > columns) {
    const lowest = segments.reduce((min, s) => (s.priority < min.priority ? s : min));
    segments.splice(segments.indexOf(lowest), 1);
  }

  return (
    <Text>
      {segments.map((segment, i) => (
        <Text key={i}>
          {i > 0 && <Text dimColor> │ </Text>}
          {segment.node}
        </Text>
      ))}
    </Text>
  );
}
