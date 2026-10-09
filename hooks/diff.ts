import type { DiffConfig, DiffHunk, DiffStep } from '../types'

// lines of unchanged text kept around each change
export const CONTEXT = 3
// past this many edits two texts count as rewritten: all removed, all added
const MAX_EDITS = 2000
// the most diff lines the pane draws for one step
export const MAX_SHOWN_LINES = 400

export const DEFAULT_DIFF_CONFIG: DiffConfig = { enabled: true, hideReviewed: false }

export const loadDiffConfig = (raw: unknown): DiffConfig =>
  raw && typeof raw === 'object' ? { ...DEFAULT_DIFF_CONFIG, ...(raw as Partial<DiffConfig>) } : DEFAULT_DIFF_CONFIG

type Op = { kind: ' ' | '-' | '+'; text: string }

// split on \n only, so a \r stays on its line and a join gives the text back byte for byte
export const splitLines = (text: string) => text.split('\n')

const same = (lines: readonly string[]): Op[] => lines.map(text => ({ kind: ' ', text }))
const removed = (lines: readonly string[]): Op[] => lines.map(text => ({ kind: '-', text }))
const added = (lines: readonly string[]): Op[] => lines.map(text => ({ kind: '+', text }))

// Myers' shortest edit script; each round keeps only the diagonals it can reach (O(D²) memory)
function myers(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0) return added(b)
  if (m === 0) return removed(a)
  const max = Math.min(n + m, MAX_EDITS)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  // trace[d][k + d + 1]: v as it stood when round d began, for k in -d-1 … d+1
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b)
    }
  }
  return [...removed(a), ...added(b)]
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = []
  let x = a.length
  let y = b.length
  for (let d = trace.length - 1; d >= 0; d--) {
    const at = (k: number) => trace[d]![k + d + 1]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ kind: ' ', text: a[x - 1]! })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: '+', text: b[y - 1]! })
      else ops.push({ kind: '-', text: a[x - 1]! })
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

// a line diff of two texts, the common start and end trimmed before the search
export function diffLines(before: string, after: string): Op[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return [...same(a.slice(0, start)), ...myers(a.slice(start, endA), b.slice(start, endB)), ...same(a.slice(endA))]
}

// the edit script cut into hunks, CONTEXT unchanged lines around each run of changes
export function toHunks(ops: readonly Op[], context = CONTEXT): DiffHunk[] {
  const oldNo: number[] = []
  const newNo: number[] = []
  let o = 1
  let n = 1
  for (const op of ops) {
    oldNo.push(o)
    newNo.push(n)
    if (op.kind !== '+') o++
    if (op.kind !== '-') n++
  }
  const changes = ops.flatMap((op, i) => (op.kind === ' ' ? [] : [i]))
  const hunks: DiffHunk[] = []
  let i = 0
  while (i < changes.length) {
    let last = changes[i]!
    let j = i + 1
    // changes closer than two contexts apart share one hunk
    while (j < changes.length && changes[j]! - last <= 2 * context + 1) last = changes[j++]!
    const from = Math.max(0, changes[i]! - context)
    const to = Math.min(ops.length, last + 1 + context)
    const slice = ops.slice(from, to)
    hunks.push({
      oldStart: oldNo[from]!,
      oldLines: slice.filter(op => op.kind !== '+').length,
      newStart: newNo[from]!,
      newLines: slice.filter(op => op.kind !== '-').length,
      lines: slice.map(op => op.kind + op.text),
    })
    i = j
  }
  return hunks
}

// one recorded change: what a file tool did to `path`, as hunks; null when nothing changed
export function makeStep(
  id: number,
  path: string,
  tool: string,
  at: number,
  before: string | null,
  after: string,
): DiffStep | null {
  if (before === after) return null
  const ops = diffLines(before ?? '', after)
  const hunks = toHunks(ops)
  if (hunks.length === 0) return null
  return {
    id,
    path,
    tool,
    at,
    isNew: before === null,
    added: ops.filter(op => op.kind === '+').length,
    removed: ops.filter(op => op.kind === '-').length,
    hunks,
    status: 'pending',
  }
}

const side = (h: DiffHunk, which: 'old' | 'new') =>
  h.lines.filter(l => l[0] === ' ' || l[0] === (which === 'old' ? '-' : '+')).map(l => l.slice(1))

// where `lines` sits in `text`, the match nearest `expected` winning; -1 when it is nowhere
function findNear(text: readonly string[], lines: readonly string[], expected: number): number {
  if (lines.length === 0) return Math.max(0, Math.min(expected, text.length))
  let best = -1
  for (let i = 0; i + lines.length <= text.length; i++) {
    // past the expected line, every later match is farther than the one found
    if (best >= 0 && i - expected >= Math.abs(best - expected)) break
    let isMatch = true
    for (let j = 0; j < lines.length; j++) {
      if (text[i + j] !== lines[j]) {
        isMatch = false
        break
      }
    }
    if (isMatch && (best < 0 || Math.abs(i - expected) < Math.abs(best - expected))) best = i
  }
  return best
}

// a step taken back ('undo', after → before) or put back ('redo', before → after) on the file
// as it is now: each hunk is found by its text (later steps may have moved it), last hunk first.
// null when a hunk is no longer there to change: the file was changed over it since
export function applyStep(current: string, step: Pick<DiffStep, 'hunks'>, direction: 'undo' | 'redo'): string | null {
  const out = splitLines(current)
  const isUndo = direction === 'undo'
  for (const h of [...step.hunks].reverse()) {
    const from = side(h, isUndo ? 'new' : 'old')
    const to = side(h, isUndo ? 'old' : 'new')
    const at = findNear(out, from, (isUndo ? h.newStart : h.oldStart) - 1)
    if (at < 0) return null
    out.splice(at, from.length, ...to)
  }
  return out.join('\n')
}

// a hunk's unified header; a side with no lines is numbered from the line before it
const header = (h: DiffHunk) =>
  `@@ -${h.oldLines === 0 ? h.oldStart - 1 : h.oldStart},${h.oldLines} +${h.newLines === 0 ? h.newStart - 1 : h.newStart},${h.newLines} @@`

// the step as unified-diff text for the Code element, cut at maxLines; \r dropped for drawing
export function unified(step: Pick<DiffStep, 'hunks'>, maxLines = MAX_SHOWN_LINES): { text: string; hidden: number } {
  const rows: string[] = []
  let total = 0
  for (const h of step.hunks) {
    total += h.lines.length + 1
    if (rows.length >= maxLines) continue
    rows.push(header(h))
    for (const l of h.lines) {
      if (rows.length >= maxLines) break
      rows.push(l.replace(/\r$/, ''))
    }
  }
  return { text: rows.join('\n'), hidden: Math.max(0, total - rows.length) }
}

// a path shown from the project root when it lies under it, with forward slashes
export function shortPath(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : p
}

export const pendingCount = (steps: readonly DiffStep[]) => steps.filter(s => s.status === 'pending').length

// the step the cursor names, else the first one still pending, else the last one
export function cursorStep(steps: readonly DiffStep[], cursor: number | null): DiffStep | null {
  return steps.find(s => s.id === cursor) ?? steps.find(s => s.status === 'pending') ?? steps[steps.length - 1] ?? null
}
