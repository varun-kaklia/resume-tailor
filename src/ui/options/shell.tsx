/**
 * Options shell — a three-step setup on first run, tabs ever after.
 *
 * First run is a sequence because the steps genuinely depend on each other:
 * read a resume, check what was read, connect the model that will tailor it.
 * Tabs are the wrong shape for that — they present three equal choices to
 * someone who does not yet know what any of them are for.
 *
 * Once a profile exists the sequence has served its purpose and the same three
 * panels become tabs, which is the right shape for coming back to change one
 * thing.
 */

import { useEffect, useState } from 'preact/hooks';
import { SettingsPanel } from './app';
import { ImportPanel } from './import';
import { ProfileEditor } from './profile';
import { loadProfile } from '../../shared/storage';
import type { Profile } from '../../core/types';

const STEPS = ['Import', 'Review', 'Connect'] as const;
type Step = 0 | 1 | 2;

type Mode =
  | { readonly kind: 'loading' }
  | { readonly kind: 'setup'; readonly step: Step }
  | { readonly kind: 'tabs'; readonly tab: Tab };

type Tab = 'profile' | 'import' | 'settings';

const TAB_LABELS: Readonly<Record<Tab, string>> = {
  profile: 'Profile',
  import: 'Import',
  settings: 'Settings',
};

/**
 * Progress, as a bar and as words.
 *
 * The bar alone says "there is more" without saying what, which is the part
 * people actually want to know before starting.
 */
const Progress = ({ step }: { step: Step }) => (
  <nav class="steps" aria-label="Setup progress">
    <div class="steps-track">
      <div class="steps-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
    </div>
    <ol class="steps-labels">
      {STEPS.map((label, index) => (
        <li
          key={label}
          class={index === step ? 'step current' : index < step ? 'step done' : 'step'}
          aria-current={index === step ? 'step' : undefined}
        >
          <span class="step-number">{index < step ? '✓' : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  </nav>
);

export const Shell = () => {
  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  /** An extracted profile that has not been saved yet. Never written from here. */
  const [draft, setDraft] = useState<Profile | undefined>(undefined);
  /** Bumped per import, so a second import remounts the editor onto the new draft. */
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    loadProfile()
      // A saved profile means setup has happened, whatever state it is in.
      // A read that fails is not evidence of a first run, so it lands in tabs.
      .then((saved) => setMode(saved === undefined ? { kind: 'setup', step: 0 } : { kind: 'tabs', tab: 'profile' }))
      .catch(() => setMode({ kind: 'tabs', tab: 'profile' }));
  }, []);

  if (mode.kind === 'loading') return <main><p class="loading">Loading…</p></main>;

  const imported = (profile: Profile, next: Mode): void => {
    setDraft(profile);
    setSeed(seed + 1);
    setMode(next);
  };

  if (mode.kind === 'setup') {
    const { step } = mode;
    const go = (to: Step): void => setMode({ kind: 'setup', step: to });
    const finish = (): void => setMode({ kind: 'tabs', tab: 'profile' });

    return (
      <main>
        <Progress step={step} />

        {step === 0 ? (
          <ImportPanel
            onImported={(profile) => imported(profile, { kind: 'setup', step: 1 })}
            onSkip={() => go(1)}
            onConnect={() => go(2)}
          />
        ) : step === 1 ? (
          <ProfileEditor
            // A fresh import replaces whatever the editor was holding.
            key={seed}
            initial={draft}
            doneLabel="Save and continue"
            onDone={() => go(2)}
          />
        ) : (
          <SettingsPanel doneLabel="Save and finish" onDone={finish} />
        )}

        <div class="wizard-nav">
          {step > 0 ? (
            <button type="button" class="secondary small" onClick={() => go((step - 1) as Step)}>
              ← Back
            </button>
          ) : null}
          {step === 2 ? (
            <button type="button" class="link" onClick={finish}>
              Do this later
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const { tab } = mode;
  return (
    <main>
      <nav class="tabs" role="tablist">
        {(Object.keys(TAB_LABELS) as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            class={tab === name ? 'tab active' : 'tab'}
            onClick={() => setMode({ kind: 'tabs', tab: name })}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </nav>

      {tab === 'profile' ? (
        // Once the draft is saved it stops being the seed: the editor reloads from
        // storage, so later edits are not overwritten by the import on every visit.
        <ProfileEditor key={seed} initial={draft} onDone={() => setDraft(undefined)} />
      ) : tab === 'import' ? (
        <ImportPanel
          onImported={(profile) => imported(profile, { kind: 'tabs', tab: 'profile' })}
          onSkip={() => setMode({ kind: 'tabs', tab: 'profile' })}
          onConnect={() => setMode({ kind: 'tabs', tab: 'settings' })}
        />
      ) : (
        <SettingsPanel />
      )}
    </main>
  );
};
