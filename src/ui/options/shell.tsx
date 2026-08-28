/**
 * Options shell — three steps on first run, tabs ever after.
 *
 * The first step is the product working, not a form. A new user pastes a
 * resume and a posting and gets a tailored page before being asked for
 * anything: no account, no key, nothing sent anywhere (D-065). Saving the
 * profile and connecting a model are steps two and three because that is the
 * order in which they become worth doing, not because the tool needs them.
 *
 * Once a profile exists the sequence has served its purpose and the same panels
 * become tabs, which is the right shape for coming back to change one thing.
 */

import { useEffect, useState } from 'preact/hooks';
import { SettingsPanel } from './app';
import { ImportPanel } from './import';
import { ProfileEditor } from './profile';
import { QuickPanel } from './quick';
import { loadProfile } from '../../shared/storage';
import type { Profile } from '../../core/types';

const STEPS = ['Tailor', 'Profile', 'Connect'] as const;
type Step = 0 | 1 | 2;

type Tab = 'quick' | 'profile' | 'import' | 'settings';

type Mode =
  | { readonly kind: 'loading' }
  | { readonly kind: 'setup'; readonly step: Step }
  | { readonly kind: 'tabs'; readonly tab: Tab };

const TAB_LABELS: Readonly<Record<Tab, string>> = {
  quick: 'Tailor',
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
  /** The saved profile, if there is one. Refreshed after every save. */
  const [saved, setSaved] = useState<Profile | undefined>(undefined);
  /** A parsed profile that has not been saved yet. Never written from here (D-071). */
  const [draft, setDraft] = useState<Profile | undefined>(undefined);
  /** Bumped per import, so a second import remounts the editor onto the new draft. */
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    loadProfile()
      // A saved profile means setup has happened, whatever state it is in.
      // A read that fails is not evidence of a first run, so it lands in tabs.
      .then((profile) => {
        setSaved(profile);
        setMode(profile === undefined ? { kind: 'setup', step: 0 } : { kind: 'tabs', tab: 'quick' });
      })
      .catch(() => setMode({ kind: 'tabs', tab: 'quick' }));
  }, []);

  if (mode.kind === 'loading') {
    return (
      <main>
        <p class="loading">Loading…</p>
      </main>
    );
  }

  const drafted = (profile: Profile, next: Mode): void => {
    setDraft(profile);
    setSeed(seed + 1);
    setMode(next);
  };

  /** After a save the editor's copy is the truth; drop the draft and re-read. */
  const savedProfile = (): void => {
    setDraft(undefined);
    void loadProfile().then(setSaved).catch(() => undefined);
  };

  if (mode.kind === 'setup') {
    const { step } = mode;
    const go = (to: Step): void => setMode({ kind: 'setup', step: to });
    const finish = (): void => setMode({ kind: 'tabs', tab: 'quick' });

    return (
      <main>
        <Progress step={step} />

        {step === 0 ? (
          <QuickPanel onUseProfile={(profile) => drafted(profile, { kind: 'setup', step: 1 })} onConnect={() => go(2)} />
        ) : step === 1 ? (
          <ProfileEditor
            // A fresh draft replaces whatever the editor was holding.
            key={seed}
            initial={draft}
            doneLabel="Save and continue"
            onDone={() => {
              savedProfile();
              go(2);
            }}
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
          {step === 0 ? (
            <button type="button" class="link" onClick={() => go(1)}>
              Skip — set my profile up by hand
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
  const open = (next: Tab): void => setMode({ kind: 'tabs', tab: next });

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
            onClick={() => open(name)}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </nav>

      {tab === 'quick' ? (
        <QuickPanel
          savedProfile={draft ?? saved}
          onUseProfile={(profile) => drafted(profile, { kind: 'tabs', tab: 'profile' })}
          onConnect={() => open('settings')}
        />
      ) : tab === 'profile' ? (
        // Once the draft is saved it stops being the seed: the editor reloads from
        // storage, so later edits are not overwritten by an import on every visit.
        <ProfileEditor key={seed} initial={draft} onDone={savedProfile} />
      ) : tab === 'import' ? (
        <ImportPanel
          onImported={(profile) => drafted(profile, { kind: 'tabs', tab: 'profile' })}
          onSkip={() => open('profile')}
          onConnect={() => open('settings')}
        />
      ) : (
        <SettingsPanel />
      )}
    </main>
  );
};
