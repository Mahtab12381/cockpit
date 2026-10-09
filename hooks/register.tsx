import { atom, read, update } from 'claude-code'
import type { Args, EngineInterface, On, Register, RenderChildren, RenderInput, Timer } from 'claude-code'

import {
  PLAN_TOOL,
  PROGRESS_TOOL,
  ALWAYS_ALLOWED,
  MAX_NAME,
  METER_WIDTHS,
  loadMeterWidth,
  FRAME_MS,
  COLLAPSE_MS,
  FAILURES_BEFORE_STUCK,
  PLACEHOLDERS,
  DEFAULT_TITLE,
  NEEDS_OK,
  HAS_QUESTION,
  WAITING_REPLY,
  SAID_NO,
  KEEPS_FAILING,
  REFUSED,
  GUIDE,
  CODE_FILE,
  cleanName,
  formatDuration,
  clampPercent,
  sameName,
  newChecklist,
  ensureActive,
  applyProgress,
  planTasks,
  uniqueNames,
  apiErrorSentence,
  USER_SAID_NO,
  INTERRUPTED,
  argOf,
  resumed,
  fromTodos,
  addTask,
  updateTask,
  filledMeter,
  sweepMeter,
} from './clean-view'
import type { ApiFailure } from './clean-view'
import { AURORA, DEFAULT_THEME, HEAT, MINT, SUNSET, THEME, THEMES, THEME_NAMES, applyTheme, gradient, isThemeName, usageColor } from './theme'
import { BAR_GLYPH, BAR_HEIGHTS, bar, loadBarHeight, toView } from './view'
import type { Figures } from './view'
import {
  DEFAULT_CONVERSATIONS_CONFIG,
  MAX_LISTED,
  MAX_READ,
  STATUS_LABEL,
  ago,
  cleanTitle,
  configDirOf,
  fit,
  loadConversationsConfig,
  nextMax,
  parseTranscript,
  projectDirName,
  statusOf,
} from './conversations'
import type { ConversationNote } from './conversations'
import {
  COMMAND_RUN_SOURCE,
  QUICKY_SHOWS,
  commandNames,
  DETECT_SYSTEM,
  countCommandRuns,
  detectPrompt,
  loadPresets,
  mergePresets,
  needsValue,
  parseDetected,
  pickQuick,
  quickTitle,
  rankQuick,
  skillNames,
} from './quicky'
import type { QuickUsage } from './quicky'
import {
  DEFAULT_DIFF_CONFIG,
  applyStep,
  cursorStep,
  loadDiffConfig,
  makeStep,
  pendingCount,
  shortPath,
  unified,
} from './diff'
import {
  DEFAULT_RADAR_CONFIG,
  FLAG_TOOL,
  FLAG_TOOL_DESCRIPTION,
  FLAG_TOOL_NAME,
  FLAG_TOOL_SCHEMA,
  KIND_GLYPH,
  KIND_LABEL,
  RADAR_FILTERS,
  RADAR_GUIDE,
  RADAR_SORTS,
  addFlag,
  fixPrompt,
  loadRadarConfig,
  loadRadarItems,
  openCounts,
  radarKey,
  shownItems,
} from './radar'
import type { FlagInput } from './radar'
import type {
  BarWidth,
  BarHeight,
  CleanViewChecklist,
  ConversationRow,
  ConversationStatus,
  ConversationsConfig,
  DiffConfig,
  DiffStep,
  DiffStepStatus,
  EffortPick,
  LimitMeter,
  ModelPick,
  PanelView,
  QuickCommand,
  QuickPreset,
  QuickPresets,
  QuickyConfig,
  RadarConfig,
  RadarItem,
  RadarSeverity,
  RadarStatus,
  StatusConfig,
  ThemeName,
} from '../types'

const view = atom({ plugin: 'cockpit', key: 'view' } as const, null)

const statusLine = atom({ plugin: 'cockpit', key: 'statusLine' } as const, true)

const DEFAULT_CONFIG: StatusConfig = {
  model: true,
  context: true,
  fiveHour: true,
  reset: true,
  weekly: true,
  weeklyReset: true,
  bars: true,
  barWidth: 5,
  barHeight: 'thin',
}
const statusConfig = atom({ plugin: 'cockpit', key: 'statusConfig' } as const, DEFAULT_CONFIG)
const CONFIG_KEY = 'statusConfig'
const BAR_WIDTHS: readonly BarWidth[] = [5, 10, 15]

const SETTINGS_PANE = 'cockpit-settings'
const STORE_KEY = 'statusLine'

const MINUTE = 60_000

type AbovePromptEvent = Extract<RenderInput, { component: 'AbovePrompt' }>
type Engine = EngineInterface
type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text']
type BoxElement = ReturnType<EngineInterface['ui']['resolve']>['Box']

// one Text per character, each a step along the gradient
function gradientText(Text: TextElement, key: string, text: string, stops: readonly string[] = AURORA, bold = true) {
  const chars = Array.from(text)
  const colors = gradient(chars.length, stops)
  return (
    <Text key={key} bold={bold} wrap="truncate-end">
      {chars.map((ch, i) => (
        <Text key={`${key}-${i}`} color={colors[i]}>
          {ch}
        </Text>
      ))}
    </Text>
  )
}

// the picked option as a filled violet chip
function capsule(Box: BoxElement, Text: TextElement, key: string, label: string) {
  return (
    <Box key={key} flexShrink={0}>
      <Text color={THEME.chipText} backgroundColor={THEME.chip} bold>
        {` ${label} `}
      </Text>
    </Box>
  )
}

// the checklist's default: 3/4 high, so meters on stacked rows keep a gap between them
const DEFAULT_METER_HEIGHT: BarHeight = 'tall'

// a bar height setting's button: a sample cell and the name, cycled by a press
const heightLabel = (h: BarHeight) => `◂ ${BAR_GLYPH[h]} ${h} ▸`
const nextHeight = (h: BarHeight) => BAR_HEIGHTS[(BAR_HEIGHTS.indexOf(h) + 1) % BAR_HEIGHTS.length] ?? h

// a checklist meter: full cells glow along the gradient, empty ones stay a dark track;
// every cell is drawn with the chosen height's glyph
function meterText(Text: TextElement, key: string, cells: string, glyph: string) {
  const colors = gradient(cells.length, AURORA)
  return (
    <Text key={key}>
      {Array.from(cells).map((cell, i) => (
        <Text key={`${key}-${i}`} color={cell === '█' ? colors[i] : THEME.track}>
          {glyph}
        </Text>
      ))}
    </Text>
  )
}
type Checklist = CleanViewChecklist
type TurnCompleteEvent = Args<'turn.complete'>

const effort = atom({ plugin: 'cockpit', key: 'effort' } as const, 'auto' as EffortPick)
// the effort the session itself asked for on its last request, before any override
const sessionEffort = atom({ plugin: 'cockpit', key: 'sessionEffort' } as const, null)
// this session's model pick; null keeps the session's own model
const modelPick = atom({ plugin: 'cockpit', key: 'modelPick' } as const, null as ModelPick | null)
// the model dropdown above the status line
const modelMenu = atom({ plugin: 'cockpit', key: 'modelMenu' } as const, false)
// the gradient theme; its colors are swapped into theme.ts and every drawing reads it
const themeAtom = atom({ plugin: 'cockpit', key: 'theme' } as const, DEFAULT_THEME as ThemeName)
const THEME_KEY = 'theme'
// the settings, open in the band above the input
const settingsOpen = atom({ plugin: 'cockpit', key: 'settingsOpen' } as const, false)
const MODEL_IDS: Record<ModelPick, { id: string; name: string }> = {
  opus: { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  haiku: { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
  fable: { id: 'claude-fable-5-1', name: 'Fable 5.1' },
}
const EFFORT_KEY = 'effort'
const MODELS: readonly ModelPick[] = ['opus', 'sonnet', 'haiku', 'fable']
const EFFORTS: readonly EffortPick[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

let figures: Figures | undefined

async function refresh($: EngineInterface) {
  figures ??= await $.session.usage()
  const pick = await read($, modelPick)
  const next = toView(pick ? MODEL_IDS[pick].name : await $.session.model(), figures, await $.clock.now())
  await update($, view, () => next)
}

// opens the built-in /model picker, then redraws with whatever was chosen
async function setSettingsOpen($: EngineInterface, isOpen: boolean) {
  await update($, settingsOpen, () => isOpen)
}

async function toggleModelMenu($: EngineInterface) {
  await update($, modelMenu, isOpen => !isOpen)
}

async function pickFromMenu($: EngineInterface, model: ModelPick) {
  await update($, modelMenu, () => false)
  await pickModel($, model)
}

// /model <alias> does not switch here, so the pick is applied to each main-loop request instead
async function pickModel($: EngineInterface, model: ModelPick) {
  await update($, modelPick, () => model)
  await refresh($).catch(() => undefined)
}

async function pickTheme($: EngineInterface, name: ThemeName) {
  applyTheme(name)
  await update($, themeAtom, () => name)
  await $.store.set(THEME_KEY, name)
}

async function pickEffort($: EngineInterface, level: EffortPick) {
  await update($, effort, () => level)
  await $.store.set(EFFORT_KEY, level)
}

const isModel = (current: string, model: ModelPick) => current.toLowerCase().includes(model)

async function setStatusLine($: EngineInterface, isOn: boolean) {
  await update($, statusLine, () => isOn)
  await $.store.set(STORE_KEY, isOn)
  if (!isOn) $.ui.status(undefined)
}

// ── Conversations: every transcript of this project, listed in a docked pane ──

// 1.6.x opened conversations in a pane of its own; closed on sight so no tab strip is left behind
const LEGACY_CONVERSATIONS_PANE = 'cockpit-conversations'
// settings and conversations share one docked pane (SETTINGS_PANE), so the dock never shows tabs
const panelView = atom({ plugin: 'cockpit', key: 'panelView' } as const, 'settings' as PanelView)
// null until the pane is first opened, so nothing is read before the person asks
const conversations = atom({ plugin: 'cockpit', key: 'conversations' } as const, null as ConversationRow[] | null)
const STATUS_DOT: Record<ConversationStatus, string> = {
  working: '#F59E0B',
  waiting: '#F97316',
  idle: '#34D399',
  stopped: '#F43F5E',
  closed: '#6B7280',
}
// titles read from transcripts, by file name and mtime, so a refresh rereads only what changed
const titleCache = new Map<string, { mtimeMs: number; title: string | null; hasPrompt: boolean }>()

async function conversationDirs($: Engine) {
  const config = configDirOf({
    configDir: await $.env.get('CLAUDE_CONFIG_DIR'),
    home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')),
  })
  if (config === null) return null
  return {
    transcripts: `${config}/projects/${projectDirName(await $.session.root())}`,
    // each session writes its own status here, so sessions never overwrite one another
    notes: `${config}/cockpit/conversations`,
  }
}

// 2.0 renamed the mod from usage-status. The first time cockpit starts it brings over the
// old store (settings, presets, panel view: the host keeps it in a file named after the
// plugin) and the old conversation notes; a key cockpit already holds is never overwritten
const MIGRATED_KEY = 'migratedFromUsageStatus'
const OLD_NAME = 'usage-status'

async function migrateFromUsageStatus($: Engine) {
  if ((await $.store.get(MIGRATED_KEY).catch(() => undefined)) === true) return
  const config = configDirOf({
    configDir: await $.env.get('CLAUDE_CONFIG_DIR'),
    home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')),
  })
  if (config === null) return
  try {
    const storeDir = `${config}/plugins/store`
    const oldStore = (await $.fs.list(storeDir).catch(() => [])).find(
      f => f.kind === 'file' && f.name.startsWith(`${OLD_NAME}_`) && f.name.endsWith('.json'),
    )
    if (oldStore) {
      const saved = JSON.parse(await $.fs.read(`${storeDir}/${oldStore.name}`)) as Record<string, unknown>
      for (const [key, value] of Object.entries(saved)) {
        if ((await $.store.get(key)) === undefined) await $.store.set(key, value)
      }
    }
    const oldNotes = `${config}/${OLD_NAME}/conversations`
    const newNotes = `${config}/cockpit/conversations`
    for (const f of await $.fs.list(oldNotes).catch(() => [])) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      if (await $.fs.exists(`${newNotes}/${f.name}`)) continue
      await $.fs.write(`${newNotes}/${f.name}`, await $.fs.read(`${oldNotes}/${f.name}`))
    }
    await $.store.set(MIGRATED_KEY, true)
  } catch {
    // tried again next start; the mod runs on its defaults meanwhile
  }
}

async function readNote($: Engine, notesDir: string, id: string): Promise<ConversationNote | null> {
  try {
    const note = JSON.parse(await $.fs.read(`${notesDir}/${id}.json`)) as ConversationNote
    return typeof note?.status === 'string' ? note : null
  } catch {
    return null
  }
}

// this session's own status, for the dot other sessions' lists show
async function noteConversation($: Engine, status: ConversationStatus, prompt?: string) {
  try {
    const dirs = await conversationDirs($)
    if (dirs === null) return
    const id = await $.session.id()
    const old = await readNote($, dirs.notes, id)
    const title = old?.title ?? (prompt && !prompt.startsWith('/') ? cleanTitle(prompt) : null)
    const note: ConversationNote = { status, title, updatedAt: await $.clock.now() }
    await $.fs.write(`${dirs.notes}/${id}.json`, JSON.stringify(note))
    if ((await read($, conversations)) !== null) await loadConversations($)
  } catch {
    // the list just shows an older status
  }
}

async function transcriptTitle($: Engine, path: string, mtimeMs: number, size: number) {
  const cached = titleCache.get(path)
  if (cached?.mtimeMs === mtimeMs) return cached
  // too big for one read: the title comes from the session's own note instead
  const parsed =
    size > MAX_READ
      ? { title: null, hasPrompt: true }
      : await $.fs.read(path).then(parseTranscript, () => ({ title: null, hasPrompt: true }))
  const entry = { mtimeMs, ...parsed }
  titleCache.set(path, entry)
  return entry
}

// a switch in flight, kept in the module (it outlives the swap's fresh $.state): until the
// session id has moved, a list read mid-swap still marks the picked conversation, so the
// rows never flip back to the old one. id null: a new conversation, its id not known yet
let pendingSwap: { id: string | null; before: string; until: number } | null = null
const SWAP_TIMEOUT_MS = 5000
// the last list drawn, shown while a swap's fresh state reloads it (no flash of "Loading…")
let lastRows: ConversationRow[] | null = null

async function currentConversationId($: Engine, now: number): Promise<string | null> {
  const id = await $.session.id()
  const swap = pendingSwap
  if (swap === null) return id
  const isDone = swap.id === null ? id !== swap.before : id === swap.id
  if (isDone || now > swap.until) {
    pendingSwap = null
    return id
  }
  return swap.id
}

async function setConversations($: Engine, rows: ConversationRow[]) {
  lastRows = rows
  await update($, conversations, () => rows)
}

async function loadConversations($: Engine) {
  const dirs = await conversationDirs($)
  const now = await $.clock.now()
  const currentId = await currentConversationId($, now)
  const entries = dirs === null ? [] : await $.fs.list(dirs.transcripts).catch(() => [])
  const files = entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_LISTED)
  const rows: ConversationRow[] = []
  for (const f of files) {
    const id = f.name.slice(0, -'.jsonl'.length)
    const isCurrent = id === currentId
    const parsed = await transcriptTitle($, `${dirs!.transcripts}/${f.name}`, f.mtimeMs, f.size)
    const note = await readNote($, dirs!.notes, id)
    // a session that never ran a prompt can't be resumed, so it isn't listed
    if (!parsed.hasPrompt && note === null && !isCurrent) continue
    rows.push({
      id,
      title: parsed.title ?? note?.title ?? 'Untitled conversation',
      status: isCurrent && note === null ? 'idle' : statusOf(note, now),
      updatedAt: Math.max(f.mtimeMs, note?.updatedAt ?? 0),
      isCurrent,
    })
  }
  if (currentId !== null && !rows.some(r => r.isCurrent)) {
    const note = dirs === null ? null : await readNote($, dirs.notes, currentId)
    const status = statusOf(note, now)
    rows.unshift({
      id: currentId,
      title: note?.title ?? 'New conversation',
      status: status === 'closed' ? 'idle' : status,
      updatedAt: now,
      isCurrent: true,
    })
  }
  await setConversations($, rows)
}

// the conversations pane's options, from its card in the settings pane
const CONVERSATIONS_CONFIG_KEY = 'conversationsConfig'
const conversationsConfig = atom(
  { plugin: 'cockpit', key: 'conversationsConfig' } as const,
  DEFAULT_CONVERSATIONS_CONFIG,
)

// the store is the truth (a session swap resets $.state); the atom is read so a change redraws
async function readConversationsConfig($: Engine): Promise<ConversationsConfig> {
  await read($, conversationsConfig)
  return loadConversationsConfig(await $.store.get(CONVERSATIONS_CONFIG_KEY).catch(() => undefined))
}

async function setConversationsConfig($: Engine, patch: Partial<ConversationsConfig>) {
  const next = { ...(await readConversationsConfig($)), ...patch }
  await $.store.set(CONVERSATIONS_CONFIG_KEY, next)
  await update($, conversationsConfig, () => next)
  // the footer and the pane read the store; the atom may already hold this value
  $.ui.invalidate('ui.render')
}

// kept across sessions: /resume and /clear start another session, whose state starts over
const PANEL_VIEW_KEY = 'panelView'

// /resume and /clear swap the session without a session.start, and its $.state starts over:
// the store is the truth; the atom is read too so a press redraws the pane
async function currentPanelView($: Engine): Promise<PanelView> {
  const fromState = await read($, panelView)
  const saved = await $.store.get(PANEL_VIEW_KEY).catch(() => undefined)
  const views: readonly PanelView[] = ['conversations', 'settings', 'quicky', 'diff', 'radar']
  return views.includes(saved as PanelView) ? (saved as PanelView) : fromState
}

// a list emptied by a session swap reloads itself the first time the pane draws it
let isLoadingConversations = false
function ensureConversations($: Engine) {
  if (isLoadingConversations) return
  isLoadingConversations = true
  void loadConversations($)
    .catch(() => update($, conversations, () => []))
    .finally(() => (isLoadingConversations = false))
}

const PANEL_TITLES: Record<PanelView, string> = {
  settings: 'Settings',
  quicky: 'Quicky',
  conversations: 'Conversations',
  diff: 'Changes',
  radar: 'Radar',
}

// one docked pane shows either view; opening the open pane again only retitles it
async function openPanel($: Engine, view: PanelView) {
  await $.ui.close({ id: LEGACY_CONVERSATIONS_PANE }).catch(() => undefined)
  // the store first: the redraw the atom write sets off reads it
  await $.store.set(PANEL_VIEW_KEY, view)
  await update($, panelView, () => view)
  // the atom may already hold this view (a session swap reset it), so redraw regardless
  $.ui.invalidate('ui.render')
  const title = PANEL_TITLES[view]
  await $.ui.open({ id: SETTINGS_PANE, title, focus: true, closeOnEscape: true })
}

// ── Quicky: the person's own skills and commands, each run with one click ──

const QUICKY_CONFIG_KEY = 'quickyConfig'
const DEFAULT_QUICKY_CONFIG: QuickyConfig = {
  enabled: true,
  descriptions: true,
  show: 'mine',
  counts: true,
  presets: true,
  detect: true,
  presetsOpen: false,
}
const quickyConfig = atom({ plugin: 'cockpit', key: 'quickyConfig' } as const, DEFAULT_QUICKY_CONFIG)
const quickCommands = atom({ plugin: 'cockpit', key: 'quickCommands' } as const, null as QuickCommand[] | null)
// the last list, shown while a session swap's fresh state reloads it
let lastQuickCommands: QuickCommand[] | null = null
let isLoadingQuick = false

// the store is the truth (a session swap resets $.state); the atom is read so a change redraws
async function readQuickyConfig($: Engine): Promise<QuickyConfig> {
  await read($, quickyConfig)
  const raw = await $.store.get(QUICKY_CONFIG_KEY).catch(() => undefined)
  if (!raw || typeof raw !== 'object') return DEFAULT_QUICKY_CONFIG
  const c = { ...DEFAULT_QUICKY_CONFIG, ...(raw as Partial<QuickyConfig>) }
  return QUICKY_SHOWS.some(s => s.value === c.show) ? c : { ...c, show: DEFAULT_QUICKY_CONFIG.show }
}

async function setQuickyConfig($: Engine, patch: Partial<QuickyConfig>) {
  const next = { ...(await readQuickyConfig($)), ...patch }
  await $.store.set(QUICKY_CONFIG_KEY, next)
  await update($, quickyConfig, () => next)
  $.ui.invalidate('ui.render')
}

// the names of the person's own commands and skills: the files in this project's .claude
// folder and in their own; the engine calls synced organization skills `user` too
async function ownCommandNames($: Engine): Promise<Set<string>> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const config = configDirOf({ configDir: await $.env.get('CLAUDE_CONFIG_DIR'), home })
  const roots = [`${await $.session.root()}/.claude`, ...(config ? [config] : [])]
  const names = new Set<string>()
  for (const root of roots) {
    const commands = await $.fs.list(`${root}/commands`).catch(() => [])
    const skills = await $.fs.list(`${root}/skills`).catch(() => [])
    for (const n of [...commandNames(commands), ...skillNames(skills)]) names.add(n)
  }
  return names
}

