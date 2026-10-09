import type { ConversationStatus, ConversationsConfig, ConversationsMax } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// a session left 'working' this long ago was cut off (a crash, a killed terminal)
export const STALE_MS = 2 * HOUR
// $.fs.read refuses anything bigger
export const MAX_READ = 4 * 1024 * 1024
export const MAX_LISTED = 40
const MAX_TITLE = 80

// what each session of this mod writes about itself, one file per session
export type ConversationNote = {
  status: ConversationStatus
  title: string | null
  updatedAt: number
}

// the folder Claude Code keeps a project's transcripts in, as it spells the path
export const projectDirName = (root: string) => root.replace(/[^a-zA-Z0-9]/g, '-')

// the Claude Code config directory, as Claude Code itself picks it
export const configDirOf = (env: { configDir?: string; home?: string }) =>
  env.configDir || (env.home ? `${env.home.replace(/[\\/]+$/, '')}/.claude` : null)

export const cleanTitle = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > MAX_TITLE ? `${one.slice(0, MAX_TITLE - 1)}…` : one
}

const lastRecord = (text: string, type: string, field: string): string | null => {
  const at = text.lastIndexOf(`{"type":"${type}"`)
  if (at < 0) return null
  const end = text.indexOf('\n', at)
  try {
    const value = JSON.parse(text.slice(at, end < 0 ? undefined : end))[field]
    return typeof value === 'string' && value.trim() !== '' ? cleanTitle(value) : null
  } catch {
    return null
  }
}

// a transcript's title the way /resume names it: a /rename first, then the generated one,
// then the last prompt; hasPrompt is false for a session that never ran one
export const parseTranscript = (text: string): { title: string | null; hasPrompt: boolean } => ({
  title:
    lastRecord(text, 'custom-title', 'customTitle') ??
    lastRecord(text, 'ai-title', 'aiTitle') ??
    lastRecord(text, 'last-prompt', 'lastPrompt'),
  hasPrompt: text.includes('"type":"user"') || text.includes('"type":"last-prompt"'),
})

export const statusOf = (note: ConversationNote | null, now: number): ConversationStatus => {
  if (note === null) return 'closed'
  const isLive = note.status === 'working' || note.status === 'waiting'
  if (isLive && now - note.updatedAt > STALE_MS) return 'closed'
  return note.status
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  working: 'working',
  waiting: 'needs you',
  idle: 'open',
  stopped: 'stopped',
  closed: 'closed',
}

export const ago = (then: number, now: number) => {
  const ms = Math.max(0, now - then)
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

export const fit = (text: string, width: number) =>
  width <= 1 ? '…' : text.length > width ? `${text.slice(0, width - 1)}…` : text

export const CONVERSATION_MAXES: readonly ConversationsMax[] = [5, 10, 20, 40]

export const DEFAULT_CONVERSATIONS_CONFIG: ConversationsConfig = {
  enabled: true,
  newButton: true,
  dots: true,
  legend: true,
  age: true,
  maxCount: 20,
}

// a stored config, missing fields filled in and a count outside the choices reset
export const loadConversationsConfig = (raw: unknown): ConversationsConfig => {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONVERSATIONS_CONFIG
  const c = { ...DEFAULT_CONVERSATIONS_CONFIG, ...(raw as Partial<ConversationsConfig>) }
  return CONVERSATION_MAXES.includes(c.maxCount) ? c : { ...c, maxCount: DEFAULT_CONVERSATIONS_CONFIG.maxCount }
}

export const nextMax = (n: ConversationsMax): ConversationsMax =>
  CONVERSATION_MAXES[(CONVERSATION_MAXES.indexOf(n) + 1) % CONVERSATION_MAXES.length] ?? 20
