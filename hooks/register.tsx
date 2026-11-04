import type { EngineInterface, Register, Timer } from 'claude-code'

const PANE = 'historial'
const LIMIT = 60
const TICK_MS = 150
// While the bar is open it looks for what other sessions changed every ~1 s.
const SYNC_TICKS = 6

type Chat = { id: string; title: string; cwd: string; mtime: number; path?: string; prev?: string }
type Folder = { id: string; name: string; isOpen: boolean; chats: string[] }
// What every session shares through one file: ~/.claude/historial/estado.json.
type Shared = { pinned: string[]; folders: Folder[]; isRecentOpen: boolean; links: Record<string, string> }
// One chat as the list shows it: the conversation in use and, newest first, the
// ones a /clear left behind under the same name.
type Group = { head: Chat; members: Chat[] }

// Pixel palette, 0xRRGGBB.
const C = {
  bg: 0x1b1924,
  bgAlt: 0x221f2d,
  edge: 0x4a4462,
  orange: 0xd97757,
  orangeHi: 0xf0a07f,
  cream: 0xf3e3c3,
  dim: 0x9a93a8,
  gold: 0xe8c15a,
  star: '#e8c15a',
  accent: '#d97757',
  text: '#f3e3c3',
  muted: '#9a93a8',
}

// 3x5 pixel font for the banner.
const FONT: Record<string, string[]> = {
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  O: ['111', '101', '101', '101', '111'],
  R: ['110', '101', '110', '101', '101'],
  A: ['010', '101', '111', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
}

let chats: Chat[] = []
let pinned: string[] = []
let isLoading = false
let failure: string | undefined
let isOpen = false
let folders: Folder[] = []
let moving: string | undefined
let isNaming = false
let isRecentOpen = true
let tick = 0
let ticker: Timer | undefined
let mounted: { columns: number; rows: number } | undefined
let file: string | undefined
let seen = 0
let queue: Promise<unknown> = Promise.resolve()
// /clear links this mod saw happen: new session id → the one it cleared.
let links: Record<string, string> = {}
let groupOf = new Map<string, Group>()
let expanded = new Set<string>()
let deleting: string | undefined
let currentId: string | undefined

const age = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 90) return 'ahora'
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d`
  return `${Math.round(s / 86400 / 30)} m`
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)
const folder = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? '~'
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Clawd, 16x5: `#` body, `e` eye, `l` leg.
const CLAWD = {
  stand: ['..############..', '..##e######e##..', '################', '..############..', '...l.l....l.l...'],
  walk: ['..############..', '..##e######e##..', '################', '..############..', '..l.l......l.l..'],
  cheer: ['#.############.#', '#.##e######e##.#', '..############..', '..############..', '...l.l....l.l...'],
}
const SPARK = [[0, 1], [-1, 0], [0, 0], [1, 0], [0, -1]]
const WORD = 'HISTORIAL'

type Layout = { rows: number; scale: number; isStacked: boolean; hasClawd: boolean }

/** Picks the banner's size for the pane's width: the word as large as it fits. */
const layoutFor = (columns: number): Layout => {
  if (columns >= 93) return { rows: 7, scale: 2, isStacked: false, hasClawd: true }
  if (columns >= 74) return { rows: 10, scale: 2, isStacked: true, hasClawd: true }
  if (columns >= 58) return { rows: 4, scale: 1, isStacked: false, hasClawd: true }
  if (columns >= 37) return { rows: 8, scale: 1, isStacked: true, hasClawd: true }

  return { rows: 4, scale: 1, isStacked: false, hasClawd: false }
}

