"""GrokGrid ad: renders Grok Bot and his colour family as transparent PNG clips.

Run: bvenv/bin/python chars.py --clip hero --res 1080 --samples 48 [--still 30] [--out DIR]
Every clip is a function of time, keyed on every frame, so renders are repeatable.
Blender axes: x right, z up, camera on -y looking toward +y. Characters face -y.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Quaternion, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FPS = 30


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


FAMILY = {
    'black': ('#0b0b0b', 'sphere'), 'orange': ('#ff6a00', 'sphere'), 'amber': ('#ff9a00', 'cloud'),
    'teal': ('#13b8a6', 'squircle'), 'violet': ('#9b5cff', 'tile'), 'blue': ('#1683ff', 'squircle'),
    'pink': ('#ff2e9a', 'cone'), 'grey': ('#7a7a7a', 'drop'), 'brown': ('#9a6a3f', 'sphere'),
}


# ---------- easing ----------

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out(x, p=3):
    x = clamp(x)
    return 1 - (1 - x) ** p


def ease_in_out(x):
    x = clamp(x)
    return 3 * x * x - 2 * x * x * x if x < 1 else 1


def back_out(x, s=1.70158):
    x = clamp(x) - 1
    return x * x * ((s + 1) * x + s) + 1


def lerp(a, b, t):
    return a + (b - a) * t


def spring(t, freq=4.5, damp=5.0):
    """0 -> 1 with a little overshoot; t in seconds."""
    if t <= 0:
        return 0.0
    return 1 - math.exp(-damp * t) * math.cos(2 * math.pi * freq * t * 0.5)


# ---------- scene ----------

def reset(res_x, res_y, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'GPU' if arg('--gpu') else 'CPU'
    if arg('--gpu'):
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = arg('--gpu')
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 6
    s.render.film_transparent = True
    s.render.resolution_x = res_x
    s.render.resolution_y = res_y
    s.render.fps = FPS
    s.render.use_motion_blur = True
    s.render.motion_blur_shutter = 0.4
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = arg('--look', 'AgX - Punchy')
    w = bpy.data.worlds.new('world')
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.012, 0.014, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    return s


def area(name, loc, target, size, energy, color=(1, 1, 1), shape='DISK'):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    d.shape = shape
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def lights(center=(0, 0, 0.35)):
    c = Vector(center)
    area('key', c + Vector((-1.6, -2.2, 2.2)), c, 2.2, 260)
    area('fill', c + Vector((2.2, -2.0, 0.4)), c, 2.5, 60, (0.85, 0.9, 1.0))
    area('rim_r', c + Vector((1.8, 1.8, 1.4)), c, 1.0, 300)
    area('rim_l', c + Vector((-1.9, 1.6, 0.9)), c, 1.0, 160, (0.9, 0.95, 1.0))
    area('top', c + Vector((0, 0, 3)), c, 3, 90)


def floor_catcher(z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, z))
    f = bpy.context.active_object
    f.name = 'floor'
    f.is_shadow_catcher = True
    return f


def camera(loc, target, lens=50, dof=None):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36
    o = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    aim(o, loc, target)
    if dof:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = dof
        cd.dof.focus_distance = (Vector(target) - Vector(loc)).length
    return o


def aim(o, loc, target):
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


# ---------- materials ----------

def principled(name, color, rough=0.5, coat=0.0, coat_rough=0.2, sheen=0.0, sss=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coat_rough
    p.inputs['Sheen Weight'].default_value = sheen
    if sss:
        p.inputs['Subsurface Weight'].default_value = sss
        p.inputs['Subsurface Radius'].default_value = (0.05, 0.05, 0.05)
        p.inputs['Subsurface Scale'].default_value = 0.05
    if emit:
        p.inputs['Emission Color'].default_value = (*emit[0], 1)
        p.inputs['Emission Strength'].default_value = emit[1]
    return m


def screen_material(name, path, strength=1.4):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path)
    tex.extension = 'CLIP'
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.name = 'scroll'
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.08
    gl.inputs['Color'].default_value = (1, 1, 1, 1)
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(fr.outputs['Fac'], mix.inputs['Fac'])
    nt.links.new(em.outputs['Emission'], mix.inputs[1])
    nt.links.new(gl.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


MAT = {}


def mats():
    MAT['skin'] = principled('skin', srgb('#f4f4f2'), 0.32, coat=1.0, coat_rough=0.16, sheen=0.4, sss=0.08)
    MAT['ink'] = principled('ink', srgb('#0a0a0a'), 0.38, coat=0.35, coat_rough=0.12)
    MAT['ink_light'] = principled('ink_light', srgb('#f2f2f2'), 0.3, coat=0.5)
    MAT['phone'] = principled('phone', srgb('#0e0e10'), 0.25, coat=1.0, coat_rough=0.1)
    MAT['phone_rim'] = principled('phone_rim', srgb('#3a3a3e'), 0.22)
    MAT['phone_rim'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 1.0


def family_mat(name):
    hexc, _ = FAMILY[name]
    return principled(f'fam_{name}', srgb(hexc), 0.5, coat=0.18, coat_rough=0.3, sheen=0.0, sss=0.03)


# ---------- geometry ----------

def active():
    return bpy.context.active_object


def smooth(o, subd=0):
    for p in o.data.polygons:
        p.use_smooth = True
    if subd:
        m = o.modifiers.new('subd', 'SUBSURF')
        m.levels = subd
        m.render_levels = subd


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


def capsule(name, r, length, depth_scale, m):
    """Pill with its long axis on z and its flat face looking toward -y."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=r)
    o = active()
    o.name = name
    for v in o.data.vertices:
        v.co.z += length / 2 if v.co.z > 0 else -length / 2 if v.co.z < 0 else 0
        v.co.y *= depth_scale
    smooth(o)
    o.data.materials.append(m)
    return o


