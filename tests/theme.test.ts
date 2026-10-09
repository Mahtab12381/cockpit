import { expect, mock, test } from 'claude-code/testing'

// the color of the title's first ✦, the start of the theme's gradient
async function firstColor(pane: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  return (await pane.findAll({ type: 'Text' })).find(t => t.text === '✦')?.props.color
}

test('the theme row switches the gradient and remembers the pick', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: {},
  } as never)

  for (const key of ['theme-aurora', 'theme-sunset', 'theme-ocean', 'theme-forest', 'theme-neon']) {
    expect(await pane.find({ key })).toBeDefined()
  }
  // aurora is picked by default: its chip is drawn, the others are buttons
  expect((await pane.find({ key: 'theme-aurora' }))?.type).toBe('Box')
  expect((await firstColor(pane))).toBe('#22d3ee')

  await pane.press({ key: 'theme-ocean' })
  expect((await pane.find({ key: 'theme-ocean' }))?.type).toBe('Box')
  expect((await pane.find({ key: 'theme-aurora' }))?.type).toBe('Button')
  expect((await firstColor(pane))).toBe('#38bdf8')

  await pane.press({ key: 'theme-aurora' })
  await pane.unmount()
})
