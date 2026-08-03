#!/usr/bin/env python3
"""generate showreel case (video/1) — Remotion Showreel 高保真复刻
对照 my-video/src 逐场景复刻：7 场景 36s、全局 HUD overlay（帧计数/时间/进度条）、
逐字 spring stagger / bezier 曲线 draw / 底部生长弹簧柱图 / 64 段伪频谱 /
glitch 切片 / 粒子爆发 / 走马灯。附合成 music.wav（S5 Audio 场景配乐）。"""
import json, math, os, struct, wave

W, H, FPS = 1920, 1080, 30
BG = "#0E1A24"
TEXT = "#F5F1E8"
AMBER = "#FFC24B"
CORAL = "#FF6B57"
TEAL = "#4ECDC4"
MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
DISPLAY = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
BEZ = "bezier(0.16,1,0.3,1)"       # Showreel 标志性 out 曲线
BEZIO = "bezier(0.65,0,0.35,1)"    # Showreel in-out 曲线

GRID = ("linear-gradient(rgba(245,241,232,0.045) 1px, transparent 1px) 0 0 / 80px 80px, "
        "linear-gradient(90deg, rgba(245,241,232,0.045) 1px, transparent 1px) 0 0 / 80px 80px, "
        "radial-gradient(120% 105% at 50% 50%, transparent 55%, rgba(0,0,0,0.45) 100%), " + BG)

# ---------------------------------------------------------------- utils

def prand(seed):
    """与 my-video theme.pseudoRandom 同源"""
    x = math.sin(seed * 127.1 + 311.7) * 43758.5453123
    return x - math.floor(x)

def _hx(c):
    c = c.lstrip('#')
    return [int(c[i:i+2], 16) for i in (0, 2, 4)]

def mix(a, b, t):
    A, B = _hx(a), _hx(b)
    return "#%02x%02x%02x" % tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))

def ramp(t):
    """teal → amber → coral（原版 rampColor）"""
    return mix(TEAL, AMBER, t * 2) if t < 0.5 else mix(AMBER, CORAL, (t - 0.5) * 2)

def txt(id, x, y, w, h, html, size, color=TEXT, weight=400, font=None, align="left",
        valign="top", ls=None, fx=None, kf=None, lh=1.0, opacity=None, stagger=None,
        loop=None, stroke=None, origin=None, z=None):
    el = {"id": id, "type": "text", "x": round(x, 1), "y": round(y, 1), "w": round(w, 1),
          "h": round(h, 1), "html": html, "fontSize": size, "color": color,
          "fontWeight": weight, "align": align, "valign": valign, "lineHeight": lh}
    if font: el["fontFamily"] = font
    if ls is not None: el["letterSpacing"] = ls
    if fx: el["fx"] = fx
    if kf: el["keyframes"] = kf
    if opacity is not None: el["opacity"] = opacity
    if stagger: el["stagger"] = stagger
    if loop: el["kfLoop"] = True
    if stroke: el["textStroke"] = stroke
    if origin: el["origin"] = origin
    if z is not None: el["z"] = z
    return el

def shape(id, kind, x, y, w, h, fill, radius=None, fx=None, kf=None, stroke=None,
          sw=None, opacity=None, grad=None, direction=None, loop=None, origin=None,
          blur=None, z=None):
    el = {"id": id, "type": "shape", "shape": kind, "x": round(x, 1), "y": round(y, 1),
          "w": round(w, 1), "h": round(h, 1), "fill": fill}
    if radius is not None: el["radius"] = radius
    if fx: el["fx"] = fx
    if kf: el["keyframes"] = kf
    if stroke: el["stroke"] = stroke
    if sw is not None: el["strokeWidth"] = sw
    if opacity is not None: el["opacity"] = opacity
    if grad: el["fillGradient"] = grad
    if direction: el["direction"] = direction
    if loop: el["kfLoop"] = True
    if origin: el["origin"] = origin
    if blur is not None: el["blur"] = blur
    if z is not None: el["z"] = z
    return el

def fx_in(kind="fade-up", dur=0.7, delay=0.2, easing=None):
    f = {"enter": kind, "enterDur": dur, "delay": delay}
    if easing: f["enterEasing"] = easing
    return f

def fx_out(kind="fade-out", dur=0.8):
    return {"exit": kind, "exitDur": dur}

def fade_both(enter, dur_in, delay, exit_dur=0.8):
    f = fx_in(enter, dur_in, delay)
    f.update(fx_out("fade-out", exit_dur))
    return f

# ---------------------------------------------------------------- 共享层

def scene_label(idx, label, caption, accent=AMBER):
    """原版 SceneLabel：left 120 / bottom 108，描边竖条 + 序号 + 标签 + 说明，
    frames 10-24 (0.33-0.8s) 淡入+右移 24px。整体在 HUD 底栏（y≥982）之上。"""
    return [
        shape("sl-bar", "rect", 120, 884, 3, 64, accent, fx=fx_in("fade", 0.47, 0.33)),
        txt("sl-idx", 140, 884, 70, 38, idx, 28, accent, 600, MONO,
            fx=fx_in("slide-left", 0.47, 0.33)),
        txt("sl-label", 212, 887, 700, 34, label, 26, TEXT + "D9", 400, MONO,
            ls=8, fx=fx_in("slide-left", 0.47, 0.4)),
        txt("sl-cap", 140, 952, 900, 28, caption, 20, TEXT + "66", 400, MONO,
            ls=2, fx=fx_in("slide-left", 0.47, 0.45)),
    ]

def ambient():
    """环境层：blur 柔和漂移洗层 ×2 + 上升尘埃 ×24（kfLoop，初始相位分散）"""
    els = [
        shape("wash-teal", "ellipse", 1250, -260, 900, 620, "rgba(78,205,196,0.13)",
              blur=100,
              kf=[{"t": 0, "x": 1250, "y": -260},
                  {"t": 4.5, "x": 1150, "y": -180, "easing": "easeInOut"},
                  {"t": 9, "x": 1250, "y": -260, "easing": "easeInOut"}], loop=True),
        shape("wash-amber", "ellipse", -280, 780, 980, 640, "rgba(255,194,75,0.10)",
              blur=100,
              kf=[{"t": 0, "x": -280, "y": 780},
                  {"t": 5.5, "x": -180, "y": 700, "easing": "easeInOut"},
                  {"t": 11, "x": -280, "y": 780, "easing": "easeInOut"}], loop=True),
    ]
    cols = [AMBER, CORAL, TEAL]
    for i in range(24):
        x = prand(i * 3.1) * W
        size = 2 + prand(i * 5.7) * 3
        op = 0.1 + prand(i * 13.7) * 0.22
        d = 6 + prand(i * 7.7) * 6            # 6-12s 各异
        y0 = -30 + prand(i * 9.3) * (H + 60)  # 初始相位全屏分散
        rise = H + 60
        els.append(shape(f"dust{i}", "ellipse", x, y0, size, size, cols[i % 3],
                         kf=[{"t": 0, "y": y0, "opacity": 0},
                             {"t": round(d * 0.12, 2), "y": round(y0 - rise * 0.12, 1), "opacity": op},
                             {"t": round(d * 0.88, 2), "y": round(y0 - rise * 0.88, 1), "opacity": op},
                             {"t": d, "y": round(y0 - rise, 1), "opacity": 0}], loop=True))
    return els

