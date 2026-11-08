# 船体放样：按船长方向一串站位，每个站位一条截面线（从龙骨到舷边），左右镜像连成网格。
# 用来做渔船、渡轮、河船的船壳，比几个盒子拼的像得多：船首外飘、舷弧往前升高、船底是 V 形，艏柱收成一条线。
#
# 坐标：Blender（X 船长方向、船首朝 +X；Y 横向；Z 上），原点在水线面的船中。
# 贴图坐标：u 沿船长（0 船尾 → 1 船首），v 沿截面从龙骨到舷边（0 → 1）——船身贴图（水线、船名、锈迹）按这个画。

import math

import bmesh
import bpy
from mathutils import Vector


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Hull:
    """L：总长；B：最大宽；T：吃水（龙骨在水线下多深）；
    fb_aft、fb_fwd：船尾、船首的干舷（舷边离水线多高，舷弧往前升高）；
    rake：艏柱往前倾多少（舷边处的船首比水线处的船首往前多少米）；
    deadrise_aft / deadrise_fwd：船底的 V 形斜升角（度），船首更尖；flare：船首舷侧外飘量（米）；
    transom：船尾方尾的宽度比例（0 尖尾，1 和最大宽一样）；entry：船首收窄的长度比例。"""

    def __init__(self, L, B, T, fb_aft, fb_fwd, rake=1.0, deadrise_aft=12, deadrise_fwd=35, flare=0.25, transom=0.85, entry=0.38, tumble=0.0):
        self.L, self.B, self.T = L, B, T
        self.fb_aft, self.fb_fwd = fb_aft, fb_fwd
        self.rake = rake
        self.dr_aft, self.dr_fwd = math.radians(deadrise_aft), math.radians(deadrise_fwd)
        self.flare = flare
        self.transom = transom
        self.entry = entry
        self.tumble = tumble
        self.x0 = -L / 2
        self.bow_w = L / 2 - rake * 0.6  # 水线处的船首
        self.bow_s = L / 2  # 舷边处的船首

    def sheer(self, x):
        """舷边高度：船尾低、往前慢慢升高，船首最高"""
        t = (x - self.x0) / self.L
        return self.fb_aft + (self.fb_fwd - self.fb_aft) * t ** 2.2

    def keel(self, x):
        """龙骨：船中最深，船首往上收（前脚），船尾略抬"""
        t = (x - self.x0) / self.L
        fore = smoothstep(0.70, 1.0, t)
        aft = smoothstep(0.12, 0.0, t)
        return -self.T * (1 - 0.85 * fore ** 1.4 - 0.25 * aft)

    def half(self, x, bow_x):
        """某个高度的船首在 bow_x：这个高度上，x 处的半宽"""
        span = self.L * self.entry
        start = bow_x - span
        h = self.B / 2
        if x > start:
            k = (x - start) / (bow_x - start)
            h *= max(0.0, 1 - k ** 1.7) ** 0.62
        # 船尾：方尾比最大宽窄一点
        t = (x - self.x0) / self.L
        h *= self.transom + (1 - self.transom) * smoothstep(0.0, 0.3, t)
        return max(0.0, h)

    def bow_x(self, z, zs):
        """某个高度上的船首（艏柱）在哪：往上越来越往前，是一条向前凸的弧线"""
        if z <= 0:
            return self.bow_w - (-z / self.T) ** 1.3 * self.rake * 0.55
        hz = max(0.0, min(1.0, z / max(0.1, zs)))
        return self.bow_w + (self.bow_s - self.bow_w) * (1 - (1 - hz) ** 1.6)

    def point(self, s, j, nz):
        """网格上的点：s 是这一层从船尾到这一层船首的比例（0..1），j 是第几层。
        每一层都正好收在自己的船首点上，艏柱就是一条干净的曲线，不会一级一级的"""
        x = self.x0 + (self.bow_w - self.x0) * s
        for _ in range(4):
            zk, zs = self.keel(x), self.sheer(x)
            z = zk + (zs - zk) * j / nz
            bx = self.bow_x(z, zs)
            x = self.x0 + (bx - self.x0) * s
        return x, z, bx, zk, zs

    def section(self, x, nz=14):
        """x 处的截面线：[(y, z)]，从龙骨（y=0）到舷边"""
        zk, zs = self.keel(x), self.sheer(x)
        pts = []
        for j in range(nz + 1):
            z = zk + (zs - zk) * j / nz
            pts.append((self.y_at(x, z, self.bow_x(z, zs), zk, zs), z))
        return pts

    def y_at(self, x, z, bow_x, zk, zs):
        """半宽：平面上的收窄（船首、方尾）× 截面形状（V 形船底、舷侧、外飘）"""
        t = (x - self.x0) / self.L
        dr = self.dr_aft + (self.dr_fwd - self.dr_aft) * smoothstep(0.35, 0.95, t)
        if True:
            hw = self.half(x, bow_x)
            # 船底 V 形：龙骨处为 0，到舭部（水线下一点）到满宽，斜升角越大越尖
            chine = min(-0.15, zk * 0.25)
            if z < chine:
                k = (z - zk) / max(1e-3, chine - zk)
                y = hw * (k ** (1.0 + 2.5 * math.sin(dr)))
                y = y * (0.55 + 0.45 * k)
            else:
                # 舭部以上：舷侧，船首外飘（越往上越宽），船尾可以内倾（tumblehome）
                k = (z - chine) / max(1e-3, zs - chine)
                y = hw * (0.88 + 0.12 * math.sin(k * math.pi / 2))
                y += self.flare * smoothstep(0.55, 1.0, t) * k ** 2 * (hw / (self.B / 2) + 0.15)
                y -= self.tumble * k ** 2
            return max(0.0, y)

    def mesh(self, name, nx=48, nz=14, mat=None):
        """整个船壳（左右两舷 + 方尾），返回物体。uv：u 沿船长，v 沿截面"""
        ss = [1 - (1 - i / nx) ** 1.35 for i in range(nx + 1)]  # 船首加密
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        grid = {}
        for i, s in enumerate(ss):
            for j in range(nz + 1):
                x, z, bx, zk, zs = self.point(s, j, nz)
                y = 0.0 if i == nx else self.y_at(x, z, bx, zk, zs)
                for side in (1, -1):
                    grid[side, i, j] = bm.verts.new((x, side * y, z))
        for side in (1, -1):
            for i in range(nx):
                for j in range(nz):
                    q = [grid[side, i, j], grid[side, i + 1, j], grid[side, i + 1, j + 1], grid[side, i, j + 1]]
                    if side < 0:
                        q = q[::-1]
                    f = bm.faces.new(q)
                    for lp, (di, dj) in zip(f.loops, ([(0, 0), (1, 0), (1, 1), (0, 1)] if side > 0 else [(0, 1), (1, 1), (1, 0), (0, 0)])):
                        lp[uv].uv = ((i + di) / nx, (j + dj) / nz)
        # 龙骨线：两舷在 y=0 处重合，合并
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
        # 方尾：船尾截面封起来
        stern = [grid[1, 0, j] for j in range(nz + 1) if grid[1, 0, j].is_valid] + [grid[-1, 0, j] for j in range(nz, -1, -1) if grid[-1, 0, j].is_valid]
        stern = [v for k, v in enumerate(stern) if v not in stern[:k]]
        if len(stern) >= 3:
            try:
                bm.faces.new(stern[::-1])
            except ValueError:
                pass
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        if mat:
            me.materials.append(mat)
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        return ob

    def split_mesh(self, name, zb=0.12, nx=56, nb=5, nt=12, mat_top=None, mat_bot=None):
        """船壳分两段：水线（zb）以下的船底、以上的舷侧。返回 (舷侧, 船底)。
        舷侧的贴图坐标：右舷（+Y）占左半张、船首在 u=0；左舷占右半张、船首在 u=1；v 从 zb 到舷边 0 → 1。
        这样船首两侧的字从外面看都是正的（boat_textures.py 按这个画）"""
        nz = nb + nt
        ss = [1 - (1 - i / nx) ** 1.35 for i in range(nx + 1)]

        def zlev(x, j):
            zk, zs = self.keel(x), self.sheer(x)
            if j <= nb:
                return zk + (zb - zk) * j / nb
            return zb + (zs - zb) * (j - nb) / nt

        def pt(s, j):
            x = self.x0 + (self.bow_w - self.x0) * s
            for _ in range(4):
                zk, zs = self.keel(x), self.sheer(x)
                z = zlev(x, j)
                bx = self.bow_x(z, zs)
                x = self.x0 + (bx - self.x0) * s
            return x, z, bx, zk, zs

        P = {}
        for i, s in enumerate(ss):
            for j in range(nz + 1):
                x, z, bx, zk, zs = pt(s, j)
                y = 0.0 if i == nx else self.y_at(x, z, bx, zk, zs)
                P[i, j] = (x, y, z)

        def build(nm, j0, j1, mat, tex):
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new('UVMap')
            vid = {}
            for side in (1, -1):
                for i in range(nx + 1):
                    for j in range(j0, j1 + 1):
                        x, y, z = P[i, j]
                        vid[side, i, j] = bm.verts.new((x, side * y, z))
            for side in (1, -1):
                for i in range(nx):
                    for j in range(j0, j1):
                        q = [vid[side, i, j], vid[side, i + 1, j], vid[side, i + 1, j + 1], vid[side, i, j + 1]]
                        corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                        if side < 0:
                            q = q[::-1]
                            corners = corners[::-1]
                        f = bm.faces.new(q)
                        for lp, (ci, cj) in zip(f.loops, corners):
                            s = ss[ci]
                            v = (cj - j0) / (j1 - j0)
                            if tex:
                                u = 0.5 * (1 - s) if side > 0 else 0.5 + 0.5 * s
                            else:
                                u = s
                            lp[uv].uv = (u, v)
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
            if j0 == 0:
                pass
            me = bpy.data.meshes.new(nm)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(nm, me)
            bpy.context.collection.objects.link(ob)
            if mat:
                me.materials.append(mat)
            me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
            return ob

        top = build(name + '_top', nb, nz, mat_top, True)
        bot = build(name + '_bot', 0, nb, mat_bot, False)
        # 方尾：把船尾截面封起来（放在船底那一段里，颜色和船底一样就不显眼了——再加一块舷侧颜色的尾板）
        return top, bot

    def transom_outline(self, zb=0.12):
        """方尾的轮廓（从右舷龙骨绕到左舷）：[(y, z)]"""
        x = self.x0
        pts = self.section(x, 16)
        return pts

    def deck_outline(self, x, inset=0.0):
        """舷边在 x 处的半宽和高度（甲板、舷墙、栏杆沿着它走）"""
        y, z = self.section(x)[-1]
        return max(0.0, y - inset), z

    def deck(self, name, inset=0.06, drop=0.05, nx=40, mat=None, x_from=None, x_to=None):
        """甲板：沿舷边往里收一点、往下一点的一块曲面（中间微微拱起）"""
        a = self.x0 + 0.02 if x_from is None else x_from
        b = self.bow_s - 0.05 if x_to is None else x_to
        bm = bmesh.new()
        rows = []
        for i in range(nx + 1):
            x = a + (b - a) * i / nx
            y, z = self.deck_outline(x, inset)
            z -= drop
            rows.append([bm.verts.new((x, -y, z)), bm.verts.new((x, 0.0, z + 0.04 * y)), bm.verts.new((x, y, z))])
        for i in range(nx):
            for j in range(2):
                bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        if mat:
            me.materials.append(mat)
        return ob

    def rail_path(self, side, x_from, x_to, up=0.0, inset=0.0, n=30):
        """沿舷边的一条线（栏杆、舷缘护木）"""
        pts = []
        for i in range(n + 1):
            x = x_from + (x_to - x_from) * i / n
            y, z = self.deck_outline(x, inset)
            pts.append(Vector((x, side * y, z + up)))
        return pts
