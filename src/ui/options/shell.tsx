/**
 * Options shell.
 *
 * Two panels behind one page, because settings and profile are both required
 * before anything can be tailored and both are reached from the same place.
 */

import { useState } from 'preact/hooks';
import { SettingsPanel } from './app';
import { ProfileEditor } from './profile';

type Panel = 'profile' | 'settings';

export const Shell = () => {
  const [panel, setPanel] = useState<Panel>('profile');

  return (
    <main>
      <nav class="tabs" role="tablist">
        {(['profile', 'settings'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            class={panel === name ? 'tab active' : 'tab'}
            onClick={() => setPanel(name)}
          >
            {name === 'profile' ? 'Profile' : 'Settings'}
          </button>
        ))}
      </nav>
      {panel === 'profile' ? <ProfileEditor /> : <SettingsPanel />}
    </main>
  );
};
