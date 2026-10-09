// Reads and writes ~/.config/achat/config.toml and stores API keys in the
// macOS Keychain (Node/macOS specific).

import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse, stringify } from 'smol-toml';
import type { ApiKind, Price } from './core/types.js';
import { isRenderer, type Renderer, RENDERERS } from './tui/markdown/index.js';

const run = promisify(execFile);

export const CONFIG_PATH =
  process.env.ACHAT_CONFIG ?? path.join(homedir(), '.config', 'achat', 'config.toml');

/** Keychain service name used for `keychain:<name>` keys. */
export const KEYCHAIN_SERVICE = 'achat';

export const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class ConfigError extends Error {}

export interface Provider {
  name: string;
  kind: ApiKind;
  baseUrl: string;
  /** `env:VAR`, `keychain:NAME`, a literal key, or undefined for no auth. */
  apiKeyRef?: string;
  model: string;
  systemPrompt?: string;
  /** USD per million tokens by model ID, for APIs that don't report prices. */
  prices?: Record<string, Price>;
}

export interface Config {
  /** Undefined only when there are no providers yet. */
  defaultProvider?: string;
  providers: Provider[];
  /** Markdown renderer to start with. */
  renderer: Renderer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ConfigError(`"${field}" must be a string`);
  return value;
}

function toProvider(name: string, raw: unknown): Provider {
  if (!isRecord(raw)) throw new ConfigError(`[providers.${name}] must be a table`);
  const baseUrl = optionalString(raw.base_url, `providers.${name}.base_url`);
  const model = optionalString(raw.model, `providers.${name}.model`);
  const kind = optionalString(raw.type, `providers.${name}.type`) ?? 'openai';
  if (!baseUrl) throw new ConfigError(`[providers.${name}] is missing base_url`);
  if (!model) throw new ConfigError(`[providers.${name}] is missing model`);
  if (kind !== 'openai' && kind !== 'anthropic' && kind !== 'venice' && kind !== 'featherless') {
    throw new ConfigError(`[providers.${name}] type must be "openai", "anthropic", "venice" or "featherless"`);
  }
  return {
    name,
    kind,
    baseUrl,
    model,
    apiKeyRef: optionalString(raw.api_key, `providers.${name}.api_key`),
    systemPrompt: optionalString(raw.system_prompt, `providers.${name}.system_prompt`),
    prices: toPrices(raw.prices, `providers.${name}.prices`),
  };
}

/** Parses `prices = { "model-id" = [input, output] }` (USD per million tokens). */
function toPrices(raw: unknown, field: string): Record<string, Price> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new ConfigError(`"${field}" must be a table`);
  const prices: Record<string, Price> = {};
  for (const [model, value] of Object.entries(raw)) {
    const [input, output] = Array.isArray(value) ? value : [];
    if (typeof input !== 'number' || typeof output !== 'number' || (value as unknown[]).length !== 2) {
      throw new ConfigError(`"${field}.${model}" must be [input, output] in USD per million tokens`);
    }
    prices[model] = { input, output };
  }
  return prices;
}

