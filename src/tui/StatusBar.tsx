import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import stringWidth from 'string-width';
import type { Balance, EffortSupport, RateLimit, Usage } from '../core/types.js';

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

/** Green when there's plenty left, yellow, then red. */
function levelColor(fractionUsed: number): string {
  if (fractionUsed < 0.5) return 'green';
  if (fractionUsed < 0.8) return 'yellow';
  return 'red';
}

/** True for servers on this machine or the local network. */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export type Connection = 'connecting' | 'connected' | 'failed';

export interface Speed {
  /** Seconds until the first token arrived. */
  firstToken: number;
  tokensPerSecond?: number;
}

export interface StatusInfo {
  baseUrl: string;
  connection: Connection;
  provider: string;
  model: string;
  /** undefined while unknown, null when the model doesn't support effort. */
  effortSupport?: EffortSupport | null;
  /** The level chosen with /effort, if any. */
  effort?: string;
  rateLimit?: RateLimit;
  lastUsage?: Usage;
  contextWindow?: number;
  speed?: Speed;
  /** Total spent this session; undefined when no cost can be known. */
  sessionCost?: number;
  /** Money left on the account, for providers that report it. */
  balance?: Balance;
}

interface Segment {
  width: number;
  node: ReactNode;
}

function segment(plain: string, node: ReactNode = <Text dimColor>{plain}</Text>): Segment {
  return { width: stringWidth(plain), node };
}

function connectionSegment({ baseUrl, connection }: StatusInfo): Segment {
  const local = isLocalUrl(baseUrl);
  const label = local ? 'local' : 'cloud';
  const dot = { connecting: 'yellow', connected: 'green', failed: 'red' }[connection];
  const suffix = connection === 'failed' ? ' offline' : connection === 'connecting' ? ' connecting…' : '';
  return segment(
    `● ${label}${suffix}`,
    <Text>
      <Text color={dot}>●</Text> <Text color={local ? 'green' : 'blue'}>{label}</Text>
      {suffix && <Text color={dot}>{suffix}</Text>}
    </Text>,
  );
}

/** The effort level in yellow: the chosen one, else the model's default. Hidden when unsupported. */
function effortSegment({ effortSupport, effort, connection }: StatusInfo): Segment | undefined {
  if (effortSupport === null) return undefined;
  if (!effort && effortSupport === undefined && connection === 'connecting') return segment('…');
  const level = effort ?? effortSupport?.defaultLevel ?? 'default';
  return segment(level, <Text color="yellow">{level}</Text>);
}

function rateLimitSegment({ rateLimit }: StatusInfo): Segment {
  // Before any reply some providers only tell us the per-minute limits.
  if (rateLimit?.requestsRemaining === undefined && rateLimit?.tokensRemaining === undefined) {
    const limits = [
      rateLimit?.requestsLimit !== undefined && `${formatTokens(rateLimit.requestsLimit)} req/min`,
      rateLimit?.tokensLimit !== undefined && `${formatTokens(rateLimit.tokensLimit)} tok/min`,
    ].filter(Boolean);
    return segment(limits.length ? limits.join(' · ') : 'limits —');
  }

  const parts: { label: string; remaining: number; limit?: number }[] = [];
  if (rateLimit.requestsRemaining !== undefined) {
    parts.push({ label: 'req', remaining: rateLimit.requestsRemaining, limit: rateLimit.requestsLimit });
  }
  if (rateLimit.tokensRemaining !== undefined) {
    parts.push({ label: 'tok', remaining: rateLimit.tokensRemaining, limit: rateLimit.tokensLimit });
  }

  const text = (p: (typeof parts)[number]) =>
    `${formatTokens(p.remaining)}${p.limit ? `/${formatTokens(p.limit)}` : ''}`;
  return segment(
    parts.map((p) => `${p.label} ${text(p)}`).join(' · '),
    <Text>
      {parts.map((p, i) => (
        <Text key={p.label}>
          {i > 0 && <Text dimColor> · </Text>}
          <Text dimColor>{p.label} </Text>
          <Text color={p.limit ? levelColor(1 - p.remaining / p.limit) : undefined}>{text(p)}</Text>
        </Text>
      ))}
    </Text>,
  );
}