// every slash command, most used first; the pane cuts it to the chosen view
async function loadQuickCommands($: Engine) {
  const all = await $.command.list().catch(() => [])
  const own = await ownCommandNames($).catch(() => new Set<string>())
  const usage = await transcriptUsage($).catch(() => ({}) as QuickUsage)
  const mine = rankQuick(
    all.map(c => ({ ...c, isMine: c.source === 'user' && own.has(c.name) })),
    usage,
  )
  lastQuickCommands = mine
  await update($, quickCommands, () => mine)
}

function ensureQuickCommands($: Engine) {
  if (isLoadingQuick) return
  isLoadingQuick = true
  void loadQuickCommands($)
    .catch(() => update($, quickCommands, () => []))
    .finally(() => (isLoadingQuick = false))
}

async function openQuicky($: Engine) {
  await openPanel($, 'quicky')
  // reread on every open, so a skill added since (and /reload-skills) shows up
  await loadQuickCommands($).catch(() => update($, quickCommands, () => []))
}

// one more run of a command; the list re-ranks
// every /command this project's transcripts record, typed or pressed, whatever their size:
// git grep reads files of any size (git is always on hand); without it, each file under
// the 4 MiB a read allows is counted here
async function transcriptUsage($: Engine): Promise<QuickUsage> {
  const dirs = await conversationDirs($)
  if (dirs === null) return {}
  // the same pattern the in-module count uses, so both read a run alike
  const pattern = COMMAND_RUN_SOURCE
  const grep = await $.process
    .run(['git', 'grep', '--no-index', '-o', '-h', '-E', pattern, '--', ':(glob)*.jsonl'], {
      cwd: dirs.transcripts,
      timeoutMs: 15_000,
    })
    .catch(() => null)
  // 0: matches, 1: none
  if (grep && (grep.exitCode === 0 || grep.exitCode === 1)) return countCommandRuns(grep.stdout)
  const usage: QuickUsage = {}
  const files = await $.fs.list(dirs.transcripts).catch(() => [])
  for (const f of files) {
    if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.size > MAX_READ) continue
    const text = await $.fs.read(`${dirs.transcripts}/${f.name}`).catch(() => '')
    countCommandRuns(text, usage)
  }
  return usage
}

// one more run of a command, before a transcript count can see it: the list re-ranks
async function recordQuickUse($: Engine, name: string) {
  const rows = (await read($, quickCommands)) ?? lastQuickCommands
  if (rows) {
    const usage = Object.fromEntries(rows.map(r => [r.name, r.uses]))
    usage[name] = (usage[name] ?? 0) + 1
    const ranked = rankQuick(rows, usage)
    lastQuickCommands = ranked
    await update($, quickCommands, () => ranked)
  }
}

// ── Quicky presets: fixed parameters saved under a command, typed or detected ──

const QUICK_PRESETS_KEY = 'quickPresets'
const quickPresets = atom({ plugin: 'cockpit', key: 'quickPresets' } as const, {} as QuickPresets)
// the one command whose presets are open in the pane, and the one being detected
const quickExpanded = atom({ plugin: 'cockpit', key: 'quickExpanded' } as const, null as string | null)
const quickDetecting = atom({ plugin: 'cockpit', key: 'quickDetecting' } as const, null as string | null)
// with presets open by default: the commands closed by hand since
const quickCollapsed = atom({ plugin: 'cockpit', key: 'quickCollapsed' } as const, [] as string[])

// the store is the truth (a session swap resets $.state); the atom is read so a change redraws
async function readPresets($: Engine): Promise<QuickPresets> {
  await read($, quickPresets)
  return loadPresets(await $.store.get(QUICK_PRESETS_KEY).catch(() => undefined))
}

async function writePresets($: Engine, name: string, list: QuickPreset[]) {
  const all = await readPresets($)
  const next = { ...all, [name]: list }
  if (list.length === 0) delete next[name]
  await $.store.set(QUICK_PRESETS_KEY, next)
  await update($, quickPresets, () => next)
  $.ui.invalidate('ui.render')
}

async function savePreset($: Engine, name: string, args: string) {
  const text = args.trim()
  if (!text) return
  const list = (await readPresets($))[name] ?? []
  const preset: QuickPreset = { label: text, args: text, needsValue: needsValue(text), source: 'mine' }
  await writePresets($, name, mergePresets(list, [preset]))
}

async function deletePreset($: Engine, name: string, args: string) {
  const list = (await readPresets($))[name] ?? []
  await writePresets($, name, list.filter(p => p.args !== args))
}

// whether a command's presets show: open by default (when set, for one that has presets) unless
// closed by hand, else only the one opened by hand
function isPresetsOpen(
  name: string,
  cfg: QuickyConfig,
  presets: QuickPresets,
  expanded: string | null,
  collapsed: readonly string[],
) {
  const isByDefault = cfg.presetsOpen && (presets[name]?.length ?? 0) > 0
  return isByDefault ? !collapsed.includes(name) : expanded === name
}

async function toggleExpanded($: Engine, name: string) {
  const cfg = await readQuickyConfig($)
  const hasPresets = ((await readPresets($))[name]?.length ?? 0) > 0
  if (cfg.presetsOpen && hasPresets) {
    await update($, quickCollapsed, list => (list.includes(name) ? list.filter(n => n !== name) : [...list, name]))
    return
  }
  await update($, quickExpanded, open => (open === name ? null : name))
}

// a command's own file (this project's .claude first, then the person's own folder)
async function commandFile($: Engine, name: string): Promise<string | null> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const config = configDirOf({ configDir: await $.env.get('CLAUDE_CONFIG_DIR'), home })
  const roots = [`${await $.session.root()}/.claude`, ...(config ? [config] : [])]
  for (const root of roots) {
    for (const path of [`${root}/commands/${name}.md`, `${root}/skills/${name}/SKILL.md`]) {
      const text = await $.fs.read(path).catch(() => null)
      if (typeof text === 'string') return text
    }
  }
  return null
}

// asks a small model which kinds of argument the command takes, from its file; the answers
// join the command's presets, marked detected
async function detectPresets($: Engine, name: string, description: string) {
  if ((await read($, quickDetecting)) !== null) return
  await update($, quickDetecting, () => name)
  try {
    const file = await commandFile($, name)
    const answer = await $.model.complete({
      model: 'haiku',
      maxTokens: 800,
      system: DETECT_SYSTEM,
      prompt: detectPrompt(name, description, file),
    })
    const found = answer.isAnswered ? parseDetected(answer.text) : []
    if (found.length === 0) {
      $.ui.toast(`No options detected for ${quickTitle(name).title}`)
    } else {
      const list = (await readPresets($))[name] ?? []
      const merged = mergePresets(list, found)
      await writePresets($, name, merged)
      $.ui.toast(`${merged.length - list.length} option(s) added to ${quickTitle(name).title}`)
    }
  } catch {
    $.ui.toast('Could not detect options right now')
  } finally {
    await update($, quickDetecting, () => null)
  }
}