def place_eye(eye, body_center, normal, surface_r, tilt):
    n = Vector(normal).normalized()
    q = Vector((0, -1, 0)).rotation_difference(n)
    q = Quaternion(n, tilt) @ q
    eye.rotation_mode = 'QUATERNION'
    eye.rotation_quaternion = q
    eye.location = Vector(body_center) + n * surface_r


def add_eyes(parent, center, r, ink, tilt=-0.08, look=(0.0, 0.0), size=1.0, spread=0.27, lift=(0.06, 0.06), shut=False):
    """Two pill eyes on a ball of radius r centred at center (local to parent), in the site logo's proportions:
    half width 0.15r, half height 0.33r, centres at x +-0.27r, a little above the middle."""
    hw, hh = 0.15 * r * size, 0.33 * r * size
    eyes = []
    holder = empty(parent.name + '_eyes', center, parent)
    for side, ly in ((-1, lift[0]), (1, lift[1])):
        e = capsule(f'{parent.name}_eye{side}', hw, (2 * hh - 2 * hw) * (0.05 if shut else 1), 0.32, ink)
        x, y = side * spread * size + look[0], ly + look[1]
        d = Vector((x, -math.sqrt(max(0.05, 1 - x * x - y * y)), y))
        place_eye(e, (0, 0, 0), d, r * 0.995, tilt)
        e.parent = holder
        eyes.append(e)
    return holder, eyes


def build_bot(name='bot', phone_tex=None):
    """Grok Bot: white ball, two pill eyes, two pebble hands. Returns dict of parts."""
    R = 0.32
    root = empty(name)
    motion = empty(name + '_motion', parent=root)
    body = empty(name + '_body', (0, 0, R), motion)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=R)
    ball = active()
    ball.name = name + '_ball'
    smooth(ball)
    ball.data.materials.append(MAT['skin'])
    ball.parent = body
    look = empty(name + '_look', parent=body)
    eyes_holder, eyes = add_eyes(look, (0, 0, 0), R, MAT['ink'])
    hands = []
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=24, radius=0.042)
        h = active()
        h.name = f'{name}_hand{side}'
        h.scale = (1, 0.85, 0.8)
        smooth(h)
        h.data.materials.append(MAT['skin'])
        h.parent = motion
        h.location = (side * 0.34, -0.12, 0.14)
        hands.append(h)
    parts = dict(root=root, motion=motion, body=body, ball=ball, look=look, eyes=eyes_holder, eye_list=eyes, hands=hands, R=R)
    if phone_tex:
        parts['phone'] = build_phone(name + '_phone', phone_tex, motion)
    return parts


