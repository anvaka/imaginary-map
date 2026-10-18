"""Writes smaller copies of every image for progressive loading.

Usage: python3 scripts/make-sizes.py [kind ...]
Kinds are folders under public/images-small/ (e.g. architecture); without any,
every kind is redone. Each image is a Midjourney 2x2 grid of four candidates,
so each candidate gets its own file, <size>/<Country>-<quadrant>.webp, with
quadrants numbered left to right, top to bottom. Sizes are the width of one
candidate on the map: 256 and 512 (the full size is 1024).
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'images-small')
SIZES = [256, 512]


def convert(job):
    src, dst, size = job
    im = Image.open(src).convert('RGB')
    total = 0
    half = im.width // 2
    for quadrant in range(4):
        x, y = quadrant % 2 * half, quadrant // 2 * half
        out = dst.replace('.webp', f'-{quadrant}.webp')
        im.crop((x, y, x + half, y + half)).resize((size, size), Image.LANCZOS).save(out, 'WEBP', quality=80, method=6)
        total += os.path.getsize(out)
    return total


def main():
    kinds = sys.argv[1:] or sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))
    jobs = []
    for kind in kinds:
        for size in SIZES:
            out = os.path.join(ROOT, kind, str(size))
            os.makedirs(out, exist_ok=True)
            for name in sorted(os.listdir(os.path.join(ROOT, kind))):
                if name.endswith('.webp'):
                    jobs.append((os.path.join(ROOT, kind, name), os.path.join(out, name), size))

    with ProcessPoolExecutor() as pool:
        total = sum(pool.map(convert, jobs, chunksize=8))
    print(f'{len(jobs)} images, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