// puts the command in the prompt box, a space after it, for the person to add instructions
// and send; the pane opens again without the keys, so typing lands in the box
async function addQuick($: Engine, name: string, args = '') {
  const filled = await $.prompt.fill({ text: `/${name} ${args}`.trimEnd() + ' ', mode: 'replace' }).catch(() => null)
  if (filled && !filled.isFilled) {
    $.ui.toast(`Could not fill the prompt now; type /${name} yourself`)
    return
  }
  await $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
  await $.ui.open({ id: SETTINGS_PANE, title: 'Quicky', closeOnEscape: true }).catch(() => undefined)
}

async function runQuick($: Engine, name: string, args = '') {
  try {
    // this plugin's own $.command.run skips its command.run hook, so count it here
    await recordQuickUse($, name)
    await $.command.run({ command: name, args })
  } catch {
    $.ui.toast(`Could not run /${name} now — try again once the current turn finishes`)
  }
}



async function openSettings($: Engine) {
  await openPanel($, 'settings')
}

async function openConversations($: Engine) {
  await openPanel($, 'conversations')
  await loadConversations($).catch(() => update($, conversations, () => []))
}

// the session id lags the swap a little, so a list read mid-swap marks the old conversation:
// wait (briefly) for the id to settle, then read the list again
const SWAP_POLL_MS = 150
const SWAP_POLLS = 20

async function reloadAfterSwap($: Engine, isSwapped: (id: string) => boolean) {
  for (let i = 0; i < SWAP_POLLS; i++) {
    if (isSwapped(await $.session.id().catch(() => ''))) break
    await $.clock.sleep(SWAP_POLL_MS)
  }
  await loadConversations($).catch(() => undefined)
}

async function switchConversation($: Engine, id: string) {
  pendingSwap = { id, before: await $.session.id().catch(() => ''), until: (await $.clock.now()) + SWAP_TIMEOUT_MS }
  // mark the picked conversation at once; the reload confirms it
  const rows = (await read($, conversations)) ?? lastRows
  if (rows) await setConversations($, rows.map(r => ({ ...r, isCurrent: r.id === id })))
  try {
    await $.command.run({ command: 'resume', args: id })
  } catch {
    $.ui.toast('Could not switch now — try again once the current turn finishes')
  }
  await reloadAfterSwap($, current => current === id)
}

async function newConversation($: Engine) {
  const before = await $.session.id().catch(() => '')
  pendingSwap = { id: null, before, until: (await $.clock.now()) + SWAP_TIMEOUT_MS }
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Could not start a new conversation now — try again once the current turn finishes')
  }
  await reloadAfterSwap($, current => current !== '' && current !== before)
}

// ── Changes: every file edit Claude makes, one step each, accepted or undone in order ──

const DIFF_CONFIG_KEY = 'diffConfig'
const diffConfig = atom({ plugin: 'cockpit', key: 'diffConfig' } as const, DEFAULT_DIFF_CONFIG)
// this conversation's steps, oldest first; a session swap starts a fresh list
const diffSteps = atom({ plugin: 'cockpit', key: 'diffSteps' } as const, [] as DiffStep[])
// the step the pane shows; null follows the first one still to review
const diffCursor = atom({ plugin: 'cockpit', key: 'diffCursor' } as const, null as number | null)

// the store is the truth (a session swap resets $.state); the atom is read so a change redraws
async function readDiffConfig($: Engine): Promise<DiffConfig> {
  await read($, diffConfig)
  return loadDiffConfig(await $.store.get(DIFF_CONFIG_KEY).catch(() => undefined))
}

async function setDiffConfig($: Engine, patch: Partial<DiffConfig>) {
  const next = { ...(await readDiffConfig($)), ...patch }
  await $.store.set(DIFF_CONFIG_KEY, next)
  await update($, diffConfig, () => next)
  $.ui.invalidate('ui.render')
}

async function openChanges($: Engine) {
  await openPanel($, 'diff')
}

// a file tool's call, read around: the file before and after, kept as a step when it changed
async function recordFileTool($: Engine, path: string, tool: string, before: string | null) {
  const after = await $.fs.read(path).catch(() => null)
  if (after === null) return
  const at = await $.clock.now()
  await update($, diffSteps, steps => {
    const step = makeStep((steps[steps.length - 1]?.id ?? 0) + 1, path, tool, at, before, after)
    return step === null ? steps : [...steps, step]
  })
}

// $.fs has no delete: the platform's own command, else the file is left empty
async function removeFile($: Engine, path: string) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows ? ['cmd', '/d', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')] : ['rm', '-f', '--', path]
  await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
  if (await $.fs.exists(path).catch(() => true)) {
    await $.fs.write(path, '')
    $.ui.toast(`Could not delete ${path}; it is left empty`)
  }
}

// takes a step back out of its file, or puts it back; false when the file changed over it since
async function applyToFile($: Engine, step: DiffStep, direction: 'undo' | 'redo'): Promise<boolean> {
  const isThere = await $.fs.exists(step.path).catch(() => false)
  const current = isThere ? await $.fs.read(step.path).catch(() => null) : ''
  if (current === null) return false
  const next = applyStep(current, step, direction)
  if (next === null) return false
  if (direction === 'undo' && step.isNew && next === '') {
    await removeFile($, step.path)
  } else {
    await $.fs.write(step.path, next)
  }
  return true
}

async function setStepStatus($: Engine, ids: readonly number[], status: DiffStepStatus) {
  await update($, diffSteps, steps => steps.map(s => (ids.includes(s.id) ? { ...s, status } : s)))
}

// after a step is decided the pane moves on to the next one still to review
async function advanceFrom($: Engine, id: number) {
  const steps = await read($, diffSteps)
  const at = steps.findIndex(s => s.id === id)
  const next = [...steps.slice(at + 1), ...steps.slice(0, at)].find(s => s.status === 'pending')
  await update($, diffCursor, () => next?.id ?? id)
}

async function acceptStep($: Engine, id: number) {
  await setStepStatus($, [id], 'accepted')
  await advanceFrom($, id)
}

async function undoStep($: Engine, id: number) {
  const step = (await read($, diffSteps)).find(s => s.id === id)
  if (!step || step.status === 'undone') return
  const root = await $.session.root().catch(() => '')
  if (!(await applyToFile($, step, 'undo'))) {
    $.ui.toast(`Step ${id}: ${shortPath(step.path, root)} changed since — undo the later steps on it first`)
    return
  }
  await setStepStatus($, [id], 'undone')
  await advanceFrom($, id)
}

async function redoStep($: Engine, id: number) {
  const step = (await read($, diffSteps)).find(s => s.id === id)
  if (!step || step.status !== 'undone') return
  const root = await $.session.root().catch(() => '')
  if (!(await applyToFile($, step, 'redo'))) {
    $.ui.toast(`Step ${id}: ${shortPath(step.path, root)} changed since — it cannot be put back`)
    return
  }
  await setStepStatus($, [id], 'pending')
}

async function acceptAll($: Engine) {
  const ids = (await read($, diffSteps)).filter(s => s.status === 'pending').map(s => s.id)
  await setStepStatus($, ids, 'accepted')
}

// newest first, so each step finds its file as it left it
async function undoAll($: Engine) {
  const pending = (await read($, diffSteps)).filter(s => s.status === 'pending').reverse()
  const undone: number[] = []
  for (const step of pending) {
    if (await applyToFile($, step, 'undo')) undone.push(step.id)
  }
  await setStepStatus($, undone, 'undone')
  const missed = pending.length - undone.length
  if (missed > 0) $.ui.toast(`${missed} step(s) could not be undone: their files changed since`)
}

async function clearReviewed($: Engine) {
  await update($, diffSteps, steps => steps.filter(s => s.status === 'pending'))
  await update($, diffCursor, () => null)
}

// the file is read before and after a file tool's call; a call that changed it is a step
async function trackFileTool<E extends { tool: string }, R extends { deny?: string; isError?: boolean }>(
  $: Engine,
  e: E,
  next: (e: E) => Promise<R>,
): Promise<R> {
  const path = argOf(e, 'file_path') ?? argOf(e, 'notebook_path')
  if (typeof path !== 'string' || !(await readDiffConfig($)).enabled) return next(e)
  const before = (await $.fs.exists(path).catch(() => false)) ? await $.fs.read(path).catch(() => undefined) : null
  const ran = await next(e)
  // a file too big to read is not tracked
  if (ran.deny !== undefined || ran.isError === true || before === undefined) return ran
  await recordFileTool($, path, String(e.tool), before).catch(() => undefined)
  return ran
}

function registerChanges(on: On): void {
  on('command.run', { command: 'changes' }, async $ => {
    if (!(await readDiffConfig($)).enabled) return { text: 'Changes is off; turn it on in ✦ settings.' }
    await openChanges($)
    return { text: '' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => trackFileTool($, e, next))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => trackFileTool($, e, next))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => trackFileTool($, e, next))
}

const STEP_MARK: Record<DiffStepStatus, string> = { pending: '●', accepted: '✓', undone: '↶' }
const STEP_COLOR = (s: DiffStepStatus) => (s === 'accepted' ? THEME.on : s === 'undone' ? HEAT[2] : AURORA[1])

