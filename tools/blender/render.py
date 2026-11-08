"""Blender headless renderer for NULL-TECH Circuit Studio GLB exports.

Usage: blender -b -P render.py -- in.glb out.png MODE WIDTH HEIGHT SAMPLES [AZIMUTH ELEVATION DISTANCE_FACTOR]
MODE: building | board | technical
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out, mode = argv[0], argv[1], argv[2]
W, H, SAMPLES = int(argv[3]), int(argv[4]), int(argv[5])
AZ = float(argv[6]) if len(argv) > 6 else 35.0
EL = float(argv[7]) if len(argv) > 7 else 40.0
DF = float(argv[8]) if len(argv) > 8 else 1.25

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# recompute outward normals (box geometry from the exporter can arrive inverted)
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.select_set(False)

# bounding box in world space
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
center = (mn + mx) / 2
size = (mx - mn).length
scene = bpy.context.scene

# ground / board plane just below the model
bpy.ops.mesh.primitive_plane_add(size=size * 4, location=(center.x, center.y, mn.z - size * 0.002))
plane = bpy.context.active_object
pm = bpy.data.materials.new("ground")
pm.use_nodes = True
bsdf = pm.node_tree.nodes["Principled BSDF"]
if mode == "board":
    bsdf.inputs["Base Color"].default_value = (0.03, 0.12, 0.06, 1)  # solder-mask green
    bsdf.inputs["Roughness"].default_value = 0.45
else:
    bsdf.inputs["Base Color"].default_value = (0.55, 0.56, 0.58, 1)
    bsdf.inputs["Roughness"].default_value = 0.85
plane.data.materials.append(pm)

# make wall glass-like materials render cleanly; boost emissive LEDs slightly
for m in bpy.data.materials:
    if m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
        p = m.node_tree.nodes["Principled BSDF"]
        a = p.inputs["Alpha"].default_value
        if a < 0.99:
            # semi-transparent walls from the app: render opaque in building views (cleaner, no noise)
            p.inputs["Alpha"].default_value = 1.0
            p.inputs["Base Color"].default_value = (0.86, 0.85, 0.82, 1)
            p.inputs["Roughness"].default_value = 0.9
        bc = p.inputs["Base Color"].default_value
        if mode == "building" and m.name != "ground" and abs(bc[0] - bc[1]) < 0.03 and 0.55 < bc[0] < 0.62 and a >= 0.99:
            p.inputs["Base Color"].default_value = (0.42, 0.30, 0.20, 1)  # floor slabs → light oak
            p.inputs["Roughness"].default_value = 0.6
        if mode == "technical":
            c = p.inputs["Base Color"].default_value
            m.diffuse_color = (c[0], c[1], c[2], 1.0)  # Workbench reads the viewport colour
            m.blend_method = "OPAQUE"
        strength = p.inputs.get("Emission Strength")
        if strength is not None and strength.default_value > 0:
            strength.default_value = max(strength.default_value, 3.0)

# camera on a sphere around the centre, aimed with a track-to constraint
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50 if mode != "technical" else 60
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
az, el = math.radians(AZ), math.radians(EL)
dist = size * DF
cam.location = center + Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * dist
target = bpy.data.objects.new("target", None)
target.location = center
scene.collection.objects.link(target)
tc = cam.constraints.new("TRACK_TO")
tc.target = target
tc.track_axis = "TRACK_NEGATIVE_Z"
tc.up_axis = "UP_Y"
cam_data.clip_start = size / 2000
cam_data.clip_end = size * 50
scene.camera = cam
if mode == "board":
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = target
    cam_data.dof.aperture_fstop = 16

# lighting: key sun + soft fill + world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.data.angle = math.radians(6)
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(AZ + 60))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 60 * (size ** 2)
fill.data.size = size
fill.location = center + Vector((-size, -size * 0.6, size * 1.2))
fc = fill.constraints.new("TRACK_TO")
fc.target = target
fc.track_axis = "TRACK_NEGATIVE_Z"
fc.up_axis = "UP_Y"
scene.collection.objects.link(fill)
world = bpy.data.worlds.new("world")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.82, 0.85, 0.88, 1) if mode != "board" else (0.05, 0.06, 0.07, 1)
bg.inputs["Strength"].default_value = 0.9 if mode != "board" else 0.6
scene.world = world

scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"

if mode == "technical":
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.05, 0.05)
    sh.show_shadows = True
    sh.show_xray = False
    scene.display.render_aa = "16"
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.color = (1, 1, 1)
    pm.diffuse_color = (0.93, 0.94, 0.95, 1)
    scene.render.film_transparent = False
else:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
        print("DENOISER", scene.cycles.denoiser)
    except Exception as e:
        print("NO DENOISER", e)
        scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.sample_clamp_indirect = 2.0
    scene.cycles.blur_glossy = 1.0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
bpy.ops.render.render(write_still=True)
print("RENDERED", out, "objects", len(meshes), "size_m", round(size, 4))