def hud_overlay(total_dur):
    """全局 HUD（doc.overlay，全片时间基准）：四角框 / 标题 / REC+帧计数 /
    格式读数 / T+时间 / 全局进度条+% / 开场黑渐隐。pointer-events 穿透。"""
    els = []
    CB = TEXT + "4D"
    for cx, cy in [(36, 36), (1920 - 36 - 28, 36), (36, 1080 - 36 - 28), (1920 - 36 - 28, 1080 - 36 - 28)]:
        els.append(shape(f"hud-cb{cx}-{cy}-h", "rect", cx, cy, 28, 2, CB))
        els.append(shape(f"hud-cb{cx}-{cy}-v", "rect", cx, cy, 2, 28, CB))
    # 左上：节目名（frames 6-20 淡入）
    els.append(txt("hud-title", 88, 64, 560, 30, "CAPABILITY SHOWREEL — 2026",
                   22, TEXT + "A6", 400, MONO, ls=6, fx=fx_in("fade", 0.47, 0.2)))
    # 右上：REC 闪烁 + 全局帧计数
    els.append(shape("hud-rec-dot", "ellipse", 1634, 71, 14, 14, CORAL,
                     fx=fx_in("fade", 0.47, 0.2),
                     kf=[{"t": 0, "opacity": 1}, {"t": 0.6, "opacity": 1},
                         {"t": 0.65, "opacity": 0.15}, {"t": 1, "opacity": 0.15}], loop=True))
    els.append(txt("hud-rec", 1662, 60, 70, 36, "REC", 24, CORAL, 400, MONO,
                   ls=4, valign="middle", fx=fx_in("fade", 0.47, 0.2)))
    els.append(txt("hud-frame", 1738, 60, 180, 36, "F {{frame:4}}", 24, TEXT + "CC",
                   400, MONO, ls=2, valign="middle", fx=fx_in("fade", 0.47, 0.2)))
    # 右下：格式读数
    els.append(txt("hud-format", 1472, 988, 360, 30, "1920 × 1080 · 30 FPS",
                   22, TEXT + "80", 400, MONO, ls=4, align="right"))
    # 左下：T+时间 + 全局进度条 + 百分比
    els.append(txt("hud-time", 88, 982, 170, 32, "T+{{time:2}}s", 22, TEXT + "80",
                   400, MONO, ls=3, valign="middle"))
    els.append(shape("hud-prog-bg", "rect", 266, 997, 320, 3, TEXT + "1F"))
    els.append(shape("hud-prog", "rect", 266, 997, 320, 3, TEAL, origin="left",
                     kf=[{"t": 0, "scale": 0},
                         {"t": total_dur, "scale": 1, "easing": "linear"}]))
    els.append(txt("hud-pct", 602, 982, 90, 32, "{{progress}}%", 22, AMBER, 400,
                   MONO, ls=2, valign="middle"))
    # 开场黑渐隐（Background 全局 fade-in，frames 0-10：0.35→0）
    els.append(shape("hud-fadein", "rect", 0, 0, W, H, "#000000",
                     kf=[{"t": 0, "opacity": 0.35}, {"t": 0.34, "opacity": 0}], z=999))
    return els

# ---------------------------------------------------------------- S1 TITLE (4s)

els = ambient()
els.append(shape("glow", "ellipse", 580, 266, 760, 440, "rgba(255,194,75,0.20)",
                 blur=80,
                 kf=[{"t": 0, "scale": 0.6, "opacity": 0},
                     {"t": 1.33, "opacity": 1, "easing": BEZ},
                     {"t": 2, "scale": 1, "opacity": 1, "easing": BEZ}]))
els.append(shape("tag-bar", "rect", 120, 150, 3, 36, CORAL, fx=fx_in("fade", 0.53, 0.47)))
els.append(txt("tag", 140, 148, 600, 40, "REACT VIDEO TOOLKIT", 24, TEXT + "B3", 400,
               MONO, ls=6, fx=fx_in("slide-left", 0.53, 0.47)))
els.append(txt("title", 0, 385, W, 200, "REMOTION", 172, TEXT, 800, DISPLAY,
               align="center", valign="middle", lh=1,
               stagger={"by": "char", "step": 0.083, "delay": 0.27, "dur": 1.0,
                        "dy": 120, "rotation": 10, "easing": "spring(13,170,0.9)"}))
els.append(shape("underline", "rect", 650, 591, 620, 10, TEAL,
                 kf=[{"t": 0, "scale": 0, "opacity": 0},
                     {"t": 1.67, "scale": 0, "opacity": 1},
                     {"t": 1.73, "scale": 0, "opacity": 1},
                     {"t": 2.47, "scale": 1, "opacity": 1, "easing": BEZ}]))
els.append(txt("subtitle", 0, 643, W, 52, "REACT → VIDEO", 32, TEXT + "B3", 400, MONO,
               align="center", valign="middle", ls=16, fx=fx_in("fade-up", 0.6, 2.07)))
els += scene_label("01", "TITLE", "spring() stagger · Easing.bezier()")
S1 = {"id": "s1", "duration": 4, "transition": "none", "transitionIn": 0,
      "background": GRID,
      "captions": [{"start": 0.8, "end": 3.6, "text": "逐字 spring 物理入场（过冲回弹）+ bezier 下划线"}],
      "elements": els}

# ------------------------------------------------- S2 KINETIC TYPE (5s，三段合一)

els = ambient()
# 段落计数器（右上，01/02/03 硬切换：54f=1.8s、108f=3.6s）
els.append(txt("seg-a", 1620, 120, 180, 130, "01", 110, TEAL, 600, MONO,
               kf=[{"t": 0, "opacity": 0}, {"t": 0.47, "opacity": 1},
                   {"t": 1.8, "opacity": 1}, {"t": 1.93, "opacity": 0}]))
