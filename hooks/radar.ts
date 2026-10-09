import type { RadarConfig, RadarFilter, RadarItem, RadarKind, RadarSeverity, RadarSort } from '../types'

export const FLAG_TOOL_NAME = 'flag_issue'
export const FLAG_TOOL = `mcp__cockpit__${FLAG_TOOL_NAME}`

const MAX_TITLE = 90
const MAX_DETAIL = 400
// the most items a project keeps; the oldest closed ones go first
const MAX_ITEMS = 200

export const KINDS: readonly RadarKind[] = ['bug', 'risk', 'inconsistency', 'debt', 'note']
export const SEVERITIES: readonly RadarSeverity[] = ['high', 'medium', 'low']

export const KIND_GLYPH: Record<RadarKind, string> = {
  bug: '✗',
  risk: '⚠',
  inconsistency: '≠',
  debt: '◇',
  note: '•',
}

export const KIND_LABEL: Record<RadarKind, string> = {
  bug: 'bug',
  risk: 'risk',
  inconsistency: 'inconsistency',
  debt: 'tech debt',
  note: 'note',
}

export const RADAR_FILTERS: readonly { value: RadarFilter; label: string }[] = [
  { value: 'open', label: 'open' },
  { value: 'closed', label: 'closed' },
  { value: 'all', label: 'all' },
]

export const RADAR_SORTS: readonly { value: RadarSort; label: string }[] = [
  { value: 'severity', label: 'severity' },
  { value: 'newest', label: 'newest' },
]

export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  enabled: true,
  autoFlag: true,
  toast: true,
  details: true,
  files: true,
  badge: true,
  filter: 'open',
  sort: 'severity',
}

// a stored config, missing fields filled in and a choice outside the options reset
export function loadRadarConfig(raw: unknown): RadarConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_RADAR_CONFIG
  const c = { ...DEFAULT_RADAR_CONFIG, ...(raw as Partial<RadarConfig>) }
  return {
    ...c,
    filter: RADAR_FILTERS.some(f => f.value === c.filter) ? c.filter : DEFAULT_RADAR_CONFIG.filter,
    sort: RADAR_SORTS.some(s => s.value === c.sort) ? c.sort : DEFAULT_RADAR_CONFIG.sort,
  }
}

// the store key a project's list is kept under
export const radarKey = (projectDir: string) => `radar:${projectDir}`

const oneLine = (text: unknown, max: number) => {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const pick = <T extends string>(raw: unknown, options: readonly T[], fallback: T): T =>
  options.includes(raw as T) ? (raw as T) : fallback

// a stored list, items that do not parse dropped
export function loadRadarItems(raw: unknown): RadarItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(r => {
    if (!r || typeof r !== 'object') return []
    const i = r as Partial<RadarItem>
    if (typeof i.id !== 'string' || typeof i.title !== 'string' || i.title.trim() === '') return []
    return [
      {
        id: i.id,
        title: i.title,
        detail: typeof i.detail === 'string' ? i.detail : '',
        kind: pick(i.kind, KINDS, 'note'),
        severity: pick(i.severity, SEVERITIES, 'medium'),
        file: typeof i.file === 'string' && i.file !== '' ? i.file : null,
        inScope: i.inScope === true,
        status: pick(i.status, ['open', 'done', 'dismissed'] as const, 'open'),
        source: i.source === 'me' ? 'me' : 'claude',
        createdAt: typeof i.createdAt === 'number' ? i.createdAt : 0,
        closedAt: typeof i.closedAt === 'number' ? i.closedAt : null,
      },
    ]
  })
}

export type FlagInput = {
  title?: unknown
  detail?: unknown
  kind?: unknown
  severity?: unknown
  file?: unknown
  in_scope?: unknown
}

