// Saving a conversation as Markdown with /export. The only time a conversation
// is written to disk, and only to the file the user asked for.

import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './files.js';

/** One exchange as shown on screen, with who answered it. */
export interface ExportTurn {
  user: string;
  /** The attachments line shown under the prompt, e.g. "📎 plan.md · 2 KB". */
  files?: string;
  reply: string;
  stopped: boolean;
  provider: string;
  model: string;
}

/** Settings at the time of export, for the header. */
export interface ExportMeta {
  date: Date;
  provider: string;
  model: string;
  effort?: string;
  systemPrompt?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateParts(d: Date) {
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function formatMarkdown(turns: ExportTurn[], meta: ExportMeta): string {
  const { day, time } = dateParts(meta.date);
  const out = [
    '# achat conversation',
    '',
    `- Date: ${day} ${time}`,
    `- Provider: ${meta.provider} · Model: ${meta.model}`,
  ];
  if (meta.effort) out.push(`- Effort: ${meta.effort}`);
  out.push('');
  if (meta.systemPrompt) {
    const quoted = meta.systemPrompt.split('\n').join('\n> ');
    out.push(`> **System prompt:** ${quoted}`, '');
  }
  out.push('---', '');

  for (const turn of turns) {
    out.push('## You', '', turn.user, '');
    if (turn.files) out.push(`*${turn.files}*`, '');
    const who = turn.provider === meta.provider ? turn.model : `${turn.provider} · ${turn.model}`;
    out.push(`## Assistant · ${who}`, '', turn.reply.trimEnd(), '');
    if (turn.stopped) out.push('*[stopped]*', '');
  }
  return out.join('\n');
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Writes `text` and returns the path used. With no `arg`, or a directory, the
 * file is named achat-YYYY-MM-DD-HHMM.md, adding -2, -3… if taken. A file name
 * the user typed is never overwritten.
 */
export async function writeExport(text: string, arg: string | undefined, now: Date): Promise<string> {
  const target = arg ? path.resolve(expandHome(arg)) : process.cwd();
  // Write only what the user can read, like the config.
  const options = { mode: 0o600, flag: 'wx' } as const;

  if (arg && !arg.endsWith('/') && !(await isDirectory(target))) {
    const file = path.extname(target) ? target : `${target}.md`;
    try {
      await writeFile(file, text, options);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`${tildePath(file)} already exists. Pick another name.`);
      }
      throw friendly(error, path.dirname(file));
    }
    return file;
  }

  const { day, time } = dateParts(now);
  const base = path.join(target, `achat-${day}-${time.replace(':', '')}`);
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${base}.md` : `${base}-${n}.md`;
    try {
      await writeFile(file, text, options);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw friendly(error, target);
    }
  }
}

function friendly(error: unknown, folder: string): unknown {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? new Error(`There's no folder ${tildePath(folder)}.`)
    : error;
}

/** The path with the home directory shortened to ~, for messages. */
export function tildePath(p: string): string {
  const home = expandHome('~');
  return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}
