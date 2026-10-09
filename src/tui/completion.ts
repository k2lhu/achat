// Inline completion for slash commands and their arguments.

/** Commands offered for completion, in priority order (aliases like /exit are left out). */
const COMMANDS = ['help', 'provider', 'model', 'system', 'effort', 'renderer', 'clear', 'quit'];

export interface CompletionSources {
  providers: string[];
  renderers: readonly string[];
  effortLevels: string[];
  /** Model IDs, when the list has been fetched this session. */
  models: string[];
  /** Rest of a file or folder name for an @path mention. */
  completePath: (partial: string) => string | undefined;
}

function argumentsFor(command: string, sources: CompletionSources): string[] {
  switch (command) {
    case 'provider':
      return ['add', 'remove', ...sources.providers];
    case 'model':
      return sources.models;
    case 'effort':
      return [...sources.effortLevels, 'default'];
    case 'renderer':
      return [...sources.renderers];
    case 'system':
      return ['off'];
    default:
      return [];
  }
}

/** The first option that extends `typed`, minus what's already typed. */
function extend(typed: string, options: string[]): string | undefined {
  const match = options.find((option) => option.startsWith(typed) && option !== typed);
  return match?.slice(typed.length);
}

/**
 * Returns the text to suggest after `input`, e.g. "uit" for "/q", or
 * undefined when there's nothing to suggest.
 */
export function completionFor(input: string, sources: CompletionSources): string | undefined {
  // An @path being typed as the last word (spaces inside paths are escaped as "\ ").
  const lastWord = input.match(/(?:^|\s)@((?:\\.|[^\s\\])*)$/);
  if (lastWord) return sources.completePath(lastWord[1]!);

  if (!input.startsWith('/')) return undefined;

  const words = input.slice(1).split(' ');
  if (words.length === 1) return words[0] ? extend(words[0], COMMANDS) : undefined;

  const [command = '', ...args] = words;
  if (command === 'provider' && args[0] === 'remove' && args.length === 2) {
    return extend(args[1]!, sources.providers);
  }
  if (args.length !== 1) return undefined;
  return extend(args[0]!, argumentsFor(command, sources));
}