def build_phone(name, tex, parent):
    """A phone the size of his face, real GrokGrid UI on the screen."""
    w, h, d = 0.2, 0.42, 0.018
    holder = empty(name, parent=parent)
    bpy.ops.mesh.primitive_cube_add(size=1)
    b = active()
    b.name = name + '_body'
    b.scale = (w / 2, d / 2, h / 2)
    bpy.ops.object.transform_apply(scale=True)
    bv = b.modifiers.new('bevel', 'BEVEL')
    bv.width = 0.026
    bv.segments = 10
    smooth(b)
    b.data.materials.append(MAT['phone'])
    b.parent = holder
    # screen: a plane just in front of the glass, UVs fit to the visible window
    bpy.ops.mesh.primitive_plane_add(size=1)
    s = active()
    s.name = name + '_screen'
    s.scale = (w * 0.9 / 2, h * 0.94 / 2, 1)
    s.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    s.location = (0, -d / 2 - 0.0008, 0)
    # round the screen corners with a bevel on a thin solid
    m = screen_material(name + '_screen_mat', tex)
    s.data.materials.append(m)
    s.parent = holder
    # aspect: show the top part of the tall screenshot, scroll by moving the mapping
    img = m.node_tree.nodes['Image Texture'].image
    iw, ih = img.size
    window = (iw * (h * 0.94) / (w * 0.9))  # pixels tall that fit the screen
    frac = window / ih
    mp = m.node_tree.nodes['scroll']
    mp.inputs['Scale'].default_value = (1, frac, 1)
    mp.inputs['Location'].default_value = (0, 1 - frac, 0)
    holder['frac'] = frac
    holder['mat'] = m.name
    return holder


def build_family(name, key, scale=1.0, look=(0.0, 0.0)):
    """A colour family bot, puffy 3D take on the flat site marks."""
    hexc, shape = FAMILY[key]
    m = family_mat(key)
    ink = MAT['ink_light'] if key == 'black' else MAT['ink']
    root = empty(name)
    motion = empty(name + '_motion', parent=root)
    s = 0.3 * scale
    body = empty(name + '_body', (0, 0, 0), motion)
    face_c, face_r, eye_size, lift = (0, 0, s), s, 1.0, (0.06, 0.06)
    if shape == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=s, location=(0, 0, s))
        o = active()
        smooth(o)
    elif shape in ('squircle', 'tile'):
        bpy.ops.mesh.primitive_cube_add(size=2 * s * 0.92, location=(0, 0, s * 0.92))
        o = active()
        o.scale = (1, 0.82, 0.95 if shape == 'squircle' else 0.9)
        bpy.ops.object.transform_apply(scale=True)
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width = s * 0.42
        bv.segments = 12
        smooth(o, 1)
        if shape == 'tile':
            o.rotation_euler = (0, 0.07, 0.12)
        face_c, face_r = (0, 0, s * 0.92), s * 0.9
    elif shape == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=s * 1.1, radius2=s * 0.16, depth=s * 1.8, location=(0, 0, s * 0.9))
        o = active()
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width = s * 0.3
        bv.segments = 12
        bv.limit_method = 'ANGLE'
        smooth(o, 2)
        face_c, face_r = (0, 0, s * 0.72), s * 0.68
    elif shape == 'drop':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=48, radius=s, location=(0, 0, 0))
        o = active()
        for v in o.data.vertices:
            z = v.co.z / s
            if z > -0.1:
                t = (z + 0.1) / 1.1
                pinch = max(0.2, 1 - 0.8 * t ** 1.4)
                v.co.x *= pinch
                v.co.y *= pinch
                v.co.z = v.co.z * (1 + 0.85 * t ** 1.2)
        o.location = (0, 0, s)
        smooth(o, 1)
        face_c, face_r = (0, 0, s * 0.95), s * 0.78
    elif shape == 'cloud':
        mb = bpy.data.metaballs.new(name + '_mb')
        mb.resolution = 0.02
        mb.render_resolution = 0.012
        mo = bpy.data.objects.new(name + '_mbobj', mb)
        bpy.context.scene.collection.objects.link(mo)
        for (x, z, r) in ((-0.62, 0.32, 0.36), (0.62, 0.32, 0.36), (-0.28, 0.62, 0.42), (0.22, 0.74, 0.38), (0.0, 0.3, 0.42), (-0.3, 0.28, 0.4), (0.32, 0.28, 0.4)):
            e = mb.elements.new()
            e.co = (x * s * 1.6, 0, z * s * 1.4)
            e.radius = r * s * 1.45
            e.stiffness = 3.0
            e.type = 'BALL'
        bpy.context.view_layer.objects.active = mo
        mo.select_set(True)
        bpy.ops.object.convert(target='MESH')
        o = active()
        o.scale = (1, 0.7, 1)
        bpy.ops.object.transform_apply(scale=True)
        smooth(o)
        face_c, face_r = (0, 0, s * 0.62), s * 0.62
    o.name = name + '_shape'
    o.data.materials.append(m)
    o.parent = body
    look_e = empty(name + '_look', face_c, body)
    eyes_holder, eyes = add_eyes(look_e, (0, 0, 0), face_r, ink, size=eye_size, lift=lift, look=look)
    # eyes must sit on the real surface, not on an ideal ball: push them onto it by ray cast
    snap_eyes(o, look_e, eyes)
    return dict(root=root, motion=motion, body=body, shape=o, look=look_e, eyes=eyes_holder, eye_list=eyes, R=s)