// a finding added to the list; one with the title of an item still open updates that item
export function addFlag(
  items: readonly RadarItem[],
  input: FlagInput,
  source: 'claude' | 'me',
  id: string,
  now: number,
): { items: RadarItem[]; item: RadarItem | null; isNew: boolean } {
  const title = oneLine(input.title, MAX_TITLE)
  if (title === '') return { items: [...items], item: null, isNew: false }
  const fields = {
    title,
    detail: oneLine(input.detail, MAX_DETAIL),
    kind: pick(input.kind, KINDS, 'note'),
    severity: pick(input.severity, SEVERITIES, 'medium'),
    file: typeof input.file === 'string' && input.file.trim() !== '' ? input.file.trim() : null,
    inScope: input.in_scope === true,
  }
  const same = items.find(i => i.status === 'open' && i.title.toLowerCase() === title.toLowerCase())
  if (same) {
    const merged: RadarItem = { ...same, ...fields, detail: fields.detail || same.detail, file: fields.file ?? same.file }
    return { items: items.map(i => (i.id === same.id ? merged : i)), item: merged, isNew: false }
  }
  const item: RadarItem = { id, ...fields, status: 'open', source, createdAt: now, closedAt: null }
  return { items: trim([...items, item]), item, isNew: true }
}

// over the cap, the oldest closed items go first, then the oldest open ones
function trim(items: RadarItem[]): RadarItem[] {
  if (items.length <= MAX_ITEMS) return items
  const byAge = [...items].sort((a, b) => (a.status === 'open' ? 1 : 0) - (b.status === 'open' ? 1 : 0) || a.createdAt - b.createdAt)
  const drop = new Set(byAge.slice(0, items.length - MAX_ITEMS).map(i => i.id))
  return items.filter(i => !drop.has(i.id))
}

const SEVERITY_RANK: Record<RadarSeverity, number> = { high: 0, medium: 1, low: 2 }

// the items the pane lists: the filter applied, open ones before closed, then the chosen order
export function shownItems(items: readonly RadarItem[], filter: RadarFilter, sort: RadarSort): RadarItem[] {
  const kept = items.filter(i => (filter === 'all' ? true : filter === 'open' ? i.status === 'open' : i.status !== 'open'))
  return kept.sort(
    (a, b) =>
      (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
      (sort === 'severity' ? SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] : 0) ||
      b.createdAt - a.createdAt,
  )
}

export const openCounts = (items: readonly RadarItem[]) => {
  const open = items.filter(i => i.status === 'open')
  return {
    total: open.length,
    high: open.filter(i => i.severity === 'high').length,
    medium: open.filter(i => i.severity === 'medium').length,
    low: open.filter(i => i.severity === 'low').length,
  }
}

// what "fix" puts in the prompt box, for the person to send or add to
export const fixPrompt = (i: RadarItem) =>
  `Fix this ${KIND_LABEL[i.kind]} from the radar: ${i.title}${i.detail ? ` — ${i.detail}` : ''}${i.file ? ` (${i.file})` : ''}`

export const FLAG_TOOL_DESCRIPTION =
  'Flag something you noticed for the person\'s radar, a to-do list kept across sessions: a bug, risk, inconsistency or tech debt outside the task, or inside it but worth their attention. One call per finding; it does not stop your work.'

export const FLAG_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What is wrong, in one short plain sentence (under 90 characters).' },
    detail: { type: 'string', description: 'Why it matters and where, in one or two sentences.' },
    kind: { type: 'string', enum: [...KINDS], description: 'bug, risk, inconsistency, debt or note.' },
    severity: { type: 'string', enum: [...SEVERITIES], description: 'high: breaks or endangers something; medium: should be fixed; low: worth knowing.' },
    file: { type: 'string', description: 'The file it is in, relative to the project, with :line when known. Optional.' },
    in_scope: { type: 'boolean', description: 'true when it belongs to the current task but you are not fixing it now.' },
  },
  required: ['title', 'kind', 'severity'],
} as const

export const RADAR_GUIDE = `# Radar is on

The person keeps a radar: a to-do list of things noticed along the way. While you work, when you notice a flaw, bug, risk, inconsistency or tech debt that is outside the task (or inside it but worth flagging), call \`${FLAG_TOOL}\` once per finding, then carry on with the task.

- Flag only what is real and worth the person's time; never flag what you fix in this same turn.
- Do not fix a flagged item unasked, and do not stop the task to discuss it.
- Write the title in one short plain sentence; put the why and where in the detail and the file.`
