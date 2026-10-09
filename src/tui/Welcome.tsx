import { Box, Text } from 'ink';

// Synthwave palette: sunset sun over a neon grid.
const NEON_PINK = '#FF2A6D';
const MAGENTA = '#D300C5';
const VIOLET = '#7B2CBF';
const CYAN = '#05D9E8';

// A striped retro sun sinking into the horizon, then a perspective grid.
const SUN: [string, string][] = [
  ['    ▄▄████▄▄    ', '#FFD319'],
  ['  ▄██████████▄  ', '#FFB224'],
  [' ██████████████ ', '#FF8C42'],
  [' ▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ', '#FF5E5B'],
  ['  ▀▀▀▀▀▀▀▀▀▀▀▀  ', NEON_PINK],
  ['    ▀▀▀▀▀▀▀▀    ', MAGENTA],
  ['━━━━━━━━━━━━━━━━', CYAN],
  ['╱  ╱ ╱ ┃ ╲ ╲  ╲ ', VIOLET],
];

const TITLE = ['▄▀█ █▀▀ █ █ ▄▀█ ▀█▀', '█▀█ █▄▄ █▀█ █▀█  █ '];

/** Hex colour between two others, `t` from 0 to 1. */
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const value = [0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t));
  return `#${value.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Text with a left-to-right neon gradient: pink → magenta → cyan. */
function Gradient({ text, bold }: { text: string; bold?: boolean }) {
  const chars = [...text];
  return (
    <Text bold={bold}>
      {chars.map((char, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0;
        const color = t < 0.5 ? mix(NEON_PINK, MAGENTA, t * 2) : mix(MAGENTA, CYAN, (t - 0.5) * 2);
        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

interface Props {
  version: string;
  provider?: string;
  model?: string;
  width: number;
}

/** Welcome box shown at start and after /clear. */
export function Welcome({ version, provider, model, width }: Props) {
  const showSun = width >= 64;

  const details = (
    <Box flexDirection="column" justifyContent="center">
      {TITLE.map((line) => (
        <Gradient key={line} text={line} bold />
      ))}
      <Text color={CYAN}>v{version} · private terminal chat</Text>
      <Text> </Text>
      {provider ? (
        <Text>
          <Text color={NEON_PINK}>{provider}</Text>
          <Text dimColor> · </Text>
          <Text color={CYAN}>{model}</Text>
        </Text>
      ) : (
        <Text color={NEON_PINK}>Let’s add your first provider.</Text>
      )}
      <Text dimColor>nothing is saved · gone when you quit</Text>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={NEON_PINK}
      paddingX={1}
      width={Math.min(width, 72)}
    >
      <Box gap={3}>
        {showSun && (
          <Box flexDirection="column">
            {SUN.map(([line, color]) => (
              <Text key={line} color={color}>
                {line}
              </Text>
            ))}
          </Box>
        )}
        {details}
      </Box>
      <Text> </Text>
      <Text dimColor>
        <Text color={VIOLET}>/help</Text> commands · <Text color={VIOLET}>Tab</Text> completes ·{' '}
        <Text color={VIOLET}>↑↓</Text> history · <Text color={VIOLET}>Esc</Text> stops a reply
      </Text>
    </Box>
  );
}
