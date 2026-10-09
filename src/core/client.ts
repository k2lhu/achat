// Chat client. OpenAI-compatible endpoints use only web-standard APIs (fetch,
// TextDecoder, ReadableStream); Anthropic endpoints go through the official SDK.
// Either way it runs unchanged in Node, browsers, Electron and Tauri.

import { getAnthropicModelInfo, listAnthropicModels, streamAnthropic } from './anthropic.js';
import { ApiError } from './errors.js';
import type { ChatMessage, Endpoint, ModelInfo, StreamEvent, Usage } from './types.js';

export { ApiError };

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function url(endpoint: Endpoint, path: string): string {
  return endpoint.baseUrl.replace(/\/+$/, '') + path;
}

function headers(endpoint: Endpoint): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  if (endpoint.apiKey) result.Authorization = `Bearer ${endpoint.apiKey}`;
  return result;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message ?? parsed?.message ?? body;
  } catch {
    // Not JSON; use the raw body.
  }
  message = String(message).trim().slice(0, 500) || res.statusText;
  return new ApiError(res.status, `${res.status}: ${message}`);
}

/** Streams the reply: text chunks as they arrive, then token usage if reported. */
export function streamChat(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  return endpoint.kind === 'anthropic'
    ? streamAnthropic(endpoint, model, messages, signal)
    : streamOpenAI(endpoint, model, messages, signal);
}

/** Lists model IDs the endpoint offers, sorted alphabetically. */
export async function listModels(endpoint: Endpoint, signal?: AbortSignal): Promise<string[]> {
  const ids =
    endpoint.kind === 'anthropic'
      ? await listAnthropicModels(endpoint, signal)
      : (await fetchOpenAIModels(endpoint, signal)).map((m) => String(m.id));
  return ids.sort((a, b) => a.localeCompare(b));
}

/** Context window and pricing for a model, as far as the API reports them. */
export async function getModelInfo(
  endpoint: Endpoint,
  model: string,
  signal?: AbortSignal,
): Promise<ModelInfo> {
  if (endpoint.kind === 'anthropic') return getAnthropicModelInfo(endpoint, model, signal);
  const entry = (await fetchOpenAIModels(endpoint, signal)).find((m) => m.id === model);
  return entry ? modelInfoFromListing(entry) : {};
}

// Servers that reject `stream_options` usually say so in the error message.
const UNSUPPORTED_OPTION = /stream_options|include_usage|unrecognized|unknown (field|param|argument)|extra (field|input)/i;

async function* streamOpenAI(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const request = (withUsage: boolean) =>
    fetch(url(endpoint, '/chat/completions'), {
      method: 'POST',
      headers: headers(endpoint),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    });

  // Ask for token usage; retry without it for servers that don't support the option.
  let res = await request(true);
  if (res.status === 400 || res.status === 422) {
    const error = await toApiError(res);
    if (!UNSUPPORTED_OPTION.test(error.message)) throw error;
    res = await request(false);
  }
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError(res.status, 'Response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: Usage | undefined;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          if (usage) yield { type: 'usage', usage };
          return;
        }

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new ApiError(0, chunk.error.message ?? JSON.stringify(chunk.error));
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            ...(typeof chunk.usage.cost === 'number' ? { cost: chunk.usage.cost } : {}),
          };
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield { type: 'text', text: delta };
      }
    }
    if (usage) yield { type: 'usage', usage };
  } finally {
    reader.releaseLock();
  }
}

type ModelListing = Record<string, unknown> & { id: unknown };

async function fetchOpenAIModels(endpoint: Endpoint, signal?: AbortSignal): Promise<ModelListing[]> {
  const res = await fetch(url(endpoint, '/models'), { headers: headers(endpoint), signal });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body?.data ?? [];
}

function field(source: unknown, path: string): unknown {
  let value = source;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function firstNumber(source: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = Number(field(source, path));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

// There's no standard for this in OpenAI-compatible APIs; these are the
// field names used by OpenRouter, Venice, Groq, vLLM and others.
const CONTEXT_FIELDS = [
  'context_length',
  'context_window',
  'max_context_length',
  'max_input_tokens',
  'max_model_len',
  'model_spec.availableContextTokens',
  'top_provider.context_length',
];

function modelInfoFromListing(entry: ModelListing): ModelInfo {
  const info: ModelInfo = { contextWindow: firstNumber(entry, CONTEXT_FIELDS) };

  // Venice: USD per million tokens.
  const veniceIn = firstNumber(entry, ['model_spec.pricing.input.usd']);
  const veniceOut = firstNumber(entry, ['model_spec.pricing.output.usd']);
  // OpenRouter: USD per token, as strings.
  const routerIn = firstNumber(entry, ['pricing.prompt']);
  const routerOut = firstNumber(entry, ['pricing.completion']);

  if (veniceIn !== undefined && veniceOut !== undefined) {
    info.price = { input: veniceIn, output: veniceOut };
  } else if (routerIn !== undefined && routerOut !== undefined) {
    info.price = { input: routerIn * 1_000_000, output: routerOut * 1_000_000 };
  }
  return info;
}