// the changes pane: a summary with the all-at-once actions, then one step at a time (its diff,
// accept and undo, prev and next), then every step listed, a press jumping to it
async function renderChanges($: EngineInterface, e: Extract<RenderInput, { component: 'Pane' }>) {
  applyTheme(await read($, themeAtom))
  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const steps = await read($, diffSteps)
  const cfg = await readDiffConfig($)
  const cursor = await read($, diffCursor)
  const root = await $.session.root().catch(() => '')
  const now = await $.clock.now()
  const width = Math.max(8, e.props.bodyColumns - 4)
  const shown = cfg.hideReviewed ? steps.filter(s => s.status === 'pending') : steps
  const step = cursorStep(shown, cursor)
  const index = step === null ? -1 : shown.indexOf(step)
  const toReview = pendingCount(steps)
  const accepted = steps.filter(s => s.status === 'accepted').length
  const undone = steps.filter(s => s.status === 'undone').length
  const goTo = (id: number) => void update($, diffCursor, () => id)

  const action = (key: string, label: string, onPress: () => void, isQuiet = false) => (
    <Button key={key} label={label} plain dimColor={isQuiet} hover={{ color: AURORA[0], bold: true }} onPress={onPress} />
  )

  const stepCard = (s: DiffStep) => {
    const { text, hidden } = unified(s)
    const name = shortPath(s.path, root)
    return (
      <Box
        key={`step-card-${s.id}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={STEP_COLOR(s.status)}
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1} flexDirection="row">
            <Text color={STEP_COLOR(s.status)}>{`${STEP_MARK[s.status]} `}</Text>
            <Text bold color={AURORA[0]} wrap="truncate-end">
              {fit(name, width - 24)}
            </Text>
          </Box>
          <Box flexShrink={0} flexDirection="row">
            <Text color={THEME.faint}>{`${s.isNew ? 'new · ' : ''}${s.tool} · `}</Text>
            <Text color={THEME.on}>{`+${s.added}`}</Text>
            <Text color={HEAT[2]}>{` −${s.removed}`}</Text>
            <Text color={THEME.faint}>{` · ${ago(s.at, now)}`}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={2} marginTop={1}>
          {s.status === 'pending' ? action(`accept-${s.id}`, '✓ accept', () => void acceptStep($, s.id)) : null}
          {s.status !== 'undone' ? action(`undo-${s.id}`, '↶ undo', () => void undoStep($, s.id)) : null}
          {s.status === 'undone' ? action(`redo-${s.id}`, '↷ redo', () => void redoStep($, s.id)) : null}
          {s.status !== 'pending' ? <Text color={THEME.faint}>{s.status}</Text> : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Code key={`diff-${s.id}`} source={text} format="diff" path={s.path} wrap="truncate-end" />
          {hidden > 0 ? <Text color={THEME.faint}>{`… ${hidden} more line(s)`}</Text> : null}
        </Box>
      </Box>
    )
  }

  const listRow = (s: DiffStep) => {
    const isCurrent = s.id === step?.id
    const label = `${isCurrent ? '▸' : ' '} ${s.id}. ${fit(shortPath(s.path, root), width - 22)}`
    return (
      <Box key={`step-row-${s.id}`} flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1} flexDirection="row">
          <Text color={STEP_COLOR(s.status)}>{`${STEP_MARK[s.status]} `}</Text>
          {isCurrent ? (
            <Text bold color={AURORA[0]} wrap="truncate-end">
              {label}
            </Text>
          ) : (
            <Button
              key={`goto-${s.id}`}
              label={label}
              plain
              dimColor={s.status !== 'pending'}
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => goTo(s.id)}
            />
          )}
        </Box>
        <Text color={THEME.faint}>{`+${s.added} −${s.removed}`}</Text>
      </Box>
    )
  }

  const prev = index > 0 ? shown[index - 1] : undefined
  const next = index >= 0 && index < shown.length - 1 ? shown[index + 1] : undefined

  return (
    <Box key="changes" flexDirection="column" paddingX={2} paddingTop={0} paddingBottom={1} gap={1}>
      <Box flexDirection="column">
        {gradientText(Text, 'changes-title', '± CHANGES')}
        <Text color={THEME.faint}>{'━'.repeat(Math.min(34, width))}</Text>
      </Box>
      {steps.length === 0 ? (
        <Text color={THEME.muted}>No changes yet: each file edit Claude makes shows here as a step</Text>
      ) : (
        <Box key="changes-summary" flexDirection="column">
          <Text color={THEME.muted}>
            <Text color={AURORA[1]} bold>{`${toReview} to review`}</Text>
            {` · ${accepted} accepted · ${undone} undone`}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {toReview > 0 ? action('accept-all', '✓ accept all', () => void acceptAll($)) : null}
            {toReview > 0 ? action('undo-all', '↶ undo all', () => void undoAll($)) : null}
            {accepted + undone > 0
              ? action('clear-reviewed', 'clear reviewed', () => void clearReviewed($), true)
              : null}
          </Box>
        </Box>
      )}
      {step === null ? (
        steps.length > 0 ? <Text color={THEME.muted}>Every step is reviewed</Text> : null
      ) : (
        <Box key="changes-step" flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            {prev ? action('step-prev', '◂ prev', () => goTo(prev.id)) : <Text color={THEME.faint}>◂ prev</Text>}
            <Text color={THEME.muted}>{`step ${index + 1} of ${shown.length}`}</Text>
            {next ? action('step-next', 'next ▸', () => goTo(next.id)) : <Text color={THEME.faint}>next ▸</Text>}
          </Box>
          {stepCard(step)}
        </Box>
      )}
      {shown.length > 1 ? (
        <Box key="changes-list" flexDirection="column">
          {gradientText(Text, 'changes-list-title', '◆ ALL STEPS')}
          {shown.map(listRow)}
        </Box>
      ) : null}
      <Text color={THEME.faint}>accept keeps a step · undo takes it out of the file · esc close</Text>
    </Box>
  )
}

// ── Radar: flaws, risks and inconsistencies spotted along the way, a to-do list per project ──

const RADAR_CONFIG_KEY = 'radarConfig'
const radarConfig = atom({ plugin: 'cockpit', key: 'radarConfig' } as const, DEFAULT_RADAR_CONFIG)
// read so a write redraws; the store, one list per project, is the truth
const radarItems = atom({ plugin: 'cockpit', key: 'radarItems' } as const, null as RadarItem[] | null)
// writes one after another, so findings flagged in parallel never overwrite each other
let radarQueue: Promise<unknown> = Promise.resolve()
let radarSeq = 0

async function readRadarConfig($: Engine): Promise<RadarConfig> {
  await read($, radarConfig)
  return loadRadarConfig(await $.store.get(RADAR_CONFIG_KEY).catch(() => undefined))
}

async function setRadarConfig($: Engine, patch: Partial<RadarConfig>) {
  const next = { ...(await readRadarConfig($)), ...patch }
  await $.store.set(RADAR_CONFIG_KEY, next)
  await update($, radarConfig, () => next)
  $.ui.invalidate('ui.render')
}

const radarStoreKey = async ($: Engine) => radarKey(projectDirName(await $.session.root()))

async function readRadarItems($: Engine): Promise<RadarItem[]> {
  await read($, radarItems)
  return loadRadarItems(await $.store.get(await radarStoreKey($)).catch(() => undefined))
}

async function changeRadar<T>($: Engine, fn: (items: RadarItem[], now: number) => { items: RadarItem[]; out: T }) {
  const run = radarQueue.then(async () => {
    const { items, out } = fn(await readRadarItems($), await $.clock.now())
    await $.store.set(await radarStoreKey($), items)
    await update($, radarItems, () => items)
    $.ui.invalidate('ui.render')
    return out
  })
  radarQueue = run.catch(() => undefined)
  return run
}

const newRadarId = (now: number) => `${now.toString(36)}-${(radarSeq++).toString(36)}`

async function flagRadar($: Engine, input: FlagInput, source: 'claude' | 'me') {
  return changeRadar($, (items, now) => {
    const added = addFlag(items, input, source, newRadarId(now), now)
    return { items: added.items, out: added }
  })
}

async function setRadarStatus($: Engine, id: string, status: RadarStatus) {
  await changeRadar($, (items, now) => ({
    items: items.map(i => (i.id === id ? { ...i, status, closedAt: status === 'open' ? null : now } : i)),
    out: null,
  }))
}

const NEXT_SEVERITY: Record<RadarSeverity, RadarSeverity> = { high: 'medium', medium: 'low', low: 'high' }

async function cycleRadarSeverity($: Engine, id: string) {
  await changeRadar($, items => ({
    items: items.map(i => (i.id === id ? { ...i, severity: NEXT_SEVERITY[i.severity] } : i)),
    out: null,
  }))
}

async function deleteRadarItem($: Engine, id: string) {
  await changeRadar($, items => ({ items: items.filter(i => i.id !== id), out: null }))
}

async function clearClosedRadar($: Engine) {
  await changeRadar($, items => ({ items: items.filter(i => i.status === 'open'), out: null }))
}

async function openRadar($: Engine) {
  await openPanel($, 'radar')
}

// puts a fix request in the prompt box to send or add to; the pane stays, without the keys
async function fixRadarItem($: Engine, item: RadarItem) {
  const filled = await $.prompt.fill({ text: fixPrompt(item), mode: 'replace' }).catch(() => null)
  if (filled && !filled.isFilled) {
    $.ui.toast('Could not fill the prompt now; try again once the current turn finishes')
    return
  }
  await $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
  await $.ui.open({ id: SETTINGS_PANE, title: PANEL_TITLES.radar, closeOnEscape: true }).catch(() => undefined)
}

function registerRadar(on: On): void {
  on('command.run', { command: 'radar' }, async ($, e) => {
    if (!(await readRadarConfig($)).enabled) return { text: 'Radar is off; turn it on in ✦ settings.' }
    const note = e.args.trim()
    if (note === '') {
      await openRadar($)
      return { text: '' }
    }
    const { item } = await flagRadar($, { title: note, kind: 'note', severity: 'medium' }, 'me')
    return { text: item ? `◎ On the radar: ${item.title}` : 'Nothing to add.' }
  })

  // Claude's findings: answered here, never passed on (the tool is this plugin's own)
  on('tool.call', { tool: FLAG_TOOL }, async ($, e) => {
    const cfg = await readRadarConfig($)
    if (!cfg.enabled || !cfg.autoFlag) return { result: 'The radar is off; nothing was flagged. Carry on with the task.' }
    const { item, isNew } = await flagRadar($, e as unknown as FlagInput, 'claude')
    if (item === null) return { result: 'Nothing flagged: give a short title.' }
    if (isNew && cfg.toast) $.ui.toast(`◎ Radar: ${item.title}`)
    return { result: isNew ? 'Flagged on the radar. Carry on with the task.' : 'Already on the radar; updated it. Carry on.' }
  })
}

const SEVERITY_COLOR = (s: RadarSeverity) => (s === 'high' ? THEME.danger : s === 'medium' ? THEME.warn : AURORA[0])

// the radar: a severity summary, the filter and sort, one card per item with its actions,
// then a field to note something yourself
async function renderRadar($: EngineInterface, e: Extract<RenderInput, { component: 'Pane' }>) {
  applyTheme(await read($, themeAtom))
  const table = $.ui.resolve(e)
  const { Box, Button, Text } = table
  // every surface but mobile draws a text field
  const Input = 'Input' in table ? table.Input : null
  const cfg = await readRadarConfig($)
  const items = await readRadarItems($)
  const counts = openCounts(items)
  const closed = items.length - counts.total
  const shown = shownItems(items, cfg.filter, cfg.sort)
  const now = await $.clock.now()
  const width = Math.max(12, e.props.bodyColumns - 4)

  const chip = (key: string, label: string, color: string | undefined) => (
    <Box key={key} flexShrink={0}>
      <Text color={THEME.chipText} backgroundColor={color} bold>
        {` ${label} `}
      </Text>
    </Box>
  )

  const choice = <T extends string>(group: string, options: readonly { value: T; label: string }[], picked: T, onPick: (v: T) => void) => (
    <Box key={`radar-${group}`} flexDirection="row" columnGap={1}>
      {options.map(o =>
        o.value === picked ? (
          <Box key={`radar-${group}-${o.value}`}>{capsule(Box, Text, `cap-radar-${group}-${o.value}`, o.label)}</Box>
        ) : (
          <Button
            key={`radar-${group}-${o.value}`}
            label={o.label}
            plain
            dimColor
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => onPick(o.value)}
          />
        ),
      )}
    </Box>
  )

  const card = (i: RadarItem) => {
    const isOpen = i.status === 'open'
    const color = SEVERITY_COLOR(i.severity)
    const meta = [
      KIND_LABEL[i.kind],
      i.inScope ? 'in this task' : null,
      ago(i.createdAt, now),
      i.source === 'me' ? 'yours' : null,
      isOpen ? null : i.status,
    ].filter(Boolean)
    return (
      <Box
        key={`radar-item-${i.id}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={isOpen ? color : THEME.borderOff}
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1} flexDirection="row">
            <Text color={isOpen ? color : THEME.off}>{`${KIND_GLYPH[i.kind]} `}</Text>
            <Text bold={isOpen} color={isOpen ? undefined : THEME.muted} strikethrough={i.status === 'done'} wrap="truncate-end">
              {fit(i.title, width - 16)}
            </Text>
          </Box>
          {isOpen ? (
            // a button label takes no color, so a colored dot beside it shows the severity
            <Box key={`radar-sev-box-${i.id}`} flexShrink={0} flexDirection="row">
              <Text color={color}>●</Text>
              <Button
                key={`radar-sev-${i.id}`}
                label={` ${i.severity} `}
                plain
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void cycleRadarSeverity($, i.id)}
              />
            </Box>
          ) : (
            chip(`radar-sev-${i.id}`, i.severity, THEME.borderOff)
          )}
        </Box>
        {cfg.details && i.detail ? (
          <Text color={THEME.muted} wrap="wrap">{`  ${i.detail}`}</Text>
        ) : null}
        {cfg.files && i.file ? (
          <Text color={AURORA[0]} wrap="truncate-end">{`  ↳ ${fit(i.file, width - 6)}`}</Text>
        ) : null}
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text color={THEME.faint} wrap="truncate-end">{`  ${meta.join(' · ')}`}</Text>
          <Box flexShrink={0} flexDirection="row" gap={2}>
            {isOpen ? (
              <Button
                key={`radar-fix-${i.id}`}
                label="→ fix"
                plain
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void fixRadarItem($, i)}
              />
            ) : null}
            {isOpen ? (
              <Button
                key={`radar-done-${i.id}`}
                label="✓ done"
                plain
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void setRadarStatus($, i.id, 'done')}
              />
            ) : null}
            {isOpen ? (
              <Button
                key={`radar-dismiss-${i.id}`}
                label="× dismiss"
                plain
                dimColor
                hover={{ color: THEME.danger, bold: true }}
                onPress={() => void setRadarStatus($, i.id, 'dismissed')}
              />
            ) : null}
            {isOpen ? null : (
              <Button
                key={`radar-reopen-${i.id}`}
                label="↺ reopen"
                plain
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void setRadarStatus($, i.id, 'open')}
              />
            )}
            {isOpen ? null : (
              <Button
                key={`radar-del-${i.id}`}
                label="del"
                plain
                dimColor
                hover={{ color: THEME.danger, bold: true }}
                onPress={() => void deleteRadarItem($, i.id)}
              />
            )}
          </Box>
        </Box>
      </Box>
    )
  }

  const empty =
    cfg.filter === 'closed'
      ? 'Nothing closed yet'
      : items.length > 0 && cfg.filter === 'open'
        ? 'All clear: every item is closed'
        : cfg.autoFlag
          ? 'Nothing on the radar yet. Claude flags what it notices while it works.'
          : 'Nothing on the radar yet. Add a note below.'

  return (
    <Box key="radar" flexDirection="column" paddingX={2} paddingTop={0} paddingBottom={1} gap={1}>
      <Box flexDirection="column">
        {gradientText(Text, 'radar-title', '◎ RADAR')}
        <Text color={THEME.muted} italic>
          flaws, risks and loose ends spotted along the way
        </Text>
        {gradientText(Text, 'radar-rule', '━'.repeat(Math.min(34, width)), AURORA, false)}
      </Box>
      <Box key="radar-summary" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
        {chip('radar-count-high', `${counts.high} high`, counts.high > 0 ? THEME.danger : THEME.borderOff)}
        {chip('radar-count-medium', `${counts.medium} medium`, counts.medium > 0 ? THEME.warn : THEME.borderOff)}
        {chip('radar-count-low', `${counts.low} low`, counts.low > 0 ? THEME.chip : THEME.borderOff)}
        <Text color={THEME.faint}>{`  ${counts.total} open · ${closed} closed`}</Text>
      </Box>
      <Box key="radar-controls" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Box flexDirection="row" columnGap={1}>
          <Text color={THEME.muted}>show</Text>
          {choice('filter', RADAR_FILTERS, cfg.filter, v => void setRadarConfig($, { filter: v }))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text color={THEME.muted}>sort</Text>
          {choice('sort', RADAR_SORTS, cfg.sort, v => void setRadarConfig($, { sort: v }))}
        </Box>
      </Box>
      {shown.length === 0 ? (
        <Box key="radar-empty" borderStyle="round" borderColor={THEME.borderOff} paddingX={1} justifyContent="center">
          <Text color={THEME.muted}>{empty}</Text>
        </Box>
      ) : (
        <Box key="radar-list" flexDirection="column">
          {shown.map(card)}
        </Box>
      )}
      {Input ? (
        <Input
          key="radar-add"
          label="+ "
          placeholder="note something yourself"
          submitLabel="add"
          onSubmit={(value: string) => void flagRadar($, { title: value, kind: 'note', severity: 'medium' }, 'me')}
        />
      ) : null}
      {closed > 0 ? (
        <Button
          key="radar-clear-closed"
          label={`clear ${closed} closed`}
          plain
          dimColor
          hover={{ color: THEME.danger, bold: true }}
          onPress={() => void clearClosedRadar($)}
        />
      ) : null}
      <Text color={THEME.faint}>fix: ask Claude · press the severity to change it · esc close</Text>
    </Box>
  )
}

async function setConfig($: EngineInterface, patch: Partial<StatusConfig>) {
  let saved: StatusConfig = DEFAULT_CONFIG
  await update($, statusConfig, c => (saved = { ...DEFAULT_CONFIG, ...c, ...patch }))
  await $.store.set(CONFIG_KEY, saved)
}

// stored config merged over the defaults, so options added later start at their default
function loadConfig(raw: unknown): StatusConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG
  const c = { ...DEFAULT_CONFIG, ...(raw as Partial<StatusConfig>) }
  return {
    ...c,
    barWidth: BAR_WIDTHS.includes(c.barWidth) ? c.barWidth : DEFAULT_CONFIG.barWidth,
    barHeight: loadBarHeight(c.barHeight, DEFAULT_CONFIG.barHeight),
  }
}

