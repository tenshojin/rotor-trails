# 树木模型（10 个树种 × 3 级细节）：弯曲渐细的树干与枝条 + 叶簇卡片（法线朝外，像一团真实树冠）。
# 尺寸与 src/world/vegetation.ts 的 TREE_SPECS（碰撞体）一致。叶片用 leaf_atlas.py 画的图集。
# 运行：blender -b --factory-startup --python tools/blender/trees.py -- public/models/trees.glb [--preview 目录]
# 节点名：<树种>_<细节级别 0/1/2>，每个节点一个网格（树皮、叶片等多个材质）。

import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/trees.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ATLAS = 'art/out/trees/leaves.png'

K.reset()
LEAF = K.material('tree_leaves', 0x808080, rough=0.85, tex=ATLAS, alpha='tex')
BARK = K.material('tree_bark', 0x808080, rough=1.0, tex='art/out/tex/pine_bark_diffuse_1024.jpg',
                  normal='art/out/tex/pine_bark_nor_gl_1024.jpg', rough_tex='art/out/tex/pine_bark_rough_1024.jpg')
PALMB = K.material('tree_bark_palm', 0x808080, rough=1.0, tex='art/out/tex/palm_bark_diffuse_1024.jpg',
                   normal='art/out/tex/palm_bark_nor_gl_1024.jpg', rough_tex='art/out/tex/palm_bark_rough_1024.jpg')
CACTUS = K.material('tree_cactus', 0x4f6e3a, rough=0.7)
MATS = [BARK, LEAF, PALMB, CACTUS]
MI = {m.name: i for i, m in enumerate(MATS)}


def slot(col, row, w=1, h=1):
    """图集格子 → UV 矩形 (u0, v0, u1, v1)（Blender UV 原点在左下）。"""
    return (col / 4, 1 - (row + h) / 4, (col + w) / 4, 1 - row / 4)


S_BROAD, S_PINE, S_SPRUCE, S_TROP = slot(0, 0), slot(1, 0), slot(2, 0), slot(3, 0)
S_BIRCH, S_JUNI, S_SHRUB, S_MASS = slot(0, 1), slot(1, 1), slot(2, 1), slot(3, 1)
S_PALM = slot(0, 2, 2, 1)
S_BIRCHBARK = slot(2, 2)


