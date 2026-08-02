#!/usr/bin/env python3
"""generate showreel case (video/1) — remotion Showreel 复刻（引擎升级后版本）
使用：真实 spring 物理 / bezier 缓动 / 逐字 stagger / svg draw / kfLoop 环境动画"""
import json, math, os

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

def txt(id, x, y, w, h, html, size, color=TEXT, weight=400, font=None, align="left",
        valign="top", ls=None, fx=None, kf=None, lh=1.0, opacity=None, stagger=None, loop=None):
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
    return el

def shape(id, kind, x, y, w, h, fill, radius=None, fx=None, kf=None, stroke=None,
          sw=None, opacity=None, grad=None, direction=None, loop=None):
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
    return el

def fx_in(kind="fade-up", dur=0.7, delay=0.2, easing=None):
    f = {"enter": kind, "enterDur": dur, "delay": delay}
    if easing: f["enterEasing"] = easing
    return f

def scene_label(idx, label, caption, accent=AMBER):
    return [
        shape("sl-bar", "rect", 120, 944, 3, 64, accent, fx=fx_in("fade", 0.5, 0.35)),
        txt("sl-idx", 140, 944, 60, 36, idx, 28, accent, 600, MONO, fx=fx_in("slide-right", 0.5, 0.35)),
        txt("sl-label", 200, 947, 700, 34, label, 26, TEXT + "D9", 400, MONO, ls=8, fx=fx_in("slide-right", 0.5, 0.4)),
        txt("sl-cap", 140, 992, 800, 28, caption, 20, TEXT + "66", 400, MONO, ls=2, fx=fx_in("slide-right", 0.5, 0.45)),
    ]

def ambient(seed=0):
    """环境动画层：漂移洗层 + 上升尘埃（kfLoop）"""
    els = [
        shape("wash-teal", "ellipse", 1250, -260, 900, 620, "rgba(78,205,196,0.10)",
              kf=[{"t": 0, "x": 1250, "y": -260},
                  {"t": 4.5, "x": 1180, "y": -200, "easing": "easeInOut"},
                  {"t": 9, "x": 1250, "y": -260, "easing": "easeInOut"}], loop=True),
        shape("wash-amber", "ellipse", -280, 780, 980, 640, "rgba(255,194,75,0.08)",
              kf=[{"t": 0, "x": -280, "y": 780},
                  {"t": 5.5, "x": -200, "y": 720, "easing": "easeInOut"},
                  {"t": 11, "x": -280, "y": 780, "easing": "easeInOut"}], loop=True),
    ]
    cols = [AMBER, CORAL, TEAL]
    for i in range(16):
        x = (i * 137.5) % W
        d = 7 + (i * 31 % 50) / 10.0          # 7-12s 各异
        op = 0.12 + (i * 17 % 22) / 100.0
        size = 3 + (i * 13 % 4)
        els.append(shape(f"dust{i}", "ellipse", x, H + 20, size, size, cols[i % 3], opacity=op,
                         kf=[{"t": 0, "y": H + 20, "opacity": 0},
                             {"t": round(d * 0.12, 2), "y": round(H * 0.75, 1), "opacity": op},
                             {"t": round(d * 0.88, 2), "y": round(H * 0.18, 1), "opacity": op},
                             {"t": d, "y": -30, "opacity": 0}], loop=True))
    return els

# ---------------------------------------------------------------- scenes
scenes = []

# ---- S1 TITLE (4.5s) —— 逐字 spring stagger（原片核心 look）----
els = ambient()
els.append(shape("glow", "ellipse", 360, 240, 1200, 560, "rgba(255,194,75,0.10)",
                 kf=[{"t": 0, "scale": 0.6, "opacity": 0},
                     {"t": 1.4, "scale": 1, "opacity": 1, "easing": BEZ}]))
els.append(shape("tag-bar", "rect", 120, 150, 3, 36, CORAL, fx=fx_in("fade", 0.4, 0.45)))
els.append(txt("tag", 140, 148, 600, 40, "REACT VIDEO TOOLKIT", 24, TEXT + "B3", 400, MONO,
               ls=6, fx=fx_in("slide-right", 0.5, 0.45)))
