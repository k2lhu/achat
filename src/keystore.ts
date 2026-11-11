// Stores API keys in the operating system's credential store:
// - macOS: the login Keychain, through the `security` command.
// - Linux: the Secret Service keyring (GNOME Keyring, KWallet…), through
//   `secret-tool` from libsecret. Needs a running D-Bus session.
// Keys are passed on stdin so they never appear in the process list.

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';

/** Service name for `keychain:<account>` keys, on every platform. */
export const KEY_SERVICE = 'achat';

/** A keyring call that takes longer than this is treated as failed, e.g. a locked
 *  keyring waiting on an unlock prompt nobody can see over SSH. */
const TIMEOUT_MS = 5000;

export class KeyStoreError extends Error {}

export interface KeyStore {
  /** Shown to the user, e.g. "macOS Keychain". */
  label: string;
  /** Undefined when there is no key for this account. */
  get(account: string): Promise<string | undefined>;
  set(account: string, key: string): Promise<void>;
  delete(account: string): Promise<void>;
}

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function exec(command: string, args: string[], stdin?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => reject(new KeyStoreError(`Could not run ${command}: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM') {
        reject(new KeyStoreError(`${command} did not answer within ${TIMEOUT_MS / 1000} s (is the keyring locked?)`));
      } else {
        resolve({ code, stdout, stderr: stderr.trim() });
      }
    });
    child.stdin.end(stdin ?? '');
  });
}

async function onPath(command: string): Promise<boolean> {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      await access(path.join(dir, command), constants.X_OK);
      return true;
    } catch {
      // Not in this directory.
    }
  }
  return false;
}

function checkKey(key: string): void {
  if (/\s/.test(key)) throw new KeyStoreError('API key must not contain spaces or line breaks');
}

const macKeychain: KeyStore = {
  label: 'macOS Keychain',

  async get(account) {
    const result = await exec('security', ['find-generic-password', '-s', KEY_SERVICE, '-a', account, '-w']);
    return result.code === 0 ? result.stdout.trim() || undefined : undefined;
  },

  async set(account, key) {
    checkKey(key);
    const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;
    // `security -i` reads commands from stdin, so the key is not a process argument.
    const command = `add-generic-password -U -s ${quote(KEY_SERVICE)} -a ${quote(account)} -w ${quote(key)}\n`;
    const result = await exec('security', ['-i'], command);
    if (result.code !== 0 || result.stderr) {
      throw new KeyStoreError(`Could not save the key to the macOS Keychain: ${result.stderr || `exit ${result.code}`}`);
    }
  },

  async delete(account) {
    const result = await exec('security', ['delete-generic-password', '-s', KEY_SERVICE, '-a', account]);
    // 44 = no such item, which is fine.
    if (result.code !== 0 && result.code !== 44) {
      throw new KeyStoreError(`Could not delete the key from the macOS Keychain: ${result.stderr || `exit ${result.code}`}`);
    }
  },
};

const attributes = (account: string) => ['service', KEY_SERVICE, 'account', account];

const secretService: KeyStore = {
  label: 'system keyring (secret-tool)',

  async get(account) {
    const result = await exec('secret-tool', ['lookup', ...attributes(account)]);
    if (result.code === 0) return result.stdout.replace(/\n$/, '') || undefined;
    // Exit 1 with no message means "not found"; anything else is a real failure.
    if (result.stderr) throw new KeyStoreError(`secret-tool lookup failed: ${result.stderr}`);
    return undefined;
  },

  async set(account, key) {
    checkKey(key);
    // secret-tool reads the secret from stdin; no trailing newline, or it becomes part of the key.
    const result = await exec('secret-tool', ['store', `--label=achat: ${account}`, ...attributes(account)], key);
    if (result.code !== 0) {
      throw new KeyStoreError(`Could not save the key with secret-tool: ${result.stderr || `exit ${result.code}`}`);
    }
  },

  async delete(account) {
    const result = await exec('secret-tool', ['clear', ...attributes(account)]);
    if (result.code !== 0 && result.stderr) {
      throw new KeyStoreError(`Could not delete the key with secret-tool: ${result.stderr}`);
    }
  },
};

let detected: Promise<KeyStore | undefined> | undefined;

/**
 * The credential store on this machine, or undefined when there is none we can
 * use. On Linux that needs `secret-tool` and a D-Bus session; over SSH or in a
 * container there is usually neither, and keys go in environment variables.
 */
export function keyStore(): Promise<KeyStore | undefined> {
  detected ??= (async () => {
    if (process.env.ACHAT_NO_KEYRING) return undefined;
    if (process.platform === 'darwin') return macKeychain;
    if (process.platform === 'linux' && process.env.DBUS_SESSION_BUS_ADDRESS && (await onPath('secret-tool'))) {
      return secretService;
    }
    return undefined;
  })();
  return detected;
}

/** Environment variable suggested for a provider's key when there is no keyring. */
export function keyEnvVar(provider: string): string {
  return `ACHAT_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}
