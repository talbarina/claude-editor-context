import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EditorSelection } from '../types'

const selection = atom({ plugin: 'editor-context', key: 'selection' } as const, null)
const ide = atom({ plugin: 'editor-context', key: 'ide' } as const, null)
const isPaused = atom({ plugin: 'editor-context', key: 'isPaused' } as const, false)
const isDirty = atom({ plugin: 'editor-context', key: 'isDirty' } as const, false)
const pins = atom({ plugin: 'editor-context', key: 'pins' } as const, [])
const recent = atom({ plugin: 'editor-context', key: 'recent' } as const, [])
const isRecentHidden = atom({ plugin: 'editor-context', key: 'isRecentHidden' } as const, true)
const isDemo = atom({ plugin: 'editor-context', key: 'isDemo' } as const, false)
const notice = atom({ plugin: 'editor-context', key: 'notice' } as const, null)
const isNoticeHidden = atom({ plugin: 'editor-context', key: 'isNoticeHidden' } as const, false)

const MAX_TEXT = 20000
const MAX_RECENT = 5
const MAX_PINS = 10
const DOT_COLOR = '#D97757'
const WARN_COLOR = '#E5A50A'
const DOT_SIZE = 8
const ICON_SIZE = 14
const ICON_COLOR = '#8A8A8A'
const DIVIDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none"><rect width="4000" height="1" fill="#8A8A8A" fill-opacity="0.5"/></svg>'

// Tabler outline icons (tabler.io/icons, MIT), the set the desktop app ships.
const ICONS: Record<string, string> = {
  save: '<path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"/><path d="M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M14 4l0 4l-6 0l0 -4"/>',
  explain: '<path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7"/><path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3"/><path d="M9.7 17l4.6 0"/>',
  pin: '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  unpin: '<path d="M3 3l18 18"/><path d="M15 4.5l-3.249 3.249m-2.57 1.433l-2.181 .818l-1.5 1.5l7 7l1.5 -1.5l.82 -2.186m1.43 -2.563l3.25 -3.251"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  pause: '<path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/>',
  resume: '<path d="M7 4v16l13 -8z"/>',
  recent: '<path d="M12 8l0 4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/>',
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
}


function iconSvg(name: string, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
}

// Sample rows for /editor-context-demo, so every part of the band can be seen.
const DEMO_RECENT = [
  '/demo/src/components/Header.tsx',
  '/demo/src/api/client.ts',
  '/demo/src/pages/Settings.tsx',
]

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

