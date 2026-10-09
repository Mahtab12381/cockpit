export type Meter = { percent: number; detail: string }

// a usage window with its reset: the clock time it resets at and how long until then
export type LimitMeter = Meter & { resetAt: string | null; resetIn: string | null }

export type View = {
  model: string
  context: Meter | null
  contextWindow: string
  fiveHour: LimitMeter | null
  // the 7-day window; its reset names the weekday too
  weekly: LimitMeter | null
}

export type BarWidth = 5 | 10 | 15

// how tall a bar's cells are drawn, from a thin line to a full block
export type BarHeight = 'thin' | 'half' | 'tall' | 'full'

// what the status line band shows; each part can be switched off from the settings pane
export type StatusConfig = {
  model: boolean
  context: boolean
  fiveHour: boolean
  reset: boolean
  weekly: boolean
  weeklyReset: boolean
  bars: boolean
  barWidth: BarWidth
  barHeight: BarHeight
}

export type ModelPick = 'opus' | 'sonnet' | 'haiku' | 'fable'

// 'auto' leaves the session's own effort alone
export type EffortPick = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ThemeName = 'aurora' | 'sunset' | 'ocean' | 'forest' | 'neon'

// Clean View: the plain-English plan checklist shown under the status line
export type CleanViewTaskStatus = 'done' | 'active' | 'upcoming'

export type CleanViewTask = {
  id: string
  name: string
  status: CleanViewTaskStatus
  percent: number
  hasReported: boolean
}

export type CleanViewPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type CleanViewChecklist = {
  jobId: number
  title: string
  phase: CleanViewPhase
  tasks: CleanViewTask[]
  isPlanned: boolean
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

// the conversations pane: one row per transcript of this project
// working: a turn is running · waiting: it asked the person for an OK or an answer ·
// idle: open in a Claude Code, done · stopped: its last turn failed or was cut off ·
// closed: not open anywhere
export type ConversationStatus = 'working' | 'waiting' | 'idle' | 'stopped' | 'closed'

export type ConversationRow = {
  id: string
  title: string
  status: ConversationStatus
  updatedAt: number
  isCurrent: boolean
}

export type ConversationsMax = 5 | 10 | 20 | 40

// the conversations pane's options, set from its card in the settings pane
export type ConversationsConfig = {
  enabled: boolean
  newButton: boolean
  dots: boolean
  legend: boolean
  age: boolean
  maxCount: ConversationsMax
}

// Quicky: the person's own skills and commands, each one click away
// isMine: a command or skill file the person wrote (this project's or their own .claude folder),
// not one synced in from their organization or shipped by a plugin
export type QuickCommand = { name: string; description: string; source: string; isMine: boolean; uses: number }

// which commands the Quicky pane lists: the person's own, the most used, or every one
export type QuickyShow = 'mine' | 'top' | 'all'

export type QuickyConfig = {
  enabled: boolean
  descriptions: boolean
  show: QuickyShow
  // "3 uses" beside each name
  counts: boolean
  // the presets toggle under each command, its saved parameters and its field
  presets: boolean
  // the "detect options" button (a small model call), within presets
  detect: boolean
  // every command that has a preset shows them open, until closed by hand
  presetsOpen: boolean
}

// a fixed parameter saved under a command, run in one press. needsValue: it still holds a
// placeholder (P1794-XXX, <ticket>), so it only goes into the prompt to be filled in
export type QuickPreset = { label: string; args: string; needsValue: boolean; source: 'mine' | 'detected' }
export type QuickPresets = Record<string, QuickPreset[]>

// the changes pane: each file edit Claude made is one step, reviewed in order and accepted
// (kept) or undone (taken back out of the file); an undone step can be redone
export type DiffStepStatus = 'pending' | 'accepted' | 'undone'

// one unified-diff hunk; each line starts with ' ', '-' or '+'
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

export type DiffStep = {
  id: number
  path: string
  tool: string
  at: number
  // the tool created the file
  isNew: boolean
  added: number
  removed: number
  hunks: DiffHunk[]
  status: DiffStepStatus
}

export type DiffConfig = {
  enabled: boolean
  // accepted and undone steps left out of the list and the stepping
  hideReviewed: boolean
}

// Radar: flaws, risks and inconsistencies Claude (or the person) spotted along the way, kept
// per project as a to-do list. inScope: part of the task at hand, flagged so it is not lost
export type RadarKind = 'bug' | 'risk' | 'inconsistency' | 'debt' | 'note'
export type RadarSeverity = 'high' | 'medium' | 'low'
export type RadarStatus = 'open' | 'done' | 'dismissed'

export type RadarItem = {
  id: string
  title: string
  detail: string
  kind: RadarKind
  severity: RadarSeverity
  file: string | null
  inScope: boolean
  status: RadarStatus
  source: 'claude' | 'me'
  createdAt: number
  closedAt: number | null
}

// which items the pane lists
export type RadarFilter = 'open' | 'closed' | 'all'
export type RadarSort = 'severity' | 'newest'

export type RadarConfig = {
  enabled: boolean
  // Claude is told to flag what it notices, and the flag tool takes its findings
  autoFlag: boolean
  // a toast each time Claude flags something
  toast: boolean
  details: boolean
  files: boolean
  // the open count on the footer button
  badge: boolean
  filter: RadarFilter
  sort: RadarSort
}

// which view the one docked pane shows
export type PanelView = 'settings' | 'conversations' | 'quicky' | 'diff' | 'radar'

declare module 'claude-code' {
  interface PluginState {
    'cockpit': {
      view: View | null
      statusLine: boolean
      statusConfig: StatusConfig
      effort: EffortPick
      sessionEffort: string | null
      modelPick: ModelPick | null
      modelMenu: boolean
      theme: ThemeName
      settingsOpen: boolean
      cleanViewEnabled: boolean
      cleanViewBarWidth: number
      cleanViewBarHeight: BarHeight | null
      checklist: CleanViewChecklist | null
      tick: number
      conversations: ConversationRow[] | null
      panelView: PanelView
      conversationsConfig: ConversationsConfig
      quickCommands: QuickCommand[] | null
      quickyConfig: QuickyConfig
      quickCollapsed: string[]
      quickPresets: QuickPresets
      quickExpanded: string | null
      quickDetecting: string | null
      diffSteps: DiffStep[]
      diffCursor: number | null
      diffConfig: DiffConfig
      radarItems: RadarItem[] | null
      radarConfig: RadarConfig
    }
  }
}
