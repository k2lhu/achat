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
