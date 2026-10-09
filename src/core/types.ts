// Platform-neutral types shared by any frontend (terminal, desktop, mobile).

export type Role = 'system' | 'user' | 'assistant';

/** A file sent along with a message. Binary data is base64. */
export type Attachment =
  | { kind: 'text'; name: string; size: number; text: string }
  | { kind: 'image'; name: string; size: number; mediaType: string; data: string }
  /** `text` is extracted locally, for providers that can't read PDFs natively. */
  | { kind: 'pdf'; name: string; size: number; data: string; text: string };

export interface ChatMessage {
  role: Role;
  content: string;
  attachments?: Attachment[];
}

/** Which API an endpoint speaks. Venice is OpenAI-compatible plus account balance. */
export type ApiKind = 'openai' | 'anthropic' | 'venice';

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

/** Money left on the account, for APIs that report it. */
export interface Balance {
  usd?: number;
  /** Venice's DIEM token balance. */
  diem?: number;
  /** Prepaid plan credits, in USD. */
  credits?: number;
}

/** Account details for providers that report them. */
export interface Account {
  balance?: Balance;
  /** Per-minute limits (no remaining counts). */
  rateLimit?: RateLimit;
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
  /** Whether the model accepts images; undefined when the API doesn't say. */
  vision?: boolean;
  /** From the headers of the request that fetched this info. */
  rateLimit?: RateLimit;
}
