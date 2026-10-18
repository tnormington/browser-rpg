# Crop each shot around the character and tile them into one strip: python bench/strip.py out.png in1.png in2.png ...
import sys
from PIL import Image
out, *ins = sys.argv[1:]
box = (440, 180, 840, 600)
tiles = [Image.open(p).crop(box) for p in ins]
strip = Image.new('RGB', ((box[2]-box[0]) * len(tiles), box[3]-box[1]))
for i, t in enumerate(tiles): strip.paste(t, (i * (box[2]-box[0]), 0))
strip.save(out)