els.append(txt("title", 0, 380, W, 210, "REMOTION", 172, TEXT, 800, DISPLAY,
               align="center", valign="middle", lh=1,
               stagger={"by": "char", "step": 0.083, "delay": 0.27, "dur": 1.0,
                        "dy": 120, "rotation": 10, "easing": "spring(13,170,0.9)"}))
els.append(shape("underline", "rect", 650, 640, 620, 10, TEAL,
                 kf=[{"t": 0, "scale": 0, "opacity": 1},
                     {"t": 1.15, "scale": 0, "opacity": 1},
                     {"t": 1.85, "scale": 1, "opacity": 1, "easing": BEZ}]))
els.append(txt("subtitle", 0, 700, W, 52, "REACT → VIDEO", 32, TEXT + "B3", 400, MONO,
               align="center", valign="middle", ls=16, fx=fx_in("fade-up", 0.8, 1.7)))
els += scene_label("01", "TITLE", "spring() stagger · Easing.bezier()")
scenes.append({"id": "s1", "duration": 4.5, "transition": "none", "transitionIn": 0.7,
               "background": GRID,
               "captions": [{"start": 0.8, "end": 3.8, "text": "逐字 spring 物理入场（过冲回弹）"}],
               "elements": els})

# ---- S2 SPRING (3.5s) ----
els = ambient()
els.append(txt("word", 150, 350, 1100, 200, "SPRING", 176, TEXT, 800, DISPLAY, lh=1,
               fx=fx_in("fade-up", 0.8, 0.2, "spring(12,150,1)")))
els.append(txt("cap", 156, 570, 700, 40, "Easing.spring({ damping: 9 })", 28, AMBER, 400, MONO,
               fx=fx_in("fade", 0.6, 0.5)))
els.append(txt("seg", 1640, 120, 160, 130, "01", 110, TEAL, 600, MONO, align="left",
               fx=fx_in("fade", 0.5, 0.15)))
els.append(txt("seg2", 1650, 260, 150, 34, "/ 03", 26, TEXT + "66", 400, MONO, ls=6,
               fx=fx_in("fade", 0.5, 0.2)))
els.append(shape("track", "rect", 1598, 330, 4, 280, TEXT + "26", fx=fx_in("fade", 0.4, 0.3)))
els.append(shape("base", "rect", 1560, 606, 80, 4, TEAL, fx=fx_in("fade", 0.4, 0.3)))
els.append(shape("ball", "ellipse", 1576, 326, 48, 48, CORAL,
                 kf=[{"t": 0, "y": 326, "opacity": 0},
                     {"t": 0.35, "y": 326, "opacity": 1},
                     {"t": 1.5, "y": 558, "opacity": 1, "easing": "spring(9,180,1)"},
                     {"t": 3.5, "y": 558, "opacity": 1}]))
els += scene_label("02", "KINETIC TYPE", "three timing primitives, live", TEAL)
scenes.append({"id": "s2", "duration": 3.5, "transition": "slide-left", "transitionIn": 0.6,
               "background": GRID,
               "captions": [{"start": 0.5, "end": 3.0, "text": "spring(9,180,1)：与原片同参数的小球"}],
               "elements": els})

# ---- S3 EASING (3.5s) —— 贝塞尔曲线 draw 生长 ----
els = ambient()
els.append(txt("word", 150, 350, 1100, 200, "EASING", 176, TEXT, 800, DISPLAY, lh=1,
               fx=fx_in("slide-right", 0.8, 0.2, BEZ)))
els.append(txt("cap", 156, 570, 760, 40, "Easing.bezier(0.16, 1, 0.3, 1)", 28, AMBER, 400, MONO,
               fx=fx_in("fade", 0.6, 0.5)))
els.append(txt("seg", 1640, 120, 160, 130, "02", 110, TEAL, 600, MONO,
               fx=fx_in("fade", 0.5, 0.15)))
els.append(txt("seg2", 1650, 260, 150, 34, "/ 03", 26, TEXT + "66", 400, MONO, ls=6,
               fx=fx_in("fade", 0.5, 0.2)))