els.append(txt("seg-b", 1620, 120, 180, 130, "02", 110, TEAL, 600, MONO,
               kf=[{"t": 1.8, "opacity": 0}, {"t": 1.93, "opacity": 1},
                   {"t": 3.6, "opacity": 1}, {"t": 3.73, "opacity": 0}]))
els.append(txt("seg-c", 1620, 120, 180, 130, "03", 110, TEAL, 600, MONO,
               kf=[{"t": 3.6, "opacity": 0}, {"t": 3.73, "opacity": 1}]))
els.append(txt("seg-n", 1650, 260, 150, 34, "/ 03", 26, TEXT + "66", 400, MONO,
               ls=6, fx=fx_in("fade", 0.5, 0.2)))

A_OUT = [{"t": 1.53, "opacity": 1}, {"t": 1.8, "opacity": 0}]   # frames 46-54
B_OUT = [{"t": 3.33, "opacity": 1}, {"t": 3.6, "opacity": 0}]   # frames 100-108

# —— 段 A：SPRING（弹簧词 + 弹跳小球，frame 4 起）——
els.append(txt("a-word", 150, 350, 1100, 200, "SPRING", 176, TEXT, 800, DISPLAY, lh=1,
               kf=[{"t": 0, "y": 520, "opacity": 0},
                   {"t": 0.13, "y": 520, "opacity": 0},
                   {"t": 1.33, "y": 350, "opacity": 1, "easing": "spring(9,180,1)"}] + A_OUT))
els.append(txt("a-cap", 156, 560, 700, 40, "Easing.spring({ damping: 9 })", 28, AMBER,
               400, MONO,
               kf=[{"t": 0, "opacity": 0}, {"t": 0.5, "opacity": 0},
                   {"t": 1.1, "opacity": 1}] + A_OUT))
els.append(shape("a-track", "rect", 1598, 330, 4, 280, TEXT + "26",
                 kf=[{"t": 0, "opacity": 0}, {"t": 0.3, "opacity": 0},
                     {"t": 0.7, "opacity": 1}] + A_OUT))
els.append(shape("a-base", "rect", 1560, 606, 80, 4, TEAL,
                 kf=[{"t": 0, "opacity": 0}, {"t": 0.3, "opacity": 0},
                     {"t": 0.7, "opacity": 1}] + A_OUT))
els.append(shape("a-ball", "ellipse", 1576, 306, 48, 48, CORAL,
                 kf=[{"t": 0, "y": 306, "opacity": 0},
                     {"t": 0.13, "y": 306, "opacity": 1},
                     {"t": 1.4, "y": 538, "opacity": 1, "easing": "spring(9,180,1)"}] + A_OUT))
# —— 段 B：EASING（滑入词 + 贝塞尔曲线 draw，frame 54 起）——
els.append(txt("b-word", 150, 350, 1100, 200, "EASING", 176, TEXT, 800, DISPLAY, lh=1,
               kf=[{"t": 0, "x": -70, "opacity": 0},
                   {"t": 1.8, "x": -70, "opacity": 0},
                   {"t": 2.67, "x": 150, "opacity": 1, "easing": BEZ}] + B_OUT))
els.append(txt("b-cap", 156, 560, 760, 40, "Easing.bezier(0.16, 1, 0.3, 1)", 28, AMBER,
               400, MONO,
               kf=[{"t": 0, "opacity": 0}, {"t": 2.13, "opacity": 0},
                   {"t": 2.67, "opacity": 1}] + B_OUT))
bx, by, bs = 1360, 300, 340.0
svg_bez = (
    f'<svg viewBox="0 0 340 340" width="100%" height="100%">'
    f'<rect x="30" y="30" width="280" height="280" fill="none" stroke="{TEXT}22" stroke-width="2"/>'
    f'<line x1="30" y1="310" x2="310" y2="30" stroke="{TEXT}2E" stroke-width="2" stroke-dasharray="6 8"/>'
    f'<line x1="30" y1="310" x2="74.8" y2="30" stroke="{AMBER}88" stroke-width="2"/>'
    f'<line x1="310" y1="30" x2="114" y2="30" stroke="{AMBER}88" stroke-width="2"/>'
    f'<circle cx="74.8" cy="30" r="7" fill="{AMBER}"/>'
    f'<circle cx="114" cy="30" r="7" fill="{AMBER}"/>'
    f'<path d="M30 310 C74.8 30, 114 30, 310 30" fill="none" stroke="{TEAL}" stroke-width="6" stroke-linecap="round"/>'
    f'<circle cx="30" cy="310" r="8" fill="{TEXT}"/>'
    f'<circle cx="310" cy="30" r="8" fill="{TEXT}"/>'
    f'</svg>'
)
els.append({"id": "b-svg", "type": "svg", "x": bx, "y": by, "w": bs, "h": bs,
            "markup": svg_bez,
            "fx": fx_in("fade", 0.6, 1.93),
            "draw": {"dur": 1.13, "delay": 2.07, "easing": BEZIO},
            "keyframes": B_OUT})
def _bezp(p):
    mt = 1 - p
    return (mt**3 * 30 + 3 * mt**2 * p * 74.8 + 3 * mt * p**2 * 114 + p**3 * 310,
            mt**3 * 310 + 3 * mt**2 * p * 30 + 3 * mt * p**2 * 30 + p**3 * 30)
dot_kf = [{"t": 0, "opacity": 0}]
for i in range(6):
    t = 2.07 + i * (1.13 / 5)
    px, py = _bezp(i / 5)
    dot_kf.append({"t": round(t, 2), "x": round(bx + px - 11, 1),
                   "y": round(by + py - 11, 1), "opacity": 1})
dot_kf += B_OUT
els.append(shape("b-dot", "ellipse", bx + 19, by + 299, 22, 22, CORAL, kf=dot_kf))
# —— 段 C：INTERPOLATE（逐字入场 + t 计数 + 进度条，frame 108 起）——
els.append(txt("c-word", 150, 360, 1400, 160, "INTERPOLATE", 128, TEXT, 800, DISPLAY,
               lh=1,
               stagger={"by": "char", "step": 0.04, "delay": 3.63, "dur": 0.9,
                        "dx": 40, "easing": "spring(14,190,0.85)"}))
els.append(txt("c-cap", 156, 540, 800, 40, "interpolate(frame, [0, n], [0, 1])", 28,
               AMBER, 400, MONO, fx=fx_in("fade", 0.5, 3.8)))
