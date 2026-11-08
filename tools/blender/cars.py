# 车：港区路上跑的、停着的小汽车和厢式车、轻卡。照 MOSS-Image 生成的参考图（art/src/ref/vehicles/car_s36.png、
# car_s37.png、kei_s35.png）建：车身按车长方向一串截面放样（圆角矩形、带轮拱），上面是车窗带和车顶，
# 挡风玻璃和后窗就是车窗带两端的斜面；黑色窗柱、后视镜、前后灯、保险杠、车牌（轻型车是黄牌）、带轮毂盖的轮子。
#
# 坐标：Blender（车头朝 +X，原点在地面、车身中间），和旧的 jport.car 一致。

import math

import bmesh
import bpy
from mathutils import Vector

import bkit as K
import bldkit as BK

F = BK.flat


def _mesh(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    return ob


def _loft(name, sections, mat, close_ends=True):
    """sections：每个站位一条（右半边）截面线 [(x, y, z)]，点数相同；左右镜像连成网格"""
    bm = bmesh.new()
    n = len(sections[0])
    rows = []
    for sec in sections:
        right = [bm.verts.new(p) for p in sec]
        left = [bm.verts.new((p[0], -p[1], p[2])) for p in reversed(sec)]
        rows.append(right + left)
    m = 2 * n
    for a, b in zip(rows, rows[1:]):
        for j in range(m - 1):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    if close_ends:
        # 两头的洞补成平面（车头、车尾），不收成一条缝：收成缝在光滑着色下是一道黑线
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    ob = _mesh(name, bm, mat)
    K.fix_normals(ob)
    return ob


def rounded_section(x, hw, z0, z1, rb, rt, n_arc=4):
    """右半边的圆角矩形截面：从底面中线 → 底角 → 侧面 → 顶角 → 顶面中线"""
    rb = min(rb, hw * 0.6, (z1 - z0) * 0.45)
    rt = min(rt, hw * 0.6, (z1 - z0) * 0.45)
    pts = [(x, 0.0, z0)]
    for k in range(n_arc + 1):
        a = -math.pi / 2 + (math.pi / 2) * k / n_arc
        pts.append((x, hw - rb + rb * math.cos(a), z0 + rb + rb * math.sin(a)))
    for k in range(n_arc + 1):
        a = (math.pi / 2) * k / n_arc
        pts.append((x, hw - rt + rt * math.cos(a), z1 - rt + rt * math.sin(a)))
    pts.append((x, 0.0, z1))
    return pts


class Car:
    """一辆车的参数：L 长、W 宽；belt 腰线高、roof 车顶高；hood_x 挡风玻璃下沿、ws_top 挡风玻璃上沿（x）、
    back_x 车窗带后端（下沿）、back_top 后窗上沿（x）；hood_front 车头处的引擎盖高；trunk_z 车尾的行李箱盖高（两厢车 = belt）；
    wheel_r 轮半径、axle_f / axle_r 前后轴（x）。"""

    def __init__(self, L, W, belt, roof, hood_x, ws_top, back_x, back_top, hood_front, trunk_z=None, wheel_r=0.29,
                 axle_f=None, axle_r=None, clearance=0.16, plan_p=6.0, tumble=0.07):
        self.L, self.W = L, W
        self.belt, self.roof = belt, roof
        self.hood_x, self.ws_top = hood_x, ws_top
        self.back_x, self.back_top = back_x, back_top
        self.hood_front = hood_front
        self.trunk_z = belt if trunk_z is None else trunk_z
        self.wheel_r = wheel_r
        self.axle_f = L / 2 - 0.55 if axle_f is None else axle_f
        self.axle_r = -L / 2 + 0.55 if axle_r is None else axle_r
        self.clearance = clearance
        self.plan_p = plan_p
        self.tumble = tumble

    def hw(self, x):
        u = min(0.9999, abs(x) / (self.L / 2))
        return self.W / 2 * max(0.0, 1 - u ** self.plan_p) ** (1 / self.plan_p)

    def bottom(self, x):
        z = self.clearance
        for ax in (self.axle_f, self.axle_r):
            r = self.wheel_r + 0.05
            d = abs(x - ax)
            if d < r:
                z = max(z, self.wheel_r + math.sqrt(r * r - d * d) - 0.02)
        # 车头车尾的下沿往上收一点（保险杠下沿）
        u = abs(x) / (self.L / 2)
        return z + 0.08 * max(0.0, (u - 0.9) / 0.1) ** 2

    def top(self, x):
        """下半截车身的顶：车窗带范围里是腰线，往前是引擎盖（往车头降低），往后是行李箱盖"""
        if x > self.hood_x:
            t = (x - self.hood_x) / (self.L / 2 - self.hood_x)
            return self.belt + (self.hood_front - self.belt) * t ** 1.4
        if x < self.back_x:
            t = (self.back_x - x) / (self.back_x + self.L / 2)
            return self.belt + (self.trunk_z - self.belt) * t ** 1.2
        return self.belt

    def roof_z(self, x):
        """车窗带的顶：挡风玻璃、车顶、后窗"""
        if x > self.ws_top:
            t = (x - self.ws_top) / (self.hood_x - self.ws_top)
            return self.roof + (self.belt - self.roof) * t
        if x < self.back_top:
            t = (self.back_top - x) / (self.back_top - self.back_x)
            return self.roof + (self.belt - self.roof) * t
        # 车顶中间微微拱起
        mid = (self.ws_top + self.back_top) / 2
        span = (self.ws_top - self.back_top) / 2
        return self.roof + 0.015 * (1 - ((x - mid) / span) ** 2)

    def build(self, name, body, glass, black, n=44):
        parts = []
        # 两头停在平面图收窄到一半宽的地方，再补平面封口
        U = 0.999
        xs = [(-self.L / 2 * U) + self.L * U * (0.5 - 0.5 * math.cos(math.pi * i / n)) for i in range(n + 1)]
        secs = []
        for x in xs:
            hw = max(0.004, self.hw(x))
            z0 = self.bottom(x)
            z1 = max(z0 + 0.02, self.top(x))
            secs.append(rounded_section(x, hw, z0, z1, 0.10, 0.07))
        parts.append(_loft(name + '_body', secs, body))
        # 车窗带（玻璃）+ 车顶（车身色）
        gx = [self.back_x + (self.hood_x - self.back_x) * i / 32 for i in range(33)]
        gsec, rsec = [], []
        for x in gx:
            hw0 = self.hw(x) - 0.035
            zt, zr = self.top(x), self.roof_z(x)
            hwr = hw0 - self.tumble * min(1.0, (zr - zt) / max(0.01, self.roof - self.belt))
            # 车窗带：腰线到车顶边（在车顶边往里收一点）
            g = []
            for k in range(7):
                t = k / 6
                g.append((x, hw0 + (hwr - hw0) * t, zt + (zr - 0.05 - zt) * t if zr - 0.05 > zt else zt + 0.001 * k))
            gsec.append(g)
        # 车顶只在挡风玻璃上沿和后窗上沿之间
        for i in range(25):
            x = self.back_top + (self.ws_top - self.back_top) * i / 24
            hw0 = self.hw(x) - 0.035
            zt, zr = self.top(x), self.roof_z(x)
            hwr = hw0 - self.tumble
            r = []
            for k in range(6):
                a = (math.pi / 2) * k / 5
                r.append((x, hwr - 0.06 + 0.06 * math.cos(a), zr - 0.05 + 0.05 * math.sin(a)))
            r.append((x, 0.0, zr))
            rsec.append(r)
        # 车窗带只要两侧，不要中间：把截面线镜像到另一侧时会经过中线，所以单独建
        bm = bmesh.new()
        for side in (1, -1):
            rows = [[bm.verts.new((p[0], side * p[1], p[2])) for p in s] for s in gsec]
            for a, b in zip(rows, rows[1:]):
                for j in range(len(a) - 1):
                    q = (a[j], b[j], b[j + 1], a[j + 1])
                    bm.faces.new(q if side > 0 else q[::-1])
        g_ob = _mesh(name + '_glass', bm, glass)
        K.fix_normals(g_ob)
        parts.append(g_ob)
        parts.append(_loft(name + '_roof', rsec, body))
        # 挡风玻璃、后窗：车窗带两端那一段的“侧面”就是斜面；中间再补一块（截面线不经过中线）
        for end, xa, xb in (('ws', self.ws_top, self.hood_x), ('bk', self.back_x, self.back_top)):
            bm = bmesh.new()
            m = 12
            rows = []
            for i in range(m + 1):
                x = xa + (xb - xa) * i / m
                hw0 = self.hw(x) - 0.035
                zt, zr = self.top(x), self.roof_z(x)
                hwr = hw0 - self.tumble * min(1.0, (zr - zt) / max(0.01, self.roof - self.belt))
                rows.append([bm.verts.new((x, -hwr, zr - 0.04)), bm.verts.new((x, hwr, zr - 0.04))])
            for a, b in zip(rows, rows[1:]):
                bm.faces.new((a[0], a[1], b[1], b[0]))
            ob = _mesh(name + '_' + end, bm, glass, smooth=False)
            K.fix_normals(ob)
            parts.append(ob)
        return parts

    def wheels(self, name, tyre, rim, hub):
        parts = []
        r = self.wheel_r
        tw = 0.16
        for ax in (self.axle_f, self.axle_r):
            for s in (1, -1):
                y = s * (self.W / 2 - tw / 2 - 0.02)
                parts.append(BK.cyl(f'{name}_t{ax}{s}', r, tw, (ax, y, r), tyre, 18, rot=(math.pi / 2, 0, 0), uv=False))
                parts.append(BK.cyl(f'{name}_r{ax}{s}', r * 0.62, 0.012, (ax, y + s * tw / 2, r), rim, 16, rot=(math.pi / 2, 0, 0), uv=False))
                parts.append(BK.cyl(f'{name}_h{ax}{s}', r * 0.2, 0.02, (ax, y + s * (tw / 2 + 0.008), r), hub, 10, rot=(math.pi / 2, 0, 0), uv=False))
                for k in range(5):
                    a = 2 * math.pi * k / 5
                    parts.append(BK.bx(f'{name}_sp{ax}{s}{k}', (0.03, 0.006, r * 0.36), (ax + math.sin(a) * r * 0.36, y + s * (tw / 2 + 0.004), r + math.cos(a) * r * 0.36), hub, rz=0.0, uv=False))
        return parts


def details(car, name, body, black, kei=False, plate_yellow=False):
    """灯、保险杠、车牌、后视镜、门把手、门缝"""
    parts = []
    L, W = car.L, car.W
    head = F('car_lamp', 0xe8e4d8, rough=0.2)
    chrome = F('car_chrome', 0xc4c8cc, rough=0.25, metal=0.9)
    tail = F('car_tail', 0x8e1612, rough=0.3)
    amber = F('car_amber', 0xd8861c, rough=0.3)
    plate = F('plate_yellow' if plate_yellow else 'plate_white', 0xe8c43a if plate_yellow else 0xeeeee8, rough=0.5)
    fz = (car.bottom(L / 2 - 0.05) + car.top(L / 2 - 0.05)) / 2
    rz = (car.bottom(-L / 2 + 0.05) + car.top(-L / 2 + 0.05)) / 2
    for s in (1, -1):
        # 前大灯：车头两角
        x = L / 2 - 0.08
        parts.append(BK.bx(f'{name}_hl{s}', (0.12, 0.26, 0.14), (x, s * (W / 2 - 0.2), car.top(x) - 0.1), head, uv=False, bevel=0.03))
        parts.append(BK.bx(f'{name}_turn{s}', (0.08, 0.08, 0.06), (x, s * (W / 2 - 0.05), car.top(x) - 0.14), amber, uv=False, bevel=0.015))
        # 尾灯：车尾两侧竖着
        xr = -L / 2 + 0.06
        parts.append(BK.bx(f'{name}_tl{s}', (0.1, 0.14, 0.3 if kei else 0.16), (xr, s * (W / 2 - 0.1), car.top(xr) - (0.25 if kei else 0.12)), tail, uv=False, bevel=0.02))
        # 后视镜：挡风玻璃下沿两侧
        mx_ = car.hood_x - 0.05
        parts.append(BK.bx(f'{name}_mir{s}', (0.08, 0.16, 0.12), (mx_, s * (car.hw(mx_) + 0.1), car.belt + 0.1), body, uv=False, bevel=0.025))
        parts.append(BK.bx(f'{name}_mirarm{s}', (0.04, 0.1, 0.03), (mx_, s * (car.hw(mx_) + 0.03), car.belt + 0.06), black, uv=False))
        # 门把手、门缝（前门后沿、后门后沿）
        for k, dx in enumerate((car.hood_x - 0.95, car.hood_x - 1.75)):
            if dx > car.back_x + 0.1:
                parts.append(BK.bx(f'{name}_handle{s}{k}', (0.14, 0.02, 0.03), (dx + 0.15, s * (car.hw(dx) + 0.004), car.belt - 0.1), chrome, uv=False))
                parts.append(BK.bx(f'{name}_seam{s}{k}', (0.008, 0.01, car.belt - car.bottom(dx) - 0.12), (dx, s * (car.hw(dx) + 0.002), (car.belt + car.bottom(dx)) / 2), black, uv=False))
    # 前后保险杠（黑色树脂）、格栅、车牌
    parts.append(BK.bx(f'{name}_fbump', (0.1, W - 0.12, 0.2), (L / 2 - 0.02, 0, car.bottom(L / 2 - 0.05) + 0.12), black, uv=False, bevel=0.03))
    parts.append(BK.bx(f'{name}_rbump', (0.1, W - 0.12, 0.2), (-L / 2 + 0.02, 0, car.bottom(-L / 2 + 0.05) + 0.12), black, uv=False, bevel=0.03))
    parts.append(BK.bx(f'{name}_grille', (0.04, 0.5, 0.12), (L / 2 - 0.02, 0, car.top(L / 2 - 0.1) - 0.16), black, uv=False))
    parts.append(BK.bx(f'{name}_pf', (0.02, 0.33, 0.165), (L / 2 + 0.035, 0, car.bottom(L / 2 - 0.05) + 0.14), plate, uv=False))
    parts.append(BK.bx(f'{name}_pr', (0.02, 0.33, 0.165), (-L / 2 - 0.035, 0, rz), plate, uv=False))
    return parts


def kei_wagon(name, color):
    """方正的高顶轻型车（参考图 car_s36）：长 3.40 m、宽 1.475 m、高 1.70 m，黄牌"""
    body = F(f'car_{color:06x}', color, rough=0.28, metal=0.25)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    car = Car(L=3.40, W=1.475, belt=0.98, roof=1.70, hood_x=0.98, ws_top=0.38, back_x=-1.62, back_top=-1.52,
              hood_front=0.80, trunk_z=0.98, wheel_r=0.285, axle_f=1.20, axle_r=-1.22, plan_p=7.0, tumble=0.05)
    parts = car.build(name, body, glass, black)
    parts += car.wheels(name, F('tyre', 0x141414, rough=0.85), F('car_wheel', 0xb8bcc0, rough=0.35, metal=0.6), F('car_hub', 0x8a8e92, rough=0.35, metal=0.6))
    parts += details(car, name, body, black, kei=True, plate_yellow=True)
    return BK.model(name, parts)[0]


def hatch(name, color):
    """两厢小车：长 3.95 m、宽 1.69 m、高 1.52 m"""
    body = F(f'car_{color:06x}', color, rough=0.28, metal=0.25)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    car = Car(L=3.95, W=1.69, belt=0.94, roof=1.52, hood_x=0.95, ws_top=0.05, back_x=-1.85, back_top=-1.30,
              hood_front=0.72, trunk_z=0.92, wheel_r=0.30, axle_f=1.27, axle_r=-1.28, plan_p=5.0, tumble=0.10)
    parts = car.build(name, body, glass, black)
    parts += car.wheels(name, F('tyre', 0x141414, rough=0.85), F('car_wheel', 0xb8bcc0, rough=0.35, metal=0.6), F('car_hub', 0x8a8e92, rough=0.35, metal=0.6))
    parts += details(car, name, body, black)
    return BK.model(name, parts)[0]


def sedan(name, color):
    """三厢轿车：长 4.45 m、宽 1.75 m、高 1.45 m"""
    body = F(f'car_{color:06x}', color, rough=0.25, metal=0.3)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    car = Car(L=4.45, W=1.75, belt=0.92, roof=1.45, hood_x=0.92, ws_top=0.05, back_x=-1.40, back_top=-0.85,
              hood_front=0.70, trunk_z=0.95, wheel_r=0.31, axle_f=1.38, axle_r=-1.30, plan_p=4.0, tumble=0.12)
    parts = car.build(name, body, glass, black)
    parts += car.wheels(name, F('tyre', 0x141414, rough=0.85), F('car_wheel', 0xb8bcc0, rough=0.35, metal=0.6), F('car_hub', 0x8a8e92, rough=0.35, metal=0.6))
    parts += details(car, name, body, black)
    return BK.model(name, parts)[0]


def light_van(name, color):
    """厢式车（送货用的一厢车）：长 4.40 m、宽 1.69 m、高 1.98 m，车头很短"""
    body = F(f'car_{color:06x}', color, rough=0.32, metal=0.2)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    car = Car(L=4.40, W=1.69, belt=1.05, roof=1.98, hood_x=1.85, ws_top=1.35, back_x=-2.15, back_top=-2.08,
              hood_front=0.95, trunk_z=1.05, wheel_r=0.30, axle_f=1.45, axle_r=-1.25, plan_p=8.0, tumble=0.04)
    parts = car.build(name, body, glass, black)
    parts += car.wheels(name, F('tyre', 0x141414, rough=0.85), F('car_wheel', 0x9aa0a4, rough=0.4, metal=0.5), F('car_hub', 0x8a8e92, rough=0.35, metal=0.6))
    parts += details(car, name, body, black)
    # 车顶的行李架
    for s in (1, -1):
        parts.append(K.tube_path(f'{name}_rack{s}', [(-1.9, s * 0.62, 2.02), (1.0, s * 0.62, 2.02)], 0.02, black, seg=5))
    return BK.model(name, parts)[0]


def kei_truck(name):
    """轻卡（参考图 kei_s35）：平头驾驶室、带三面栏板的货台、小轮子。长 3.39 m、宽 1.475 m"""
    white = F('truck_white', 0xe8e8e4, rough=0.35)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    dark = F('truck_dark', 0x1e2024, rough=0.5)
    cab = Car(L=1.40, W=1.475, belt=1.10, roof=1.80, hood_x=0.62, ws_top=0.42, back_x=-0.68, back_top=-0.66,
              hood_front=1.02, trunk_z=1.10, wheel_r=0.27, axle_f=0.18, axle_r=-5.0, clearance=0.30, plan_p=9.0, tumble=0.05)
    parts = []
    for p in cab.build(name + 'c', white, glass, black):
        for v in p.data.vertices:
            v.co.x += 1.0
        parts.append(p)
    # 货台：底板 + 三面栏板（白），下面是黑色的车架
    parts.append(BK.bx(f'{name}_bed', (1.95, 1.41, 0.08), (-0.62, 0, 0.66), white, uv=False))
    for s in (1, -1):
        parts.append(BK.bx(f'{name}_gate{s}', (1.95, 0.04, 0.30), (-0.62, s * 0.69, 0.84), white, uv=False, bevel=0.01))
        for k in range(3):
            parts.append(BK.bx(f'{name}_hinge{s}{k}', (0.06, 0.05, 0.04), (-1.4 + k * 0.75, s * 0.715, 0.72), black, uv=False))
    parts.append(BK.bx(f'{name}_tailgate', (0.04, 1.41, 0.30), (-1.6, 0, 0.84), white, uv=False, bevel=0.01))
    parts.append(BK.bx(f'{name}_guard', (0.05, 1.41, 0.42), (0.36, 0, 1.05), black, uv=False))
    parts.append(BK.bx(f'{name}_frame', (3.0, 1.0, 0.16), (-0.1, 0, 0.5), dark, uv=False))
    rimc = F('car_wheel', 0xb8bcc0, rough=0.35, metal=0.6)
    for ax in (1.18, -1.05):
        for s in (1, -1):
            y = s * 0.62
            parts.append(BK.cyl(f'{name}_t{ax}{s}', 0.27, 0.15, (ax, y, 0.27), F('tyre', 0x141414, rough=0.85), 18, rot=(math.pi / 2, 0, 0), uv=False))
            parts.append(BK.cyl(f'{name}_r{ax}{s}', 0.16, 0.012, (ax, y + s * 0.08, 0.27), rimc, 16, rot=(math.pi / 2, 0, 0), uv=False))
    for s in (1, -1):
        parts.append(BK.bx(f'{name}_tl{s}', (0.06, 0.12, 0.16), (-1.63, s * 0.6, 0.62), F('car_tail', 0x8e1612, rough=0.3), uv=False))
        parts.append(BK.bx(f'{name}_hl{s}', (0.06, 0.2, 0.14), (1.72, s * 0.5, 0.95), F('car_lamp', 0xe8e4d8, rough=0.2), uv=False, bevel=0.02))
        parts.append(BK.bx(f'{name}_mir{s}', (0.08, 0.14, 0.12), (1.55, s * 0.86, 1.25), black, uv=False))
    parts.append(BK.bx(f'{name}_fbump', (0.08, 1.4, 0.16), (1.74, 0, 0.62), black, uv=False, bevel=0.02))
    parts.append(BK.bx(f'{name}_pf', (0.02, 0.33, 0.165), (1.79, 0, 0.78), F('plate_yellow', 0xe8c43a, rough=0.5), uv=False))
    parts.append(BK.bx(f'{name}_pr', (0.02, 0.33, 0.165), (-1.64, 0, 0.5), F('plate_yellow', 0xe8c43a, rough=0.5), uv=False))
    return BK.model(name, parts)[0]


def fuel_truck(name='truck_fuel'):
    """机场加油车（参考图 art/src/ref/vehicles/fuel_s41.png）：车头朝 +Y，长约 7.2 m、宽 2.4 m。
    红色平头驾驶室、铝罐（椭圆截面、圆封头、顶上走道和扶手）、后部的控制柜（黄黑警示条）、软管卷盘、侧护栏"""
    red = F('truck_red', 0xb0261e, rough=0.32, metal=0.25)
    black = F('car_black', 0x1b1c1e, rough=0.55)
    glass = F('car_glass', 0x1a2229, rough=0.06, metal=0.6)
    alu = F('truck_alu', 0xc8ccd0, rough=0.18, metal=0.95)
    grey = F('truck_grey', 0x8a8e92, rough=0.45, metal=0.4)
    yellow = F('truck_yellow', 0xe8b81c, rough=0.45)
    tyre = F('tyre', 0x141414, rough=0.85)
    rim = F('car_wheel', 0xb8bcc0, rough=0.35, metal=0.6)
    lamp = F('car_lamp', 0xe8e4d8, rough=0.2)
    amber = F('car_amber', 0xd8861c, rough=0.3)
    parts = []
    # 驾驶室：圆角盒子，前脸往后倾一点
    cab_y0, cab_y1 = 1.85, 3.55
    parts.append(BK.bx(f'{name}_cab', (2.3, cab_y1 - cab_y0, 1.95), (0, (cab_y0 + cab_y1) / 2, 1.97), red, uv=False, bevel=0.12))
    parts.append(BK.bx(f'{name}_ws', (2.05, 0.04, 0.85), (0, cab_y1 + 0.005, 2.35), glass, uv=False, bevel=0.03))
    for s in (1, -1):
        parts.append(BK.bx(f'{name}_sw{s}', (0.04, 0.95, 0.72), (s * 1.155, cab_y1 - 0.62, 2.3), glass, uv=False, bevel=0.02))
        parts.append(BK.bx(f'{name}_door{s}', (0.02, 0.012, 1.25), (s * 1.157, cab_y1 - 1.15, 1.85), black, uv=False))
        parts.append(BK.bx(f'{name}_step{s}', (0.3, 0.55, 0.06), (s * 1.08, cab_y1 - 0.65, 0.78), black, uv=False))
        parts.append(BK.bx(f'{name}_step2{s}', (0.3, 0.55, 0.06), (s * 1.08, cab_y1 - 0.65, 0.48), black, uv=False))
        # 后视镜：伸出去的支架 + 镜子
        parts.append(BK.stick(f'{name}_mirarm{s}', (s * 1.15, cab_y1 - 0.1, 2.55), (s * 1.45, cab_y1 + 0.05, 2.5), 0.02, black, seg=5))
        parts.append(BK.bx(f'{name}_mir{s}', (0.08, 0.06, 0.38), (s * 1.48, cab_y1 + 0.05, 2.3), black, uv=False, bevel=0.02))
        parts.append(BK.bx(f'{name}_hl{s}', (0.32, 0.06, 0.16), (s * 0.82, cab_y1 + 0.03, 1.12), lamp, uv=False, bevel=0.02))
        parts.append(BK.bx(f'{name}_turn{s}', (0.12, 0.06, 0.1), (s * 1.08, cab_y1 + 0.03, 1.12), amber, uv=False))
        parts.append(BK.bx(f'{name}_roofl{s}', (0.1, 0.06, 0.05), (s * 0.7, cab_y1 - 0.02, 2.98), amber, uv=False))
    parts.append(BK.bx(f'{name}_grille', (1.6, 0.04, 0.45), (0, cab_y1 + 0.01, 1.55), black, uv=False))
    for k in range(4):
        parts.append(BK.bx(f'{name}_gbar{k}', (1.5, 0.05, 0.03), (0, cab_y1 + 0.03, 1.38 + k * 0.11), grey, uv=False))
    parts.append(BK.bx(f'{name}_bump', (2.35, 0.25, 0.32), (0, cab_y1 + 0.1, 0.9), black, uv=False, bevel=0.04))
    # 车顶的旋转警示灯（机场车辆都有）
    parts.append(BK.cyl(f'{name}_beacon', 0.12, 0.16, (0, cab_y0 + 0.5, 3.03), amber, 12, uv=False))
    # 车架
    for s in (1, -1):
        parts.append(BK.bx(f'{name}_rail{s}', (0.12, 7.0, 0.26), (s * 0.45, -0.1, 0.86), black, uv=False))
    # 罐体：椭圆截面（宽 2.2、高 1.6），两头圆封头
    tank_y0, tank_y1 = -2.75, 1.65
    zc = 2.02
    secs = []
    for k in range(13):
        u = k / 12
        y = tank_y0 + (tank_y1 - tank_y0) * u
        dome = 1.0
        ends = min(u, 1 - u) * (tank_y1 - tank_y0)
        if ends < 0.3:
            dome = math.sqrt(max(0.0, 1 - ((0.3 - ends) / 0.3) ** 2)) * 0.85 + 0.15
        secs.append([(1.1 * dome * math.cos(2 * math.pi * j / 24), y, zc + 0.8 * dome * math.sin(2 * math.pi * j / 24)) for j in range(24)])
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in secs]
    for a, b in zip(rows, rows[1:]):
        for j in range(24):
            bm.faces.new((a[j], b[j], b[(j + 1) % 24], a[(j + 1) % 24]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    tank = _mesh(f'{name}_tank', bm, alu)
    K.fix_normals(tank)
    parts.append(tank)
    # 三道箍：贴着椭圆罐体的细环
    for y in (-1.6, -0.45, 0.7):
        ring = [(1.112 * math.cos(2 * math.pi * j / 32), y, zc + 0.812 * math.sin(2 * math.pi * j / 32)) for j in range(33)]
        parts.append(K.tube_path(f'{name}_hoop{y}', ring, 0.03, grey, seg=6, cap=False))
    for y in (-1.6, -0.45, 0.7):
        parts.append(BK.cyl(f'{name}_manhole{y}', 0.25, 0.08, (0, y + 0.55, zc + 0.82), grey, 16, uv=False))
    # 顶上走道和扶手
    parts.append(BK.bx(f'{name}_walk', (0.5, 3.9, 0.04), (0, -0.55, zc + 0.86), grey, uv=False))
    for s in (1, -1):
        parts.append(K.tube_path(f'{name}_hand{s}', [(s * 0.3, -2.5, zc + 1.6), (s * 0.3, 1.4, zc + 1.6)], 0.025, alu, seg=5))
        for y in (-2.5, -0.55, 1.4):
            parts.append(BK.stick(f'{name}_hpost{s}{y}', (s * 0.3, y, zc + 0.86), (s * 0.3, y, zc + 1.6), 0.025, alu, seg=4))
    # 后部：控制柜（下沿黄黑警示条）、软管卷盘、后梯
    cy = -3.25
    parts.append(BK.bx(f'{name}_cab_ctrl', (2.3, 0.65, 1.25), (0, cy, 1.55), grey, uv=False, bevel=0.03))
    for k in range(12):
        parts.append(BK.bx(f'{name}_haz{k}', (2.3 / 12, 0.66, 0.16), (-1.15 + 2.3 / 12 * (k + 0.5), cy, 0.98), yellow if k % 2 == 0 else black, uv=False))
    parts.append(BK.bx(f'{name}_panel', (0.6, 0.03, 0.45), (0.5, cy - 0.33, 1.7), F('truck_panel', 0x2a2d30, rough=0.4), uv=False))
    for k in range(5):
        parts.append(K.torus(f'{name}_hose{k}', 0.42, 0.045, (-0.55, cy, 2.55 + 0.0), yellow, 24, 6, rot=(0, math.pi / 2, 0)))
        parts[-1].location.x += -0.15 + k * 0.075
    parts.append(BK.cyl(f'{name}_reel', 0.25, 0.5, (-0.55, cy, 2.55), grey, 14, rot=(0, math.pi / 2, 0), uv=False))
    for s in (1, -1):
        parts.append(BK.stick(f'{name}_ladder{s}', (s * 0.22, cy - 0.38, 0.9), (s * 0.22, cy - 0.38, zc + 0.9), 0.02, alu, seg=4))
    for k in range(7):
        parts.append(BK.stick(f'{name}_rung{k}', (-0.22, cy - 0.38, 1.1 + k * 0.3), (0.22, cy - 0.38, 1.1 + k * 0.3), 0.015, alu, seg=4))
    # 侧护栏（铝条 + 一道黄）、两侧的输油管
    for s in (1, -1):
        for z in (0.68, 0.92):
            parts.append(BK.bx(f'{name}_guard{s}{z}', (0.04, 2.7, 0.07), (s * 1.12, 0.2, z), alu, uv=False))
        parts.append(BK.bx(f'{name}_guardy{s}', (0.045, 2.7, 0.025), (s * 1.125, 0.2, 0.8), yellow, uv=False))
        parts.append(K.tube_path(f'{name}_pipe{s}', [(s * 0.95, 1.4, 1.2), (s * 0.95, -2.7, 1.2), (s * 0.7, -3.0, 1.35)], 0.06, alu, seg=8))
    # 轮子：前面单轮、后面双轮；后轮挡泥板
    for y, dual in ((2.65, False), (-1.75, True)):
        for s in (1, -1):
            offs = (0.0,) if not dual else (-0.16, 0.16)
            for k, o in enumerate(offs):
                x = s * (0.95 + o)
                parts.append(BK.cyl(f'{name}_w{y}{s}{k}', 0.5, 0.3, (x, y, 0.5), tyre, 20, rot=(0, math.pi / 2, 0), uv=False))
            parts.append(BK.cyl(f'{name}_rim{y}{s}', 0.3, 0.04, (s * (0.95 + max(offs) + 0.15), y, 0.5), rim, 16, rot=(0, math.pi / 2, 0), uv=False))
            if dual:
                parts.append(BK.bx(f'{name}_fender{s}', (0.7, 1.2, 0.06), (s * 0.95, y, 1.08), black, uv=False))
    return BK.model(name, parts)[0]