bx, by, bs = 1330, 300, 340.0
svg = (
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
els.append({"id": "bezier", "type": "svg", "x": bx, "y": by, "w": bs, "h": bs,
            "markup": svg, "fx": fx_in("fade", 0.5, 0.4),
            "draw": {"dur": 1.8, "delay": 0.6, "easing": BEZIO}})
def bez(p):
    mt = 1 - p
    x = mt**3 * 30 + 3 * mt**2 * p * 74.8 + 3 * mt * p**2 * 114 + p**3 * 310
    y = mt**3 * 310 + 3 * mt**2 * p * 30 + 3 * mt * p**2 * 30 + p**3 * 30
    return x, y
kf = []
for i, t in enumerate([0.6, 1.05, 1.5, 1.95, 2.4]):
    p = (t - 0.6) / 1.8
    px, py = bez(p)
    point = {"t": t, "x": round(bx + px - 11, 1), "y": round(by + py - 11, 1), "opacity": 1}
    if i == 0:
        point["opacity"] = 0
    kf.append(point)
els.append(shape("dot", "ellipse", 0, 0, 22, 22, CORAL, kf=kf))
els += scene_label("03", "KINETIC TYPE", "bezier curve, drawn live", TEAL)
scenes.append({"id": "s3", "duration": 3.5, "transition": "slide-left", "transitionIn": 0.6,
               "background": GRID,
               "captions": [{"start": 0.5, "end": 3.0, "text": "draw 描边生长 + 同步采样点"}],
               "elements": els})

# ---- S4 INTERPOLATE (4s) —— 逐字交错 + countUp ----
els = ambient()
els.append(txt("word", 150, 360, 1400, 160, "INTERPOLATE", 128, TEXT, 800, DISPLAY, lh=1,
               stagger={"by": "char", "step": 0.045, "delay": 0.25, "dur": 0.9,
                        "dy": 90, "easing": "spring(14,190,0.85)"}))
els.append(txt("cap", 156, 560, 800, 40, "interpolate(frame, [0, n], [0, 1])", 28, AMBER,
               400, MONO, fx=fx_in("fade", 0.6, 0.7)))
els.append(txt("tlabel", 1450, 380, 100, 40, "t =", 30, TEXT + "80", 400, MONO,
               fx=fx_in("fade", 0.5, 0.5)))
els.append(txt("tval", 1450, 420, 330, 110, "1.000", 92, AMBER, 600, MONO, lh=1.1,
               fx={"enter": "fade", "enterDur": 0.5, "delay": 0.5, "countUp": True, "countUpDur": 2.6}))
els.append(shape("pbg", "rect", 1350, 566, 420, 6, TEXT + "1F", fx=fx_in("fade", 0.5, 0.5)))
els.append(shape("pfill", "rect", 1350, 566, 420, 6, TEAL,
                 kf=[{"t": 0.5, "scale": 0, "opacity": 1},
                     {"t": 3.1, "scale": 1, "opacity": 1, "easing": "linear"}]))
els += scene_label("04", "KINETIC TYPE", "interpolate everything", TEAL)
scenes.append({"id": "s4", "duration": 4, "transition": "slide-left", "transitionIn": 0.6,
               "background": GRID,
               "captions": [{"start": 0.6, "end": 3.4, "text": "countUp 数字滚动与进度条"}],
               "elements": els})

# ---- S5 DATA VIZ (5s) —— countUp + 折线 draw ----
els = ambient()
els.append(txt("vlabel", 140, 130, 600, 34, "TOTAL TIMELINE", 26, TEXT + "80", 400, MONO,
               ls=8, fx=fx_in("fade", 0.5, 0.15)))
els.append(txt("counter", 140, 170, 700, 190, "1080", 168, AMBER, 800, DISPLAY, lh=1.05,
               fx={"enter": "fade", "enterDur": 0.5, "delay": 0.2, "countUp": True, "countUpDur": 4.0}))
els.append(txt("csub", 140, 368, 600, 34, "FRAMES · 36 SECONDS", 26, TEXT + "B3", 400, MONO,
               ls=6, fx=fx_in("fade", 0.5, 0.4)))
els.append(txt("blabel", 1100, 160, 700, 32, "RENDER BUDGET / SCENE", 24, TEXT + "80", 400,
               MONO, ls=6, fx=fx_in("fade", 0.5, 0.3)))
els.append({"id": "bars", "type": "chart", "x": 1100, "y": 200, "w": 700, "h": 470,
            "option": {"xAxis": {"data": ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]},
                       "series": [{"type": "bar", "data": [42, 68, 55, 90, 74, 96, 61, 83]}],
                       "color": [TEAL]},
            "fx": fx_in("fade-up", 0.9, 0.35)})
