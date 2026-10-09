// Chat client. OpenAI-compatible endpoints use only web-standard APIs (fetch,
// TextDecoder, ReadableStream); Anthropic endpoints go through the official SDK.
// Either way it runs unchanged in Node, browsers, Electron and Tauri.

import { listAnthropicModels, streamAnthropic } from './anthropic.js';
import { ApiError } from './errors.js';
import type { ChatMessage, Endpoint } from './types.js';

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

/** Streams the assistant's reply, yielding text chunks as they arrive. */
export function streamChat(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  return endpoint.kind === 'anthropic'
    ? streamAnthropic(endpoint, model, messages, signal)
    : streamOpenAI(endpoint, model, messages, signal);
}

/** Lists model IDs the endpoint offers, sorted alphabetically. */
export async function listModels(endpoint: Endpoint, signal?: AbortSignal): Promise<string[]> {
  const ids =
    endpoint.kind === 'anthropic'
      ? await listAnthropicModels(endpoint, signal)
      : await listOpenAIModels(endpoint, signal);
  return ids.sort((a, b) => a.localeCompare(b));
}

async function* streamOpenAI(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(url(endpoint, '/chat/completions'), {
    method: 'POST',
    headers: headers(endpoint),
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError(res.status, 'Response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (data === '[DONE]') return;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new ApiError(0, chunk.error.message ?? JSON.stringify(chunk.error));
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function listOpenAIModels(endpoint: Endpoint, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(url(endpoint, '/models'), { headers: headers(endpoint), signal });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return (body?.data ?? []).map((m: { id: string }) => m.id);
}
