import { test, expect, mock } from 'claude-code/testing'

test('Quicky lists only my own skills and runs one with a press; the card turns it off', async ($, on) => {
  mock.store(on, { panelView: 'settings' })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.root', () => ({ value: 'D:/proj' }))
  // my files: two project commands; the home skills folder holds only the org's synced ones
  on('fs.list', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path === 'D:/proj/.claude/commands')
      return { value: ['daily-report.md', 'push-to-gerrit.md'].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
    if (path === 'C:/Users/me/.claude/skills')
      return { value: [{ name: 'synced', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    return { deny: 'ENOENT' }
  })
  const ran: string[] = []
  // the transcripts: each run is recorded as the engine does; git grep reads them back
  let transcript = ''
  const grepArgs: string[][] = []
  on('process.run', ($, e) => {
    grepArgs.push([...e.argv])
    return { value: { exitCode: 0, stdout: transcript, stderr: '' } } as never
  })
  on('command.list', () => ({
    value: [
      { name: 'push-to-gerrit', description: 'Push code changes to Gerrit for code review', source: 'user' },
      { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
      { name: 'daily-report', description: 'Generate the daily report', source: 'user' },
      // an organization's synced skill: the engine says `user`, but it is not mine
      { name: 'docx', description: 'Word documents', source: 'user' },
      { name: 'simple', description: 'Turn Clean View on or off', source: 'plugin', plugin: 'cockpit' },
    ],
  }) as never)
  on('command.run', ($, e) => {
    ran.push(`/${e.command} ${e.args}`.trim())
    // recorded as the engine records a built-in's run
    transcript += `{"message":{"content":"<command-name>/${e.command}</command-name>"}}\n`
    return { text: '' }
  })
  const fills: string[] = []
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true, box: { text: e.text, cursor: e.text.length } } as never
  })
  const panes: string[] = []
  on('ui.open', ($, e) => {
    panes.push(`open ${e.id}${e.focus ? '' : ' nofocus'}`)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    panes.push(`close ${e.id}`)
    return { value: undefined } as never
  })

  const footer = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })
  expect((await footer.find({ key: 'open-quicky' }))?.text).toBe('✶ quicky')
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 50 },
  } as never)
  await footer.press({ key: 'open-quicky' })

  // my own skills (never used yet, so A to Z), with descriptions; built-ins and plugins' left out
  const list = (await pane.find({ key: 'quick-list' }))?.text ?? ''
  expect(list.indexOf('Daily report')).toBeGreaterThanOrEqual(0)
  expect(list.indexOf('Daily report')).toBeLessThan(list.indexOf('Push to gerrit'))
  expect(list).toMatch(/Push code changes to Gerrit/)
  expect(await pane.find({ key: 'run-clear' })).toBeUndefined()
  expect(await pane.find({ key: 'run-simple' })).toBeUndefined()
  expect(await pane.find({ key: 'run-docx' })).toBeUndefined()

  // plain names, no slash
  expect(list).not.toMatch(/\/daily-report/)
  // add: the command goes into the prompt, and the pane reopens without the keys
  await pane.press({ key: 'add-daily-report' })
  expect(fills).toEqual(['/daily-report '])
  expect(panes.slice(-2)).toEqual(['close cockpit-settings', 'open cockpit-settings nofocus'])
  expect(ran).toEqual([])

  await pane.press({ key: 'run-push-to-gerrit' })
  expect(ran).toEqual(['/push-to-gerrit'])
  expect(grepArgs[0]?.slice(0, 2)).toEqual(['git', 'grep'])
  // most used first: one run lifts it above the never-used one, with its count
  const ranked = (await pane.find({ key: 'quick-list' }))?.text ?? ''
  expect(ranked.indexOf('Push to gerrit')).toBeLessThan(ranked.indexOf('Daily report'))
  expect((await pane.find({ key: 'quick-push-to-gerrit' }))?.text).toMatch(/1 use(?!s)/)

  // typed runs count too: two of /daily-report put it on top
  await $.command.run({ command: 'daily-report', args: '' } as never)
  await $.command.run({ command: 'daily-report', args: '' } as never)
  const retyped = (await pane.find({ key: 'quick-list' }))?.text ?? ''
  expect(retyped.indexOf('Daily report')).toBeLessThan(retyped.indexOf('Push to gerrit'))
  expect((await pane.find({ key: 'quick-daily-report' }))?.text).toMatch(/2 uses/)

  // the "show" filter in the card: all lists built-ins too, most used only what ran
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-show-all' })
  await footer.press({ key: 'open-quicky' })
  expect(await pane.find({ key: 'run-clear' })).toBeDefined()
  expect(await pane.find({ key: 'run-simple' })).toBeDefined()
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-show-top' })
  await footer.press({ key: 'open-quicky' })
  expect(await pane.find({ key: 'run-daily-report' })).toBeDefined()
  expect(await pane.find({ key: 'run-push-to-gerrit' })).toBeDefined()
  expect(await pane.find({ key: 'run-clear' })).toBeUndefined()
  // a typed built-in counts too, and joins most used
  await $.command.run({ command: 'clear', args: '' } as never)
  expect(await pane.find({ key: 'run-clear' })).toBeDefined()
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-show-mine' })

  // the card: descriptions off, then Quicky off takes the footer button away
  await footer.press({ key: 'open-settings' })
  await pane.press({ key: 'quicky-descriptions' })
  await pane.press({ key: 'toggle-quicky' })
  expect(await footer.find({ key: 'open-quicky' })).toBeUndefined()
  await pane.press({ key: 'toggle-quicky' })
  await footer.press({ key: 'open-quicky' })
  expect((await pane.find({ key: 'quick-list' }))?.text ?? '').not.toMatch(/Push code changes/)
  await pane.unmount()
  await footer.unmount()
})
