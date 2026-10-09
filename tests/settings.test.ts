import { test, expect, mock } from 'claude-code/testing'

test('footer shows the settings button and the pane toggles the status line', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const footer = await $.ui.mount({
      plugin: 'cockpit',
      surface,
      component: 'SessionMode',
      props: { modes: ['auto mode on'] },
    })
    expect(await footer.find({ type: 'Text', text: /auto mode on/ })).toBeDefined()
    expect(await footer.find({ key: 'open-settings' })).toBeDefined()
    await footer.unmount()

    const pane = await $.ui.mount({
      plugin: 'cockpit',
      surface,
      component: 'Pane',
      requestId: 'cockpit-settings',
      props: {},
    } as never)
    expect(await pane.find({ key: 'toggle-status-line' })).toBeDefined()
    await pane.press({ key: 'toggle-status-line' })
    expect((await pane.find({ key: 'toggle-status-line' }))?.text).toMatch(/off/i)
    await pane.press({ key: 'toggle-status-line' })
    await pane.unmount()
  }
})

test('status line options toggle, cycle the bar width, and hide while the status line is off', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'cockpit',
      surface,
      component: 'Pane',
      requestId: 'cockpit-settings',
      props: {},
    } as never)

    for (const key of ['cfg-model', 'cfg-context', 'cfg-fiveHour', 'cfg-reset', 'cfg-bars', 'cfg-barWidth']) {
      expect(await pane.find({ key })).toBeDefined()
    }

    await pane.press({ key: 'cfg-model' })
    expect((await pane.find({ key: 'cfg-model' }))?.text).toMatch(/off/)
    await pane.press({ key: 'cfg-model' })
    expect((await pane.find({ key: 'cfg-model' }))?.text).toMatch(/on/)

    expect((await pane.find({ key: 'cfg-barWidth' }))?.text).toMatch(/10/)
    await pane.press({ key: 'cfg-barWidth' })
    expect((await pane.find({ key: 'cfg-barWidth' }))?.text).toMatch(/15/)
    await pane.press({ key: 'cfg-barWidth' })
    expect((await pane.find({ key: 'cfg-barWidth' }))?.text).toMatch(/5/)
    await pane.press({ key: 'cfg-barWidth' })

    expect((await pane.find({ key: 'cfg-barHeight' }))?.text).toMatch(/━ thin/)
    await pane.press({ key: 'cfg-barHeight' })
    expect((await pane.find({ key: 'cfg-barHeight' }))?.text).toMatch(/▄ half/)
    for (let i = 0; i < 3; i += 1) await pane.press({ key: 'cfg-barHeight' })
    expect((await pane.find({ key: 'cfg-barHeight' }))?.text).toMatch(/━ thin/)

    await pane.press({ key: 'toggle-status-line' })
    expect(await pane.find({ key: 'cfg-model' })).toBeUndefined()
    await pane.press({ key: 'toggle-status-line' })
    await pane.unmount()
  }
})

test('the weekly limit and its reset time switch on and off from the status line card', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: {},
  } as never)
  expect((await pane.find({ key: 'cfg-weekly' }))?.text).toMatch(/on/)
  expect((await pane.find({ key: 'cfg-weeklyReset' }))?.text).toMatch(/on/)
  await pane.press({ key: 'cfg-weekly' })
  expect((await pane.find({ key: 'cfg-weekly' }))?.text).toMatch(/off/)
  await pane.press({ key: 'cfg-weeklyReset' })
  expect((await pane.find({ key: 'cfg-weeklyReset' }))?.text).toMatch(/off/)
  await pane.unmount()
})