class MB:
    """网格构建器：顶点、面、每个面角的 UV 与法线、材质。"""

    def __init__(self):
        self.v, self.f, self.uv, self.n, self.mat = [], [], [], [], []

    def face(self, pts, uvs, nrms, mat):
        base = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(base, base + len(pts))))
        self.uv.append(uvs)
        self.n.append([tuple(Vector(n).normalized()) for n in nrms])
        self.mat.append(MI[mat.name])

    def tube(self, pts, radii, seg, mat, uv_rect=None, v_scale=1.0, cap=False):
        """沿折线的渐细圆管（逐段平行移动标架）。uv_rect：映射到图集的一个矩形（白桦树皮）。"""
        pts = [Vector(p) for p in pts]
        rings = []
        prev = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev is None:
                ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                nrm = t.cross(ref).normalized()
            else:
                nrm = (prev - t * prev.dot(t)).normalized()
            prev = nrm
            b = t.cross(nrm)
            rings.append([(p + (nrm * math.cos(2 * math.pi * j / seg) + b * math.sin(2 * math.pi * j / seg)) * radii[i],
                           nrm * math.cos(2 * math.pi * j / seg) + b * math.sin(2 * math.pi * j / seg)) for j in range(seg + 1)])
        L = 0.0
        vs = [0.0]
        for i in range(1, len(pts)):
            L += (pts[i] - pts[i - 1]).length
            vs.append(L)
        for i in range(len(pts) - 1):
            circ = 2 * math.pi * max(radii[i], 0.05)
            for j in range(seg):
                a, b2 = rings[i][j], rings[i][j + 1]
                c, d = rings[i + 1][j + 1], rings[i + 1][j]
                u0, u1 = j / seg, (j + 1) / seg
                v0, v1 = vs[i] / circ * v_scale, vs[i + 1] / circ * v_scale
                if uv_rect:
                    r = uv_rect
                    u0, u1 = r[0] + (r[2] - r[0]) * u0, r[0] + (r[2] - r[0]) * u1
                    v0, v1 = r[1] + (r[3] - r[1]) * (v0 % 1), r[1] + (r[3] - r[1]) * min(1, (v0 % 1) + (v1 - v0))
                self.face([a[0], b2[0], c[0], d[0]], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [a[1], b2[1], c[1], d[1]], mat)

    def card(self, c, nrm, w, h, rect, roll, crown_c=None, mat=LEAF, bend=0.0):
        """叶簇卡片（中心 c、朝向 nrm、绕法线旋转 roll）。法线朝树冠外侧，光照像一整团树冠。"""
        c, nrm = Vector(c), Vector(nrm).normalized()
        ref = Vector((0, 0, 1)) if abs(nrm.z) < 0.95 else Vector((1, 0, 0))
        ax = nrm.cross(ref).normalized()
        ay = nrm.cross(ax).normalized()
        R = Matrix.Rotation(roll, 3, nrm)
        ax, ay = R @ ax, R @ ay
        pts = [c - ax * w / 2 - ay * h / 2, c + ax * w / 2 - ay * h / 2, c + ax * w / 2 + ay * h / 2, c - ax * w / 2 + ay * h / 2]
        if bend:
            pts = [p + nrm * bend * ((p - c).length / max(w, h)) ** 2 for p in pts]
        u0, v0, u1, v1 = rect
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if crown_c is not None:
            cc = Vector(crown_c)
            nrms = [((p - cc).normalized() * 0.75 + nrm * 0.25) for p in pts]
        else:
            nrms = [nrm] * 4
        self.face(pts, uvs, nrms, mat)

    def quad(self, c, ax, ay, w, h, rect, crown_c, mat=LEAF):
        """按给定长轴 ax（贴图 u 方向）、短轴 ay（v 方向）放一张卡片；法线朝树冠外侧。"""
        c, ax, ay = Vector(c), Vector(ax).normalized(), Vector(ay).normalized()
        nrm = ax.cross(ay).normalized()
        pts = [c - ax * w / 2 - ay * h / 2, c + ax * w / 2 - ay * h / 2, c + ax * w / 2 + ay * h / 2, c - ax * w / 2 + ay * h / 2]
        u0, v0, u1, v1 = rect
        cc = Vector(crown_c)
        self.face(pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [((p - cc).normalized() * 0.75 + nrm * 0.25) for p in pts], mat)

    def build(self, name):
        # 只挂用到的材质（mesh.materials.clear() 会把所有面的材质编号清零，所以先挑好再挂）
        used = sorted(set(self.mat))
        remap = {old: new for new, old in enumerate(used)}
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        for i in used:
            me.materials.append(MATS[i])
        uv = me.uv_layers.new(name='UVMap')
        loops = []
        for fi, poly in enumerate(me.polygons):
            poly.material_index = remap[self.mat[fi]]
            for k, li in enumerate(poly.loop_indices):
                uv.data[li].uv = self.uv[fi][k]
                loops.append(self.n[fi][k])
        me.shade_smooth()
        me.normals_split_custom_set(loops)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def crown_points(rng, n, cc, rx, ry, shell=(0.55, 1.0), flat_top=0.0):
    """在椭球树冠的外层取点（偏向表面，内部看不见）。"""
    pts = []
    while len(pts) < n:
        a = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(-1, 1)
        r = rng.uniform(*shell) ** 0.5
        s = math.sqrt(max(0.0, 1 - z * z))
        p = Vector((math.cos(a) * s * r * rx, math.sin(a) * s * r * rx, z * r * ry))
        if flat_top and p.z > ry * (1 - flat_top):
            p.z = ry * (1 - flat_top) + (p.z - ry * (1 - flat_top)) * 0.3
        pts.append(Vector(cc) + p)
    return pts


