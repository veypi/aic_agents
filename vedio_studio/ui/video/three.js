/*
 * three.js — declarative 3D element renderer for the video/1 engine.
 *
 * Element: { type: "three", x, y, w, h, scene: { camera, lights, objects, group } }
 * renderThree(el, t) → dataURL (transparent PNG), synchronous & deterministic
 * per (element descriptor, t). One WebGL context is kept per element signature
 * and reused across frames; scene graph is rebuilt only when the descriptor
 * changes. Time-driven motion uses speeds in rad/sec (Remotion's per-frame
 * values × 30).
 *
 * Supported descriptor:
 *   scene.camera  { position:[x,y,z], fov }
 *   scene.lights  [{ type:'ambient'|'directional'|'point', intensity, position?, color? }]
 *   scene.group   { rotation:[rx,ry,rz] }                 // rad/s, whole-group spin
 *   scene.objects[]:
 *     { type:'torusKnot'|'icosahedron'|'sphere'|'box', args:[...],
 *       material:{ kind:'standard'|'basic', color, metalness, roughness,
 *                  wireframe, opacity, emissive?, emissiveIntensity? },
 *       rotation:[rx,ry,rz], scalePulse:{amp,speed}, position:[x,y,z], scale }
 *     { type:'orbiters', count, radius, speed, yWave:{freq,amp}, sizes:[s,s,s],
 *       colors:[c1,c2], emissiveIntensity }               // N orbiting spheres
 */

import * as THREE from "./vendor/three.module.js";

const cache = new Map(); // sig → { canvas, renderer, scene3, camera, group, anim, w, h }

function matOf(m = {}) {
  const common = {
    color: new THREE.Color(m.color || "#ffffff"),
    transparent: m.opacity != null && m.opacity < 1,
    opacity: m.opacity != null ? m.opacity : 1,
    wireframe: !!m.wireframe,
  };
  if (m.kind === "basic") return new THREE.MeshBasicMaterial(common);
  const mat = new THREE.MeshStandardMaterial({
    ...common,
    metalness: m.metalness != null ? m.metalness : 0.3,
    roughness: m.roughness != null ? m.roughness : 0.5,
  });
  if (m.emissive) {
    mat.emissive = new THREE.Color(m.emissive);
    mat.emissiveIntensity = m.emissiveIntensity != null ? m.emissiveIntensity : 1;
  }
  return mat;
}

function geoOf(o) {
  const a = o.args || [];
  if (o.type === "torusKnot") return new THREE.TorusKnotGeometry(...a);
  if (o.type === "icosahedron") return new THREE.IcosahedronGeometry(...a);
  if (o.type === "sphere") return new THREE.SphereGeometry(...a);
  if (o.type === "box") return new THREE.BoxGeometry(...a);
  return new THREE.SphereGeometry(1, 16, 16);
}

