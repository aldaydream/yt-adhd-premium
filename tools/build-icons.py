"""Generate original small grid icons with the Python standard library."""
import math
import struct
import zlib
from pathlib import Path

output = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
output.mkdir(parents=True, exist_ok=True)

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

def in_round(x, y, left, top, width, height, radius):
    cx = min(max(x, left + radius), left + width - radius)
    cy = min(max(y, top + radius), top + height - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2

for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            rgba = [0, 0, 0, 0]
            # Four samples for clean edges on the smaller toolbar icon.
            samples = []
            for dx, dy in ((.25,.25),(.75,.25),(.25,.75),(.75,.75)):
                px, py = (x + dx)/size, (y + dy)/size
                color = (0,0,0,0)
                if in_round(px,py,.03,.03,.94,.94,.18):
                    color = (25,27,32,255)
                for index, (left,top) in enumerate(((.20,.22),(.53,.22),(.20,.55),(.53,.55))):
                    if in_round(px,py,left,top,.27,.23,.035):
                        color = (62,166,255,255) if index == 0 else (231,234,240,255)
                samples.append(color)
            for i in range(4): rgba[i] = round(sum(sample[i] for sample in samples)/len(samples))
            rows.extend(rgba)
    header = struct.pack('>IIBBBBB',size,size,8,6,0,0,0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',header) + chunk(b'IDAT',zlib.compress(bytes(rows),9)) + chunk(b'IEND',b'')
    (output / f'icon{size}.png').write_bytes(png)
print('Generated original icons: 16, 32, 48, 128 px')
