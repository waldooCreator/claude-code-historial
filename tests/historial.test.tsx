import { expect, test } from 'claude-code/testing'

const CHATS = JSON.stringify([
  { id: 'aaa', title: 'Historial de Claude Code', cwd: '/home/usuario', mtime: Date.now() },
  { id: 'bbb', title: 'Nómina', cwd: '/tmp', mtime: Date.now() - 7_200_000 },
])

test('/historial abre el panel y lo dibuja con las conversaciones', async ($, on) => {
  const opens: unknown[] = []
  let pane: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean } | undefined
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: CHATS, stderr: '' } }) as never)
  on('store.get', () => ({ value: [] }) as never)
  on('ui.open', (_$, e) => {
    opens.push(e)
    pane = { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: pane ? [pane] : [] }))

  const ran = await $.command.run({ command: 'historial', args: '' } as never)
  expect(ran).toMatchObject({ text: 'Historial.' })
  expect(opens).toHaveLength(1)
  expect(opens[0]).toMatchObject({ id: 'historial' })
})
