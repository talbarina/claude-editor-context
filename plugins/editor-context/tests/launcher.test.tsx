import { test, expect, mock } from 'claude-code/testing'
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

async function press(ui: any, key: string) {
  await ui.resize({ columns: 30, rows: 2, in: key })
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: key })
  await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: key })
}

test('the Editor tab turns it on and floats its panel on hover; tabs keep one order', async ($, on) => {
  const opened: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ type: 'status', ide: 'Cursor' }) + '\n' }
    yield { stream: 'stdout', text: JSON.stringify({ type: 'selection', ide: 'Cursor', filePath: '/proj/a.dart', text: 'x', selection: { start: { line: 2 }, end: { line: 5, character: 1 }, isEmpty: false } }) + '\n' }
    return { value: { code: 0, signal: null } }
  } as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.1.0\n', stderr: '' } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.open', ($: any, e: any) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  // Another mod's tab, drawn below this mod's band.
  on('ui.render', ($: any, e: any) => {
    const el = $.ui.resolve(e)
    // The engine's own message row, as the desktop places it: an engine node.
    if (e.component === 'UserMessage') return { type: 'engine', ref: 1 }
    if (e.component !== 'AbovePrompt') return <el.Box />
    return <el.Box key="launcher-stack" flexDirection="column"><el.Box key="launcher-row"><el.Text key="launch:1:other">Other</el.Text></el.Box></el.Box>
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const row = await band.find({ key: 'launcher-row' })
  const keys = (row?.children ?? []).map((c: any) => c.props?.key)
  expect(keys.length).toBe(2)
  expect(keys[0]).toBe('launch:0:editor-context')
  await press(band, 'launch-tab:editor-context')
  for (let i = 0; i < 20 && !(await band.find({ key: 'pin' })); i++) await new Promise(r => setTimeout(r, 10))
  // Explain and Recent files are gone; Pin selection is the app's own Button.
  for (const gone of ['explain', 'show-recent', 'close-recent']) expect(await band.find({ key: gone })).toBeFalsy()
  expect((await band.find({ key: 'pin' }))?.type).toBe('Button')
  expect((await band.find({ key: 'pin' }))?.props.label).toBe('Pin selection')
  // The only drawn controls left are the tab and the Share with Claude switch.
  for (const c of await band.findAll({ type: 'Client' })) expect(['tab', 'switch']).toContain(c.props.props.kind)
  await band.press({ key: 'pin' })
  const pinKey = 'open-pin:/proj/a.dart|3|6'
  for (let i = 0; i < 20 && !(await band.find({ key: pinKey })); i++) await new Promise(r => setTimeout(r, 10))
  expect((await band.find({ key: pinKey }))?.type).toBe('Button')
  expect(JSON.stringify(await band.find({ key: pinKey }))).toContain('a.dart')
  expect((await band.find({ key: 'unpin:/proj/a.dart|3|6' }))?.props.label).toBe('\u2715')
  // Already pinned: no second Pin selection.
  expect(await band.find({ key: 'pin' })).toBeFalsy()
  expect((await band.find({ key: 'launch-tab:editor-context' }))?.props.props.note).toBe('L3–6')
  expect(opened).toEqual([])
  await band.unmount()

  // A message sent with the selection shows it as a chip under the bubble.
  await ($.prompt.submit as any)({ text: 'Why does it jump?', asUser: true, origin: { kind: 'composer' } })
  const message = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'UserMessage', props: { text: 'Why does it jump?', origin: { kind: 'composer' }, isExpanded: true } })
  expect(JSON.stringify(await message.find({ key: 'chip:0:editor-context:0' }))).toContain('a.dart · L3–6')
  await message.unmount()
})

test('the demo card: Unsaved changes with Save file and Pin selection as the app\'s own Buttons', async ($, on) => {
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('process.spawn', async function* () { return { value: { code: 0, signal: null } } } as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.1.0\n', stderr: '' } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.render', ($: any, e: any) => { const { Box } = $.ui.resolve(e); return <Box /> })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await ($.command.run as any)({ command: 'editor-context-demo', args: '' })
  const band = await $.ui.mount({ plugin: 'editor-context', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(JSON.stringify(await band.drawn())).toContain('Unsaved changes')
  expect((await band.find({ key: 'save' }))?.type).toBe('Button')
  expect((await band.find({ key: 'save' }))?.props.label).toBe('Save file')
  expect((await band.find({ key: 'pin' }))?.type).toBe('Button')
  expect((await band.findAll({ type: 'Button' })).filter((b: any) => String(b.props.key ?? '').startsWith('unpin:')).length).toBe(2)
  expect(await band.find({ key: 'unpin-all' })).toBeTruthy()
  for (const svg of await band.findAll({ type: 'Svg' })) expect(String(svg.props.alt ?? '').trim()).not.toBe('')
  await band.unmount()
})
