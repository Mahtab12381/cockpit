import { test, expect, mock } from 'claude-code/testing'

test('model & effort panel has no on/off toggle and picks an effort', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'cockpit',
      surface,
      component: 'Pane',
      requestId: 'cockpit-settings',
      props: {},
    } as never)

    expect(await pane.find({ key: 'toggle-model-effort' })).toBeUndefined()
    for (const key of ['model-opus', 'model-sonnet', 'model-haiku', 'model-fable']) {
      expect(await pane.find({ key })).toBeDefined()
    }
    for (const key of ['effort-auto', 'effort-low', 'effort-medium', 'effort-high', 'effort-xhigh', 'effort-max']) {
      expect(await pane.find({ key })).toBeDefined()
    }

    expect((await pane.find({ key: 'effort-auto' }))?.type).toBe('Box')
    await pane.press({ key: 'effort-high' })
    expect((await pane.find({ key: 'effort-high' }))?.type).toBe('Box')
    expect((await pane.find({ key: 'effort-auto' }))?.type).toBe('Button')
    await pane.press({ key: 'effort-auto' })

    await pane.press({ key: 'model-sonnet' })
    expect((await pane.find({ key: 'model-sonnet' }))?.type).toBe('Box')
    expect((await pane.find({ key: 'model-opus' }))?.type).toBe('Button')
    await pane.press({ key: 'model-opus' })

    await pane.unmount()
  }
})
