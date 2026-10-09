import { test, expect, mock } from 'claude-code/testing'

const ROOT = 'D:/proj'
const FILE = `---
description: 'Log work on a Jira ticket'
argument-hint: 'Ticket ID to log work on (e.g. P1794-123)'
---
Argument: $ARGUMENTS`

test('presets under a skill: save one by typing, run it, delete it; detect adds options', async ($, on) => {
  mock.store(on, { panelView: 'settings' })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.root', () => ({ value: ROOT }))
  on('command.list', () => ({
    value: [{ name: 'jira-worklog', description: 'Log work on a Jira ticket', source: 'user' }],
  }) as never)
  on('fs.list', ($, e) =>
    e.path.replace(/\\/g, '/') === `${ROOT}/.claude/commands`
      ? { value: [{ name: 'jira-worklog.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
      : { deny: 'ENOENT' },
  )
  on('fs.read', ($, e) =>
    e.path.replace(/\\/g, '/') === `${ROOT}/.claude/commands/jira-worklog.md` ? { value: FILE } : { deny: 'ENOENT' },
  )
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(String(e.prompt))
    return {
      value: {
        isAnswered: true,
        text: 'Here: [{"label":"Log a ticket","args":"P1794-XXX"},{"label":"Today","args":"today"}]',
        usage: {},
      },
    } as never
  })
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  const fills: string[] = []
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true, box: { text: e.text, cursor: e.text.length } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)

  const footer = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 70 },
  } as never)
  await footer.press({ key: 'open-quicky' })

  // closed until asked for
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeUndefined()
  await pane.press({ key: 'presets-toggle-jira-worklog' })

  // a typed parameter is saved and runs with the command in one press
  // the kit's mount handle has an input act its typing leaves out
  const typed = pane as unknown as { input: (target: object) => Promise<unknown> }
  await typed.input({ plugin: 'cockpit', key: 'preset-input-jira-worklog', text: 'P1794-123' })
  await pane.press({ key: 'preset-run-jira-worklog-P1794-123' })
  expect(ran).toEqual(['/jira-worklog P1794-123'])
  await pane.press({ key: 'preset-add-jira-worklog-P1794-123' })
  expect(fills).toEqual(['/jira-worklog P1794-123 '])
  expect((await pane.find({ key: 'presets-toggle-jira-worklog' }))?.text).toMatch(/hide presets/)

  // detect reads the skill file; a placeholder option can only be added, a complete one runs
  await pane.press({ key: 'detect-jira-worklog' })
  expect(asked[0]).toMatch(/argument-hint: 'Ticket ID/)
  expect(await pane.find({ key: 'preset-add-jira-worklog-P1794-XXX' })).toBeDefined()
  expect(await pane.find({ key: 'preset-run-jira-worklog-P1794-XXX' })).toBeUndefined()
  expect(await pane.find({ key: 'preset-run-jira-worklog-today' })).toBeDefined()

  await pane.press({ key: 'preset-del-jira-worklog-P1794-123' })
  expect(await pane.find({ key: 'preset-run-jira-worklog-P1794-123' })).toBeUndefined()

  // closed again, the count shows on the toggle
  await pane.press({ key: 'presets-toggle-jira-worklog' })
  expect((await pane.find({ key: 'presets-toggle-jira-worklog' }))?.text).toMatch(/presets \(2\)/)
  expect((await pane.find({ key: 'quick-jira-worklog' }))?.text).toMatch(/1 use/)

  // open by default: a command with presets shows them without a press; a press closes it
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-presetsOpen' })
  await footer.press({ key: 'open-quicky' })
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeDefined()
  await pane.press({ key: 'presets-toggle-jira-worklog' })
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeUndefined()
  await pane.press({ key: 'presets-toggle-jira-worklog' })
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeDefined()
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-presetsOpen' })
  await footer.press({ key: 'open-quicky' })

  // the card's switches: detect off keeps presets but drops its button; counts and presets off
  // take the count and the toggle away
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-detect' })
  await footer.press({ key: 'open-quicky' })
  await pane.press({ key: 'presets-toggle-jira-worklog' })
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeDefined()
  expect(await pane.find({ key: 'detect-jira-worklog' })).toBeUndefined()
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-counts' })
  await pane.press({ key: 'quicky-presets' })
  await footer.press({ key: 'open-quicky' })
  expect(await pane.find({ key: 'presets-toggle-jira-worklog' })).toBeUndefined()
  expect(await pane.find({ key: 'preset-input-jira-worklog' })).toBeUndefined()
  expect((await pane.find({ key: 'quick-jira-worklog' }))?.text).not.toMatch(/use/)
  await pane.unmount()
  await footer.unmount()
})
