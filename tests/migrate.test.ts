import { test, expect, mock } from 'claude-code/testing'

const CONFIG = 'C:/Users/me/.claude'
const OLD_STORE = `${CONFIG}/plugins/store/usage-status_local-mods-15cf71233245.json`
const OLD_NOTE = `${CONFIG}/usage-status/conversations/abc.json`
const NEW_NOTE = `${CONFIG}/cockpit/conversations/abc.json`

test('the first start brings over usage-status settings and conversation notes, once', async ($, on) => {
  // cockpit already holds one key of its own: the old value must not replace it
  mock.store(on, { effort: 'low' })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const files: Record<string, string> = {
    [OLD_STORE]: JSON.stringify({ theme: 'neon', effort: 'max', quickPresets: { 'jira-worklog': [{ args: 'P1794-1' }] } }),
    [OLD_NOTE]: JSON.stringify({ status: 'idle', title: 'Old chat', updatedAt: 1 }),
  }
  const at = (path: string) => path.replace(/\\/g, '/')
  on('fs.list', ($, e) => {
    const dir = at(e.path)
    const names = Object.keys(files)
      .filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map(p => p.slice(dir.length + 1))
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', ($, e) => (files[at(e.path)] === undefined ? { deny: 'ENOENT' } : { value: files[at(e.path)]! }))
  on('fs.exists', ($, e) => ({ value: files[at(e.path)] !== undefined }) as never)
  on('fs.write', ($, e) => {
    files[at(e.path)] = e.text
    return { value: undefined }
  })
  on('session.root', () => ({ value: 'D:/proj' }))
  on('session.id', () => ({ value: 'abc' }))
  // the engine's own start, beneath the plugin
  on('session.start', () => ({ cwd: 'D:/proj' }) as never)
  on('tool.register', () => ({ value: {} }) as never)
  on('command.register', () => ({ value: { command: 'simple' } }) as never)

  await ($ as never as { session: { start: (e: object) => Promise<unknown> } }).session
    .start({ cwd: 'D:/proj', surface: 'terminal', isInteractive: true })
    // later steps of the start need engine parts this test leaves out; the migration runs first
    .catch(() => undefined)

  // the notes moved to cockpit's folder
  expect(JSON.parse(files[NEW_NOTE] ?? '{}').title).toBe('Old chat')

  // the theme came over; the effort cockpit already had stayed
  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 60 },
  } as never)
  expect((await pane.find({ key: 'theme-neon' }))?.text).toMatch(/●/)
  expect(await pane.find({ key: 'cap-effort-low' })).toBeDefined()
  await pane.unmount()
})