els.append(txt("c-tl", 1350, 380, 330, 40, "t =", 30, TEXT + "80", 400, MONO,
               align="right", fx=fx_in("fade", 0.4, 3.67)))
els.append(txt("c-tv", 1350, 420, 330, 110, "1.000", 92, AMBER, 600, MONO, lh=1.1,
               align="right",
               fx={"enter": "fade", "enterDur": 0.4, "delay": 3.67,
                   "countUp": True, "countUpDur": 1.33}))
els.append(shape("c-pbg", "rect", 1350, 566, 420, 6, TEXT + "1F",
                 fx=fx_in("fade", 0.4, 3.67)))
els.append(shape("c-pfill", "rect", 1350, 566, 420, 6, TEAL, origin="left",
                 kf=[{"t": 0, "scale": 0, "opacity": 0},
                     {"t": 3.67, "scale": 0, "opacity": 1},
                     {"t": 5, "scale": 1, "opacity": 1, "easing": "linear"}]))
els += scene_label("02", "KINETIC TYPE", "three timing primitives, live", TEAL)
S2 = {"id": "s2", "duration": 5, "transition": "slide-left", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.4, "end": 4.6, "text": "三大时序原语同场景连演：spring / bezier / interpolate"}],
      "elements": els}

# ---------------------------------------------------------------- S3 THREE.JS (6s)

els = ambient()
# 描边大字 backdrop
els.append(txt("backdrop", 1300, 40, 660, 500, "3D", 470, "transparent", 900, DISPLAY,
               lh=1, stroke={"width": 2, "color": TEXT + "17", "fill": "none"},
               fx=fx_in("fade", 1.0, 0)))
# package chip
els.append(shape("chip-bg", "rect", 120, 150, 560, 48, TEAL + "14", stroke=TEAL + "66",
                 sw=1, fx=fx_in("fade-up", 0.47, 0.53)))
els.append(txt("chip", 140, 150, 540, 48, "@remotion/three · react-three-fiber", 26,
               TEXT, 400, MONO, valign="middle", fx=fx_in("fade-up", 0.47, 0.53)))
CX, CY = 960, 520
# 真 3D 场景（three 元素，vendored three.js r170）——参数逐项对齐原版：
# torusKnot(1.25,0.4) 琥珀金属 + icosahedron(2.75,1) 青线框呼吸 + 10 轨道卫星，
# 灯光：ambient 0.55 / directional(6,6,6) 1.15 / point(-5,-3,4) 60 琥珀。
# 速度换算：原版 rad/frame × 30 = rad/s。
els.append({
    "id": "tk3d", "type": "three", "x": 0, "y": 0, "w": W, "h": H,
    "scene": {
        "camera": {"position": [0, 0, 7.6], "fov": 45},
        "lights": [
            {"type": "ambient", "intensity": 0.55},
            {"type": "directional", "position": [6, 6, 6], "intensity": 1.15},
            {"type": "point", "position": [-5, -3, 4], "intensity": 60, "color": AMBER},
        ],
        "group": {"rotation": [0, 0.12, 0]},
        "objects": [
            {"type": "torusKnot", "args": [1.25, 0.4, 240, 32],
             "material": {"kind": "standard", "color": AMBER, "metalness": 0.65,
                          "roughness": 0.22},
             "rotation": [0.18, 0.27, 0.09]},
            {"type": "icosahedron", "args": [2.75, 1],
             "material": {"kind": "basic", "color": TEAL, "wireframe": True,
                          "opacity": 0.32},
             "rotation": [-0.09, -0.15, 0],
             "scalePulse": {"amp": 0.05, "speed": 1.5}},
            {"type": "orbiters", "count": 10, "radius": 3.35, "speed": 0.9,
             "yWave": {"freq": 1.7, "amp": 0.9},
             "sizes": [0.09, 0.135, 0.18], "colors": [CORAL, TEAL],
             "emissiveIntensity": 0.55},
        ],
    },
    # 入场：相机淡入 [0,18]f + 组缩放 0.55→1 [0,55]f BEZ
    "keyframes": [{"t": 0, "scale": 0.55, "opacity": 0},
                  {"t": 0.6, "opacity": 1},
                  {"t": 1.83, "scale": 1, "easing": BEZ}],
})
els += scene_label("03", "THREE.JS", "useCurrentFrame()-driven · no useFrame()", CORAL)
S3 = {"id": "s3", "duration": 6, "transition": "slide-left", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.5, "end": 5.4, "text": "真 3D：three.js 金属环结 + 线框多面体 + 10 颗轨道卫星（WebGL 逐帧确定性渲染）"}],
      "elements": els}

# ---------------------------------------------------------------- S4 DATA VIZ (6s)

els = ambient()
els.append(txt("vlabel", 140, 130, 600, 34, "TOTAL TIMELINE", 26, TEXT + "80", 400,
               MONO, ls=8, fx=fx_in("fade", 0.47, 0.13)))
els.append(txt("counter", 140, 170, 700, 190, "1080", 168, AMBER, 800, DISPLAY, lh=1.05,
               fx={"enter": "fade", "enterDur": 0.5, "delay": 0.6,
                   "countUp": True, "countUpDur": 4.4}))
els.append(txt("csub", 140, 368, 600, 34, "FRAMES · 36 SECONDS", 26, TEXT + "B3", 400,
               MONO, ls=6, fx=fx_in("fade", 0.5, 0.4)))
# 右侧柱状图：shape 柱 + origin bottom + scaleY spring + countUp 标签 + ramp 色
BARS = [42, 68, 55, 90, 74, 96, 61, 83]
els.append(txt("blabel", 1070, 190, 700, 32, "RENDER BUDGET / SCENE", 24, TEXT + "80",
               400, MONO, ls=6, fx=fx_in("fade", 0.47, 0.2)))
BASE_Y = 662
for g in (0.25, 0.5, 0.75):
    els.append(shape(f"grid{g}", "line", 1070, BASE_Y - 420 * g, 700, 2,
                     TEXT + "26", stroke=TEXT + "26", sw=1, direction="right",
                     fx=fx_in("fade", 0.4, 0.2)))
els.append(shape("axis", "rect", 1070, BASE_Y, 700, 2, TEXT + "40",
                 fx=fx_in("fade", 0.4, 0.2)))
