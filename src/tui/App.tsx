import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useRef, useState } from 'react';
import {
  CONFIG_PATH,
  type Config,
  deleteApiKey,
  type Provider,
  removeProvider,
  resolveApiKey,
} from '../config.js';
import { listModels, streamChat } from '../core/client.js';
import type { ChatMessage, Endpoint } from '../core/types.js';
import AddProvider, { type AddedProvider } from './AddProvider.js';
import { SelectList } from './components.js';
import { renderMarkdown } from './markdown.js';

type EntryKind = 'user' | 'assistant' | 'info' | 'error';

interface Entry {
  id: number;
  kind: EntryKind;
  text: string;
}

type Mode =
  | { type: 'chat' }
  | { type: 'add' }
  | { type: 'providers' }
  | { type: 'remove' }
  | { type: 'confirmRemove'; name: string }
  | { type: 'models'; ids: string[] };

const HELP = `Commands:
  /provider          pick, add or remove a provider
  /provider <name>   switch to a provider
  /provider add      add a provider (step-by-step setup)
  /provider remove   remove a provider and its saved key
  /model             pick a model from the current provider
  /model <name>      switch to a model by name
  /system [text|off] show, set or remove the system prompt
  /clear             forget the conversation and start fresh
  /help              show this help
  /quit              exit (or Ctrl+C)
Model and system prompt changes last for this session only.
Press Esc while a reply is streaming to stop it.
Nothing is saved: the conversation disappears when you quit.`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminalSize() {
  return { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
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
    { id: 0, kind: 'info', text: 'achat · type /help for commands · nothing is saved' },
  ]);
  const [mode, setMode] = useState<Mode>(() =>
    config.providers.length ? { type: 'chat' } : { type: 'add' },
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const keyCache = useRef(new Map<string, string | undefined>());

  const add = (kind: EntryKind, text: string) =>
    setEntries((current) => [...current, { id: nextId.current++, kind, text }]);

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

  useInput((_input, key) => {
    if (key.escape) abortRef.current?.abort();
  });

  // --- Chatting ---------------------------------------------------------------

  async function send(text: string) {
    if (!provider) return;
    const conversation: ChatMessage[] = [...history, { role: 'user', content: text }];
    const messages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...conversation]
      : conversation;

    add('user', text);
    setBusy(true);
    setStreaming('');

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';
    // Re-render at most every 50 ms rather than on every token.
    const flush = setInterval(() => setStreaming(reply), 50);

    try {
      const endpoint = await endpointFor(provider);
      for await (const chunk of streamChat(endpoint, model, messages, controller.signal)) {
        reply += chunk;
      }
    } catch (error) {
      if (!controller.signal.aborted) add('error', errorMessage(error));
    } finally {
      clearInterval(flush);
      abortRef.current = null;
      setStreaming(null);
      setBusy(false);
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

  async function openModelPicker() {
    if (!provider) return;
    setBusy(true);
    try {
      const ids = await listModels(await endpointFor(provider));
      if (ids.length) setMode({ type: 'models', ids });
      else add('info', 'This provider didn’t report any models. Use /model <name>.');
    } catch (error) {
      add('error', `Could not list models: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
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

      default:
        add('error', `Unknown command /${name}. Type /help for the list.`);
    }
  }

  function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    setInput('');
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
    const lines = renderMarkdown(streaming, width).split('\n');
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

      case 'chat':
        return busy ? (
          <Text dimColor>
            {streaming === '' ? 'Waiting for reply…' : streaming ? '' : 'Working…'}
            {streaming !== null && ' (Esc to stop)'}
          </Text>
        ) : (
          <Box>
            <Text color="cyan" bold>
              {'› '}
            </Text>
            <TextInput
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
        <Text dimColor>
          {provider.name} · {model}
          {history.length > 0 && ` · ${history.length / 2} turn${history.length === 2 ? '' : 's'}`}
        </Text>
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
            {'› '}
          </Text>
          {entry.text}
        </Text>
      );
    case 'assistant':
      return <Text>{renderMarkdown(entry.text, width)}</Text>;
    case 'error':
      return <Text color="red">{entry.text}</Text>;
    case 'info':
      return <Text dimColor>{entry.text}</Text>;
  }
}
