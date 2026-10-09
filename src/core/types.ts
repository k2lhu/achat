// Platform-neutral types shared by any frontend (terminal, desktop, mobile).

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** Which wire protocol an endpoint speaks. */
export type ApiKind = 'openai' | 'anthropic';

/** Where to send requests. `apiKey` is optional for local servers. */
export interface Endpoint {
  kind: ApiKind;
  baseUrl: string;
  apiKey?: string;
}

/** Token counts for one request, as reported by the API. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** USD, only when the API reports it (e.g. OpenRouter). */
  cost?: number;
}

/** Remaining allowance reported by the API in response headers. */
export interface RateLimit {
  requestsRemaining?: number;
  requestsLimit?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'rateLimit'; rateLimit: RateLimit };

/** How a reasoning effort level is sent: Anthropic's output_config.effort,
 *  OpenAI's top-level reasoning_effort, or OpenRouter's reasoning.effort. */
export type EffortParam = 'output_config' | 'reasoning_effort' | 'reasoning';

export interface EffortSupport {
  levels: string[];
  /** Level the API uses when none is sent, if known. */
  defaultLevel?: string;
  param: EffortParam;
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** Reasoning effort to request; omitted means the model's default. */
  effort?: { level: string; param: EffortParam };
}

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
}

/** What the API tells us about a model; every field is optional. */
export interface ModelInfo {
  contextWindow?: number;
  price?: Price;
  /** null: the model doesn't support effort. undefined: the API doesn't say. */
  effort?: EffortSupport | null;
  /** From the headers of the request that fetched this info. */
  rateLimit?: RateLimit;
}
