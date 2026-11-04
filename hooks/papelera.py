#!/usr/bin/env python3
"""Mueve conversaciones a la papelera del historial, ~/.claude/historial-papelera,
en vez de borrarlas: cada una con su carpeta de subagentes, si la tiene.

Uso: papelera.py ID [ID ...]
Imprime JSON: {"movidas": [ids], "faltan": [ids]}
"""
import json, os, re, shutil, sys, glob

ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def main():
    base = os.path.expanduser('~/.claude/projects')
    papelera = os.path.expanduser('~/.claude/historial-papelera')
    movidas, faltan = [], []
    for id_ in sys.argv[1:]:
        # Solo ids de conversación: nada de rutas que salgan de ~/.claude/projects.
        if not ID.match(id_):
            faltan.append(id_)
            continue
        hallados = glob.glob(os.path.join(base, '*', id_ + '.jsonl'))
        if not hallados:
            faltan.append(id_)
            continue
        for archivo in hallados:
            proyecto = os.path.basename(os.path.dirname(archivo))
            destino = os.path.join(papelera, proyecto)
            os.makedirs(destino, exist_ok=True)
            shutil.move(archivo, os.path.join(destino, id_ + '.jsonl'))
            subagentes = os.path.join(os.path.dirname(archivo), id_)
            if os.path.isdir(subagentes):
                shutil.move(subagentes, os.path.join(destino, id_))
        movidas.append(id_)
    json.dump({'movidas': movidas, 'faltan': faltan}, sys.stdout)


main()