def snap_eyes(target, look, eyes):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = target.evaluated_get(dg)
    inv = ev.matrix_world.inverted()
    for e in eyes:
        p = e.matrix_world.translation
        c = look.matrix_world.translation
        d = (p - c).normalized()
        start = c + d * 2.0
        ok, hit, nrm, _ = ev.ray_cast(inv @ start, (inv.to_3x3() @ (-d)).normalized())
        if ok:
            world_hit = ev.matrix_world @ hit
            delta = world_hit - p
            e.location = e.location + (e.parent.matrix_world.inverted().to_3x3() @ delta) * 0.985


# ---------- keying ----------

def key_all(objs, frame):
    for o in objs:
        o.keyframe_insert('location', frame=frame)
        o.keyframe_insert('scale', frame=frame)
        if o.rotation_mode == 'QUATERNION':
            o.keyframe_insert('rotation_quaternion', frame=frame)
        else:
            o.keyframe_insert('rotation_euler', frame=frame)


def drive(frames, objs, fn):
    """Calls fn(t, f) then keys objs, for each frame. Linear keys so motion is exactly fn."""
    for f in frames:
        fn(f / FPS, f)
        key_all(objs, f)
    for o in objs:
        if o.animation_data and o.animation_data.action:
            for fc in all_fcurves(o.animation_data.action):
                for k in fc.keyframe_points:
                    k.interpolation = 'LINEAR'


def all_fcurves(action):
    try:
        return list(action.fcurves)
    except AttributeError:  # Blender 5 layered actions
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out


def key_mapping(mat_name, frames, fn):
    m = bpy.data.materials[mat_name]
    mp = m.node_tree.nodes['scroll']
    for f in frames:
        mp.inputs['Location'].default_value = fn(f / FPS)
        mp.inputs['Location'].keyframe_insert('default_value', frame=f)


def blink_k(t, times, dur=0.16):
    """eye height multiplier at t for blinks starting at times."""
    k = 1.0
    for b in times:
        x = (t - b) / dur
        if 0 <= x <= 1:
            k = min(k, 0.08 + 0.92 * abs(math.cos(x * math.pi)))
    return k


def bot_parts(p):
    return [p['root'], p['motion'], p['body'], p['look'], p['eyes'], *p['eye_list'], *p.get('hands', [])] + ([p['phone']] if 'phone' in p else [])


def hop(t, start, dur, height):
    """single hop: returns (lift, squash) where squash<1 = squashed."""
    x = (t - start) / dur
    if x < 0 or x > 1:
        return 0.0, 1.0
    lift = 4 * height * x * (1 - x)
    v = 1 - 2 * x  # vertical velocity sign
    stretch = 1 + 0.12 * abs(v) * (1 if 0.05 < x < 0.95 else 0)
    return lift, stretch


def landing(t, at, amount=0.16, dur=0.35):
    """squash-and-recover after a landing at time at. returns scale-y multiplier."""
    x = t - at
    if x < 0 or x > dur * 2:
        return 1.0
    return 1 - amount * math.exp(-x * 9) * math.cos(x * 22)


def apply_squash(body, sy):
    sx = 1 / math.sqrt(max(sy, 0.3))
    body.scale = (sx, sx, sy)


# ---------- clips ----------

