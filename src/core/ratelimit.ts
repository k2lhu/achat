import type { RateLimit } from './types.js';

function number(headers: Headers, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = Number(headers.get(name));
    if (headers.has(name) && Number.isFinite(value)) return value;
  }
  return undefined;
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