/** The banner as terminal cells: two pixels per cell (upper half block). */
const banner = (columns: number, tick: number) => {
  const { rows, scale, isStacked, hasClawd } = layoutFor(columns)
  const h = rows * 2
  const px: number[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: columns }, (_, x) => ((x + y) % 2 === 0 ? C.bg : C.bgAlt)),
  )
  const put = (x: number, y: number, c: number) => {
    if (y >= 0 && y < h && x >= 0 && x < columns) px[y][x] = c
  }
  for (let x = 0; x < columns; x++) {
    put(x, 0, C.edge)
    put(x, h - 1, C.edge)
  }

  // The word, `scale` pixels per font pixel, with a dark one-pixel drop shadow.
  const wordW = WORD.length * 3 * scale + (WORD.length - 1) * scale
  const wordH = 5 * scale
  const clawdW = hasClawd ? 16 : 0
  const wordX = isStacked
    ? Math.max(1, Math.floor((columns - wordW) / 2))
    : hasClawd
      ? Math.min(2 + clawdW + 3, Math.max(1, columns - wordW - 1))
      : Math.max(1, Math.floor((columns - wordW) / 2))
  const wordY = isStacked ? h - 1 - wordH - 1 : Math.floor((h - wordH) / 2)
  let x0 = wordX
  for (const letter of WORD) {
    FONT[letter].forEach((line, fy) =>
      [...line].forEach((bit, fx) => {
        if (bit !== '1') return
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            put(x0 + fx * scale + dx + 1, wordY + fy * scale + dy + 1, 0x7a3b2e)
            put(x0 + fx * scale + dx, wordY + fy * scale + dy, C.cream)
          }
        }
      }),
    )
    x0 += 4 * scale
  }

  // Clawd: blinks, hops, shuffles its feet and now and then cheers.
  if (hasClawd) {
    const cheer = tick % 64 < 8
    const frame = cheer ? CLAWD.cheer : tick % 12 < 6 ? CLAWD.stand : CLAWD.walk
    const isBlink = tick % 26 < 2
    const hop = cheer ? (tick % 4 < 2 ? -1 : 0) : tick % 12 < 6 ? 0 : -1
    const cx = isStacked ? Math.floor((columns - clawdW) / 2) : 2
    const cy = isStacked ? 3 : wordY + wordH - 5 + 1
    frame.forEach((line, j) =>
      [...line].forEach((ch, i) => {
        if (ch === '.') return
        const color = ch === 'e' ? (isBlink ? 0x8c3f2b : 0x2a1a14) : ch === 'l' ? 0xb5603f : C.orange
        put(cx + i, cy + j + hop, color)
      }),
    )
    // A twinkle that wanders around its head.
    const spots = [[-3, 0], [clawdW + 2, 1], [clawdW + 1, -2], [-2, 3]]
    const [sx, sy] = spots[Math.floor(tick / 8) % spots.length]
    if (tick % 8 < 6) SPARK.forEach(([dx, dy]) => put(cx + sx + dx + 1, cy + sy + dy + 1, tick % 16 < 8 ? C.gold : C.cream))
  }

  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < columns; x++) {
      const i = (r * columns + x) * 3
      words[i] = 0x2580
      words[i + 1] = px[r * 2][x]
      words[i + 2] = px[r * 2 + 1][x]
    }
  }

  return { rows, cells: new Uint8Array(words.buffer).toBase64() }
}

/**
 * One file for every session. The plugin's own store is not it: each install
 * keeps a store of its own, and a session holds on to what it read, so a
 * change made in one terminal never reached another.
 */
async function sharedPath($: EngineInterface): Promise<string> {
  file ??= `${(await $.env.get('HOME')) ?? ''}/.claude/historial/estado.json`

  return file
}

function apply(s: Shared): void {
  pinned = s.pinned ?? []
  folders = s.folders ?? []
  isRecentOpen = s.isRecentOpen !== false
  links = s.links ?? {}
}

/** Runs `work` after every read and write before it, so they never cross. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const done = queue.then(work)
  queue = done.catch(() => undefined)

  return done
}

/** The shared file as it is now, or undefined when no session has written it yet. */
async function readShared($: EngineInterface): Promise<Shared | undefined> {
  const path = await sharedPath($)
  if (!(await $.fs.exists(path))) return undefined
  // Another session may be halfway through writing it: try again.
  for (let i = 0; ; i++) {
    try {
      const { mtimeMs } = await $.fs.stat(path)
      const shared = JSON.parse((await $.fs.read(path)) as string) as Shared
      seen = mtimeMs

      return shared
    } catch (error) {
      if (i >= 4) throw error
      await $.clock.sleep(40)
    }
  }
}

