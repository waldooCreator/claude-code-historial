import type { EngineInterface, Register } from 'claude-code'

const PANE = 'historial'
const LIMIT = 60

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

// A folder with a pin, 9x7 pixels.
const ICON = [
  '.........',
  '.OOO.....',
  'OHHHOOOOO',
  'OHHHHHHHO',
  'OHHHHHHHO',
  'OHHHHHHHO',
  'OOOOOOOOO',
]

let chats: Chat[] = []
let pinned: string[] = []
let isLoading = false
let failure: string | undefined
let isOpen = false
let folders: Folder[] = []
let moving: string | undefined
let isNaming = false

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

/** The banner as terminal cells: two pixels per cell (upper half block). */
const banner = (columns: number) => {
  const rows = 4
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
  ICON.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch === 'O') put(2 + x, 1 + y, C.orange)
      if (ch === 'H') put(2 + x, 1 + y, C.orangeHi)
    }),
  )
  put(8, 3, C.gold)
  put(9, 3, C.gold)
  put(8, 4, C.gold)
  put(9, 4, C.gold)
  let x0 = 13
  for (const letter of 'HISTORIAL') {
    FONT[letter].forEach((line, y) =>
      [...line].forEach((bit, x) => {
        if (bit === '1') put(x0 + x + 1, 2 + y, C.dim)
        if (bit === '1') put(x0 + x, 1 + y, C.cream)
      }),
    )
    x0 += 4
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

async function toggle($: EngineInterface): Promise<void> {
  const open = (await $.ui.panes()).some(p => p.id === PANE)
  if (open) {
    await $.ui.close({ id: PANE })
    isOpen = false
  } else {
    await $.ui.open({ id: PANE, title: 'Historial', focus: true })
    isOpen = true
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
    if (e.id === PANE) isOpen = false

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
    const art = banner(columns)
    const byId = new Map(chats.map(c => [c.id, c]))
    const inFolder = new Set(folders.flatMap(f => f.chats))
    const fixed = pinned.map(id => byId.get(id)).filter((c): c is Chat => !!c)
    const rest = chats.filter(c => !pinned.includes(c.id) && !inFolder.has(c.id))
    const room = Math.max(8, columns - 14)
    const folderOf = (id: string) => folders.find(f => f.chats.includes(id))?.name

    const row = (c: Chat, indent = '', tag = false) => (
      <Box key={`row-${c.id}`} flexDirection="column">
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
        <Text color={C.accent}>▀▀ RECIENTES ▀▀</Text>
        {moving && inFolder.has(moving) && (
          <Button key="out" plain onPress={() => void dropInto($, undefined)}>
            <Text color={C.accent}>⮑ sacar de su carpeta</Text>
          </Button>
        )}
        {rest.map(c => row(c))}
        <Text color={C.muted}>▄▄▄ {chats.length} conversaciones ▄▄▄</Text>
      </Box>
    )
  })
}
