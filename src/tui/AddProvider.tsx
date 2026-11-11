import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import {
  CONFIG_PATH,
  PROVIDER_NAME_PATTERN,
  type Provider,
  saveProvider,
  storeApiKey,
} from '../config.js';
import { ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_MODEL } from '../core/anthropic.js';
import { listModels, OPENAI_BASE_URL } from '../core/client.js';
import { FEATHERLESS_BASE_URL } from '../core/featherless.js';
import { VENICE_BASE_URL } from '../core/venice.js';
import type { ApiKind } from '../core/types.js';
import { keyEnvVar, type KeyStore, keyStore } from '../keystore.js';
import { type Choice, Prompt, SelectList } from './components.js';
import { Spinner } from './Spinner.js';

interface Preset {
  label: string;
  hint?: string;
  kind: ApiKind;
  name: string;
  baseUrl: string;
  keyRequired: boolean;
  suggestedModel?: string;
}

const MAIN_PRESETS: Preset[] = [
  {
    label: 'OpenAI',
    kind: 'openai',
    name: 'openai',
    baseUrl: OPENAI_BASE_URL,
    keyRequired: true,
    suggestedModel: 'gpt-5-mini',
  },
  {
    label: 'Anthropic',
    kind: 'anthropic',
    name: 'anthropic',
    baseUrl: ANTHROPIC_BASE_URL,
    keyRequired: true,
    suggestedModel: ANTHROPIC_DEFAULT_MODEL,
  },
  {
    label: 'Venice',
    hint: 'shows your balance',
    kind: 'venice',
    name: 'venice',
    baseUrl: VENICE_BASE_URL,
    keyRequired: true,
  },
  {
    label: 'Featherless',
    hint: 'open models, flat-rate plans',
    kind: 'featherless',
    name: 'featherless',
    baseUrl: FEATHERLESS_BASE_URL,
    keyRequired: true,
  },
];

const COMPATIBLE_PRESETS: Preset[] = [
  { label: 'OpenRouter', kind: 'openai', name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true },
  { label: 'Ollama', hint: 'local', kind: 'openai', name: 'ollama', baseUrl: 'http://localhost:11434/v1', keyRequired: false },
  { label: 'LM Studio', hint: 'local', kind: 'openai', name: 'lmstudio', baseUrl: 'http://localhost:1234/v1', keyRequired: false },
  { label: 'Jan', hint: 'local', kind: 'openai', name: 'jan', baseUrl: 'http://localhost:1337/v1', keyRequired: false },
  { label: 'Other', hint: 'any OpenAI-compatible URL', kind: 'openai', name: '', baseUrl: '', keyRequired: false },
];

type Step =
  | 'kind'
  | 'preset'
  | 'name'
  | 'url'
  | 'customUrl'
  | 'key'
  | 'checking'
  | 'checkFailed'
  | 'model'
  | 'modelManual'
  | 'default'
  | 'saving';

export interface AddedProvider {
  provider: Provider;
  apiKey?: string;
  makeDefault: boolean;
  /** Where the key went, for the confirmation message; undefined when there is no key. */
  keyNote?: string;
}

interface Props {
  existingNames: string[];
  onDone: (result: AddedProvider) => void;
  onCancel: () => void;
}

function validateUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.pathname.includes('://')) {
      return undefined;
    }
  } catch {
    // Fall through to the error below.
  }
  return 'Enter a full URL, e.g. https://api.example.com/v1';
}

