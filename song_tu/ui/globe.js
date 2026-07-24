/* ============================================================
   天下舆图 · 国风地球仪
   青花为洋，赭石为陆，朱砂记城。
   用法：createGlobe(container, { cities:[{name,title,subtitle,lng,lat,current}], onPick(city) })
   返回 { focus(name), destroy() }
   依赖本地 vendor：d3.min.js / topojson.min.js / world110m.json（首次按需加载）
============================================================ */
const V = (p) => new URL('./vendor/' + p, import.meta.url).href;

let _libs = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('载入失败: ' + src));
    document.head.appendChild(s);
  });
}
function ensureLibs() {
  if (_libs) return _libs;
  _libs = (async () => {
    if (!window.d3) await loadScript(V('d3.min.js'));
    if (!window.topojson) await loadScript(V('topojson.min.js'));
    const world = await (await fetch(V('world110m.json'))).json();
    return { d3: window.d3, topojson: window.topojson, world };
  })();
  return _libs;
}

/* ---- versor 四元数（球面拖拽旋转） ---- */
const asin = Math.asin, atan2 = Math.atan2, cos = Math.cos, max = Math.max, min = Math.min, PI = Math.PI, sin = Math.sin, sqrt = Math.sqrt, radians = PI / 180, degrees = 180 / PI;
function versor(e) {
  const l = e[0] / 2 * radians, sl = sin(l), cl = cos(l), p = e[1] / 2 * radians, sp = sin(p), cp = cos(p), g = (e[2] || 0) / 2 * radians, sg = sin(g), cg = cos(g);
  return [cl * cp * cg + sl * sp * sg, sl * cp * cg - cl * sp * sg, cl * sp * cg + sl * cp * sg, cl * cp * sg - sl * sp * cg];
}
versor.cartesian = function (e) { const l = e[0] * radians, p = e[1] * radians, cp = cos(p); return [cp * cos(l), cp * sin(l), sin(p)]; };
versor.rotation = function (q) {
  return [
    atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * degrees,
    asin(max(-1, min(1, 2 * (q[0] * q[2] - q[3] * q[1])))) * degrees,
    atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) * degrees
  ];
};
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
versor.delta = function (v0, v1) {
  const w = vdot(v0, v1), v = vcross(v0, v1);
  const q = [1 + w, v[0], v[1], v[2]], l = sqrt(vdot(q, q)) || 1e-9;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
versor.multiply = function (a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
};

const GLOBE_CSS = `
.sg-svg { display:block; width:100%; height:100%; cursor:grab; touch-action:none; }
.sg-svg:active { cursor:grabbing; }
.sg-sphere { filter: drop-shadow(0 6px 30px rgba(90,70,40,.35)); }
.sg-land { transition: fill .15s ease; }
.sg-city text {
  font-family: "Ma Shan Zheng","STKaiti",serif;
  font-size: 15px; fill: #2e2a22;
  paint-order: stroke; stroke: rgba(246,238,214,.92); stroke-width: 3px;
  letter-spacing: .05em;
}
.sg-tip {
  position: absolute; pointer-events: none;
  background: rgba(248,242,222,.97); border: 1px solid #8a734c; border-radius: 6px;
  padding: 6px 14px; transform: translate(-50%,-135%); white-space: nowrap; z-index: 6;
  box-shadow: 0 4px 14px rgba(60,40,20,.25);
}
.sg-tip .n { font-family: "Ma Shan Zheng",cursive; font-size: 19px; color: #2e2a22; letter-spacing: .1em; }
.sg-tip .s { font-size: 11px; color: #8a7a5a; letter-spacing: .18em; margin-top: 1px; }
.sg-go {
  position: absolute; z-index: 7; pointer-events: auto; cursor: pointer;
  transform: translate(-50%, 14px);
  background: #b13b2e; color: #fff8ee;
  font-family: "Ma Shan Zheng", cursive; font-size: 16px; letter-spacing: .12em;
  padding: 5px 16px 4px; border-radius: 999px;
  border: 1px solid #7e2318;
  box-shadow: 0 4px 14px rgba(80, 30, 20, .38);
  transition: opacity .2s ease, background .15s ease;
  white-space: nowrap;
}
.sg-go:hover { background: #c34a3c; }
`;
let _cssDone = false;
function ensureCss() {
  if (_cssDone || document.getElementById('song-globe-css')) { _cssDone = true; return; }
  const st = document.createElement('style');
  st.id = 'song-globe-css'; st.textContent = GLOBE_CSS;
  document.head.appendChild(st);
  _cssDone = true;
}

export async function createGlobe(container, opts) {
  opts = opts || {};
  ensureCss();
  const { d3, topojson, world } = await ensureLibs();
  const cities = (opts.cities || []).filter(c => typeof c.lng === 'number' && typeof c.lat === 'number');
  const onPick = opts.onPick || function () {};
  const onGo = opts.onGo || function () {};

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.innerHTML = '';
  const root = d3.select(container);
  const svg = root.append('svg').attr('class', 'sg-svg');
  const tip = root.append('div').attr('class', 'sg-tip').style('opacity', 0);
  const goChip = root.append('div').attr('class', 'sg-go').style('opacity', 0);
  let picked = null;
  function showChip(d) { picked = d; goChip.text('前往 · ' + d.title); goChip.style('opacity', 1); }
  function hideChip() { picked = null; goChip.style('opacity', 0); }
  goChip.on('pointerdown', ev => ev.stopPropagation());
  goChip.on('click', ev => {
    ev.stopPropagation();
    const d = picked; hideChip();
    if (d) onGo(d);
  });

  let width = container.clientWidth || 600, height = container.clientHeight || 600;
  let baseScale = Math.min(width, height) / 2 * 0.86;
  let currentK = 1.35;
  svg.attr('width', width).attr('height', height);

  const projection = d3.geoOrthographic().scale(baseScale).translate([width / 2, height / 2]).clipAngle(90).precision(0.7).rotate([-108, -26]);
  const path = d3.geoPath(projection);

  /* ---- 青花费纸渐变 ---- */
  const defs = svg.append('defs');
  const og = defs.append('radialGradient').attr('id', 'sgOcean').attr('cx', '38%').attr('cy', '30%').attr('r', '82%');
  og.append('stop').attr('offset', '0%').attr('stop-color', '#b9cfd9');
  og.append('stop').attr('offset', '45%').attr('stop-color', '#82a3b5');
  og.append('stop').attr('offset', '78%').attr('stop-color', '#52748a');
  og.append('stop').attr('offset', '100%').attr('stop-color', '#39576c');
  const mg = defs.append('radialGradient').attr('id', 'sgMoon').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
  mg.append('stop').attr('offset', '86%').attr('stop-color', 'rgba(250,244,222,0)');
  mg.append('stop').attr('offset', '95%').attr('stop-color', 'rgba(250,244,222,.5)');
  mg.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(250,244,222,0)');

  const moon = svg.append('circle').attr('fill', 'url(#sgMoon)');
  const g = svg.append('g');
  const sphere = g.append('path').attr('class', 'sg-sphere').attr('fill', 'url(#sgOcean)');
  const grat = g.append('path').attr('fill', 'none').attr('stroke', 'rgba(74,58,40,.16)').attr('stroke-width', 0.6);
  const graticule = d3.geoGraticule10();

  const features = topojson.feature(world, world.objects.countries).features;
  function landFill(d) {
    const s = String(d.properties.name || d.id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + (36 + (h % 9)) + ',' + (22 + (h % 10)) + '%,' + (59 + (h % 12)) + '%)';
  }
  const landSel = g.append('g').selectAll('path').data(features).join('path')
    .attr('class', 'sg-land').attr('fill', landFill)
    .attr('stroke', 'rgba(74,58,40,.5)').attr('stroke-width', 0.4);
  const outline = g.append('path').attr('fill', 'none').attr('stroke', 'rgba(58,44,30,.75)').attr('stroke-width', 1.2);

  /* ---- 城市标记：朱砂点 + 墨书 + 光环 ---- */
  const citySel = g.append('g').selectAll('g').data(cities, d => d.name).join('g')
    .attr('class', d => 'sg-city' + (d.current ? ' cur' : '')).style('cursor', 'pointer');
  const halo = citySel.append('circle').attr('class', 'sg-halo').attr('r', 4).attr('fill', 'none').attr('stroke', '#b13b2e').attr('stroke-width', 1.2);
  halo.append('animate').attr('attributeName', 'r').attr('values', '4;11').attr('dur', '2.4s').attr('repeatCount', 'indefinite');
  halo.append('animate').attr('attributeName', 'opacity').attr('values', '.65;0').attr('dur', '2.4s').attr('repeatCount', 'indefinite');
  citySel.append('circle').attr('class', 'sg-dot').attr('r', 3.6).attr('fill', d => d.current ? '#c8952e' : '#b13b2e').attr('stroke', '#fff4de').attr('stroke-width', 1.2);
  citySel.append('text')
    .attr('x', (d, i) => i % 2 ? -9 : 9).attr('dy', -7)
    .attr('text-anchor', (d, i) => i % 2 ? 'end' : 'start')
    .text(d => d.title);

  /* ---- 渲染 ---- */
  function render() {
    const d = path({ type: 'Sphere' });
    sphere.attr('d', d); outline.attr('d', d);
    moon.attr('cx', width / 2).attr('cy', height / 2).attr('r', projection.scale() * 1.18);
    grat.attr('d', path(graticule));
    landSel.attr('d', path);
    const rot = projection.rotate(), center = [-rot[0], -rot[1]];
    citySel.each(function (cd) {
      const p = projection([cd.lng, cd.lat]);
      const vis = d3.geoDistance([cd.lng, cd.lat], center) < PI / 2 - 0.03;
      d3.select(this).attr('transform', 'translate(' + p[0] + ',' + p[1] + ')').style('display', vis ? null : 'none');
    });
    if (picked) {
      const p = projection([picked.lng, picked.lat]);
      const vis = d3.geoDistance([picked.lng, picked.lat], center) < PI / 2 - 0.05;
      goChip.style('left', p[0] + 'px').style('top', p[1] + 'px').style('opacity', vis ? 1 : 0);
    }
  }

  /* ---- 状态与拖拽 ---- */
  let spinning = true, isDragging = false, lastDragEnd = Date.now(), dead = false;
  function safeInvert(x, y) { const p = projection.invert([x, y]); return (p && isFinite(p[0]) && isFinite(p[1])) ? p : null; }
  let v0, q0, r0;
  const dragBehavior = d3.drag()
    .filter(ev => !ev.button && (!ev.touches || ev.touches.length === 1))
    .on('start', function (ev) {
      const inv = safeInvert(ev.x, ev.y);
      isDragging = true; hideTip(); hideChip();
      if (!inv) { v0 = null; return; }
      v0 = versor.cartesian(inv); q0 = versor(r0 = projection.rotate());
    })
    .on('drag', function (ev) {
      if (!v0) return;
      const v1 = versor.cartesian(projection.rotate(r0).invert([ev.x, ev.y]));
      const q1 = versor.multiply(q0, versor.delta(v0, v1));
      projection.rotate(versor.rotation(q1));
      render();
    })
    .on('end', function () { isDragging = false; lastDragEnd = Date.now(); });
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.6, 6])
    .filter(ev => ev.type === 'wheel')
    .on('zoom', function (ev) { currentK = ev.transform.k; projection.scale(baseScale * currentK); render(); });
  svg.call(dragBehavior);
  svg.call(zoomBehavior).on('mousedown.zoom', null).on('touchstart.zoom', null).on('dblclick.zoom', null);

  /* ---- 国家悬停微亮 ---- */
  landSel
    .on('pointerenter', function () { if (!isDragging) d3.select(this).attr('fill', 'hsl(16,42%,52%)'); })
    .on('pointerleave', function (ev, d) { d3.select(this).attr('fill', landFill(d)); });

  /* ---- 城市悬停笺 + 点击择城 ---- */
  function showTip(ev, d) {
    tip.html('<div class="n">' + d.title + '</div><div class="s">' + (d.subtitle || '') + '</div>')
      .style('left', (ev.offsetX != null ? ev.offsetX : ev.layerX) + 'px')
      .style('top', (ev.offsetY != null ? ev.offsetY : ev.layerY) + 'px')
      .style('opacity', 1);
  }
  function hideTip() { tip.style('opacity', 0); }
  citySel
    .on('pointerenter', function (ev, d) { if (!isDragging) showTip(ev, d); })
    .on('pointermove', function (ev, d) { showTip(ev, d); })
    .on('pointerleave', hideTip)
    .on('click', function (ev, d) {
      if (Date.now() - lastDragEnd < 250) return;
      ev.stopPropagation();
      showChip(d);
      flyTo([d.lng, d.lat], 2.0);
      onPick(d);
    });
  svg.on('click', hideChip);

  /* ---- 飞行定位 ---- */
  function flyTo(lonlat, targetK) {
    lastDragEnd = Date.now();
    const start = [-projection.rotate()[0], -projection.rotate()[1]];
    const interp = d3.geoInterpolate(start, lonlat);
    const k0 = currentK, k1 = targetK || currentK;
    svg.interrupt('fly');
    svg.transition('fly').duration(1100).ease(d3.easeCubicInOut)
      .tween('fly', function () {
        return function (t) {
          if (dead) return;
          const c = interp(t);
          projection.rotate([-c[0], -c[1]]);
          if (k0 !== k1) { currentK = k0 + (k1 - k0) * t; projection.scale(baseScale * currentK); }
          render();
        };
      });
  }
  function focus(name) {
    const c = cities.find(x => x.name === name);
    if (c) flyTo([c.lng, c.lat], 2.0);
  }
  function pick(name) {
    const c = cities.find(x => x.name === name);
    if (c) { showChip(c); flyTo([c.lng, c.lat], 2.0); }
  }

  /* ---- 闲置自转 ---- */
  const timer = d3.timer(function () {
    if (dead) return;
    if (spinning && !isDragging && Date.now() - lastDragEnd > 10000) {
      const r = projection.rotate();
      projection.rotate([r[0] + 0.005, r[1]]);
      render();
    }
  });

  /* ---- 自适应 ---- */
  function resize() {
    if (dead) return;
    width = container.clientWidth || width; height = container.clientHeight || height;
    baseScale = Math.min(width, height) / 2 * 0.86;
    svg.attr('width', width).attr('height', height);
    projection.translate([width / 2, height / 2]).scale(baseScale * currentK);
    render();
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(container); }
  else window.addEventListener('resize', resize);

  /* ---- 悬停暂停自转 ---- */
  svg.on('pointerenter', () => { spinning = false; }).on('pointerleave', () => { spinning = true; });

  render();
  return {
    focus,
    pick,
    destroy() {
      dead = true;
      timer.stop();
      svg.interrupt('fly');
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      container.innerHTML = '';
    }
  };
}