function lineLabel(s: EditorSelection) {
  if (s.isEmpty) return `L${s.startLine}`
  const count = lineCount(s)
  return `${rangeLabel(s)} · ${count} ${count === 1 ? 'line' : 'lines'} selected`
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
      await update($, recent, list =>
        [prev.filePath, ...list.filter(f => f !== prev.filePath && f !== incoming.filePath)].slice(0, MAX_RECENT))
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

export const register: Register = on => {
  // What each context block last sent, so an unchanged selection is not resent.
  const lastSent = new Map<string, string>()

  function isFresh(key: string, value: string) {
    const isSame = lastSent.get(key) === value
    lastSent.set(key, value)
    return !isSame
  }

  on('command.run', { command: 'editor-context-demo' }, async $ => {
    await update($, isDemo, v => !v)
    return { text: (await read($, isDemo)) ? 'Editor band demo on: every row is shown with sample data. Run again to turn it off.' : 'Editor band demo off.' }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'editor-context-demo',
      description: 'Toggle sample data in the editor band to preview every row',
    })
    // The app's sessions start with no surface of their own and list it here.
    if (isDesktop(e.surface) || (await $.session.surfaces()).some(isDesktop)) void startBridge($)
    return result
  })

  // A desktop session may start without a surface and attach the app after.
  on('session.attach', async ($, e, next) => {
    if (isDesktop(e.surface)) void startBridge($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isActive && (await $.session.surfaces()).some(isDesktop)) void startBridge($)
    if (!isActive) return next(e)
    if (isStarting) await Promise.race([started, $.clock.sleep(START_WAIT_MS)])
    const s = await read($, selection)
    const origin = e.origin as { kind: string; name?: string }
    const isUser = origin.kind === 'composer' || origin.kind === 'bridge' ||
      (origin.kind === 'plugin' && origin.name === 'editor-context')
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

    const files = await read($, recent)
    if (files.length > 0 && !(await read($, isRecentHidden)) && isFresh('recent', files.join('|'))) {
      blocks.push(`Files the user recently viewed in ${s.ide}, most recent first: ${files.join(', ')}`)
    }

    return next({ ...e, context: [...(e.context ?? []), ...blocks] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isDesktop(e.surface) || e.props.hasSurvey) return next(e)
    if (!isActive) void startBridge($)
    // Other mods may draw in this band too: keep theirs, below ours.
    const below = await next(e)
    // The bottom of the chain is the engine's own (empty) band: it can't sit inside our Box.
    const hasBelow = below !== null && below !== undefined && (below as { type?: string }).type !== 'engine'
    const stackBelow = (tree: any) => {
      if (!hasBelow) return tree
      const table = $.ui.resolve(e)
      const { Box, Text } = table
      return (
        <Box flexDirection="column" width="100%" rowGap={1}>
          {tree}
          {'Svg' in table ? (
            <Box key="divider-below" width="100%"><table.Svg source={DIVIDER_SVG} alt="divider" height={1} /></Box>
          ) : (
            <Box key="divider-below" width="100%" overflow="hidden">
              <Text dimColor wrap="truncate-end">{'\u2500'.repeat(400)}</Text>
            </Box>
          )}
          {below}
        </Box>
      )
    }
    const demo = await read($, isDemo)
    const live = await read($, selection)
    if (!demo && !(await read($, ide))) {
      const n = await read($, notice)
      if (!n || (await read($, isNoticeHidden))) return below
      const { Box, Button, Text } = $.ui.resolve(e)
      const message =
        n.kind === 'no-node' ? `Editor context needs Node.js ${MIN_NODE_MAJOR} or later on this machine.`
        : n.kind === 'disconnected' ? `Lost connection to ${n.ide ?? 'your editor'}. Reconnecting\u2026`
        : 'No editor connected. Open VS Code or Cursor with the Claude Code extension installed.'
      return stackBelow(
        <Box flexDirection="row" alignItems="center" width="100%" columnGap={2}>
          <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1}>
            <Text color={WARN_COLOR}>{'\u25cb'}</Text>
            <Text dimColor>{message}</Text>
          </Box>
          <Box flexShrink={0}>
            <Button key="close-notice" label="Close" onPress={() => update($, isNoticeHidden, () => true)} />
          </Box>
        </Box>
      )
    }

    const s: EditorSelection | null = demo
      ? { ide: 'Cursor', filePath: '/demo/src/components/CheckoutForm.tsx', startLine: 12, endLine: 30, isEmpty: false, text: 'demo' }
      : live
    const paused = await read($, isPaused)
    const dirty = demo || (await read($, isDirty))
    const pinList: EditorSelection[] = demo
      ? [
          { ide: 'Cursor', filePath: '/demo/src/hooks/useCart.ts', startLine: 36, endLine: 48, isEmpty: false, text: 'demo' },
          { ide: 'Cursor', filePath: '/demo/src/api/client.ts', startLine: 3, endLine: 13, isEmpty: false, text: 'demo' },
        ]
      : await read($, pins)
    const files = demo ? DEMO_RECENT : await read($, recent)
    const showRecent = files.length > 0 && (demo || !(await read($, isRecentHidden)))
    const hasSelection = Boolean(s && !s.isEmpty && s.text)
    const canPin = hasSelection && pinList.length < MAX_PINS && !pinList.some(p => s && pinKey(p) === pinKey(s))
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const hasSvg = 'Svg' in elements

    const explain = () => {
      if (!s || demo) return
      lastSent.delete('selection')
      const text = hasSelection
        ? `Explain ${rangeLabel(s)} of \`${fileName(s.filePath)}\`.`
        : `Explain \`${fileName(s.filePath)}\`.`
      void $.prompt.submit({ text, asUser: true })
    }

    const icon = (name: string, color = ICON_COLOR) =>
      hasSvg ? <elements.Svg source={iconSvg(name, color)} alt={name} width={ICON_SIZE} height={ICON_SIZE} /> : null

    // An icon and its button, side by side: a Button carries a text label only.
    const action = (key: string, iconName: string, label: string, onPress: () => unknown) => (
      <Box key={`action:${key}`} flexDirection="row" alignItems="center" columnGap={1}>
        {icon(iconName)}
        <Button key={key} label={label} onPress={() => { void onPress() }} />
      </Box>
    )

    // Mid-dot separators between actions in a group.
    const dotted = (group: string, items: any[]): any[] =>
      items.filter(Boolean).flatMap((item, i) => (i === 0 ? [item] : [<Text key={`${group}-dot-${i}`} dimColor>{'\u00b7'}</Text>, item]))

    // Svg-capable surfaces get a drawn dot; the terminal gets the glyph.
    const dotSvg = paused
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="${ICON_COLOR}" stroke-width="1.5"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="${DOT_COLOR}"/></svg>`
    const dot = hasSvg
      ? <elements.Svg source={dotSvg} alt={paused ? 'paused' : 'sharing'} width={DOT_SIZE} height={DOT_SIZE} />
      : <Text color={paused ? undefined : DOT_COLOR} dimColor={paused}>{paused ? '\u25cb' : '\u25cf'}</Text>

    return stackBelow(
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row" alignItems="center" width="100%" columnGap={2}>
          <Box flexDirection="row" alignItems="center" columnGap={2} flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              {dot}
              <Text bold={!paused} dimColor={paused} wrap="truncate-middle">
                {s ? fileName(s.filePath) : 'no file focused'}
              </Text>
            </Box>
            {s ? <Text dimColor>{lineLabel(s)}</Text> : null}
            {dirty ? <Text color={WARN_COLOR}>unsaved</Text> : null}
            {paused ? <Text dimColor>(not shared)</Text> : null}
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {dotted('actions', [
              dirty && s ? action('save', 'save', 'Save', () => !demo && ideCall($, 'saveDocument', { filePath: s.filePath })) : null,
              s ? action('explain', 'explain', 'Explain', explain) : null,
              canPin && s ? action('pin', 'pin', 'Pin', () => !demo && update($, pins, list => [...list, s])) : null,
              files.length > 0 && !showRecent
                ? action('show-recent', 'recent', 'Recent', () => update($, isRecentHidden, () => false))
                : null,
              paused
                ? action('pause', 'resume', 'Resume', () => update($, isPaused, () => false))
                : action('pause', 'pause', 'Pause', () => update($, isPaused, () => true)),
            ])}
          </Box>
        </Box>
        {pinList.length > 0 ? (
          <Box flexDirection="column" width="100%" marginTop={1}>
            {pinList.map(pin => (
              <Box key={`pin:${pinKey(pin)}`} flexDirection="row" alignItems="center" width="100%" columnGap={2}>
                <Box flexDirection="row" alignItems="center" columnGap={2} flexGrow={1} flexShrink={1}>
                  <Box flexDirection="row" alignItems="center" columnGap={1}>
                    {icon('pin')}
                    <Text>{fileName(pin.filePath)}</Text>
                  </Box>
                  <Text dimColor>{`${rangeLabel(pin)} \u00b7 ${lineCount(pin)} ${lineCount(pin) === 1 ? 'line' : 'lines'}`}</Text>
                </Box>
                <Box flexShrink={0}>
                  {action(`unpin:${pinKey(pin)}`, 'unpin', 'Unpin', () =>
                    !demo && update($, pins, list => list.filter(p => pinKey(p) !== pinKey(pin))))}
                </Box>
              </Box>
            ))}
            {pinList.length > 1 ? (
              <Box flexDirection="row" justifyContent="flex-end" width="100%">
                <Button key="unpin-all" plain dimColor label="Unpin all" onPress={() => { if (!demo) void update($, pins, () => []) }} />
              </Box>
            ) : null}
          </Box>
        ) : null}
        {showRecent ? (
          <Box flexDirection="row" alignItems="center" width="100%" columnGap={2} marginTop={1}>
            <Box flexDirection="row" alignItems="center" columnGap={2} flexGrow={1} flexShrink={1} flexWrap="wrap">
              <Box flexDirection="row" alignItems="center" columnGap={1}>
                {icon('recent')}
                <Text dimColor>Recent</Text>
              </Box>
              {files.map(f => (
                <Button
                  key={`recent:${f}`}
                  plain
                  dimColor
                  label={fileName(f)}
                  onPress={() => { if (!demo) void ideCall($, 'openFile', { filePath: f, startText: '', endText: '', makeFrontmost: true }) }}
                />
              ))}
            </Box>
            <Box flexShrink={0}>
              {action('close-recent', 'close', 'Close', () => !demo && update($, isRecentHidden, () => true))}
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })
}
