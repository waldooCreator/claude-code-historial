#!/usr/bin/env python3
"""Lista las conversaciones de ~/.claude/projects como JSON: id, titulo, cwd, mtime,
ruta y, si nació de un /clear, `prev`: la conversación de la que viene.

Uso: listar.py LIMITE [IDS_FIJOS separados por coma]
"""
import json, os, re, sys, glob
from datetime import datetime

TAIL = 400_000
HEAD = 200_000
UUID = re.compile(r'"session_id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"')
# Cuánto puede pasar entre el último registro de la conversación vieja y el
# primero de la nueva para tomarlas por el mismo /clear.
HOLGURA_S = 120


def lee(path, n, desde_fin):
    with open(path, 'rb') as f:
        if desde_fin:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - n))
        return f.read(n).decode('utf-8', 'replace').splitlines()


def texto(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ' '.join(p.get('text', '') for p in c if isinstance(p, dict) and p.get('type') == 'text')
    return ''


def instante(valor):
    try:
        return datetime.fromisoformat(valor.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def titulo_propio(path):
    """El último nombre puesto a mano (/rename), leído del final del archivo."""
    custom = None
    for l in lee(path, TAIL, True):
        if '"custom-title"' in l:
            try:
                custom = json.loads(l).get('customTitle') or custom
            except Exception:
                pass
    return custom


def una(path):
    """Título, carpeta de trabajo y, si nació de un /clear, lo que hace falta
    para encontrar su conversación anterior."""
    own = os.path.basename(path)[:-6]
    titulo = custom = cwd = primero = inicio = None
    for l in lee(path, TAIL, True):
        if '"ai-title"' in l or '"custom-title"' in l:
            try:
                o = json.loads(l)
            except Exception:
                continue
            if o.get('type') == 'custom-title':
                custom = o.get('customTitle') or custom
            elif o.get('type') == 'ai-title':
                titulo = o.get('aiTitle') or titulo
    cabeza = lee(path, HEAD, False)
    nace_de_clear = False
    usuarios = 0
    for l in cabeza:
        try:
            o = json.loads(l)
        except Exception:
            continue
        cwd = cwd or o.get('cwd')
        inicio = inicio or instante(o.get('timestamp', '') or '')
        if o.get('type') == 'user':
            usuarios += 1
            t = texto(o.get('message', {}).get('content'))
            if usuarios <= 4 and '<command-name>/clear</command-name>' in t:
                nace_de_clear = True
            t = t.strip()
            if primero is None and not o.get('isMeta') and t and not t.startswith('<'):
                primero = t.replace('\n', ' ')[:80]
        if cwd and primero and inicio and usuarios > 4:
            break
    enlace = None
    if nace_de_clear:
        for l in cabeza[:200]:
            for m in UUID.findall(l):
                if m != own:
                    enlace = m
                    break
            if enlace:
                break
    return {
        'title': custom or titulo or primero,
        'cwd': cwd,
        'clear': nace_de_clear,
        'enlace': enlace,
        'inicio': inicio,
        'custom': custom,
    }


def anterior(path, info, por_carpeta):
    """La conversación que un /clear dejó atrás, solo cuando el /clear le copió
    su nombre (que es cuando se ven dos iguales): la del enlace explícito o, si
    no lo hay, la de la misma carpeta con ese nombre que terminó justo antes."""
    carpeta = os.path.dirname(path)
    if not info['custom']:
        return None
    vieja = os.path.join(carpeta, (info['enlace'] or '') + '.jsonl')
    if info['enlace'] and os.path.exists(vieja) and titulo_propio(vieja) == info['custom']:
        return info['enlace']
    if not info['inicio']:
        return None
    # La vieja puede seguir escribiendo un poco después del /clear (su título, por
    # ejemplo): vale la más cercana en el tiempo, dentro de la holgura.
    cerca = sorted(
        (abs(m - info['inicio']), p) for m, p in por_carpeta.get(carpeta, []) if p != path and abs(m - info['inicio']) <= HOLGURA_S
    )
    for _, p in cerca:
        if titulo_propio(p) == info['custom']:
            return os.path.basename(p)[:-6]
    return None


def main():
    base = os.path.expanduser('~/.claude/projects')
    archivos = []
    for p in glob.glob(os.path.join(base, '*', '*.jsonl')):
        try:
            archivos.append((os.stat(p).st_mtime, p))
        except OSError:
            pass
    archivos.sort(reverse=True)
    por_carpeta = {}
    for m, p in archivos:
        por_carpeta.setdefault(os.path.dirname(p), []).append((m, p))
    ruta = {os.path.basename(p)[:-6]: (m, p) for m, p in archivos}

    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    fijos = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else set()
    out = {}
    anteriores = []

    def agrega(id_):
        m, p = ruta[id_]
        info = una(p)
        if not info['title']:
            return
        item = {'id': id_, 'title': info['title'], 'cwd': info['cwd'] or os.path.expanduser('~'), 'mtime': int(m * 1000), 'path': p}
        if info['clear']:
            prev = anterior(p, info, por_carpeta)
            if prev:
                item['prev'] = prev
                anteriores.append(prev)
        out[id_] = item

    for m, p in archivos:
        id_ = os.path.basename(p)[:-6]
        if len(out) >= limite and id_ not in fijos:
            continue
        agrega(id_)
    # Las anteriores de cada cadena de /clear entran también, para poder reabrirlas.
    while anteriores:
        id_ = anteriores.pop(0)
        if id_ not in out and id_ in ruta:
            agrega(id_)
    lista = sorted(out.values(), key=lambda c: -c['mtime'])
    json.dump(lista, sys.stdout, ensure_ascii=False)


main()
