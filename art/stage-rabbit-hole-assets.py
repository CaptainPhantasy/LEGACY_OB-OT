"""Stage reviewed v9 delivery assets into small, independently pushable commits.

No credentials are accepted here. Push the returned commit using the separate
source-access helper, then stage the next batch. Native files remain on the
authoring device; only portable assets and inspected stills enter Sites Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--destination', type=Path, required=True)
p.add_argument('--batch', type=int, help='Omit to print the complete batch plan')
p.add_argument('--phase', choices=['geometry', 'visuals', 'all'], default='all',
               help='Allow geometry QA to proceed while the final poster renders')
a = p.parse_args()
source, dest = a.source.resolve(), a.destination.resolve()
report = json.loads((source / 'art/room-depth-report.json').read_text())
layout = json.loads((source / 'dist/assets/rabbit-hole-layout.json').read_text())
assert layout['measured'] is True and len(layout['items']) == 20
paths = ['dist/assets/room-lightmap.png', 'dist/assets/room-lightmap.json',
         'dist/assets/curiosity-lightmap.png', 'dist/assets/curiosity-lightmap.json']
scene_path = 'dist/assets/bookstore-depth.gltf'
scene = json.loads((source / scene_path).read_text())
paths.append(scene_path)
for buffer in scene['buffers']:
    uri = buffer['uri']
    assert not uri.startswith(('/', 'data:')) and '..' not in Path(uri).parts
    path = source / 'dist/assets' / uri
    assert path.stat().st_size == buffer['byteLength'] <= 8 * 1024 * 1024
    paths.append('dist/assets/' + uri)
paths += ['dist/assets/rabbit-hole-layout.json']
if a.phase != 'geometry':
    review = report['room-depth-export-review']
    assert review['viewed_by_agent'] is True
    for item in layout['items']:
        assert 'art/room-depth-export-review-object-' + item['id'] + '.png' in review['images']
    native_review = report['room-depth-preview']
    assert native_review['viewed_by_agent'] is True
    assert report['room-depth-beauty']['viewed_by_agent'] is True
    if a.phase == 'visuals':
        paths = []
    paths += ['dist/assets/poster-depth.png', 'art/rabbit-hole-geometry-report.json',
              'art/upper-book-grounding-report.json', 'art/room-depth-report.json']
    paths += review['images'] + native_review['images'] + ['art/room-depth-beauty-entrance.png']
assert len(paths) == len(set(paths))
batches, current, size = [], [], 0
for rel in paths:
    path = source / rel
    assert path.is_file() and '..' not in Path(rel).parts
    length = path.stat().st_size
    if rel.startswith('dist/'):
        assert length < 25 * 1024 * 1024
    if current and size + length > 32 * 1024 * 1024:
        batches.append(current)
        current, size = [], 0
    current.append(rel)
    size += length
if current:
    batches.append(current)
if a.batch is None:
    print(json.dumps([{'batch': i, 'files': len(items),
                      'bytes': sum((source / name).stat().st_size for name in items),
                      'paths': items} for i, items in enumerate(batches)], indent=2))
else:
    assert 0 <= a.batch < len(batches)
    paths = batches[a.batch]
    for rel in paths:
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / rel, target)
        assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256((source / rel).read_bytes()).digest()
    subprocess.run(['git', '-C', str(dest), 'add', '--', *paths], check=True)
    subprocess.run(['git', '-C', str(dest), '-c', 'user.name=Codex', '-c', 'user.email=codex@openai.com',
                    'commit', '-m', f'Deliver twenty shelf exhibits: {a.phase} batch {a.batch + 1}'],
                   check=True, env={**os.environ, 'LC_ALL': 'C'})
    sha = subprocess.check_output(['git', '-C', str(dest), 'rev-parse', 'HEAD'], text=True).strip()
    print(json.dumps({'batch': a.batch, 'total_batches': len(batches), 'commit': sha, 'files': len(paths)}))