els.append(txt("llabel", 140, 610, 700, 32, "FRAME COST (MS)", 24, TEXT + "80", 400, MONO,
               ls=6, fx=fx_in("fade", 0.5, 0.9)))
els.append({"id": "line", "type": "chart", "x": 140, "y": 650, "w": 700, "h": 220,
            "option": {"xAxis": {"data": [str(i) for i in range(26)]},
                       "series": [{"type": "line",
                                   "data": [round(110 - (math.sin(i * 0.55) * 0.5 + 0.5) * 62 - (i * 7 % 13), 1) for i in range(26)]}],
                       "color": [CORAL],
                       "draw": 2.2, "drawDelay": 1.0},
            "fx": fx_in("fade", 0.9, 0.95)})
els += scene_label("05", "DATA VIZ", "countUp + chart elements", AMBER)
scenes.append({"id": "s5", "duration": 5, "transition": "zoom", "transitionIn": 0.7,
               "background": GRID,
               "captions": [{"start": 0.6, "end": 4.2, "text": "折线 draw 生长 + 采样点逐个出现"}],
               "elements": els})

# ---- S6 POST FX (4s) ----
els = ambient()
els.append(txt("t1", 140, 130, 320, 140, "POST", 118, TEXT, 800, DISPLAY, lh=1,
               fx=fx_in("fade-up", 0.7, 0.15)))
els.append(txt("t2", 448, 130, 180, 140, "FX", 118, CORAL, 800, DISPLAY, lh=1,
               fx=fx_in("fade-up", 0.7, 0.3)))
fx_rows = [("glitchShift()", "custom · createEffect() · 2d backend", 360, 0.45, True),
           ("lightLeak()", "@remotion/effects · webgl2 pipeline", 470, 0.65, False)]
for i, (name, note, y, dl, active) in enumerate(fx_rows):
    els.append(shape(f"fxdot{i}", "ellipse", 146, y + 14, 16, 16, AMBER if active else TEXT + "33",
                     fx=fx_in("zoom", 0.5, dl)))
    els.append(txt(f"fxname{i}", 182, y, 420, 44, name, 34, TEXT if active else TEXT + "73",
                   600, MONO, fx=fx_in("slide-right", 0.5, dl)))
    els.append(txt(f"fxnote{i}", 182, y + 46, 520, 28, note, 21, TEXT + "59", 400, MONO,
                   fx=fx_in("fade", 0.5, dl + 0.1)))
els.append(shape("panel", "rect", 760, 210, 1020, 574, "rgba(14,26,36,0.75)", radius=12,
                 stroke=TEXT + "33", sw=2, fx=fx_in("zoom", 0.8, 0.35)))
for i in range(6):
    y = 260 + i * 82
    els.append(shape(f"scan{i}", "rect", 800, y, 940 - (i % 3) * 120, 5,
                     TEAL if i % 2 == 0 else CORAL, opacity=0.5,
                     kf=[{"t": 0.6, "x": 800, "opacity": 0},
                         {"t": 0.9 + i * 0.12, "x": 800, "opacity": 0.5},
                         {"t": 3.6, "x": 800 - (i % 3) * 60 - 40, "opacity": 0.5}]))
els.append(txt("hex", 800, 700, 900, 40, "01101000 01100101 01101100 01101100 01101111",
               26, CORAL + "99", 400, MONO, fx=fx_in("fade", 0.8, 1.2)))