export const register: Register = on => {
  registerCleanView(on)
  registerChanges(on)
  registerRadar(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // before anything reads the store, so the settings it brings over are the ones used
    await migrateFromUsageStatus($)
    await startCleanView($)
    await $.command.register({ name: 'changes', description: "Step through Claude's file edits: accept or undo each" })
    await $.command.register({
      name: 'radar',
      description: 'Open the radar of flagged issues, or add one: /radar <what you noticed>',
      argumentHint: '[note]',
    })
    await $.tool.register({
      name: FLAG_TOOL_NAME,
      description: FLAG_TOOL_DESCRIPTION,
      inputSchema: FLAG_TOOL_SCHEMA,
      isDeferred: false,
    })
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved === 'boolean') await update($, statusLine, () => saved)
    const savedConfig = loadConfig(await $.store.get(CONFIG_KEY))
    await update($, statusConfig, () => savedConfig)
    const savedEffort = await $.store.get(EFFORT_KEY)
    if (EFFORTS.includes(savedEffort as EffortPick)) await update($, effort, () => savedEffort as EffortPick)
    const savedTheme = await $.store.get(THEME_KEY)
    const theme = isThemeName(savedTheme) ? savedTheme : DEFAULT_THEME
    applyTheme(theme)
    await update($, themeAtom, () => theme)
    figures = undefined
    $.ui.status(undefined)
    await refresh($)
    // keep the reset countdown fresh between turns
    $.clock.every(MINUTE, () => void refresh($).catch(() => undefined))
    // after /clear or a switch this is another conversation: mark it open, redraw an open list
    await noteConversation($, 'idle')
    return started
  })

  // a /command the person typed (or another plugin ran) counts toward Quicky's ranking;
  // Quicky's own runs are counted as they are pressed
  on('command.run', async ($, e, next) => {
    // a run raised without args (a bare call) passes on with the engine's empty default
    const ran = await next(typeof e.args === 'string' ? e : { ...e, args: '' })
    try {
      await recordQuickUse($, e.command)
    } catch {
      // the ranking just misses this run
    }
    return ran
  })

  on('session.end', async ($, e, next) => {
    await noteConversation($, 'closed')
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    figures = { context: e.context, rateLimits: e.rateLimits }
    await refresh($)
    return next(e)
  })

  // /model switches show up after the next turn
  on('turn.complete', async ($, e, next) => {
    await completeCleanView($, e)
    const done = await next(e)
    await refresh($)
    if (e.agentId === undefined) {
      await noteConversation($, e.reason === 'aborted' || e.reason === 'error' ? 'stopped' : 'idle')
    }
    return done
  })

  // the picked model and effort replace the session's on the main loop's requests;
  // subagents keep theirs, and a model without effort gets none
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const pick = await read($, modelPick)
    const model = pick ? MODEL_IDS[pick].id : e.model
    if (e.effort === undefined) return yield* next(model === e.model ? e : { ...e, model })
    const seen = String(e.effort)
    if ((await read($, sessionEffort)) !== seen) await update($, sessionEffort, () => seen)
    const level = await read($, effort)
    return yield* next({
      ...e,
      model,
      effort: level === 'auto' ? e.effort : level,
    })
  })

  // the model name and the dropdown's buttons never take the focus ring, so Claude Code
  // draws no white focus marker on them; a click still presses them
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOurs = e.plugin === 'cockpit' && e.element !== undefined
    if (isOurs && (e.element!.startsWith('switch-model') || e.element!.startsWith('menu-'))) {
      return {}
    }
    return next(e)
  })

  // settings button at the right of the footer's mode text (e.g. "auto mode on")
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const isConversationsOn = (await readConversationsConfig($)).enabled
    const isQuickyOn = (await readQuickyConfig($)).enabled
    const isChangesOn = (await readDiffConfig($)).enabled
    const toReview = pendingCount(await read($, diffSteps))
    const radarCfg = await readRadarConfig($)
    // the footer draws even when the project's list cannot be read
    const radarOpen =
      radarCfg.enabled && radarCfg.badge ? openCounts(await readRadarItems($).catch(() => [])).total : 0
    return (
      <Box key="footer" flexDirection="row" justifyContent="space-between" flexGrow={1}>
        <Text dimColor>{e.props.modes.join(' & ')}</Text>
        <Box flexDirection="row" gap={2}>
          {radarCfg.enabled ? (
            <Button
              key="open-radar"
              label={radarOpen > 0 ? `◎ radar (${radarOpen})` : '◎ radar'}
              plain
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => void openRadar($)}
            />
          ) : null}
          {isChangesOn ? (
            <Button
              key="open-changes"
              label={toReview > 0 ? `± changes (${toReview})` : '± changes'}
              plain
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => void openChanges($)}
            />
          ) : null}
          {isQuickyOn ? (
            <Button
              key="open-quicky"
              label="✶ quicky"
              plain
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => void openQuicky($)}
            />
          ) : null}
          {isConversationsOn ? (
            <Button
              key="open-conversations"
              label="✧ conversations"
              plain
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => void openConversations($)}
            />
          ) : null}
          <Button
            key="open-settings"
            label="✦ settings"
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void openSettings($)}
          />
        </Box>
      </Box>
    )
  })

  // one pane, three views; a view whose feature is off falls back to the settings
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const view = await currentPanelView($)
    if (view === 'conversations' && (await readConversationsConfig($)).enabled) return renderConversations($, e)
    if (view === 'quicky' && (await readQuickyConfig($)).enabled) return renderQuicky($, e)
    if (view === 'diff' && (await readDiffConfig($)).enabled) return renderChanges($, e)
    if (view === 'radar' && (await readRadarConfig($)).enabled) return renderRadar($, e)
    return renderSettings($, e, false)
  })

  on('ui.render', { component: 'Pane', requestId: LEGACY_CONVERSATIONS_PANE }, async ($, e) => renderConversations($, e))

  // one band above the prompt: Clean View's checklist, then the status line last, right above the input
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // read so a theme switch redraws the band; module colors reset on a reload, so reapply
    applyTheme(await read($, themeAtom))
    if (e.props.hasSurvey) {
      return next(e)
    }
    const status = await renderStatusLine($, e)
    const checklist = await renderCleanView($, e)
    const menu = status === null ? null : await renderModelMenu($, e)
    if (status === null && checklist === null) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return (
      <Box key="above-prompt" flexDirection="column">
        {checklist}
        {menu}
        {status === null ? null : (
          <Box key="status-line" marginTop={1}>
            {status}
          </Box>
        )}
      </Box>
    )
  })
}

