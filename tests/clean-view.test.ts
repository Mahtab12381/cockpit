import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cleanName } from '../hooks/clean-view'

const PLUGIN = 'cockpit'
const PLAN = 'mcp__cockpit__plan_steps'
const PROGRESS = 'mcp__cockpit__report_progress'
const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

// Stands in for the engine beneath the plugin.
function engine(on: On): void {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.Notification', () => ({}))
  // the engine's own band, drawn when the mod has nothing to show
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
}

async function bandText(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
}

test('names are cleaned into plain words', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('Update src/components/Footer.tsx styles')).toBe('Update styles')
  expect(cleanName('fix the header.tsx layout')).toBe('Fix the layout')
  const long = cleanName(
    'Rewrite every paragraph of the about page so it reads warmly and clearly for new visitors',
  )
  expect(long.length <= 40).toBe(true)
  expect(long.endsWith('…')).toBe(true)
  expect(cleanName('`npm run build`')).toBe('Working on it')
})

test('a to-do list and a 60% report draw the checklist rows', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  })
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 60 })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const text = await bandText(ui)
    expect(text).toContain('✓')
    expect(text).toContain('Read your brand notes')
    expect(text).toContain('Done')
    expect(text).toContain('▶')
    expect(text).toContain('▆▆▆▆▆▆▆▆▆▆')
    expect(text).toContain('60%')
    expect(text).toContain('Next')
    expect(text).toContain('Up next')
    await ui.unmount()
  }
})

test('the bar width in the Clean View card resizes the checklist meters', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] })
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 60 })

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: {},
  } as never)
  expect((await pane.find({ key: 'cv-barWidth' }))?.text).toMatch(/10/)
  await pane.press({ key: 'cv-barWidth' })
  expect((await pane.find({ key: 'cv-barWidth' }))?.text).toMatch(/15/)
  expect((await pane.find({ key: 'cv-barHeight' }))?.text).toMatch(/▆ tall/)
  await pane.press({ key: 'cv-barHeight' })
  expect((await pane.find({ key: 'cv-barHeight' }))?.text).toMatch(/█ full/)
  await pane.press({ key: 'cv-barHeight' })
  expect((await pane.find({ key: 'cv-barHeight' }))?.text).toMatch(/━ thin/)
  await pane.unmount()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const text = await bandText(ui)
    expect(text).toContain('━'.repeat(15))
    expect(text).toContain('60%')
    await ui.unmount()
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.classic.Notification({
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const text = await bandText(ui)
  expect(text).toContain('Needs you')
  expect(text).toContain('Claude needs your OK to continue')
  expect(text).toContain('‖')
  await ui.unmount()
})

test('/simple off hides the checklist', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.command.run({
    command: 'simple',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const text = await bandText(ui)
  expect(text).not.toContain('Understand your request')
  await ui.unmount()
})

test('plan_steps then report_progress at 100 starts step two', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const planned = await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  expect(planned.result).toBe('Planned 2 steps. The first one has started.')
  const reported = await $.tool.call({ tool: PROGRESS, task: 'Read your brand notes', percent: 140 })
  expect(reported.result).toBe('Progress noted: 100%.')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const rows = await ui.findAll({ type: 'Box' })
  const first = rows.find(r => r.key === 'plan-1-0')
  const second = rows.find(r => r.key === 'plan-1-1')
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  const text = await bandText(ui)
  expect(text).toMatch(/✓[\s\S]*Read your brand notes[\s\S]*Done/)
  expect(text).toMatch(/▶[\s\S]*Build the pricing section[\s\S]*Working/)
  await ui.unmount()
})

test('tools are denied before a plan and allowed after', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const before = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(before.deny).toContain('plan_steps')
  const search = await $.tool.call({ tool: 'ToolSearch', query: 'select:x', max_results: 1 })
  expect(search.deny).toBeUndefined()
  await $.tool.call({ tool: PLAN, steps: ['Look around', 'Build the page'] })
  const after = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(after.deny).toBeUndefined()
})

test('a finished job shows All done, then shrinks to one line after 5 seconds', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the page'] })
  await $.tool.call({ tool: PROGRESS, task: 'Build the page', percent: 100 })
  await clock.advance(134_000)
  await $.turn.complete({ answer: 'Done.', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandText(ui)).toContain('✓ All done')
  expect(await bandText(ui)).toContain('took 2m 14s')
  expect(await bandText(ui)).toContain('Read your brand notes')
  await clock.advance(5_000)
  expect(await bandText(ui)).not.toContain('Read your brand notes')
  expect(await bandText(ui)).toContain('✓ All done')
  await ui.unmount()
})

test('tool rows are hidden while Clean View is on', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 'x', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  const box = await ui.find({ type: 'Box' })
  expect(box?.props.display).toBe('none')
  await ui.unmount()
})

test('the settings pane switches Clean View under the status line', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: {},
  } as never)
  expect((await pane.find({ key: 'toggle-clean-view' }))?.text).toMatch(/ON/)
  await pane.press({ key: 'toggle-clean-view' })
  expect((await pane.find({ key: 'toggle-clean-view' }))?.text).toMatch(/OFF/)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandText(band)).not.toContain('Understand your request')
  await band.unmount()
  await pane.press({ key: 'toggle-clean-view' })
  await pane.unmount()
})
