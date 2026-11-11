# achat

A minimal, private chat for your terminal. Works with Anthropic, Venice, Featherless and any
OpenAI-compatible API: OpenAI, OpenRouter, Groq, Ollama, LM Studio, Jan's local server and
others.

- No telemetry, no logs, no chat history on disk. Conversations live in memory and are gone
  when you quit.
- API keys go in your OS keyring or an environment variable, not in the config file.

```bash
npm install -g @k2lhu/achat
achat
```

Needs [Node.js](https://nodejs.org) 22 or newer, on macOS or Linux. Windows is not supported.

> **Note:** the package is **`@k2lhu/achat`**. The unscoped `achat` package on npm belongs to
> someone else; `npm install -g achat` installs a different program.

## First run

Have an API key ready (local servers such as Ollama don't need one), then run `achat`. It
walks you through adding a provider:

1. Pick the service, or "Other" for any OpenAI-compatible URL.
2. Paste your API key. achat checks the connection and lists the available models.
3. Choose a default model. You're chatting.

Esc cancels at any step. Add or remove providers later with `/provider`.

## Usage

```bash
achat                      # default provider
achat -p ollama -m qwen3   # pick provider and model
achat --version            # version, Node, platform and key storage, for bug reports
```

Inside the chat, type `/help` for commands: `/provider`, `/model`, `/effort`, `/system`,
`/renderer`, `/clear`, `/quit`. Press Esc to stop a reply mid-stream.

**Editing:** Option/Alt+←/→ jump by word; Home/End or Ctrl+A/E jump to the start/end of the
line (press again for the whole message). For a new line use Shift+Enter (in terminals that
report it, e.g. kitty, Ghostty, WezTerm, iTerm2), Option/Alt+Enter, or `\` then Enter.
Up/Down move between lines and recall earlier prompts. Pasted text keeps its line breaks.

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
- **Drag a file** onto the terminal window; its path becomes an `@` mention.
- **Ctrl+V** (macOS only) pastes a copied image, such as a screenshot, as `[image #1]`, or a
  file copied in Finder as an `@` mention.

Text and code files are included in the message as text. Images go to vision models (achat
checks first, where the provider reports it). PDFs are sent natively to Anthropic and as
extracted text to other providers. Files are read into memory only and sent with the
conversation, so they're re-sent with every following message and count towards the context.

### Rendering

Replies are rendered as markdown. `/renderer` switches between `new` (achat's own layout)
and `classic` (the original marked-terminal look); set `renderer = "classic"` at the top of
the config to make it the default.

### Status bar

Two lines below the input, filled in as soon as achat connects (each wraps in narrow windows):

```
● cloud │ venice-ai │ zai-org-glm-4.7-flash │ high │ 150 req/min · 10M tok/min
ctx 0/128k ▱▱▱▱▱▱▱▱ 0% │ ↑ 0 ↓ 0 │ ⚡ — │ $0 │ 🪙 $12.40 left
```

- **Line 1:** `local` or `cloud` (dot: yellow connecting, green connected, red offline),
  provider, model, reasoning effort in yellow (hidden if the model has none), and rate
  limits: per-minute limits until the first reply, then requests/tokens remaining. For
  Featherless this slot shows your plan and the concurrency units the model uses, e.g.
  `Feather Premium · 2/4 units`.
- **Line 2:** conversation size against the model's context window (capped by your plan on
  Featherless), tokens in/out of the last reply, speed (time to first token, tokens per
  second), session cost (`flat plan` on Featherless), and for Venice the account balance
  left (🪙).

Costs come from the API (OpenRouter, Venice), Anthropic's list prices (as of October 2026),
or `prices` in the config. They're estimates.

## Configuration

The setup writes `~/.config/achat/config.toml` (or the path in `ACHAT_CONFIG`). The file is
readable only by you (permissions 0600). Each provider is a named `[providers.NAME]` entry;
[config.example.toml](https://github.com/k2lhu/achat/blob/main/config.example.toml) shows
every option.

`api_key` takes one of four forms:

| Form | Where the key is | Example |
| --- | --- | --- |
| `"keychain:NAME"` | Your OS keyring: the macOS Keychain, or on Linux the Secret Service keyring through `secret-tool`. What the setup uses when a keyring is available. | `api_key = "keychain:openai"` |
| `"env:VAR"` | An environment variable. What the setup uses when there is no keyring (for example over SSH or in a container). | `api_key = "env:ACHAT_OPENAI_API_KEY"` |
| omitted | No key, for local servers. | |
| anything else | The key itself, in plain text in the config. Works, but not recommended. | |

To add a keyring entry by hand (you're prompted for the key, so it stays out of your shell
history):

```bash
# macOS
security add-generic-password -s achat -a NAME -w
# Linux
secret-tool store --label="achat: NAME" service achat account NAME
```

On Linux, achat uses the keyring only when `secret-tool` is installed (package `libsecret-tools`
on Debian and Ubuntu, `libsecret` on Fedora and Arch) and a desktop session is running. Set
`ACHAT_NO_KEYRING=1` to never use the keyring.

## What "private" means

- achat sends no telemetry, checks for no updates, and contacts only the `base_url`s in your
  config.
- The only file it writes is the config. Conversations, prompt history, pasted images and
  keys read from the keyring stay in memory.
- **Your provider sees everything you send.** The whole conversation, attachments included,
  goes to the provider with every message, and the provider keeps it according to its own
  policy. For full privacy, use a local server such as Ollama or LM Studio.
- Requests identify themselves only as `User-Agent: achat`. The OS, CPU and runtime details
  the Anthropic SDK normally adds are removed.

## Platforms and providers

| Platform | Status |
| --- | --- |
| macOS | Used daily by the author. |
| Linux | Builds, installs and starts in CI on Ubuntu, and the `secret-tool` keyring is tested there. Not tested by hand. Ctrl+V paste is macOS only. |
| Windows | Not supported. |

| Provider | Status |
| --- | --- |
| Anthropic, Venice, Featherless | Tested by the author. |
| OpenAI, OpenRouter, Ollama, LM Studio, Jan | Have setup presets; OpenAI-compatible, should work. |
| Groq and other OpenAI-compatible APIs | Should work through "Other" with their base URL. Untested. |

If a provider works or breaks for you, please
[open an issue](https://github.com/k2lhu/achat/issues/new/choose) with the output of
`achat --version`.

## Uninstall

```bash
npm uninstall -g @k2lhu/achat
rm -r ~/.config/achat
```

Then delete saved keys, one per provider:

```bash
# macOS
security delete-generic-password -s achat -a NAME
# Linux
secret-tool clear service achat account NAME
```

## Troubleshooting

- **`EEXIST` on install:** another `achat` command is already installed, for example the
  unscoped npm package or an `npm link` from a source checkout. Remove it with
  `npm uninstall -g achat` (or `npm unlink -g achat`) and install again.
- **`EACCES` on Linux:** your distribution's Node puts global packages in a system folder. Use
  a Node version manager such as [fnm](https://github.com/Schniz/fnm) or
  [nvm](https://github.com/nvm-sh/nvm) instead of `sudo`.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to
build from source and how to add a provider, and [SECURITY.md](SECURITY.md) for reporting
security problems privately.

## Name and license

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 k2lhu.

The only official sources are the GitHub repository
[k2lhu/achat](https://github.com/k2lhu/achat) and the npm package
[@k2lhu/achat](https://www.npmjs.com/package/@k2lhu/achat). Forks are welcome, but please
give them another name, and keep the [NOTICE](NOTICE) file, which the license requires.
