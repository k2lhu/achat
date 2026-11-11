# Changelog

All notable changes to achat are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

While achat is at 0.x, a breaking change bumps the minor version (0.1 → 0.2) and comes with
migration notes. These count as the public interface: the config file format, the `api_key`
forms, the command-line flags, the `ACHAT_CONFIG` and `ACHAT_NO_KEYRING` variables, and the
slash-command names. The JavaScript modules are internal.

## [Unreleased]

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
