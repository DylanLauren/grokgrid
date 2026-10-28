"""Takes the sampling grain off a baked lightmap without smearing its edges."""
import sys

from PIL import Image, ImageFilter

path = sys.argv[1]
im = Image.open(path).convert('RGB')
im = im.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
im.save(path)
