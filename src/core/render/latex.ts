/**
 * `TailoringPlan` + `Profile` -> `.tex`.
 *
 * The plan supplies selection and ordering only. Every character of real text is
 * joined here from the profile: dates, employers, titles, contact details and the
 * role notes never passed through a model and are not reachable from
 * one (invariants #2 and #3).
 *
 * @see docs/architecture.md §4, §10 — AI_RULES.md invariants 2, 3, 7
 */

import { AppError } from '../types/errors';
import type {
  Bullet,
  DateRange,
  Education,
  Experience,
  ItemId,
  Profile,
  Project,
  SkillGroup,
  YearMonth,
} from '../types/profile';
import type { PlannedSection, TailoringPlan } from '../types/tailoring';

/** Markers the template must expose. Documented in `templates/faangpath-simple.tex`. */
export const MARKERS = ['NAME', 'CONTACT', 'SUMMARY', 'EDUCATION', 'EXPERIENCE', 'PROJECTS', 'SKILLS'] as const;

const MARKER_PATTERN = /<<<([A-Z_]+)>>>/g;

/**
 * Characters LaTeX would otherwise read as syntax.
 *
 * Applied in a single regex pass, deliberately: a sequential replace chain would
 * re-escape the braces and backslashes of its own replacements. "AT&T", "99%",
 * "C#" and `C:\Users\me` all have to survive verbatim.
 */
const LATEX_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['\\', '\\textbackslash{}'],
  ['~', '\\textasciitilde{}'],
  ['^', '\\textasciicircum{}'],
  ['&', '\\&'],
  ['%', '\\%'],
  ['$', '\\$'],
  ['#', '\\#'],
  ['_', '\\_'],
  ['{', '\\{'],
  ['}', '\\}'],
]);