def clip_hero(res):
    """Grok Bot hops in from the left, lands centre, looks at us, blinks. 3.0s"""
    s = reset(res, res, SAMPLES)
    mats()
    lights()
    floor_catcher()
    p = build_bot('bot')
    cam = camera((0, -2.6, 0.62), (0, 0, 0.36), 50, dof=2.8)
    n = 90
    hops = [(0.0, 0.42, 0.34), (0.42, 0.42, 0.3), (0.84, 0.46, 0.24)]
    def fn(t, f):
        x = lerp(-1.9, 0.0, ease_out(t / 1.3, 2.2))
        lift, st = 0.0, 1.0
        for (a, d, h) in hops:
            l, s2 = hop(t, a, d, h)
            if l:
                lift, st = l, s2
        sq = st
        for (a, d, h) in hops:
            sq *= landing(t, a + d, 0.18)
        p['root'].location = (x, 0, lift)
        apply_squash(p['body'], sq)
        p['body'].location = (0, 0, p['R'] * sq)
        lean = -0.18 * (1 - ease_out(t / 1.4)) if t < 1.4 else 0
        p['root'].rotation_euler = (0, lean, lerp(0.5, 0, ease_out(t / 1.5)))
        # look: forward on the run, then a turn to camera and a little head tilt
        lx = lerp(0.35, 0.0, ease_in_out((t - 1.2) / 0.5))
        lz = 0.05 * math.sin(t * 2) if t > 2 else 0
        p['look'].rotation_euler = (lerp(0.08, -0.06, ease_in_out((t - 1.2) / 0.5)), 0, lx + lz)
        k = blink_k(t, [1.75, 2.55])
        for e in p['eye_list']:
            e.scale = (1, 1, k)
        for i, h in enumerate(p['hands']):
            side = -1 if i == 0 else 1
            sway = math.sin(t * 9 + i * 2) * 0.03 * (1 - ease_out(t / 1.4))
            h.location = (side * 0.345, -0.12, 0.14 + sway + 0.05 * (1 - st) * 2)
    drive(range(0, n + 1), bot_parts(p), fn)
    s.frame_start, s.frame_end = 0, n
    return s


def clip_phone(res):
    """Grok Bot holds his phone (real GrokGrid UI), taps, sees a win and hops. 4.0s"""
    s = reset(res, res, SAMPLES)
    mats()
    lights((0.25, 0, 0.35))
    floor_catcher()
    tex = arg('--phone-tex') or os.path.join(ROOT, 'assets/tex/phone_screen.png')
    p = build_bot('bot', tex)
    ph = p['phone']
    ph.scale = (2.0, 2.0, 2.0)
    camera((0.22, -2.3, 0.6), (0.2, 0, 0.42), 50, dof=3.5)
    n = 120
    frac = ph['frac']
    win = 2.5
    def fn(t, f):
        lift, st = hop(t, win, 0.5, 0.2)
        sq = st * landing(t, win + 0.5, 0.15)
        bob = (1 + math.sin(t * 3.2)) * 0.006
        p['root'].location = (-0.12, 0, lift + bob)
        p['root'].rotation_euler = (0, 0, 0.12)
        apply_squash(p['body'], sq)
        p['body'].location = (0, 0, p['R'] * sq)
        sway = 0.012 * math.sin(t * 2.1)
        ph.location = (0.5, -0.3, 0.42 + sway)
        ph.rotation_euler = (0.06, 0, -0.38 + 0.02 * math.sin(t * 1.4))
        to_cam = ease_in_out((t - win) / 0.3)
        p['look'].rotation_euler = (lerp(0.1, -0.04, to_cam), 0, lerp(0.62, 0.0, to_cam))
        k = blink_k(t, [1.3, 3.5])
        wide = 1 + 0.14 * ease_out((t - win) / 0.25) * (1 - ease_in_out((t - win - 1.0) / 0.4))
        for e in p['eye_list']:
            e.scale = (1, 1, k * wide)
        tap = 0.0
        for a in (0.6, 0.85, 1.7, 1.95):
            x = (t - a) / 0.14
            if 0 <= x <= 1:
                tap = math.sin(x * math.pi) * 0.035
        p['hands'][1].location = (0.72, -0.42, 0.3 + sway)
        p['hands'][0].location = (0.4, -0.44 + tap, 0.47 + sway)
        if t > win:
            cheer = ease_out((t - win) / 0.3) * (1 - ease_in_out((t - win - 1.0) / 0.4))
            p['hands'][0].location = (lerp(0.4, -0.4, cheer), lerp(-0.44, -0.12, cheer), lerp(0.47, 0.62, cheer))
    drive(range(0, n + 1), bot_parts(p), fn)
    key_mapping(ph['mat'], range(0, n + 1, 2), lambda t: (0, 1 - frac - 0.22 * ease_in_out((t - 0.4) / 1.8), 0))
    s.frame_start, s.frame_end = 0, n
    return s


