// Anthropic Messages API backend, via the official SDK.

import Anthropic from '@anthropic-ai/sdk';
import { imagesOf, pdfsOf, textWithFiles } from './attachments.js';
import { ApiError } from './errors.js';
import { anthropicPrice } from './pricing.js';
import { parseRateLimit } from './ratelimit.js';
import type { ChatMessage, ChatOptions, EffortSupport, Endpoint, ModelInfo, StreamEvent } from './types.js';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// The API doesn't report defaults; these models default to medium, others to high.
const MEDIUM_DEFAULT_MODELS = new Set(['claude-opus-5-5', 'claude-haiku-5-5']);

function client(endpoint: Endpoint): Anthropic {
  return new Anthropic({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    // The same core runs in a browser-based frontend; keys stay on the user's device.
    dangerouslyAllowBrowser: true,
    // The SDK reports the OS, CPU, runtime and SDK version by default. Send none
    // of that; `null` removes a header.
    defaultHeaders: {
      'User-Agent': 'achat',
      'X-Stainless-Lang': null,
      'X-Stainless-Package-Version': null,
      'X-Stainless-OS': null,
      'X-Stainless-Arch': null,
      'X-Stainless-Runtime': null,
      'X-Stainless-Runtime-Version': null,
    },
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

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Plain text, or PDFs (natively) and images followed by the text. */
function toContent(message: ChatMessage): string | Anthropic.ContentBlockParam[] {
  if (!message.attachments?.length) return message.content;
  return [
    ...pdfsOf(message).map(
      (pdf): Anthropic.ContentBlockParam => ({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdf.data },
        title: pdf.name,
      }),
    ),
    ...imagesOf(message).map(
      (image): Anthropic.ContentBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType as ImageMediaType, data: image.data },
      }),
    ),
    { type: 'text', text: textWithFiles(message, true) },
  ];
}

export async function* streamAnthropic(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  { signal, effort }: ChatOptions,
): AsyncGenerator<StreamEvent> {
  // Anthropic takes the system prompt as a top-level field, not a message.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: toContent(m) }));

  const params = {
    model,
    max_tokens: 64000,
    messages: turns,
    ...(system ? { system } : {}),
    ...(effort ? { output_config: { effort: effort.level as EffortLevel } } : {}),
  };

  try {
    const api = client(endpoint);
    const stream = FALLBACK_MODELS.has(model)
      ? api.beta.messages.stream(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : api.messages.stream(params, { signal });

    const { response } = await stream.withResponse();
    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit) yield { type: 'rateLimit', rateLimit };

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
    const { data: info, response } = await client(endpoint)
      .models.retrieve(model, {}, { signal })
      .withResponse();

    let effort: EffortSupport | null | undefined;
    const caps = info.capabilities?.effort;
    if (caps) {
      effort = caps.supported
        ? {
            levels: EFFORT_LEVELS.filter((level) => caps[level]?.supported),
            defaultLevel: MEDIUM_DEFAULT_MODELS.has(model) ? 'medium' : 'high',
            param: 'output_config',
          }
        : null;
    }

    return {
      contextWindow: info.max_input_tokens ?? undefined,
      price: anthropicPrice(model),
      effort,
      vision: info.capabilities?.image_input.supported,
      rateLimit: parseRateLimit(response.headers),
    };
  } catch (error) {
    throw toApiError(error);
  }
}