// the settings: drawn in the band above the input (our own close button, our own padding),
// or in Claude Code's pane, whose frame draws its own close mark
async function renderSettings($: EngineInterface, e: RenderInput, inBand: boolean) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const isOn = await read($, statusLine)
  const isCleanViewOn = await read($, enabledAtom)
  const cfg = await read($, statusConfig)
  const meterWidth = await readMeterWidth($)
  const meterHeight = await readMeterHeight($)
  const convCfg = await readConversationsConfig($)
  const quickyCfg = await readQuickyConfig($)
  const diffCfg = await readDiffConfig($)
  const radarCfg = await readRadarConfig($)
  const effortPick = await read($, effort)
  const themePick = await read($, themeAtom)
  applyTheme(themePick)
  const seenEffort = await read($, sessionEffort)
  const pick = await read($, modelPick)
  const currentModel = pick
    ? MODEL_IDS[pick].name
    : ((await read($, view))?.model ?? (await $.session.model().catch(() => '')))
  const glow = (key: string, text: string, stops: readonly string[] = AURORA) => gradientText(Text, key, text, stops)

  // a segmented control: the picked option as a filled violet chip, the rest quiet buttons
  const segment = <T extends string>(
    group: string,
    label: string,
    options: readonly T[],
    isSelected: (o: T) => boolean,
    onPick: (o: T) => void,
  ) => (
    <Box key={`seg-${group}`} flexDirection="row" alignItems="center">
      <Box width={9} flexShrink={0}>
        <Text color={THEME.muted}>{label}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        {options.map(o =>
          isSelected(o) ? (
            <Box key={`${group}-${o}`}>{capsule(Box, Text, `cap-${group}-${o}`, `● ${o}`)}</Box>
          ) : (
            <Button
              key={`${group}-${o}`}
              label={`○ ${o}`}
              plain
              dimColor
              hover={{ color: AURORA[0], bold: true }}
              onPress={() => onPick(o)}
            />
          ),
        )}
      </Box>
    </Box>
  )

  // its own section: one line of gradient blocks, a radio before each; a button label takes one
  // color, so the radio is what you click and the block shows the theme
  const themePanel = (
    <Box key="theme-section" flexDirection="column">
      {glow('theme-title', '◆ THEME')}
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1} paddingLeft={2} marginTop={1}>
        {THEME_NAMES.map(t => (
          <Box key={`theme-cell-${t}`} flexDirection="row" alignItems="center">
            {t === themePick ? (
              <Box key={`theme-${t}`}>
                <Text color={THEMES[t].chip} bold>
                  {' ● '}
                </Text>
              </Box>
            ) : (
              <Button
                key={`theme-${t}`}
                // non-breaking spaces widen the click area around the dot
                label={' ○ '}
                plain
                dimColor
                hover={{ color: THEMES[t].primary[0], bold: true }}
                onPress={() => void pickTheme($, t)}
              />
            )}
            {gradientText(Text, `swatch-${t}`, '█'.repeat(7), THEMES[t].primary, false)}
          </Box>
        ))}
      </Box>
    </Box>
  )

  // always on, no toggle: a glowing heading over two segmented rows
  const modelEffortPanel = (
    <Box key="model-effort" flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        {glow('me-title', '◆ MODEL & EFFORT')}
        <Text color={THEME.muted}>{currentModel || '—'}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        {segment(
          'model',
          'model',
          MODELS,
          m => isModel(currentModel, m),
          m => void pickModel($, m),
        )}
        {segment(
          'effort',
          'effort',
          EFFORTS,
          l => l === effortPick,
          l => void pickEffort($, l),
        )}
        <Text color={THEME.faint} italic>
          {effortPick === 'auto'
            ? `↳ effort follows the session${seenEffort ? ` (${seenEffort})` : ''}`
            : `↳ ${effortPick} effort on every request`}
        </Text>
      </Box>
    </Box>
  )

  // a compact on/off row inside a card; dimmed when the option it depends on is off
  const subToggle = (key: keyof StatusConfig, label: string, value: boolean, isEnabled = true) => (
    <Box key={`sub-${key}`} flexDirection="row" justifyContent="space-between">
      <Text color={isEnabled ? undefined : THEME.faint}>
        <Text color={THEME.faint}>{'│ '}</Text>
        {label}
      </Text>
      <Button
        key={`cfg-${key}`}
        label={value ? '● on ' : '○ off'}
        plain
        dimColor={!(isEnabled && value)}
        hover={{ color: AURORA[0], bold: true }}
        onPress={() => void setConfig($, { [key]: !value })}
      />
    </Box>
  )

  const nextWidth = BAR_WIDTHS[(BAR_WIDTHS.indexOf(cfg.barWidth) + 1) % BAR_WIDTHS.length] ?? 5
  const statusOptions = (
    <Box key="status-options" flexDirection="column" marginTop={1}>
      {subToggle('model', 'Model name', cfg.model)}
      {subToggle('context', 'Context usage', cfg.context)}
      {subToggle('fiveHour', '5-hour limit', cfg.fiveHour)}
      {subToggle('reset', 'Reset time', cfg.reset, cfg.fiveHour)}
      {subToggle('weekly', 'Weekly limit', cfg.weekly)}
      {subToggle('weeklyReset', 'Weekly reset time', cfg.weeklyReset, cfg.weekly)}
      {subToggle('bars', 'Progress bars', cfg.bars, cfg.context || cfg.fiveHour || cfg.weekly)}
      <Box key="sub-barWidth" flexDirection="row" justifyContent="space-between">
        <Text color={cfg.bars ? undefined : THEME.faint}>
          <Text color={THEME.faint}>{'│ '}</Text>
          Bar width
        </Text>
        <Button
          key="cfg-barWidth"
          label={`◂ ${cfg.barWidth} ▸`}
          plain
          dimColor={!cfg.bars}
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void setConfig($, { barWidth: nextWidth })}
        />
      </Box>
      <Box key="sub-barHeight" flexDirection="row" justifyContent="space-between">
        <Text color={cfg.bars ? undefined : THEME.faint}>
          <Text color={THEME.faint}>{'│ '}</Text>
          Bar height
        </Text>
        <Button
          key="cfg-barHeight"
          label={heightLabel(cfg.barHeight)}
          plain
          dimColor={!cfg.bars}
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void setConfig($, { barHeight: nextHeight(cfg.barHeight) })}
        />
      </Box>
    </Box>
  )

  const nextMeterWidth = METER_WIDTHS[(METER_WIDTHS.indexOf(meterWidth as never) + 1) % METER_WIDTHS.length] ?? METER_WIDTHS[0]
  const cleanViewOptions = (
    <Box key="clean-view-options" flexDirection="column" marginTop={1}>
      <Box key="cv-sub-barHeight" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Bar height
        </Text>
        <Button
          key="cv-barHeight"
          label={heightLabel(meterHeight)}
          plain
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void setMeterHeight($, nextHeight(meterHeight))}
        />
      </Box>
      <Box key="cv-sub-barWidth" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Bar width
        </Text>
        <Button
          key="cv-barWidth"
          label={`◂ ${meterWidth} ▸`}
          plain
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void setMeterWidth($, nextMeterWidth)}
        />
      </Box>
    </Box>
  )

  // the conversations pane's options, built like the status line's rows
  const convToggle = (key: 'newButton' | 'dots' | 'legend' | 'age', label: string, isEnabled = true) => (
    <Box key={`conv-sub-${key}`} flexDirection="row" justifyContent="space-between">
      <Text color={isEnabled ? undefined : THEME.faint}>
        <Text color={THEME.faint}>{'│ '}</Text>
        {label}
      </Text>
      <Button
        key={`conv-${key}`}
        label={convCfg[key] ? '● on ' : '○ off'}
        plain
        dimColor={!(isEnabled && convCfg[key])}
        hover={{ color: AURORA[0], bold: true }}
        onPress={() => void setConversationsConfig($, { [key]: !convCfg[key] })}
      />
    </Box>
  )
  const conversationsOptions = (
    <Box key="conversations-options" flexDirection="column" marginTop={1}>
      {convToggle('newButton', 'New conversation button')}
      {convToggle('dots', 'Status dots')}
      {convToggle('legend', 'Status legend', convCfg.dots)}
      {convToggle('age', 'Last used time')}
      <Box key="conv-sub-maxCount" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Show up to
        </Text>
        <Button
          key="conv-maxCount"
          label={`◂ ${convCfg.maxCount} ▸`}
          plain
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void setConversationsConfig($, { maxCount: nextMax(convCfg.maxCount) })}
        />
      </Box>
    </Box>
  )

  // an on/off row of the Quicky card; dimmed when the option it depends on is off
  const quickyToggle = (
    key: 'descriptions' | 'counts' | 'presets' | 'detect' | 'presetsOpen',
    label: string,
    isEnabled = true,
  ) => (
    <Box key={`quicky-sub-${key}`} flexDirection="row" justifyContent="space-between">
      <Text color={isEnabled ? undefined : THEME.faint}>
        <Text color={THEME.faint}>{'│ '}</Text>
        {label}
      </Text>
      <Button
        key={`quicky-${key}`}
        label={quickyCfg[key] ? '● on ' : '○ off'}
        plain
        dimColor={!(isEnabled && quickyCfg[key])}
        hover={{ color: AURORA[0], bold: true }}
        onPress={() => void setQuickyConfig($, { [key]: !quickyCfg[key] })}
      />
    </Box>
  )

  const quickyOptions = (
    <Box key="quicky-options" flexDirection="column" marginTop={1}>
      {quickyToggle('descriptions', 'Descriptions')}
      {quickyToggle('counts', 'Usage counts')}
      {quickyToggle('presets', 'Presets')}
      {quickyToggle('detect', 'Detect options', quickyCfg.presets)}
      {quickyToggle('presetsOpen', 'Presets open by default', quickyCfg.presets)}
      <Box key="quicky-sub-show" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Show
        </Text>
        <Box flexDirection="row" columnGap={1}>
          {QUICKY_SHOWS.map(s =>
            s.value === quickyCfg.show ? (
              <Box key={`quicky-show-${s.value}`}>{capsule(Box, Text, `cap-quicky-${s.value}`, s.label)}</Box>
            ) : (
              <Button
                key={`quicky-show-${s.value}`}
                label={s.label}
                plain
                dimColor
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void setQuickyConfig($, { show: s.value })}
              />
            ),
          )}
        </Box>
      </Box>
    </Box>
  )

  // an on/off row of the Radar card; dimmed when the option it depends on is off
  const radarToggle = (key: 'autoFlag' | 'toast' | 'details' | 'files' | 'badge', label: string, isEnabled = true) => (
    <Box key={`radar-sub-${key}`} flexDirection="row" justifyContent="space-between">
      <Text color={isEnabled ? undefined : THEME.faint}>
        <Text color={THEME.faint}>{'│ '}</Text>
        {label}
      </Text>
      <Button
        key={`radar-cfg-${key}`}
        label={radarCfg[key] ? '● on ' : '○ off'}
        plain
        dimColor={!(isEnabled && radarCfg[key])}
        hover={{ color: AURORA[0], bold: true }}
        onPress={() => void setRadarConfig($, { [key]: !radarCfg[key] })}
      />
    </Box>
  )

  const radarOptions = (
    <Box key="radar-options" flexDirection="column" marginTop={1}>
      {radarToggle('autoFlag', 'Claude flags what it notices')}
      {radarToggle('toast', 'Notify on each new flag', radarCfg.autoFlag)}
      {radarToggle('details', 'Details')}
      {radarToggle('files', 'File paths')}
      {radarToggle('badge', 'Open count on the button')}
      <Box key="radar-sub-sort" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Sort by
        </Text>
        <Box flexDirection="row" columnGap={1}>
          {RADAR_SORTS.map(s =>
            s.value === radarCfg.sort ? (
              <Box key={`radar-sort-cfg-${s.value}`}>{capsule(Box, Text, `cap-radar-sort-cfg-${s.value}`, s.label)}</Box>
            ) : (
              <Button
                key={`radar-sort-cfg-${s.value}`}
                label={s.label}
                plain
                dimColor
                hover={{ color: AURORA[0], bold: true }}
                onPress={() => void setRadarConfig($, { sort: s.value })}
              />
            ),
          )}
        </Box>
      </Box>
    </Box>
  )

  const changesOptions = (
    <Box key="changes-options" flexDirection="column" marginTop={1}>
      <Box key="diff-sub-hideReviewed" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={THEME.faint}>{'│ '}</Text>
          Hide reviewed steps
        </Text>
        <Button
          key="diff-hideReviewed"
          label={diffCfg.hideReviewed ? '● on ' : '○ off'}
          plain
          dimColor={!diffCfg.hideReviewed}
          hover={{ color: AURORA[0], bold: true }}
          onPress={() => void setDiffConfig($, { hideReviewed: !diffCfg.hideReviewed })}
        />
      </Box>
    </Box>
  )

  // one card per mod: glowing title and colored frame while on, grey while off
  const settingRow = (opt: {
    key: string
    icon: string
    title: string
    detail: string
    isOn: boolean
    stops: readonly string[]
    onToggle: () => void
    children?: RenderChildren
  }) => (
    <Box
      key={`row-${opt.key}`}
      flexDirection="column"
      borderStyle="round"
      borderColor={opt.isOn ? opt.stops[opt.stops.length - 1] : THEME.borderOff}
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>
          {opt.isOn ? (
            glow(`title-${opt.key}`, `${opt.icon} ${opt.title}`, opt.stops)
          ) : (
            <Text color={THEME.off} bold wrap="truncate-end">
              {`${opt.icon} ${opt.title}`}
            </Text>
          )}
        </Box>
        <Box flexShrink={0} marginLeft={1} flexDirection="row">
          <Text color={opt.isOn ? THEME.on : THEME.off}>{opt.isOn ? '● ' : '○ '}</Text>
          <Button
            key={opt.key}
            label={opt.isOn ? 'ON' : 'OFF'}
            plain
            dimColor={!opt.isOn}
            hover={{ color: AURORA[0], bold: true }}
            onPress={opt.onToggle}
          />
        </Box>
      </Box>
      <Text color={THEME.muted}>{opt.detail}</Text>
      {opt.isOn ? opt.children : null}
    </Box>
  )

  return (
    <Box
      key="settings"
      flexDirection="column"
      paddingX={2}
      paddingTop={inBand ? 1 : 0}
      paddingBottom={1}
      gap={1}
      borderStyle={inBand ? 'round' : undefined}
      borderColor={inBand ? AURORA[1] : undefined}
      marginBottom={inBand ? 1 : 0}
    >
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          {glow('brand', '✦ SANI BHAI ER TOOL ✦')}
          {inBand ? (
            <Box marginLeft={2}>
              <Button
                key="settings-close"
                label="×"
                plain
                dimColor
                hover={{ color: AURORA[2], bold: true }}
                onPress={() => void setSettingsOpen($, false)}
              />
            </Box>
          ) : null}
        </Box>
        <Text color={THEME.muted} italic>
          your prompt, your rules
        </Text>
        {glow('rule', '━'.repeat(34))}
      </Box>

      {modelEffortPanel}

      {themePanel}

      <Box flexDirection="column">
        {glow('mods-title', '◆ LIST OF MODS', SUNSET)}
        {settingRow({
          key: 'toggle-clean-view',
          icon: '✓',
          title: 'Clean View',
          detail: 'Hide technical steps; show a plain checklist of the plan above the status line',
          isOn: isCleanViewOn,
          stops: MINT,
          onToggle: () => void setCleanView($, !isCleanViewOn),
          children: cleanViewOptions,
        })}
        {settingRow({
          key: 'toggle-status-line',
          icon: '▤',
          title: 'Status line',
          detail: 'Model, context, 5h and weekly usage band above the prompt',
          isOn,
          stops: AURORA,
          onToggle: () => void setStatusLine($, !isOn),
          children: statusOptions,
        })}
        {settingRow({
          key: 'toggle-quicky',
          icon: '✶',
          title: 'Quicky',
          detail: 'A footer button and a pane of your own skills and commands, each run with one click',
          isOn: quickyCfg.enabled,
          stops: MINT,
          onToggle: () => void setQuickyConfig($, { enabled: !quickyCfg.enabled }),
          children: quickyOptions,
        })}
        {settingRow({
          key: 'toggle-conversations',
          icon: '✧',
          title: 'Conversations',
          detail: 'A footer button and a pane listing the conversations of this project',
          isOn: convCfg.enabled,
          stops: SUNSET,
          onToggle: () => void setConversationsConfig($, { enabled: !convCfg.enabled }),
          children: conversationsOptions,
        })}
        {settingRow({
          key: 'toggle-changes',
          icon: '±',
          title: 'Changes',
          detail: "A footer button and a pane to step through Claude's file edits, accepting or undoing each",
          isOn: diffCfg.enabled,
          stops: AURORA,
          onToggle: () => void setDiffConfig($, { enabled: !diffCfg.enabled }),
          children: changesOptions,
        })}
        {settingRow({
          key: 'toggle-radar',
          icon: '◎',
          title: 'Radar',
          detail: 'A to-do list of flaws, risks and inconsistencies spotted along the way, kept per project',
          isOn: radarCfg.enabled,
          stops: SUNSET,
          onToggle: () => void setRadarConfig($, { enabled: !radarCfg.enabled }),
          children: radarOptions,
        })}
      </Box>

      <Text color={THEME.faint}>
        {inBand ? 'click × or ✦ settings to hide' : 'tab select · enter toggle · esc close'}
      </Text>
    </Box>
  )
}

