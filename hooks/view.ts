import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { BarHeight, View } from '../types'

export type Figures = { context: SessionContextUsage; rateLimits: SessionRateLimit[] }

const MINUTE = 60_000

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

const pad = (n: number) => String(n).padStart(2, '0')

// 12-hour clock, e.g. 2:30 PM
const clock12 = (at: Date) => {
  const h = at.getHours()
  return `${h % 12 || 12}:${pad(at.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`
}

const countdown = (ms: number) => {
  const mins = Math.max(0, Math.ceil(ms / MINUTE))
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h${pad(mins % 60)}m` : `${mins}m`
}

export const toView = (model: string, { context, rateLimits }: Figures, now: number): View => {
  const fiveHour = rateLimits.find(r => r.kind === 'five_hour')
  const at = fiveHour?.resetsAt ? new Date(fiveHour.resetsAt) : null

  return {
    model,
    contextWindow: kTokens(context.window),
    context:
      context.tokens === undefined
        ? null
        : {
            percent: context.percent ?? Math.round((context.tokens / context.window) * 100),
            detail: `${kTokens(context.tokens)}/${kTokens(context.window)}`,
          },
    fiveHour: fiveHour
      ? {
          percent: fiveHour.percentUsed,
          detail: `${Math.max(0, Math.round((100 - fiveHour.percentUsed) * 10) / 10)}% left`,
          resetAt: at ? clock12(at) : null,
          resetIn: at ? countdown(at.getTime() - now) : null,
        }
      : null,
  }
}

// used% → theme color
export const tone = (used: number) => (used >= 85 ? 'error' : used >= 60 ? 'warning' : 'success')

export const BAR_HEIGHTS: readonly BarHeight[] = ['thin', 'half', 'tall', 'full']

// the glyph each height draws its cells with
export const BAR_GLYPH: Record<BarHeight, string> = { thin: '━', half: '▄', tall: '▆', full: '█' }

// a stored height, or the fallback when it is missing or not one of the choices
export const loadBarHeight = (raw: unknown, fallback: BarHeight): BarHeight =>
  BAR_HEIGHTS.includes(raw as BarHeight) ? (raw as BarHeight) : fallback

export const bar = (used: number, cells = 10, glyph = BAR_GLYPH.thin) => {
  const filled = Math.min(cells, Math.max(0, Math.round((used / 100) * cells)))
  return { filled: glyph.repeat(filled), empty: glyph.repeat(cells - filled) }
}
