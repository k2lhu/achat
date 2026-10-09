#!/usr/bin/env node
import { render } from 'ink';
import { parseArgs } from 'node:util';
import { CONFIG_PATH, ConfigError, loadConfig } from './config.js';
import App from './tui/App.js';

const USAGE = `Usage: achat [options]

Options:
  -p, --provider <name>  provider from the config (default: "default" in config)
  -m, --model <name>     model to use (default: the provider's model)
  -h, --help             show this help

Config: ${CONFIG_PATH}`;

async function main() {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const config = await loadConfig();
  const providerName = values.provider ?? config.defaultProvider;
  if (values.provider && !config.providers.some((p) => p.name === providerName)) {
    throw new ConfigError(
      `No provider named "${providerName}". Available: ${config.providers.map((p) => p.name).join(', ')}`,
    );
  }

  const app = render(
    <App config={config} providerName={providerName} modelOverride={values.model} />,
  );
  await app.waitUntilExit();
}

main().catch((error) => {
  console.error(error instanceof ConfigError || error instanceof TypeError ? error.message : error);
  process.exit(1);
});
