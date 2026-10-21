"""Reproducible tileable surface detail, in metres, for the cellar materials.

Only surface information is encoded; lighting stays in the room's lighting pass.
The textures deliberately share a small atlas family across all 61 materials.
"""
from pathlib import Path
import json
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/assets/surfaces'
OUT.mkdir(parents=True, exist_ok=True)
N = 512
rng = np.random.default_rng(445)
y, x = np.mgrid[0:N, 0:N] / N

def noise(sigma):
    a = gaussian_filter(rng.random((N, N)), sigma, mode='wrap')
    return (a-a.mean()) / max(a.std(), .0001)

def write(kind, h, variation, roughness, tint=(1,1,1)):
    # The base colour is a neutral multiplier. The authored colour remains on
    # the material, preserving the book's oxblood and the room's patina palette.
    c = np.clip(variation, .2, 1)[...,None] * np.array(tint)[None,None,:]
    # Encode linear pigment multipliers as sRGB for the browser's colour map.
    c = np.where(c <= .0031308, c*12.92, 1.055*np.power(c,1/2.4)-.055)
    Image.fromarray(np.uint8(np.clip(c,0,1)*255)).save(OUT/f'{kind}-color.webp', quality=91, method=6)
    h = np.clip(h,0,1)
    Image.fromarray(np.uint8(h*255), 'L').save(OUT/f'{kind}-height.png', optimize=True)
    Image.fromarray(np.uint8(np.clip(roughness,0,1)*255), 'L').save(OUT/f'{kind}-roughness.png', optimize=True)

coarse, fine, micro = noise(24), noise(2), noise(.5)
# Long continuous vessels, subtly wandering growth bands and sparse open pores.
warp = .006*np.sin(y*2*np.pi) + .003*np.sin(y*6*np.pi)
grain = np.sin((x+warp)*2*np.pi*29)
secondary = np.sin((x+warp*.45)*2*np.pi*87)
pores = np.maximum(0, noise((8,.7))-1.6)
wood = .49 + .12*grain + .045*secondary + .018*micro - .11*pores
# The room is built from dry, weathered timber.  The earlier .58 mean made
# every floorboard and shelf respond like polished furniture. Broad handled
# areas vary gently, while pores retain more dust and stay rougher. Keep the
# range bounded so a few noise outliers never become wet-looking patches.
wood_roughness = np.clip(.875+.03*coarse-.022*grain+.028*pores+.01*fine, .78, .97)
write('wood', wood, .86+.06*grain+.035*coarse-.08*pores,
      wood_roughness)

# Stone and lime have broad erosion, sharp mineral grains and microscopic pits.
pits = np.maximum(0, noise(.8)-1.3)
mineral = .52+.09*coarse+.075*fine+.035*micro-.05*pits
write('mineral', mineral, .87+.045*coarse+.025*fine,
      .89+.035*coarse+.03*fine)

# Alternating over/under yarns; thin inter-thread valleys prevent a tiled grid.
warp = .5+.5*np.cos(2*np.pi*x*64)
weft = .5+.5*np.cos(2*np.pi*y*64)
over = np.cos(2*np.pi*x*32)*np.cos(2*np.pi*y*32)
cloth = .32+.22*np.maximum(warp,weft)+.09*over+.025*micro
write('cloth', cloth, .87+.04*over+.025*coarse+.02*micro,
      .94+.02*fine)

# Rag paper has irregular short fibres, not pebbled leather grain.
fibres = noise((.6,5))*.55+noise((4,.6))*.45
paper = .5+.09*fibres+.018*micro
write('paper', paper, .94+.016*coarse+.017*fibres,
      .94+.025*fine)

# Fine leather pores and crumpled broad wrinkles complement the old cover's
# existing baked cracks; they do not replace those authored cracks.
wrinkles = np.sin(x*2*np.pi*17+noise(12)*1.3)*np.sin(y*2*np.pi*21+noise(10))
leather = .51+.08*fine+.045*wrinkles+.025*micro
write('leather', leather, .87+.045*coarse+.02*wrinkles,
      .84+.055*coarse+.025*fine)

# Worn metal alternates between old oxide and softly polished contact patches.
oxide = np.clip(.5+.22*noise(15)+.08*fine,0,1)
scratches = np.maximum(0, noise((.5,12))-1.4)
metal = .5+.025*fine-.035*scratches
write('metal', metal, .91-.17*oxide-.02*scratches,
      .30+.38*oxide+.045*fine, (1,.97,.88))

# A fine dusty veil; no invented rough rocks or heavy surface relief on glass.
dust = np.clip(.5+.20*coarse+.09*fine,0,1)
write('glass', .5+.01*micro, .96-.07*dust,
      .14+.25*dust)

(OUT/'README.json').write_text(json.dumps({
    'generator':'art/build_material_textures.py',
    'seed':445, 'resolution':512,
    'lighting':'None: these encode only colour, surface height and roughness.',
    'wood_finish':{'default':'dry weathered timber', 'roughness_range':[.78,.97],
                   'finished_wood':'The runtime scales the same wear map only for explicitly finished materials.'},
    'tile_metres':{'wood':[.24,1.6], 'mineral':[.6,.6], 'cloth':[.08,.08],
                   'paper':[.18,.18], 'leather':[.18,.18], 'metal':[.24,.24], 'glass':[.3,.3]}
}, indent=2)+'\n')
print('Created seven deterministic, seamless surface texture sets.')
