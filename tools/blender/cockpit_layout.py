# 驾驶舱仪表板布局（单一数据源）：Blender 建模脚本与 PIL 贴图脚本共用。
# 参照：H125 驾驶舱照片（维基共享资源 F-HGRU_Airbus_H125_helicopter_cockpit_Ardèche_Fev_2024.jpg，CC BY-SA 4.0，仅作参照）。
# 机型为游戏里虚构的 RT-7，不使用任何真实厂商标志与型号文字。
#
# 坐标：
#   Blender 世界坐标：X 右、Y 前（机头方向）、Z 上，单位米，原点 = 直升机重心（主旋翼轴线上）。
#   游戏机体坐标：x = X，y = Z，z = -Y（导出 glTF 时 Blender 自动转换）。
#   仪表板局部坐标 (u, v)：u 向右，v 沿仪表板面向上，原点 = 仪表板顶边中点；仪表板面向后仰 TILT 度（顶边更远）。

import math

# 驾驶员眼点（右座，Blender 坐标）
EYE = (0.45, 1.00, 0.42)

PANEL_ORIGIN = (0.0, 1.70, 0.10)
PANEL_TILT = 14.0  # 度
PANEL_HALF_W = 0.52
PANEL_BOTTOM = -0.50


def panel_top(u):
    """仪表板顶边（随遮光罩呈弧形）"""
    k = min(1.0, abs(u) / PANEL_HALF_W)
    return -0.115 * k * k - 0.02 * k ** 6


def panel_to_world(u, v, w=0.0):
    """仪表板局部 (u, v, w) → Blender 世界坐标。w 沿法线朝向驾驶员为正。"""
    t = math.radians(PANEL_TILT)
    ox, oy, oz = PANEL_ORIGIN
    # v 轴：(0, sin t, cos t)；法线（朝向驾驶员）：(0, -cos t, sin t)
    return (ox + u, oy + v * math.sin(t) - w * math.cos(t), oz + v * math.cos(t) + w * math.sin(t))


def panel_normal():
    t = math.radians(PANEL_TILT)
    return (0.0, -math.cos(t), math.sin(t))


# 圆形仪表：名称、中心 (u, v)、表面直径、类型
# 3-1/8 英寸仪表表面约 Ø76 mm（外框 82 mm 见方），2-1/4 英寸约 Ø55 mm
GAUGES = [
    # 驾驶员（右）侧：标准“T”形布局
    dict(id='asi', u=0.182, v=-0.172, d=0.076, label='空速表'),
    dict(id='alt', u=0.372, v=-0.172, d=0.076, label='高度表'),
    dict(id='turn', u=0.190, v=-0.278, d=0.076, label='转弯侧滑仪'),
    dict(id='hsi', u=0.282, v=-0.286, d=0.076, label='航向仪'),
    dict(id='vsi', u=0.378, v=-0.278, d=0.076, label='升降速度表'),
    dict(id='nr', u=0.207, v=-0.068, d=0.054, label='旋翼/动力涡轮转速'),
    # 副驾驶（左）侧
    dict(id='clock', u=-0.262, v=-0.066, d=0.054, label='时钟'),
    dict(id='hdg2', u=-0.252, v=-0.172, d=0.076, label='备用航向'),
]

# 方形电子姿态仪（屏幕）
AI = dict(u=0.277, v=-0.176, w=0.064, h=0.078, frame_w=0.080, frame_h=0.098)

# 发动机与飞行器参数显示器（上下两块屏 + 右侧按键列）
VEMD = dict(u=-0.010, v=-0.197, w=0.176, h=0.276,
            screens=[dict(u=-0.022, v=-0.124, w=0.112, h=0.094), dict(u=-0.022, v=-0.262, w=0.112, h=0.094)],
            keys_u=0.058, keys=['OFF 1', 'OFF 2', 'SCROLL', 'RESET', 'SELECT', '+', '-', 'ENTER', 'BRT +', 'BRT -'])

