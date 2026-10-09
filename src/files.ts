// Reading attachments from disk and the clipboard (Node/macOS specific).
// Files are read into memory only; nothing is copied or cached on disk.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { extractText } from 'unpdf';
import type { Attachment } from './core/types.js';

const run = promisify(execFile);

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Images: Anthropic's per-image limit. Text: about 250k tokens.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

export class AttachmentError extends Error {}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p;
}

/** Shell-style escaping so a path stays one word: spaces become "\ ". */
export function escapePath(p: string): string {
  return p.replace(/([\\ ])/g, '\\$1');
}

function unescapePath(p: string): string {
  return p.replace(/\\(.)/g, '$1');
}

export function imageAttachment(name: string, data: Buffer, mediaType = 'image/png'): Attachment {
  if (data.length > MAX_IMAGE_BYTES) {
    throw new AttachmentError(`${name} is ${(data.length / 1024 / 1024).toFixed(1)} MB; images must be under 5 MB.`);
  }
  return { kind: 'image', name, size: data.length, mediaType, data: data.toString('base64') };
}

/** Reads a file into an attachment, deciding the kind from the extension and contents. */
export async function readAttachment(filePath: string): Promise<Attachment> {
  const resolved = path.resolve(expandHome(filePath));
  const name = path.basename(resolved);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new AttachmentError(`File not found: ${filePath}`);
  }
  if (!info.isFile()) throw new AttachmentError(`Not a file: ${filePath}`);

  const extension = path.extname(resolved).toLowerCase();
  const mediaType = IMAGE_TYPES[extension];
  if (mediaType) return imageAttachment(name, await readFile(resolved), mediaType);

  if (extension === '.pdf') {
    if (info.size > MAX_PDF_BYTES) throw new AttachmentError(`${name} is too large; PDFs must be under 30 MB.`);
    const data = await readFile(resolved);
    let text = '';
    try {
      ({ text } = await extractText(new Uint8Array(data), { mergePages: true }));
    } catch {
      // Keep going: the PDF can still be sent natively to Anthropic.
    }
    return { kind: 'pdf', name, size: data.length, data: data.toString('base64'), text };
  }

  if (info.size > MAX_TEXT_BYTES) throw new AttachmentError(`${name} is too large; text files must be under 1 MB.`);
  const data = await readFile(resolved);
  if (data.subarray(0, 8192).includes(0)) {
    throw new AttachmentError(`${name} looks like a binary file. Supported: text and code, images, PDFs.`);
  }
  return { kind: 'text', name, size: data.length, text: data.toString('utf8') };
}

// --- @mentions --------------------------------------------------------------------

const MENTION = /(^|[\s([{"'])@((?:\\.|[^\s\\])+)/g;

/**
 * Paths mentioned as @path in a message. A mention that doesn't look like a
 * path and doesn't exist (say "@roman") is left alone as ordinary text.
 */
export function findMentions(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    let candidate = unescapePath(match[2]!);
    // Punctuation right after a mention ("see @plan.md, then…") isn't part of the path,
    // unless a file by that exact name exists.
    const trimmed = candidate.replace(/[,;:!?)\]}"'.]+$/, '');
    if (trimmed && trimmed !== candidate && !existsSync(path.resolve(expandHome(candidate)))) candidate = trimmed;
    const looksLikePath = candidate.includes('/') || candidate.startsWith('~') || /\.[A-Za-z0-9]{1,6}$/.test(candidate);
    if (looksLikePath || existsSync(path.resolve(expandHome(candidate)))) paths.push(candidate);
  }
  return paths;
}

/**
 * Turns pasted text that is only file paths (what macOS terminals type when a
 * file is dragged onto them) into @mentions. Anything else is returned as is.
 */
export function pastedPathsToMentions(text: string): string {
  const trimmed = text.trim();
  if (!/^['"]?[/~]/.test(trimmed)) return text;

  // Paths are separated by unescaped spaces; some terminals quote them instead.
  const tokens = trimmed.match(/'[^']+'|"[^"]+"|(?:\\.|[^\s\\])+/g) ?? [];
  const paths = tokens.map((token) => (/^['"]/.test(token) ? token.slice(1, -1) : unescapePath(token)));
  const allFiles = paths.every((p) => {
    try {
      return statSync(expandHome(p)).isFile();
    } catch {
      return false;
    }
  });
  return allFiles && paths.length ? `${paths.map((p) => `@${escapePath(p)}`).join(' ')} ` : text;
}

/** The rest of a file or folder name after `@partial`, for Tab completion. */
export function completePath(partial: string): string | undefined {
  const typed = unescapePath(partial);
  const slash = typed.lastIndexOf('/');
  const dir = slash >= 0 ? typed.slice(0, slash + 1) : '';
  const prefix = typed.slice(slash + 1);

  let entries;
  try {
    entries = readdirSync(path.resolve(expandHome(dir || '.')), { withFileTypes: true });
  } catch {
    return undefined;
  }
  const matches = entries
    .filter((e) => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (matches.length === 0) return undefined;

  let common = matches[0]!.name;
  for (const { name } of matches) {
    while (!name.startsWith(common)) common = common.slice(0, -1);
  }
  if (matches.length === 1 && matches[0]!.isDirectory()) common += '/';
  const rest = common.slice(prefix.length);
  return rest ? escapePath(rest) : undefined;
}

// --- Clipboard --------------------------------------------------------------------

export type ClipboardContent = { kind: 'file'; path: string } | { kind: 'image'; data: Buffer };

/**
 * What's on the macOS clipboard: a file copied in Finder, or an image such as
 * a screenshot. Read straight into memory via AppleScript.
 */
export async function readClipboard(): Promise<ClipboardContent | undefined> {
  // A file copied in Finder also carries its icon as an image, so check files first.
  try {
    const { stdout } = await run('osascript', ['-e', 'POSIX path of (the clipboard as «class furl»)']);
    const file = stdout.trim();
    if (file) return { kind: 'file', path: file };
  } catch {
    // No file on the clipboard.
  }
  try {
    const { stdout } = await run('osascript', ['-e', 'the clipboard as «class PNGf»'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const hex = stdout.match(/«data PNGf([0-9A-Fa-f]+)»/)?.[1];
    if (hex) return { kind: 'image', data: Buffer.from(hex, 'hex') };
  } catch {
    // No image on the clipboard.
  }
  return undefined;
}