/** What this install kept in its own store before the shared file: where the file starts from. */
async function fromStore($: EngineInterface): Promise<Shared> {
  return {
    pinned: ((await $.store.get('pinned')) as string[] | undefined) ?? [],
    folders: ((await $.store.get('folders')) as Folder[] | undefined) ?? [],
    isRecentOpen: (await $.store.get('recentOpen')) !== false,
    links: ((await $.store.get('links')) as Record<string, string> | undefined) ?? {},
  }
}

/** Applies `change` to what the file holds now, never to this session's copy, and writes it. */
function save($: EngineInterface, change: (now: Shared) => Shared): Promise<boolean> {
  return inTurn(async () => {
    try {
      const next = change((await readShared($)) ?? (await fromStore($)))
      apply(next)
      $.ui.invalidate('ui.render')
      await $.fs.write(await sharedPath($), JSON.stringify(next, null, 1))

      return true
    } catch (error) {
      $.ui.toast(`No pude guardar el historial: ${error instanceof Error ? error.message : String(error)}`)

      return false
    }
  })
}

/** Picks up what another session wrote since this one last read the file. */
function sync($: EngineInterface): Promise<void> {
  return inTurn(async () => {
    const stat = await $.fs.stat(await sharedPath($)).catch(() => undefined)
    if (!stat || stat.mtimeMs === seen) return
    const shared = await readShared($).catch(() => undefined)
    if (!shared) return
    apply(shared)
    $.ui.invalidate('ui.render')
    // A chat filed from another session that this one has not listed yet.
    const listed = new Set(chats.map(c => c.id))
    if ([...pinned, ...folders.flatMap(f => f.chats)].some(id => !listed.has(id))) void load($)
  })
}

async function load($: EngineInterface): Promise<void> {
  if (isLoading) return
  isLoading = true
  failure = undefined
  $.ui.invalidate('ui.render')
  try {
    apply(await inTurn(async () => (await readShared($)) ?? (await fromStore($))))
    const keep = [...pinned, ...folders.flatMap(f => f.chats)]
    const run = await $.process.run(
      ['python3', '-I', `${$.plugin.root}/hooks/listar.py`, String(LIMIT), keep.join(',')],
      { timeoutMs: 20000 },
    )
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || 'falló el lector')
    chats = JSON.parse(run.stdout) as Chat[]
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    isLoading = false
    $.ui.invalidate('ui.render')
  }
}

function startTicking($: EngineInterface): void {
  if (ticker) return
  ticker = $.clock.every(TICK_MS, () => void frame($))
}

function stopTicking(): void {
  ticker?.cancel()
  ticker = undefined
  mounted = undefined
}

async function frame($: EngineInterface): Promise<void> {
  tick++
  // While the bar is open: what other sessions changed every ~1 s, the list every 30 s.
  if (tick % 200 === 0) void load($)
  else if (tick % SYNC_TICKS === 0) void sync($)
  const drawn = mounted
  if (!drawn) return
  const art = banner(drawn.columns, tick)
  const blit = await $.ui.blit({ requestId: PANE, key: 'banner', cells: art.cells, columns: drawn.columns, rows: art.rows })
  // Not drawn any more (closed or resized): wait for the next render.
  if (blit.deny && mounted === drawn) mounted = undefined
}

async function toggle($: EngineInterface): Promise<void> {
  const open = (await $.ui.panes()).some(p => p.id === PANE)
  if (open) {
    await $.ui.close({ id: PANE })
    isOpen = false
    stopTicking()
  } else {
    await $.ui.open({ id: PANE, title: 'Historial', focus: true })
    isOpen = true
    startTicking($)
    void load($)
  }
  $.ui.invalidate('ui.render')
}