function contextSegment({ lastUsage, contextWindow }: StatusInfo): Segment {
  const used = lastUsage ? lastUsage.inputTokens + lastUsage.outputTokens : 0;
  if (!contextWindow) return segment(`ctx ${formatTokens(used)}`);

  const fraction = Math.min(1, used / contextWindow);
  const cells = 8;
  const filled = Math.max(used > 0 ? 1 : 0, Math.round(fraction * cells));
  const percent = `${Math.round(fraction * 100)}%`;
  const label = `ctx ${formatTokens(used)}/${formatTokens(contextWindow)} `;
  return segment(
    `${label}${'▰'.repeat(cells)} ${percent}`,
    <Text>
      <Text dimColor>{label}</Text>
      <Text color={levelColor(fraction)}>{'▰'.repeat(filled)}</Text>
      <Text dimColor>{'▱'.repeat(cells - filled)}</Text>
      <Text color={levelColor(fraction)}> {percent}</Text>
    </Text>,
  );
}

function tokensSegment({ lastUsage }: StatusInfo): Segment {
  const tokensIn = formatTokens(lastUsage?.inputTokens ?? 0);
  const tokensOut = formatTokens(lastUsage?.outputTokens ?? 0);
  return segment(
    `↑ ${tokensIn} ↓ ${tokensOut}`,
    <Text>
      <Text color="blue">↑ {tokensIn}</Text> <Text color="green">↓ {tokensOut}</Text>
    </Text>,
  );
}

function speedSegment({ speed }: StatusInfo): Segment {
  if (!speed) return segment('⚡ —');
  const parts = [`${speed.firstToken.toFixed(1)}s`];
  if (speed.tokensPerSecond !== undefined) parts.push(`${Math.round(speed.tokensPerSecond)} tok/s`);
  const text = parts.join(' · ');
  return segment(
    `⚡ ${text}`,
    <Text>
      <Text color="yellow">⚡</Text> <Text color="cyan">{text}</Text>
    </Text>,
  );
}

function costSegment({ sessionCost }: StatusInfo): Segment {
  if (sessionCost === undefined) return segment('cost —');
  const cost = formatCost(sessionCost);
  return segment(cost, <Text color="yellow">{cost}</Text>);
}

function balanceSegment({ balance }: StatusInfo): Segment | undefined {
  if (!balance) return undefined;
  const parts: string[] = [];
  if (balance.usd !== undefined) parts.push(formatCost(balance.usd));
  if (balance.diem) parts.push(`${balance.diem.toLocaleString('en-US', { maximumFractionDigits: 2 })} DIEM`);
  if (balance.credits) parts.push(`${formatCost(balance.credits)} credits`);
  if (parts.length === 0) return undefined;
  const text = parts.join(' · ');
  return segment(
    `🪙 ${text} left`,
    <Text>
      🪙 <Text color="green">{text}</Text>
      <Text dimColor> left</Text>
    </Text>,
  );
}

/** Fits segments into lines no wider than `columns`, wrapping where needed. */
function flow(segments: Segment[], columns: number): Segment[][] {
  const separator = 3;
  const lines: Segment[][] = [];
  let width = 0;
  for (const item of segments) {
    const current = lines.at(-1);
    if (current && width + separator + item.width <= columns) {
      current.push(item);
      width += separator + item.width;
    } else {
      lines.push([item]);
      width = item.width;
    }
  }
  return lines;
}

export function StatusBar({ info, columns }: { info: StatusInfo; columns: number }) {
  const rows: (Segment | undefined)[][] = [
    [
      connectionSegment(info),
      segment(
        info.provider,
        <Text color="cyan" bold>
          {info.provider}
        </Text>,
      ),
      segment(info.model, <Text color="magenta">{info.model}</Text>),
      effortSegment(info),
      rateLimitSegment(info),
    ],
    [contextSegment(info), tokensSegment(info), speedSegment(info), costSegment(info), balanceSegment(info)],
  ];

  return (
    <Box flexDirection="column">
      {rows
        .map((row) => row.filter((item): item is Segment => item !== undefined))
        .flatMap((row) => flow(row, columns))
        .map((line, n) => (
          <Text key={n}>
            {line.map((item, i) => (
              <Text key={i}>
                {i > 0 && <Text dimColor> │ </Text>}
                {item.node}
              </Text>
            ))}
          </Text>
        ))}
    </Box>
  );
}