band = (700 - 16) / 8
for i, v in enumerate(BARS):
    bw = band * 0.72
    x = 1070 + 8 + i * band + (band - bw) / 2
    h = v / 100 * 380
    y = BASE_Y - h
    d0 = 0.53 + i * 0.133
    els.append(shape(f"bar{i}", "rect", x, y, bw, h, ramp(i / 7), radius=4,
                     origin="bottom",
                     kf=[{"t": 0, "scaleY": 0, "opacity": 0},
                         {"t": round(d0, 2), "scaleY": 0, "opacity": 1},
                         {"t": round(d0 + 1.2, 2), "scaleY": 1, "opacity": 1,
                          "easing": "spring(15,130,1)"}]))
    els.append(txt(f"barv{i}", x - 20, y - 36, bw + 40, 30, str(v), 24, TEXT + "E6",
                   400, MONO, align="center",
                   fx={"enter": "fade", "enterDur": 0.3, "delay": round(d0, 2),
                       "countUp": True, "countUpDur": 1.2}))
    els.append(txt(f"bars{i}", 1070 + 8 + i * band, BASE_Y + 12, band, 26, f"S{i+1}",
                   20, TEXT + "59", 400, MONO, align="center",
                   fx=fx_in("fade", 0.4, 0.3)))
# 左下折线：裸 SVG path draw + 采样点逐个出现
LINE_PTS = [110 - (math.sin(i * 0.55) * 0.5 + 0.5) * 62 - prand(i * 3.3) * 20
            for i in range(26)]
path = " ".join(f"{'M' if i == 0 else 'L'}{20 + i / 25 * 660:.1f} {y:.1f}"
                for i, y in enumerate(LINE_PTS))
els.append(txt("llabel", 150, 706, 700, 32, "FRAME COST (MS)", 24, TEXT + "80", 400,
               MONO, ls=6, fx=fx_in("fade", 0.47, 1.13)))
els.append({"id": "line", "type": "svg", "x": 150, "y": 750, "w": 700, "h": 150,
            "markup": f'<svg viewBox="0 0 700 150" width="100%" height="100%">'
                      f'<path d="{path}" fill="none" stroke="{TEAL}" stroke-width="4" '
                      f'stroke-linecap="round" stroke-linejoin="round"/></svg>',
            "fx": fx_in("fade", 0.47, 1.13),
            "draw": {"dur": 3.2, "delay": 1.47, "easing": BEZIO}})
for i in range(0, 26, 4):
    cx = 20 + i / 25 * 660
    cy = LINE_PTS[i]
    els.append(shape(f"ldot{i}", "ellipse", 150 + cx - 6, 750 + cy - 6, 12, 12, CORAL,
                     fx=fx_in("fade", 0.27, round(2 + i * 0.08, 2))))
els += scene_label("04", "DATA VIZ", "spring + interpolate driven charts", AMBER)
S4 = {"id": "s4", "duration": 6, "transition": "iris", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.5, "end": 5.4, "text": "scaleY 弹簧柱图（origin bottom）+ countUp + 折线 draw 生长"}],
      "elements": els}

# ---------------------------------------------------------------- S5 AUDIO (5s)

els = ambient()
# lightLeak 近似（承上场景 overlay）：暖色光斑淡入淡出
els.append(shape("leak", "ellipse", 1150, -200, 900, 620, "rgba(255,194,75,0.28)",
                 blur=110,
                 kf=[{"t": 0, "opacity": 0.55, "scale": 0.9},
                     {"t": 0.87, "opacity": 0, "scale": 1.1, "easing": BEZ}]))
els.append(txt("t1", 140, 120, 700, 140, "AUDIO", 132, TEXT, 800, DISPLAY, lh=0.98,
               fx=fx_in("fade-up", 0.47, 0.07)))
els.append(txt("t2", 140, 250, 700, 140, "REACTIVE", 132, "transparent", 800, DISPLAY,
               lh=0.98, stroke={"width": 2, "color": TEAL, "fill": "none"},
               fx=fx_in("fade-up", 0.47, 0.14)))
els.append(txt("cap", 140, 420, 800, 34, "useWindowedAudioData() · visualizeAudio()",
               25, AMBER, 400, MONO, ls=2, fx=fx_in("fade", 0.47, 0.53)))
# 波形 strip（确定性平滑路径，draw 生长）
wave_pts = []
for k in range(129):
    x = k / 127 * 1440
    y = 70 + (math.sin(x * 0.02) * 0.5 + math.sin(x * 0.043 + 1.3) * 0.3
              + math.sin(x * 0.11 + 2.1) * 0.2) * 55
    wave_pts.append(f"{'M' if k == 0 else 'L'}{x:.0f} {y:.0f}")
els.append({"id": "wave", "type": "svg", "x": 240, "y": 380, "w": 1440, "h": 140,
            "markup": f'<svg viewBox="0 0 1440 140" width="100%" height="100%">'
                      f'<path d="{" ".join(wave_pts)}" fill="none" stroke="{TEAL}" '
                      f'stroke-width="2.5" opacity="0.85"/></svg>',
            "draw": {"dur": 1.2, "delay": 0.4, "easing": BEZIO}})
# 伪频谱：64 柱 + 镜像 + bass 环（预计算包络，0.2s 采样）
N_BARS = 64
BAR_TOP, BAR_H = 560, 300
band_w = (W - 720 + 5) / N_BARS
spec = []   # spec[i][k] v 值
for i in range(N_BARS):
    col_vals = []
    for k in range(26):
        t = k * 0.2
        beat = 0.5 + 0.5 * math.sin(2 * math.pi * t * 2.0 + i * 0.35)
        rnd = prand(i * 5.7 + math.floor(t * 4) * 1.3)
        v = (0.25 + 0.75 * rnd) * (0.35 + 0.65 * beat)
        if i < 10:
            v *= 1.15
        col_vals.append(min(1.0, max(0.04, v)))
    spec.append(col_vals)
for i in range(N_BARS):
    x = 360 + i * band_w
    kf = []
    for k in range(26):
        kf.append({"t": round(k * 0.2, 1), "scaleY": round(spec[i][k] ** 0.7, 3)})
    els.append(shape(f"sb{i}", "rect", x, BAR_TOP, band_w - 5, BAR_H, ramp(i / 63),
                     radius=3, origin="bottom", kf=kf,
                     fx=fx_in("fade", 0.5, 0.3)))
for i in range(N_BARS):
    x = 360 + i * band_w
    kf = []
    for k in range(26):
        kf.append({"t": round(k * 0.2, 1), "scaleY": round(spec[i][k] ** 0.7 * 0.6, 3)})
    els.append(shape(f"sm{i}", "rect", x, BAR_TOP + BAR_H + 14, band_w - 5, 110,
                     ramp(i / 63), radius=3, origin="top", kf=kf, opacity=0.18,
                     fx=fx_in("fade", 0.5, 0.3)))
