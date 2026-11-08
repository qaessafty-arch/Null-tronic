# Photorealistic rendering with Blender

The real-time 3D viewport is for engineering work. For presentations, teaching material and
client reviews, the same model can be rendered photorealistically with Blender.

## Pipeline

1. In the app: open the project, switch to **3D**, then **Export ▸ 3D: GLB**. The GLB is in metres and
   carries each component's id, reference, type and pin nets in node extras.
2. Render headless with the script in `tools/blender/render.py` (Blender 4.x; the glTF importer needs
   `numpy` in Blender's Python — on Debian/Ubuntu `apt install blender python3-numpy`):

```bash
blender -b -P tools/blender/render.py -- model.glb out.png MODE WIDTH HEIGHT SAMPLES [AZIMUTH ELEVATION DISTANCE]
# building view of an installation, 1800×1100, 160 samples, camera at azimuth −55°, elevation 58°
blender -b -P tools/blender/render.py -- flat.glb flat.png building 1800 1100 160 -55 58 1.65
# circuit close-up with depth of field
blender -b -P tools/blender/render.py -- circuit.glb board.png board 1600 1000 160 25 38 1.15
# clean technical outline view (Workbench, seconds)
blender -b -P tools/blender/render.py -- circuit.glb tech.png technical 1600 1000 1 -50 45 1.6
```

| Mode | Engine | Scene |
|---|---|---|
| `building` | Cycles (CPU) | grey ground, opaque walls, oak floors, sun + area light |
| `board` | Cycles (CPU) | solder-mask green plane, dark studio, depth of field (f/16) |
| `technical` | Workbench | white background, cavity shading and outlines |

The script recomputes outward normals, frames the camera on the model's bounding box and
keeps simulation state that is part of the model (lit LEDs are emissive).

Measured on a 4-core cloud container: ≈ 17 s for an 800×500 preview of the sample flat
(48 samples); final 1600–1800 px images take a few minutes each on CPU. The Ubuntu Blender
build has no OpenImageDenoise, so noise is reduced with indirect-light clamping and more samples;
builds from blender.org include the denoiser.

Rendering exposed overlapping walls where rooms share only part of an edge; the 3D generator
now splits walls at every room corner before de-duplication (`frontend/src/viewport-3d/walls.ts`,
tested in `frontend/tests/unit/walls.test.ts`).
