import { test, expect, mock } from 'claude-code/testing'

import { applyStep, makeStep, unified } from '../hooks/diff'

const PLAN = 'mcp__cockpit__plan_steps'
const ROOT = 'D:/proj'

const lines = (n: number, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n'

test('a step is undone and redone on the file as it is now, even after later steps moved it', async () => {
  const v1 = lines(30)
  const v2 = v1.replace('line 5\n', 'line FIVE\n')
  const v3 = v2.replace('line 25\n', 'line 25\nadded after 25\n')
  const first = makeStep(1, 'a.ts', 'Edit', 0, v1, v2)!
  const second = makeStep(2, 'a.ts', 'Edit', 0, v2, v3)!
  expect(first.added).toBe(1)
  expect(first.removed).toBe(1)
  expect(unified(first).text).toMatch(/^@@ -2,7 \+2,7 @@\n line 2\n/)
  expect(unified(first).text).toContain('\n-line 5\n+line FIVE\n')

  // the first step taken out, the second one left in
  const undone = applyStep(v3, first, 'undo')
  expect(undone).toBe(v1.replace('line 25\n', 'line 25\nadded after 25\n'))
  // and put back
  expect(applyStep(undone!, first, 'redo')).toBe(v3)

  // a later edit over the same lines: the earlier step can no longer be found
  const v4 = v3.replace('line FIVE\n', 'line five again\n')
  expect(applyStep(v4, first, 'undo')).toBeNull()

  // no change, no step
  expect(makeStep(3, 'a.ts', 'Edit', 0, v1, v1)).toBeNull()
})

test('a created file undone goes back to nothing; CRLF lines survive the round trip', async () => {
  const made = makeStep(1, 'new.ts', 'Write', 0, null, 'one\r\ntwo\r\n')!
  expect(made.isNew).toBe(true)
  expect(applyStep('one\r\ntwo\r\n', made, 'undo')).toBe('')
  expect(applyStep('', made, 'redo')).toBe('one\r\ntwo\r\n')
  // drawn without the \r
  expect(unified(made).text).not.toContain('\r')
})

test('the changes pane steps through edits; accept keeps one, undo takes one out of the file', async ($, on) => {
  mock.store(on, { panelView: 'diff' })
  mock.clock(on, { now: 10 })
  on('session.root', () => ({ value: ROOT }))
  const files: Record<string, string> = { [`${ROOT}/a.ts`]: lines(20) }
  const key = (p: string) => p.replace(/\\/g, '/')
  on('fs.exists', ($, e) => ({ value: key(e.path) in files }))
  on('fs.read', ($, e) => (key(e.path) in files ? { value: files[key(e.path)]! } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($, e) => {
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  mock.env(on, { OS: 'Windows_NT' })
  const deleted: string[][] = []
  on('process.run', ($, e) => {
    deleted.push([...e.argv])
    delete files[key(e.argv[e.argv.length - 1]!)]
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  // stands for the engine's own file tools
  on('tool.call', ($, e) => {
    const input = e as unknown as { tool: string; file_path: string; old_string?: string; new_string?: string; content?: string }
    if (input.tool === 'Edit') files[key(input.file_path)] = files[key(input.file_path)]!.replace(input.old_string!, input.new_string!)
    if (input.tool === 'Write') files[key(input.file_path)] = input.content!
    return { result: {} } as never
  })

  // Clean View asks for a plan before any other tool
  await $.tool.call({ tool: PLAN, steps: ['Edit the files', 'Check them'] } as never)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'line 3\n', new_string: 'line three\n' } as never)
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.ts`, content: 'export const b = 1\n' } as never)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'line 18\n', new_string: 'line eighteen\n' } as never)

  const footer = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: [] },
  })
  expect((await footer.find({ key: 'open-changes' }))?.text).toBe('± changes (3)')
  await footer.unmount()

  const pane = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit-settings',
    props: { bodyColumns: 80 },
  } as never)
  expect((await pane.find({ key: 'changes-summary' }))?.text).toContain('3 to review')
  // the first step to review is shown first
  expect((await pane.find({ key: 'step-card-1' }))?.text).toContain('a.ts')

  // accept step 1: the pane moves on to step 2, the new file
  await pane.press({ key: 'accept-1' })
  expect(await pane.find({ key: 'step-card-2' })).toBeDefined()
  expect((await pane.find({ key: 'step-card-2' }))?.text).toContain('b.ts')

  // jump to step 3 and undo it: only that edit leaves a.ts
  await pane.press({ key: 'goto-3' })
  await pane.press({ key: 'undo-3' })
  expect(files[`${ROOT}/a.ts`]).toBe(lines(20).replace('line 3\n', 'line three\n'))
  expect((await pane.find({ key: 'changes-summary' }))?.text).toContain('1 to review · 1 accepted · 1 undone')

  // redo puts it back, then undo all takes out what is still pending
  await pane.press({ key: 'goto-3' })
  await pane.press({ key: 'redo-3' })
  expect(files[`${ROOT}/a.ts`]).toContain('line eighteen')
  await pane.press({ key: 'undo-all' })
  expect(files[`${ROOT}/a.ts`]).toBe(lines(20).replace('line 3\n', 'line three\n'))
  // the file the Write created is deleted again
  expect(deleted).toEqual([['cmd', '/d', '/c', 'del', '/f', '/q', 'D:\\proj\\b.ts']])
  expect(`${ROOT}/b.ts` in files).toBe(false)
  expect((await pane.find({ key: 'changes-summary' }))?.text).toContain('0 to review · 1 accepted · 2 undone')

  await pane.press({ key: 'clear-reviewed' })
  expect(await pane.find({ key: 'changes-summary' })).toBeUndefined()
  await pane.unmount()
})
