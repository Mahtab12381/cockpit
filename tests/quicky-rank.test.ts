import { test, expect } from 'claude-code/testing'

import {
  commandNames,
  countCommandRuns,
  loadUsage,
  mergePresets,
  needsValue,
  parseDetected,
  pickQuick,
  quickTitle,
  rankQuick,
  skillNames,
} from '../hooks/quicky'

test('ranks by uses, then A to Z; bad stored counts are dropped', async () => {
  const cmds = [
    { name: 'b', description: '', source: 'user', isMine: true },
    { name: 'a', description: '', source: 'builtin' },
    { name: 'c', description: '', source: 'user', isMine: true },
    { name: 'd', description: '', source: 'user', isMine: false },
  ]
  expect(rankQuick(cmds, { c: 3, b: 1 }).map(c => c.name)).toEqual(['c', 'b', 'a', 'd'])
  expect(rankQuick(cmds, {}).map(c => c.name)).toEqual(['a', 'b', 'c', 'd'])
  expect(loadUsage({ a: 2, b: 'x', c: -1, d: 1.7 })).toEqual({ a: 2, d: 1 })
  expect(loadUsage(null)).toEqual({})
  const ranked = rankQuick(cmds, { c: 3, a: 1 })
  expect(pickQuick(ranked, 'mine').map(c => c.name)).toEqual(['c', 'b'])
  expect(pickQuick(ranked, 'top').map(c => c.name)).toEqual(['c', 'a'])
  expect(pickQuick(ranked, 'all').map(c => c.name)).toEqual(['c', 'a', 'b', 'd'])
  const f = (name: string, kind: string) => ({ name, kind })
  expect(commandNames([f('x.md', 'file'), f('notes.txt', 'file'), f('sub', 'dir')])).toEqual(['x'])
  expect(skillNames([f('mine', 'dir'), f('synced', 'dir'), f('README.md', 'file')])).toEqual(['mine'])
})

test('counts slash command runs recorded in transcript text', async () => {
  // real records as the jsonl holds them (a skill's, a built-in's), then the same tags quoted
  // inside a tool's output and in prose, which are not runs
  const text = [
    String.raw`{"message":{"content":"<command-message>push-to-gerrit</command-message>\n<command-name>/push-to-gerrit</command-name>"}}`,
    String.raw`{"message":{"content":"<command-name>/reload-plugins</command-name>\n  <command-message>reload-plugins</command-message>"}}`,
    String.raw`{"message":{"content":"<command-message>push-to-gerrit</command-message>\n<command-name>/push-to-gerrit</command-name>"}}`,
    String.raw`{"tool_result":"grep: \"content\":\"<command-name>/push-to-gerrit</command-name>"}`,
    'just <command-name>/generate-bat</command-name> in prose',
  ].join('\n')
  expect(countCommandRuns(text)).toEqual({ 'push-to-gerrit': 2, 'reload-plugins': 1 })
})

test('a command name becomes plain words, a plugin namespace kept apart', async () => {
  expect(quickTitle('jira-create-and-log')).toEqual({ title: 'Jira create and log', namespace: null })
  expect(quickTitle('engineering:code-review')).toEqual({ title: 'Code review', namespace: 'engineering' })
})

test('detected presets: first JSON array, placeholders marked, duplicates and junk dropped', async () => {
  const found = parseDetected('ok [{"label":"Ticket","args":"P1794-XXX"},{"args":"my changes"},{"args":"my changes"},{"label":"x"}] done')
  expect(found).toEqual([
    { label: 'Ticket', args: 'P1794-XXX', needsValue: true, source: 'detected' },
    { label: 'my changes', args: 'my changes', needsValue: false, source: 'detected' },
  ])
  expect(parseDetected('no json here')).toEqual([])
  expect(mergePresets(found, found.slice(1)).length).toBe(2)
  expect(needsValue('<description>')).toBe(true)
  expect(needsValue('P1794-123')).toBe(false)
})