def curve(rng, a, b, wobble, n=6):
    a, b = Vector(a), Vector(b)
    out = []
    side = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.3)))
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t) + side * wobble * math.sin(math.pi * t)
        out.append(p)
    return out


def along(path, z):
    """折线上高度为 z 的点（树枝从树干上长出的位置）。"""
    for a, b in zip(path, path[1:]):
        if a.z <= z <= b.z:
            return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
    return Vector(path[-1])


def leafy_tree(name, lod, rng, trunk_h, trunk_r, cy, rx, ry, rect, n_cards, card_size, n_branch, seg, bark=BARK, bark_rect=None, flat_top=0.0, lean=0.0, extra=None):
    mb = MB()
    cc = Vector((lean, 0, cy))
    top = Vector((lean * 0.9, 0, cy + ry * 0.25))
    tp = curve(rng, (0, 0, 0), top, 0.25 * trunk_h / 6, n=6 if lod == 0 else 3)
    rs = [trunk_r * (1.15 - 0.75 * i / (len(tp) - 1)) for i in range(len(tp))]
    rs[0] = trunk_r * 1.35
    mb.tube(tp, rs, seg, bark, uv_rect=bark_rect)
    if lod < 2:
        tips = crown_points(rng, n_branch, cc, rx * 0.75, ry * 0.6, (0.6, 1.0))
        for k, tip in enumerate(tips):
            z0 = trunk_h * rng.uniform(0.7, 0.95)
            base = along(tp, z0)
            bp = curve(rng, base, tip, 0.4, n=4 if lod == 0 else 2)
            br = [trunk_r * 0.45 * (1 - 0.75 * i / (len(bp) - 1)) for i in range(len(bp))]
            mb.tube(bp, br, 7 if lod == 0 else 4, bark, uv_rect=bark_rect)
            if lod == 0:
                for _ in range(2):
                    s0 = bp[rng.randint(1, len(bp) - 2)]
                    s1 = s0 + (tip - base).normalized() * rx * 0.35 + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 0.8))) * rx * 0.25
                    mb.tube([s0, s1], [br[1] * 0.6, br[1] * 0.2], 5, bark, uv_rect=bark_rect)
    for p in crown_points(rng, n_cards, cc, rx, ry, flat_top=flat_top):
        out = (p - cc).normalized()
        sz = card_size * rng.uniform(0.8, 1.2)
        mb.card(p, out.lerp(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized(), 0.45), sz, sz, rect, rng.uniform(0, 6.28), cc)
    if extra:
        extra(mb, rng)
    return mb.build(name)


def understory(lod, n, r_rng, h_rng, cards, size):
    """雨林林下层：树干周围几团较低的小树冠（遮住光秃的树干和地面，像雨林里密密的下层植被）。"""
    def fn(mb, rng):
        for k in range(n):
            a = 2 * math.pi * k / n + rng.uniform(-0.4, 0.4)
            d = rng.uniform(3.0, 7.5)
            r = rng.uniform(*r_rng)
            c = Vector((math.cos(a) * d, math.sin(a) * d, rng.uniform(*h_rng)))
            if lod == 0:
                mb.tube([Vector((c.x * 0.8, c.y * 0.8, 0)), c - Vector((0, 0, r * 0.4))], [0.16, 0.08], 5, BARK)
            rect = S_BROAD if k % 2 == 0 else S_TROP
            for p in crown_points(rng, cards, c, r, r * 0.8, (0.4, 1.0)):
                mb.card(p, (p - c).normalized(), size * rng.uniform(0.8, 1.2), size * rng.uniform(0.8, 1.2), rect, rng.uniform(0, 6.28), c)
    return fn