// the conversations pane: a new-conversation button, then one row per conversation,
// newest first, a status dot left of each title; pressing a row switches to it
async function renderConversations($: EngineInterface, e: Extract<RenderInput, { component: 'Pane' }>) {
  applyTheme(await read($, themeAtom))
  const { Box, Button, Text } = $.ui.resolve(e)
  const rows = await read($, conversations)
  if (rows === null) ensureConversations($)
  const shown = rows ?? lastRows
  const cfg = await readConversationsConfig($)
  const now = await $.clock.now()
  // padding (2 each side), then the dot and the age with their gaps, when shown
  const titleWidth = Math.max(8, e.props.bodyColumns - 4 - (cfg.dots ? 2 : 0) - (cfg.age ? 5 : 0))

  const row = (c: ConversationRow) => (
    <Box key={`conversation-${c.id}`} flexDirection="row" gap={1}>
      {cfg.dots ? <Text color={STATUS_DOT[c.status]}>●</Text> : null}
      <Box flexGrow={1} flexShrink={1}>
        {c.isCurrent ? (
          <Text bold color={AURORA[0]} wrap="truncate-end">
            {fit(c.title, titleWidth)}
          </Text>
        ) : (
          <Button
            key={`switch-${c.id}`}
            label={fit(c.title, titleWidth)}
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void switchConversation($, c.id)}
          />
        )}
      </Box>
      {cfg.age ? <Text color={THEME.faint}>{c.isCurrent ? 'here' : ago(c.updatedAt, now)}</Text> : null}
    </Box>
  )

  return (
    <Box key="conversations" flexDirection="column" paddingX={2} paddingTop={0} paddingBottom={1} gap={1}>
      <Box flexDirection="column">
        {gradientText(Text, 'conversations-title', '✦ CONVERSATIONS')}
        <Text color={THEME.faint}>{'━'.repeat(Math.min(34, e.props.bodyColumns - 4))}</Text>
      </Box>
      {cfg.newButton ? (
        <Button
          key="new-conversation"
          label="+ New conversation"
          hover={{ color: AURORA[0], bold: true }}
          onPress={() => void newConversation($)}
        />
      ) : null}
      {shown === null ? (
        <Text color={THEME.muted}>Loading…</Text>
      ) : shown.length === 0 ? (
        <Text color={THEME.muted}>No conversations in this project yet</Text>
      ) : (
        <Box key="conversation-list" flexDirection="column">
          {/* the conversation you are in always heads the list; the rest stay newest first */}
          {[...shown.filter(r => r.isCurrent), ...shown.filter(r => !r.isCurrent)].slice(0, cfg.maxCount).map(row)}
        </Box>
      )}
      {cfg.dots && cfg.legend ? (
        <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
          {(['working', 'waiting', 'idle', 'stopped', 'closed'] as const).map(s => (
            <Text key={`legend-${s}`} color={THEME.faint}>
              <Text color={STATUS_DOT[s]}>●</Text> {STATUS_LABEL[s]}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text color={THEME.faint}>tab select · enter switch · esc close</Text>
    </Box>
  )
}

// Quicky: the person's own skills and commands, A to Z; a press runs it as if typed
async function renderQuicky($: EngineInterface, e: Extract<RenderInput, { component: 'Pane' }>) {
  applyTheme(await read($, themeAtom))
  const table = $.ui.resolve(e)
  const { Box, Button, Text } = table
  // every surface but mobile draws a text field
  const Input = 'Input' in table ? table.Input : null
  const listed = await read($, quickCommands)
  if (listed === null) ensureQuickCommands($)
  const cfg = await readQuickyConfig($)
  // most used first (the list comes ranked); the ones switched off in settings left out
  const ranked = listed ?? lastQuickCommands
  const shown = ranked === null ? null : pickQuick(ranked, cfg.show)
  const width = Math.max(8, e.props.bodyColumns - 4)
  const presets = await readPresets($)
  const expanded = await read($, quickExpanded)
  const collapsed = await read($, quickCollapsed)
  const isOpen = (name: string) => isPresetsOpen(name, cfg, presets, expanded, collapsed)
  const detecting = await read($, quickDetecting)

  // a saved parameter: "add" puts command and parameter in the prompt, "run" sends them; one
  // that still holds a placeholder can only be added, to fill the value in first
  const presetRow = (name: string, p: QuickPreset) => (
    <Box key={`preset-${name}-${p.args}`} flexDirection="row" justifyContent="space-between" gap={1}>
      <Box flexShrink={1} flexDirection="row">
        <Text color={THEME.faint}>{'- '}</Text>
        <Text wrap="truncate-end">{fit(p.label, width - 30)}</Text>
        {p.label !== p.args ? <Text color={THEME.faint} wrap="truncate-end">{` ${fit(p.args, 18)}`}</Text> : null}
      </Box>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        <Button
          key={`preset-add-${name}-${p.args}`}
          label="+ add"
          plain
          hover={{ color: AURORA[2], bold: true }}
          onPress={() => void addQuick($, name, p.args)}
        />
        {p.needsValue ? (
          <Text color={THEME.faint}>{'fill in'}</Text>
        ) : (
          <Button
            key={`preset-run-${name}-${p.args}`}
            label="> run"
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void runQuick($, name, p.args)}
          />
        )}
        <Button
          key={`preset-del-${name}-${p.args}`}
          label="del"
          plain
          dimColor
          hover={{ color: HEAT[2], bold: true }}
          onPress={() => void deletePreset($, name, p.args)}
        />
      </Box>
    </Box>
  )

  const presetPanel = (c: QuickCommand) => (
    // indented under the command, in line with its description: three blocks a row apart,
    // the saved presets (when there are any), the field, detect
    <Box key={`presets-${c.name}`} flexDirection="column" marginLeft={2} marginTop={1} gap={1}>
      {(presets[c.name]?.length ?? 0) > 0 ? (
        <Box key={`preset-list-${c.name}`} flexDirection="column">
          {presets[c.name]!.map(p => presetRow(c.name, p))}
        </Box>
      ) : null}
      {Input ? (
        <Input
          key={`preset-input-${c.name}`}
          label="+ "
          placeholder="a fixed parameter, e.g. P1794-123"
          submitLabel="save"
          onSubmit={(value: string) => void savePreset($, c.name, value)}
        />
      ) : (
        <Text color={THEME.faint}>{'add your own presets from the terminal or desktop'}</Text>
      )}
      {cfg.detect ? (
        <Box flexDirection="row" gap={2}>
          <Button
            key={`detect-${c.name}`}
            label={detecting === c.name ? 'detecting options' : 'detect options'}
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void detectPresets($, c.name, c.description)}
          />
          <Text color={THEME.faint}>reads the skill and adds what it accepts</Text>
        </Box>
      ) : null}
    </Box>
  )

  // the plain name, then two actions: "add" puts it in the prompt to say more, "run" sends it
  const item = (c: QuickCommand) => {
    const { title, namespace } = quickTitle(c.name)
    const uses = cfg.counts && c.uses > 0 ? ` · ${c.uses} use${c.uses === 1 ? "" : "s"}` : ''
    return (
    <Box key={`quick-${c.name}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1} flexDirection="row">
          <Text color={AURORA[1]}>{'✦ '}</Text>
          <Text bold color={AURORA[0]} wrap="truncate-end">
            {fit(title, width - 18 - (namespace ? namespace.length + 3 : 0) - uses.length)}
          </Text>
          {namespace ? <Text color={THEME.faint}>{` · ${namespace}`}</Text> : null}
          {uses ? (
            <Text color={THEME.faint}>
              {uses}
            </Text>
          ) : null}
        </Box>
        <Box flexShrink={0} flexDirection="row" gap={1}>
          <Button
            key={`add-${c.name}`}
            label="+ add"
            plain
            hover={{ color: AURORA[2], bold: true }}
            onPress={() => void addQuick($, c.name)}
          />
          <Button
            key={`run-${c.name}`}
            label="> run"
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void runQuick($, c.name)}
          />
        </Box>
      </Box>
      {cfg.descriptions && c.description ? (
        <Text color={THEME.muted} wrap="truncate-end">
          {`  ${fit(c.description, width - 2)}`}
        </Text>
      ) : null}
      {cfg.presets ? (
        <Box marginLeft={2}>
          <Button
            key={`presets-toggle-${c.name}`}
            label={
              isOpen(c.name)
                ? 'hide presets'
                : (presets[c.name]?.length ?? 0) > 0
                  ? `show presets (${presets[c.name]!.length})`
                  : 'presets'
            }
            plain
            dimColor
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void toggleExpanded($, c.name)}
          />
        </Box>
      ) : null}
      {cfg.presets && isOpen(c.name) ? presetPanel(c) : null}
    </Box>
    )
  }

  return (
    <Box key="quicky" flexDirection="column" paddingX={2} paddingTop={0} paddingBottom={1} gap={1}>
      <Box flexDirection="column">
        {gradientText(Text, 'quicky-title', '✶ QUICKY')}
        <Text color={THEME.faint}>{'━'.repeat(Math.min(34, e.props.bodyColumns - 4))}</Text>
      </Box>
      {shown === null ? (
        <Text color={THEME.muted}>Loading…</Text>
      ) : shown.length === 0 ? (
        <Text color={THEME.muted}>
          {cfg.show === 'top'
            ? 'Nothing used yet: run a command and it shows here'
            : cfg.show === 'mine'
              ? 'No skills or commands of your own yet'
              : 'No commands found'}
        </Text>
      ) : (
        // a faint rule between commands, a row of air on each side, so each reads as one block
        <Box key="quick-list" flexDirection="column" gap={1}>
          {shown.flatMap((c, i) =>
            i === 0
              ? [item(c)]
              : [
                  <Text key={`quick-sep-${c.name}`} color={THEME.faint}>
                    {'─'.repeat(width)}
                  </Text>,
                  item(c),
                ],
          )}
        </Box>
      )}
      <Text color={THEME.faint}>add: type more, then send · run: send now · esc close</Text>
    </Box>
  )
}

// a dropdown of every model, opened from the model name on the status line
async function renderModelMenu($: EngineInterface, e: AbovePromptEvent) {
  if (!(await read($, modelMenu))) {
    return null
  }
  const { Box, Button, Text } = $.ui.resolve(e)
  const pick = await read($, modelPick)
  const current = pick ? MODEL_IDS[pick].name : ((await read($, view))?.model ?? '')

  return (
    <Box
      key="model-menu"
      flexDirection="column"
      borderStyle="round"
      borderColor={AURORA[1]}
      paddingX={2}
      paddingY={1}
      marginTop={1}
      alignSelf="flex-start"
    >
      <Box flexDirection="row" justifyContent="space-between" columnGap={6} marginBottom={1}>
        {gradientText(Text, 'menu-title', '◆ CHOOSE A MODEL')}
        {/* its own keyed box, so the hover lights only while the pointer is on the X */}
        <Box key="menu-close-area">
          <Button
            key="menu-close"
            // non-breaking spaces keep the padding, so the hover fills the whole button
            label={' X '}
            plain
            dimColor
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void toggleModelMenu($)}
          />
        </Box>
      </Box>
      {MODELS.map(m => {
        const isCurrent = isModel(current, m)
        return (
          <Box
            key={`menu-row-${m}`}
            flexDirection="row"
            columnGap={2}
            alignItems="center"
            hover={isCurrent ? undefined : { backgroundColor: THEME.rowHover }}
          >
            {isCurrent ? (
              <Box key={`menu-${m}`} width={18}>
                {capsule(Box, Text, `cap-menu-${m}`, `● ${MODEL_IDS[m].name}`)}
              </Box>
            ) : (
              <Box width={18} paddingLeft={1}>
                <Button
                  key={`menu-${m}`}
                  label={`○ ${MODEL_IDS[m].name}`}
                  plain
                  hover={{ color: AURORA[0], bold: true }}
                  onPress={() => void pickFromMenu($, m)}
                />
              </Box>
            )}
            <Text color={THEME.faint}>{MODEL_IDS[m].id}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

async function renderStatusLine($: EngineInterface, e: AbovePromptEvent) {
  const v = await read($, view)
  const isOn = await read($, statusLine)
  if (!isOn || v === null) {
    return null
  }

  const cfg = await read($, statusConfig)
  const isMenuOpen = await read($, modelMenu)
  const { Box, Button, Text } = $.ui.resolve(e)
  const sep = (key: string) => (
    <Text key={key} color={THEME.faint}>
      {'  ✦  '}
    </Text>
  )

  // the filled cells glow along the gradient; the rest is a dark track
  const meter = (key: string, label: string, used: number, detail: string, stops: readonly string[]) => {
    const glyph = BAR_GLYPH[cfg.barHeight]
    const b = bar(used, cfg.barWidth, glyph)
    const glowCells = gradient(cfg.barWidth, stops).slice(0, b.filled.length)
    return (
      <Box key={key}>
        <Text color={THEME.muted}>{label} </Text>
        {cfg.bars ? (
          <Text>
            {glowCells.map((c, i) => (
              <Text key={`${key}-c${i}`} color={c}>
                {glyph}
              </Text>
            ))}
            <Text color={THEME.track}>{b.empty + ' '}</Text>
          </Text>
        ) : null}
        <Text color={usageColor(used)} bold>
          {Math.round(used)}%
        </Text>
        <Text color={THEME.faint}> {detail}</Text>
      </Box>
    )
  }

  // each part is switchable from the settings pane
  const parts: RenderChildren[] = []
  if (cfg.model) {
    parts.push(
      <Box key="model" flexDirection="row">
        {gradientText(Text, 'model-name', `◆ ${v.model}`)}
        {/* a button label takes one color, so the gradient name is plain text and the ▾ opens the list */}
        <Box marginLeft={1}>
          <Button
            key="switch-model"
            label={isMenuOpen ? '▴' : '▾'}
            plain
            hover={{ color: AURORA[0], bold: true }}
            onPress={() => void toggleModelMenu($)}
          />
        </Box>
      </Box>,
    )
  }
  if (cfg.context) {
    parts.push(
      v.context ? (
        meter('ctx', 'ctx', v.context.percent, v.context.detail, AURORA)
      ) : (
        <Text key="ctx" color={THEME.faint}>
          ctx —/{v.contextWindow}
        </Text>
      ),
    )
  }
  // a usage window: its meter, then when it resets; a dash until the figures arrive
  const limitPart = (key: string, label: string, limit: LimitMeter | null, showReset: boolean) =>
    limit ? (
      <Box key={key}>
        {meter(`${key}-meter`, label, limit.percent, limit.detail, HEAT)}
        {showReset && limit.resetAt ? (
          <Text>
            <Text color={THEME.faint}> · ↻ </Text>
            <Text color={AURORA[0]} bold>
              {limit.resetAt}
            </Text>
            <Text color={THEME.faint}> (in {limit.resetIn})</Text>
          </Text>
        ) : null}
      </Box>
    ) : (
      <Text key={key} color={THEME.faint}>
        {label} —
      </Text>
    )
  if (cfg.fiveHour) {
    parts.push(limitPart('5h', '5h', v.fiveHour, cfg.reset))
  }
  if (cfg.weekly) {
    parts.push(limitPart('wk', 'wk', v.weekly, cfg.weeklyReset))
  }
  if (parts.length === 0) {
    return null
  }

  return (
    <Box key="band" flexDirection="row" flexWrap="wrap">
      {parts.flatMap((part, i) => (i === 0 ? [part] : [sep(`sep-${i}`), part]))}
    </Box>
  )
}

// ── Clean View: hides technical rows and shows a plain checklist of the plan ──

const enabledAtom = atom({ plugin: 'cockpit', key: 'cleanViewEnabled' } as const, true)
const checklistAtom = atom({ plugin: 'cockpit', key: 'checklist' } as const, null)
const tickAtom = atom({ plugin: 'cockpit', key: 'tick' } as const, 0)

const CLEAN_VIEW_KEY = 'cleanViewEnabled'

// the checklist meters' width, from the Clean View card in settings
const METER_WIDTH_KEY = 'cleanViewBarWidth'
const meterWidthAtom = atom({ plugin: 'cockpit', key: 'cleanViewBarWidth' } as const, 0)

// the store is the truth (a session swap resets $.state); the atom is read so a change redraws
async function readMeterWidth($: Engine): Promise<number> {
  await read($, meterWidthAtom)
  return loadMeterWidth(await $.store.get(METER_WIDTH_KEY).catch(() => undefined))
}

async function setMeterWidth($: Engine, width: number): Promise<void> {
  await $.store.set(METER_WIDTH_KEY, width)
  await update($, meterWidthAtom, () => width)
  $.ui.invalidate('ui.render')
}

// the checklist meters' height, kept the same way as their width
const METER_HEIGHT_KEY = 'cleanViewBarHeight'
const meterHeightAtom = atom({ plugin: 'cockpit', key: 'cleanViewBarHeight' } as const, null as BarHeight | null)

async function readMeterHeight($: Engine): Promise<BarHeight> {
  await read($, meterHeightAtom)
  return loadBarHeight(await $.store.get(METER_HEIGHT_KEY).catch(() => undefined), DEFAULT_METER_HEIGHT)
}

async function setMeterHeight($: Engine, height: BarHeight): Promise<void> {
  await $.store.set(METER_HEIGHT_KEY, height)
  await update($, meterHeightAtom, () => height)
  $.ui.invalidate('ui.render')
}

// Module variables start over on a hot reload; everything drawn lives in $.state.
let ticker: Timer | null = null
let collapseTimer: Timer | null = null
let failures = 0
let lastApiFailure: ApiFailure | null = null

function syncClock($: Engine, checklist: Checklist | null): void {
  const isLive = checklist !== null && (checklist.phase === 'working' || checklist.phase === 'needsYou')
  if (isLive && ticker === null) {
    ticker = $.clock.every(FRAME_MS, () => {
      void update($, tickAtom, n => (n ?? 0) + 1)
    })
  } else if (!isLive && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

async function change($: Engine, fn: (c: Checklist | null) => Checklist | null): Promise<Checklist | null> {
  let after: Checklist | null = null
  await update($, checklistAtom, c => (after = fn(c ?? null)))
  syncClock($, after)

  return after
}

async function setCleanView($: Engine, value: boolean): Promise<void> {
  await update($, enabledAtom, () => value)
  try {
    await $.store.set(CLEAN_VIEW_KEY, value)
  } catch {
    // The setting still holds for this session.
  }
  $.ui.toast(value ? 'Clean View is on. Technical details are hidden.' : 'Clean View is off. Showing everything.')
}

async function nameJob($: Engine, jobId: number, request: string): Promise<void> {
  const ask = {
    model: 'haiku',
    maxTokens: 30,
    timeoutMs: 20000,
    system:
      'You name tasks for a progress checklist read by non-technical people. Reply with only the name: 2 to 6 plain English words, starting with a verb. No quotes, punctuation, file names, code or commands.',
    prompt: `Name this request:\n\n${request.slice(0, 2000)}`,
  }
  try {
    let reply = await $.model.complete({ ...ask, effort: 'low' })
    if (!reply.isAnswered && reply.reason === 'api-error') {
      reply = await $.model.complete(ask)
    }
    if (!reply.isAnswered) {
      return
    }
    const words = reply.text
      .split('\n')[0]!
      .replace(/["'`*_.:;!?]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 6)
    if (words.length < 1 || words[0] === '') {
      return
    }
    const title = cleanName(words.join(' '))
    await change($, c => (c !== null && c.jobId === jobId ? { ...c, title } : c))
  } catch {
    // The placeholder title stays.
  }
}

async function startJob($: Engine, request: string): Promise<void> {
  const now = await $.clock.now()
  collapseTimer?.cancel()
  collapseTimer = null
  const started = await change($, c => newChecklist((c?.jobId ?? 0) + 1, now))
  if (started !== null && request !== '') {
    const jobId = started.jobId
    // Named in the background so the checklist shows at once.
    $.clock.after(0, () => {
      void nameJob($, jobId, request)
    })
  }
}

async function finishJob($: Engine): Promise<void> {
  const now = await $.clock.now()
  const done = await change($, c =>
    c === null
      ? c
      : {
          ...c,
          phase: 'done',
          tasks: c.tasks.map(t => ({ ...t, status: 'done', percent: 100 })),
          needsYouReason: null,
          stuckReason: null,
          finishedAt: now,
          isCollapsed: false,
        },
  )
  if (done === null) {
    return
  }
  collapseTimer?.cancel()
  const jobId = done.jobId
  collapseTimer = $.clock.after(COLLAPSE_MS, () => {
    collapseTimer = null
    void change($, c => (c !== null && c.jobId === jobId && c.phase === 'done' ? { ...c, isCollapsed: true } : c))
  })
}

async function handlePlan($: Engine, e: unknown) {
  const raw = argOf(e, 'steps')
  const names = uniqueNames(Array.isArray(raw) ? raw : []).slice(0, 8)
  if (names.length === 0) {
    return { result: 'Send 2 to 8 short step names in plain English.' }
  }
  const now = await $.clock.now()
  await change($, c => {
    const base = c ?? newChecklist(1, now)

    return {
      ...base,
      tasks: planTasks(names, base.jobId),
      isPlanned: true,
      phase: 'working',
      needsYouReason: null,
      stuckReason: null,
      finishedAt: null,
      isCollapsed: false,
    }
  })

  return {
    result: `Planned ${names.length} steps. The first one has started.`,
  }
}

async function handleProgress($: Engine, e: unknown) {
  const percent = clampPercent(argOf(e, 'percent'))
  const task = String(argOf(e, 'task') ?? '')
  const now = await $.clock.now()
  await change($, c => {
    const base = c ?? newChecklist(1, now)
    // A report before any plan replaces the placeholders with the reported step.
    const tasks = base.isPlanned ? base.tasks : []

    return {
      ...base,
      tasks: applyProgress(tasks, task, percent, now),
      isPlanned: true,
      phase: 'working',
      needsYouReason: null,
      stuckReason: null,
    }
  })

  return { result: `Progress noted: ${percent}%.` }
}

// Called from the mod's own session.start: one hook per event per plugin.
async function startCleanView($: Engine): Promise<void> {
  try {
    const saved = await $.store.get(CLEAN_VIEW_KEY)
    await update($, enabledAtom, () => saved !== false)
  } catch {
    // Clean View starts on.
  }
  await $.tool.register({
    name: 'plan_steps',
    description:
      'Lay out every step of the job up front for the checklist the person watches: 2 to 8 short plain-English step names in order, each starting with a verb and under 40 characters, with no file names, paths, commands, code or tool names. The first step starts right away. Call this first for every request.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 8,
          description: 'The step names, in order, e.g. "Build the pricing section".',
        },
      },
      required: ['steps'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'report_progress',
    description:
      'Report progress on the current step of the checklist. Use the step name from the plan and a percent from 0 to 100. Reporting a step checks off every step before it; 100 checks it off and starts the next one. Call it as real progress happens and with 100 the moment a step finishes.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The step name, as planned.' },
        percent: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'How far along the step is.',
        },
      },
      required: ['task', 'percent'],
    },
    isDeferred: false,
  })
  await $.command.register({
    name: 'simple',
    description: 'Turn Clean View on or off',
    argumentHint: 'on|off',
  })
  syncClock($, await read($, checklistAtom))
}

