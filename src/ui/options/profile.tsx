/**
 * Profile editor.
 *
 * Round-trip editing: enter a profile, change it, save it, get the same thing
 * back. Reordering is not here yet.
 *
 * `initial` seeds the fields from an imported draft instead of from storage —
 * the import path hands the extraction here rather than saving it, so the user
 * confirms every field before anything is written. Read once, on mount: it is a
 * starting point, not a bound value, and the shell remounts the editor when a
 * new import arrives.
 */

import { useEffect, useState } from 'preact/hooks';
import { MAX_NOTE_CHARS, emptyProfile } from '../../core/profile/schema';
import { isAppError } from '../../core/types';
import { loadProfile, saveProfile } from '../../shared/storage';
import {
  addBullet,
  addEducation,
  addExperience,
  addProject,
  addSkillGroup,
  checkProfile,
  parseSkillList,
  removeBullet,
  removeEducation,
  removeExperience,
  removeProject,
  removeSkillGroup,
  touch,
  updateBullet,
  updateEducation,
  updateExperience,
  updateProject,
  updateSkillGroup,
} from './profile-draft';
import type { BulletParent } from './profile-draft';
import type { Contact, Experience, Profile } from '../../core/types';

type Status = { readonly kind: 'idle' | 'ok' | 'error'; readonly message?: string };

const Row = ({ label, issue, children }: { label: string; issue?: string | undefined; children: preact.ComponentChildren }) => (
  <label class="field">
    <span class="field-label">{label}</span>
    {children}
    {issue !== undefined ? <span class="field-issue">{issue}</span> : null}
  </label>
);

const Text = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) => (
  <input
    type="text"
    value={value}
    placeholder={placeholder ?? ''}
    spellcheck={false}
    onInput={(event) => onChange((event.target as HTMLInputElement).value)}
  />
);

