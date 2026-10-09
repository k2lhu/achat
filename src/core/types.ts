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

export type StreamEvent = { type: 'text'; text: string } | { type: 'usage'; usage: Usage };

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
}

/** What the API tells us about a model; every field is optional. */
export interface ModelInfo {
  contextWindow?: number;
  price?: Price;
}