// Called from the mod's own turn.complete, before the engine's.
async function completeCleanView($: Engine, e: TurnCompleteEvent): Promise<void> {
  if (e.agentId !== undefined) {
    return
  }
  const c = await read($, checklistAtom)
  if (c !== null && c.phase !== 'done' && c.phase !== 'stopped') {
    const now = await $.clock.now()
    if (e.reason === 'aborted') {
      await change($, x => (x === null ? x : { ...x, phase: 'stopped', needsYouReason: null, finishedAt: now }))
    } else if (e.reason === 'error') {
      const reason = apiErrorSentence(lastApiFailure, e.answer)
      await change($, x =>
        x === null
          ? x
          : {
              ...x,
              phase: 'stuck',
              stuckReason: reason,
              needsYouReason: null,
              finishedAt: now,
            },
      )
    } else if (e.reason === 'refusal') {
      await change($, x =>
        x === null
          ? x
          : {
              ...x,
              phase: 'stuck',
              stuckReason: REFUSED,
              needsYouReason: null,
              finishedAt: now,
            },
      )
    } else if (c.isPlanned && c.tasks.some(t => t.status !== 'done')) {
      await change($, x =>
        x === null
          ? x
          : {
              ...x,
              phase: 'needsYou',
              needsYouReason: WAITING_REPLY,
              stuckReason: null,
            },
      )
    } else {
      await finishJob($)
    }
  }
  lastApiFailure = null
}

function registerCleanView(on: On): void {
  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    let value: boolean
    if (arg === 'on') {
      value = true
    } else if (arg === 'off') {
      value = false
    } else if (arg === '') {
      value = !(await read($, enabledAtom))
    } else {
      return { text: 'Use /simple on, /simple off, or /simple to switch.' }
    }
    await setCleanView($, value)

    return { text: value ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = [...composed.sections]
    if (await read($, enabledAtom)) {
      sections.push({ id: 'clean-view:guide', text: GUIDE, scope: 'session' })
    }
    // Radar's guide shares this hook: the engine takes one unmatched prompt.compose per module
    const radar = await readRadarConfig($)
    if (radar.enabled && radar.autoFlag) {
      sections.push({ id: 'radar:guide', text: RADAR_GUIDE, scope: 'session' })
    }

    return sections.length === composed.sections.length ? composed : { sections }
  })

  on('turn.start', async ($, e, next) => {
    failures = 0
    lastApiFailure = null
    const text = e.text.trim()
    await noteConversation($, 'working', text)
    const current = await read($, checklistAtom)
    if (text === '' || text.startsWith('/') || current?.phase === 'working') {
      // A continuation, a slash command or a turn inside a running job: no new job.
      await change($, resumed)
    } else if (current !== null && current.phase === 'needsYou') {
      // The person replied to a waiting job.
      await change($, resumed)
    } else {
      await startJob($, text)
    }

    return next(e)
  })

  // The gate and the checklist's view of every tool call.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const isMain = e.agentId === undefined
    if (tool === PLAN_TOOL) {
      return isMain ? handlePlan($, e) : { result: 'Planned.' }
    }
    if (tool === PROGRESS_TOOL) {
      return isMain ? handleProgress($, e) : { result: 'Progress noted.' }
    }
    if (!isMain) {
      return next(e)
    }
    if (!ALWAYS_ALLOWED.has(tool) && (await read($, enabledAtom))) {
      const c = await read($, checklistAtom)
      if (c === null || !c.isPlanned) {
        return {
          deny: `Clean View: call ${PLAN_TOOL} first with 2 to 8 plain-English step names (load it with ToolSearch if it is deferred), then try this again.`,
        }
      }
    }

    await change($, c => {
      const after = resumed(c)
      return tool === 'AskUserQuestion' && after !== null
        ? { ...after, phase: 'needsYou', needsYouReason: HAS_QUESTION }
        : after
    })
    const ran = await next(e)
    await change($, resumed)

    const failedText = ran.deny ?? (ran.isError === true ? (ran.text ?? '') : null)
    if (failedText !== null) {
      if (USER_SAID_NO.test(failedText)) {
        failures = 0
        await change($, c =>
          c === null
            ? c
            : {
                ...c,
                phase: 'stuck',
                stuckReason: SAID_NO,
                needsYouReason: null,
              },
        )
      } else if (!INTERRUPTED.test(failedText)) {
        failures += 1
        if (failures >= FAILURES_BEFORE_STUCK) {
          await change($, c =>
            c === null
              ? c
              : {
                  ...c,
                  phase: 'stuck',
                  stuckReason: KEEPS_FAILING,
                  needsYouReason: null,
                },
          )
        }
      }

      return ran
    }

    failures = 0
    await change($, c => {
      let after = c !== null && c.phase === 'stuck' ? { ...c, phase: 'working' as const, stuckReason: null } : c
      if (e.tool === 'TodoWrite') {
        after = fromTodos(after ?? newChecklist(1, Date.now()), e.todos)
      } else if (e.tool === 'TaskCreate') {
        const created = argOf(argOf(ran.result, 'task'), 'id')
        if (created !== undefined) {
          after = addTask(after ?? newChecklist(1, Date.now()), String(created), e.subject)
        }
      } else if (e.tool === 'TaskUpdate' && after !== null) {
        after = updateTask(after, e.taskId, e.status, e.subject)
      }

      return after
    })

    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    const reason =
      e.notification_type === 'permission_prompt'
        ? NEEDS_OK
        : e.notification_type === 'elicitation_dialog'
          ? HAS_QUESTION
          : null
    if (reason !== null) {
      await noteConversation($, 'waiting')
      await change($, c =>
        c !== null && (c.phase === 'working' || c.phase === 'stuck' || c.phase === 'needsYou')
          ? {
              ...c,
              phase: 'needsYou',
              needsYouReason: reason,
              stuckReason: null,
            }
          : c,
      )
    }

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    lastApiFailure = { kind: String(e.error), details: e.error_details ?? '' }
    const sentence = apiErrorSentence(lastApiFailure, '')
    // StopFailure may land after turn.complete: sharpen the reason already shown.
    await change($, c =>
      c !== null && c.phase === 'stuck' && c.finishedAt !== null ? { ...c, stuckReason: sentence } : c,
    )

    return next(e)
  })

  // Hide the technical rows while Clean View is on.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabledAtom)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )
}

// The plan checklist for the band above the prompt, or null when there is nothing to show.
// Drawn by the mod's one AbovePrompt hook, above the status line.
async function renderCleanView($: Engine, e: AbovePromptEvent) {
  const isEnabled = await read($, enabledAtom)
  const c = await read($, checklistAtom)
  const tick = await read($, tickAtom)
  const meterWidth = await readMeterWidth($)
  const glyph = BAR_GLYPH[await readMeterHeight($)]
  const { Box, Text } = $.ui.resolve(e)
  const columns = Math.max(24, e.props.bodyColumns)

  if (!isEnabled || c === null) {
    return null
  }

  const now = await $.clock.now()
  const elapsed = formatDuration((c.finishedAt ?? now) - c.startedAt)
  let header
  if (c.phase === 'needsYou') {
    header = [
      <Text key="badge" bold color={THEME.chipText} backgroundColor={THEME.warn}>
        {' Needs you '}
      </Text>,
      <Text key="reason" wrap="truncate-end">
        {` ${c.needsYouReason ?? NEEDS_OK}`}
      </Text>,
    ]
  } else if (c.phase === 'stuck') {
    header = [
      <Text key="stuck" color={THEME.warn} wrap="truncate-end">
        {`⚠ Stuck: ${c.stuckReason ?? KEEPS_FAILING}`}
      </Text>,
    ]
  } else if (c.phase === 'stopped') {
    header = [
      <Text key="stopped" wrap="truncate-end">
        {`■ Stopped · ${c.title} · you pressed Esc`}
      </Text>,
    ]
  } else if (c.phase === 'done') {
    header = [
      gradientText(Text, 'done', '✓ All done', MINT),
      <Text key="took" wrap="truncate-end">
        {` · ${c.title} · took ${elapsed}`}
      </Text>,
    ]
  } else {
    header = [
      gradientText(Text, 'title', `✦ ${c.title}`),
      <Text key="time" color={THEME.faint}>
        {` · ${elapsed}`}
      </Text>,
    ]
  }
  const headerRow = (
    <Box key="header" flexDirection="row" width={columns}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1}>
        {header}
      </Box>
    </Box>
  )
  if (c.phase === 'done' && c.isCollapsed) {
    return headerRow
  }

  // Marker (2) + name + meter with spaces (width + 2) + label (7).
  const nameWidth = Math.max(6, columns - 2 - (meterWidth + 2) - 7)
  const firstUpcoming = c.tasks.findIndex(t => t.status === 'upcoming')
  const rows = c.tasks.map((task, i) => {
    if (task.status === 'done') {
      return (
        <Box key={task.id} flexDirection="row" width={columns}>
          <Text color={THEME.on}>{'✓ '}</Text>
          <Box width={nameWidth}>
            <Text dimColor wrap="truncate-end">
              {task.name}
            </Text>
          </Box>
          <Text> </Text>
          {gradientText(Text, `${task.id}-meter`, glyph.repeat(meterWidth), MINT, false)}
          <Text color={THEME.on}> Done</Text>
        </Box>
      )
    }
    if (task.status === 'active') {
      const meter = task.hasReported ? filledMeter(task.percent, meterWidth) : sweepMeter(tick, meterWidth)
      const isWaiting = c.phase === 'needsYou'
      return (
        <Box key={task.id} flexDirection="row" width={columns}>
          <Text color={isWaiting ? THEME.warn : AURORA[0]}>{isWaiting ? '‖ ' : '▶ '}</Text>
          <Box width={nameWidth}>
            <Text bold wrap="truncate-end">
              {task.name}
            </Text>
          </Box>
          <Text> </Text>
          {meterText(Text, `${task.id}-meter`, meter, glyph)}
          <Text> </Text>
          <Text>{task.hasReported ? `${task.percent}%` : 'Working'}</Text>
        </Box>
      )
    }

    return (
      <Box key={task.id} flexDirection="row" width={columns}>
        <Text dimColor>{'○ '}</Text>
        <Box width={nameWidth}>
          <Text dimColor wrap="truncate-end">
            {task.name}
          </Text>
        </Box>
        <Text color={THEME.track}>{` ${glyph.repeat(meterWidth)} `}</Text>
        <Text dimColor>{i === firstUpcoming ? 'Next' : 'Up next'}</Text>
      </Box>
    )
  })

  return (
    <Box flexDirection="column" width={columns}>
      {headerRow}
      {rows}
    </Box>
  )
}
