#!/usr/bin/env python3
"""Split a GLB into standard glTF and bounded buffers without changing view bytes.

python scripts/split-room-glb.py --input art/bookstore-depth.glb \
    --output dist/assets/bookstore-depth.gltf
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct


MAX_PART_BYTES = 8 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(path):
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError('Truncated GLB header')
    magic, version, length = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Expected a complete GLB version 2')
    chunks, offset = [], 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('Truncated GLB chunk header')
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValueError('Invalid GLB chunk length')
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if [kind for kind, _ in chunks] != [0x4e4f534a, 0x004e4942]:
        raise ValueError('Expected exactly one JSON chunk followed by one BIN chunk')
    document = json.loads(chunks[0][1].decode('utf-8'))
    buffers = document.get('buffers', [])
    if len(buffers) != 1 or 'uri' in buffers[0]:
        raise ValueError('Expected one embedded GLB buffer')
    binary = chunks[1][1]
    declared = buffers[0].get('byteLength', -1)
    if not isinstance(declared, int) or declared < 0 or not 0 <= len(binary) - declared <= 3:
        raise ValueError('BIN chunk does not match the declared buffer length')
    # This extension references buffer storage directly, outside bufferViews.
    if 'EXT_meshopt_compression' in document.get('extensionsUsed', []):
        raise ValueError('Direct meshopt buffer references require a separate converter')
    return data, document, binary[:declared]


def split_glb(input_path, output_path, max_part_bytes=MAX_PART_BYTES):
    input_path, output_path = Path(input_path), Path(output_path)
    if output_path.suffix.lower() != '.gltf':
        raise ValueError('The output must have a .gltf extension')
    if not isinstance(max_part_bytes, int) or not 4 <= max_part_bytes <= MAX_PART_BYTES:
        raise ValueError('Part limit must be between 4 bytes and 8 MiB')
    source, original, binary = read_glb(input_path)
    document = copy.deepcopy(original)
    views = document.get('bufferViews', [])
    if not views:
        raise ValueError('The GLB contains no bufferViews')
    parts = []
    for index, view in enumerate(views):
        start, length = view.get('byteOffset', 0), view.get('byteLength', -1)
        if (view.get('buffer') != 0 or not isinstance(start, int) or not isinstance(length, int)
                or start < 0 or length <= 0 or start + length > len(binary)):
            raise ValueError('Invalid source bufferView ' + str(index))
        padded_length = (length + 3) & ~3
        if padded_length > max_part_bytes:
            raise ValueError('bufferView %d has %d bytes; cannot preserve it whole within the %d-byte limit'
                             % (index, length, max_part_bytes))
        # Sequential whole-view packing preserves view order; padding is storage only.
        if not parts or len(parts[-1]) + padded_length > max_part_bytes:
            parts.append(bytearray())
        part = parts[-1]
        view['buffer'] = len(parts) - 1
        view['byteOffset'] = len(part)
        part.extend(binary[start:start + length])
        part.extend(b'\0' * (-len(part) % 4))

    folder = output_path.stem
    buffer_metadata = {key: value for key, value in original['buffers'][0].items()
                       if key not in ('uri', 'byteLength')}
    document['buffers'] = [dict(copy.deepcopy(buffer_metadata),
                                uri=folder + '/part-%03d.bin' % (index + 1), byteLength=len(part))
                           for index, part in enumerate(parts)]

    # Validate every view before writing; all accessor/image/material/node data is untouched.
    for index, (before, after) in enumerate(zip(original['bufferViews'], views)):
        expected = binary[before.get('byteOffset', 0):before.get('byteOffset', 0) + before['byteLength']]
        actual = parts[after['buffer']][after['byteOffset']:after['byteOffset'] + after['byteLength']]
        if expected != actual:
            raise RuntimeError('Byte preservation failed for bufferView ' + str(index))
    original_content = {key: value for key, value in original.items() if key not in ('buffers', 'bufferViews')}
    final_content = {key: value for key, value in document.items() if key not in ('buffers', 'bufferViews')}
    if original_content != final_content:
        raise RuntimeError('Non-storage glTF data changed')
    for before, after in zip(original['bufferViews'], views):
        if ({key: value for key, value in before.items() if key not in ('buffer', 'byteOffset')}
                != {key: value for key, value in after.items() if key not in ('buffer', 'byteOffset')}):
            raise RuntimeError('BufferView metadata changed')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    (output_path.parent / folder).mkdir(parents=True, exist_ok=True)
    files = []
    for buffer, part in zip(document['buffers'], parts):
        path = output_path.parent / buffer['uri']
        path.write_bytes(part)
        if sha256(path.read_bytes()) != sha256(part):
            raise RuntimeError('Written buffer checksum mismatch: ' + str(path))
        files.append({'path': buffer['uri'], 'bytes': len(part), 'sha256': sha256(part)})
    encoded = (json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    output_path.write_bytes(encoded)
    if output_path.read_bytes() != encoded:
        raise RuntimeError('Written glTF checksum mismatch')
    files.insert(0, {'path': output_path.name, 'bytes': len(encoded), 'sha256': sha256(encoded)})
    return {'path': output_path.name, 'bytes': len(encoded), 'sha256': sha256(encoded),
            'format': 'gltf', 'total_bytes': sum(item['bytes'] for item in files), 'files': files,
            'buffer_parts': len(parts), 'max_part_bytes': max_part_bytes,
            'buffer_views_verified': len(views), 'geometry_bytes_preserved': True,
            'source_glb': {'path': str(input_path), 'bytes': len(source), 'sha256': sha256(source)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--max-part-bytes', type=int, default=MAX_PART_BYTES)
    args = parser.parse_args()
    print(json.dumps(split_glb(args.input, args.output, args.max_part_bytes), indent=2))


if __name__ == '__main__':
    main()