function buildScene(desc, w, h) {
  const scene3 = new THREE.Scene();
  const cam = (desc.camera && desc.camera.position) || [0, 0, 7.6];
  const camera = new THREE.PerspectiveCamera(
    (desc.camera && desc.camera.fov) || 45, w / h, 0.1, 100);
  camera.position.set(cam[0], cam[1], cam[2]);

  (desc.lights || []).forEach((l) => {
    let light = null;
    if (l.type === "ambient") light = new THREE.AmbientLight(0xffffff, l.intensity != null ? l.intensity : 0.5);
    else if (l.type === "directional") light = new THREE.DirectionalLight(0xffffff, l.intensity != null ? l.intensity : 1);
    else if (l.type === "point") light = new THREE.PointLight(l.color || 0xffffff, l.intensity != null ? l.intensity : 10);
    if (!light) return;
    if (l.position) light.position.set(l.position[0], l.position[1], l.position[2]);
    scene3.add(light);
  });

  const group = new THREE.Group();
  scene3.add(group);
  const anim = [];
  (desc.objects || []).forEach((o) => {
    if (o.type === "orbiters") {
      const count = o.count || 8;
      const radius = o.radius || 3;
      for (let i = 0; i < count; i++) {
        const sz = (o.sizes && o.sizes[i % o.sizes.length]) || 0.12;
        const col = (o.colors && o.colors[i % o.colors.length]) || "#ffffff";
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(sz, 20, 20),
          matOf({ kind: "standard", color: col, emissive: col,
                  emissiveIntensity: o.emissiveIntensity != null ? o.emissiveIntensity : 0.55,
                  metalness: 0.2, roughness: 0.4 }),
        );
        group.add(mesh);
        anim.push({ kind: "orbiter", mesh, i, count, radius,
                    speed: o.speed || 0.9, yWave: o.yWave || { freq: 1.7, amp: 0.9 } });
      }
      return;
    }
    const mesh = new THREE.Mesh(geoOf(o), matOf(o.material));
    if (o.position) mesh.position.set(o.position[0], o.position[1], o.position[2]);
    if (o.scale != null) mesh.scale.setScalar(o.scale);
    group.add(mesh);
    if (o.rotation) anim.push({ kind: "rotate", mesh, speed: o.rotation });
    if (o.scalePulse) anim.push({ kind: "pulse", mesh, amp: o.scalePulse.amp || 0.05, speed: o.scalePulse.speed || 1.5 });
  });
  return { scene3, camera, group, anim, groupSpin: (desc.group && desc.group.rotation) || null };
}

/** Render one 3D element at scene-local t (seconds) → 渲染后的共享 canvas
 *  （每个元素签名缓存一份 WebGL 上下文；预览直接挂 DOM，导出由 render.js 合成）。 */
export function getThreeCanvas(el, t) {
  const w = Math.max(8, Math.round(el.w)), h = Math.max(8, Math.round(el.h));
  const sig = el.id + "|" + w + "x" + h + "|" + JSON.stringify(el.scene || {});
  let ctx = cache.get(sig);
  if (!ctx) {
    if (cache.size > 8) { // 防止多文档切换时上下文泄漏
      const first = cache.keys().next().value;
      const old = cache.get(first);
      old.renderer.dispose();
      cache.delete(first);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, preserveDrawingBuffer: false,
    });
    renderer.setClearColor(0x000000, 0);
    const built = buildScene(el.scene || {}, w, h);
    ctx = { canvas, renderer, ...built };
    cache.set(sig, ctx);
  }
  // 时间驱动（确定性：同一 t 恒同结果）
  if (ctx.groupSpin) {
    ctx.group.rotation.set(
      ctx.groupSpin[0] * t, ctx.groupSpin[1] * t, ctx.groupSpin[2] * t);
  }
  for (const a of ctx.anim) {
    if (a.kind === "rotate") {
      a.mesh.rotation.set(a.speed[0] * t, a.speed[1] * t, a.speed[2] * t);
    } else if (a.kind === "pulse") {
      a.mesh.scale.setScalar(1 + Math.sin(t * a.speed) * a.amp);
    } else if (a.kind === "orbiter") {
      const ang = t * a.speed + (a.i / a.count) * Math.PI * 2;
      a.mesh.position.set(
        Math.cos(ang) * a.radius,
        Math.sin(ang * a.yWave.freq + a.i) * a.yWave.amp,
        Math.sin(ang) * a.radius,
      );
    }
  }
  ctx.renderer.render(ctx.scene3, ctx.camera);
  return ctx.canvas;
}

/** Render one 3D element at scene-local t → PNG dataURL（透明背景）。 */
export function renderThree(el, t) {
  return getThreeCanvas(el, t).toDataURL("image/png");
}

/** Dispose all cached GL contexts (page unload / doc switch hygiene). */
export function disposeThree() {
  cache.forEach((c) => c.renderer.dispose());
  cache.clear();
}
