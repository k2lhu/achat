import type { RateLimit } from './types.js';

function number(headers: Headers, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = Number(headers.get(name));
    if (headers.has(name) && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Combines two readings, preferring values from `next` where it has them. */
export function mergeRateLimit(previous: RateLimit | undefined, next: RateLimit | undefined): RateLimit | undefined {
  if (!next) return previous;
  if (!previous) return next;
  const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  return { ...previous, ...defined };
}

/** Reads rate-limit headers (OpenAI/Venice/OpenRouter style and Anthropic style). */
export function parseRateLimit(headers: Headers): RateLimit | undefined {
  const limit: RateLimit = {
    requestsRemaining: number(headers, 'x-ratelimit-remaining-requests', 'anthropic-ratelimit-requests-remaining'),
    requestsLimit: number(headers, 'x-ratelimit-limit-requests', 'anthropic-ratelimit-requests-limit'),
    tokensRemaining: number(headers, 'x-ratelimit-remaining-tokens', 'anthropic-ratelimit-tokens-remaining'),
    tokensLimit: number(headers, 'x-ratelimit-limit-tokens', 'anthropic-ratelimit-tokens-limit'),
  };
  return Object.values(limit).some((v) => v !== undefined) ? limit : undefined;
}