LINE = ['orange', 'teal', 'pink', 'violet', 'blue', 'grey', 'brown', 'black']


def clip_family_run(res_x, res_y):
    """The family hops across frame left to right, Grok Bot leading. 3.5s"""
    s = reset(res_x, res_y, SAMPLES)
    mats()
    lights((0, 0, 0.3))
    floor_catcher()
    n = 105
    p = build_bot('bot')
    fam = [build_family(f'f{i}', k, 0.82 + 0.1 * ((i * 7) % 3) / 2, look=(0.25, 0)) for i, k in enumerate(LINE[:6])]
    camera((0, -4.0, 0.7), (0, 0, 0.33), 50)
    allp = [p] + fam
    def mk(i, q):
        ph = i * 0.13
        speed = 1.15
        def fn(t, f):
            x = -4.2 + (t * speed) * 2.4 - i * 0.78
            hopd = 0.38 + 0.03 * (i % 3)
            tt = (t + ph) % hopd
            lift, st = hop(tt, 0, hopd, 0.16 + 0.04 * (i % 2))
            q['root'].location = (x, 0.25 * ((i % 2) * 2 - 1) * (0 if i == 0 else 1) + (0.35 if i else 0), lift)
            sq = st if lift > 0.01 else landing(tt, 0, 0.14)
            apply_squash(q['body'], sq)
            q['root'].rotation_euler = (0, -0.12, 0.35)
            q['look'].rotation_euler = (0.04, 0, 0.0)
            k = blink_k(t, [0.7 + i * 0.37, 2.4 + i * 0.21])
            for e in q['eye_list']:
                e.scale = (1, 1, k)
        return fn
    for i, q in enumerate(allp):
        parts = bot_parts(q) if i == 0 else [q['root'], q['motion'], q['body'], q['look'], q['eyes'], *q['eye_list']]
        drive(range(0, n + 1), parts, mk(i, q))
        if i == 0:
            pass
    s.frame_start, s.frame_end = 0, n
    return s


def clip_lineup(res_x, res_y, tight=False):
    """End-card lineup: Grok Bot in the middle, family drop in around him and settle. 3.0s"""
    s = reset(res_x, res_y, SAMPLES)
    mats()
    lights((0, 0, 0.3))
    floor_catcher()
    n = 90
    p = build_bot('bot')
    order = [('violet', -1.22, 0.22), ('teal', -0.74, 0.0), ('orange', 0.74, 0.0), ('pink', 1.22, 0.22), ('grey', -1.7, 0.45), ('blue', 1.7, 0.45)]
    if tight:  # square cut for the vertical ad: a cluster in two rows behind and beside him
        order = [('violet', -0.5, 0.75), ('teal', -0.72, 0.05), ('orange', 0.72, 0.05), ('pink', 0.5, 0.75), ('grey', -1.08, 0.55), ('blue', 1.08, 0.55)]
    fam = []
    for i, (k, x, y) in enumerate(order):
        q = build_family(f'f{i}', k, 0.72)
        fam.append((q, x, y, 0.18 + i * 0.1))
    camera((0, -3.5, 1.0), (0, 0.3, 0.4), 50) if tight else camera((0, -5.1, 1.0), (0, 0, 0.36), 50)
    def bot_fn(t, f):
        sq = landing(t, 0.25, 0.1)
        drop = max(0, 1.6 * (1 - ease_out(t / 0.25, 2))) if t < 0.25 else 0
        p['root'].location = (0, 0, drop)
        apply_squash(p['body'], sq)
        p['body'].location = (0, 0, p['R'] * sq)
        p['look'].rotation_euler = (-0.08, 0, 0.12 * math.sin(t * 1.3))
        k = blink_k(t, [1.4, 2.6])
        for e in p['eye_list']:
            e.scale = (1, 1, k)
        for i, h in enumerate(p['hands']):
            side = -1 if i == 0 else 1
            h.location = (side * 0.345, -0.12, 0.14 + 0.01 * math.sin(t * 3 + i))
    drive(range(0, n + 1), bot_parts(p), bot_fn)
    for i, (q, x, y, at) in enumerate(fam):
        def fn(t, f, q=q, x=x, y=y, at=at, i=i):
            fall = 0.32
            if t < at:
                z = 3.0
            elif t < at + fall:
                u = (t - at) / fall
                z = 3.0 * (1 - u * u)
            else:
                z, _ = hop(t, at + fall, 0.3, 0.12)
            q['root'].location = (x, y, z)
            sq = landing(t, at + fall, 0.22) * landing(t, at + fall + 0.3, 0.1)
            if at < t < at + fall:
                sq = 1.12
            apply_squash(q['body'], sq)
            q['root'].rotation_euler = (0, 0, -x * 0.18)
            q['look'].rotation_euler = (-0.05, 0, -x * 0.12 + 0.06 * math.sin(t * 1.7 + i))
            k = blink_k(t, [1.1 + i * 0.29, 2.5 + i * 0.13])
            for e in q['eye_list']:
                e.scale = (1, 1, k)
        drive(range(0, n + 1), [q['root'], q['motion'], q['body'], q['look'], q['eyes'], *q['eye_list']], fn)
    s.frame_start, s.frame_end = 0, n
    return s


