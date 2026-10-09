/** Clears the visible screen and the scrollback, and moves the cursor to the top left. */
export const CLEAR_TERMINAL = '\x1b[2J\x1b[3J\x1b[H';

export function clearTerminal(): void {
  if (process.stdout.isTTY) process.stdout.write(CLEAR_TERMINAL);
}