def mass_tree(name, trunk_h, trunk_r, cy, rx, ry, bark=BARK, bark_rect=None, cone=False, under=None):
    """最远一级：简化树干 + 体块树冠（椭球或圆锥），用图集里的不透明“树冠体块”纹理。under=(高度, 横半径, 竖半径)：再加一个林下层体块。"""
    mb = MB()
    mb.tube([(0, 0, 0), (0, 0, cy)], [trunk_r, trunk_r * 0.6], 4, bark, uv_rect=bark_rect)
    u0, v0, u1, v1 = S_MASS
    if cone:
        n = 7
        base_z, top_z = cy - ry, cy + ry
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            p0 = Vector((math.cos(a0) * rx, math.sin(a0) * rx, base_z))
            p1 = Vector((math.cos(a1) * rx, math.sin(a1) * rx, base_z))
            tp = Vector((0, 0, top_z))
            nm = (p0 + p1 - Vector((0, 0, 2 * base_z))).normalized() + Vector((0, 0, 0.5))
            mb.face([p0, p1, tp], [(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)], [nm, nm, Vector((0, 0, 1))], LEAF)
        return mb.build(name)
    rings, segs = 4, 7
    for (bc, brx, bry) in [(cy, rx, ry)] + ([under] if under else []):
        cc = Vector((0, 0, bc))
        pts = []
        for i in range(rings + 1):
            ph = math.pi * i / rings
            row = []
            for j in range(segs):
                th = 2 * math.pi * j / segs + (0.45 if bc != cy else 0.0)
                row.append(cc + Vector((math.sin(ph) * math.cos(th) * brx, math.sin(ph) * math.sin(th) * brx, math.cos(ph) * bry)))
            pts.append(row)
        for i in range(rings):
            for j in range(segs):
                j2 = (j + 1) % segs
                q = [pts[i][j], pts[i + 1][j], pts[i + 1][j2], pts[i][j2]]
                mb.face(q, [(u0, v1), (u0, v0), (u1, v0), (u1, v1)], [(p - cc).normalized() for p in q], LEAF)
    return mb.build(name)


ROOTS = []


def add(obj):
    ROOTS.append(obj)


# ------------------------------------------------------------------ 各树种
def broadleaf():
    for lod, (nc, cs, nb) in enumerate([(95, 2.2, 6), (30, 3.4, 3)]):
        add(leafy_tree(f'broadleaf_{lod}', lod, random.Random(11), 6, 0.32, 8, 4.2, 3.4, S_BROAD, nc, cs, nb, 12 if lod == 0 else 6))
    add(mass_tree('broadleaf_2', 6, 0.32, 8, 4.0, 3.2))


def birch():
    for lod, (nc, cs, nb) in enumerate([(100, 1.9, 5), (30, 2.9, 3)]):
        add(leafy_tree(f'birch_{lod}', lod, random.Random(12), 8, 0.2, 9.5, 2.6, 3.2, S_BIRCH, nc, cs, nb, 10 if lod == 0 else 5, bark_rect=S_BIRCHBARK))
    add(mass_tree('birch_2', 8, 0.2, 9.5, 2.5, 3.1, bark_rect=S_BIRCHBARK))


def canopy():
    """雨林林冠树：树冠比碰撞体宽（半径 12.5 m），相邻树冠连成一片；树干周围有林下层。"""
    for lod, (nc, cs, nb) in enumerate([(160, 4.3, 7), (44, 6.8, 4)]):
        add(leafy_tree(f'canopy_{lod}', lod, random.Random(13), 20, 0.7, 23.5, 12.5, 5.5, S_TROP, nc, cs, nb, 12 if lod == 0 else 6, flat_top=0.35,
                       extra=understory(lod, 5 if lod == 0 else 3, (4.5, 6.5), (6, 15), 16 if lod == 0 else 6, 3.0 if lod == 0 else 5.0)))
    add(mass_tree('canopy_2', 20, 0.7, 23.5, 12, 5.2, under=(10.5, 9, 7)))


def emergent():
    for lod, (nc, cs, nb) in enumerate([(150, 4.6, 8), (42, 7.0, 4)]):
        add(leafy_tree(f'emergent_{lod}', lod, random.Random(14), 40, 1.3, 45, 13, 5, S_TROP, nc, cs, nb, 14 if lod == 0 else 6, flat_top=0.5,
                       extra=understory(lod, 5 if lod == 0 else 3, (4.5, 6.5), (7, 17), 16 if lod == 0 else 6, 3.2 if lod == 0 else 5.0)))
    add(mass_tree('emergent_2', 40, 1.3, 45, 12.5, 4.5, under=(11, 9, 7.5)))


