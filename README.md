# ▐█▌ Historial — tus conversaciones de Claude Code en una barra lateral

Un mod para [Claude Code](https://claude.com/claude-code) que añade un botón **HISTORIAL** a la derecha, sobre el prompt. Al pulsarlo se abre una barra lateral pixel art con tus conversaciones más recientes; un clic en una de ellas la reabre en una pestaña nueva de tu terminal.

## Instalación

Escribe esto en el prompt de Claude Code:

```
/plugin install historial --marketplace waldooCreator/claude-code-historial
```

Responde `y` para agregar el marketplace y elige el alcance **user** (Enter).

<details>
<summary>Otras formas de instalarlo</summary>

Desde una terminal normal:

```bash
claude plugin install historial --marketplace waldooCreator/claude-code-historial
```

Probarlo sin instalar:

```bash
git clone https://github.com/waldooCreator/claude-code-historial.git
claude --plugin-dir ./claude-code-historial
```

</details>

## Qué hace

- 🕘 **Recientes**: lee `~/.claude/projects` y lista las conversaciones de la más nueva a la más vieja, con el resumen del tema como título, la carpeta del proyecto y hace cuánto fue. Un clic en `▼ RECIENTES` pliega la lista y lo recuerda.
- ★ **Fijadas**: la estrella fija una conversación para que salga siempre arriba.
- ▣ **Carpetas**: crea carpetas con `＋ nueva carpeta`, ábrelas y ciérralas con un clic. Para meter un chat, pulsa su `▢` y luego `⮑ aquí` en la carpeta; `⮑ sacar de su carpeta` lo devuelve a recientes.
- 🖱️ **Reabrir**: un clic en el título abre `claude --resume` en una pestaña nueva de Ptyxis, en la carpeta donde se creó la conversación.
- `/historial` abre y cierra la barra desde el teclado.
- 🦀 **Cabecera animada**: Clawd parpadea, salta y celebra junto a HISTORIAL, que crece con el ancho de la barra.

La barra se acopla al lado del chat en pantalla completa con 110 columnas o más; con menos, se abre sobre el prompt.

## Requisitos

- Linux con [Ptyxis](https://gitlab.gnome.org/chergert/ptyxis) (la terminal de Fedora). Con otra terminal hay que cambiar el comando de `resume` en `hooks/register.tsx`.
- `python3` (lee los archivos de las conversaciones; no instala nada).

## Privacidad

Todo es local. El mod solo lee tus conversaciones de `~/.claude/projects` y guarda tus fijadas y carpetas en el almacén local de Claude Code. No envía nada a ningún sitio.

## Licencia

MIT.
