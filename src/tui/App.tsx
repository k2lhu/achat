import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState } from 'react';
import {
  CONFIG_PATH,
  type Config,
  deleteApiKey,
  type Provider,
  removeProvider,
  resolveApiKey,
} from '../config.js';
import { getModelInfo, listModels, STANDARD_EFFORT_LEVELS, streamChat } from '../core/client.js';
import { costOf } from '../core/pricing.js';
import type { ChatMessage, EffortParam, Endpoint, ModelInfo, RateLimit, Usage } from '../core/types.js';
import AddProvider, { type AddedProvider } from './AddProvider.js';
import { SelectList } from './components.js';
import { isRenderer, RENDERER_DESCRIPTIONS, type Renderer, RENDERERS, renderMarkdown } from './markdown/index.js';
import { pickVerb, Spinner } from './Spinner.js';
import { type Connection, type Speed, StatusBar } from './StatusBar.js';

const PROMPT = '❯ ';

type EntryKind = 'user' | 'assistant' | 'info' | 'error';

interface Entry {
  id: number;
  kind: EntryKind;
  text: string;
  /** Renderer used for assistant replies, fixed when the entry is added. */
  renderer: Renderer;
}

type Mode =
  | { type: 'chat' }
  | { type: 'add' }
  | { type: 'providers' }
  | { type: 'remove' }
  | { type: 'confirmRemove'; name: string }
  | { type: 'models'; ids: string[] }
  | { type: 'renderer' }
  | { type: 'effort' };

