import type { CleanViewChecklist, CleanViewTask } from '../types'

// Clean View's pure parts: names, checklist steps, wording. Everything that touches $
// lives in register.tsx, since $ is only followed into functions of the same file.

type Checklist = CleanViewChecklist
type Task = CleanViewTask

export const PLAN_TOOL = 'mcp__cockpit__plan_steps'
export const PROGRESS_TOOL = 'mcp__cockpit__report_progress'
// Radar's flag tool is allowed before a plan too: a finding can come at any time
export const ALWAYS_ALLOWED = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'AskUserQuestion', 'mcp__cockpit__flag_issue'])

export const MAX_NAME = 40
export const METER = 10
export const METER_WIDTHS = [5, 10, 15] as const

// a stored width, or the default when it is missing or not one of the choices
export function loadMeterWidth(raw: unknown): number {
  return METER_WIDTHS.includes(raw as (typeof METER_WIDTHS)[number]) ? (raw as number) : METER
}
export const FRAME_MS = 250
export const COLLAPSE_MS = 5000
export const FAILURES_BEFORE_STUCK = 3

export const PLACEHOLDERS = ['Understand your request', 'Plan the steps']
export const DEFAULT_TITLE = 'Working on your request'
export const NEEDS_OK = 'Claude needs your OK to continue'
export const HAS_QUESTION = 'Claude has a question for you'
export const WAITING_REPLY = 'Claude is waiting for your reply'
export const SAID_NO = 'you said no to a step, so Claude paused'
export const KEEPS_FAILING = 'a step keeps failing, Claude is trying another way'
export const REFUSED = "Claude couldn't help with that request"

export const GUIDE = `# Clean View is on

The person watching may not be technical. Technical rows are hidden from them; they follow your work through a simple checklist above the prompt.

- For every request, even a quick question, call \`${PLAN_TOOL}\` first with 2 to 8 short step names in order. If it is deferred, load it with ToolSearch first. Other tools are refused until a plan exists.
- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- Call \`${PROGRESS_TOOL}\` with the step name and a percent as real progress happens, and with 100 the moment a step finishes. Report 100 for every step before you give your final answer.
- If this session has TodoWrite or TaskCreate, you may use your to-do list as the plan instead, with the same plain step names.`

// Code-like file names: a word ending in a known source or config extension.
export const CODE_FILE =
  /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|ps1|bat|json|ya?ml|toml|md|html?|css|scss|less|sql|xml|lock|env|ini|cfg|conf|vue|svelte|prisma|d\.ts)[)\].,;:!?'"]*$/i