async function pin($: EngineInterface, id: string): Promise<void> {
  const ids = idsOf(groupOf.get(id), id)
  await save($, s => ({
    ...s,
    pinned: s.pinned.some(p => ids.includes(p)) ? s.pinned.filter(p => !ids.includes(p)) : [id, ...s.pinned],
  }))
}

/** Changes the folders on top of what the shared file holds now: another session may have changed them. */
async function saveFolders($: EngineInterface, change: (now: Folder[]) => Folder[]): Promise<void> {
  await save($, s => ({ ...s, folders: change(s.folders) }))
}

/**
 * Gathers each chat with the ones a /clear left behind. Claude Code copies a
 * chat's name into the session a /clear starts, so two rows would read the
 * same: they are one chat, shown once, its newest session on top.
 */
function groups(list: Chat[]): Group[] {
  const byId = new Map(list.map(c => [c.id, c]))
  const prevOf = (c: Chat) => {
    const prev = byId.get(c.prev ?? links[c.id] ?? '')

    return prev && prev.title === c.title ? prev : undefined
  }
  const rootOf = (c: Chat) => {
    const seen = new Set<string>()
    let at = c
    for (let prev = prevOf(at); prev && !seen.has(prev.id); prev = prevOf(at)) {
      seen.add(at.id)
      at = prev
    }

    return at.id
  }
  const byRoot = new Map<string, Chat[]>()
  for (const c of list) byRoot.set(rootOf(c), [...(byRoot.get(rootOf(c)) ?? []), c])
  const out = [...byRoot.values()].map(members => {
    const sorted = [...members].sort((a, b) => b.mtime - a.mtime)

    return { head: sorted[0]!, members: sorted }
  })
  groupOf = new Map(out.flatMap(g => g.members.map(m => [m.id, g] as const)))

  return out.sort((a, b) => b.head.mtime - a.head.mtime)
}

const idsOf = (g: Group | undefined, id: string) => (g ? g.members.map(m => m.id) : [id])

async function createFolder($: EngineInterface, name: string): Promise<void> {
  isNaming = false
  const clean = name.trim().slice(0, 40)
  if (!clean) return $.ui.invalidate('ui.render')
  await saveFolders($, now => [...now, { id: `f${Date.now().toString(36)}`, name: clean, isOpen: true, chats: [] }])
}

async function toggleRecent($: EngineInterface): Promise<void> {
  await save($, s => ({ ...s, isRecentOpen: s.isRecentOpen === false }))
}

async function toggleFolder($: EngineInterface, id: string): Promise<void> {
  await saveFolders($, now => now.map(f => (f.id === id ? { ...f, isOpen: !f.isOpen } : f)))
}

async function deleteFolder($: EngineInterface, id: string): Promise<void> {
  await saveFolders($, now => now.filter(f => f.id !== id))
}

/** Puts the chat being moved into `target`, or out of every folder when undefined. */
async function dropInto($: EngineInterface, target: string | undefined): Promise<void> {
  const id = moving
  moving = undefined
  if (!id) return
  // The chat moves whole: every session a /clear left behind goes with it.
  const ids = idsOf(groupOf.get(id), id)
  await saveFolders($, now =>
    now.map(f => {
      const rest = f.chats.filter(c => !ids.includes(c))

      return f.id === target ? { ...f, isOpen: true, chats: [id, ...rest] } : { ...f, chats: rest }
    }),
  )
}

function startMove($: EngineInterface, id: string): void {
  moving = moving === id ? undefined : id
  $.ui.invalidate('ui.render')
}

function startNaming($: EngineInterface): void {
  isNaming = !isNaming
  $.ui.invalidate('ui.render')
}

