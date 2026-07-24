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
  t.anisotropy = 4;
  return t;
}

export function makeTextures() {
  // ---- 瓦片（筒瓦屋面：竖向瓦垄 + 横向瓦当） ----
  var roofTex = canvasTex([256, 256], function (g, w, h) {
    g.fillStyle = '#68707c'; g.fillRect(0, 0, w, h);
    for (var x = 0; x < w; x += 16) {
      var grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, 'rgba(0,0,0,.5)');
      grd.addColorStop(0.35, 'rgba(255,255,255,.20)');
      grd.addColorStop(0.55, 'rgba(255,255,255,.08)');
      grd.addColorStop(1, 'rgba(0,0,0,.5)');
      g.fillStyle = grd; g.fillRect(x, 0, 16, h);
    }
    // 横向瓦层阴影
    for (var y = 0; y < h; y += 21) {
      g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(0, y, w, 3);
      g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y + 3, w, 2);
    }
    // 瓦当弧线
    g.strokeStyle = 'rgba(0,0,0,.32)'; g.lineWidth = 2;
    for (var yy = 0; yy < h; yy += 21) for (var xx = 0; xx < w; xx += 16) {
      g.beginPath(); g.arc(xx + 8, yy + 21, 7, Math.PI, 0); g.stroke();
    }
    // 轻微色差
    for (var i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(' + ((70 + Math.random() * 30) | 0) + ',' + ((78 + Math.random() * 30) | 0) + ',' + ((90 + Math.random() * 30) | 0) + ',.25)';
      g.fillRect(Math.random() * w, Math.random() * h, 16, 21);
    }
  }, 3, 2);

  // ---- 木板 ----
  var plankTex = canvasTex([128, 128], function (g, w, h) {
    g.fillStyle = '#7a5238'; g.fillRect(0, 0, w, h);
    for (var x = 0; x < w; x += 16) {
      g.fillStyle = (x / 16) % 2 ? '#74502f' : '#7d573c'; g.fillRect(x, 0, 16, h);
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, 0, 2, h);
    }
    g.fillStyle = 'rgba(0,0,0,.12)';
    for (var i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 20, 1.5);
  }, 6, 1);

  // ---- 桥面甲板 ----
  var deckTex = canvasTex([128, 128], function (g, w, h) {
    g.fillStyle = '#8a6238'; g.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 16) {
      g.fillStyle = (y / 16) % 2 ? '#855c33' : '#8f6840'; g.fillRect(0, y, w, 16);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, y, w, 2.5);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + 2.5, w, 2);
    }
    g.fillStyle = 'rgba(60,35,15,.5)';
    for (var i = 0; i < 14; i++) { var yy = (i * 97) % h, xx = (i * 61) % w; g.fillRect(xx, yy, 2, 2); }
  }, 1, 16);

  // ---- 石板路 ----
  var slabTex = canvasTex([256, 256], function (g, w, h) {
    g.fillStyle = '#9d8b66'; g.fillRect(0, 0, w, h);
    var rows = 5, cols = 6;
    for (var r = 0; r < rows; r++) {
      var off = r % 2 ? w / cols / 2 : 0;
      for (var c = -1; c < cols + 1; c++) {
        var xx = c * (w / cols) + off + 3, yy = r * (h / rows) + 3, sw = w / cols - 6, sh = h / rows - 6, tt = Math.random() * 18 - 9;
        g.fillStyle = 'rgb(' + (156 + tt) + ',' + (138 + tt) + ',' + (102 + tt) + ')';
        g.beginPath(); g.roundRect(xx, yy, sw, sh, 5); g.fill();
        g.fillStyle = 'rgba(255,255,255,.09)'; g.fillRect(xx, yy, sw, 3);
        g.fillStyle = 'rgba(0,0,0,.13)'; g.fillRect(xx, yy + sh - 3, sw, 3);
        // 石板表面磨损
        g.fillStyle = 'rgba(80,66,40,.12)';
        for (var k = 0; k < 6; k++) g.fillRect(xx + Math.random() * sw, yy + Math.random() * sh, 3, 2);
      }
    }
    g.fillStyle = 'rgba(70,55,30,.15)';
    for (var i = 0; i < 260; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }, 30, 2);

  // ---- 土路 ----
  var dirtTex = canvasTex([256, 256], function (g, w, h) {
    g.fillStyle = '#a8906a'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 900; i++) {
      var tt = Math.random() * 30 - 15;
      g.fillStyle = 'rgba(' + (168 + tt) + ',' + (146 + tt) + ',' + (102 + tt) + ',.5)';
      g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 2 + Math.random() * 3);
    }
    // 车辙
    g.fillStyle = 'rgba(90,72,44,.18)';
    g.fillRect(0, h * 0.3, w, 10); g.fillRect(0, h * 0.62, w, 10);
    g.fillStyle = 'rgba(90,75,45,.2)';
    for (var j = 0; j < 120; j++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }, 16, 3);

  // ---- 地面（多尺度草色，减轻重复感） ----
  var groundTex = canvasTex([512, 512], function (g, w, h) {
    g.fillStyle = '#93a05f'; g.fillRect(0, 0, w, h);
    // 大块色斑
    var blotches = ['rgba(134,150,88,.55)', 'rgba(152,162,100,.5)', 'rgba(118,138,78,.45)', 'rgba(164,152,96,.4)', 'rgba(140,158,84,.5)'];
    for (var i = 0; i < 90; i++) {
      var bx = Math.random() * w, by = Math.random() * h, br = 30 + Math.random() * 90;
      var grd = g.createRadialGradient(bx, by, 0, bx, by, br);
      var col = blotches[(Math.random() * blotches.length) | 0];
      grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill();
    }
    // 中景草簇
    var greens = ['rgba(120,140,72,.5)', 'rgba(146,160,96,.45)', 'rgba(104,126,66,.4)'];
    for (var j = 0; j < 700; j++) {
      g.fillStyle = greens[(Math.random() * 3) | 0];
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 3 + Math.random() * 9, 2 + Math.random() * 5, Math.random() * 3, 0, 7); g.fill();
    }
    // 细颗粒
    for (var k = 0; k < 1600; k++) {
      var tt = Math.random() * 40 - 20;
      g.fillStyle = 'rgba(' + (140 + tt) + ',' + (152 + tt) + ',' + (88 + tt) + ',.35)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 40, 30);

  // ---- 草叶 ----
  var grassBladeTex = (function () {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    var g = cv.getContext('2d');
    for (var i = 0; i < 9; i++) {
      var xx = 6 + i * 6 + Math.random() * 4, hgt = 30 + Math.random() * 28, lean = Math.random() * 14 - 7;
      g.strokeStyle = 'rgba(' + ((86 + Math.random() * 30) | 0) + ',' + ((120 + Math.random() * 30) | 0) + ',' + ((60 + Math.random() * 20) | 0) + ',.95)';
      g.lineWidth = 2.5 + Math.random() * 1.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(xx, 64); g.quadraticCurveTo(xx + lean * 0.4, 64 - hgt * 0.6, xx + lean, 64 - hgt); g.stroke();
    }
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // ---- 野花 ----
  var flowerTex = (function () {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    var g = cv.getContext('2d');
    var cols = ['#d88a9a', '#e0c56a', '#c9d8e8', '#d8a86a'];
    for (var i = 0; i < 4; i++) {
      var cx = 12 + i * 14, cy = 40 - Math.random() * 14, col = cols[i];
      g.strokeStyle = 'rgba(90,120,60,.9)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx, 64); g.lineTo(cx, cy + 4); g.stroke();
      g.fillStyle = col;
      for (var p = 0; p < 5; p++) { var a = (p / 5) * 6.28; g.beginPath(); g.ellipse(cx + Math.cos(a) * 3.4, cy + Math.sin(a) * 3.4, 3, 3, 0, 0, 7); g.fill(); }
      g.fillStyle = '#f5e6a0'; g.beginPath(); g.arc(cx, cy, 2.2, 0, 7); g.fill();
    }
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // ---- 云 ----
  var cloudTex = (function () {
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    var g = cv.getContext('2d');
    for (var i = 0; i < 14; i++) {
      var xx = 40 + Math.random() * 176, yy = 50 + Math.random() * 36, r = 18 + Math.random() * 26;
      var grd = g.createRadialGradient(xx, yy, 0, xx, yy, r);
      grd.addColorStop(0, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(xx, yy, r, 0, 7); g.fill();
    }
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // ---- 耕地 ----
  var tilledTex = canvasTex([128, 128], function (g, w, h) {
    g.fillStyle = '#6e5638'; g.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 14) {
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y, w, 4);
      g.fillStyle = 'rgba(255,240,200,.10)'; g.fillRect(0, y + 4, w, 3);
    }
  }, 3, 2);

  // ---- 对联 ----
  function coupletTex(text) {
    var cv = document.createElement('canvas'); cv.width = 48; cv.height = 192;
    var g = cv.getContext('2d');
    g.fillStyle = '#a8322a'; g.fillRect(0, 0, 48, 192);
    g.strokeStyle = '#d8b84a'; g.lineWidth = 3; g.strokeRect(3, 3, 42, 186);
    g.fillStyle = '#f5e6c0'; g.font = "bold 30px 'Noto Serif SC','STKaiti',serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    text.split('').forEach(function (ch, i) { g.fillText(ch, 24, 24 + i * 36); });
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---- 窗棂 ----
  var latticeTex = canvasTex([96, 96], function (g, w, h) {
    g.fillStyle = '#3a2c1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2d2a8'; g.fillRect(6, 6, w - 12, h - 12);
    g.strokeStyle = '#3a2c1e'; g.lineWidth = 5;
    for (var i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo((i * w) / 3, 0); g.lineTo((i * w) / 3, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / 3); g.lineTo(w, (i * h) / 3); g.stroke();
    }
    g.strokeStyle = 'rgba(58,44,30,.8)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  });

  // ---- 雨棚布 ----
  var awningTex = canvasTex([128, 128], function (g, w, h) {
    var cols = ['#a8463a', '#e3d6b4'];
    for (var i = 0; i < 8; i++) { g.fillStyle = cols[i % 2]; g.fillRect(i * 16, 0, 16, h); }
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, h - 10, w, 10);
  }, 2, 1);

  // ---- 柳枝 ----
  var willowTex = (function () {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
    var g = cv.getContext('2d');
    for (var i = 0; i < 26; i++) {
      var x0 = 10 + Math.random() * 108, sway = Math.random() * 24 - 12, len = 150 + Math.random() * 100;
      g.strokeStyle = 'rgba(' + ((86 + Math.random() * 30) | 0) + ',' + ((110 + Math.random() * 30) | 0) + ',' + ((60 + Math.random() * 20) | 0) + ',.9)';
      g.lineWidth = 2 + Math.random() * 1.5;
      g.beginPath(); g.moveTo(x0, 0); g.quadraticCurveTo(x0 + sway, len * 0.6, x0 + sway * 0.6, len); g.stroke();
      for (var t = 0.15; t < 1; t += 0.12) {
        var lx = x0 + sway * (t * 1.6 - t * t * 0.6), ly = len * t;
        g.fillStyle = 'rgba(' + ((96 + Math.random() * 40) | 0) + ',' + ((125 + Math.random() * 35) | 0) + ',' + ((66 + Math.random() * 20) | 0) + ',.95)';
        g.beginPath(); g.ellipse(lx + (Math.random() * 10 - 5), ly, 2.2, 4.5, Math.random(), 0, 7); g.fill();
      }
    }
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // ---- 招幌 ----
  function bannerTex(text) {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 200;
    var g = cv.getContext('2d');
    g.fillStyle = '#efe3c2'; g.fillRect(0, 0, 64, 200);
    g.strokeStyle = '#8c4434'; g.lineWidth = 5; g.strokeRect(4, 4, 56, 192);
    g.fillStyle = '#2e2a22'; g.font = "bold 46px 'Noto Serif SC','STKaiti',serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var chars = text.split('');
    chars.forEach(function (ch, i) { g.fillText(ch, 32, 100 + (i - (chars.length - 1) / 2) * 58); });
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---- 城砖（城墙 / 台基） ----
  var brickTex = canvasTex([256, 256], function (g, w, h) {
    g.fillStyle = '#938d7e'; g.fillRect(0, 0, w, h);
    var bh = 16, bw = 42;
    for (var r = 0; r * bh < h; r++) {
      var off = r % 2 ? bw / 2 : 0;
      for (var c = -1; c * bw < w + bw; c++) {
        var xx = c * bw + off, yy = r * bh, tt = Math.random() * 14 - 7;
        g.fillStyle = 'rgb(' + (146 + tt) + ',' + (139 + tt) + ',' + (126 + tt) + ')';
        g.fillRect(xx + 1.5, yy + 1.5, bw - 3, bh - 3);
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(xx + 1.5, yy + 1.5, bw - 3, 2);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(xx + 1.5, yy + bh - 3.5, bw - 3, 2);
      }
    }
    // 风化斑驳
    for (var i = 0; i < 120; i++) {
      g.fillStyle = 'rgba(' + ((96 + Math.random() * 40) | 0) + ',' + ((92 + Math.random() * 36) | 0) + ',' + ((80 + Math.random() * 30) | 0) + ',.3)';
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 3 + Math.random() * 8, Math.random() * 3, 0, 7); g.fill();
    }
  }, 8, 3);

  // ---- 灰泥墙面 ----
  var plasterTex = canvasTex([256, 256], function (g, w, h) {
    g.fillStyle = '#ece1c8'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 50; i++) {
      var bx = Math.random() * w, by = Math.random() * h, br = 12 + Math.random() * 40;
      var grd = g.createRadialGradient(bx, by, 0, bx, by, br);
      grd.addColorStop(0, 'rgba(196,178,140,.20)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill();
    }
    for (var j = 0; j < 400; j++) {
      var tt = Math.random() * 16 - 8;
      g.fillStyle = 'rgba(' + (228 + tt) + ',' + (216 + tt) + ',' + (188 + tt) + ',.5)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // 底部潮痕
    var grd2 = g.createLinearGradient(0, h - 40, 0, h);
    grd2.addColorStop(0, 'rgba(150,130,96,0)'); grd2.addColorStop(1, 'rgba(150,130,96,.35)');
    g.fillStyle = grd2; g.fillRect(0, h - 40, w, 40);
  }, 2, 1);

  // ---- 朱漆门（门钉） ----
  var doorTex = canvasTex([128, 128], function (g, w, h) {
    g.fillStyle = '#7c2e22'; g.fillRect(0, 0, w, h);
    // 木板缝
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (var x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    // 门钉
    for (var ry = 0; ry < 4; ry++) for (var rx = 0; rx < 4; rx++) {
      var cx = 16 + rx * 32, cy = 16 + ry * 32;
      var grd = g.createRadialGradient(cx - 1.5, cy - 1.5, 0, cx, cy, 6);
      grd.addColorStop(0, '#f0d88a'); grd.addColorStop(0.7, '#b8942e'); grd.addColorStop(1, 'rgba(0,0,0,.4)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 5.5, 0, 7); g.fill();
    }
  }, 1, 1);

  // ---- 匾额 ----
  function signTex(text, opts) {
    opts = opts || {};
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 80;
    var g = cv.getContext('2d');
    g.fillStyle = opts.bg || '#24221e'; g.fillRect(0, 0, 256, 80);
    g.strokeStyle = opts.border || '#c8a44a'; g.lineWidth = 5; g.strokeRect(5, 5, 246, 70);
    g.strokeStyle = 'rgba(200,164,74,.4)'; g.lineWidth = 2; g.strokeRect(10, 10, 236, 60);
    g.fillStyle = opts.fg || '#e8cc72';
    var chars = text.split('');
    var fs = chars.length > 3 ? 40 : 50;
    g.font = "bold " + fs + "px 'Ma Shan Zheng','Noto Serif SC','STKaiti',serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    chars.forEach(function (ch, i) {
      g.fillText(ch, 128 + (i - (chars.length - 1) / 2) * (fs + 8), 42);
    });
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---- 天空渐变（配合 material.color 染色） ----
  var skyTex = (function () {
    var cv = document.createElement('canvas'); cv.width = 32; cv.height = 256;
    var g = cv.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#5f96d4');
    grd.addColorStop(0.4, '#a8c4de');
    grd.addColorStop(0.72, '#e4ddc8');
    grd.addColorStop(1, '#f4ead2');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 256);
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  return {
    roofTex, plankTex, deckTex, slabTex, dirtTex, groundTex, grassBladeTex,
    flowerTex, cloudTex, tilledTex, coupletTex, latticeTex, awningTex, willowTex, bannerTex,
    brickTex, plasterTex, doorTex, signTex, skyTex,
  };
}
