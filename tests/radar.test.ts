import { test, expect, mock } from 'claude-code/testing'

import { addFlag, loadRadarItems, shownItems } from '../hooks/radar'

const FLAG = 'mcp__cockpit__flag_issue'
const PLAN = 'mcp__cockpit__plan_steps'
const ROOT = 'D:/proj'
// the plugin's store, kept here so the test can read what the radar saved
const fakeStore = (on: Parameters<typeof mock.store>[0], entries: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = { ...entries }
  on('store.get', ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', ($, e) => {
    store[e.key] = e.value
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  return store
}


test('a flag adds an item; the same title while open updates it; the list sorts by severity', async () => {
  const one = addFlag([], { title: '  Token  never expires ', kind: 'risk', severity: 'high', file: 'auth.ts:12' }, 'claude', 'a', 1)
  expect(one.isNew).toBe(true)
  expect(one.item).toMatchObject({ title: 'Token never expires', kind: 'risk', severity: 'high', file: 'auth.ts:12', status: 'open' })
  const two = addFlag(one.items, { title: 'Unused import', kind: 'nonsense', severity: 'low' }, 'claude', 'b', 2)
  // an unknown kind becomes a note
  expect(two.item?.kind).toBe('note')
  const again = addFlag(two.items, { title: 'token never expires', detail: 'set an expiry', kind: 'risk', severity: 'medium' }, 'claude', 'c', 3)
  expect(again.isNew).toBe(false)
  expect(again.items).toHaveLength(2)
  expect(again.item).toMatchObject({ id: 'a', detail: 'set an expiry', severity: 'medium', file: 'auth.ts:12' })
  // no title, nothing added
  expect(addFlag(again.items, { title: '   ' }, 'me', 'd', 4).item).toBeNull()

  const items = again.items.map(i => (i.id === 'b' ? { ...i, severity: 'high' as const } : i))
  expect(shownItems(items, 'open', 'severity').map(i => i.id)).toEqual(['b', 'a'])
  expect(shownItems(items, 'open', 'newest').map(i => i.id)).toEqual(['b', 'a'])
  expect(shownItems(items, 'closed', 'severity')).toEqual([])
  // junk in the store is dropped
  expect(loadRadarItems([{ id: 'x' }, null, { id: 'y', title: 'ok' }]).map(i => i.id)).toEqual(['y'])
})

test("Claude's flags land on the radar, with a toast; the pane marks done, dismisses and reopens", async ($, on) => {
  const store = fakeStore(on, { panelView: 'radar' })
  mock.clock(on, { now: 10 })
  on('session.root', () => ({ value: ROOT }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(String(e.text))
    return { value: undefined } as never
  })
  const fills: string[] = []
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true, box: { text: e.text, cursor: e.text.length } } as never
  })
  on('tool.call', () => ({ result: 'Planned.' }) as never)

  // allowed before a plan: Clean View lets the flag tool through
  const first = await $.tool.call({ tool: FLAG, title: 'Password logged in plain text', kind: 'bug', severity: 'high', file: 'src/login.ts:40', detail: 'The debug log prints it.' } as never)
  expect(JSON.stringify(first)).toContain('Flagged on the radar')
  await $.tool.call({ tool: PLAN, steps: ['Do the task', 'Check it'] } as never)
  await $.tool.call({ tool: FLAG, title: 'Two date formats in the API', kind: 'inconsistency', severity: 'low', in_scope: true } as never)
  expect(toasts).toEqual(['◎ Radar: Password logged in plain text', '◎ Radar: Two date formats in the API'])

  const footer = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ key: 'open-radar' }))?.text).toBe('◎ radar (2)')
  await footer.unmount()

  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 80 },
  } as never)
  const list = (await pane.find({ key: 'radar-list' }))?.text ?? ''
  // high before low
  expect(list.indexOf('Password logged')).toBeLessThan(list.indexOf('Two date formats'))
  expect(list).toContain('src/login.ts:40')
  expect(list).toContain('in this task')

  const ids = store['radar:D--proj'] as { id: string; title: string }[]
  const pw = ids.find(i => i.title.startsWith('Password'))!.id
  const dates = ids.find(i => i.title.startsWith('Two date'))!.id

  // fix puts a request in the prompt box
  await pane.press({ key: `radar-fix-${pw}` })
  expect(fills[0]).toContain('Fix this bug from the radar: Password logged in plain text')

  await pane.press({ key: `radar-done-${pw}` })
  await pane.press({ key: `radar-dismiss-${dates}` })
  expect(await pane.find({ key: 'radar-list' })).toBeUndefined()
  expect((await pane.find({ key: 'radar-summary' }))?.text).toContain('0 open · 2 closed')

  // the closed view reopens one
  await pane.press({ key: 'radar-filter-closed' })
  await pane.press({ key: `radar-reopen-${dates}` })
  expect((await pane.find({ key: 'radar-summary' }))?.text).toContain('1 open · 1 closed')

  // a note of my own, then the closed one cleared
  await pane.press({ key: 'radar-filter-all' })
  await pane.input({ key: 'radar-add', text: 'Ask the team about the retry policy' })
  expect((await pane.find({ key: 'radar-list' }))?.text).toContain('Ask the team about the retry policy')
  await pane.press({ key: 'radar-clear-closed' })
  expect((await pane.find({ key: 'radar-summary' }))?.text).toContain('2 open · 0 closed')
  await pane.unmount()
})

test('with Claude flagging off, the flag tool adds nothing', async ($, on) => {
  const store = fakeStore(on, { radarConfig: { autoFlag: false } })
  mock.clock(on, { now: 10 })
  on('session.root', () => ({ value: ROOT }))
  const res = await $.tool.call({ tool: FLAG, title: 'Something', kind: 'bug', severity: 'low' } as never)
  expect(JSON.stringify(res)).toContain('radar is off')
  expect(store['radar:D--proj']).toBeUndefined()
})
