import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Attached, EditorSelection } from '../types'
import { type Chip, sentWith } from './chips'

const selection = atom({ plugin: 'editor-context', key: 'selection' } as const, null)
const ide = atom({ plugin: 'editor-context', key: 'ide' } as const, null)
const isPaused = atom({ plugin: 'editor-context', key: 'isPaused' } as const, false)
const isDirty = atom({ plugin: 'editor-context', key: 'isDirty' } as const, false)
const pins = atom({ plugin: 'editor-context', key: 'pins' } as const, [])
const isDemo = atom({ plugin: 'editor-context', key: 'isDemo' } as const, false)
const notice = atom({ plugin: 'editor-context', key: 'notice' } as const, null)
const isNoticeHidden = atom({ plugin: 'editor-context', key: 'isNoticeHidden' } as const, false)
// Sharing is off until the Editor tab (or the switch in its card) turns it on: off, it sends nothing.
const isShown = atom({ plugin: 'editor-context', key: 'isShown' } as const, false)
const attached = atom({ plugin: 'editor-context', key: 'attached' } as const, [])
const MAX_ATTACHED = 30

const MAX_TEXT = 20000
const MAX_PINS = 10
const DOT_COLOR = '#D97757'
const WARN_COLOR = '#E5A50A'
const DOT_SIZE = 9
const ICON_SIZE = 14
const ICON_COLOR = '#8A8A8A'
const DIVIDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none"><rect width="4000" height="1" fill="#8A8A8A" fill-opacity="0.2"/></svg>'

// Tabler outline icons (tabler.io/icons, MIT), the set the desktop app ships.
const ICONS: Record<string, string> = {
  save: '<path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"/><path d="M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M14 4l0 4l-6 0l0 -4"/>',
  pin: '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  unpin: '<path d="M3 3l18 18"/><path d="M15 4.5l-3.249 3.249m-2.57 1.433l-2.181 .818l-1.5 1.5l7 7l1.5 -1.5l.82 -2.186m1.43 -2.563l3.25 -3.251"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>',
  pause: '<path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/>',
  resume: '<path d="M7 4v16l13 -8z"/>',
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
}


function iconSvg(name: string, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
}

