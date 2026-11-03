// review (ft-panel4 cr): the ended save checks `resumed` once, then awaits the cwd read (ignore) and
// its write. A resumed call that writes inside that await is overwritten by the ended (old) list.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// holdIgnore: once the slow call answers, the 2nd cwd read after it (the ended save's ignore) waits on `gate`
const run = async ($: Parameters<TestBody>[0], on: On, holdIgnore: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let open!: () => void
  const gate = new Promise<void>(r => { open = r })
  let cwdCalls = 0
  let holdAt = -1
  let reached!: () => void
  const atGate = new Promise<void>(r => { reached = r })
  on('session.cwd', async () => {
    cwdCalls++
    if (cwdCalls === holdAt) {
      reached()
      await gate
    }
    return { value: '/work/app' }
  })
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) {
      await held
      if (holdIgnore) holdAt = cwdCalls + 2
    }
    return { result: {} }
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-a'
  release()
  if (holdIgnore) {
    // the ended save has passed its `resumed` check and waits in ignore's cwd read
    await atGate
    await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
    open()
  } else {
    // the ended save is done before the resumed call
    await slow
    await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  }
  await slow
  await ticks(50)
  return writes
}

test('review P4-1: a resumed call written while the late call\'s ended save is between its check and its write stays in the file', async ($, on) => {
  const writes = await run($, on, true)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('review P4-1 comparison: the same late call saved before the resumed call leaves the resumed call in the file', async ($, on) => {
  const writes = await run($, on, false)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})

// no held read at all: the late call and the resumed call answer together (parallel tool calls)
const together = async ($: Parameters<TestBody>[0], on: On, order: 'late-first' | 'resumed-first') => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) await held
    return { result: {} }
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-a'
  let resumed: Promise<unknown>
  if (order === 'late-first') {
    release()
    resumed = $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  } else {
    resumed = $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
    release()
  }
  await Promise.all([slow, resumed])
  await ticks(50)
  return writes
}
test('review P4-1b: the late call and a resumed call answering together leave the resumed call in the file', async ($, on) => {
  const writes = await together($, on, 'late-first')
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('review P4-1b comparison: the resumed call answering first, then the late one', async ($, on) => {
  const writes = await together($, on, 'resumed-first')
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})

// every engine call takes a few ms (no call held on purpose); the two answers come together
const realistic = async ($: Parameters<TestBody>[0], on: On, together: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  const lag = () => new Promise<void>(r => setTimeout(r, 3))
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  on('session.cwd', async () => (await lag(), { value: '/work/app' }))
  on('session.id', async () => (await lag(), { value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', async (_, e) => {
    await lag()
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) await held
    return { result: {} }
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-a'
  release()
  if (!together) await slow
  // the resumed call answers a moment after the late one
  await new Promise<void>(r => setTimeout(r, 5))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  await slow
  await new Promise<void>(r => setTimeout(r, 50))
  return writes
}
test('review P4-1c: with a few ms per engine call, a resumed call answering 5 ms after the late call stays in the file', async ($, on) => {
  const writes = await realistic($, on, true)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('review P4-1c comparison: the same, the resumed call answering after the late call is saved', async ($, on) => {
  const writes = await realistic($, on, false)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})

// a write takes longer for a longer text (1 ms per 1000 characters), every other call 3 ms; the old
// conversation made 300 calls, so the ended list is long and the resumed one short. No call held on purpose.
const sized = async ($: Parameters<TestBody>[0], on: On, gapMs: number) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let on_ = false
  const lag = (ms: number) => (on_ ? new Promise<void>(r => setTimeout(r, ms)) : Promise.resolve())
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  on('session.cwd', async () => (await lag(3), { value: '/work/app' }))
  on('session.id', async () => (await lag(3), { value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', async (_, e) => {
    await lag(1 + Math.floor(e.text.length / 1000))
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) await held
    return { result: {} }
  })
  for (let i = 0; i < 300; i++) await $.tool.call({ tool: 'Read', file_path: `/work/app/src/module-${i}/old.ts` })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-a'
  on_ = true
  await lag(100)
  release()
  await lag(gapMs)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  await slow
  await lag(200)
  return writes
}
test('review P4-1d: a resumed call answering 5 ms after the late call of a 300-call conversation stays in the file', async ($, on) => {
  const writes = await sized($, on, 5)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('review P4-1d comparison: the same resumed call answering 100 ms after the late call', async ($, on) => {
  const writes = await sized($, on, 100)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})

