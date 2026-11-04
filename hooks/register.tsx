import type { EngineInterface, Register, Timer } from 'claude-code'

const PANE = 'historial'
const LIMIT = 60
const TICK_MS = 150

type Chat = { id: string; title: string; cwd: string; mtime: number }
type Folder = { id: string; name: string; isOpen: boolean; chats: string[] }

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

async function load($: EngineInterface): Promise<void> {
  if (isLoading) return
  isLoading = true
  failure = undefined
  $.ui.invalidate('ui.render')
  try {
    pinned = ((await $.store.get('pinned')) as string[] | undefined) ?? []
    isRecentOpen = (await $.store.get('recentOpen')) !== false
    folders = ((await $.store.get('folders')) as Folder[] | undefined) ?? []
    try {
      const seed = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/semilla.json`) as string) as {
        id: string
        folders: Record<string, string[]>
      }
      if ((await $.store.get('seed')) !== seed.id) {
        folders = folders.map(f => {
          const ids = seed.folders[f.name]

          return ids ? { ...f, chats: [...ids, ...f.chats.filter(c => !ids.includes(c))] } : f
        })
        const taken = new Set(Object.values(seed.folders).flat())
        folders = folders.map(f => (seed.folders[f.name] ? f : { ...f, chats: f.chats.filter(c => !taken.has(c)) }))
        await $.store.set('folders', folders)
        await $.store.set('seed', seed.id)
      }
    } catch {
      // No seed file: nothing to import.
    }
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
  pinned = pinned.includes(id) ? pinned.filter(p => p !== id) : [id, ...pinned]
  await $.store.set('pinned', pinned)
  $.ui.invalidate('ui.render')
}

async function saveFolders($: EngineInterface, next: Folder[]): Promise<void> {
  folders = next
  await $.store.set('folders', folders)
  $.ui.invalidate('ui.render')
}

async function createFolder($: EngineInterface, name: string): Promise<void> {
  isNaming = false
  const clean = name.trim().slice(0, 40)
  if (!clean) return $.ui.invalidate('ui.render')
  await saveFolders($, [...folders, { id: `f${Date.now().toString(36)}`, name: clean, isOpen: true, chats: [] }])
}

async function toggleRecent($: EngineInterface): Promise<void> {
  isRecentOpen = !isRecentOpen
  await $.store.set('recentOpen', isRecentOpen)
  $.ui.invalidate('ui.render')
}

async function toggleFolder($: EngineInterface, id: string): Promise<void> {
  await saveFolders($, folders.map(f => (f.id === id ? { ...f, isOpen: !f.isOpen } : f)))
}

async function deleteFolder($: EngineInterface, id: string): Promise<void> {
  await saveFolders($, folders.filter(f => f.id !== id))
}

/** Puts the chat being moved into `target`, or out of every folder when undefined. */
async function dropInto($: EngineInterface, target: string | undefined): Promise<void> {
  const id = moving
  moving = undefined
  if (!id) return
  await saveFolders(
    $,
    folders.map(f => {
      const rest = f.chats.filter(c => c !== id)

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

async function resume($: EngineInterface, chat: Chat): Promise<void> {
  // A new tab in the Ptyxis window that is active (the one running Claude), in the chat's folder.
  const script = `claude --resume ${quote(chat.id)}; exec bash`
  const run = await $.process.run(
    ['setsid', '-f', 'ptyxis', '--tab', '-d', chat.cwd, '-T', clip(chat.title, 30), '--', 'bash', '-ic', script],
    { timeoutMs: 8000 },
  )
  $.ui.toast(run.exitCode === 0 ? `Abriendo «${clip(chat.title, 40)}»` : 'No pude abrir la terminal')
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'historial', description: 'Abre o cierra la barra de conversaciones' })
    void load($)

    return next(e)
  })

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
    const byId = new Map(chats.map(c => [c.id, c]))
    const inFolder = new Set(folders.flatMap(f => f.chats))
    const fixed = pinned.map(id => byId.get(id)).filter((c): c is Chat => !!c)
    const rest = chats.filter(c => !pinned.includes(c.id) && !inFolder.has(c.id))
    const room = Math.max(8, columns - 14)
    const folderOf = (id: string) => folders.find(f => f.chats.includes(id))?.name

    const row = (c: Chat, indent = '', tag = false) => (
      <Box key={`row-${c.id}`} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Text>{indent}</Text>
          <Button key={`pin-${c.id}`} plain onPress={() => void pin($, c.id)}>
            <Text color={pinned.includes(c.id) ? C.star : C.muted}>{pinned.includes(c.id) ? '★' : '☆'}</Text>
          </Button>
          <Text> </Text>
          <Button key={`mv-${c.id}`} plain onPress={() => startMove($, c.id)}>
            <Text color={moving === c.id ? C.accent : C.muted}>{moving === c.id ? '▣' : '▢'}</Text>
          </Button>
          <Text> </Text>
          <Button key={`go-${c.id}`} plain onPress={() => void resume($, c)}>
            <Text color={C.text} weight="bold">{clip(c.title, room - indent.length)}</Text>
          </Button>
        </Box>
        <Text color={C.muted}>
          {indent}
          {'    ▪ '}
          {clip(folder(c.cwd), Math.max(6, room - 14))} · {age(c.mtime)}
          {tag && folderOf(c.id) ? ` · ▣ ${clip(folderOf(c.id) ?? '', 14)}` : ''}
        </Text>
      </Box>
    )

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
        {fixed.map(c => row(c, '', true))}
        <Text color={C.accent}>▀▀ CARPETAS ▀▀</Text>
        {folders.length === 0 && !isNaming && <Text color={C.muted}>  (aún no hay carpetas)</Text>}
        {folders.map(f => {
          const inside = f.chats.map(id => byId.get(id)).filter((c): c is Chat => !!c && !pinned.includes(c.id))

          return (
            <Box key={`fold-${f.id}`} flexDirection="column">
              <Box flexDirection="row">
                <Button key={`tg-${f.id}`} plain onPress={() => void toggleFolder($, f.id)}>
                  <Text color={C.star}>{f.isOpen ? '▼' : '▶'} ▣ </Text>
                  <Text color={C.text} weight="bold">{clip(f.name, room - 8)}</Text>
                  <Text color={C.muted}> ({f.chats.length})</Text>
                </Button>
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
              {f.isOpen && inside.map(c => row(c, '  '))}
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
        {moving && inFolder.has(moving) && (
          <Button key="out" plain onPress={() => void dropInto($, undefined)}>
            <Text color={C.accent}>⮑ sacar de su carpeta</Text>
          </Button>
        )}
        {isRecentOpen && rest.map(c => row(c))}
        <Text color={C.muted}>▄▄▄ {chats.length} conversaciones ▄▄▄</Text>
      </Box>
    )
  })
}
