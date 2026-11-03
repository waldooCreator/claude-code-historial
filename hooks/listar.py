#!/usr/bin/env python3
"""Lista las conversaciones de ~/.claude/projects como JSON: id, titulo, cwd, mtime."""
import json, os, sys, glob

TAIL = 400_000
HEAD = 200_000


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


def una(path):
    titulo = custom = cwd = primero = None
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
    for l in lee(path, HEAD, False):
        try:
            o = json.loads(l)
        except Exception:
            continue
        cwd = cwd or o.get('cwd')
        if primero is None and o.get('type') == 'user' and not o.get('isMeta'):
            t = texto(o.get('message', {}).get('content')).strip()
            if t and not t.startswith('<'):
                primero = t.replace('\n', ' ')[:80]
        if cwd and primero:
            break
    return custom or titulo or primero, cwd


def main():
    base = os.path.expanduser('~/.claude/projects')
    archivos = []
    for p in glob.glob(os.path.join(base, '*', '*.jsonl')):
        try:
            archivos.append((os.stat(p).st_mtime, p))
        except OSError:
            pass
    archivos.sort(reverse=True)
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    fijos = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else set()
    out = []
    for m, p in archivos:
        id_ = os.path.basename(p)[:-6]
        if len(out) >= limite and id_ not in fijos:
            continue
        t, cwd = una(p)
        if not t:
            continue
        out.append({'id': id_, 'title': t, 'cwd': cwd or os.path.expanduser('~'), 'mtime': int(m * 1000)})
    json.dump(out, sys.stdout, ensure_ascii=False)


main()
