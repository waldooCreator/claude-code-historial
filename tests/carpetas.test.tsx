import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type Folder = { id: string; name: string; isOpen: boolean; chats: string[] }
type World = {
  store: Record<string, unknown>
  runs: string[][]
  chats: unknown[]
  env: Record<string, string>
  files?: Map<string, { text: string; mtimeMs: number }>
}
type Shared = { pinned: string[]; folders: Folder[]; isRecentOpen: boolean; links: Record<string, string> }

const NOW = Date.now()
const FILE = '/home/usuario/.claude/historial/estado.json'
let written = 0

/** Writes a file of the in-memory disk, as another session would. */
const put = (world: World, path: string, text: string) => world.files?.set(path, { text, mtimeMs: ++written })
/** The shared file every session reads and writes, when one has. */
const shared = (world: World) => {
  const file = world.files?.get(FILE)

  return file ? (JSON.parse(file.text) as Shared) : undefined
}
const foldersOf = (world: World) => shared(world)?.folders ?? (world.store.folders as Folder[])

// The engine beneath the mod: an in-memory store and disk, the reader's output, a pane.
function engine(on: On, world: World): void {
  let pane: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean } | undefined
  world.files ??= new Map()
  const files = world.files
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'sesion-actual' }))
  on('session.cwd', () => ({ value: '/home/usuario' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/usuario' : world.env[e.name] }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => (files.has(e.path) ? { value: files.get(e.path)!.text } : { deny: 'ENOENT' }) as never)
  on('fs.write', (_$, e) => {
    put(world, e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    const file = files.get(e.path)
    return (file ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } } : { deny: 'ENOENT' }) as never
  })
  on('store.get', (_$, e) => ({ value: world.store[e.key] }) as never)
  on('store.set', (_$, e) => {
    world.store[e.key] = e.value
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    world.runs.push([...e.argv])
    const script = e.argv.join(' ')
    if (script.includes('papelera.py')) return { value: { exitCode: 0, stdout: '{"movidas":[],"faltan":[]}', stderr: '' } } as never
    return { value: { exitCode: 0, stdout: JSON.stringify(world.chats), stderr: '' } } as never
  })
  on('ui.open', (_$, e) => {
    pane = { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: pane ? [pane] : [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

async function bar($: Engine) {
  await $.command.run({ command: 'historial', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'historial',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'historial',
    props: { title: 'Historial', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    viewport: { columns: 200, rows: 60, isFullscreen: true },
  } as never)
  await ui.drawn()

  return ui
}

const text = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn())

test('un /clear no duplica el chat: la carpeta lo muestra una vez, con lo de antes a mano', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['viejo'] }] satisfies Folder[] },
    runs: [],
    env: {},
    chats: [
      { id: 'nuevo', title: 'Nómina', cwd: '/tmp', mtime: NOW, prev: 'viejo' },
      { id: 'viejo', title: 'Nómina', cwd: '/tmp', mtime: NOW - 60_000 },
    ],
  }
  engine(on, world)
  const ui = await bar($)

  const drawn = await text(ui)
  // Una sola fila: la de la sesión en uso; la de antes del /clear, plegada.
  expect(drawn).toContain('"go-nuevo"')
  expect(drawn).not.toContain('"go-viejo"')
  expect(drawn).toContain('"1"," conversaciones')
  expect(drawn).toContain('1 antes')
  // Abrirlo abre la sesión en uso, la de después del /clear.
  await ui.press({ key: 'go-nuevo' })
  expect(world.runs.at(-1)?.join(' ')).toContain("--resume 'nuevo'")
  // Y lo de antes sigue a mano.
  await ui.press({ key: 'old-nuevo' })
  await ui.press({ key: 'go-viejo' })
  expect(world.runs.at(-1)?.join(' ')).toContain("--resume 'viejo'")
})

test('un /clear que empieza otra cosa (otro nombre) queda como chat aparte', async ($, on) => {
  const world: World = {
    store: { folders: [] },
    runs: [],
    env: {},
    chats: [
      { id: 'nuevo', title: 'Otra cosa', cwd: '/tmp', mtime: NOW, prev: 'viejo' },
      { id: 'viejo', title: 'Nómina', cwd: '/tmp', mtime: NOW - 60_000 },
    ],
  }
  engine(on, world)
  const ui = await bar($)
  const drawn = await text(ui)
  expect(drawn).toContain('Otra cosa')
  expect(drawn).toContain('Nómina')
  expect(drawn).not.toContain('antes')
})

test('borrar un chat de una carpeta pide confirmación y lo manda a la papelera con sus sesiones', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['viejo'] }] satisfies Folder[], pinned: ['nuevo'] },
    runs: [],
    env: {},
    chats: [
      { id: 'nuevo', title: 'Nómina', cwd: '/tmp', mtime: NOW, prev: 'viejo' },
      { id: 'viejo', title: 'Nómina', cwd: '/tmp', mtime: NOW - 60_000 },
      { id: 'otro', title: 'Cartera', cwd: '/tmp', mtime: NOW - 90_000 },
    ],
  }
  // Fijado no: así se ve dentro de la carpeta.
  world.store.pinned = []
  engine(on, world)
  const ui = await bar($)

  await ui.press({ key: 'del-nuevo' })
  expect(await text(ui)).toContain('¿Borrar')
  // Cancelar no toca nada.
  await ui.press({ key: 'no-nuevo' })
  expect(world.runs.some(r => r.join(' ').includes('papelera.py'))).toBe(false)

  await ui.press({ key: 'del-nuevo' })
  await ui.press({ key: 'yes-nuevo' })
  const trash = world.runs.find(r => r.join(' ').includes('papelera.py'))
  expect(trash?.slice(-2).sort()).toEqual(['nuevo', 'viejo'])
  expect(foldersOf(world)[0]?.chats).toEqual([])
  expect(shared(world)?.pinned).toEqual([])
  const drawn = await text(ui)
  expect(drawn).not.toContain('Nómina')
  expect(drawn).toContain('Cartera')
})

