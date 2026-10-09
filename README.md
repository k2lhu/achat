# achat

A minimal, private terminal chat for Anthropic, Venice and any OpenAI-compatible API (OpenAI,
OpenRouter, Groq, Ollama, LM Studio, Jan's local server, …).

- No telemetry, no logs, no chat history on disk. Conversations live in memory and are gone when you quit.
- API keys are read from the macOS Keychain or environment variables, never stored in the config.

## Setup

```bash
npm install
npm run build
npm link            # optional: makes the `achat` command available everywhere
```

Then just run `achat`. The first time, it walks you through adding a provider: pick the
service, paste your API key, choose a model. The key goes into your macOS Keychain and the
rest into `~/.config/achat/config.toml`. Add or remove providers later with `/provider`.

You can also edit the config by hand; see `config.example.toml`.

## Usage

```bash
achat                      # default provider
achat -p ollama -m qwen3   # pick provider and model
npm run dev                # run from source without building
```

Inside the chat, type `/help` for commands: `/provider`, `/model`, `/effort`, `/system`,
`/renderer`, `/clear`, `/quit`. Press Esc to stop a reply mid-stream.

`/effort` sets the reasoning effort for the current model. On its own it lists the levels
the model supports (as reported by Anthropic, Venice and OpenRouter); `/effort high` sets one
directly and `/effort default` goes back to the model's own setting. Models without effort
support say so; where the API doesn't report support (e.g. OpenAI, local servers) you can
still set a level, but it may be rejected. The choice lasts for the session and shows in the
status bar.

### Files

Attach files to a message in any of three ways:

- **`@path`** anywhere in the message, e.g. `summarise @~/notes/plan.md`. Tab completes file
  and folder names; spaces in paths are written as `\ `.
- **Drag a file** from Finder onto the terminal window; its path becomes an `@` mention.
- **Ctrl+V** pastes a copied image (such as a screenshot) as `[image #1]`, or a file copied in
  Finder as an `@` mention.

Text and code files are included in the message as text. Images go to vision models (achat
checks first, where the provider reports it). PDFs are sent natively to Anthropic and as
extracted text to other providers. Files are read into memory only and sent with the
conversation, so they're re-sent with every following message and count towards the context.

Replies are rendered as markdown. `/renderer` switches between `new` (achat's own layout)
and `classic` (the original marked-terminal look); set `renderer = "classic"` at the top of
the config to make it the default.

## Status bar

Two lines below the input, filled in as soon as achat connects (each wraps in narrow windows):

```
● cloud │ venice-ai │ zai-org-glm-4.7-flash │ high │ 150 req/min · 10M tok/min
ctx 0/128k ▱▱▱▱▱▱▱▱ 0% │ ↑ 0 ↓ 0 │ ⚡ — │ $0 │ 🪙 $12.40 left
```

- **Line 1:** `local` or `cloud` (dot: yellow connecting, green connected, red offline),
  provider, model, reasoning effort in yellow (hidden if the model has none), and rate
  limits: per-minute limits until the first reply, then requests/tokens remaining.
- **Line 2:** conversation size against the model's context window, tokens in/out of the
  last reply, speed (time to first token, tokens per second), session cost, and for Venice
  the account balance left (🪙).

Costs come from the API (OpenRouter, Venice), Anthropic's list prices, or `prices` in the
config; they're estimates.

## Layout

```
src/
  core/      platform-neutral: API clients and types (fetch + the Anthropic SDK)
  config.ts  Node/macOS: config file and Keychain access
  tui/       Ink terminal interface; markdown/ holds the two renderers
  cli.tsx    entry point
```

`src/core` has no Node or Ink dependencies, so it can be reused by a desktop or mobile frontend.
