// Featherless-specific extras on top of its OpenAI-compatible API.
// Its catalogue has thousands of models, so this avoids downloading the full list.

import { ApiError } from './errors.js';
import type { Account, Endpoint, ModelInfo } from './types.js';

export const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';

async function get(endpoint: Endpoint, path: string, signal?: AbortSignal) {
  const res = await fetch(endpoint.baseUrl.replace(/\/+$/, '') + path, {
    headers: {
      'User-Agent': 'achat',
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    },
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, `${res.status}: ${body?.message ?? body?.error?.message ?? res.statusText}`);
  return body;
}

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** One model's details (model IDs contain a slash, which the API accepts as is). */
export async function getFeatherlessModelInfo(endpoint: Endpoint, model: string, signal?: AbortSignal): Promise<ModelInfo> {
  const body = await get(endpoint, `/models/${model}`, signal);
  const info = body?.data ?? body ?? {};
  return {
    contextWindow: amount(info.context_length),
    vision: typeof info.vision_supported === 'boolean' ? info.vision_supported : undefined,
    concurrencyCost: amount(info.concurrency_cost),
    // Reasoning is switched through each model's chat template, not reasoning_effort.
    effort: null,
  };
}

/** The most popular models available on the account's plan (up to 1000). */
export async function listFeatherlessModels(endpoint: Endpoint, signal?: AbortSignal): Promise<string[]> {
  const query = endpoint.apiKey ? 'available_on_current_plan=true&' : '';
  const body = await get(endpoint, `/models?${query}per_page=1000&sort=-popularity`, signal);
  return (body?.data ?? []).map((m: { id: string }) => m.id);
}

/** The subscription plan: name, concurrency units and context cap. */
export async function getFeatherlessAccount(endpoint: Endpoint, signal?: AbortSignal): Promise<Account> {
  const plan = await get(endpoint, '/plan', signal);
  if (!plan?.name) return {};
  return {
    plan: {
      name: String(plan.name),
      concurrency: amount(plan.concurrency),
      maxContextLength: amount(plan.max_context_length),
    },
  };
}