function uniqueName(base: string, taken: string[]): string {
  if (!base || !taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export default function AddProvider({ existingNames, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('kind');
  const [preset, setPreset] = useState<Preset>(MAIN_PRESETS[0]!);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [problem, setProblem] = useState('');
  // undefined = still checking, null = no keyring on this machine.
  const [store, setStore] = useState<KeyStore | null | undefined>(undefined);

  useEffect(() => {
    keyStore().then((s) => setStore(s ?? null), () => setStore(null));
  }, []);

  const isFirst = existingNames.length === 0;

  function choosePreset(p: Preset) {
    setPreset(p);
    setName(uniqueName(p.name, existingNames));
    setBaseUrl(p.baseUrl);
    setStep('name');
  }

  // Check the connection (and fetch models) once the key is entered.
  useEffect(() => {
    if (step !== 'checking') return;
    const controller = new AbortController();
    listModels({ kind: preset.kind, baseUrl, apiKey: apiKey || undefined }, controller.signal)
      .then((ids) => {
        setModels(ids);
        setStep(ids.length ? 'model' : 'modelManual');
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setProblem(error.message);
        setStep('checkFailed');
      });
    return () => controller.abort();
  }, [step]);

  function chooseModel(id: string) {
    setModel(id);
    if (isFirst) save(id, true);
    else setStep('default');
  }

  function save(chosenModel: string, makeDefault: boolean) {
    setStep('saving');
    (async (): Promise<AddedProvider> => {
      let apiKeyRef: string | undefined;
      let keyNote: string | undefined;
      if (apiKey) {
        let storeProblem = store ? '' : 'No OS keyring is available here.';
        if (store) {
          try {
            await storeApiKey(name, apiKey);
            apiKeyRef = `keychain:${name}`;
            keyNote = `its API key to your ${store.label}.`;
          } catch (error) {
            storeProblem = `${(error as Error).message}.`;
          }
        }
        if (!apiKeyRef) {
          // No working keyring: the config points at an environment variable and the
          // key is used from memory for this session only.
          const variable = keyEnvVar(name);
          apiKeyRef = `env:${variable}`;
          keyNote =
            `a reference to the environment variable ${variable}. ${storeProblem} ` +
            'The key works for this session only. To keep it, add this line with your key ' +
            `to your shell profile (~/.bashrc, ~/.zshrc…):\n  export ${variable}='…'\n`;
        }
      }
      const provider: Provider = { name, kind: preset.kind, baseUrl, model: chosenModel, apiKeyRef };
      await saveProvider(provider, makeDefault);
      return { provider, apiKey: apiKey || undefined, makeDefault, keyNote };
    })()
      .then(onDone)
      .catch((error: Error) => {
        setProblem(`Could not save: ${error.message}`);
        setStep('checkFailed');
      });
  }

  const summary = [name, baseUrl, model].filter(Boolean).join(' · ');

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {isFirst ? 'Welcome to achat! Let’s add your first provider.' : 'Add a provider'}
      </Text>
      {summary && step !== 'kind' && <Text dimColor>{summary}</Text>}
      <Text> </Text>

      {step === 'kind' && (
        <SelectList<Preset | 'compatible'>
          title="Which service?"
          choices={[
            ...MAIN_PRESETS.map((p) => ({ label: p.label, hint: p.hint, value: p })),
            { label: 'Other', hint: 'OpenRouter, Ollama, LM Studio, Jan, custom…', value: 'compatible' },
          ]}
          onSelect={(v) => (v === 'compatible' ? setStep('preset') : choosePreset(v))}
          onCancel={onCancel}
        />
      )}

      {step === 'preset' && (
        <SelectList<Preset>
          title="Which OpenAI-compatible service?"
          choices={COMPATIBLE_PRESETS.map((p) => ({ label: p.label, hint: p.hint, value: p }))}
          onSelect={choosePreset}
          onCancel={onCancel}
        />
      )}

      {step === 'name' && (
        <Prompt
          key="name"
          label="Name for this provider"
          hint="Used with /provider <name>. Letters, numbers, - and _."
          initial={name}
          placeholder="e.g. groq"
          validate={(v) =>
            !v
              ? 'Please enter a name'
              : !PROVIDER_NAME_PATTERN.test(v)
                ? 'Use letters, numbers, - and _ only'
                : existingNames.includes(v)
                  ? `"${v}" already exists`
                  : undefined
          }
          onSubmit={(v) => {
            setName(v);
            setStep('url');
          }}
          onCancel={onCancel}
        />
      )}

      {step === 'url' && preset.baseUrl && (
        <SelectList<'default' | 'custom'>
          title="API base URL"
          choices={[
            { label: preset.baseUrl, hint: 'default', value: 'default' },
            { label: 'Use a different URL…', value: 'custom' },
          ]}
          onSelect={(v) => {
            if (v === 'default') {
              setBaseUrl(preset.baseUrl);
              setStep('key');
            } else {
              setBaseUrl('');
              setStep('customUrl');
            }
          }}
          onCancel={onCancel}
        />
      )}

      {(step === 'customUrl' || (step === 'url' && !preset.baseUrl)) && (
        <Prompt
          key="url"
          label="API base URL"
          hint={preset.kind === 'anthropic' ? undefined : 'Usually ends in /v1.'}
          placeholder="https://api.example.com/v1"
          validate={validateUrl}
          onSubmit={(v) => {
            setBaseUrl(v.replace(/\/+$/, ''));
            setStep('key');
          }}
          onCancel={onCancel}
        />
      )}

      {step === 'key' && (
        <Prompt
          key="key"
          secret
          label="API key"
          hint={
            (preset.keyRequired ? '' : 'Leave empty if this server doesn’t need one. ') +
            (store
              ? `Saved to your ${store.label}, never to the config file.`
              : store === null
                ? `No OS keyring here: the config will point at the variable ${keyEnvVar(name)} instead.`
                : '')
          }
          validate={(v) =>
            preset.keyRequired && !v
              ? 'This service needs an API key'
              : /\s/.test(v)
                ? 'The key shouldn’t contain spaces'
                : undefined
          }
          onSubmit={(v) => {
            setApiKey(v);
            setStep('checking');
          }}
          onCancel={onCancel}
        />
      )}

      {step === 'checking' && <Waiting onCancel={onCancel} />}

      {step === 'checkFailed' && (
        <>
          <Text color="red">{problem}</Text>
          <Text> </Text>
          <SelectList<'key' | 'url' | 'manual' | 'cancel'>
            title="What would you like to do?"
            choices={[
              { label: 'Re-enter the API key', value: 'key' },
              { label: 'Change the URL', value: 'url' },
              { label: 'Continue anyway and type a model name', value: 'manual' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onSelect={(v) => (v === 'cancel' ? onCancel() : setStep(v === 'manual' ? 'modelManual' : v === 'url' ? 'customUrl' : v))}
            onCancel={onCancel}
          />
        </>
      )}

      {step === 'model' && (
        <SelectList<string>
          title={`Default model (${models.length} available)`}
          choices={models.map((id): Choice<string> => ({
            label: id,
            value: id,
            hint: id === preset.suggestedModel ? 'suggested' : undefined,
          }))}
          initialValue={preset.suggestedModel}
          filterable
          customChoice={(text) => ({ label: text, value: text, hint: 'use this name' })}
          onSelect={chooseModel}
          onCancel={onCancel}
        />
      )}

      {step === 'modelManual' && (
        <Prompt
          key="modelManual"
          label="Model name"
          initial={preset.suggestedModel}
          placeholder="e.g. llama3.2"
          validate={(v) => (v ? undefined : 'Please enter a model name')}
          onSubmit={chooseModel}
          onCancel={onCancel}
        />
      )}

      {step === 'default' && (
        <SelectList<boolean>
          title={`Make "${name}" the default provider when achat starts?`}
          choices={[
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ]}
          onSelect={(v) => save(model, v)}
          onCancel={onCancel}
        />
      )}

      {step === 'saving' && <Text dimColor>Saving to {CONFIG_PATH}…</Text>}
    </Box>
  );
}

function Waiting({ onCancel }: { onCancel: () => void }) {
  const [startedAt] = useState(Date.now);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  return <Spinner label="Checking the connection" startedAt={startedAt} stoppable />;
}
