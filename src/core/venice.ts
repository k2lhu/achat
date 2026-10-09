// Venice-specific extras on top of its OpenAI-compatible API.

import { ApiError } from './errors.js';
import type { Account, Endpoint, RateLimit } from './types.js';

export const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Balances and the model's per-minute limits via GET /api_keys/rate_limits,
 * which works with a normal API key.
 */
export async function getVeniceAccount(endpoint: Endpoint, model: string, signal?: AbortSignal): Promise<Account> {
  const url = endpoint.baseUrl.replace(/\/+$/, '') + '/api_keys/rate_limits';
  const res = await fetch(url, {
    headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status}: could not read the Venice account`);
  const data = (await res.json())?.data ?? {};

  const balances = data.balances ?? {};
  const account: Account = {
    balance: { usd: amount(balances.USD), diem: amount(balances.DIEM), credits: amount(balances.BUNDLED_CREDITS) },
  };

  const entry = Array.isArray(data.rateLimits)
    ? data.rateLimits.find((r: { apiModelId?: string }) => r.apiModelId === model)
    : undefined;
  if (Array.isArray(entry?.rateLimits)) {
    const limit = (type: string) =>
      amount(entry.rateLimits.find((l: { type?: string }) => l.type === type)?.amount);
    const rateLimit: RateLimit = { requestsLimit: limit('RPM'), tokensLimit: limit('TPM') };
    if (rateLimit.requestsLimit !== undefined || rateLimit.tokensLimit !== undefined) account.rateLimit = rateLimit;
  }
  return account;
}
