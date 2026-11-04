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
- ＋ **Chat nuevo en una carpeta**: `＋ chat`, junto al nombre de la carpeta, abre una sesión nueva de Claude en una pestaña de Ptyxis, en la carpeta de trabajo de su chat más reciente, y la guarda sola en esa carpeta.
- × **Borrar un chat de una carpeta**: la `×` al lado del título pide confirmación y lo manda a la papelera, `~/.claude/historial-papelera`, de donde se puede recuperar. No deja borrar la conversación en la que estás.
- ↺ **Sin duplicados al hacer `/clear`**: `/clear` empieza una conversación nueva y Claude Code le copia el nombre de la anterior, así que salían dos iguales. Ahora el historial las junta en un solo chat: muestra la sesión en uso y `↺ 1 antes` despliega las de antes del `/clear` para reabrirlas. Fijar, mover o borrar el chat lo hace con todas sus sesiones. Si el `/clear` empieza algo con otro nombre, queda como chat aparte.
- 🖱️ **Reabrir**: un clic en el título abre `claude --resume` en una pestaña nueva de Ptyxis, en la carpeta donde se creó la conversación.
- 🔄 **En todas tus terminales a la vez**: carpetas, fijadas y lo plegado se guardan en un solo archivo que comparten todas las sesiones. Lo que cambias en una terminal aparece en la barra abierta de las otras en un segundo, sin recargar, y ningún cambio pisa el de otra sesión.
- `/historial` abre y cierra la barra desde el teclado.
- 🦀 **Cabecera animada**: Clawd parpadea, salta y celebra junto a HISTORIAL, que crece con el ancho de la barra.

La barra se acopla al lado del chat en pantalla completa con 110 columnas o más; con menos, se abre sobre el prompt.

## Requisitos

- Linux con [Ptyxis](https://gitlab.gnome.org/chergert/ptyxis) (la terminal de Fedora). Con otra terminal hay que cambiar el comando de `resume` en `hooks/register.tsx`.
- `python3` (lee los archivos de las conversaciones; no instala nada).

### Recuperar un chat borrado

Cada chat borrado queda en `~/.claude/historial-papelera/<proyecto>/<id>.jsonl` (con su carpeta de subagentes, si la tenía). Para devolverlo, muévelo de vuelta a la misma carpeta dentro de `~/.claude/projects/`:

```bash
mv ~/.claude/historial-papelera/<proyecto>/<id>* ~/.claude/projects/<proyecto>/
```

## Privacidad

Todo es local. El mod lee tus conversaciones de `~/.claude/projects`, guarda tus fijadas, carpetas y los enlaces de cada `/clear` en `~/.claude/historial/estado.json` (la primera vez lo llena con lo que había en el almacén local de Claude Code), y solo mueve archivos cuando borras un chat (a la papelera, nunca los elimina). No envía nada a ningún sitio.

## Licencia

MIT.
