# Changelog

All notable changes to achat are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

While achat is at 0.x, a breaking change bumps the minor version (0.1 → 0.2) and comes with
migration notes. These count as the public interface: the config file format, the `api_key`
forms, the command-line flags, the `ACHAT_CONFIG` and `ACHAT_NO_KEYRING` variables, and the
slash-command names. The JavaScript modules are internal.

## [Unreleased]

### Added

- `/export [path]` saves the conversation as a Markdown file, in the current folder by
  default (`achat-YYYY-MM-DD-HHMM.md`). Replies are saved as the model's Markdown, each with
  the model that wrote it; attachments are listed by name. Existing files are never
  overwritten, and the file is readable only by you. Nothing is written unless you ask.
- `/copy` copies the last reply as Markdown, `/copy all` the whole conversation. Uses
  `pbcopy` on macOS and `wl-copy`, `xclip` or `xsel` on Linux. Over SSH, or without those
  tools, it asks the terminal to copy with OSC 52.

### Fixed

- A long prompt no longer leaves copies of its first line on screen while typing and after
  sending. The input now wraps its own rows, so a space at the wrap point (or the cursor) can't
  spill past the edge of the terminal.
- The welcome box no longer shows a provider and model that go stale after `/provider` or
  `/model`. The status bar shows the current ones.

## [0.1.0] - 2026-11-11

First public release.

### Added

- Terminal chat for Anthropic, Venice, Featherless and OpenAI-compatible APIs, with
  streaming replies, markdown rendering and a status bar with context, speed, cost and
  rate limits.
- Setup wizard for adding providers; `/provider`, `/model`, `/effort`, `/system`,
  `/renderer`, `/clear` commands.
- File attachments with `@path`, drag and drop, and Ctrl+V paste (macOS).
- API keys in the macOS Keychain, the Linux Secret Service keyring (`secret-tool`), or
  environment variables. Without a working keyring, the setup saves an `env:` reference.
- `--version` prints the version, Node version, platform and key storage.
- Published on npm as `@k2lhu/achat`.

### Changed

- Requests to Anthropic no longer include the SDK's OS, CPU and runtime headers.

[Unreleased]: https://github.com/k2lhu/achat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/k2lhu/achat/releases/tag/v0.1.0
