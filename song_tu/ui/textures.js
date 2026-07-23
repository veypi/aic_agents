import * as THREE from './three.module.js';

function canvasTex(size, draw, rx, ry) {
  rx = rx || 1; ry = ry || 1;
  var cv = document.createElement('canvas');
  cv.width = size[0]; cv.height = size[1];
  draw(cv.getContext('2d'), cv.width, cv.height);
  var t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// __APPEND__

export function makeTextures() { return {}; }
