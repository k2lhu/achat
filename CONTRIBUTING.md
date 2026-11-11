# Contributing to achat

Thanks for helping. Bug reports, provider reports and pull requests are all welcome.

## Building from source

Needs Node.js 22 or newer.

```bash
git clone https://github.com/k2lhu/achat.git
cd achat
npm install
npm run dev          # run from source without building
npm run typecheck    # what CI checks first
npm run build        # compile to dist/
npm link             # optional: make this checkout the global `achat` command
```

If you have the npm package installed, uninstall it first (`npm uninstall -g @k2lhu/achat`),
or `npm link` fails with `EEXIST`.

To check the key storage on your machine, which CI also runs on macOS and Linux:

```bash
npx tsx scripts/keystore-check.ts
```

It stores, reads and deletes a throwaway key under the account `ci-roundtrip-<pid>`.

## Layout

```
src/
  core/        platform-neutral: API clients and types (fetch + the Anthropic SDK)
  config.ts    config file: reading, editing, resolving api_key references
  keystore.ts  OS keyring: macOS Keychain (`security`) and Linux Secret Service (`secret-tool`)
  files.ts     attachments and the macOS clipboard
  tui/         Ink terminal interface; markdown/ holds the two renderers
  cli.tsx      entry point and command-line flags
```

`src/core` has no Node or Ink dependencies.

## Privacy rules

These are what achat promises users, so pull requests must keep them:

- No telemetry, analytics, crash reporting or update checks.
- No network requests except to the `base_url`s in the user's config.
- Nothing written to disk except the config file. No logs, no history.
- Keys are never printed, logged or passed as command-line arguments.

## Adding a provider

**An OpenAI-compatible service** (most are) needs no new code. Either add a preset to
`COMPATIBLE_PRESETS` in `src/tui/AddProvider.tsx`, or document a config snippet. Pull
requests for these are welcome any time.

**A new API type** touches several places, and this part of the code will be restructured in
0.2. Please open an issue first so we can agree on the approach. Today the places are:

1. `API_KINDS` in `src/core/types.ts`. The config check is built from this list.
2. A new module in `src/core/` for the API, like `venice.ts` or `featherless.ts`.
3. The dispatch in `src/core/client.ts`: `chat`, `listModels`, `getModelInfo` and
   `getAccount`.
4. `src/tui/App.tsx`, where account details and the effort parameter depend on the type.
5. A preset in `MAIN_PRESETS` in `src/tui/AddProvider.tsx`.
6. `config.example.toml` and the provider table in `README.md`.

## Pull requests

- Keep each pull request to one change, and describe what you tested and on which platform.
- `npm run typecheck` must pass.
- Match the style of the surrounding code: two-space indent, single quotes, comments that say
  why rather than what.
- Add a line under `[Unreleased]` in `CHANGELOG.md` for anything a user would notice.
- By contributing, you agree that your contribution is licensed under the Apache License 2.0,
  like the rest of the project (section 5 of the license).

## Releasing (maintainer)

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new version heading.
2. `npm version <patch|minor>` (updates package.json, commits and tags).
3. `git push --follow-tags`, wait for CI to pass.
4. `npm publish` (the `prepack` script cleans and rebuilds `dist/`).
5. Create a GitHub release from the tag with the changelog text.
