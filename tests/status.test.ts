import { test, expect } from 'claude-code/testing'
import { bar, tone, toView } from '../hooks/view'

test('builds the view for model, context and the 5-hour window', async () => {
  const now = Date.parse('2026-10-08T10:00:00Z')
  const resetsAt = new Date(now + 72 * 60_000).toISOString()
  const v = toView(
    'Opus 5.5',
    {
      context: { tokens: 90_000, window: 200_000, percent: 45 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 28, resetsAt }],
    },
    now,
  )
  expect(v.model).toBe('Opus 5.5')
  expect(v.context).toEqual({ percent: 45, detail: '90k/200k' })
  expect(v.fiveHour?.detail).toBe('72% left')
  expect(v.fiveHour?.resetIn).toBe('1h12m')
  expect(v.fiveHour?.resetAt).toMatch(/^(1[0-2]|[1-9]):\d\d (AM|PM)$/)
})

test('empty before any figures arrive', async () => {
  const v = toView('Sonnet 5.5', { context: { window: 1_000_000 }, rateLimits: [] }, 0)
  expect(v.context).toBeNull()
  expect(v.fiveHour).toBeNull()
  expect(v.contextWindow).toBe('1.0M')
})

test('bars and tones follow usage', async () => {
  expect(bar(45).filled.length).toBe(5)
  expect(bar(45).empty.length).toBe(5)
  expect(tone(30)).toBe('success')
  expect(tone(70)).toBe('warning')
  expect(tone(90)).toBe('error')
})