els += scene_label("06", "POST FX", "createEffect + webgl pipeline", CORAL)
scenes.append({"id": "s6", "duration": 4, "transition": "zoom", "transitionIn": 0.7,
               "background": GRID,
               "captions": [{"start": 0.6, "end": 3.4, "text": "后期特效面板：扫描线与故障文本"}],
               "elements": els})

# ---- S7 OUTRO (4.5s) —— 粒子爆发 + 走马灯 kfLoop ----
els = ambient()
for i in range(14):
    ang = i * (2 * math.pi / 14) + (i * 37 % 10) / 10 * 0.5
    dist = 190 + (i * 53 % 100) / 100 * 260
    ex = 960 + math.cos(ang) * dist
    ey = 500 + math.sin(ang) * dist * 0.72
    col = [AMBER, CORAL, TEAL][i % 3]
    size = 8 + (i * 29 % 10)
    kind = "rect" if i % 4 == 0 else "ellipse"
    els.append(shape(f"p{i}", kind, 960, 500, size, size, col,
                     kf=[{"t": 0.5, "x": 960, "y": 500, "scale": 0, "opacity": 0},
                         {"t": 0.68, "x": 960, "y": 500, "scale": 1, "opacity": 1},
                         {"t": 1.7, "x": round(ex, 1), "y": round(ey, 1), "scale": 1,
                          "opacity": 0.85, "easing": "spring(11,90,0.9)"},
                         {"t": 4.5, "x": round(ex, 1), "y": round(ey, 1), "scale": 1, "opacity": 0.85}]))
els.append(txt("madewith", 0, 320, W, 44, "MADE WITH", 32, TEXT + "A6", 400, MONO,
               align="center", ls=22, fx=fx_in("fade-up", 0.7, 0.25)))
els.append(txt("title", 0, 400, W, 210, "VEDIO STUDIO", 168, TEXT, 900, DISPLAY,
               align="center", valign="middle", lh=1,
               stagger={"by": "char", "step": 0.073, "delay": 0.4, "dur": 1.0,
                        "dy": 110, "rotation": 8, "easing": "spring(14,190,0.85)"}))
els.append(shape("underline", "rect", 560, 660, 800, 8, AMBER,
                 kf=[{"t": 0, "scale": 0, "opacity": 1},
                     {"t": 1.5, "scale": 0, "opacity": 1},
                     {"t": 2.1, "scale": 1, "opacity": 1, "easing": BEZ}]))
els.append(txt("marquee", 400, 740, 2600, 40,
               "SPRING PHYSICS · KEYFRAMES · TRANSITIONS · COUNTUP · CHARTS · CAPTIONS · WEBCODECS EXPORT · NO FFMPEG · ",
               28, TEXT + "66", 400, MONO,
               kf=[{"t": 1.2, "x": 400, "opacity": 0},
                   {"t": 1.6, "x": 400, "opacity": 1},
                   {"t": 7.6, "x": -700, "opacity": 1, "easing": "linear"}], loop=True))
els.append(txt("end-note", 0, 860, W, 40, "浏览器里的视频工作台", 30, TEAL, 400, DISPLAY,
               align="center", fx=fx_in("fade", 0.8, 2.2)))
scenes.append({"id": "s7", "duration": 4.5, "transition": "fade", "transitionIn": 0.7,
               "background": GRID,
               "captions": [{"start": 0.6, "end": 4.0, "text": "粒子 spring 爆发与 kfLoop 走马灯"}],
               "elements": els})

# ---------------------------------------------------------------- doc
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
            "background": "rgba(0,0,0,0.5)", "bottom": 60,
        },
    },
    "scenes": scenes,
}

out = os.path.expanduser("~/.cache/aic/agents/vedio_studio/ui/cases/showreel/index.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)

total = sum(s["duration"] for s in scenes)
nels = sum(len(s["elements"]) for s in scenes)
print(f"written: {out}")
print(f"scenes={len(scenes)} duration={total}s elements={nels} size={os.path.getsize(out)}B")