def pine():
    """日本黑松：弯曲倾斜的树干，枝端是一层层平展的针叶垫（像一朵朵云）。"""
    for lod in (0, 1):
        rng = random.Random(15)
        mb = MB()
        lean = 0.9
        tp = curve(rng, (0, 0, 0), (lean, 0.2, 8.4), 0.6, n=7 if lod == 0 else 3)
        mb.tube(tp, [0.36 - 0.26 * i / (len(tp) - 1) for i in range(len(tp))], 10 if lod == 0 else 5, BARK)
        cc = Vector((lean, 0.1, 7.5))
        pads = [(Vector((lean + 0.1, 0.2, 9.0)), 1.7)]
        for i in range(7):
            ang = 2 * math.pi * i / 7 + rng.uniform(-0.3, 0.3)
            r = rng.uniform(1.6, 2.6)
            pads.append((cc + Vector((math.cos(ang) * r, math.sin(ang) * r, rng.uniform(-1.5, 0.9))), rng.uniform(1.2, 1.7)))
        for (pc, pr) in pads:
            base = along(tp, max(4.5, pc.z - 1.5))
            mb.tube(curve(rng, base, pc, 0.35, n=3 if lod == 0 else 1), [0.14, 0.09, 0.06, 0.04][: (4 if lod == 0 else 2)], 6 if lod == 0 else 4, BARK)
            under = pc - Vector((0, 0, 0.8))
            for k in range(14 if lod == 0 else 4):
                ang = rng.uniform(0, 2 * math.pi)
                r = rng.uniform(0, pr * 0.8)
                p = pc + Vector((math.cos(ang) * r, math.sin(ang) * r, rng.uniform(-0.3, 0.3)))
                nrm = Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 1)).normalized()
                sz = pr * (1.2 if lod == 0 else 1.9) * rng.uniform(0.85, 1.15)
                mb.card(p, nrm, sz, sz, S_PINE, rng.uniform(0, 6.28), under)
                if lod == 0 and k % 2 == 0:
                    side = Vector((math.cos(ang), math.sin(ang), 0.5)).normalized()
                    mb.card(p + side * 0.35, side, sz * 0.8, sz * 0.55, S_PINE, rng.uniform(0, 6.28), under)
        add(mb.build(f'pine_{lod}'))
    add(mass_tree('pine_2', 7, 0.28, 7.5, 3.4, 2.0))


def spruce():
    """挪威云杉：一层层下垂的枝条组成圆锥；每根枝条一张水平卡 + 一张竖直交叉卡，从侧面看也是满的。"""
    for lod, (step, per) in enumerate([(0.55, 8), (1.1, 4)]):
        rng = random.Random(16)
        mb = MB()
        top = 16.5
        mb.tube([(0, 0, 0), (0, 0, top * 0.5), (0, 0, top)], [0.32, 0.18, 0.04], 10 if lod == 0 else 5, BARK)
        z = 1.4
        while z < top - 0.6:
            k = (z - 1.4) / (top - 1.4)
            R = 2.8 * (1 - k) ** 0.95 + 0.3
            a0 = rng.uniform(0, 2 * math.pi)
            n = max(3, round(per * (0.55 + 0.45 * (1 - k))))
            for i in range(n):
                a = a0 + 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
                d = Vector((math.cos(a), math.sin(a), 0))
                droop = math.radians(rng.uniform(12, 26))
                dirv = (d * math.cos(droop) - Vector((0, 0, math.sin(droop)))).normalized()
                side = Vector((-d.y, d.x, 0))
                up = side.cross(dirv).normalized()
                c = Vector((0, 0, z)) + dirv * R * 0.5
                cc = (0, 0, z - 0.6)
                h = max(0.8, R * (0.75 if lod == 0 else 1.0))
                mb.quad(c, dirv, side, R * 1.1, h, S_SPRUCE, cc)
                mb.quad(c - up * h * 0.15, dirv, up, R * 1.05, h * 0.7, S_SPRUCE, cc)
            z += step * rng.uniform(0.85, 1.15)
        add(mb.build(f'spruce_{lod}'))
    add(mass_tree('spruce_2', 2, 0.3, 9, 2.8, 7.5, cone=True))


