import type { Price, Usage } from './types.js';

// Anthropic first-party list prices, USD per million tokens (as of 2026-10).
// Used only when nothing better is known; prices change, so treat costs as estimates.
const ANTHROPIC_PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function anthropicPrice(model: string): Price | undefined {
  return ANTHROPIC_PRICES[model];
}

/** Cost of one request in USD: the API's own figure if given, else from a price. */
export function costOf(usage: Usage, price: Price | undefined): number | undefined {
  if (usage.cost !== undefined) return usage.cost;
  if (!price) return undefined;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
