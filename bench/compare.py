# Before | after | reference panels for the art-direction frames: python bench/compare.py <before-dir> <after-dir> <out-dir>
import sys
from PIL import Image
before, after, out = sys.argv[1:4]
REFS = ['01-synty-dark-fantasy-skeletons', '03-lowpoly-forest-ruin', '02-lowpoly-cave-firelight', '04-rune-knight']
NAMES = ['forge-vs-skeletons', 'clearing-vs-forest-ruin', 'cave-vs-cave-firelight', 'knight-vs-rune-knight']
H = 540
def fit(im): return im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
for i, (ref, name) in enumerate(zip(REFS, NAMES)):
    tiles = [fit(Image.open(f'{d}/frame-{i}.png').convert('RGB')) for d in (before, after)] + [fit(Image.open(f'docs/art-reference/{ref}.jpg').convert('RGB'))]
    sheet = Image.new('RGB', (sum(t.width for t in tiles), H))
    x = 0
    for t in tiles: sheet.paste(t, (x, 0)); x += t.width
    sheet.save(f'{out}/{name}.png')