export const ProfileEditor = ({
  initial,
  onDone,
  doneLabel,
}: {
  initial?: Profile | undefined;
  /** Called after a successful save. Drives the setup sequence. */
  onDone?: (() => void) | undefined;
  doneLabel?: string | undefined;
} = {}) => {
  const [profile, setProfile] = useState<Profile>(initial ?? emptyProfile);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [showIssues, setShowIssues] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (initial !== undefined) return;
    loadProfile()
      .then((saved) => {
        if (saved !== undefined) setProfile(saved);
      })
      .catch((thrown: unknown) => {
        setStatus({ kind: 'error', message: isAppError(thrown) ? thrown.userMessage : 'Could not read your profile.' });
      })
      .finally(() => setLoaded(true));
  }, []);

  const check = checkProfile(profile);
  const issue = (path: string): string | undefined => (showIssues ? check.issues.get(path) : undefined);

  const edit = (next: Profile): void => {
    setProfile(next);
    setStatus({ kind: 'idle' });
  };

  const contact = (patch: Partial<Contact>): void => edit({ ...profile, contact: { ...profile.contact, ...patch } });

  const save = async (): Promise<void> => {
    setShowIssues(true);
    if (!check.ok) {
      setStatus({ kind: 'error', message: `${check.count} field${check.count === 1 ? '' : 's'} need attention.` });
      return;
    }
    try {
      await saveProfile(touch(profile));
      setStatus({ kind: 'ok', message: 'Profile saved.' });
      onDone?.();
    } catch (thrown) {
      setStatus({ kind: 'error', message: isAppError(thrown) ? thrown.userMessage : 'Could not save your profile.' });
    }
  };

  const bulletList = (section: BulletParent, parentId: string, bullets: readonly { id: string; text: string }[], base: string) => (
    <div class="bullets">
      {bullets.map((bullet, index) => (
        <div class="bullet" key={bullet.id}>
          <textarea
            rows={2}
            value={bullet.text}
            placeholder="Accomplished X, measured by Y, by doing Z"
            onInput={(event) => edit(updateBullet(profile, section, parentId, bullet.id, (event.target as HTMLTextAreaElement).value))}
          />
          <button type="button" class="remove" title="Remove bullet" onClick={() => edit(removeBullet(profile, section, parentId, bullet.id))}>
            ×
          </button>
          {issue(`${base}.bullets[${index}].text`) !== undefined ? (
            <span class="field-issue">{issue(`${base}.bullets[${index}].text`)}</span>
          ) : null}
        </div>
      ))}
      <button type="button" class="secondary small" onClick={() => edit(addBullet(profile, section, parentId))}>
        Add bullet
      </button>
    </div>
  );

  if (!loaded) return <p class="loading">Loading…</p>;

  return (
    <div>
      <h1>Your profile</h1>
      <p class="lead">
        {initial !== undefined
          ? 'This is what was read from your resume. Check it — anything the model could not find is blank, and nothing saves until you say so.'
          : 'Everything on a tailored resume comes from here. Nothing is invented — the AI selects and rewords what you enter, and never adds to it.'}
      </p>

      <section class="group">
        <h2>Contact</h2>
        <Row label="Full name" issue={issue('contact.fullName')}>
          <Text value={profile.contact.fullName} onChange={(fullName) => contact({ fullName })} />
        </Row>
        <Row label="Email" issue={issue('contact.email')}>
          <Text value={profile.contact.email} onChange={(email) => contact({ email })} />
        </Row>
        <Row label="Phone (optional)" issue={issue('contact.phone')}>
          <Text value={profile.contact.phone ?? ''} onChange={(phone) => contact({ phone })} />
        </Row>
        <Row label="Location (optional)" issue={issue('contact.location')}>
          <Text value={profile.contact.location ?? ''} onChange={(location) => contact({ location })} placeholder="City, Country" />
        </Row>
        <Row label="LinkedIn (optional)" issue={issue('contact.linkedin')}>
          <Text value={profile.contact.linkedin ?? ''} onChange={(linkedin) => contact({ linkedin })} />
        </Row>
        <Row label="GitHub (optional)" issue={issue('contact.github')}>
          <Text value={profile.contact.github ?? ''} onChange={(github) => contact({ github })} />
        </Row>
      </section>

      <section class="group">
        <h2>Experience</h2>
        {profile.experience.map((role, index) => (
          <article class="card" key={role.id}>
            <header>
              <span class="card-id">{role.id}</span>
              <button type="button" class="remove" onClick={() => edit(removeExperience(profile, role.id))}>
                Remove role
              </button>
            </header>
            <Row label="Job title" issue={issue(`experience[${index}].title`)}>
              <Text value={role.title} onChange={(title) => edit(updateExperience(profile, role.id, { title }))} />
            </Row>
            <Row label="Company" issue={issue(`experience[${index}].company`)}>
              <Text value={role.company} onChange={(company) => edit(updateExperience(profile, role.id, { company }))} />
            </Row>
            <div class="pair">
              <Row label="From" issue={issue(`experience[${index}].dates.start`)}>
                <Text value={role.dates.start} onChange={(start) => edit(updateExperience(profile, role.id, { dates: { ...role.dates, start: start as Experience['dates']['start'] } }))} placeholder="2024-01" />
              </Row>
              <Row label="To" issue={issue(`experience[${index}].dates.end`)}>
                <Text value={role.dates.end} onChange={(end) => edit(updateExperience(profile, role.id, { dates: { ...role.dates, end: end as Experience['dates']['end'] } }))} placeholder="present" />
              </Row>
            </div>
            <Row label="Note (optional)" issue={issue(`experience[${index}].note`)}>
              <textarea
                rows={2}
                value={role.note ?? ''}
                maxLength={MAX_NOTE_CHARS}
                placeholder="Context a bullet cannot carry — a contract arrangement, a short tenure, a leave"
                onInput={(event) => edit(updateExperience(profile, role.id, { note: (event.target as HTMLTextAreaElement).value || undefined }))}
              />
              <span class="budget">
                {(role.note ?? '').length}/{MAX_NOTE_CHARS} · your words, rendered as written, never sent to the AI
              </span>
            </Row>
            {bulletList('experience', role.id, role.bullets, `experience[${index}]`)}
          </article>
        ))}
        <button type="button" class="secondary" onClick={() => edit(addExperience(profile))}>
          Add role
        </button>
      </section>

      <section class="group">
        <h2>Projects</h2>
        {profile.projects.map((project, index) => (
          <article class="card" key={project.id}>
            <header>
              <span class="card-id">{project.id}</span>
              <button type="button" class="remove" onClick={() => edit(removeProject(profile, project.id))}>
                Remove project
              </button>
            </header>
            <Row label="Name" issue={issue(`projects[${index}].name`)}>
              <Text value={project.name} onChange={(name) => edit(updateProject(profile, project.id, { name }))} />
            </Row>
            <Row label="Link (optional)" issue={issue(`projects[${index}].url`)}>
              <Text value={project.url ?? ''} onChange={(url) => edit(updateProject(profile, project.id, { url: url || undefined }))} />
            </Row>
            {bulletList('projects', project.id, project.bullets, `projects[${index}]`)}
          </article>
        ))}
        <button type="button" class="secondary" onClick={() => edit(addProject(profile))}>
          Add project
        </button>
      </section>

      <section class="group">
        <h2>Education</h2>
        {profile.education.map((entry, index) => (
          <article class="card" key={entry.id}>
            <header>
              <span class="card-id">{entry.id}</span>
              <button type="button" class="remove" onClick={() => edit(removeEducation(profile, entry.id))}>
                Remove
              </button>
            </header>
            <Row label="Institution" issue={issue(`education[${index}].institution`)}>
              <Text value={entry.institution} onChange={(institution) => edit(updateEducation(profile, entry.id, { institution }))} />
            </Row>
            <div class="pair">
              <Row label="Degree" issue={issue(`education[${index}].degree`)}>
                <Text value={entry.degree} onChange={(degree) => edit(updateEducation(profile, entry.id, { degree }))} />
              </Row>
              <Row label="Field" issue={issue(`education[${index}].field`)}>
                <Text value={entry.field} onChange={(field) => edit(updateEducation(profile, entry.id, { field }))} />
              </Row>
            </div>
            <div class="pair">
              <Row label="From" issue={issue(`education[${index}].dates.start`)}>
                <Text value={entry.dates.start} onChange={(start) => edit(updateEducation(profile, entry.id, { dates: { ...entry.dates, start: start as typeof entry.dates.start } }))} placeholder="2020-08" />
              </Row>
              <Row label="To" issue={issue(`education[${index}].dates.end`)}>
                <Text value={entry.dates.end} onChange={(end) => edit(updateEducation(profile, entry.id, { dates: { ...entry.dates, end: end as typeof entry.dates.end } }))} placeholder="2024-05" />
              </Row>
            </div>
          </article>
        ))}
        <button type="button" class="secondary" onClick={() => edit(addEducation(profile))}>
          Add education
        </button>
      </section>

      <section class="group">
        <h2>Skills</h2>
        {profile.skills.map((group, index) => (
          <article class="card" key={group.id}>
            <header>
              <span class="card-id">{group.id}</span>
              <button type="button" class="remove" onClick={() => edit(removeSkillGroup(profile, group.id))}>
                Remove
              </button>
            </header>
            <Row label="Label" issue={issue(`skills[${index}].label`)}>
              <Text value={group.label} onChange={(label) => edit(updateSkillGroup(profile, group.id, { label }))} placeholder="Languages" />
            </Row>
            <Row label="Skills, comma separated" issue={issue(`skills[${index}].skills`)}>
              <Text
                value={group.skills.join(', ')}
                onChange={(value) => edit(updateSkillGroup(profile, group.id, { skills: parseSkillList(value) }))}
                placeholder="Go, TypeScript, Python"
              />
            </Row>
          </article>
        ))}
        <button type="button" class="secondary" onClick={() => edit(addSkillGroup(profile))}>
          Add skill group
        </button>
      </section>

      <div class="actions sticky">
        <button type="button" onClick={() => void save()}>
          {doneLabel ?? 'Save profile'}
        </button>
        {status.kind !== 'idle' ? <span class={`status status-${status.kind}`}>{status.message}</span> : null}
      </div>
    </div>
  );
};
