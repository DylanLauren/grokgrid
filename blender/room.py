"""Builds the GrokGrid room in Blender, bakes its lighting, exports public/room.glb.

Run: bvenv/bin/python blender/room.py [--preview out.png] [--bake] [--export]
Coordinates in this file are written the three.js way (x right, y up, z toward the
viewer) and converted on the way in, so they line up with src/scene/*.tsx.
The bot, his phone, the screens and the two small family bots stay live in three.js.
"""
import math
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = '/home/user/grokgrid'

DESK_Y = 0.75
MON = dict(w=0.66, h=0.38, x=0.1, y=1.13, z=-0.3, yaw=0.38)
BOT_YAW = -0.45
LAMP_HEAD = (-0.46, DESK_Y + 0.42, -0.16)
LAMP_AIM = (-0.15, DESK_Y, 0.08)


def v(x, y, z):
    """three.js position to Blender (z up)."""
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('world')
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.004, 0.005, 1)


# ---------- materials ----------

def mat(name, color, rough=0.5, metal=0.0, extra=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if extra:
        extra(m, p)
    return m


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def wood(base, dark, scale=(1, 14, 1), planks=False):
    """Procedural grain: stretched noise between two tones, optional plank seams."""
    def build(m, p):
        nt = m.node_tree
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 6
        nz.inputs['Detail'].default_value = 8
        nz.inputs['Distortion'].default_value = 1.5
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (*srgb(dark), 1)
        ramp.color_ramp.elements[1].color = (*srgb(base), 1)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        out = ramp.outputs['Color']
        if planks:
            br = nt.nodes.new('ShaderNodeTexBrick')
            br.inputs['Scale'].default_value = 1.6
            br.inputs['Mortar Size'].default_value = 0.004
            br.inputs['Color1'].default_value = (1, 1, 1, 1)
            br.inputs['Color2'].default_value = (0.86, 0.86, 0.86, 1)
            br.inputs['Mortar'].default_value = (0.25, 0.25, 0.25, 1)
            br.offset = 0.5
            br.squash = 1
            mp2 = nt.nodes.new('ShaderNodeMapping')
            mp2.inputs['Scale'].default_value = (0.5, 4, 1)
            nt.links.new(tc.outputs['Object'], mp2.inputs['Vector'])
            nt.links.new(mp2.outputs['Vector'], br.inputs['Vector'])
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1
            nt.links.new(out, mul.inputs['A'])
            nt.links.new(br.outputs['Color'], mul.inputs['B'])
            out = mul.outputs['Result']
        nt.links.new(out, p.inputs['Base Color'])
    return build


M = {}


def materials():
    M['wall'] = mat('wall', srgb('#1a1918'), 0.9)
    M['trim'] = mat('trim', srgb('#121110'), 0.6)
    M['floor'] = mat('floor', (0, 0, 0), 0.45, extra=wood('#2b211a', '#16110d', (1, 6, 1), planks=True))
    M['rug'] = mat('rug', srgb('#1d1f22'), 0.98)
    M['desk'] = mat('desk', (0, 0, 0), 0.38, extra=wood('#3a2a1e', '#22180f', (1, 10, 1)))
    M['metal'] = mat('metal', srgb('#2b2b2b'), 0.35, 1.0)
    M['black'] = mat('black', srgb('#0d0d0d'), 0.4)
    M['plastic'] = mat('plastic', srgb('#161616'), 0.55)
    M['key'] = mat('key', srgb('#141414'), 0.6)
    M['ceramic'] = mat('ceramic', srgb('#efeeea'), 0.18)
    M['fabric'] = mat('fabric', srgb('#1b1b1c'), 0.95)
    M['mat'] = mat('deskmat', srgb('#141516'), 0.9)
    M['leaf'] = mat('leaf', srgb('#2f4a2a'), 0.6)
    M['pot'] = mat('pot', srgb('#c9c3b8'), 0.7)
    M['book'] = [mat(f'book{i}', srgb(c), 0.7) for i, c in enumerate(['#ff6a00', '#13b8a6', '#e8e6e1', '#1683ff', '#2a2a2a', '#9b5cff', '#ff9a00'])]
    M['coffee'] = mat('coffee', srgb('#1a0f08'), 0.15)


# ---------- geometry helpers ----------

def obj_from(op, name, m, **kw):
    op(**kw)
    o = bpy.context.active_object
    o.name = name
    if m is not None:
        o.data.materials.append(m)
    return o


def box(name, pos, size, m, bevel=0.0, yaw=0.0, segs=3):
    """pos/size in three.js terms: size = (width x, height y, depth z)."""
    o = obj_from(bpy.ops.mesh.primitive_cube_add, name, m, location=v(*pos))
    o.scale = (size[0] / 2, size[2] / 2, size[1] / 2)
    o.rotation_euler = (0, 0, yaw)
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'ANGLE'
    return o


def cyl(name, pos, r, h, m, r2=None, verts=48, rot=(0, 0, 0), fill='NGON'):
    if r2 is None:
        o = obj_from(bpy.ops.mesh.primitive_cylinder_add, name, m, vertices=verts, radius=r, depth=h, location=v(*pos), rotation=rot)
    else:
        o = obj_from(bpy.ops.mesh.primitive_cone_add, name, m, vertices=verts, radius1=r, radius2=r2, depth=h, location=v(*pos), rotation=rot, end_fill_type=fill)
    bpy.ops.object.shade_smooth()
    return o


def group(objs, parent_pos, yaw):
    """Rotate a set of objects about a vertical axis through parent_pos (three coords)."""
    piv = v(*parent_pos)
    for o in objs:
        rel = o.location - piv
        c, s = math.cos(yaw), math.sin(yaw)
        o.location = piv + Vector((rel.x * c - rel.y * s, rel.x * s + rel.y * c, rel.z))
        o.rotation_euler.z += yaw


# ---------- the room ----------

def build():
    room, desk, chair, shelf = [], [], [], []

    # shell
    room.append(box('floor', (0, -0.01, 0.4), (6, 0.02, 6), M['floor']))
    room.append(box('wall_back', (0.4, 1.5, -0.91), (4.2, 3, 0.02), M['wall']))
    room.append(box('wall_left', (-1.71, 1.5, 0.6), (0.02, 3, 3.1), M['wall']))
    room.append(box('base_back', (0.4, 0.04, -0.895), (4.2, 0.08, 0.012), M['trim'], 0.002))
    room.append(box('base_left', (-1.695, 0.04, 0.6), (0.012, 0.08, 3.1), M['trim'], 0.002))
    room.append(box('rug', (0.05, 0.004, 0.35), (1.9, 0.008, 1.5), M['rug'], 0.003))
    # window frame + sill (the glass and the city stay live in three.js)
    wx, wy, wz = -0.98, 1.5, -0.895
    for i, (x, y, w, h) in enumerate([(-0.49, 0, 0.03, 1.11), (0.49, 0, 0.03, 1.11), (0, 0.54, 1.01, 0.03), (0, -0.54, 1.01, 0.03), (0, 0, 0.018, 1.05), (0, 0.1, 0.95, 0.018)]):
        room.append(box(f'mullion{i}', (wx + x, wy + y, wz + 0.012), (w, h, 0.03), M['black'], 0.003))
    room.append(box('sill', (wx, wy - 0.58, wz + 0.06), (1.05, 0.03, 0.12), M['black'], 0.004))
    # poster frame (print stays live)
    room.append(box('poster_frame', (0.98, 1.58, -0.885), (0.78, 0.56, 0.02), M['black'], 0.003))

    # desk
    desk.append(box('desk_top', (0, DESK_Y - 0.0225, -0.07), (1.7, 0.045, 0.8), M['desk'], 0.008, segs=4))
    for i, (x, z) in enumerate([(-0.8, -0.42), (0.8, -0.42), (-0.8, 0.28), (0.8, 0.28)]):
        desk.append(box(f'leg{i}', (x, (DESK_Y - 0.045) / 2, z), (0.035, DESK_Y - 0.045, 0.035), M['metal'], 0.004))
    desk.append(box('apron', (0, DESK_Y - 0.075, -0.42), (1.6, 0.05, 0.02), M['metal'], 0.003))
    desk.append(box('deskmat', (0.12, DESK_Y + 0.0015, 0.05), (0.9, 0.003, 0.38), M['mat'], 0.0012, segs=2))

    # monitor (bezel matches MON so the live screen sits flush)
    mon = [
        box('mon_foot', (MON['x'], DESK_Y + 0.006, MON['z'] + 0.02), (0.24, 0.012, 0.16), M['metal'], 0.004),
        box('mon_neck', (MON['x'], DESK_Y + 0.15, MON['z'] - 0.02), (0.05, 0.3, 0.02), M['metal'], 0.004),
        box('mon_bezel', (MON['x'], MON['y'], MON['z']), (MON['w'] + 0.03, MON['h'] + 0.03, 0.025), M['black'], 0.008, segs=4),
        box('mon_back', (MON['x'], MON['y'] - 0.02, MON['z'] - 0.025), (MON['w'] * 0.6, MON['h'] * 0.55, 0.03), M['plastic'], 0.01),
    ]
    group(mon, (MON['x'], 0, MON['z']), MON['yaw'])
    desk += mon

    # keyboard with keys
    kb = [box('kb_base', (0.32, DESK_Y + 0.009, -0.02), (0.42, 0.018, 0.13), M['black'], 0.006)]
    for r in range(5):
        for c in range(14):
            kb.append(box(f'key{r}_{c}', (0.32 - 0.195 + c * 0.03, DESK_Y + 0.021, -0.02 - 0.05 + r * 0.025), (0.025, 0.008, 0.021), M['key'], 0.002, segs=2))
    group(kb, (0.32, 0, -0.02), -0.12)
    desk += kb

    # lamp
    lx, lz = -0.62, -0.24
    desk.append(cyl('lamp_base', (lx, DESK_Y + 0.01, lz), 0.085, 0.02, M['black']))
    arm = cyl('lamp_arm', (lx + 0.05, DESK_Y + 0.22, lz + 0.03), 0.008, 0.44, M['black'], verts=16)
    arm.rotation_euler = (0, math.radians(-14), 0)
    desk.append(arm)
    shade = cyl('lamp_shade', LAMP_HEAD, 0.07, 0.12, M['black'], r2=0.02, fill='NOTHING')
    shade.rotation_euler = (v(*LAMP_AIM) - v(*LAMP_HEAD)).to_track_quat('-Z', 'Y').to_euler()
    sol = shade.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.003
    desk.append(shade)

    # mug with coffee
    mx, mz = 0.62, 0.12
    mug = cyl('mug', (mx, DESK_Y + 0.05, mz), 0.04, 0.1, M['ceramic'], r2=0.036)
    desk.append(mug)
    desk.append(cyl('coffee', (mx, DESK_Y + 0.088, mz), 0.035, 0.004, M['coffee']))
    h = obj_from(bpy.ops.mesh.primitive_torus_add, 'mug_handle', M['ceramic'], major_radius=0.022, minor_radius=0.007, location=v(mx + 0.045, DESK_Y + 0.055, mz), rotation=(math.pi / 2, 0, 0))
    bpy.ops.object.shade_smooth()
    desk.append(h)

    # small speaker and a plant on the desk
    desk.append(box('speaker', (-0.12, DESK_Y + 0.07, -0.36), (0.09, 0.14, 0.09), M['plastic'], 0.012))
    desk.append(cyl('pot', (-0.72, DESK_Y + 0.045, 0.16), 0.05, 0.09, M['pot'], r2=0.04))
    for i in range(7):
        a = i / 7 * math.tau
        leaf = obj_from(bpy.ops.mesh.primitive_uv_sphere_add, f'leaf{i}', M['leaf'], radius=0.03, location=v(-0.72 + math.cos(a) * 0.03, DESK_Y + 0.13 + (i % 3) * 0.02, 0.16 + math.sin(a) * 0.03))
        leaf.scale = (1.6, 0.5, 0.9)
        leaf.rotation_euler = (0.3, 0.4, a)
        bpy.ops.object.shade_smooth()
        desk.append(leaf)

    # chair, turned with the bot
    cz = 0.8
    chair.append(box('seat', (0, 0.5, cz), (0.56, 0.07, 0.52), M['fabric'], 0.025, segs=4))
    back = box('back', (0, 0.88, cz + 0.32), (0.54, 0.62, 0.06), M['fabric'], 0.025, segs=4)
    back.rotation_euler.x = 0.08
    chair.append(back)
    chair.append(cyl('post', (0, 0.25, cz), 0.025, 0.45, M['metal'], verts=24))
    for i in range(5):
        a = i / 5 * math.tau
        spoke = box(f'spoke{i}', (math.cos(a) * 0.16, 0.04, cz + math.sin(a) * 0.16), (0.32, 0.025, 0.04), M['metal'], 0.006)
        spoke.rotation_euler.z = a
        chair.append(spoke)
        chair.append(cyl(f'wheel{i}', (math.cos(a) * 0.3, 0.02, cz + math.sin(a) * 0.3), 0.02, 0.025, M['black'], verts=16, rot=(math.pi / 2, 0, a)))
    group(chair, (0, 0, 0.64), BOT_YAW)

    # wall shelf with books on the left wall
    sx = -1.69
    shelf.append(box('shelf_board', (sx + 0.11, 1.32, 0.05), (0.22, 0.025, 0.7), M['desk'], 0.004))
    shelf.append(box('shelf_board2', (sx + 0.11, 1.72, 0.05), (0.22, 0.025, 0.7), M['desk'], 0.004))
    z = -0.26
    for i in range(11):
        w = 0.028 + (i * 7 % 5) * 0.006
        hgt = 0.17 + (i * 3 % 4) * 0.025
        b = box(f'book{i}', (sx + 0.1, 1.3325 + hgt / 2, z + w / 2), (0.15, hgt, w), M['book'][i % len(M['book'])], 0.002, segs=2)
        shelf.append(b)
        z += w + 0.004
    shelf.append(cyl('shelf_pot', (sx + 0.1, 1.775, 0.25), 0.045, 0.08, M['pot'], r2=0.038))
    for i in range(5):
        lf = obj_from(bpy.ops.mesh.primitive_uv_sphere_add, f'sleaf{i}', M['leaf'], radius=0.028, location=v(sx + 0.1 + (i - 2) * 0.012, 1.84 + (i % 2) * 0.03, 0.25 + (i - 2) * 0.02))
        lf.scale = (1.5, 0.6, 1)
        bpy.ops.object.shade_smooth()
        shelf.append(lf)
    shelf.append(box('frame_small', (sx + 0.06, 1.475, 0.27), (0.02, 0.26, 0.2), M['black'], 0.003))

    return dict(room=room, desk=desk, chair=chair, shelf=shelf)


def lights():
    def area(name, pos, size, energy, color, aim):
        d = bpy.data.lights.new(name, 'AREA')
        d.size = size[0]
        d.shape = 'RECTANGLE'
        d.size_y = size[1]
        d.energy = energy
        d.color = color
        o = bpy.data.objects.new(name, d)
        bpy.context.collection.objects.link(o)
        o.location = v(*pos)
        o.rotation_euler = (v(*aim) - o.location).to_track_quat('-Z', 'Y').to_euler()

    # warm desk lamp, pointing down onto the desk
    s = bpy.data.lights.new('lamp', 'SPOT')
    s.energy = 120
    s.color = (1.0, 0.78, 0.55)
    s.spot_size = math.radians(95)
    s.spot_blend = 0.6
    s.shadow_soft_size = 0.02
    o = bpy.data.objects.new('lamp', s)
    bpy.context.collection.objects.link(o)
    o.location = v(*LAMP_HEAD)
    o.rotation_euler = (v(*LAMP_AIM) - o.location).to_track_quat('-Z', 'Y').to_euler()
    # monitor glow
    yaw = MON['yaw']
    fx, fz = math.sin(yaw), math.cos(yaw)
    area('monitor', (MON['x'] + fx * 0.02, MON['y'], MON['z'] + fz * 0.02), (MON['w'], MON['h']), 7, (0.82, 0.87, 1.0), (MON['x'] + fx, MON['y'] - 0.2, MON['z'] + fz))
    # moonlight through the window
    area('moon', (-0.98, 1.5, -0.85), (0.95, 1.05), 30, (0.55, 0.65, 1.0), (-0.6, 0.6, 0.6))
    # faint room fill so nothing goes fully black
    area('fill', (1.6, 2.4, 1.6), (2, 2), 25, (0.75, 0.8, 1.0), (0, 0.8, 0))


def camera(pos, target, lens=32):
    c = bpy.data.cameras.new('cam')
    c.lens = lens
    o = bpy.data.objects.new('cam', c)
    bpy.context.collection.objects.link(o)
    o.location = v(*pos)
    o.rotation_euler = (v(*target) - o.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o


def preview(path, samples=48, res=(1280, 760)):
    s = bpy.context.scene
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def bake(o, size, samples):
    """Bakes full lighting into one texture per group, then swaps its materials for that texture."""
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    uv = o.data.uv_layers.new(name='bake')
    o.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=1.0)
    bpy.ops.uv.pack_islands(margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f'{o.name}_bake', size, size, float_buffer=True)
    for m in o.data.materials:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        m.node_tree.nodes.active = n
    s = bpy.context.scene
    s.cycles.samples = samples
    s.render.bake.margin = 6
    s.cycles.bake_type = 'COMBINED'
    bpy.ops.object.bake(type='COMBINED', uv_layer='bake')
    return img


def to_png(img):
    """Writes the baked radiance through the scene's view transform, like a render.
    (The OIDN compositor path needs a GPU context this machine lacks; scripts/soften.py
    takes the grain off afterwards.)"""
    s = bpy.context.scene
    img.filepath_raw = f'/tmp/claude-0/bake_{img.name}.exr'
    img.file_format = 'OPEN_EXR'
    img.save()
    path = f'/tmp/claude-0/bake_{img.name}.png'
    s.render.image_settings.file_format = 'PNG'
    img.save_render(path, scene=s)
    return path


def flatten(o, img):
    """One material per baked group: the baked image as base colour, nothing else."""
    m = bpy.data.materials.new(f'{o.name}_baked')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'bake'
    nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    o.data.materials.clear()
    o.data.materials.append(m)
    # keep only the bake UVs
    for layer in list(o.data.uv_layers):
        if layer.name != 'bake':
            o.data.uv_layers.remove(layer)


def main():
    reset()
    materials()
    groups = build()
    lights()
    camera((2.0, 1.75, -0.35), (-0.12, 0.9, 0.12), lens=30)
    if '--preview' in ARGS:
        preview(ARGS[ARGS.index('--preview') + 1], samples=int(ARGS[ARGS.index('--samples') + 1]) if '--samples' in ARGS else 48)
    if '--bake' in ARGS:
        sizes = dict(room=2048, desk=2048, chair=512, shelf=1024)
        samples = int(ARGS[ARGS.index('--samples') + 1]) if '--samples' in ARGS else 128
        baked = {}
        for name, objs in groups.items():
            o = join(name, objs)
            baked[name] = (o, bake(o, sizes[name], samples))
        for name, (o, img) in baked.items():
            path = to_png(img)
            if '--soften' in ARGS:
                import subprocess
                subprocess.run(['python3', f'{OUT}/blender/soften.py', path], check=True)
            flatten(o, bpy.data.images.load(path))
        for l in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA')]:
            bpy.data.objects.remove(l)
        if '--export' in ARGS:
            for img in bpy.data.images:
                img.file_format = 'JPEG'
            bpy.ops.export_scene.gltf(filepath=f'{OUT}/public/room.glb', export_format='GLB', export_image_format='JPEG', export_jpeg_quality=86, export_texcoords=True, export_normals=False, export_materials='EXPORT', use_selection=False, export_yup=True)
        bpy.ops.wm.save_as_mainfile(filepath='/tmp/claude-0/room_baked.blend')


main()
