import { test, expect, mock } from 'claude-code/testing'

// A desktop session with Cursor open and lines 3-6 of a.dart selected.
function setUp(on: any, turns: { n: number }, surfaces: () => string[] = () => ['desktop']) {
  const reached: any[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: surfaces() }))
  on('session.turns', () => ({ value: turns.n }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ type: 'status', ide: 'Cursor' }) + '\n' }
    yield { stream: 'stdout', text: JSON.stringify({ type: 'selection', ide: 'Cursor', filePath: '/proj/a.dart', text: 'x', selection: { start: { line: 2 }, end: { line: 5, character: 1 }, isEmpty: false } }) + '\n' }
    return { value: { code: 0, signal: null } }
  } as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.1.0\n', stderr: '' } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('prompt.submit', ($: any, e: any) => { reached.push(e); turns.n++; return { text: e.text } })
  return Object.assign(reached, { clock })
}

const send = ($: any, text: string) => $.prompt.submit({ text, asUser: true, origin: { kind: 'composer' } })

test('"++" on the first message sends it with the selection, hides the marker and turns the mod on', async ($, on) => {
  const turns = { n: 0 }
  const reached = setUp(on, turns)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await send($, '++ Why does it jump?')
  expect(reached[0].text).toBe('Why does it jump?')
  expect(String(reached[0].context)).toContain('lines 3-6 of /proj/a.dart')

  // Still on for the next message, which carries the context without the marker.
  await send($, 'And this?')
  expect(reached[1].text).toBe('And this?')
  expect(String(reached[1].context)).toContain('/proj/a.dart')
})

test('without "++" the first message goes as before: off, nothing attached', async ($, on) => {
  const reached = setUp(on, { n: 0 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await send($, 'Why does it jump?')
  expect(reached[0].text).toBe('Why does it jump?')
  expect(reached[0].context).toBeUndefined()
})

test('"++" after the first message is sent as typed', async ($, on) => {
  const reached = setUp(on, { n: 1 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await send($, '++ Why does it jump?')
  expect(reached[0].text).toBe('++ Why does it jump?')
  expect(reached[0].context).toBeUndefined()
})

test('"++" glued to a word is not the marker', async ($, on) => {
  const reached = setUp(on, { n: 0 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await send($, '++i overflows here')
  expect(reached[0].text).toBe('++i overflows here')
  expect(reached[0].context).toBeUndefined()
})

test('"++" after the app\'s own note (a session with no folder) still counts, and the note is kept', async ($, on) => {
  const reached = setUp(on, { n: 0 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const note = '<system-reminder>\nThe user started this session without choosing a project folder.\n</system-reminder>\n\n\n'
  await send($, note + '++ Why does it jump?')
  expect(reached[0].text).toBe(note + 'Why does it jump?')
  expect(String(reached[0].context)).toContain('lines 3-6 of /proj/a.dart')
})

test('a session the app started ahead of time: "++" waits until it is on the desktop', async ($, on) => {
  let calls = 0
  const reached = setUp(on, { n: 0 }, () => (++calls > 3 ? ['desktop'] : []))
  await $.session.start({ cwd: '/proj', surface: null as any, isInteractive: true })
  const sending = send($, '++ Why does it jump?')
  await reached.clock.advance(1000)
  await sending
  expect(reached[0].text).toBe('Why does it jump?')
  expect(String(reached[0].context)).toContain('lines 3-6 of /proj/a.dart')
})

test('the "Sent with" chip finds a "++" message, whose bubble shows the marker', async ($, on) => {
  const reached = setUp(on, { n: 0 })
  on('ui.render', ($: any, e: any) => {
    const el = $.ui.resolve(e)
    if (e.component === 'UserMessage') return { type: 'engine', ref: 1 }
    return <el.Box />
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const note = '<system-reminder>\nNo folder.\n</system-reminder>\n\n\n'
  await send($, note + '++ Why does it jump?')
  expect(reached[0].text).toBe(note + 'Why does it jump?')
  const message = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'UserMessage', props: { text: '++ Why does it jump?', origin: { kind: 'sdk' }, isExpanded: true } })
  expect(JSON.stringify(await message.find({ key: 'chip:0:editor-context:0' }))).toContain('a.dart · L3–6')
  await message.unmount()
})