async function readConfigText(): Promise<string | undefined> {
  try {
    return await readFile(CONFIG_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeConfigText(text: string): Promise<void> {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, text, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

/** Loads the config. A missing file means "no providers yet", not an error. */
export async function loadConfig(): Promise<Config> {
  const text = await readConfigText();
  if (text === undefined) return { providers: [], renderer: 'new' };

  let raw: Record<string, unknown>;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ConfigError(`Could not parse ${CONFIG_PATH}: ${(error as Error).message}`);
  }

  const rawProviders = raw.providers ?? {};
  if (!isRecord(rawProviders)) throw new ConfigError('"providers" must be a table');
  const providers = Object.entries(rawProviders).map(([name, p]) => toProvider(name, p));

  let defaultProvider = optionalString(raw.default, 'default');
  if (defaultProvider && !providers.some((p) => p.name === defaultProvider)) {
    throw new ConfigError(`default = "${defaultProvider}" does not match any provider`);
  }
  defaultProvider ??= providers[0]?.name;

  const renderer = optionalString(raw.renderer, 'renderer') ?? 'new';
  if (!isRenderer(renderer)) {
    throw new ConfigError(`renderer must be one of: ${RENDERERS.map((r) => `"${r}"`).join(', ')}`);
  }
  return { defaultProvider, providers, renderer };
}

// --- Editing the config file ------------------------------------------------
// Edits are done on the text so comments and formatting the user added survive.

const DEFAULT_LINE = /^default\s*=.*$/m;

function setDefaultLine(text: string, name: string | undefined): string {
  // Provider names are restricted to PROVIDER_NAME_PATTERN, so JSON quoting is valid TOML.
  const line = name === undefined ? '' : `default = ${JSON.stringify(name)}`;
  if (DEFAULT_LINE.test(text)) {
    return line ? text.replace(DEFAULT_LINE, line) : text.replace(/^default\s*=.*\n?/m, '');
  }
  return line ? `${line}\n\n${text}` : text;
}

/** Appends a provider section, optionally making it the default. */
export async function saveProvider(provider: Provider, makeDefault: boolean): Promise<void> {
  const table: Record<string, string> = {
    type: provider.kind,
    base_url: provider.baseUrl,
    model: provider.model,
  };
  if (provider.apiKeyRef) table.api_key = provider.apiKeyRef;
  if (provider.systemPrompt) table.system_prompt = provider.systemPrompt;

  let text = (await readConfigText()) ?? '# achat config. See config.example.toml for all options.\n';
  if (!text.endsWith('\n')) text += '\n';
  text += '\n' + stringify({ providers: { [provider.name]: table } }) + '\n';
  if (makeDefault) text = setDefaultLine(text, provider.name);
  await writeConfigText(text);
}

/** Removes a provider section; reassigns the default if it pointed there. */
export async function removeProvider(name: string, newDefault: string | undefined): Promise<void> {
  const text = await readConfigText();
  if (text === undefined) return;

  const lines = text.split('\n');
  const isHeader = (line: string) => /^\s*\[/.test(line);
  const isOurHeader = (line: string) => {
    const match = line.match(/^\s*\[\s*providers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]/);
    return match !== null && (match[1] ?? match[2] ?? match[3]) === name;
  };

  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (isHeader(line)) skipping = isOurHeader(line);
    if (!skipping) kept.push(line);
  }

  let result = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  const parsed = parse(result);
  if (parsed.default === name || parsed.default === undefined) {
    result = setDefaultLine(result, newDefault);
  }
  await writeConfigText(result.replace(/^\n+/, ''));
}

// --- API keys -----------------------------------------------------------------

/** Turns an api_key reference into the actual key. Never logs or stores it. */
export async function resolveApiKey(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;

  if (ref.startsWith('env:')) {
    const name = ref.slice(4);
    const value = process.env[name];
    if (!value) throw new ConfigError(`Environment variable ${name} is not set`);
    return value;
  }

  if (ref.startsWith('keychain:')) {
    const account = ref.slice(9);
    try {
      const { stdout } = await run('security', [
        'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w',
      ]);
      return stdout.trim();
    } catch {
      throw new ConfigError(
        `No Keychain item for service "${KEYCHAIN_SERVICE}", account "${account}". ` +
          'Re-add the provider with /provider, or run:\n' +
          `  security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${account} -w`,
      );
    }
  }

  return ref;
}

/**
 * Saves a key to the login Keychain, replacing any existing one. The key is
 * passed on stdin (`security -i`) so it never appears in the process list.
 */
export async function storeApiKey(account: string, key: string): Promise<void> {
  if (/\s/.test(key)) throw new ConfigError('API key must not contain spaces or line breaks');
  const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;
  const command =
    `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -w ${quote(key)}\n`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 && !stderr.trim()
        ? resolve()
        : reject(new ConfigError(`Could not save the key to Keychain: ${stderr.trim() || code}`)),
    );
    child.stdin.end(command);
  });
}

export async function deleteApiKey(account: string): Promise<void> {
  try {
    await run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]);
  } catch {
    // Already gone.
  }
}