/** A new tab in the Ptyxis window that is active (the one running Claude), in `cwd`. */
async function openTab($: EngineInterface, cwd: string, title: string, script: string): Promise<boolean> {
  const run = await $.process.run(
    ['setsid', '-f', 'ptyxis', '--tab', '-d', cwd, '-T', clip(title, 30), '--', 'bash', '-ic', `${script}; exec bash`],
    { timeoutMs: 8000 },
  )

  return run.exitCode === 0
}

async function resume($: EngineInterface, chat: Chat): Promise<void> {
  const isOpened = await openTab($, chat.cwd, chat.title, `claude --resume ${quote(chat.id)}`)
  $.ui.toast(isOpened ? `Abriendo «${clip(chat.title, 40)}»` : 'No pude abrir la terminal')
}

/**
 * A new Claude session in a tab of its own that files itself into `folder`: the
 * session reads HISTORIAL_CARPETA when it starts. It opens where the folder's
 * latest chat works, or here when the folder is empty.
 */
async function newChatIn($: EngineInterface, folder: Folder): Promise<void> {
  const latest = folder.chats
    .map(id => groupOf.get(id)?.head ?? chats.find(c => c.id === id))
    .filter((c): c is Chat => !!c)
    .sort((a, b) => b.mtime - a.mtime)[0]
  const cwd = latest?.cwd ?? (await $.session.cwd())
  const isOpened = await openTab($, cwd, `nuevo · ${folder.name}`, `HISTORIAL_CARPETA=${quote(folder.id)} claude`)
  $.ui.toast(isOpened ? `Chat nuevo en «${clip(folder.name, 30)}»` : 'No pude abrir la terminal')
}

/** Moves a chat (with the sessions a /clear left behind) to the trash, after a yes. */
async function trash($: EngineInterface, id: string): Promise<void> {
  deleting = undefined
  const ids = idsOf(groupOf.get(id), id)
  currentId = currentId ?? (await $.session.id())
  if (ids.includes(currentId)) {
    $.ui.toast('No puedo borrar la conversación en la que estás')

    return $.ui.invalidate('ui.render')
  }
  const run = await $.process.run(['python3', '-I', `${$.plugin.root}/hooks/papelera.py`, ...ids], { timeoutMs: 15000 })
  if (run.exitCode !== 0) {
    $.ui.toast('No pude moverla a la papelera')

    return $.ui.invalidate('ui.render')
  }
  await save($, s => ({
    ...s,
    folders: s.folders.map(f => ({ ...f, chats: f.chats.filter(c => !ids.includes(c)) })),
    pinned: s.pinned.filter(p => !ids.includes(p)),
  }))
  chats = chats.filter(c => !ids.includes(c.id))
  $.ui.toast('Movida a la papelera: ~/.claude/historial-papelera')
  $.ui.invalidate('ui.render')
}

function askDelete($: EngineInterface, id: string | undefined): void {
  deleting = id
  $.ui.invalidate('ui.render')
}

function toggleExpanded($: EngineInterface, id: string): void {
  expanded = new Set(expanded)
  if (!expanded.delete(id)) expanded.add(id)
  $.ui.invalidate('ui.render')
}

