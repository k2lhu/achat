// Anthropic Messages API backend, via the official SDK.

import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from './errors.js';
import { anthropicPrice } from './pricing.js';
import type { ChatMessage, Endpoint, ModelInfo, StreamEvent } from './types.js';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

function client(endpoint: Endpoint): Anthropic {
  return new Anthropic({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    // The same core runs in a browser-based frontend; keys stay on the user's device.
    dangerouslyAllowBrowser: true,
  });
}

function toApiError(error: unknown): unknown {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const message = body?.error?.message ?? error.message;
    return new ApiError(error.status ?? 0, error.status ? `${error.status}: ${message}` : message);
  }
  return error;
}

export async function* streamAnthropic(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // Anthropic takes the system prompt as a top-level field, not a message.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const params = {
    model,
    max_tokens: 64000,
    messages: turns,
    ...(system ? { system } : {}),
  };

  try {
    const api = client(endpoint);
    const stream = FALLBACK_MODELS.has(model)
      ? api.beta.messages.stream(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : api.messages.stream(params, { signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    const usage = final.usage;
    yield {
      type: 'usage',
      usage: {
        inputTokens:
          usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      },
    };
    if (final.stop_reason === 'refusal') {
      throw new ApiError(0, 'Claude declined to answer this request.');
    }
  } catch (error) {
    throw toApiError(error);
  }
}

export async function listAnthropicModels(
  endpoint: Endpoint,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of client(endpoint).models.list({}, { signal })) {
      ids.push(model.id);
    }
    return ids;
  } catch (error) {
    throw toApiError(error);
  }
}

export async function getAnthropicModelInfo(
  endpoint: Endpoint,
  model: string,
  signal?: AbortSignal,
): Promise<ModelInfo> {
  try {
    const info = await client(endpoint).models.retrieve(model, {}, { signal });
    return { contextWindow: info.max_input_tokens ?? undefined, price: anthropicPrice(model) };
  } catch (error) {
    throw toApiError(error);
  }
}