# 镜像渐隐罩
els.append(shape("mirror-mask", "rect", 360, BAR_TOP + BAR_H + 14, W - 720, 110, BG,
                 grad={"stops": [{"pos": 0, "color": "rgba(14,26,36,0)"},
                                 {"pos": 0.85, "color": BG}], "angle": 180}))
# bass 环
ring_kf = []
for k in range(26):
    t = round(k * 0.2, 1)
    b = sum(spec[i][k] for i in range(8)) / 8
    ring_kf.append({"t": t, "scale": round(1 + b * 0.55, 3),
                    "opacity": round(0.08 + b * 0.5, 3)})
els.append(shape("ring", "ellipse", CX - 280, 730 - 280, 560, 560, "rgba(0,0,0,0)",
                 stroke=AMBER, sw=2, kf=ring_kf, z=-1))
# 片尾黑渐隐
els.append(shape("fadeout", "rect", 0, 0, W, H, "#000000",
                 kf=[{"t": 0, "opacity": 0}, {"t": 4.67, "opacity": 0},
                     {"t": 5, "opacity": 0.4}], z=900))
els += scene_label("05", "AUDIO", "64-band spectrum · bass-reactive ring", TEAL)
S5 = {"id": "s5", "duration": 5, "transition": "fade", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.4, "end": 4.4, "text": "64 段伪频谱（scaleY 包络）+ 镜像 + bass 环，配乐同步响起"}],
      "elements": els}

# ---------------------------------------------------------------- S6 POST FX (5s)

els = ambient()
els.append(txt("t1", 140, 130, 320, 130, "POST", 118, TEXT, 800, DISPLAY, lh=1,
               fx=fx_in("fade-up", 0.47, 0.07)))
els.append(txt("t2", 480, 130, 200, 130, "FX", 118, CORAL, 800, DISPLAY, lh=1,
               fx=fx_in("fade-up", 0.47, 0.2)))
# 效果清单（active 态 3.07s 切换：双层元素透明度互换）
def fx_row(i, name, note, y, delay, active_first):
    on = [{"t": 0, "opacity": 1}, {"t": 3.07, "opacity": 1}, {"t": 3.15, "opacity": 0}]
    off = [{"t": 0, "opacity": 0}, {"t": 3.07, "opacity": 0}, {"t": 3.15, "opacity": 1}]
    ka, kb = (on, off) if active_first else (off, on)
    rows = [
        shape(f"fxglow{i}", "ellipse", 140, y + 8, 28, 28, AMBER, blur=10,
              fx=fx_in("fade", 0.4, delay), kf=ka),
        shape(f"fxdot{i}a", "ellipse", 146, y + 14, 16, 16, AMBER,
              fx=fx_in("zoom", 0.4, delay), kf=ka),
        shape(f"fxdot{i}i", "ellipse", 146, y + 14, 16, 16, TEXT + "33",
              kf=kb),
        txt(f"fxname{i}a", 182, y, 460, 44, name, 34, TEXT, 600, MONO,
            fx=fx_in("slide-left", 0.4, delay), kf=ka),
        txt(f"fxname{i}i", 182, y, 460, 44, name, 34, TEXT + "73", 600, MONO, kf=kb),
        txt(f"fxnote{i}a", 182, y + 46, 560, 28, note, 21, TEAL + "D9", 400, MONO,
            fx=fx_in("fade", 0.4, delay + 0.1), kf=ka),
        txt(f"fxnote{i}i", 182, y + 46, 560, 28, note, 21, TEXT + "4D", 400, MONO, kf=kb),
    ]
    return rows
els += fx_row(0, "glitchShift()", "custom · createEffect() · 2d backend", 360, 0.4, True)
els += fx_row(1, "lightLeak()", "@remotion/effects · webgl2 pipeline", 470, 0.73, False)
# 面板：testsrc2 风 SVG pattern
PX, PY, PW, PH = 760, 210, 1020, 574
bars7 = ["#c8c8c8", "#c8c832", "#32c8c8", "#32c832", "#c832c8", "#c83232", "#3232c8"]
bars_svg = "".join(
    f'<rect x="{60 + i * 128}" y="{PH - 110}" width="128" height="90" fill="{c}"/>'
    for i, c in enumerate(bars7))
grid_svg = "".join(
    f'<line x1="{x}" y1="0" x2="{x}" y2="{PH}" stroke="{TEXT}12" stroke-width="1"/>'
    for x in range(100, PW, 100)) + "".join(
    f'<line x1="0" y1="{y}" x2="{PW}" y2="{y}" stroke="{TEXT}12" stroke-width="1"/>'
    for y in range(100, PH, 100))
pattern_svg = (
    f'<svg viewBox="0 0 {PW} {PH}" width="100%" height="100%">'
    f'<rect width="{PW}" height="{PH}" fill="#0d1622"/>'
    f'{grid_svg}'
    f'<circle cx="{PW/2}" cy="{PH/2 - 20}" r="150" fill="none" stroke="{TEXT}55" stroke-width="2"/>'
    f'<circle cx="{PW/2}" cy="{PH/2 - 20}" r="100" fill="none" stroke="{TEAL}66" stroke-width="1.5"/>'
    f'<line x1="{PW/2 - 180}" y1="{PH/2 - 20}" x2="{PW/2 + 180}" y2="{PH/2 - 20}" stroke="{TEXT}55" stroke-width="2"/>'
    f'<line x1="{PW/2}" y1="{PH/2 - 200}" x2="{PW/2}" y2="{PH/2 + 160}" stroke="{TEXT}55" stroke-width="2"/>'
    f'<text x="40" y="56" font-family="monospace" font-size="34" fill="{TEXT}AA" letter-spacing="6">TESTSRC2</text>'
    f'<text x="{PW - 40}" y="56" font-family="monospace" font-size="26" fill="{TEAL}AA" text-anchor="end">1920 × 1080</text>'
    f'{bars_svg}'
    f'</svg>'
)
els.append(shape("panel", "rect", PX, PY, PW, PH, "rgba(13,22,34,0.9)", radius=6,
                 stroke=TEXT + "2E", sw=1, fx=fx_in("fade", 0.47, 0.13)))
els.append({"id": "pattern", "type": "svg", "x": PX, "y": PY, "w": PW, "h": PH,
            "markup": pattern_svg, "fx": fx_in("fade", 0.47, 0.13)})