def palm():
    for lod, (nf, segs) in enumerate([(16, 6), (9, 2)]):
        rng = random.Random(17)
        mb = MB()
        tp = curve(rng, (0, 0, 0), (1.4, 0, 9.4), 0.35, n=8 if lod == 0 else 3)
        mb.tube(tp, [0.3 - 0.08 * i / (len(tp) - 1) for i in range(len(tp))], 10 if lod == 0 else 5, PALMB, v_scale=0.4)
        crown = Vector(tp[-1])
        u0, v0, u1, v1 = S_PALM
        for i in range(nf):
            a = 2.39996 * i + rng.uniform(-0.1, 0.1)
            d = Vector((math.cos(a), math.sin(a), 0))
            young = i / max(1, nf - 1)
            L = 5.6 * rng.uniform(0.85, 1.1)
            lift, droop = 0.2 + 0.8 * young, 0.4 + 0.45 * (1 - young)
            pts = [crown + d * L * (k / segs) + Vector((0, 0, L * (lift * k / segs - droop * (k / segs) ** 2))) for k in range(segs + 1)]
            side = Vector((-d.y, d.x, 0))
            for k in range(segs):
                a0, a1 = pts[k], pts[k + 1]
                w0 = 0.95 * math.sin(math.pi * (0.1 + 0.9 * k / segs)) ** 0.6 + 0.15
                w1 = 0.95 * math.sin(math.pi * (0.1 + 0.9 * (k + 1) / segs)) ** 0.6 + 0.15
                dv = Vector((0, 0, -0.35))
                q = [a0 - side * w0 + dv * w0, a0 + side * w0 + dv * w0, a1 + side * w1 + dv * w1, a1 - side * w1 + dv * w1]
                uu0 = u0 + (u1 - u0) * k / segs
                uu1 = u0 + (u1 - u0) * (k + 1) / segs
                up = Vector((0, 0, 1))
                mb.face(q, [(uu0, v1), (uu0, v0), (uu1, v0), (uu1, v1)], [up + d * 0.3] * 4, LEAF)
        add(mb.build(f'palm_{lod}'))
    add(mass_tree('palm_2', 9, 0.25, 9.5, 3.0, 1.2, bark=PALMB))


def juniper():
    """刺柏：几根扭曲的主干，上面几团灰绿色的鳞叶簇，填满碰撞体（半径 2.3 m）。"""
    for lod, (per, cs) in enumerate([(20, 1.5), (6, 2.4)]):
        rng = random.Random(18)
        mb = MB()
        for s_ in range(3 if lod == 0 else 1):
            a = rng.uniform(0, 2 * math.pi)
            tip = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 2.8))
            mb.tube(curve(rng, (0, 0, 0), tip, 0.35, n=5 if lod == 0 else 2), [0.24, 0.2, 0.16, 0.12, 0.09, 0.06][: (6 if lod == 0 else 3)], 7 if lod == 0 else 4, BARK)
        for k in range(4):
            c = Vector((rng.uniform(-1.0, 1.0), rng.uniform(-1.0, 1.0), rng.uniform(1.8, 3.0)))
            for p in crown_points(rng, per, c, 1.4, 1.1):
                mb.card(p, (p - c).normalized(), cs * rng.uniform(0.8, 1.2), cs * rng.uniform(0.8, 1.2), S_JUNI, rng.uniform(0, 6.28), c)
        add(mb.build(f'juniper_{lod}'))
    add(mass_tree('juniper_2', 1.2, 0.25, 2.4, 2.2, 1.7))