/** Remembers which session a /clear started from the one it ended. */
async function linkClear($: EngineInterface, cleared: string): Promise<void> {
  for (let tries = 0; tries < 10; tries++) {
    await $.clock.sleep(300)
    const now = await $.session.id()
    if (now && now !== cleared) {
      currentId = now
      await save($, s => ({ ...s, links: { ...s.links, [now]: cleared } }))

      return
    }
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'historial', description: 'Abre o cierra la barra de conversaciones' })
    currentId = await $.session.id()
    // A chat opened with ＋ in a folder files itself there.
    const target = await $.env.get('HISTORIAL_CARPETA')
    if (target && e.isInteractive && currentId) {
      const id = currentId
      await saveFolders($, now =>
        now.some(f => f.id === target) && !now.some(f => f.chats.includes(id))
          ? now.map(f => (f.id === target ? { ...f, isOpen: true, chats: [id, ...f.chats] } : f))
          : now,
      )
    }
    void load($)

    return next(e)
  })

  // A /clear goes on under a new session: remember where it came from.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') void linkClear($, e.sessionId)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'historial' }, async $ => {
    await toggle($)

    return { text: 'Historial.' }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) {
      isOpen = false
      stopTicking()
    }

    return result
  }).catch(($, e, next) => next(e))

  // The button on the right, above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="historial" plain onPress={() => void toggle($)}>
          <Text color={C.accent}>▐█▌</Text> <Text color={C.text}>{isOpen ? 'HISTORIAL ▶' : '◀ HISTORIAL'}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Raster, Input } = $.ui.resolve(e)
    const columns = Math.min(120, Math.max(24, e.props.bodyColumns))
    const art = banner(columns, tick)
    mounted = { columns, rows: art.rows }
    startTicking($)
    const all = groups(chats)
    const byId = new Map(chats.map(c => [c.id, c]))
    // A chat is pinned, or in a folder, when any of its sessions is.
    const has = (ids: string[], g: Group) => g.members.some(m => ids.includes(m.id))
    const folderOf = (g: Group) => folders.find(f => has(f.chats, g))
    const isPinned = (g: Group) => has(pinned, g)
    const fixed = all.filter(isPinned)
    const rest = all.filter(g => !isPinned(g) && !folderOf(g))
    const room = Math.max(8, columns - 14)

    const row = (g: Group, indent = '', options: { tag?: boolean; canDelete?: boolean } = {}) => {
      const c = g.head
      const older = g.members.length - 1
      const isExpanded = expanded.has(c.id)

      return (
        <Box key={`row-${c.id}`} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text>{indent}</Text>
            <Button key={`pin-${c.id}`} plain onPress={() => void pin($, c.id)}>
              <Text color={isPinned(g) ? C.star : C.muted}>{isPinned(g) ? '★' : '☆'}</Text>
            </Button>
            <Text> </Text>
            <Button key={`mv-${c.id}`} plain onPress={() => startMove($, c.id)}>
              <Text color={moving === c.id ? C.accent : C.muted}>{moving === c.id ? '▣' : '▢'}</Text>
            </Button>
            <Text> </Text>
            <Button key={`go-${c.id}`} plain onPress={() => void resume($, c)}>
              <Text color={C.text} weight="bold">{clip(c.title, room - indent.length - (options.canDelete ? 3 : 0))}</Text>
            </Button>
            {options.canDelete && (
              <Button key={`del-${c.id}`} plain dimColor onPress={() => askDelete($, deleting === c.id ? undefined : c.id)}>
                <Text color={deleting === c.id ? C.accent : C.muted}> ×</Text>
              </Button>
            )}
          </Box>
          <Box flexDirection="row">
            <Text color={C.muted}>
              {indent}
              {'    ▪ '}
              {clip(folder(c.cwd), Math.max(6, room - 22))} · {age(c.mtime)}
              {options.tag && folderOf(g) ? ` · ▣ ${clip(folderOf(g)?.name ?? '', 14)}` : ''}
            </Text>
            {older > 0 && (
              <Button key={`old-${c.id}`} plain dimColor onPress={() => toggleExpanded($, c.id)}>
                <Text color={C.muted}> · ↺ {older} antes</Text>
              </Button>
            )}
          </Box>
          {isExpanded &&
            g.members.slice(1).map(m => (
              <Button key={`go-${m.id}`} plain dimColor onPress={() => void resume($, m)}>
                <Text color={C.muted}>
                  {indent}
                  {'      ↺ antes del /clear · '}
                  {age(m.mtime)}
                </Text>
              </Button>
            ))}
          {deleting === c.id && (
            <Box flexDirection="column">
              <Text color={C.text}>
                {indent}
                {'    ¿Borrar «'}
                {clip(c.title, Math.max(6, room - 22))}
                {older > 0 ? `» y sus ${older} sesiones de antes del /clear?` : '»?'}
              </Text>
              <Box flexDirection="row">
                <Text>{indent}    </Text>
                <Button key={`yes-${c.id}`} plain onPress={() => void trash($, c.id)}>
                  <Text color="#e06c75">[ sí, borrar ]</Text>
                </Button>
                <Text> </Text>
                <Button key={`no-${c.id}`} plain onPress={() => askDelete($, undefined)}>
                  <Text color={C.muted}>[ cancelar ]</Text>
                </Button>
              </Box>
              <Text color={C.muted}>
                {indent}
                {'    Va a ~/.claude/historial-papelera: se puede recuperar.'}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Raster key="banner" columns={columns} rows={art.rows} cells={art.cells} />
        {isLoading && chats.length === 0 && <Text color={C.muted}>▪▪▪ cargando…</Text>}
        {failure && <Text color="#e06c75">✗ {failure}</Text>}
        {moving && (
          <Text color={C.accent}>
            ▶ moviendo «{clip(byId.get(moving)?.title ?? '', room - 10)}»: elige destino
          </Text>
        )}
        {fixed.length > 0 && <Text color={C.star}>▀▀ FIJADAS ▀▀</Text>}
        {fixed.map(g => row(g, '', { tag: true }))}
        <Text color={C.accent}>▀▀ CARPETAS ▀▀</Text>
        {folders.length === 0 && !isNaming && <Text color={C.muted}>  (aún no hay carpetas)</Text>}
        {folders.map(f => {
          const inside = all.filter(g => folderOf(g)?.id === f.id && !isPinned(g))

          return (
            <Box key={`fold-${f.id}`} flexDirection="column">
              <Box flexDirection="row">
                <Button key={`tg-${f.id}`} plain onPress={() => void toggleFolder($, f.id)}>
                  <Text color={C.star}>{f.isOpen ? '▼' : '▶'} ▣ </Text>
                  <Text color={C.text} weight="bold">{clip(f.name, room - 8)}</Text>
                  <Text color={C.muted}> ({inside.length})</Text>
                </Button>
                {!moving && (
                  <Button key={`new-${f.id}`} plain onPress={() => void newChatIn($, f)}>
                    <Text color={C.accent}> ＋ chat</Text>
                  </Button>
                )}
                {moving && (
                  <Button key={`in-${f.id}`} plain onPress={() => void dropInto($, f.id)}>
                    <Text color={C.accent}> ⮑ aquí</Text>
                  </Button>
                )}
                {!moving && (
                  <Button key={`rm-${f.id}`} plain dimColor onPress={() => void deleteFolder($, f.id)}>
                    <Text color={C.muted}> ✕</Text>
                  </Button>
                )}
              </Box>
              {f.isOpen && inside.map(g => row(g, '  ', { canDelete: true }))}
              {f.isOpen && inside.length === 0 && <Text color={C.muted}>    (vacía)</Text>}
            </Box>
          )
        })}
        {isNaming ? (
          <Input key="nueva" label="▣ " placeholder="nombre de la carpeta" submitLabel="crear" autoFocus onSubmit={v => void createFolder($, v)} />
        ) : (
          <Button key="nueva-btn" plain onPress={() => startNaming($)}>
            <Text color={C.accent}>＋ nueva carpeta</Text>
          </Button>
        )}
        <Button key="recientes" plain onPress={() => void toggleRecent($)}>
          <Text color={C.accent}>{isRecentOpen ? '▼' : '▶'} ▀▀ RECIENTES ▀▀</Text>
          <Text color={C.muted}> ({rest.length})</Text>
        </Button>
        {moving && (() => {
          const g = groupOf.get(moving)

          return g ? !!folderOf(g) : false
        })() && (
          <Button key="out" plain onPress={() => void dropInto($, undefined)}>
            <Text color={C.accent}>⮑ sacar de su carpeta</Text>
          </Button>
        )}
        {isRecentOpen && rest.map(g => row(g))}
        <Text color={C.muted}>▄▄▄ {all.length} conversaciones ▄▄▄</Text>
      </Box>
    )
  })
}