// One cleaner for every name the checklist shows.
export function cleanName(raw: unknown): string {
  const words = String(raw ?? '')
    .replace(/`[^`]*`?/g, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !word.includes('/') && !word.includes('\\') && !CODE_FILE.test(word))
  let name = words.join(' ').trim()
  if (name === '') {
    return 'Working on it'
  }
  name = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.length > MAX_NAME) {
    const cut = name.slice(0, MAX_NAME - 1)
    const space = cut.lastIndexOf(' ')
    name = (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…'
  }

  return name
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function clampPercent(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round(Math.min(100, Math.max(0, value)))
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function newChecklist(jobId: number, startedAt: number): Checklist {
  return {
    jobId,
    title: DEFAULT_TITLE,
    phase: 'working',
    tasks: PLACEHOLDERS.map((name, i) => ({
      id: `placeholder-${i}`,
      name,
      status: i === 0 ? 'active' : 'upcoming',
      percent: 0,
      hasReported: false,
    })),
    isPlanned: false,
    needsYouReason: null,
    stuckReason: null,
    startedAt,
    finishedAt: null,
    isCollapsed: false,
  }
}

// Makes the first upcoming step active when nothing is active and steps remain.
export function ensureActive(tasks: Task[]): Task[] {
  if (tasks.some(t => t.status === 'active')) {
    return tasks
  }
  const next = tasks.findIndex(t => t.status === 'upcoming')

  return next === -1
    ? tasks
    : tasks.map((t, i) => (i === next ? { ...t, status: 'active', percent: 0, hasReported: false } : t))
}

// A report on a step checks off every step before it; 100 finishes it and starts the next.
export function applyProgress(tasks: Task[], rawName: string, percent: number, now: number): Task[] {
  const name = cleanName(rawName)
  let list = [...tasks]
  let index = list.findIndex(t => sameName(t.name, name))
  if (index === -1) {
    const active = list.findIndex(t => t.status === 'active')
    const lastDone = list.map(t => t.status).lastIndexOf('done')
    index = active !== -1 ? active + 1 : lastDone + 1
    list.splice(index, 0, { id: `added-${now}-${index}`, name, status: 'upcoming', percent: 0, hasReported: false })
  }
  list = list.map((t, i): Task => {
    if (i < index) {
      return { ...t, status: 'done', percent: 100 }
    }
    if (i === index) {
      return { ...t, status: 'active', percent, hasReported: true }
    }

    return t.status === 'active' ? { ...t, status: 'upcoming', percent: 0, hasReported: false } : t
  })
  if (percent >= 100) {
    list[index] = { ...list[index]!, status: 'done', percent: 100 }
    list = ensureActive(list)
  }

  return list
}

export function planTasks(names: string[], jobId: number): Task[] {
  return names.map((name, i) => ({
    id: `plan-${jobId}-${i}`,
    name,
    status: i === 0 ? 'active' : 'upcoming',
    percent: 0,
    hasReported: false,
  }))
}

export function uniqueNames(raw: readonly unknown[]): string[] {
  const names: string[] = []
  for (const one of raw) {
    const name = cleanName(one)
    if (!names.some(n => sameName(n, name))) {
      names.push(name)
    }
  }

  return names
}

export type ApiFailure = { kind: string; details: string }

export function apiErrorSentence(failure: ApiFailure | null, answer: string): string {
  const kind = failure?.kind ?? 'unknown'
  const text = `${failure?.details ?? ''} ${answer}`.toLowerCase()
  if (/prompt is too long|context (?:window|length|limit)|too many tokens|maximum context/.test(text)) {
    return 'the conversation is too long, type /compact and try again'
  }
  if (kind === 'rate_limit' || kind === 'billing_error' || /rate.?limit|usage limit|\b429\b/.test(text)) {
    return 'you hit your usage limit, try again a little later'
  }
  if (kind === 'overloaded' || kind === 'server_error' || /overloaded|\b529\b|\b5\d\d\b/.test(text)) {
    return "Claude's servers are busy, try again in a minute"
  }
  if (
    ['authentication_failed', 'oauth_org_not_allowed', 'cloud_credential_error', 'verification_required'].includes(kind) ||
    /\b401\b|unauthori[sz]ed|invalid api key|please run \/login|authentication/.test(text)
  ) {
    return 'you need to sign in again, type /login'
  }
  if (/network|econn|enotfound|etimedout|socket|fetch failed|connection|offline|timed out/.test(text)) {
    return 'the internet connection dropped'
  }

  return 'something went wrong reaching Claude, try again'
}

export const USER_SAID_NO = /doesn't want to proceed|does not want to proceed|user (?:rejected|declined|denied)|rejected by the user|denied by the user/i
export const INTERRUPTED = /interrupted/i

// What the model sent for one of our tools, read loosely.
export function argOf(e: unknown, key: string): unknown {
  return typeof e === 'object' && e !== null ? (e as Record<string, unknown>)[key] : undefined
}


// A tool is running again or the person answered: the wait is over.
export function resumed(c: Checklist | null): Checklist | null {
  return c !== null && c.phase === 'needsYou' ? { ...c, phase: 'working', needsYouReason: null } : c
}


export function fromTodos(c: Checklist, todos: readonly { content: string; status: string }[]): Checklist {
  const tasks = ensureActive(
    todos.map((todo, i): Task => {
      const name = cleanName(todo.content)
      const known = c.tasks.find(t => sameName(t.name, name))
      if (todo.status === 'completed') {
        return { id: `todo-${i}`, name, status: 'done', percent: 100, hasReported: true }
      }
      if (todo.status === 'in_progress') {
        return {
          id: `todo-${i}`,
          name,
          status: 'active',
          percent: known?.status === 'active' ? known.percent : 0,
          hasReported: known?.status === 'active' ? known.hasReported : false,
        }
      }

      return { id: `todo-${i}`, name, status: 'upcoming', percent: 0, hasReported: false }
    }),
  )

  return { ...c, tasks, isPlanned: tasks.length > 0 }
}

export function addTask(c: Checklist, id: string, subject: string): Checklist {
  const base = c.isPlanned ? c.tasks : []
  const tasks = ensureActive([
    ...base,
    { id: `task-${id}`, name: cleanName(subject), status: 'upcoming', percent: 0, hasReported: false },
  ])

  return { ...c, tasks, isPlanned: true }
}

export function updateTask(c: Checklist, id: string, status: unknown, subject: unknown): Checklist {
  const key = `task-${id}`
  if (!c.tasks.some(t => t.id === key)) {
    return c
  }
  if (status === 'deleted') {
    return { ...c, tasks: ensureActive(c.tasks.filter(t => t.id !== key)) }
  }
  let tasks = c.tasks.map(t => (t.id === key && typeof subject === 'string' ? { ...t, name: cleanName(subject) } : t))
  if (status === 'completed') {
    tasks = ensureActive(tasks.map(t => (t.id === key ? { ...t, status: 'done', percent: 100 } : t)))
  } else if (status === 'in_progress') {
    tasks = tasks.map((t): Task => {
      if (t.id === key) {
        return { ...t, status: 'active' }
      }

      return t.status === 'active' ? { ...t, status: 'upcoming' } : t
    })
  } else if (status === 'pending') {
    tasks = ensureActive(tasks.map(t => (t.id === key ? { ...t, status: 'upcoming', percent: 0 } : t)))
  }

  return { ...c, tasks }
}


export function filledMeter(percent: number, width = METER): string {
  const filled = Math.round((percent / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// A three-cell block sliding across the meter while no percent is reported.
export function sweepMeter(tick: number, width = METER): string {
  const start = (tick % (width + 3)) - 3
  let meter = ''
  for (let i = 0; i < width; i += 1) {
    meter += i >= start && i < start + 3 ? '█' : '░'
  }

  return meter
}