def shrub():
    for lod, (nc, cs) in enumerate([(24, 1.3), (8, 1.9)]):
        rng = random.Random(19)
        mb = MB()
        cc = Vector((0, 0, 0.9))
        for p in crown_points(rng, nc, cc, 1.25, 0.85, (0.3, 1.0)):
            out = (p - cc).normalized()
            mb.card(p, out, cs, cs, S_SHRUB, rng.uniform(0, 6.28), cc - Vector((0, 0, 0.4)))
        add(mb.build(f'shrub_{lod}'))
    mb = MB()
    for i in range(3):
        a = math.pi * i / 3
        n = Vector((math.cos(a), math.sin(a), 0))
        mb.card((0, 0, 0.85), n, 2.4, 1.8, S_SHRUB, 0.0, (0, 0, 0.3))
    add(mb.build('shrub_2'))


def cactus():
    """巨柱仙人掌：带棱的主干 + 两条向上弯的侧臂。"""
    for lod, (ribs, n) in enumerate([(14, 10), (8, 4), (5, 2)]):
        mb = MB()

        def ribbed(pts, r):
            pts = [Vector(p) for p in pts]
            seg = ribs * 2
            prev = None
            rings = []
            for i, p in enumerate(pts):
                t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
                if prev is None:
                    ref = Vector((1, 0, 0)) if abs(t.z) > 0.9 else Vector((0, 0, 1))
                    nm = t.cross(ref).normalized()
                else:
                    nm = (prev - t * prev.dot(t)).normalized()
                prev = nm
                b = t.cross(nm)
                top = 1 - max(0.0, (i - (len(pts) - 3)) / 2) * 0.5
                ring = []
                for j in range(seg + 1):
                    a = 2 * math.pi * j / seg
                    rr = r * top * (1.0 if j % 2 == 0 else 0.84)
                    dvec = nm * math.cos(a) + b * math.sin(a)
                    ring.append((p + dvec * rr, dvec))
                rings.append(ring)
            for i in range(len(pts) - 1):
                for j in range(seg):
                    a, b2, c, d = rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]
                    mb.face([a[0], b2[0], c[0], d[0]], [(0, 0), (1, 0), (1, 1), (0, 1)], [a[1], b2[1], c[1], d[1]], CACTUS)

        ribbed([(0, 0, 6.5 * i / n) for i in range(n + 1)], 0.4)
        if lod < 2:
            for side, (h0, h1) in ((1, (3.2, 5.6)), (-1, (2.5, 4.4))):
                k = max(2, n // 2)
                arm = [Vector((side * (0.3 + 0.8 * min(1, 2 * i / k)), 0, h0 + (h1 - h0) * max(0, (i - k / 2) / (k / 2)) + 0.4 * min(1, 2 * i / k))) for i in range(k + 1)]
                ribbed(arm, 0.28)
        add(mb.build(f'cactus_{lod}'))


broadleaf()
birch()
canopy()
emergent()
pine()
spruce()
palm()
juniper()
shrub()
cactus()

for i, ob in enumerate(ROOTS):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('TREE', ob.name, tris, 'tris')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (500, 400, 0.1), (65, 0, -0.05), K.material('ground', 0x6f7a52, rough=0.95))
    order = ['broadleaf', 'pine', 'spruce', 'birch', 'palm', 'juniper', 'shrub', 'cactus', 'canopy', 'emergent']
    wide = K.camera('cam_wide', (65, -150, 20), (65, 0, 13), fov_deg=52)
    close = K.camera('cam_close', (40, -62, 9), (40, 0, 5), fov_deg=58)
    for lod in (0, 1, 2):
        xs = 0
        for ob in ROOTS:
            ob.hide_render = True
        for t in order:
            ob = bpy.data.objects[f'{t}_{lod}']
            w = {'canopy': 22, 'emergent': 28}.get(t, 10)
            ob.location = (xs + w / 2, 0, 0)
            ob.hide_render = False
            xs += w
        K.render(os.path.join(PREVIEW, f'trees_lod{lod}.png'), wide, (1800, 800), samples=32)
        if lod == 0:
            K.render(os.path.join(PREVIEW, 'trees_close.png'), close, (1800, 800), samples=48)
    for ob in ROOTS:
        ob.location = (0, 0, 0)
        ob.hide_render = False

K.export_glb(OUT, ROOTS)
print('EXPORTED', OUT)
