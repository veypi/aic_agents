import * as THREE from './three.module.js';

/* ============================================================
   调色板（宋韵）
============================================================ */
export const C = {
  woodDark: 0x4f3626, wood: 0x7a5238, woodRed: 0x8c4434,
  plaster: 0xe9dfc6, plaster2: 0xded2b4,
  roof: 0x494e55, roofLight: 0x585e66, ridge: 0x3a3f46,
  stone: 0x9a9384, stoneDark: 0x7d7768,
  dirt: 0xb3a071, road: 0xa8946a, grass: 0x87995c, grassDry: 0x9aa063,
  water: 0x4f7a6e, mud: 0x6e5f45,
  lantern: 0xc53b2a, skin: 0xe6bf98,
};

/* ============================================================
   辅助函数
============================================================ */
export function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function cyl(rt, rb, h, mat, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/* ============================================================
   基础：渲染器 / 场景 / 相机 / 光照
============================================================ */
export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe4dc);
  scene.fog = new THREE.Fog(0xdfe0d0, 55, 235);

  const camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

  const hemi = new THREE.HemisphereLight(0xe8f0f5, 0x8a7a58, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 1.7);
  sun.position.set(90, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  return { renderer, scene, camera };
}
