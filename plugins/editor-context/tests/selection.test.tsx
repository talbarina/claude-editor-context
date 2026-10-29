import { test, expect, mock } from 'claude-code/testing'
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

// A desktop session with Cursor open on a.dart and the given selection.
function setUp(on: any, selection: any, text: string) {
  const reached: any[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.turns', () => ({ value: 0 }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ type: 'status', ide: 'Cursor' }) + '\n' }
    yield { stream: 'stdout', text: JSON.stringify({ type: 'selection', ide: 'Cursor', filePath: '/proj/a.dart', text, selection }) + '\n' }
    return { value: { code: 0, signal: null } }
  } as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.1.0\n', stderr: '' } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('prompt.submit', ($: any, e: any) => { reached.push(e); return { text: e.text } })
  on('ui.render', ($: any, e: any) => {
    const el = $.ui.resolve(e)
    if (e.component === 'UserMessage') return { type: 'engine', ref: 1 }
    return <el.Box />
  })
  return reached
}

async function sendAndLook($: any) {
  await $.prompt.submit({ text: '++ Why?', asUser: true, origin: { kind: 'composer' } })
  const band = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const note = (await band.find({ key: 'launch-tab:editor-context' }))?.props.props.note
  await band.unmount()
  const message = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'UserMessage', props: { text: 'Why?', origin: { kind: 'composer' }, isExpanded: true } })
  const chip = JSON.stringify(await message.find({ key: 'chip:0:editor-context:0' }))
  await message.unmount()
  return { note, chip }
}

test('nothing selected: only the file name goes, with no line anywhere', async ($, on) => {
  const reached = setUp(on, { start: { line: 11, character: 4 }, end: { line: 11, character: 4 }, isEmpty: true }, '')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const { note, chip } = await sendAndLook($)
  expect(String(reached[0].context)).toBe('The user is working in Cursor. Active file: /proj/a.dart.')
  expect(note).toBeUndefined()
  expect(chip).toContain('a.dart')
  expect(chip).not.toContain('L12')
})

test('part of one row: the characters are named, not the whole line', async ($, on) => {
  const reached = setUp(on, { start: { line: 11, character: 4 }, end: { line: 11, character: 18 }, isEmpty: false }, 'cart.total')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const { note, chip } = await sendAndLook($)
  expect(String(reached[0].context)).toContain('characters 5-18 of line 12 of /proj/a.dart')
  expect(String(reached[0].context)).toContain('cart.total')
  expect(note).toBe('L12:5–18')
  expect(chip).toContain('a.dart · L12:5–18')
})

test('part of several rows: start and end characters', async ($, on) => {
  const reached = setUp(on, { start: { line: 11, character: 4 }, end: { line: 13, character: 9 }, isEmpty: false }, 'a\nb\nc')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const { note, chip } = await sendAndLook($)
  expect(String(reached[0].context)).toContain('line 12 character 5 to line 14 character 9 of /proj/a.dart')
  expect(note).toBe('L12:5–L14:9')
  expect(chip).toContain('a.dart · L12:5–L14:9')
})

test('whole rows stay as lines', async ($, on) => {
  const reached = setUp(on, { start: { line: 11, character: 0 }, end: { line: 14, character: 0 }, isEmpty: false }, 'a\nb\nc')
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const { note, chip } = await sendAndLook($)
  expect(String(reached[0].context)).toContain('lines 12-14 of /proj/a.dart')
  expect(note).toBe('L12–14')
  expect(chip).toContain('a.dart · L12–14')
})