// Runs under node. Connects to the Claude Code extension's MCP websocket in
// Cursor / VS Code (found through ~/.claude/ide/<port>.lock), prints one JSON
// line per selection or dirty-state change, and serves POST /call on a Unix
// socket so the mod can call the editor's tools (save, open file). Sessions
// share one connection per editor window (see the hub notes inside).
const BRIDGE = String.raw`
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), net = require('node:net')
const cwd = process.argv[1] || ''
const dir = path.join(os.homedir(), '.claude', 'ide')
const out = o => process.stdout.write(JSON.stringify(o) + '\n')
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const parse = r => { try { return JSON.parse(r.content[0].text) } catch { return r } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let hubSocket = null

function pickLock() {
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.lock')) } catch { return null }
  const locks = names.map(n => {
    try {
      const p = path.join(dir, n)
      return { port: n.slice(0, -5), mtime: fs.statSync(p).mtimeMs, ...JSON.parse(fs.readFileSync(p, 'utf8')) }
    } catch { return null }
  }).filter(l => l && (!l.pid || alive(l.pid)))
  const inWorkspace = l => (l.workspaceFolders || []).some(f => cwd === f || cwd.startsWith(f + '/') || f.startsWith(cwd + '/'))
  locks.sort((a, b) => (inWorkspace(b) - inWorkspace(a)) || (b.mtime - a.mtime))
  return locks[0] || null
}

// The editor's server takes one client at a time and drops the older one, so
// every Claude Code session shares one connection per editor window: the first
// helper becomes the hub, the rest subscribe to it over a Unix socket.

// Resolves true once a hub's stream has ended, false when there was no hub.
function subscribe(sock) {
  return new Promise(resolve => {
    let connected = false
    const req = http.get({ socketPath: sock, path: '/events' }, res => {
      connected = true
      out({ type: 'ready', socket: sock })
      res.setEncoding('utf8')
      res.on('data', d => process.stdout.write(d))
      res.on('end', () => resolve(true))
      res.on('error', () => resolve(true))
    })
    req.on('error', () => resolve(connected))
  })
}

function canConnect(sock) {
  return new Promise(resolve => {
    const c = net.connect(sock)
    c.on('connect', () => { c.destroy(); resolve(true) })
    c.on('error', () => resolve(false))
  })
}

function listen(server, sock) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sock, () => { server.removeListener('error', reject); resolve() })
  })
}

// Resolves false when another helper is already the hub; otherwise runs the
// hub until the editor goes away, then resolves true.
async function serve(sock, lock) {
  const subscribers = new Set()
  const last = {}
  let ws = null, ready = false, nextId = 100, current = null, lastDirty = null, stopped = false
  const pending = new Map()

  const broadcast = o => {
    last[o.type] = o
    const line = JSON.stringify(o) + '\n'
    process.stdout.write(line)
    for (const res of subscribers) res.write(line)
  }

  const call = (name, args) => new Promise((resolve, reject) => {
    if (!ws || !ready) return reject(new Error('editor not connected'))
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }))
    setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout')) }, 5000)
  })

  const handle = (req, res) => {
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (const o of [last.status, last.selection, last.dirty]) if (o) res.write(JSON.stringify(o) + '\n')
      subscribers.add(res)
      req.on('close', () => subscribers.delete(res))
      return
    }
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', async () => {
      try {
        const { name, arguments: args } = JSON.parse(body || '{}')
        const r = await call(name, args || {})
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(parse(r)))
      } catch (err) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(err && err.message || err) }))
      }
    })
  }

  let server = http.createServer(handle)
  try {
    await listen(server, sock)
  } catch (err) {
    if (err.code !== 'EADDRINUSE' || await canConnect(sock)) return false
    try { fs.unlinkSync(sock) } catch {}
    server = http.createServer(handle)
    try { await listen(server, sock) } catch { return false }
  }
  hubSocket = sock
  out({ type: 'ready', socket: sock })

  const checkDirty = () => {
    if (!current || !ready) return
    const file = current
    call('checkDocumentDirty', { filePath: file }).then(r => {
      const isDirty = !!parse(r).isDirty
      const key = file + ':' + isDirty
      if (key !== lastDirty) { lastDirty = key; broadcast({ type: 'dirty', filePath: file, isDirty }) }
    }).catch(() => {})
  }
  const dirtyTimer = setInterval(checkDirty, 1500)

  const emit = s => {
    if (!s || !s.filePath) return
    current = s.filePath
    broadcast({ type: 'selection', ide: lock.ideName, ...s })
    checkDirty()
  }

  return new Promise(resolve => {
    let delay = 3000, openedAt = 0, goneTimer = null

    const stop = () => {
      if (stopped) return
      stopped = true
      clearInterval(dirtyTimer)
      clearTimeout(goneTimer)
      for (const res of subscribers) res.end()
      server.close()
      try { fs.unlinkSync(sock) } catch {}
      hubSocket = null
      resolve(true)
    }

    const connect = () => {
      if (stopped) return
      const now = pickLock()
      if (!now || now.port !== lock.port) return stop()
      ws = new WebSocket('ws://127.0.0.1:' + lock.port, {
        protocols: ['mcp'],
        headers: { 'x-claude-code-ide-authorization': now.authToken },
      })
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'editor-context', version: '1.0.1' } } }))
      ws.onmessage = m => {
        let d; try { d = JSON.parse(m.data) } catch { return }
        if (d.id === 1) {
          ready = true
          openedAt = Date.now()
          clearTimeout(goneTimer)
          broadcast({ type: 'status', ide: lock.ideName })
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
          call('getCurrentSelection', {}).then(r => emit(parse(r))).catch(() => {})
        } else if (d.id && pending.has(d.id)) {
          const p = pending.get(d.id); pending.delete(d.id)
          d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result)
        } else if (d.method === 'selection_changed') {
          emit(d.params)
        }
      }
      ws.onclose = () => {
        ready = false
        for (const p of pending.values()) p.reject(new Error('editor disconnected'))
        pending.clear()
        // Another client (a terminal session's /ide) may have taken the
        // editor: back off instead of fighting it, and keep the band up
        // through a short gap.
        delay = openedAt && Date.now() - openedAt > 10000 ? 3000 : Math.min(delay * 2, 30000)
        openedAt = 0
        clearTimeout(goneTimer)
        goneTimer = setTimeout(() => broadcast({ type: 'status', ide: null, reason: 'disconnected', ideName: lock.ideName }), 8000)
        setTimeout(connect, delay)
      }
      ws.onerror = () => {}
    }
    connect()
  })
}

async function main() {
  for (;;) {
    const lock = pickLock()
    if (!lock) { out({ type: 'status', ide: null, reason: 'no-editor' }); await sleep(5000); continue }
    const sock = path.join(os.tmpdir(), 'editor-context-' + lock.port + '.sock')
    if (await subscribe(sock)) { await sleep(200 + Math.random() * 800); continue }
    await serve(sock, lock)
    await sleep(200 + Math.random() * 500)
  }
}

const quit = () => { if (hubSocket) { try { fs.unlinkSync(hubSocket) } catch {} } process.exit(0) }
process.on('SIGTERM', quit)
process.on('SIGINT', quit)
setInterval(() => { if (process.ppid === 1) quit() }, 5000)
main()
`