# glitch 切片：0.27-2.93s 窗口内横向抖动（amount 升-持-降）
def glitch_amount(t):
    if t < 0.27 or t > 2.93:
        return 0.0
    if t < 1.27:
        return (t - 0.27) / 1.0
    if t < 2.2:
        return 1.0
    return max(0.0, 1 - (t - 2.2) / 0.73)
for i in range(7):
    gy = PY + 40 + prand(i * 3.7) * (PH - 120)
    gh = 8 + prand(i * 7.1) * 18
    gw = 150 + prand(i * 5.3) * 380
    gx = PX + prand(i * 9.7) * (PW - gw)
    col = [TEAL, CORAL, "#ffffff", AMBER][i % 4]
    kf = [{"t": 0, "x": gx, "opacity": 0}]
    steps = 22
    for k in range(steps + 1):
        t = 0.27 + k * (2.93 - 0.27) / steps
        a = glitch_amount(t)
        jit = (prand(i * 13.3 + k * 7.7) - 0.5) * 170 * a
        kf.append({"t": round(t, 2), "x": round(gx + jit, 1),
                   "opacity": round(0.45 * a, 3)})
    kf.append({"t": 3.0, "opacity": 0})
    els.append(shape(f"slice{i}", "rect", gx, gy, gw, gh, col, kf=kf))
# lightLeak 光斑（3.2s 起扫入）
els.append(shape("leak1", "ellipse", 1250, 330, 700, 500, "rgba(255,107,87,0.32)",
                 blur=90,
                 kf=[{"t": 0, "opacity": 0, "scale": 0.8, "x": 1450, "y": 430},
                     {"t": 3.2, "opacity": 0, "scale": 0.8, "x": 1450, "y": 430},
                     {"t": 4.6, "opacity": 0.6, "scale": 1.1, "x": 1150, "y": 280,
                      "easing": "bezier(0.4,0,0.2,1)"},
                     {"t": 5, "opacity": 0.65, "scale": 1.15, "x": 1100, "y": 260}]))
els.append(shape("leak2", "ellipse", 900, 100, 460, 340, "rgba(255,194,75,0.22)",
                 blur=80,
                 kf=[{"t": 0, "opacity": 0}, {"t": 3.5, "opacity": 0},
                     {"t": 4.9, "opacity": 0.5, "easing": "bezier(0.4,0,0.2,1)"}]))
# 面板角标（琥珀，外扩 14px）
for ci, (cx, cy) in enumerate([(PX - 14, PY - 14), (PX + PW + 14, PY - 14),
                               (PX - 14, PY + PH + 14), (PX + PW + 14, PY + PH + 14)]):
    hx = cx if ci % 2 == 0 else cx - 30
    vy = cy if ci < 2 else cy - 30
    els.append(shape(f"tick{ci}h", "rect", hx, vy if ci < 2 else cy - 3 + 3, 30, 3,
                     AMBER, fx=fx_in("fade", 0.4, 0.2)))
    els.append(shape(f"tick{ci}v", "rect", cx if ci % 2 == 0 else cx - 3,
                     vy, 3, 30, AMBER, fx=fx_in("fade", 0.4, 0.2)))
# 扫描进度条
els.append(txt("src-label", 760, 810, 300, 30, "SOURCE: TESTSRC2", 22, TEXT + "80",
               400, MONO, ls=4, fx=fx_in("fade", 0.4, 0.3)))
els.append(shape("scan-bg", "rect", 1060, 823, 510, 3, TEXT + "1F",
                 fx=fx_in("fade", 0.4, 0.3)))
els.append(shape("scan-teal", "rect", 1060, 823, 510, 3, TEAL, origin="left",
                 kf=[{"t": 0, "scale": 0, "opacity": 0},
                     {"t": 3.07, "scale": 0.614, "opacity": 0, "easing": "linear"},
                     {"t": 3.15, "scale": 0.622, "opacity": 1},
                     {"t": 5, "scale": 1, "opacity": 1, "easing": "linear"}]))
els.append(shape("scan-coral", "rect", 1060, 823, 510, 3, CORAL, origin="left",
                 kf=[{"t": 0, "scale": 0, "opacity": 1},
                     {"t": 3.07, "scale": 0.614, "opacity": 1, "easing": "linear"},
                     {"t": 3.15, "scale": 0.614, "opacity": 0}]))
els.append(txt("readout-g", 1590, 810, 220, 30, "GLITCH 100%", 22, AMBER, 400, MONO,
               fx={"enter": "fade", "enterDur": 0.3, "delay": 0.4,
                   "countUp": True, "countUpDur": 1.0},
               kf=[{"t": 0, "opacity": 1}, {"t": 3.07, "opacity": 1},
                   {"t": 3.15, "opacity": 0}]))
els.append(txt("readout-l", 1590, 810, 220, 30, "LEAK 100%", 22, AMBER, 400, MONO,
               fx={"enter": "fade", "enterDur": 0.3, "delay": 3.2,
                   "countUp": True, "countUpDur": 1.4},
               kf=[{"t": 0, "opacity": 0}, {"t": 3.15, "opacity": 0},
                   {"t": 3.3, "opacity": 1}]))
els += scene_label("06", "POST FX", "glitch slices + light leak", CORAL)
S6 = {"id": "s6", "duration": 5, "transition": "zoom", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.4, "end": 4.4, "text": "glitch 切片抖动 → lightLeak 光斑扫入，清单 active 态联动切换"}],
      "elements": els}

# ---------------------------------------------------------------- S7 OUTRO (5s)

els = ambient()
# 粒子爆发（60 颗，spring(26,110) 过阻尼飞出，结尾淡出）
for i in range(60):
    ang = i * 2.39996 + prand(i) * 0.6
    dist = (0.2 + 0.8 * prand(i * 7.7)) * 640
    size = 3 + prand(i * 4.9) * 7
    col = ramp(prand(i * 2.1))
    ex = 960 + math.cos(ang) * dist
    ey = 480 + math.sin(ang) * dist * 0.72
    rot = (prand(i * 9.3) - 0.5) * 360
    op0 = 0.35 + prand(i * 13.1) * 0.65
    kind = "rect" if i % 4 == 0 else "ellipse"
    els.append(shape(f"p{i}", kind, 960, 480, size, size, col,
                     kf=[{"t": 0, "x": 960, "y": 480, "scale": 0, "opacity": 0, "rotation": 0},
                         {"t": 0.33, "x": 960, "y": 480, "scale": 0, "opacity": 0, "rotation": 0},
                         {"t": 0.55, "x": 960, "y": 480, "scale": 1, "opacity": op0, "rotation": 0},
                         {"t": 1.9, "x": round(ex, 1), "y": round(ey, 1), "scale": 1,
                          "opacity": op0, "rotation": round(rot, 1), "easing": "spring(26,110,1)"},
                         {"t": 4.13, "x": round(ex, 1), "y": round(ey, 1), "opacity": op0},
                         {"t": 4.93, "x": round(ex, 1), "y": round(ey, 1), "opacity": 0}]))