# 导航仪（GPS）
GPS = dict(u=-0.004, v=-0.386, w=0.166, h=0.076, screen=dict(u=-0.002, v=-0.384, w=0.078, h=0.052))

# 照明旋钮（遮光罩下沿）
KNOBS = [
    dict(u=-0.072, v=-0.032, label='NIGHT  DAY', kind='rotary'),
    dict(u=-0.020, v=-0.032, label='SYST. LITE', kind='dimmer'),
    dict(u=0.032, v=-0.032, label='INST. LITE', kind='dimmer'),
]

# 告警灯板（4 行 × 6 列）+ 机号牌
ANNUNCIATOR = dict(u=0.345, v=-0.080, w=0.168, h=0.066, rows=4, cols=6,
                   labels=['GOV', 'ENG P', 'FUEL P', 'GEN', 'BATT', 'HORN',
                           'TQ LIM', 'NR LOW', 'XMSN', 'HYD', 'PITOT', 'LOW FUEL',
                           'DAMAGE', 'TERRAIN', 'BOOST', 'SHIELD', 'HOVER', 'CARGO',
                           'ENG CHIP', 'MGB CHIP', 'TGB CHIP', 'FIRE', 'SAND', 'AUX'])
REG_PLATE = dict(u=0.300, v=-0.030, w=0.050, h=0.014, text='RT-7')

EMER_SW = dict(u=0.127, v=-0.060, label='EMER. SW')

# 右缘开关条：3 个拨动开关 + 1 个指示灯
SWITCH_STRIP = dict(u=0.478, v=-0.250, w=0.036, h=0.180, toggles=[-0.205, -0.245, -0.285], lamp=-0.168)

# 左侧设备
ELT = dict(u=-0.330, v=-0.066, w=0.036, h=0.074, label='ELT')
RADIO = dict(u=-0.252, v=-0.292, w=0.236, h=0.060)
HELISAFE = dict(u=-0.208, v=-0.378, w=0.172, h=0.066)
PLACARD = dict(u=-0.372, v=-0.214, w=0.094, h=0.054,
               lines=['VHF FM RADIO', '— NOT USED BY THE', 'HANDLING PILOT', '— NOT USED DURING', 'TAKE-OFF OR LANDING'])

# 仪表板上的印刷文字（u, v, 文字, 字高 m, 对齐）
LABELS = [
    (-0.072, -0.012, 'NIGHT      DAY', 0.0045, 'c'),
    (-0.020, -0.012, 'SYST. LITE', 0.0045, 'c'),
    (0.032, -0.012, 'INST. LITE', 0.0045, 'c'),
    (0.127, -0.093, 'EMER. SW', 0.0045, 'c'),
    (-0.004, -0.432, 'GPS OPERABLE IN VFR CONDITIONS ONLY', 0.0042, 'c'),
    (0.302, -0.338, 'PITCH  SYNC', 0.0035, 'c'),
    (-0.330, -0.110, 'TEST', 0.0035, 'c'),
    (0.478, -0.150, 'LDG LT', 0.0035, 'c'),
    (0.478, -0.335, 'WIPER', 0.0035, 'c'),
]

# 面板螺丝（u, v）：沿外缘和分区线
def screw_positions():
    pts = []
    for i in range(11):
        u = -0.48 + i * 0.096
        pts.append((u, panel_top(u) - 0.014))
        pts.append((u, PANEL_BOTTOM + 0.014))
    for v in (-0.12, -0.24, -0.36):
        pts.append((-PANEL_HALF_W + 0.014, v))
        pts.append((PANEL_HALF_W - 0.014, v))
    for v in (-0.05, -0.33, -0.45):
        pts.append((-0.108, v))
        pts.append((0.102, v))
    return pts


# 遮光罩：后沿（朝向驾驶员）的平面轮廓 (X, Y) 与高度
GLARE = dict(z_top=0.175, lip_y_center=1.555, lip_y_side=1.66, half_w=0.60, front_y=2.02)
