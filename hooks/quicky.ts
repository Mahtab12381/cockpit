import type { QuickCommand, QuickPreset, QuickPresets, QuickyShow } from '../types'

// how many the "most used" view lists
export const TOP_COUNT = 10

export const QUICKY_SHOWS: readonly { value: QuickyShow; label: string }[] = [
  { value: 'mine', label: 'mine' },
  { value: 'top', label: 'most used' },
  { value: 'all', label: 'all' },
]

export type QuickUsage = Record<string, number>

// a stored usage map, anything that is not a count dropped
export const loadUsage = (raw: unknown): QuickUsage => {
  if (!raw || typeof raw !== 'object') return {}
  const out: QuickUsage = {}
  for (const [name, n] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[name] = Math.floor(n)
  }
  return out
}

// most used first; never-used and ties A to Z
export const rankQuick = (
  commands: readonly { name: string; description: string; source: string; isMine?: boolean }[],
  usage: QuickUsage,
): QuickCommand[] =>
  commands
    .map(c => ({
      name: c.name,
      description: c.description,
      source: c.source,
      isMine: c.isMine ?? false,
      uses: usage[c.name] ?? 0,
    }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))

// the names a commands folder (name.md) and a skills folder (name/) define
export const commandNames = (entries: readonly { name: string; kind: string }[]) =>
  entries.filter(e => e.kind === 'file' && e.name.endsWith('.md')).map(e => e.name.slice(0, -3))

export const skillNames = (entries: readonly { name: string; kind: string }[]) =>
  // `synced` holds the skills an organization pushes to everyone, not the person's own
  entries.filter(e => e.kind !== 'file' && e.name !== 'synced').map(e => e.name)

// the ranked list cut to the chosen view
export const pickQuick = (ranked: readonly QuickCommand[], show: QuickyShow): QuickCommand[] =>
  show === 'mine'
    ? ranked.filter(c => c.isMine)
    : show === 'top'
      ? ranked.filter(c => c.uses > 0).slice(0, TOP_COUNT)
      : [...ranked]

// how a slash command run is recorded in a transcript: a message whose content opens with the
// command's name (a built-in), or with its message line, an escaped newline (".n": a backslash
// and an n, spelled so grep and JS agree), then its name (a skill). The same tags quoted inside a
// tool's output sit behind escaped quotes, so they never match. One source for git grep -E and
// for the in-module count.
export const COMMAND_RUN_SOURCE =
  '"content":"(<command-message>[^<]*</command-message>.n)?<command-name>/([A-Za-z0-9:_-]+)</command-name>'
const COMMAND_RUN = new RegExp(COMMAND_RUN_SOURCE, 'g')

// runs per command in transcript text (or in grep's matched lines)
export const countCommandRuns = (text: string, into: QuickUsage = {}): QuickUsage => {
  for (const m of text.matchAll(COMMAND_RUN)) {
    const name = m[2]!
    into[name] = (into[name] ?? 0) + 1
  }
  return into
}

// a command's name as plain words: "jira-create-and-log" → "Jira create and log"; a plugin's
// namespace ("engineering:debug") is returned apart, to show quietly beside it
export const quickTitle = (name: string): { title: string; namespace: string | null } => {
  const at = name.lastIndexOf(':')
  const base = at < 0 ? name : name.slice(at + 1)
  const words = base.replace(/[-_]+/g, ' ').trim()
  return {
    title: words ? words[0]!.toUpperCase() + words.slice(1) : name,
    namespace: at < 0 ? null : name.slice(0, at),
  }
}

// a fixed parameter saved under a command: run it in one press. needsValue: it still holds a
// placeholder (P1794-XXX, <ticket>), so it can only go into the prompt to be filled in

const PLACEHOLDER = /X{3,}|<[^>]+>|\{[^}]+\}|\[[^\]]+\]|\.{3}|…/

export const needsValue = (args: string) => PLACEHOLDER.test(args)

export const MAX_DETECTED = 6

// a stored preset map, anything malformed dropped
export const loadPresets = (raw: unknown): QuickPresets => {
  if (!raw || typeof raw !== 'object') return {}
  const out: QuickPresets = {}
  for (const [name, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const ok = list.filter(
      (p): p is QuickPreset => !!p && typeof p === 'object' && typeof (p as QuickPreset).args === 'string',
    )
    if (ok.length) {
      out[name] = ok.map(p => ({
        label: typeof p.label === 'string' && p.label.trim() ? p.label : p.args,
        args: p.args,
        needsValue: needsValue(p.args),
        source: p.source === 'detected' ? 'detected' : 'mine',
      }))
    }
  }
  return out
}

// the presets a model suggested: the first JSON array in its answer, of {label, args}
export const parseDetected = (text: string): QuickPreset[] => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let items: unknown
  try {
    items = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: QuickPreset[] = []
  for (const it of items) {
    const args = typeof it?.args === 'string' ? it.args.trim() : ''
    if (!args || seen.has(args)) continue
    seen.add(args)
    const label = typeof it?.label === 'string' && it.label.trim() ? it.label.trim() : args
    out.push({ label, args, needsValue: needsValue(args), source: 'detected' })
    if (out.length >= MAX_DETECTED) break
  }
  return out
}

// new presets after the old, one per argument string
export const mergePresets = (old: readonly QuickPreset[], added: readonly QuickPreset[]): QuickPreset[] => {
  const have = new Set(old.map(p => p.args))
  return [...old, ...added.filter(p => !have.has(p.args))]
}

// how much of a command's file the detection reads
const DETECT_FILE_CHARS = 12_000

export const DETECT_SYSTEM = 'You list the arguments a Claude Code slash command accepts. Answer with JSON only.'

// the question put to a small model to find a command's kinds of argument
export const detectPrompt = (name: string, description: string, file: string | null) =>
  [
    `Command: /${name}`,
    `Description: ${description}`,
    file ? `Command file:\n${file.slice(0, DETECT_FILE_CHARS)}` : 'No command file was found.',
    '',
    `List the distinct kinds of argument this command accepts, as up to ${MAX_DETECTED} argument strings a user could pass after the command name.`,
    'Give exact text for options that need no value (for example "my changes").',
    'Use a placeholder such as P1794-XXX or <description> where a real value must be filled in.',
    'Answer with only a JSON array of objects {"label": a short plain-English name, "args": the argument string}.',
  ].join('\n')