els.append(txt("madewith", 0, 380, W, 44, "MADE WITH", 32, TEXT + "A6", 400, MONO,
               align="center", ls=22, fx=fade_both("fade-up", 0.47, 0.2, 0.8)))
els.append(txt("title", 0, 446, W, 220, "VEDIO STUDIO", 196, TEXT, 900, DISPLAY,
               align="center", valign="middle", lh=1,
               stagger={"by": "char", "step": 0.073, "delay": 0.4, "dur": 1.0,
                        "dy": 90, "scaleFrom": 0.4, "easing": "spring(14,190,0.85)"},
               fx=fx_out("fade-out", 0.8)))
els.append(txt("dot", 1668, 446, 120, 220, ".", 196, AMBER, 900, DISPLAY,
               valign="middle", fx=fade_both("fade", 0.34, 1.33, 0.8)))
MARQ = ("SPRING PHYSICS", "KEYFRAMES", "TRANSITIONS", "COUNTUP", "CHARTS",
        "CAPTIONS", "WEBCODECS EXPORT", "NO FFMPEG")
marq_html = ("&nbsp;&nbsp;<span style=\"color:" + AMBER + "\">·</span>&nbsp;&nbsp;") .join(MARQ * 2)
els.append(txt("marquee", 0, 872, 6000, 44, marq_html, 30, TEXT + "73", 400, MONO,
               ls=4, fx=fx_out("fade-out", 0.8),
               kf=[{"t": 0, "x": 40, "opacity": 0},
                   {"t": 1.13, "x": 40, "opacity": 0},
                   {"t": 1.6, "x": 40, "opacity": 0.8},
                   {"t": 5, "x": -380, "opacity": 0.8, "easing": "linear"}]))
els.append(txt("footer", 0, 938, W, 34,
               "VEDIO STUDIO — 1920 × 1080 · 30 FPS — 浏览器里的视频工作台",
               24, TEXT + "59", 400, MONO, align="center", ls=6,
               fx=fade_both("fade", 0.53, 1.6, 0.8)))
S7 = {"id": "s7", "duration": 5, "transition": "fade", "transitionIn": 0.6,
      "background": GRID,
      "captions": [{"start": 0.4, "end": 1.5, "text": "60 粒子 spring 爆发 + 逐字 scaleFrom 入场 + 走马灯"}],
      "elements": els}

# ---------------------------------------------------------------- music.wav（S5 配乐）

def gen_music(path, dur=5.3, sr=44100):
    """Am 氛围 pad + 低频脉冲 + 琶音，5.3s，给 S5 Audio 场景用"""
    n = int(dur * sr)
    pad_notes = [110.0, 130.81, 164.81]              # A2 C3 E3
    arp_notes = [220.0, 261.63, 329.63, 440.0, 329.63, 261.63]
    frames = bytearray()
    for k in range(n):
        t = k / sr
        v = 0.0
        # pad（慢起音）
        a_env = min(1.0, t / 1.5)
        for f in pad_notes:
            v += 0.06 * a_env * math.sin(2 * math.pi * f * t)
        # 低频脉冲（每 0.5s 指数衰减）
        bt = t % 0.5
        v += 0.42 * math.sin(2 * math.pi * 55 * t) * math.exp(-bt * 9)
        # 琶音（八分音符，方波感）
        step = int(t / 0.25) % len(arp_notes)
        f = arp_notes[step]
        st = t % 0.25
        a_env2 = math.exp(-st * 7)
        v += 0.10 * a_env2 * (math.sin(2 * math.pi * f * t)
                              + 0.3 * math.sin(2 * math.pi * f * 3 * t))
        # 全局淡入淡出
        g = min(1.0, t / 0.3) * min(1.0, (dur - t) / 1.0)
        v *= g * 0.9
        frames += struct.pack("<h", int(max(-1, min(1, v)) * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(bytes(frames))

# ---------------------------------------------------------------- doc

TOTAL = 4 + 5 + 6 + 6 + 5 + 5 + 5
doc = {
    "format": "video/1",
    "version": 1,
    "title": "Showreel · 引擎能力巡礼",
    "size": {"width": W, "height": H},
    "fps": FPS,
    "theme": {
        "background": BG,
        "color": TEXT,
        "accent": TEAL,
        "fontFamily": DISPLAY,
        "captionStyle": {
            "fontSize": 30, "color": "#ffffff", "stroke": "#000000", "strokeWidth": 3,
            "background": "rgba(0,0,0,0.5)", "bottom": 120,
        },
    },
    "music": {"src": "assets/music.wav", "volume": 0.85, "loop": False, "offset": 21},
    "overlay": hud_overlay(TOTAL),
    "scenes": [S1, S2, S3, S4, S5, S6, S7],
}

out_dir = os.path.expanduser("~/.cache/aic/agents/vedio_studio/ui/cases/showreel")
os.makedirs(os.path.join(out_dir, "assets"), exist_ok=True)
nels = sum(len(s["elements"]) for s in doc["scenes"])
# 拆分存档：每个场景一个 scenes/scene_N.json，index.json 只留元信息 + 引用数组
# （对齐 ppt_studio 分页拆分；页面加载/保存自动按引用组装/写回）
scenes_dir = os.path.join(out_dir, "scenes")
os.makedirs(scenes_dir, exist_ok=True)
for i, s in enumerate(doc["scenes"], 1):
    with open(os.path.join(scenes_dir, f"scene_{i}.json"), "w") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
doc["scenes"] = [f"scenes/scene_{i}.json" for i in range(1, len(doc["scenes"]) + 1)]
with open(os.path.join(out_dir, "index.json"), "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
gen_music(os.path.join(out_dir, "assets", "music.wav"))
print(f"scenes={len(doc['scenes'])} duration={TOTAL}s "
      f"elements={nels}(+{len(doc['overlay'])} hud) "
      f"json={os.path.getsize(os.path.join(out_dir, 'index.json'))}B "
      f"wav={os.path.getsize(os.path.join(out_dir, 'assets', 'music.wav'))}B")