export const escapeLatex = (text: string): string =>
  text.replace(/[\\~^&%$#_{}]/g, (c) => LATEX_ESCAPES.get(c) ?? c);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A malformed date renders as written rather than throwing — the schema guards the shape. */
const formatMonth = (ym: YearMonth): string => {
  if (ym === 'present') return 'Present';
  const [year, month] = ym.split('-');
  const name = MONTHS[Number(month) - 1];
  return year !== undefined && name !== undefined ? `${name} ${year}` : ym;
};

const formatRange = (dates: DateRange): string => `${formatMonth(dates.start)} -- ${formatMonth(dates.end)}`;

/** The text a bullet renders as: its rewrite if one survived validation, else the user's own words. */
export const resolvedBulletText = (bullet: Bullet, rewrites: ReadonlyMap<ItemId, string>): string =>
  rewrites.get(bullet.id) ?? bullet.text;

const rewriteMap = (plan: TailoringPlan): ReadonlyMap<ItemId, string> =>
  new Map(plan.rewrites.map((r) => [r.id, r.text]));

/**
 * The experience IDs that will be rendered, in render order.
 *
 * Invariant #3: a plan cannot drop a role carrying a user note. An omitted one
 * is reinserted where the profile puts it relative to the roles the plan did keep,
 * so the section stays chronologically readable. Exported because `validate/fit.ts`
 * must measure the same document the renderer produces.
 */
export const experienceRenderOrder = (plan: TailoringPlan, profile: Profile): readonly ItemId[] => {
  const known = new Set(profile.experience.map((r) => r.id));
  const ordered = plan.experience.map((s) => s.id).filter((id) => known.has(id));

  profile.experience.forEach((role, index) => {
    if (role.note === undefined || ordered.includes(role.id)) return;
    const precedingIds = profile.experience.slice(0, index).map((r) => r.id);
    const anchor = Math.max(-1, ...precedingIds.map((id) => ordered.indexOf(id)));
    ordered.splice(anchor + 1, 0, role.id);
  });

  return ordered;
};

const bulletList = (
  bullets: readonly Bullet[],
  bulletIds: readonly ItemId[],
  rewrites: ReadonlyMap<ItemId, string>,
): string => {
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const items = bulletIds
    .map((id) => byId.get(id))
    .filter((b): b is Bullet => b !== undefined)
    .map((b) => `  \\item ${escapeLatex(resolvedBulletText(b, rewrites))}`);
  return items.length === 0 ? '' : `\\begin{itemize}\n${items.join('\n')}\n\\end{itemize}\n`;
};

const section = (heading: string, body: string): string =>
  body.trim().length === 0 ? '' : `\\section{${heading}}\n${body}\n`;

const educationEntry = (e: Education): string => {
  const right = [e.location, formatRange(e.dates)].filter((v): v is string => v !== undefined).map(escapeLatex);
  // Parts are escaped before joining so the separator stays LaTeX, not user text.
  const grade = e.grade === undefined ? undefined : escapeLatex(e.grade);
  const degree = [`${escapeLatex(e.degree)}, ${escapeLatex(e.field)}`, grade]
    .filter((v): v is string => v !== undefined)
    .join(' --- ');
  return (
    `\\textbf{${escapeLatex(e.institution)}} \\hfill ${right.join(', ')}\\\\\n` +
    `\\textit{${degree}}\n\n\\vspace{2pt}\n`
  );
};

const experienceEntry = (
  role: Experience,
  bulletIds: readonly ItemId[],
  rewrites: ReadonlyMap<ItemId, string>,
): string => {
  const right = [role.location, formatRange(role.dates)].filter((v): v is string => v !== undefined).map(escapeLatex);
  // The user's own words, verbatim, never routed through a model. See D-024.
  const note = role.note === undefined ? '' : `\\textit{\\small ${escapeLatex(role.note)}}\n\n\\vspace{2pt}\n`;
  return (
    `\\textbf{${escapeLatex(role.company)}} \\hfill ${right.join(', ')}\\\\\n` +
    `\\textit{${escapeLatex(role.title)}}\n\n\\vspace{2pt}\n` +
    note +
    bulletList(role.bullets, bulletIds, rewrites) +
    '\\vspace{4pt}\n'
  );
};

const projectEntry = (
  project: Project,
  bulletIds: readonly ItemId[],
  rewrites: ReadonlyMap<ItemId, string>,
): string => {
  const stack = project.stack?.length ? ` \\textit{${project.stack.map(escapeLatex).join(' $\\cdot$ ')}}` : '';
  const right = project.dates === undefined ? '' : ` \\hfill ${escapeLatex(formatRange(project.dates))}`;
  const name = project.url === undefined
    ? `\\textbf{${escapeLatex(project.name)}}`
    : `\\href{${escapeLatex(project.url)}}{\\textbf{${escapeLatex(project.name)}}}`;
  return `${name}${stack}${right}\n\n\\vspace{2pt}\n${bulletList(project.bullets, bulletIds, rewrites)}\\vspace{4pt}\n`;
};

/**
 * Skill names the plan chose, rendered in the profile's own spelling.
 *
 * The plan may reorder and drop skills for space; it may not introduce one, so
 * anything it names that the group does not contain is discarded (invariant #2).
 */
const skillsFor = (group: SkillGroup, planned: readonly string[]): readonly string[] => {
  const bySpelling = new Map(group.skills.map((s) => [s.toLowerCase(), s]));
  const chosen = planned.map((s) => bySpelling.get(s.toLowerCase())).filter((s): s is string => s !== undefined);
  return chosen.length === 0 ? group.skills : chosen;
};

const orderedSections = <T extends { readonly id: ItemId }>(
  planned: readonly PlannedSection[],
  items: readonly T[],
): readonly (readonly [T, readonly ItemId[]])[] => {
  const byId = new Map(items.map((i) => [i.id, i]));
  return planned
    .map((p) => [byId.get(p.id), p.bulletIds] as const)
    .filter((pair): pair is readonly [T, readonly ItemId[]] => pair[0] !== undefined);
};

const contactLine = (profile: Profile): string => {
  const c = profile.contact;
  const parts = [c.email, c.phone, c.location, c.linkedin, c.github, c.website].filter(
    (v): v is string => v !== undefined && v.length > 0,
  );
  return parts.map(escapeLatex).join(' $|$ ');
};

/**
 * Renders a validated plan against a template string.
 *
 * The template arrives as a parameter because `src/core/` does no file I/O — the
 * caller loads it, which is also what makes this testable in Node.
 *
 * @throws {AppError} `RENDER_FAILED` when the template is missing or has unknown
 * markers. Never half-renders: the substitution happens or nothing does.
 */
export const renderLatex = (plan: TailoringPlan, profile: Profile, template: string): string => {
  const rewrites = rewriteMap(plan);

  const educationById = new Map(profile.education.map((e) => [e.id, e]));
  const education = plan.educationIds
    .map((id) => educationById.get(id))
    .filter((e): e is Education => e !== undefined)
    .map(educationEntry)
    .join('');

  const roleById = new Map(profile.experience.map((r) => [r.id, r]));
  const plannedBullets = new Map(plan.experience.map((s) => [s.id, s.bulletIds]));
  const experience = experienceRenderOrder(plan, profile)
    .map((id) => roleById.get(id))
    .filter((r): r is Experience => r !== undefined)
    .map((role) => experienceEntry(role, plannedBullets.get(role.id) ?? [], rewrites))
    .join('');

  const projects = orderedSections(plan.projects, profile.projects)
    .map(([project, bulletIds]) => projectEntry(project, bulletIds, rewrites))
    .join('');

  const skills = orderedSections(
    plan.skills.map((s) => ({ id: s.id, bulletIds: [] })),
    profile.skills,
  )
    .map(([group]) => {
      const planned = plan.skills.find((s) => s.id === group.id)?.skills ?? [];
      const names = skillsFor(group, planned).map(escapeLatex).join(', ');
      return `\\textbf{${escapeLatex(group.label)}}: ${names}\\\\\n`;
    })
    .join('');

  // A summary only exists if the user wrote one; the model may reword it, not add it.
  const summaryText = profile.summary === undefined ? undefined : (plan.summary ?? profile.summary);

  const values = new Map<string, string>([
    ['NAME', escapeLatex(profile.contact.fullName)],
    ['CONTACT', contactLine(profile)],
    ['SUMMARY', summaryText === undefined ? '' : section('Summary', `${escapeLatex(summaryText)}\n`)],
    ['EDUCATION', section('Education', education)],
    ['EXPERIENCE', section('Experience', experience)],
    ['PROJECTS', section('Projects', projects)],
    ['SKILLS', section('Skills', skills)],
  ]);

  const found = new Set(Array.from(template.matchAll(MARKER_PATTERN), (m) => m[1] ?? ''));
  const broken = [
    ...MARKERS.filter((m) => !found.has(m)),
    ...Array.from(found).filter((m) => !values.has(m)),
  ];
  if (broken.length > 0) {
    throw new AppError('RENDER_FAILED', { context: { badMarkers: broken.join(',') } });
  }

  return template.replace(MARKER_PATTERN, (whole, name: string) => values.get(name) ?? whole);
};