def clip_face(res):
    """Close-up: Grok Bot looks around, then right at us, blinks. 3.0s, loops."""
    s = reset(res, res, SAMPLES)
    mats()
    lights()
    p = build_bot('bot')
    camera((0, -1.5, 0.36), (0, 0, 0.32), 70, dof=2.0)
    n = 90
    def fn(t, f):
        p['root'].location = (0, 0, 0.006 * math.sin(t * 2 * math.pi / 3))
        lx = 0.3 * math.sin(t * 2 * math.pi / 3)
        ly = 0.08 * math.sin(t * 4 * math.pi / 3)
        p['look'].rotation_euler = (ly, 0, lx)
        k = blink_k(t, [0.9, 2.2])
        for e in p['eye_list']:
            e.scale = (1, 1, k)
        for h in p['hands']:
            h.hide_render = True
    drive(range(0, n + 1), bot_parts(p), fn)
    s.frame_start, s.frame_end = 0, n
    return s


def clip_sheet(res_x, res_y):
    """Still lineup of every bot, for checking the models."""
    s = reset(res_x, res_y, SAMPLES)
    mats()
    lights((0, 0, 0.3))
    p = build_bot('bot')
    p['root'].location = (0, 0, 0)
    for i, k in enumerate(FAMILY):
        q = build_family(f'f{i}', k, 0.8)
        q['root'].location = ((i % 5 - 2) * 0.75 + (0.38 if i >= 5 else 0) + (0.4 if i == 2 else 0), 0.9 + (i // 5) * 0.9 - (0.8 if i == 2 else 0), 0)
    camera((0, -4.6, 1.6), (0, 0.6, 0.3), 45)
    s.frame_start = s.frame_end = 0
    return s


SAMPLES = int(arg('--samples', '48'))

if __name__ == '__main__':
    clip = arg('--clip', 'hero')
    res = int(arg('--res', '1080'))
    out = arg('--out', os.path.join(ROOT, 'clips', clip))
    builders = {
        'hero': lambda: clip_hero(res), 'phone': lambda: clip_phone(res), 'face': lambda: clip_face(res),
        'sheet': lambda: clip_sheet(res * 16 // 9, res), 'family_run': lambda: clip_family_run(res * 16 // 9, res), 'lineup': lambda: clip_lineup(res * 16 // 9, res), 'lineup_v': lambda: clip_lineup(res, res, True),
    }
    s = builders[clip]()
    if arg('--blend'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--blend'))
    still = arg('--still')
    if still:
        for fr in still.split(','):
            s.frame_set(int(fr))
            s.render.filepath = f'{out}_still_{fr}.png'
            bpy.ops.render.render(write_still=True)
    else:
        os.makedirs(out, exist_ok=True)
        s.render.filepath = out + '/f_'
        rng = arg('--frames')
        if rng:
            a, b = rng.split('-')
            s.frame_start, s.frame_end = int(a), int(b)
        bpy.ops.render.render(animation=True)

