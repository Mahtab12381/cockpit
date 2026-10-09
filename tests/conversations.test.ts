import { test, expect, mock } from 'claude-code/testing'

import { parseTranscript, projectDirName, statusOf, ago } from '../hooks/conversations'

const HOME = 'C:/Users/me'
const ROOT = 'D:\\Projects\\Demo.app'
const DIR = `${HOME}/.claude/projects/D--Projects-Demo-app`
const NOTES = `${HOME}/.claude/cockpit/conversations`

const line = (o: object) => JSON.stringify(o)

test('titles, folder names and statuses', async () => {
  expect(projectDirName('D:\\Projects\\DMCI\\p1794.4_dmci_sales_ra')).toBe('D--Projects-DMCI-p1794-4-dmci-sales-ra')
  const text = [
    line({ type: 'user', message: { content: 'hi' } }),
    line({ type: 'ai-title', aiTitle: 'Old title' }),
    line({ type: 'ai-title', aiTitle: 'Fix the login bug' }),
  ].join('\n')
  expect(parseTranscript(text)).toEqual({ title: 'Fix the login bug', hasPrompt: true })
  expect(parseTranscript(`${text}\n${line({ type: 'custom-title', customTitle: 'Mine' })}`).title).toBe('Mine')
  expect(parseTranscript(line({ type: 'system' }))).toEqual({ title: null, hasPrompt: false })
  expect(statusOf(null, 0)).toBe('closed')
  expect(statusOf({ status: 'working', title: null, updatedAt: 0 }, 60_000)).toBe('working')
  expect(statusOf({ status: 'working', title: null, updatedAt: 0 }, 3 * 3_600_000)).toBe('closed')
  expect(ago(0, 2 * 3_600_000)).toBe('2h')
})

test('footer opens the conversations pane: new button, rows with dots, a press switches', async ($, on) => {
  mock.store(on)
  mock.env(on, { USERPROFILE: HOME })
  mock.clock(on, { now: 10 })
  const ran: string[] = []
  const files: Record<string, string> = {
    [`${DIR}/aaa.jsonl`]: [line({ type: 'user' }), line({ type: 'ai-title', aiTitle: 'Current work' })].join('\n'),
    [`${DIR}/bbb.jsonl`]: [line({ type: 'user' }), line({ type: 'ai-title', aiTitle: 'Earlier chat' })].join('\n'),
    [`${DIR}/ccc.jsonl`]: line({ type: 'system' }),
    [`${NOTES}/bbb.json`]: JSON.stringify({ status: 'idle', title: null, updatedAt: 1 }),
  }
  let sessionId = 'aaa'
  on('session.id', () => ({ value: sessionId }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => ({ value: [
    { name: 'aaa.jsonl', kind: 'file' as const, size: 10, mtimeMs: 3, isLink: false },
    { name: 'bbb.jsonl', kind: 'file' as const, size: 10, mtimeMs: 2, isLink: false },
    { name: 'ccc.jsonl', kind: 'file' as const, size: 10, mtimeMs: 1, isLink: false },
  ] }))
  on('fs.read', ($, e) => {
    // the engine hands paths over with this platform's separators
    const text = files[e.path.replace(/\\/g, '/')]
    if (text === undefined) return { deny: `ENOENT ${e.path}` }
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[e.path.replace(/\\/g, '/')] = e.text
    return { value: undefined }
  })
  const panes: string[] = []
  on('ui.open', ($, e) => {
    panes.push(`open ${e.id}`)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    panes.push(`close ${e.id}`)
    return { value: undefined } as never
  })
  on('command.run', ($, e) => {
    ran.push(`/${e.command} ${e.args}`.trim())
    // the engine swaps the session: resume takes the picked id, clear a fresh one
    sessionId = e.command === 'resume' ? e.args : 'fresh'
    return { text: '' }
  })

  const footer = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })
  expect((await footer.find({ key: 'open-conversations' }))?.text).toBe('✧ conversations')
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 40 },
  } as never)
  expect(await pane.find({ key: 'settings' })).toBeDefined()

  // both buttons open the one pane, so the dock never shows tabs; its content switches
  await footer.press({ key: 'open-conversations' })
  await footer.press({ key: 'open-settings' })
  await footer.press({ key: 'open-conversations' })
  expect(panes.filter(p => p.startsWith('open'))).toEqual([
    'open cockpit-settings',
    'open cockpit-settings',
    'open cockpit-settings',
  ])
  await footer.unmount()
  expect(await pane.find({ key: 'settings' })).toBeUndefined()
  expect(await pane.find({ key: 'new-conversation' })).toBeDefined()
  expect((await pane.find({ key: 'conversation-aaa' }))?.text).toMatch(/●\s*Current work/)
  expect((await pane.find({ key: 'conversation-bbb' }))?.text).toMatch(/●\s*Earlier chat/)
  // a session that never ran a prompt is left out
  expect(await pane.find({ key: 'conversation-ccc' })).toBeUndefined()
  // the current conversation is not a switch button
  expect(await pane.find({ key: 'switch-aaa' })).toBeUndefined()

  await pane.press({ key: 'switch-bbb' })
  // the picked conversation is marked current right after the switch, not one switch later
  expect(await pane.find({ key: 'switch-bbb' })).toBeUndefined()
  expect(await pane.find({ key: 'switch-aaa' })).toBeDefined()
  // the "here" row heads the list, whatever the others' times say
  const order = (await pane.find({ key: 'conversation-list' }))?.text ?? ''
  expect(order.indexOf('Earlier chat')).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('Earlier chat')).toBeLessThan(order.indexOf('Current work'))
  await pane.press({ key: 'new-conversation' })
  expect(ran).toEqual(['/resume bbb', '/clear'])
  await pane.unmount()
})