function toSelection(raw: any): EditorSelection {
  const start = raw.selection?.start?.line ?? 0
  let end = raw.selection?.end?.line ?? start
  // A whole-line selection ends at column 0 of the next line.
  if (end > start && raw.selection?.end?.character === 0) end -= 1
  return {
    ide: String(raw.ide ?? 'IDE'),
    filePath: String(raw.filePath),
    startLine: start + 1,
    endLine: end + 1,
    isEmpty: Boolean(raw.selection?.isEmpty ?? !raw.text),
    text: String(raw.text ?? '').slice(0, MAX_TEXT),
  }
}

function fileName(filePath: string) {
  return filePath.split('/').pop() ?? filePath
}

function lineCount(s: EditorSelection) {
  return s.endLine - s.startLine + 1
}

function rangeLabel(s: EditorSelection) {
  return s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}–${s.endLine}`
}

function pinKey(p: EditorSelection) {
  return `${p.filePath}|${p.startLine}|${p.endLine}`
}

function codeBlock(text: string) {
  return '```\n' + text + '\n```'
}

// The bridge needs Node 22 or later, for its built-in WebSocket.
const MIN_NODE_MAJOR = 22

async function nodeMajor($: any, node: string): Promise<number> {
  try {
    const r = await $.process.run([node, '--version'], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return 0
    return Number(/^v(\d+)/.exec(r.stdout.trim())?.[1] ?? 0)
  } catch {
    return 0
  }
}

async function findNode($: any): Promise<string | null> {
  // The last session's answer, kept across sessions: probing login shells is
  // slow, and the first message should not wait on it.
  const cached = await $.store.get('nodePath')
  if (typeof cached === 'string' && (await nodeMajor($, cached)) >= MIN_NODE_MAJOR) return cached

  const found = await probeNode($)
  if (found) await $.store.set('nodePath', found)
  return found
}

async function probeNode($: any): Promise<string | null> {
  for (const candidate of ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if ((await nodeMajor($, candidate)) >= MIN_NODE_MAJOR) return candidate
  }
  // nvm, fnm, volta and similar live behind the login shell's PATH.
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    try {
      const r = await $.process.run([shell, '-lic', 'command -v node'], { timeoutMs: 10000 })
      const line = r.stdout.trim().split('\n').pop()
      if (r.exitCode === 0 && line && line.startsWith('/') && (await nodeMajor($, line)) >= MIN_NODE_MAJOR) return line
    } catch {}
  }
  return null
}

// The bridge's Unix socket, once it is listening.
let socketPath: string | null = null

async function ideCall($: any, name: string, args: Record<string, unknown>) {
  if (!socketPath) return null
  try {
    const r = await $.http.fetch('http://bridge/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
      socketPath,
    })
    return r.ok ? JSON.parse(r.text) : null
  } catch {
    return null
  }
}

// Settles once the editor's state first arrives (or there is none), so the
// session's first message, sent while the bridge is still starting, waits
// for it instead of going out without context.
let isStarting = false
let settleStart: () => void = () => {}
let started: Promise<void> = Promise.resolve()
const START_WAIT_MS = 4000

// Typed at the start of a session's first message: sends it with the editor's
// context and turns the mod on for the rest of the session. The app can put
// notes of its own before the typed text (a session with no folder does), so
// those are skipped and kept.
const START_MARKER = /^((?:\s*<system-reminder>[\s\S]*?<\/system-reminder>)*\s*)\+\+(?:\s+|$)/

// A message as its bubble shows it: the desktop draws what was typed, without
// the app's notes and with the marker, so both are left out when matching.
function asTyped(text: string) {
  return text.replace(/^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>)*\s*/, '').replace(/^\+\+(?:\s+|$)/, '')
}

// A session the app started ahead of time learns it is on the desktop only
// once it is claimed, which can come just after its first message.
async function waitForDesktop($: any) {
  for (let i = 0; i < 30; i++) {
    if ((await $.session.surfaces()).some(isDesktop)) return true
    await $.clock.sleep(100)
  }
  return false
}

// The mod runs in the desktop app only: the terminal CLI already gets the
// editor's selection through /ide, and the editor accepts one client at a
// time, so a second connection there would only compete with it.
let isActive = false

function isDesktop(surface: string | null | undefined) {
  return surface === 'desktop'
}

async function showNotice($: any, next: { kind: string; ide?: string } | null) {
  const current = await read($, notice)
  if (current?.kind === next?.kind && current?.ide === next?.ide) return
  await update($, notice, () => next)
  await update($, isNoticeHidden, () => false)
}

async function handleLine($: any, msg: any) {
  if (msg.type === 'ready') {
    socketPath = msg.socket
  } else if (msg.type === 'status') {
    await update($, ide, () => msg.ide ?? null)
    if (msg.ide) {
      await showNotice($, null)
    } else {
      await update($, selection, () => null)
      await showNotice($, { kind: msg.reason ?? 'no-editor', ide: msg.ideName })
      settleStart()
    }
  } else if (msg.type === 'selection') {
    const incoming = toSelection(msg)
    const prev = await read($, selection)
    if (prev && prev.filePath !== incoming.filePath) {
      await update($, isDirty, () => false)
    }
    await update($, selection, () => incoming)
    settleStart()
  } else if (msg.type === 'dirty') {
    const s = await read($, selection)
    if (s && s.filePath === msg.filePath) await update($, isDirty, () => Boolean(msg.isDirty))
  }
}

async function startBridge($: any) {
  if (isActive) return
  isActive = true
  isStarting = true
  started = new Promise<void>(resolve => {
    settleStart = () => { isStarting = false; resolve() }
  })
  const node = await findNode($)
  if (!node) {
    await showNotice($, { kind: 'no-node' })
    settleStart()
    return
  }
  let buffer = ''
  const bridge = $.process.spawn({ argv: [node, '-e', BRIDGE, await $.session.cwd()] })
  for await (const piece of bridge) {
    if (piece.stream !== 'stdout') continue
    buffer += piece.text
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      let msg: any
      try { msg = JSON.parse(line) } catch { continue }
      await handleLine($, msg)
    }
  }
}

// What each context block last sent, so an unchanged selection is not resent.
const lastSent = new Map<string, string>()

function isFresh(key: string, value: string) {
  const isSame = lastSent.get(key) === value
  lastSent.set(key, value)
  return !isSame
}

// ---- Band actions ----
// The app's Buttons call runAction from onPress; the desktop's drawn tab and switch post
// a press that the `ui.message` hook turns into the same call, by the Client's key.

// Presses whose action has not finished yet: a second press of the same button is ignored.
const inFlight = new Set<string>()

async function runAction($: any, key: string) {
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    await actionOf($, key)
  } finally {
    inFlight.delete(key)
  }
}

async function actionOf($: any, key: string) {
  // The demo's rows are samples: only the band's own toggles act.
  const demo = await read($, isDemo)
  const s = await read($, selection)
  switch (key) {
    case 'editor-on':
    case 'editor-off':
      if ((key === 'editor-on') === (await read($, isShown))) return
    // falls through: same as the tab
    case 'editor-switch':
    case 'launch-tab:editor-context': {
      // The tab turns it on and off. Off, nothing is sent; on, it connects and sends.
      // On and off is the one switch: Pause is folded into it.
      lastSent.clear()
      await update($, isPaused, () => false)
      await update($, isShown, v => !v)
      if (await read($, isShown)) void startBridge($)
      return
    }
    case 'close-notice':
      await update($, isNoticeHidden, () => true)
      return
    case 'pause':
      await update($, isPaused, v => !v)
      return
    case 'save':
      if (!demo && s) await ideCall($, 'saveDocument', { filePath: s.filePath })
      return
    case 'pin':
      if (!demo && s && !s.isEmpty && s.text) {
        const pin = s
        await update($, pins, list => (list.length >= MAX_PINS || list.some(p => pinKey(p) === pinKey(pin)) ? list : [...list, pin]))
      }
      return
  }
  if (key.startsWith('open-pin:') && !demo) {
    const target = key.slice('open-pin:'.length)
    const pin = (await read($, pins)).find(p => pinKey(p) === target)
    if (pin) {
      const lines = pin.text.split('\n').filter(l => l.trim() !== '')
      await ideCall($, 'openFile', { filePath: pin.filePath, startText: lines[0] ?? '', endText: lines[lines.length - 1] ?? '', makeFrontmost: true })
    }
    return
  }
  if (key.startsWith('unpin:') && !demo) {
    const target = key.slice('unpin:'.length)
    await update($, pins, list => list.filter(p => pinKey(p) !== target))
  }
}

// ---- Launcher ----
// On the desktop each mod draws one tab in a shared row above the prompt; its full
// panel opens in a pane. Each mod's band nests the bands of mods loaded after it, so
// whichever draws outermost lays the tabs out in one order, then any other bands.
const PANE = 'editor-context'
// The floating card's content width, in ch: the app caps the card at 360px and pads it
// about 12px a side, which leaves 336px; one ch of the app's 13px text is about 8.2px.
const POPOVER_WIDTH = 41
// A launcher tab's key carries its place in the row: "launch:<rank>:<name>".
const launchRank = (key: string) => Number(key.match(/^launch:(\d+):/)?.[1] ?? 9)
const POWER_ICON = '<path d="M7 6a7.75 7.75 0 1 0 10 0"/><path d="M12 4l0 8"/>'
const FILE_ICON = '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>'
const CODE_ICON = '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>'

function nodeKey(node: any): string {
  const key = node?.props?.key
  return typeof key === 'string' ? key : ''
}

function stackLauncher(Box: any, mine: any, below: any, hasBelow: boolean, divider: (key: string) => any) {
  let tabs: any[] = []
  let rest: any[] = []
  if (hasBelow && nodeKey(below) === 'launcher-stack') {
    const [row, ...others] = below.children ?? []
    tabs = row?.children ?? []
    rest = others.filter((c: any) => !nodeKey(c).startsWith('launcher-divider'))
  } else if (hasBelow) {
    rest = [below]
  }
  const sorted = [mine, ...tabs]
    .map((node, i) => ({ node, i, rank: launchRank(nodeKey(node)) }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map(x => x.node)
  const children: any[] = [
    <Box key="launcher-row" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">{sorted}</Box>,
  ]
  rest.forEach((node, i) => children.push(divider(`launcher-divider:${i}`), node))
  return <Box key="launcher-stack" flexDirection="column" width="100%" rowGap={1}>{children}</Box>
}

export const register: Register = on => {
  on('command.run', { command: 'editor-context-demo' }, async $ => {
    await update($, isDemo, v => !v)
    if (await read($, isDemo)) {
      await update($, isShown, () => true)
    }
    return { text: (await read($, isDemo)) ? 'Editor band demo on: every row is shown with sample data. Run again to turn it off.' : 'Editor band demo off.' }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'editor-context-demo',
      description: 'Toggle sample data in the editor band to preview every row',
    })
    // The app's sessions start with no surface of their own and list it here.
    const isOnDesktop = isDesktop(e.surface) || (await $.session.surfaces()).some(isDesktop)
    if (isOnDesktop && (await read($, isShown))) void startBridge($)
    return result
  })

  // A desktop session may start without a surface and attach the app after.
  on('session.attach', async ($, e, next) => {
    if (isDesktop(e.surface) && (await read($, isShown))) void startBridge($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as { kind: string; name?: string }
    const isTyped = origin.kind === 'composer' || origin.kind === 'bridge'
    // "++" at the start of a session's first message turns it on, as the tab
    // does: the new-session screen comes before any mod can draw a tab there.
    const marker = START_MARKER.exec(e.text)
    if (marker && isTyped && (await $.session.turns()) === 0) {
      const typed = e.text.slice(marker[0].length)
      if (typed) e = { ...e, text: marker[1] + typed }
      if (!(await read($, isShown)) && (await waitForDesktop($))) {
        lastSent.clear()
        await update($, isPaused, () => false)
        await update($, isShown, () => true)
      }
    }
    if (!(await read($, isShown))) return next(e)
    if (!isActive && (await $.session.surfaces()).some(isDesktop)) void startBridge($)
    if (!isActive) return next(e)
    if (isStarting) await Promise.race([started, $.clock.sleep(START_WAIT_MS)])
    const s = await read($, selection)
    const isUser = isTyped || (origin.kind === 'plugin' && origin.name === 'editor-context')
    if (!s || !isUser || (await read($, isPaused))) return next(e)

    const blocks: string[] = []

    let main = `The user is working in ${s.ide}. Active file: ${s.filePath}, cursor at line ${s.startLine}.`
    if (!s.isEmpty && s.text) {
      main = isFresh('selection', `${s.filePath}|${s.startLine}|${s.endLine}|${s.text}`)
        ? `The user has lines ${s.startLine}-${s.endLine} of ${s.filePath} selected in ${s.ide}. "This", "here" or "these lines" likely refers to it:\n${codeBlock(s.text)}`
        : `The user still has lines ${s.startLine}-${s.endLine} of ${s.filePath} selected in ${s.ide} (same selection as their previous message).`
    }
    if (await read($, isDirty)) {
      main += ' The file has unsaved changes in the editor, so the version on disk may differ from what the user sees.'
    }
    blocks.push(main)
    const chips: Attached['chips'] = [{ icon: 'file', label: s.isEmpty ? `${fileName(s.filePath)} · L${s.startLine}` : `${fileName(s.filePath)} · ${rangeLabel(s)}` }]

    // Each pin's code goes once; while unchanged, one line names them all.
    const unchanged: string[] = []
    for (const pin of await read($, pins)) {
      if (isFresh(`pin:${pinKey(pin)}`, pin.text)) {
        blocks.push(`The user pinned lines ${pin.startLine}-${pin.endLine} of ${pin.filePath} as reference for this conversation:\n${codeBlock(pin.text)}`)
      } else {
        unchanged.push(`lines ${pin.startLine}-${pin.endLine} of ${pin.filePath}`)
      }
    }
    if (unchanged.length > 0) {
      blocks.push(`Still pinned, unchanged since they were sent: ${unchanged.join('; ')}.`)
    }
    for (const pin of await read($, pins)) chips.push({ icon: 'pin', label: `${fileName(pin.filePath)} · ${rangeLabel(pin)}` })
    await update($, attached, list => [...list, { text: asTyped(e.text), chips }].slice(-MAX_ATTACHED))

    return next({ ...e, context: [...(e.context ?? []), ...blocks] })
  })

  // On the desktop, your message shows what went with it: chips above the bubble (chips.tsx).
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const props = e.props as { text?: string; origin?: { kind: string } }
    // The desktop marks every message row it draws as 'sdk'; the text finds what went with it.
    const kind = props.origin?.kind
    if (kind !== 'sdk' && kind !== 'composer' && kind !== 'bridge' && kind !== 'plugin') return next(e)
    const shown = asTyped(props.text ?? '')
    const sent = [...(await read($, attached))].reverse().find(a => a.text === shown)
    const elements = $.ui.resolve(e) as any
    if (!sent || !elements.Svg) return next(e)
    const mine: Chip[] = sent.chips.map((c, i) => ({ key: `0:editor-context:${i}`, icon: ICONS[c.icon] ?? '', label: c.label }))
    return sentWith(elements, await next(e), mine)
  })

  // A custom control (controls.tsx) posts { press: true }; its Client's key names the button.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { press?: unknown } | null
    if (e.module.endsWith('controls.tsx') && data !== null && typeof data === 'object' && data.press === true) {
      await runAction($, e.element)
    }
    return next(e)
  })

  // The pane closed, by its X or the tab: off, nothing more is sent.
  on('ui.close', async ($, e, next) => {
    if ((e as { id?: string }).id === PANE) {
      lastSent.clear()
      await update($, isShown, () => false)
    }
    return next(e)
  })

  // The launcher tab, in the row above the prompt (desktop).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isDesktop(e.surface) || e.props.hasSurvey) return next(e)
    const below = await next(e)
    const hasBelow = below !== null && below !== undefined && (below as { type?: string }).type !== 'engine'
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    if (!('Client' in elements)) return below
    const demo = await read($, isDemo)
    const shown = demo || (await read($, isShown))
    const s: EditorSelection | null = demo
      ? { ide: 'Cursor', filePath: '/demo/src/components/CheckoutForm.tsx', startLine: 12, endLine: 30, isEmpty: false, text: 'demo' }
      : await read($, selection)
    const hasIde = demo || Boolean(await read($, ide))
    // On, the tab is the file and its lines; off, or with no editor, it says so.
    const name = s ? fileName(s.filePath) : ''
    const isFileTab = shown && hasIde && s !== null
    const tabLabel = isFileTab ? name : 'Editor'
    const note = isFileTab ? (s!.isEmpty ? `L${s!.startLine}` : rangeLabel(s!)) : !shown ? 'off' : 'no editor'
    // Hovering the tab floats the full panel above it: the desktop lifts a hidden Box
    // that hover reveals into a popover card (the app's own popover look, up to 360px wide).
    const panel = await editorPanel($, e)
    const mine = (
      <Box key="launch:0:editor-context" flexDirection="row">
        <elements.Client
          key="launch-tab:editor-context"
          module="./controls.tsx"
          props={{ kind: 'tab', label: tabLabel, icon: isFileTab ? FILE_ICON : CODE_ICON, isOn: isFileTab, note, ...(isFileTab ? { dot: DOT_COLOR } : {}) }}
        />
        <Box position="absolute" top={-1} left={0} display="none" hover={{ display: 'flex' }} flexDirection="column">
          {panel}
        </Box>
      </Box>
    )
    const divider = (key: string) =>
      'Svg' in elements ? (
        <Box key={key} width="100%"><elements.Svg source={DIVIDER_SVG} alt="divider" height={0.5} /></Box>
      ) : (
        <Box key={key} width="100%" overflow="hidden"><Text dimColor wrap="truncate-end">{'\u2500'.repeat(400)}</Text></Box>
      )
    return stackLauncher(Box, mine, below, hasBelow, divider)
  })

}


// The full panel, in the launcher tab's floating card, using its full width (POPOVER_WIDTH),
// built like the app's own popovers: a "Share with Claude" switch on top, then the file,
// its actions as the app's own buttons, and the pins.
async function editorPanel($: any, e: any): Promise<any> {
  const elements = $.ui.resolve(e)
  const { Box, Button, Text } = elements
  const hasSvg = 'Svg' in elements
  const muted = (text: string) => <Text dimColor>{text}</Text>
  const header = (label: string, extra?: any) => (
    <Box flexDirection="row" alignItems="center" width="100%">
      {muted(label)}
      <Box flexGrow={1} />
      {extra ?? null}
    </Box>
  )
  const icon = (paths: string) => (hasSvg ? <elements.Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${ICON_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`} alt="pin" width={ICON_SIZE} height={ICON_SIZE} /> : null)
  const card = (...children: any[]) => (
    <Box flexDirection="column" width={POPOVER_WIDTH} rowGap={1}>{children}</Box>
  )

  const demo = await read($, isDemo)
  const shown = demo || (await read($, isShown))
  const hasIde = demo || Boolean(await read($, ide))
  const s: EditorSelection | null = demo
    ? { ide: 'Cursor', filePath: '/demo/src/components/CheckoutForm.tsx', startLine: 12, endLine: 30, isEmpty: false, text: 'demo' }
    : await read($, selection)
  const switchRow = (
    <elements.Client
      key="editor-switch"
      module="./controls.tsx"
      width="100%"
      props={{ kind: 'switch', label: 'Share with Claude', icon: CODE_ICON, isOn: shown }}
    />
  )
  if (!shown) {
    return card(switchRow, muted('Off. Turn on to send your Cursor or VS Code file and the lines you select with every message.'))
  }
  if (!isActive) void startBridge($)
  if (!hasIde) {
    const n = await read($, notice)
    const message = !n ? 'Connecting to your editor\u2026'
      : n.kind === 'no-node' ? `Editor context needs Node.js ${MIN_NODE_MAJOR} or later on this machine.`
      : n.kind === 'disconnected' ? `Lost connection to ${n.ide ?? 'your editor'}. Reconnecting\u2026`
      : 'Open VS Code or Cursor with the Claude Code extension installed.'
    return card(
      switchRow,
      divider(elements, 'card-divider-waiting'),
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={WARN_COLOR}>{'\u25cb'}</Text>
        <Text>{n?.kind === 'disconnected' ? 'Reconnecting' : 'Waiting for an editor'}</Text>
      </Box>,
      muted(message),
    )
  }

  const dirty = demo || (await read($, isDirty))
  const pinList: EditorSelection[] = demo
    ? [
        { ide: 'Cursor', filePath: '/demo/src/hooks/useCart.ts', startLine: 36, endLine: 48, isEmpty: false, text: 'demo' },
        { ide: 'Cursor', filePath: '/demo/src/api/client.ts', startLine: 3, endLine: 13, isEmpty: false, text: 'demo' },
      ]
    : await read($, pins)
  const hasSelection = Boolean(s && !s.isEmpty && s.text)
  const canPin = hasSelection && pinList.length < MAX_PINS && !pinList.some(p => s && pinKey(p) === pinKey(s))
  const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="${DOT_COLOR}"/></svg>`
  const chip = (key: string, label: string) => (
    <Box key={key} borderStyle="round" borderColor="#FFFFFF0F" backgroundColor="#FFFFFF0F" paddingX={0.75} paddingY={0}>
      <Text dimColor>{label}</Text>
    </Box>
  )

  return card(
    switchRow,
    muted(s ? `${s.ide} \u00b7 sent with each message` : 'Sent with each message'),
    divider(elements, 'card-divider-file'),
    <Box flexDirection="row" alignItems="center" columnGap={1} width="100%">
      {hasSvg ? <elements.Svg source={dotSvg} alt="sharing" width={DOT_SIZE} height={DOT_SIZE} /> : null}
      <Text bold wrap="truncate-middle">{s ? fileName(s.filePath) : 'No file focused'}</Text>
      <Box flexGrow={1} />
      {s ? chip('lines', s.isEmpty ? `L${s.startLine}` : rangeLabel(s)) : null}
    </Box>,
    s && (canPin || dirty) ? (
      <Box flexDirection="row" alignItems="center" columnGap={1} width="100%">
        {dirty ? <Text color={WARN_COLOR}>Unsaved changes</Text> : null}
        <Box flexGrow={1} />
        {canPin ? <Button key="pin" label="Pin selection" onPress={() => void runAction($, 'pin')} /> : null}
        {dirty ? <Button key="save" label="Save file" onPress={() => void runAction($, 'save')} /> : null}
      </Box>
    ) : null,
    pinList.length > 0 ? divider(elements, 'card-divider-pins') : null,
    pinList.length > 0
      ? header('Pinned', pinList.length > 1
          ? <Button key="unpin-all" plain dimColor label="Unpin all" onPress={() => { if (!demo) void update($, pins, () => []) }} />
          : null)
      : null,
    pinList.length > 0 ? (
      <Box flexDirection="column" width="100%" rowGap={0.5}>
        {pinList.map(pin => (
          <Box key={`pin:${pinKey(pin)}`} flexDirection="row" alignItems="center" columnGap={1} width="100%">
            {icon(ICONS.pin ?? '')}
            <Button key={`open-pin:${pinKey(pin)}`} plain onPress={() => void runAction($, `open-pin:${pinKey(pin)}`)}>{fileName(pin.filePath)} <Text dimColor>{rangeLabel(pin)}</Text></Button>
            <Box flexGrow={1} />
            <Button key={`unpin:${pinKey(pin)}`} plain dimColor label={'\u2715'} onPress={() => void runAction($, `unpin:${pinKey(pin)}`)} />
          </Box>
        ))}
      </Box>
    ) : null,
  )
}

// A hairline across the card.
function divider(elements: any, key: string) {
  const { Box } = elements
  return 'Svg' in elements ? <Box key={key} width="100%"><elements.Svg source={DIVIDER_SVG} alt="divider" height={0.5} /></Box> : null
}