test('no se puede borrar la conversación en la que estás', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['sesion-actual'] }] satisfies Folder[] },
    runs: [],
    env: {},
    chats: [{ id: 'sesion-actual', title: 'Esta misma', cwd: '/tmp', mtime: NOW }],
  }
  engine(on, world)
  const ui = await bar($)
  await ui.press({ key: 'del-sesion-actual' })
  await ui.press({ key: 'yes-sesion-actual' })
  expect(world.runs.some(r => r.join(' ').includes('papelera.py'))).toBe(false)
  expect(foldersOf(world)[0]?.chats).toEqual(['sesion-actual'])
})

test('＋ chat abre una sesión nueva que se guarda sola en esa carpeta', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['a'] }] satisfies Folder[] },
    runs: [],
    env: {},
    chats: [{ id: 'a', title: 'Algo', cwd: '/proyectos/x', mtime: NOW }],
  }
  engine(on, world)
  const ui = await bar($)
  await ui.press({ key: 'new-f1' })
  const opened = world.runs.find(r => r.includes('ptyxis'))
  expect(opened).toBeDefined()
  expect(opened?.join(' ')).toContain("HISTORIAL_CARPETA='f1' claude")
  // Abre donde trabaja el chat más reciente de la carpeta.
  expect(opened?.[opened.indexOf('-d') + 1]).toBe('/proyectos/x')
})

test('una sesión abierta con HISTORIAL_CARPETA se guarda en esa carpeta al empezar', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: false, chats: ['a'] }] satisfies Folder[] },
    runs: [],
    env: { HISTORIAL_CARPETA: 'f1' },
    chats: [],
  }
  engine(on, world)
  await $.session.start({ source: 'startup', cwd: '/proyectos/x', surface: 'terminal', isInteractive: true } as never)
  expect(foldersOf(world)[0]).toMatchObject({ isOpen: true, chats: ['sesion-actual', 'a'] })
})

test('lo que otra sesión guarda aparece en la barra abierta en un segundo, sin recargar', async ($, on) => {
  const world: World = {
    store: {},
    runs: [],
    env: {},
    chats: [
      { id: 'a', title: 'Algo', cwd: '/tmp', mtime: NOW },
      { id: 'b', title: 'Cartera', cwd: '/tmp', mtime: NOW - 60_000 },
    ],
  }
  engine(on, world)
  const clock = mock.clock(on)
  put(world, FILE, JSON.stringify({ pinned: [], folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['a'] }], isRecentOpen: true, links: {} }))
  const ui = await bar($)
  expect(await text(ui)).not.toContain('Luna')

  // Otra terminal crea «Luna», mete «Cartera» y fija «Algo».
  put(world, FILE, JSON.stringify({
    pinned: ['a'],
    folders: [
      { id: 'f1', name: 'Trabajo', isOpen: true, chats: ['a'] },
      { id: 'f2', name: 'Luna', isOpen: true, chats: ['b'] },
    ],
    isRecentOpen: true,
    links: {},
  }))
  await clock.advance(1000)

  const drawn = await text(ui)
  expect(drawn).toContain('Luna')
  expect(drawn).toContain('FIJADAS')
})

test('meter un chat en una carpeta no borra lo que otra sesión guardó antes', async ($, on) => {
  const world: World = {
    store: {},
    runs: [],
    env: {},
    chats: [
      { id: 'a', title: 'Algo', cwd: '/tmp', mtime: NOW },
      { id: 'b', title: 'Cartera', cwd: '/tmp', mtime: NOW - 60_000 },
    ],
  }
  engine(on, world)
  put(world, FILE, JSON.stringify({ pinned: [], folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: [] }], isRecentOpen: true, links: {} }))
  const ui = await bar($)

  // Otra terminal crea «Luna» y mete «Algo» antes de que esta barra lo vea.
  put(world, FILE, JSON.stringify({
    pinned: [],
    folders: [
      { id: 'f1', name: 'Trabajo', isOpen: true, chats: [] },
      { id: 'f2', name: 'Luna', isOpen: true, chats: ['a'] },
    ],
    isRecentOpen: true,
    links: {},
  }))
  await ui.press({ key: 'mv-b' })
  await ui.press({ key: 'in-f1' })

  expect(foldersOf(world)).toEqual([
    { id: 'f1', name: 'Trabajo', isOpen: true, chats: ['b'] },
    { id: 'f2', name: 'Luna', isOpen: true, chats: ['a'] },
  ])
})

test('la primera vez, el archivo compartido empieza con lo que había en el almacén', async ($, on) => {
  const world: World = {
    store: { folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['a'] }] satisfies Folder[], pinned: ['a'], recentOpen: false },
    runs: [],
    env: {},
    chats: [
      { id: 'a', title: 'Algo', cwd: '/tmp', mtime: NOW },
      { id: 'b', title: 'Cartera', cwd: '/tmp', mtime: NOW - 60_000 },
    ],
  }
  engine(on, world)
  const ui = await bar($)
  expect(shared(world)).toBeUndefined()
  await ui.press({ key: 'recientes' })
  expect(shared(world)).toEqual({
    pinned: ['a'],
    folders: [{ id: 'f1', name: 'Trabajo', isOpen: true, chats: ['a'] }],
    isRecentOpen: true,
    links: {},
  })
})