test('after /resume or /clear (fresh state, no session.start) the pane stays on conversations', async ($, on) => {
  mock.store(on, { panelView: 'conversations' })
  mock.env(on, { USERPROFILE: HOME })
  mock.clock(on, { now: 10 })
  on('session.id', () => ({ value: 'aaa' }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('fs.write', () => ({ value: undefined }))
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 40 },
  } as never)
  expect(await pane.find({ key: 'new-conversation' })).toBeDefined()
  expect(await pane.find({ key: 'settings' })).toBeUndefined()
  await pane.unmount()
})

test('the settings card turns the conversations pane and its parts off, and caps the list', async ($, on) => {
  mock.store(on, { panelView: 'settings' })
  mock.env(on, { USERPROFILE: HOME })
  mock.clock(on, { now: 10 })
  on('session.id', () => ({ value: 'c0' }))
  on('session.root', () => ({ value: ROOT }))
  // eight conversations, each with a prompt
  on('fs.list', () => ({
    value: Array.from({ length: 8 }, (_, i) => ({
      name: `c${i}.jsonl`,
      kind: 'file' as const,
      size: 10,
      mtimeMs: 100 - i,
      isLink: false,
    })),
  }))
  on('fs.read', ($, e) =>
    /\.jsonl$/.test(e.path)
      ? { value: [line({ type: 'user' }), line({ type: 'ai-title', aiTitle: `Chat ${e.path.slice(-7, -6)}` })].join('\n') }
      : { deny: 'ENOENT' },
  )
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)

  const mountPane = () =>
    $.ui.mount({
      plugin: 'cockpit',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'cockpit-settings',
      props: { bodyColumns: 50 },
    } as never)
  const settings = await mountPane()
  expect((await settings.find({ key: 'toggle-conversations' }))?.text).toMatch(/ON/)
  // the list shows up to 20 by default; one press steps to 40, then 5
  expect((await settings.find({ key: 'conv-maxCount' }))?.text).toMatch(/20/)
  await settings.press({ key: 'conv-maxCount' })
  await settings.press({ key: 'conv-maxCount' })
  expect((await settings.find({ key: 'conv-maxCount' }))?.text).toMatch(/\b5\b/)
  await settings.press({ key: 'conv-newButton' })
  await settings.press({ key: 'conv-dots' })
  await settings.press({ key: 'conv-age' })
  await settings.unmount()

  const footer = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })
  await footer.press({ key: 'open-conversations' })
  const pane = await mountPane()
  expect(await pane.find({ key: 'conversation-c0' })).toBeDefined()
  expect(await pane.find({ key: 'conversation-c4' })).toBeDefined()
  expect(await pane.find({ key: 'conversation-c5' })).toBeUndefined()
  expect(await pane.find({ key: 'new-conversation' })).toBeUndefined()
  expect(await pane.find({ key: 'legend' })).toBeUndefined()
  expect((await pane.find({ key: 'conversation-c1' }))?.text).not.toMatch(/●|\dm|\dh|\dd|now/)
  await pane.unmount()

  // the whole feature off: no footer button
  const card = await mountPane()
  await footer.press({ key: 'open-settings' })
  await card.press({ key: 'toggle-conversations' })
  expect(await footer.find({ key: 'open-conversations' })).toBeUndefined()
  expect(await footer.find({ key: 'open-settings' })).toBeDefined()
  await card.unmount()
  await footer.unmount()
})