const HELP = `Commands:
  /provider          pick, add or remove a provider
  /provider <name>   switch to a provider
  /provider add      add a provider (step-by-step setup)
  /provider remove   remove a provider and its saved key
  /model             pick a model from the current provider
  /model <name>      switch to a model by name
  /system [text|off] show, set or remove the system prompt
  /effort [level]    set reasoning effort (default to use the model's own)
  /renderer [name]   switch markdown rendering: new or classic
  /clear             forget the conversation and start fresh
  /help              show this help
  /quit              exit (or Ctrl+C)
Model, effort, system prompt and renderer changes last for this session only.
Up/Down recall earlier prompts. Press Esc while a reply is streaming to stop it.
Nothing is saved: the conversation disappears when you quit.`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminalSize() {
  // Some terminals report 0 when the size is unknown; treat that like "not set".
  return { columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

interface Props {
  config: Config;
  providerName?: string;
  modelOverride?: string;
}

export default function App({ config, providerName, modelOverride }: Props) {
  const { exit } = useApp();
  const initialProvider = config.providers.find((p) => p.name === providerName);

  const [providers, setProviders] = useState(config.providers);
  const [defaultName, setDefaultName] = useState(config.defaultProvider);
  const [provider, setProvider] = useState<Provider | undefined>(initialProvider);
  const [model, setModel] = useState(modelOverride ?? initialProvider?.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initialProvider?.systemPrompt);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [entries, setEntries] = useState<Entry[]>(() => [
    { id: 0, kind: 'info', text: 'achat · type /help for commands · nothing is saved', renderer: config.renderer },
  ]);
  const [mode, setMode] = useState<Mode>(() =>
    config.providers.length ? { type: 'chat' } : { type: 'add' },
  );
  const [input, setInput] = useState('');
  // What the app is waiting on, shown by the spinner; null when idle.
  const [activity, setActivity] = useState<{ label: string; startedAt: number } | null>(null);
  const busy = activity !== null;
  const [streaming, setStreaming] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<Usage>();
  const [sessionCost, setSessionCost] = useState<number>();
  const [modelInfo, setModelInfo] = useState<ModelInfo>();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [rateLimit, setRateLimit] = useState<RateLimit>();
  const [speed, setSpeed] = useState<Speed>();
  const [effort, setEffort] = useState<string>();
  // Which provider/model the fields above describe. Until the lookup for a new
  // one finishes, the status bar shows "connecting" instead of stale values.
  const currentKey = provider ? `${provider.name}\n${model}` : '';
  const [loadedKey, setLoadedKey] = useState('');
  const loaded = loadedKey === currentKey;
  const [renderer, setRenderer] = useState<Renderer>(config.renderer);

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const keyCache = useRef(new Map<string, string | undefined>());

  // Sent prompts for Up/Down recall. In memory only, like the conversation.
  const promptHistory = useRef<string[]>([]);
  const historyIndex = useRef<number | null>(null); // null = editing the unsent draft
  const draft = useRef('');
  // Remounting the input puts its cursor at the end of a recalled prompt.
  const [inputKey, setInputKey] = useState(0);

  const add = (kind: EntryKind, text: string) =>
    setEntries((current) => [...current, { id: nextId.current++, kind, text, renderer }]);

  const backToChat = () => setMode({ type: 'chat' });

  async function endpointFor(p: Provider): Promise<Endpoint> {
    if (!keyCache.current.has(p.name)) {
      keyCache.current.set(p.name, await resolveApiKey(p.apiKeyRef));
    }
    return { kind: p.kind, baseUrl: p.baseUrl, apiKey: keyCache.current.get(p.name) };
  }

  function switchTo(next: Provider) {
    setProvider(next);
    setModel(next.model);
    setSystemPrompt(next.systemPrompt);
  }

  // Whenever the provider or model changes, check the connection and fetch
  // what the status bar shows before the first message: context window,
  // prices, effort support and rate limits.
  useEffect(() => {
    setModelInfo(undefined);
    setRateLimit(undefined);
    setSpeed(undefined);
    if (!provider || !model) return;
    setConnection('connecting');
    const controller = new AbortController();
    endpointFor(provider)
      .then((endpoint) => getModelInfo(endpoint, model, controller.signal))
      .then((info) => {
        if (controller.signal.aborted) return;
        setLoadedKey(currentKey);
        setModelInfo(info);
        setRateLimit(info.rateLimit);
        setConnection('connected');
        // Keep a chosen effort only if the new model accepts it.
        setEffort((current) => {
          if (!current || info.effort === undefined || info.effort?.levels.includes(current)) return current;
          add('info', `Effort reset to default: ${model} doesn’t support "${current}".`);
          return undefined;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadedKey(currentKey);
        setConnection('failed');
        add('error', `Couldn’t reach ${provider.name}: ${errorMessage(error)}`);
      });
    return () => controller.abort();
  }, [provider, model]);

  function effortParam(): EffortParam {
    return modelInfo?.effort?.param ?? (provider?.kind === 'anthropic' ? 'output_config' : 'reasoning_effort');
  }

  function recall(text: string) {
    setInput(text);
    setInputKey((k) => k + 1);
  }

  useInput((_input, key) => {
    if (key.escape) abortRef.current?.abort();
    if (mode.type !== 'chat' || busy) return;

    const entries = promptHistory.current;
    if (key.upArrow && entries.length) {
      if (historyIndex.current === null) {
        draft.current = input;
        historyIndex.current = entries.length - 1;
      } else if (historyIndex.current > 0) {
        historyIndex.current--;
      } else {
        return;
      }
      recall(entries[historyIndex.current]!);
    } else if (key.downArrow && historyIndex.current !== null) {
      if (historyIndex.current < entries.length - 1) {
        historyIndex.current++;
        recall(entries[historyIndex.current]!);
      } else {
        historyIndex.current = null;
        recall(draft.current);
      }
    }
  });

  // --- Chatting ---------------------------------------------------------------

  async function send(text: string) {
    if (!provider) return;
    const conversation: ChatMessage[] = [...history, { role: 'user', content: text }];
    const messages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...conversation]
      : conversation;

    add('user', text);
    setActivity({ label: pickVerb(), startedAt: Date.now() });
    setStreaming('');

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';
    let usage: Usage | undefined;
    const startedAt = Date.now();
    let firstTokenAt: number | undefined;
    // Re-render at most every 50 ms rather than on every token.
    const flush = setInterval(() => setStreaming(reply), 50);

    try {
      const endpoint = await endpointFor(provider);
      const options = {
        signal: controller.signal,
        effort: effort ? { level: effort, param: effortParam() } : undefined,
      };
      for await (const event of streamChat(endpoint, model, messages, options)) {
        if (event.type === 'text') {
          firstTokenAt ??= Date.now();
          reply += event.text;
        } else if (event.type === 'usage') {
          usage = event.usage;
        } else {
          setRateLimit(event.rateLimit);
        }
      }
      setConnection('connected');
    } catch (error) {
      if (!controller.signal.aborted) add('error', errorMessage(error));
    } finally {
      clearInterval(flush);
      abortRef.current = null;
      setStreaming(null);
      setActivity(null);
    }

    // Without usage (unsupported, or the reply was stopped) the old figures
    // would be stale, so clear them.
    setLastUsage(usage);
    if (firstTokenAt) {
      const seconds = (Date.now() - firstTokenAt) / 1000;
      // Estimate output tokens from length (~4 characters each) if not reported.
      const outputTokens = usage?.outputTokens ?? Math.round(reply.length / 4);
      setSpeed({
        firstToken: (firstTokenAt - startedAt) / 1000,
        tokensPerSecond: seconds >= 0.1 ? outputTokens / seconds : undefined,
      });
    }
    if (usage) {
      const cost = costOf(usage, provider.prices?.[model] ?? modelInfo?.price);
      if (cost !== undefined) setSessionCost((total) => (total ?? 0) + cost);
    }

    if (reply) {
      const stopped = controller.signal.aborted ? '\n\n*[stopped]*' : '';
      add('assistant', reply + stopped);
      // Only keep the exchange if something came back, so a failed request
      // doesn't leave a dangling user message in the context.
      setHistory([...conversation, { role: 'assistant', content: reply }]);
    } else if (controller.signal.aborted) {
      add('info', 'Stopped.');
    }
  }

  // --- Providers --------------------------------------------------------------

  function handleAdded({ provider: added, apiKey, makeDefault }: AddedProvider) {
    setProviders((current) => [...current, added]);
    if (makeDefault) setDefaultName(added.name);
    keyCache.current.set(added.name, apiKey);
    switchTo(added);
    setMode({ type: 'chat' });
    add(
      'info',
      `Saved "${added.name}" to ${CONFIG_PATH}` +
        (apiKey ? ' and its API key to your Keychain.' : '.') +
        (makeDefault ? ' It is now the default.' : '') +
        `\nNow chatting with ${added.name} · ${added.model}`,
    );
  }

  function handleAddCancelled() {
    if (providers.length === 0) {
      add('info', 'No provider set up. Run achat again whenever you’re ready.');
      exit();
      return;
    }
    add('info', 'Cancelled. Nothing was saved.');
    backToChat();
  }

  async function handleRemove(name: string) {
    backToChat();
    const target = providers.find((p) => p.name === name);
    if (!target) return;
    const remaining = providers.filter((p) => p.name !== name);
    const newDefault = defaultName === name ? remaining[0]?.name : defaultName;

    const keyRef = target.apiKeyRef;
    const deleteKey =
      keyRef?.startsWith('keychain:') === true && !remaining.some((p) => p.apiKeyRef === keyRef);
    try {
      await removeProvider(name, newDefault);
      if (deleteKey) await deleteApiKey(keyRef!.slice(9));
    } catch (error) {
      add('error', `Could not remove "${name}": ${errorMessage(error)}`);
      return;
    }

    setProviders(remaining);
    setDefaultName(newDefault);
    keyCache.current.delete(name);
    add('info', `Removed "${name}"${deleteKey ? ' and its saved API key' : ''}.`);

    if (provider?.name === name) {
      const next = remaining.find((p) => p.name === newDefault) ?? remaining[0];
      if (next) {
        switchTo(next);
        add('info', `Now chatting with ${next.name} · ${next.model}`);
      } else {
        setProvider(undefined);
        setMode({ type: 'add' });
      }
    }
  }

  function switchRenderer(next: Renderer) {
    setRenderer(next);
    add('info', `Renderer: ${next}. Applies to new replies; earlier ones stay as they were.`);
  }

  async function openModelPicker() {
    if (!provider) return;
    setActivity({ label: 'Loading models', startedAt: Date.now() });
    try {
      const ids = await listModels(await endpointFor(provider));
      if (ids.length) setMode({ type: 'models', ids });
      else add('info', 'This provider didn’t report any models. Use /model <name>.');
    } catch (error) {
      add('error', `Could not list models: ${errorMessage(error)}`);
    } finally {
      setActivity(null);
    }
  }

  // --- Commands ---------------------------------------------------------------

  async function runCommand(line: string) {
    const [name = '', ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();

    switch (name) {
      case 'q':
      case 'quit':
      case 'exit':
        exit();
        return;

      case 'help':
        add('info', HELP);
        return;

      case 'clear':
        setHistory([]);
        setLastUsage(undefined);
        add('info', 'Conversation cleared. The next message starts fresh.');
        return;

      case 'model':
      case 'models':
        if (arg) {
          setModel(arg);
          add('info', `Model: ${arg}`);
        } else {
          await openModelPicker();
        }
        return;

      case 'provider':
      case 'providers': {
        if (!arg) return setMode({ type: 'providers' });
        if (arg === 'add' || arg === 'new') return setMode({ type: 'add' });
        if (arg === 'remove' || arg.startsWith('remove ')) {
          const target = arg.slice(6).trim();
          if (!target) return setMode({ type: 'remove' });
          if (!providers.some((p) => p.name === target)) {
            add('error', `No provider named "${target}".`);
            return;
          }
          return setMode({ type: 'confirmRemove', name: target });
        }
        const next = providers.find((p) => p.name === arg);
        if (!next) {
          add('error', `No provider named "${arg}". Type /provider to pick one.`);
          return;
        }
        switchTo(next);
        add('info', `Provider: ${next.name} · model: ${next.model}`);
        return;
      }

      case 'system':
        if (arg === 'off') {
          setSystemPrompt(undefined);
          add('info', 'System prompt removed.');
        } else if (arg) {
          setSystemPrompt(arg);
          add('info', 'System prompt set.');
        } else {
          add('info', systemPrompt ? `System prompt: ${systemPrompt}` : 'No system prompt set.');
        }
        return;

      case 'effort': {
        const support = modelInfo?.effort;
        if (support === null) {
          add('info', `${model} doesn’t support a reasoning effort setting.`);
          return;
        }
        if (!arg) return setMode({ type: 'effort' });
        if (['default', 'off', 'auto'].includes(arg)) {
          setEffort(undefined);
          add('info', 'Effort: model default.');
          return;
        }
        if (support && !support.levels.includes(arg)) {
          add('error', `${model} supports: ${support.levels.join(', ')}.`);
          return;
        }
        setEffort(arg);
        add(
          'info',
          `Effort: ${arg}.` + (support ? '' : ` ${provider?.name} doesn’t say whether ${model} supports it, so it may be rejected.`),
        );
        return;
      }

      case 'renderer':
      case 'render':
        if (!arg) return setMode({ type: 'renderer' });
        if (!isRenderer(arg)) {
          add('error', `Unknown renderer "${arg}". Choose ${RENDERERS.join(' or ')}.`);
          return;
        }
        switchRenderer(arg);
        return;

      default:
        add('error', `Unknown command /${name}. Type /help for the list.`);
    }
  }

  function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    setInput('');
    if (promptHistory.current.at(-1) !== text) promptHistory.current.push(text);
    historyIndex.current = null;
    draft.current = '';
    if (text.startsWith('/')) void runCommand(text);
    else void send(text);
  }

  // --- Rendering --------------------------------------------------------------

  const { columns, rows } = terminalSize();
  const width = Math.max(20, columns - 2);

  // Ink can't redraw output taller than the screen, so show only the tail of
  // a long reply while it streams. The full reply is printed once it's done.
  let liveReply: string | null = null;
  if (streaming) {
    const lines = renderMarkdown(streaming, width, renderer).split('\n');
    liveReply = lines.slice(-Math.max(3, rows - 6)).join('\n');
  }

  function renderPanel() {
    switch (mode.type) {
      case 'add':
        return (
          <AddProvider
            existingNames={providers.map((p) => p.name)}
            onDone={handleAdded}
            onCancel={handleAddCancelled}
          />
        );

      case 'providers':
        return (
          <SelectList<string>
            title="Providers"
            choices={[
              ...providers.map((p) => ({
                label: p.name,
                value: `use:${p.name}`,
                hint: [p.model, p.name === defaultName && 'default', p.name === provider?.name && 'current']
                  .filter(Boolean)
                  .join(' · '),
              })),
              { label: '+ Add a provider', value: 'add' },
              ...(providers.length ? [{ label: '− Remove a provider', value: 'remove' }] : []),
            ]}
            initialValue={provider && `use:${provider.name}`}
            onSelect={(value) => {
              if (value === 'add' || value === 'remove') return setMode({ type: value });
              const next = providers.find((p) => `use:${p.name}` === value)!;
              switchTo(next);
              backToChat();
              add('info', `Provider: ${next.name} · model: ${next.model}`);
            }}
            onCancel={backToChat}
          />
        );

      case 'remove':
        return (
          <SelectList<string>
            title="Remove which provider?"
            choices={providers.map((p) => ({ label: p.name, value: p.name, hint: p.baseUrl }))}
            onSelect={(name) => setMode({ type: 'confirmRemove', name })}
            onCancel={backToChat}
          />
        );

      case 'confirmRemove':
        return (
          <SelectList<boolean>
            title={`Remove "${mode.name}"? Its saved API key will be deleted too.`}
            choices={[
              { label: 'No, keep it', value: false },
              { label: 'Yes, remove it', value: true },
            ]}
            onSelect={(yes) => (yes ? void handleRemove(mode.name) : backToChat())}
            onCancel={backToChat}
          />
        );

      case 'models':
        return (
          <SelectList<string>
            title={`Models on ${provider?.name}`}
            choices={mode.ids.map((id) => ({ label: id, value: id }))}
            initialValue={model}
            filterable
            customChoice={(text) => ({ label: text, value: text, hint: 'use this name' })}
            onSelect={(id) => {
              setModel(id);
              backToChat();
              add('info', `Model: ${id}`);
            }}
            onCancel={backToChat}
          />
        );

      case 'renderer':
        return (
          <SelectList<Renderer>
            title="Markdown renderer"
            choices={RENDERERS.map((r) => ({
              label: r,
              value: r,
              hint: RENDERER_DESCRIPTIONS[r] + (r === renderer ? ' · current' : ''),
            }))}
            initialValue={renderer}
            onSelect={(next) => {
              backToChat();
              if (next !== renderer) switchRenderer(next);
            }}
            onCancel={backToChat}
          />
        );

      case 'effort': {
        const support = modelInfo?.effort;
        const levels = support?.levels ?? STANDARD_EFFORT_LEVELS;
        const fallback = support?.defaultLevel ? `model default (${support.defaultLevel})` : 'model default';
        return (
          <SelectList<string>
            title={support ? `Reasoning effort for ${model}` : `Reasoning effort (support for ${model} unknown)`}
            choices={[
              { label: fallback, value: '' },
              ...levels.map((level) => ({ label: level, value: level, hint: level === effort ? 'current' : undefined })),
            ]}
            initialValue={effort ?? ''}
            onSelect={(level) => {
              backToChat();
              setEffort(level || undefined);
              add('info', `Effort: ${level || 'model default'}.`);
            }}
            onCancel={backToChat}
          />
        );
      }

      case 'chat':
        return activity ? (
          <Spinner
            label={activity.label}
            startedAt={activity.startedAt}
            // Rough estimate (~4 characters per token) until the API reports usage.
            tokens={streaming ? Math.round(streaming.length / 4) : undefined}
            stoppable={streaming !== null}
          />
        ) : (
          <Box>
            <Text color="cyan" bold>
              {PROMPT}
            </Text>
            <TextInput
              key={inputKey}
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Message, or /help"
            />
          </Box>
        );
    }
  }

  return (
    <>
      <Static items={entries}>
        {(entry) => (
          <Box key={entry.id} marginBottom={1}>
            <EntryView entry={entry} width={width} />
          </Box>
        )}
      </Static>

      {liveReply !== null && (
        <Box marginBottom={1}>
          <Text>{liveReply}</Text>
        </Box>
      )}

      {renderPanel()}

      {provider && mode.type === 'chat' && (
        <Box marginTop={1}>
          <StatusBar
            columns={columns}
            info={{
              baseUrl: provider.baseUrl,
              connection: loaded ? connection : 'connecting',
              provider: provider.name,
              model,
              effortSupport: loaded ? modelInfo?.effort : undefined,
              effort,
              systemPrompt: Boolean(systemPrompt),
              rateLimit: loaded ? rateLimit : undefined,
              lastUsage,
              contextWindow: loaded ? modelInfo?.contextWindow : undefined,
              speed: loaded ? speed : undefined,
              // Show $0 up front when the price is known, so cost is visible before the first reply.
              sessionCost: sessionCost ?? (provider.prices?.[model] ?? modelInfo?.price ? 0 : undefined),
            }}
          />
        </Box>
      )}
    </>
  );
}

function EntryView({ entry, width }: { entry: Entry; width: number }) {
  switch (entry.kind) {
    case 'user':
      return (
        <Text>
          <Text color="cyan" bold>
            {PROMPT}
          </Text>
          {entry.text}
        </Text>
      );
    case 'assistant':
      return <Text>{renderMarkdown(entry.text, width, entry.renderer)}</Text>;
    case 'error':
      return <Text color="red">{entry.text}</Text>;
    case 'info':
      return <Text dimColor>{entry.text}</Text>;
  }
}
