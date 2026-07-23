import * as THREE from "./three.module.js";
import { C, box, cyl, createEngine } from "./engine.js";
import {
  WORLD,
  groundHeight,
  makeGround,
  road,
  makeBridge,
  makeRoofGeo,
  addRoof,
  makeBuilding,
  makeStall,
  makeUmbrella,
  makeBoat,
  makeScenery,
  makeWillow,
  makeTree,
  makeBamboo,
  makeField,
} from "./world.js";
import {
  makePerson,
  parseRow,
  spawnNPC,
  npcPickTarget,
  updateNPC,
  idlePose,
  makePortrait,
} from "./npc.js";

export function initGame(canvasEl, npcItems, root, $mod, $auth, $router) {
  const canvas = canvasEl;
  const apiFetch = $mod.$fetch;
  const $ = root
    ? (sel) => root.querySelector(sel)
    : (sel) => document.querySelector(sel);
  const { renderer, scene, camera } = createEngine(canvas);

  function canvasTex(size, draw, rx, ry) {
    rx = rx || 1;
    ry = ry || 1;
    var cv = document.createElement("canvas");
    cv.width = size[0];
    cv.height = size[1];
    draw(cv.getContext("2d"), cv.width, cv.height);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeTextures() {
    var roofTex = canvasTex(
      [128, 128],
      function (g, w, h) {
        g.fillStyle = "#6e757f";
        g.fillRect(0, 0, w, h);
        for (var x = 0; x < w; x += 16) {
          var grd = g.createLinearGradient(x, 0, x + 16, 0);
          grd.addColorStop(0, "rgba(0,0,0,.42)");
          grd.addColorStop(0.45, "rgba(255,255,255,.16)");
          grd.addColorStop(0.55, "rgba(255,255,255,.10)");
          grd.addColorStop(1, "rgba(0,0,0,.42)");
          g.fillStyle = grd;
          g.fillRect(x, 0, 16, h);
        }
        g.strokeStyle = "rgba(0,0,0,.35)";
        g.lineWidth = 2;
        for (var y = 0; y < h; y += 16)
          for (var x = 0; x < w; x += 16) {
            g.beginPath();
            g.arc(x + 8, y + 16, 8, Math.PI, 0);
            g.stroke();
          }
        g.strokeStyle = "rgba(255,255,255,.10)";
        for (var y = 8; y < h; y += 16) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
      },
      3,
      2,
    );
    var plankTex = canvasTex(
      [128, 128],
      function (g, w, h) {
        g.fillStyle = "#7a5238";
        g.fillRect(0, 0, w, h);
        for (var x = 0; x < w; x += 16) {
          g.fillStyle = (x / 16) % 2 ? "#74502f" : "#7d573c";
          g.fillRect(x, 0, 16, h);
          g.fillStyle = "rgba(0,0,0,.4)";
          g.fillRect(x, 0, 2, h);
        }
        g.fillStyle = "rgba(0,0,0,.12)";
        for (var i = 0; i < 40; i++)
          g.fillRect(
            Math.random() * w,
            Math.random() * h,
            8 + Math.random() * 20,
            1.5,
          );
      },
      6,
      1,
    );
    var deckTex = canvasTex(
      [128, 128],
      function (g, w, h) {
        g.fillStyle = "#8a6238";
        g.fillRect(0, 0, w, h);
        for (var y = 0; y < h; y += 16) {
          g.fillStyle = (y / 16) % 2 ? "#855c33" : "#8f6840";
          g.fillRect(0, y, w, 16);
          g.fillStyle = "rgba(0,0,0,.45)";
          g.fillRect(0, y, w, 2.5);
          g.fillStyle = "rgba(255,255,255,.06)";
          g.fillRect(0, y + 2.5, w, 2);
        }
        g.fillStyle = "rgba(60,35,15,.5)";
        for (var i = 0; i < 14; i++) {
          var yy = (i * 97) % h,
            xx = (i * 61) % w;
          g.fillRect(xx, yy, 2, 2);
        }
      },
      1,
      16,
    );
    var slabTex = canvasTex(
      [256, 256],
      function (g, w, h) {
        g.fillStyle = "#a3906c";
        g.fillRect(0, 0, w, h);
        var rows = 5,
          cols = 6;
        for (var r = 0; r < rows; r++) {
          var off = r % 2 ? w / cols / 2 : 0;
          for (var c = -1; c < cols + 1; c++) {
            var xx = c * (w / cols) + off + 3,
              yy = r * (h / rows) + 3,
              sw = w / cols - 6,
              sh = h / rows - 6,
              tt = Math.random() * 16 - 8;
            g.fillStyle =
              "rgb(" + (158 + tt) + "," + (140 + tt) + "," + (104 + tt) + ")";
            g.beginPath();
            g.roundRect(xx, yy, sw, sh, 5);
            g.fill();
            g.fillStyle = "rgba(255,255,255,.07)";
            g.fillRect(xx, yy, sw, 3);
            g.fillStyle = "rgba(0,0,0,.10)";
            g.fillRect(xx, yy + sh - 3, sw, 3);
          }
        }
        g.fillStyle = "rgba(70,55,30,.15)";
        for (var i = 0; i < 260; i++)
          g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      },
      30,
      2,
    );
    var dirtTex = canvasTex(
      [256, 256],
      function (g, w, h) {
        g.fillStyle = "#ab9468";
        g.fillRect(0, 0, w, h);
        for (var i = 0; i < 900; i++) {
          var tt = Math.random() * 30 - 15;
          g.fillStyle =
            "rgba(" + (170 + tt) + "," + (148 + tt) + "," + (104 + tt) + ",.5)";
          g.fillRect(
            Math.random() * w,
            Math.random() * h,
            3 + Math.random() * 6,
            2 + Math.random() * 3,
          );
        }
        g.fillStyle = "rgba(90,75,45,.2)";
        for (var i = 0; i < 120; i++)
          g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      },
      16,
      3,
    );
    var groundTex = canvasTex(
      [256, 256],
      function (g, w, h) {
        g.fillStyle = "#96a165";
        g.fillRect(0, 0, w, h);
        var greens = [
          "rgba(134,150,88,.5)",
          "rgba(150,160,100,.45)",
          "rgba(120,138,80,.4)",
          "rgba(160,150,95,.35)",
        ];
        for (var i = 0; i < 500; i++) {
          g.fillStyle = greens[(Math.random() * 4) | 0];
          g.beginPath();
          g.ellipse(
            Math.random() * w,
            Math.random() * h,
            4 + Math.random() * 14,
            3 + Math.random() * 9,
            Math.random() * 3,
            0,
            7,
          );
          g.fill();
        }
      },
      40,
      30,
    );
    var grassBladeTex = (function () {
      var cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      var g = cv.getContext("2d");
      for (var i = 0; i < 9; i++) {
        var xx = 6 + i * 6 + Math.random() * 4,
          hgt = 30 + Math.random() * 28,
          lean = Math.random() * 14 - 7;
        g.strokeStyle =
          "rgba(" +
          ((86 + Math.random() * 30) | 0) +
          "," +
          ((120 + Math.random() * 30) | 0) +
          "," +
          ((60 + Math.random() * 20) | 0) +
          ",.95)";
        g.lineWidth = 2.5 + Math.random() * 1.5;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(xx, 64);
        g.quadraticCurveTo(
          xx + lean * 0.4,
          64 - hgt * 0.6,
          xx + lean,
          64 - hgt,
        );
        g.stroke();
      }
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    var flowerTex = (function () {
      var cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      var g = cv.getContext("2d");
      var cols = ["#d88a9a", "#e0c56a", "#c9d8e8", "#d8a86a"];
      for (var i = 0; i < 4; i++) {
        var cx = 12 + i * 14,
          cy = 40 - Math.random() * 14,
          col = cols[i];
        g.strokeStyle = "rgba(90,120,60,.9)";
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(cx, 64);
        g.lineTo(cx, cy + 4);
        g.stroke();
        g.fillStyle = col;
        for (var p = 0; p < 5; p++) {
          var a = (p / 5) * 6.28;
          g.beginPath();
          g.ellipse(
            cx + Math.cos(a) * 3.4,
            cy + Math.sin(a) * 3.4,
            3,
            3,
            0,
            0,
            7,
          );
          g.fill();
        }
        g.fillStyle = "#f5e6a0";
        g.beginPath();
        g.arc(cx, cy, 2.2, 0, 7);
        g.fill();
      }
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    var cloudTex = (function () {
      var cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 128;
      var g = cv.getContext("2d");
      for (var i = 0; i < 14; i++) {
        var xx = 40 + Math.random() * 176,
          yy = 50 + Math.random() * 36,
          r = 18 + Math.random() * 26;
        var grd = g.createRadialGradient(xx, yy, 0, xx, yy, r);
        grd.addColorStop(0, "rgba(255,255,255,.85)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(xx, yy, r, 0, 7);
        g.fill();
      }
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    var tilledTex = canvasTex(
      [128, 128],
      function (g, w, h) {
        g.fillStyle = "#6e5638";
        g.fillRect(0, 0, w, h);
        for (var y = 0; y < h; y += 14) {
          g.fillStyle = "rgba(0,0,0,.28)";
          g.fillRect(0, y, w, 4);
          g.fillStyle = "rgba(255,240,200,.10)";
          g.fillRect(0, y + 4, w, 3);
        }
      },
      3,
      2,
    );
    function coupletTex(text) {
      var cv = document.createElement("canvas");
      cv.width = 48;
      cv.height = 192;
      var g = cv.getContext("2d");
      g.fillStyle = "#a8322a";
      g.fillRect(0, 0, 48, 192);
      g.strokeStyle = "#d8b84a";
      g.lineWidth = 3;
      g.strokeRect(3, 3, 42, 186);
      g.fillStyle = "#f5e6c0";
      g.font = "bold 30px 'Noto Serif SC','STKaiti',serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      text.split("").forEach(function (ch, i) {
        g.fillText(ch, 24, 24 + i * 36);
      });
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    var latticeTex = canvasTex([96, 96], function (g, w, h) {
      g.fillStyle = "#3a2c1e";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#d8c8a0";
      g.fillRect(6, 6, w - 12, h - 12);
      g.strokeStyle = "#3a2c1e";
      g.lineWidth = 5;
      for (var i = 1; i < 3; i++) {
        g.beginPath();
        g.moveTo((i * w) / 3, 0);
        g.lineTo((i * w) / 3, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, (i * h) / 3);
        g.lineTo(w, (i * h) / 3);
        g.stroke();
      }
      g.strokeStyle = "rgba(58,44,30,.8)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, h);
      g.moveTo(w, 0);
      g.lineTo(0, h);
      g.stroke();
    });
    var awningTex = canvasTex(
      [128, 128],
      function (g, w, h) {
        var cols = ["#a8463a", "#e3d6b4"];
        for (var i = 0; i < 8; i++) {
          g.fillStyle = cols[i % 2];
          g.fillRect(i * 16, 0, 16, h);
        }
        g.fillStyle = "rgba(0,0,0,.08)";
        g.fillRect(0, h - 10, w, 10);
      },
      2,
      1,
    );
    var willowTex = (function () {
      var cv = document.createElement("canvas");
      cv.width = 128;
      cv.height = 256;
      var g = cv.getContext("2d");
      for (var i = 0; i < 26; i++) {
        var x0 = 10 + Math.random() * 108,
          sway = Math.random() * 24 - 12,
          len = 150 + Math.random() * 100;
        g.strokeStyle =
          "rgba(" +
          ((86 + Math.random() * 30) | 0) +
          "," +
          ((110 + Math.random() * 30) | 0) +
          "," +
          ((60 + Math.random() * 20) | 0) +
          ",.9)";
        g.lineWidth = 2 + Math.random() * 1.5;
        g.beginPath();
        g.moveTo(x0, 0);
        g.quadraticCurveTo(x0 + sway, len * 0.6, x0 + sway * 0.6, len);
        g.stroke();
        for (var t = 0.15; t < 1; t += 0.12) {
          var lx = x0 + sway * (t * 1.6 - t * t * 0.6),
            ly = len * t;
          g.fillStyle =
            "rgba(" +
            ((96 + Math.random() * 40) | 0) +
            "," +
            ((125 + Math.random() * 35) | 0) +
            "," +
            ((66 + Math.random() * 20) | 0) +
            ",.95)";
          g.beginPath();
          g.ellipse(
            lx + (Math.random() * 10 - 5),
            ly,
            2.2,
            4.5,
            Math.random(),
            0,
            7,
          );
          g.fill();
        }
      }
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    function bannerTex(text) {
      var cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 200;
      var g = cv.getContext("2d");
      g.fillStyle = "#efe3c2";
      g.fillRect(0, 0, 64, 200);
      g.strokeStyle = "#8c4434";
      g.lineWidth = 5;
      g.strokeRect(4, 4, 56, 192);
      g.fillStyle = "#2e2a22";
      g.font = "bold 46px 'Noto Serif SC','STKaiti',serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      var chars = text.split("");
      chars.forEach(function (ch, i) {
        g.fillText(ch, 32, 100 + (i - (chars.length - 1) / 2) * 58);
      });
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    return {
      roofTex: roofTex,
      plankTex: plankTex,
      deckTex: deckTex,
      slabTex: slabTex,
      dirtTex: dirtTex,
      groundTex: groundTex,
      grassBladeTex: grassBladeTex,
      flowerTex: flowerTex,
      cloudTex: cloudTex,
      tilledTex: tilledTex,
      coupletTex: coupletTex,
      latticeTex: latticeTex,
      awningTex: awningTex,
      willowTex: willowTex,
      bannerTex: bannerTex,
    };
  }

  var TX = makeTextures();
  var M = {
    wood: new THREE.MeshLambertMaterial({ color: C.wood }),
    woodDark: new THREE.MeshLambertMaterial({ color: C.woodDark }),
    woodRed: new THREE.MeshLambertMaterial({ color: C.woodRed }),
    plaster: new THREE.MeshLambertMaterial({ color: C.plaster }),
    plaster2: new THREE.MeshLambertMaterial({ color: C.plaster2 }),
    roof: new THREE.MeshLambertMaterial({ map: TX.roofTex, color: 0xf2f5fa }),
    ridge: new THREE.MeshLambertMaterial({ color: 0x4a5058 }),
    stone: new THREE.MeshLambertMaterial({ color: C.stone }),
    stoneDark: new THREE.MeshLambertMaterial({ color: C.stoneDark }),
    deck: new THREE.MeshLambertMaterial({ map: TX.deckTex }),
    slab: new THREE.MeshLambertMaterial({ map: TX.slabTex }),
    dirt: new THREE.MeshLambertMaterial({ map: TX.dirtTex }),
    awning: new THREE.MeshLambertMaterial({
      map: TX.awningTex,
      side: THREE.DoubleSide,
    }),
    lattice: new THREE.MeshLambertMaterial({ map: TX.latticeTex }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x5e7a48 }),
    leafDark: new THREE.MeshLambertMaterial({ color: 0x4a6338 }),
    thatch: new THREE.MeshLambertMaterial({ color: 0x9a8254 }),
    grassBlade: new THREE.MeshLambertMaterial({
      map: TX.grassBladeTex,
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
    }),
    flower: new THREE.MeshLambertMaterial({
      map: TX.flowerTex,
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
    }),
    reed: new THREE.MeshLambertMaterial({ color: 0x7a8a4a }),
    rock: new THREE.MeshLambertMaterial({ color: 0x8a867c }),
    bush: new THREE.MeshLambertMaterial({ color: 0x55703e }),
    bamboo: new THREE.MeshLambertMaterial({ color: 0x6a9a52 }),
    lotus: new THREE.MeshLambertMaterial({
      color: 0x4a7a4a,
      side: THREE.DoubleSide,
    }),
    tilled: new THREE.MeshLambertMaterial({ map: TX.tilledTex }),
    crop: new THREE.MeshLambertMaterial({
      color: 0x6a9a4a,
      side: THREE.DoubleSide,
    }),
    lantern: new THREE.MeshLambertMaterial({
      color: C.lantern,
      emissive: 0x7a1408,
      emissiveIntensity: 0.55,
    }),
    willow: new THREE.MeshLambertMaterial({
      map: TX.willowTex,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    }),
  };
  var colliders = [],
    props = [],
    npcs = [],
    boats = [];

  var waterData = makeGround(scene, M, TX);
  var roadRects = [
    [0, 7, 400, 15],
    [20, 40, 12, 66],
    [-60, -74, 240, 12],
    [100, -74, 160, 12],
    [-120, 30, 12, 60],
    [-100, 30, 6, 26],
    [140, 30, 6, 26],
    [-40, 30, 6, 26],
  ];
  road(scene, 0, 7, 400, 15, TX.slabTex, 10, 0.02);
  road(scene, 20, 40, 12, 66, TX.dirtTex, 8, 0.032);
  road(scene, -60, -74, 240, 12, TX.dirtTex, 8, 0.028);
  road(scene, 100, -74, 160, 12, TX.dirtTex, 8, 0.03);
  road(scene, -120, 30, 12, 60, TX.dirtTex, 8, 0.032);
  for (var zi = 0; zi < 2; zi++) {
    var zz = zi === 0 ? -0.6 : 14.6;
    var curb = box(400, 0.12, 0.35, M.stone);
    curb.position.set(0, 0.05, zz);
    scene.add(curb);
  }
  road(scene, -100, 30, 6, 26, TX.dirtTex, 8, 0.042);
  road(scene, 140, 30, 6, 26, TX.dirtTex, 8, 0.042);
  road(scene, -40, 30, 6, 26, TX.dirtTex, 8, 0.042);
  makeBridge(scene, M, TX);

  function placeBuilding(opt, x, z, face) {
    var b = makeBuilding(opt, M, TX);
    b.position.set(x, 0, z);
    b.rotation.y = face;
    scene.add(b);
    var rot = Math.abs(Math.sin(face)) > 0.5;
    colliders.push({
      x: x,
      z: z,
      hw: (rot ? opt.d || 5 : opt.w || 6) / 2 + 0.4,
      hd: (rot ? opt.w || 6 : opt.d || 5) / 2 + 0.4,
    });
  }
  var northRow = [
    [-170, 6, 5, 1, "茶"],
    [-156, 7, 5, 1, null],
    [-142, 8, 6, 2, "宿"],
    [-126, 6, 5, 1, "米"],
    [-108, 7, 5, 1, null],
    [-92, 8, 6, 2, "绸"],
    [-74, 6, 5, 1, "药"],
    [-58, 7, 5, 1, null],
    [-40, 8, 6, 1, "书"],
    [-24, 6, 5, 1, null],
    [-6, 7, 5, 2, "酒"],
    [44, 7, 5, 1, "肉"],
    [60, 8, 6, 1, null],
    [76, 6, 5, 1, "茶"],
    [92, 8, 6, 2, "宿"],
    [112, 7, 5, 1, "米"],
    [130, 6, 5, 1, null],
    [148, 8, 6, 1, "绸"],
    [166, 7, 5, 1, "药"],
  ];
  northRow.forEach(function (r, i) {
    placeBuilding(
      {
        w: r[1],
        d: r[2],
        floors: r[3],
        banner: r[4],
        awning: !!r[4] && i % 2 === 0,
      },
      r[0],
      -6 - (i % 3) * 0.8,
      0,
    );
  });
  var southRow = [
    [-164, 7, 5, 1, "酒"],
    [-148, 8, 6, 1, null],
    [-130, 6, 5, 2, "宿"],
    [-112, 7, 5, 1, "书"],
    [-94, 6, 5, 1, "茶"],
    [-76, 8, 6, 1, "米"],
    [-58, 7, 5, 1, null],
    [-42, 6, 5, 1, "肉"],
    [-26, 7, 5, 2, "绸"],
    [-8, 6, 5, 1, null],
    [8, 8, 6, 1, "茶"],
    [36, 7, 5, 1, "药"],
    [52, 6, 5, 1, "书"],
    [70, 8, 6, 2, "酒"],
    [88, 6, 5, 1, null],
    [106, 7, 5, 1, "米"],
    [124, 8, 6, 1, "绸"],
    [142, 6, 5, 1, "茶"],
    [160, 7, 5, 2, "宿"],
    [176, 6, 5, 1, "肉"],
  ];
  southRow.forEach(function (r, i) {
    placeBuilding(
      {
        w: r[1],
        d: r[2],
        floors: r[3],
        banner: r[4],
        awning: !!r[4] && i % 2 === 1,
      },
      r[0],
      19 + (i % 3) * 1.2,
      Math.PI,
    );
  });
  [
    [-140, 7, 5, 1],
    [-122, 6, 5, 1],
    [-104, 8, 6, 1],
    [-84, 6, 5, 1],
    [-64, 7, 5, 1],
    [56, 6, 5, 1],
    [74, 7, 5, 1],
    [94, 8, 6, 1],
    [116, 6, 5, 1],
    [136, 7, 5, 1],
  ].forEach(function (r) {
    placeBuilding({ w: r[1], d: r[2], floors: r[3] }, r[0], -86, 0);
  });
  placeBuilding({ w: 6, d: 5, floors: 1, banner: "茶" }, -128, 48, Math.PI / 2);
  placeBuilding({ w: 7, d: 5, floors: 1 }, -112, 48, -Math.PI / 2);
  [
    [-166, 6, 5],
    [-150, 7, 5],
    [-132, 6, 5],
    [-114, 7, 5],
    [-96, 6, 5],
    [-78, 7, 5],
    [-60, 6, 5],
    [-44, 6, 5],
    [84, 6, 5],
    [100, 7, 5],
    [116, 6, 5],
    [132, 7, 5],
    [148, 6, 5],
    [164, 7, 5],
    [180, 6, 5],
  ].forEach(function (r, i) {
    placeBuilding(
      {
        w: r[1],
        d: r[2],
        floors: 1,
        plain: i % 3 === 0,
        thatched: i % 4 === 0,
      },
      r[0],
      36 + (i % 2) * 1.5,
      0,
    );
  });
  [
    [5, 46, 6, 5, "茶"],
    [5, 56, 7, 5, null],
    [5, 66, 6, 5, "肉"],
    [35, 46, 7, 5, "米"],
    [35, 56, 6, 5, null],
    [35, 66, 7, 5, "书"],
  ].forEach(function (r) {
    placeBuilding(
      { w: r[2], d: r[3], floors: 1, banner: r[4], plain: !r[4] },
      r[0],
      r[1],
      r[0] < 20 ? Math.PI / 2 : -Math.PI / 2,
    );
  });
  placeBuilding({ w: 6, d: 5, floors: 1, plain: true }, -186, -6, 0);
  placeBuilding({ w: 6, d: 5, floors: 1 }, 186, -6, 0);
  placeBuilding({ w: 7, d: 5, floors: 1, plain: true }, -184, 19, Math.PI);
  placeBuilding({ w: 6, d: 5, floors: 1 }, 184, 19, Math.PI);
  [
    [-160, 6, 5],
    [-48, 6, 5],
    [-32, 7, 5],
    [-14, 6, 5],
    [4, 7, 5],
    [22, 6, 5],
    [40, 7, 5],
    [154, 6, 5],
    [170, 7, 5],
  ].forEach(function (r, i) {
    placeBuilding(
      { w: r[1], d: r[2], floors: 1, plain: true, thatched: i % 2 === 0 },
      r[0],
      -86,
      0,
    );
  });
  placeBuilding(
    { w: 5, d: 4, floors: 1, plain: true, thatched: true },
    -180,
    -70,
    Math.PI / 2,
  );
  placeBuilding(
    { w: 5, d: 4, floors: 1, plain: true, thatched: true },
    186,
    -72,
    -Math.PI / 2,
  );
  var pag = new THREE.Group();
  var ww = 7,
    yy = 0;
  for (var t = 0; t < 5; t++) {
    var body = box(ww, 3.2, ww, M.woodDark);
    body.position.y = yy + 1.6;
    pag.add(body);
    addRoof(pag, ww + 0.5, ww + 0.5, yy + 3.2, 1.6, M);
    yy += 4.4;
    ww *= 0.82;
  }
  var spire = cyl(0.06, 0.3, 3.4, M.ridge);
  spire.position.y = yy + 2.2;
  pag.add(spire);
  var orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), M.lantern);
  orb.position.y = yy + 4;
  pag.add(orb);
  pag.position.set(-108, 0, -100);
  scene.add(pag);
  colliders.push({ x: -108, z: -100, hw: 4.5, hd: 4.5 });
  [
    [-190, -160, 90, 26],
    [-60, -180, 120, 32],
    [90, -170, 100, 24],
    [210, -120, 80, 20],
    [230, 80, 90, 22],
    [-230, 40, 80, 18],
  ].forEach(function (r) {
    var hill = new THREE.Mesh(
      new THREE.ConeGeometry(r[2], r[3], 7),
      new THREE.MeshLambertMaterial({ color: 0x8b9a80 }),
    );
    hill.position.set(r[0], r[3] / 2 - 2, r[1]);
    scene.add(hill);
  });

  function bunsFn(g) {
    for (var i = 0; i < 8; i++) {
      var b = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }),
      );
      b.position.set(-0.8 + (i % 4) * 0.32, 1, -0.3 + Math.floor(i / 4) * 0.4);
      g.add(b);
    }
    var st = box(0.9, 0.5, 0.9, M.woodDark);
    st.position.set(0.7, 1.15, 0);
    g.add(st);
  }
  function fabricsFn(g) {
    var cs = [0xa8463a, 0x4a5d7e, 0x5d6b5a, 0xb08a3e];
    cs.forEach(function (c, i) {
      var f = box(0.5, 0.16, 1, new THREE.MeshLambertMaterial({ color: c }));
      f.position.set(-0.9 + i * 0.6, 1, 0);
      g.add(f);
    });
  }
  function fruitsFn(g) {
    var cs = [0xc56a2a, 0xb13b2e, 0x8aa03e];
    for (var i = 0; i < 9; i++) {
      var f = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 6),
        new THREE.MeshLambertMaterial({ color: cs[i % 3] }),
      );
      f.position.set(-0.7 + (i % 3) * 0.4, 1, -0.3 + Math.floor(i / 3) * 0.35);
      g.add(f);
    }
  }
  function potsFn(g) {
    for (var i = 0; i < 5; i++) {
      var p = cyl(0.14, 0.2, 0.4, M.stoneDark, 8);
      p.position.set(-0.8 + i * 0.4, 1.1, (i % 2) * 0.4 - 0.2);
      g.add(p);
    }
  }

  makeStall(scene, M, colliders, props, 40, 12.5, Math.PI, "炊饼摊", bunsFn, [
    "蒸笼一掀，白汽腾起，麦香扑鼻。",
    "摊主笑道：热乎的炊饼，三文钱一个！",
    "墙上贴着红纸：炊饼·馒头·蒸糕。",
  ]);
  makeStall(
    scene,
    M,
    colliders,
    props,
    -48,
    12.5,
    Math.PI,
    "绸缎摊",
    fabricsFn,
    [
      "摊上绫罗绸缎，色色俱全。",
      "一匹湖水绿的绢，在阳光下泛着柔光。",
      "摊主正用木尺量布，口中念念有词。",
    ],
  );
  makeStall(scene, M, colliders, props, 84, 2.5, 0, "果子摊", fruitsFn, [
    "新摘的果子堆成小山，还带着晨露。",
    "有柿子、青梅与秋梨，酸甜的气息随风飘来。",
  ]);
  makeStall(scene, M, colliders, props, -88, 2.5, 0, "陶瓮摊", potsFn, [
    "粗陶瓮罐码放齐整，敲之铿然有声。",
    "最小的那只瓮上，还画着一朵拙朴的莲花。",
  ]);
  makeStall(scene, M, colliders, props, 20, 32, Math.PI / 2, "茶摊", potsFn, [
    "粗瓷大碗，茉莉香片。",
    "茶博士提着长嘴铜壶，远远地冲出一道水线，滴水不溅。",
    "几位脚夫歇脚饮茶，谈的都是河上的行情。",
  ]);
  makeStall(scene, M, colliders, props, -16, 30, 0, "字画摊", fabricsFn, [
    "摊上悬着几幅山水，笔墨清润。",
    "一幅溪山行旅，颇有范宽笔意。",
  ]);

  [
    [-150, 0],
    [-110, 14],
    [-70, 0],
    [-30, 14],
    [8, 0],
    [48, 14],
    [88, 0],
    [128, 14],
    [168, 0],
  ].forEach(function (r) {
    var pole = cyl(0.07, 0.09, 4.2, M.woodDark);
    pole.position.set(r[0], 2.1, r[1]);
    scene.add(pole);
    var arm = box(1, 0.08, 0.08, M.woodDark);
    arm.position.set(r[0] + (r[1] ? -0.4 : 0.4), 4, r[1]);
    scene.add(arm);
    var lan = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), M.lantern);
    lan.scale.y = 0.85;
    lan.position.set(r[0] + (r[1] ? -0.85 : 0.85), 3.7, r[1]);
    scene.add(lan);
    colliders.push({ x: r[0], z: r[1], hw: 0.25, hd: 0.25 });
  });
  props.push({
    x: -110,
    z: 14,
    r: 3,
    name: "灯笼",
    idx: 0,
    lines: [
      "竹骨纱面的灯笼，上书王家纸马。",
      "灯下挂着小小木牌：灯下莫久留，当心火烛。",
    ],
  });

  var sedan = new THREE.Group();
  var sbody = box(
    1.4,
    1.6,
    1.6,
    new THREE.MeshLambertMaterial({ color: 0x3f5e5a }),
  );
  sbody.position.y = 1.3;
  sedan.add(sbody);
  addRoof(sedan, 1.6, 1.8, 2.2, 0.5, M);
  for (var s = -1; s <= 1; s += 2) {
    var sp = cyl(0.05, 0.05, 3.4, M.woodRed);
    sp.rotation.z = Math.PI / 2;
    sp.position.set(0, 0.9, s * 0.95);
    sedan.add(sp);
  }
  sedan.position.set(-34, 0, 15);
  sedan.rotation.y = 0.4;
  scene.add(sedan);
  colliders.push({ x: -34, z: 15, hw: 1.4, hd: 1.4 });
  props.push({
    x: -34,
    z: 15,
    r: 3,
    name: "青呢小轿",
    idx: 0,
    lines: ["一顶青呢小轿停在路边，轿帘半掩。", "轿夫蹲在墙根打盹，鼾声细细。"],
  });

  var well = new THREE.Group();
  var rim = cyl(0.8, 0.9, 0.7, M.stone, 10);
  rim.position.y = 0.35;
  well.add(rim);
  for (var s = -1; s <= 1; s += 2) {
    var wp = box(0.12, 1.6, 0.12, M.woodDark);
    wp.position.set(s * 0.8, 0.8, 0);
    well.add(wp);
  }
  var wbar = cyl(0.06, 0.06, 1.7, M.woodDark);
  wbar.rotation.z = Math.PI / 2;
  wbar.position.y = 1.55;
  well.add(wbar);
  var bucket = box(0.3, 0.3, 0.3, M.wood);
  bucket.position.set(0.3, 0.15, 0.9);
  well.add(bucket);
  well.position.set(64, 0, 16);
  scene.add(well);
  colliders.push({ x: 64, z: 16, hw: 1, hd: 1 });
  props.push({
    x: 64,
    z: 16,
    r: 3,
    name: "老井",
    idx: 0,
    lines: [
      "一口老井，井沿青石被井绳磨出深深凹痕。",
      "探头望去，井水幽深，映出你的脸。",
    ],
  });

  makeUmbrella(scene, M, colliders, -6, 27, 0xa8463a);
  makeUmbrella(scene, M, colliders, 34, 38, 0x4a6a8a);
  makeUmbrella(scene, M, colliders, 58, 26, 0xb08a3e);
  var oxcart = new THREE.Group();
  var obox = box(1.6, 0.18, 3.2, M.wood);
  obox.position.y = 1;
  oxcart.add(obox);
  for (var s = -1; s <= 1; s += 2) {
    var rail = box(0.08, 0.5, 3.2, M.woodDark);
    rail.position.set(s * 0.8, 1.3, 0);
    oxcart.add(rail);
    var wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.12, 14),
      M.woodDark,
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 0.95, 0.75, 0);
    wheel.castShadow = true;
    oxcart.add(wheel);
    var hub = cyl(0.14, 0.14, 0.2, M.wood);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(s * 0.95, 0.75, 0);
    oxcart.add(hub);
    var shaft = cyl(0.05, 0.06, 2.6, M.woodDark);
    shaft.rotation.x = Math.PI / 2 - 0.12;
    shaft.position.set(s * 0.5, 0.85, 2.6);
    oxcart.add(shaft);
  }
  for (var i = 0; i < 4; i++) {
    var sack = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xb09a6a }),
    );
    sack.scale.set(1, 0.65, 1.15);
    sack.position.set(
      (i % 2) * 0.6 - 0.3,
      1.25,
      -0.8 + Math.floor(i / 2) * 1.3,
    );
    oxcart.add(sack);
  }
  oxcart.position.set(-64, 0, 26);
  oxcart.rotation.y = 0.5;
  scene.add(oxcart);
  colliders.push({ x: -64, z: 26, hw: 1.6, hd: 2.8 });
  props.push({
    x: -64,
    z: 26,
    r: 3.5,
    name: "牛车",
    idx: 0,
    lines: [
      "一辆牛车满载粮袋，老牛慢悠悠地嚼着草。",
      "车把式蹲在墙根，正就着咸菜啃炊饼。",
    ],
  });

  for (var x = -180; x <= 180; x += 22) {
    if (Math.abs(x - WORLD.bridgeX) > 9)
      makeWillow(
        scene,
        M,
        x + (Math.random() * 6 - 3),
        -15.2,
        0.9 + Math.random() * 0.4,
        colliders,
      );
    if (Math.abs(x - WORLD.bridgeX) > 12)
      makeWillow(
        scene,
        M,
        x + 11 + (Math.random() * 5 - 2),
        -64.8,
        0.85 + Math.random() * 0.4,
        colliders,
      );
  }
  [
    [-160, 26],
    [-120, -2],
    [-86, 30],
    [-52, 28],
    [-14, 34],
    [36, 30],
    [70, 34],
    [110, 28],
    [150, 32],
    [180, 26],
    [-150, -70],
    [-96, -68],
    [-40, -70],
    [48, -68],
    [104, -70],
    [158, -68],
    [-136, 44],
    [-104, 52],
    [120, 44],
    [150, 44],
  ].forEach(function (r, i) {
    if (i % 3 === 0) makeWillow(scene, M, r[0], r[1], 1.1, colliders);
    else
      makeTree(
        scene,
        M,
        r[0],
        r[1],
        0.9 + (i % 4) * 0.15,
        i % 2 === 0,
        colliders,
      );
  });
  for (var i = 0; i < 26; i++) {
    var x = Math.random() * 460 - 230,
      z = Math.random() * 180 - 105;
    if (z > -16 && z < 30) continue;
    if (Math.abs(x - WORLD.bridgeX) < 10 && z < 0 && z > -70) continue;
    makeTree(
      scene,
      M,
      x,
      z,
      1.2 + Math.random(),
      Math.random() > 0.5,
      colliders,
    );
  }

  var scn = makeScenery(scene, M, TX, colliders, roadRects);
  makeBamboo(scene, M, -152, 28, colliders);
  makeBamboo(scene, M, 142, 42, colliders);
  makeBamboo(scene, M, -96, -92, colliders);
  makeBamboo(scene, M, 60, -93, colliders);
  makeBamboo(scene, M, 176, 30, colliders);
  makeField(scene, M, -120, -81.5, 26, 3.4, scn._dummy);
  makeField(scene, M, -66, -81.5, 18, 3.4, scn._dummy);
  makeField(scene, M, 80, -81.5, 22, 3.4, scn._dummy);
  makeField(scene, M, 130, -81.5, 20, 3.4, scn._dummy);
  makeField(scene, M, 60, 56, 16, 8, scn._dummy);
  makeField(scene, M, 104, 58, 18, 9, scn._dummy);
  makeField(scene, M, 146, 55, 16, 8, scn._dummy);
  makeField(scene, M, -42, 62, 16, 8, scn._dummy);
  makeField(scene, M, -92, 58, 18, 9, scn._dummy);

  var scare = new THREE.Group();
  var sp = cyl(0.05, 0.06, 2.2, M.woodDark);
  sp.position.y = 1.1;
  scare.add(sp);
  var sa = box(1.4, 0.07, 0.07, M.woodDark);
  sa.position.y = 1.6;
  scare.add(sa);
  var sc = cyl(0.2, 0.45, 1, M.thatch, 8);
  sc.position.y = 1.1;
  scare.add(sc);
  var sh = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xd8b880 }),
  );
  sh.position.y = 1.95;
  scare.add(sh);
  var hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.2, 10),
    new THREE.MeshLambertMaterial({ color: 0xb09a5e }),
  );
  hat.position.y = 2.1;
  scare.add(hat);
  scare.position.set(104, 0, 58);
  scare.rotation.y = 0.6;
  scene.add(scare);
  props.push({
    x: 104,
    z: 58,
    r: 3,
    name: "稻草人",
    idx: 0,
    lines: [
      "稻草人戴着破斗笠，袖管在风里一荡一荡。",
      "田雀不怕它，落在肩头叽叽喳喳。",
    ],
  });

  makeBoat(scene, M, -120, -40, 9, true, boats, Math.PI / 2);
  makeBoat(scene, M, 80, -46, 8, false, boats, Math.PI / 2 + 0.12);
  makeBoat(scene, M, -40, -33, 7, false, boats, Math.PI / 2 - 0.1);
  makeBoat(scene, M, 150, -36, 10, false, boats, Math.PI / 2 + 0.06);
  makeBoat(scene, M, -170, -48, 8, false, boats, Math.PI / 2 - 0.05);
  props.push({
    x: 80,
    z: -46,
    r: 6,
    name: "乌篷货船",
    idx: 0,
    lines: [
      "船身遍刷桐油，舱里堆着麻袋与瓷坛。",
      "船家在舱中煮饭，炊烟混着水汽袅袅而起。",
    ],
  });
  props.push({
    x: -40,
    z: -33,
    r: 6,
    name: "客船",
    idx: 0,
    lines: [
      "舱中传出丝竹之声，似有人在赴宴途中。",
      "船窗竹帘半卷，露出半张读书的脸。",
    ],
  });

  var clouds = [];
  for (var i = 0; i < 8; i++) {
    var csp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: TX.cloudTex,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    csp.scale.set(50 + Math.random() * 40, 18 + Math.random() * 12, 1);
    csp.position.set(
      Math.random() * 480 - 240,
      45 + Math.random() * 25,
      Math.random() * 220 - 160,
    );
    scene.add(csp);
    clouds.push({ sp: csp, v: 0.5 + Math.random() * 0.7 });
  }
  var birds = [];
  for (var i = 0; i < 5; i++) {
    var bg = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({
      color: 0x3a352c,
      side: THREE.DoubleSide,
    });
    var wl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), mat);
    var wr = wl.clone();
    wl.position.x = -0.42;
    wr.position.x = 0.42;
    bg.add(wl);
    bg.add(wr);
    bg.position.set(
      Math.random() * 300 - 150,
      14 + Math.random() * 10,
      Math.random() * 160 - 100,
    );
    scene.add(bg);
    birds.push({
      g: bg,
      wl: wl,
      wr: wr,
      v: 4 + Math.random() * 3,
      dir: Math.random() > 0.5 ? 1 : -1,
      ph: Math.random() * 6.28,
    });
  }

  for (var ri = 0; ri < npcItems.length; ri++) {
    spawnNPC(scene, M, npcs, npcItems[ri]);
  }
  var player = {
    g: makePerson({ robe: 0x3f5e8c, hat: "futou" }, C.skin),
    pos: new THREE.Vector3(6, 0, 7),
    yaw: Math.PI * 0.9,
    pitch: 0.32,
    firstPerson: false,
    walkPhase: 0,
    vy: 0,
    jumps: 0,
    grounded: true,
  };
  player.g.position.copy(player.pos);
  scene.add(player.g);
  var ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffd98a,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  function resolveCollision(p, r) {
    r = r || 0.42;
    for (var ci = 0; ci < colliders.length; ci++) {
      var c = colliders[ci];
      var dx = p.x - c.x,
        dz = p.z - c.z;
      if (Math.abs(dx) < c.hw + r && Math.abs(dz) < c.hd + r) {
        var px = c.hw + r - Math.abs(dx),
          pz = c.hd + r - Math.abs(dz);
        if (px < pz) p.x = c.x + Math.sign(dx || 0.01) * (c.hw + r);
        else p.z = c.z + Math.sign(dz || 0.01) * (c.hd + r);
      }
    }
    var inRiver = p.z < WORLD.riverS + 0.3 && p.z > WORLD.riverN - 0.3;
    if (inRiver && Math.abs(p.x - WORLD.bridgeX) > WORLD.bridgeHalf - 0.25)
      p.z =
        p.z > (WORLD.riverS + WORLD.riverN) / 2
          ? WORLD.riverS + 0.3
          : WORLD.riverN - 0.3;
    if (
      p.z <= -14 &&
      p.z >= -66 &&
      Math.abs(p.x - WORLD.bridgeX) < WORLD.bridgeHalf + 1.2
    )
      p.x =
        WORLD.bridgeX +
        Math.sign(p.x - WORLD.bridgeX || 0.01) *
          Math.min(Math.abs(p.x - WORLD.bridgeX), WORLD.bridgeHalf - 0.25);
    p.x = Math.max(-225, Math.min(225, p.x));
    p.z = Math.max(-100, Math.min(90, p.z));
  }

  var clock = new THREE.Clock(),
    elapsed = 0,
    dlgTarget = null,
    jumpUnsub = null;
  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    for (var ni = 0; ni < npcs.length; ni++)
      updateNPC(npcs[ni], dt, player.pos, npcs);
    updatePlayer(dt);
    updateInteraction();
    var wpos = waterData.waterGeo.attributes.position,
      wbase = waterData.waterBase;
    for (var i = 0; i < wpos.count; i++) {
      var x = wbase[i * 3],
        y = wbase[i * 3 + 1];
      wpos.array[i * 3 + 2] =
        Math.sin(x * 0.08 + elapsed * 1.1) * 0.1 +
        Math.cos(y * 0.3 + elapsed * 0.7) * 0.06;
    }
    wpos.needsUpdate = true;
    for (var bi = 0; bi < boats.length; bi++) {
      var b = boats[bi];
      b.g.position.y = -0.35 + Math.sin(elapsed * 0.9 + b.phase) * 0.05;
      b.g.rotation.z = Math.sin(elapsed * 0.7 + b.phase) * 0.015;
      if (b.speed > 0) {
        b.g.position.x += b.speed * dt;
        if (b.g.position.x > 220) b.g.position.x = -220;
        var near = Math.abs(b.g.position.x - WORLD.bridgeX) < 28;
        b.mastDown += ((near ? 1 : 0) - b.mastDown) * Math.min(1, dt * 1.6);
        if (b.mast) b.mast.rotation.x = b.mastDown * 1.35;
      }
    }
    for (var ci = 0; ci < clouds.length; ci++) {
      var c = clouds[ci];
      c.sp.position.x += c.v * dt;
      if (c.sp.position.x > 260) c.sp.position.x = -260;
    }
    for (var bi2 = 0; bi2 < birds.length; bi2++) {
      var b2 = birds[bi2];
      b2.g.position.x += b2.v * b2.dir * dt;
      b2.g.position.y += Math.sin(elapsed * 2 + b2.ph) * 0.15 * dt;
      var flap = Math.sin(elapsed * 9 + b2.ph) * 0.55;
      b2.wl.rotation.y = flap;
      b2.wr.rotation.y = -flap;
      if (b2.g.position.x * b2.dir > 250) {
        b2.g.position.x = -250 * b2.dir;
        b2.g.position.z = Math.random() * 160 - 100;
      }
    }
    renderer.render(scene, camera);
  }

  function updatePlayer(dt) {
    var f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    var r = new THREE.Vector3(-Math.cos(player.yaw), 0, Math.sin(player.yaw));
    var move = new THREE.Vector3();
    if (keys.KeyW) move.add(f);
    if (keys.KeyS) move.sub(f);
    if (keys.KeyD) move.add(r);
    if (keys.KeyA) move.sub(r);
    var run = keys.ShiftLeft || keys.ShiftRight;
    var speed = move.lengthSq() > 0 ? (run ? 5.6 : 3.1) : 0;
    if (speed > 0) {
      move.normalize().multiplyScalar(speed * dt);
      player.pos.add(move);
      resolveCollision(player.pos);
      var tRot = Math.atan2(move.x, move.z);
      var dr = tRot - player.g.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      player.g.rotation.y += dr * Math.min(1, dt * 10);
      player.walkPhase += dt * speed * 1.9;
      var sw = Math.sin(player.walkPhase);
      player.g.userData.armL.rotation.x = sw * 0.6;
      player.g.userData.armR.rotation.x = -sw * 0.6;
    } else if (player.grounded) {
      var u = player.g.userData;
      u.armL.rotation.x *= 0.85;
      u.armR.rotation.x *= 0.85;
    }
    var gY = groundHeight(player.pos.x, player.pos.z);
    if (!player.grounded || player.pos.y > gY + 0.001) {
      player.vy -= 12.5 * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= gY) {
        player.pos.y = gY;
        player.vy = 0;
        player.jumps = 0;
        player.grounded = true;
      }
      player.g.userData.armL.rotation.x = -0.5;
      player.g.userData.armR.rotation.x = -0.5;
    } else player.pos.y = gY;
    player.g.position.copy(player.pos);
    player.g.position.y +=
      speed > 0 && player.grounded
        ? Math.abs(Math.cos(player.walkPhase)) * 0.05
        : 0;
    var headY = player.pos.y + 1.66;
    var dir = new THREE.Vector3(
      Math.sin(player.yaw) * Math.cos(player.pitch),
      Math.sin(player.pitch),
      Math.cos(player.yaw) * Math.cos(player.pitch),
    );
    if (player.firstPerson) {
      camera.position.set(player.pos.x, headY, player.pos.z);
      camera.lookAt(player.pos.x + dir.x, headY + dir.y, player.pos.z + dir.z);
    } else {
      var dist = 6.4;
      var cp = new THREE.Vector3(
        player.pos.x,
        headY + 0.35,
        player.pos.z,
      ).addScaledVector(dir, -dist);
      var minY = groundHeight(cp.x, cp.z) + 0.5;
      if (cp.y < minY) cp.y = minY;
      camera.position.lerp(cp, Math.min(1, dt * 10));
      camera.lookAt(player.pos.x, headY + 0.2, player.pos.z);
    }
  }

  function nearestInteractable() {
    var best = null,
      bd = 1e9;
    for (var ni = 0; ni < npcs.length; ni++) {
      var n = npcs[ni];
      var d = Math.hypot(
        n.g.position.x - player.pos.x,
        n.g.position.z - player.pos.z,
      );
      if (d < 3.4 && d < bd) {
        bd = d;
        best = {
          kind: "npc",
          name: n.name,
          ref: n,
          x: n.g.position.x,
          z: n.g.position.z,
        };
      }
    }
    for (var pi = 0; pi < props.length; pi++) {
      var p = props[pi];
      var d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < p.r && d < bd) {
        bd = d;
        best = { kind: "prop", name: p.name, ref: p, x: p.x, z: p.z };
      }
    }
    return best;
  }

  function updateInteraction() {
    var t = nearestInteractable();
    var tipEl = $(".tip");
    var tipText = $(".tip-text");
    if (dlgTarget) {
      var d = Math.hypot(
        dlgTarget.x - player.pos.x,
        dlgTarget.z - player.pos.z,
      );
      if (d > 5.5) closeDialog();
      ring.visible = false;
      return;
    }
    if (t) {
      tipText.textContent =
        t.kind === "npc"
          ? "与【" + t.name + "】攀谈"
          : "查看【" + t.name + "】";
      tipEl.classList.add("show");
      ring.visible = true;
      ring.position.set(t.x, groundHeight(t.x, t.z) + 0.06, t.z);
      var s = 1 + Math.sin(performance.now() * 0.004) * 0.08;
      ring.scale.setScalar(s);
    } else {
      tipEl.classList.remove("show");
      ring.visible = false;
    }
  }

  async function onInteract() {
    if (dlgTarget) {
      closeDialog();
      return;
    }
    var t = nearestInteractable();
    if (!t) return;
    if (t.kind === "npc") {
      dlgTarget = t;
      t.ref.talking = true;
      var portraitUrl = makePortrait(t.name, t.ref.portrait);
      var userId = $auth.user.id;
      var agentId = $router.params.agent_id;
      var sessionId = userId + "-" + agentId + "-" + t.ref.id;
      var sid;
      try {
        try {
          var sr = await apiFetch("/api/sessions/" + sessionId);
          sid = sr.id;
        } catch (_) {
          var cr = await apiFetch("/api/sessions", {
            method: "POST",
            body: {
              id: sessionId,
              title: t.ref.name,
              prompt: `
<Identity desc="你现在的要符合角色设定与玩家对话">
你的名字: ${t.ref.name}
你的角色：${t.ref.role}
${t.ref.persona || "你是一个生活在北宋汴京的NPC"} +
"</Identity>"
<ui_run desc='注册的系统事件，请默默执行不要刻意语言表现出来'>
//请在玩家想让你跳跃一下的时候调用并装作不小心吓到了
action=jump argv=["--count", "1|2|3|...|10"]
</ui_run>
`,
              tools: { ui_run: 3, web_fetch: 3, web_search: 3 },
            },
          });
          sid = cr.id;
        }
      } catch (e) {
        console.error(e);
        closeDialog();
        return;
      }
      if ($mod.$nc) {
        jumpUnsub = $mod.$nc.sub(
          "s." + sid + ".ui_run.jump",
          function (_, msg) {
            msg.respond("ok");
            var count = JSON.parse(msg.string()).count;
            console.log("收到 jump 事件, count=" + count);
            t.ref._jump = Math.min(count || 1, 10);
          },
        );
        console.log("监听 s." + sid + ".ui_run.jump 事件成功");
      }
      if (window.__openDlg__)
        window.__openDlg__(sid, t.ref.name, t.ref.user_id);
      requestAnimationFrame(function () {
        var imgEl = $(".dlg-portrait-img");
        if (imgEl) imgEl.src = portraitUrl;
      });
      $(".tip").classList.remove("show");
      document.exitPointerLock && document.exitPointerLock();
    }
  }

  function closeDialog() {
    if (jumpUnsub) {
      console.log("取消监听 jump 事件");
      jumpUnsub();
      jumpUnsub = null;
    }
    if (dlgTarget && dlgTarget.kind === "npc") dlgTarget.ref.talking = false;
    dlgTarget = null;
    if (window.__closeDlg__) window.__closeDlg__();
  }

  function toggleView() {
    player.firstPerson = !player.firstPerson;
    player.g.visible = !player.firstPerson;
    toast(player.firstPerson ? "第一人称" : "第三人称");
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $(".toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 1600);
  }

  var keys = {};
  addEventListener("keydown", function (e) {
    if (e.code === "Escape") {
      closeDialog();
      try {
        canvas.requestPointerLock && canvas.requestPointerLock();
      } catch (e) {}
      return;
    }
    if (dlgTarget) return;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ShiftLeft",
        "ShiftRight",
        "Space",
      ].indexOf(e.code) >= 0
    )
      e.preventDefault();
    keys[e.code] = true;
    if (e.code === "KeyF") onInteract();
    if (e.code === "KeyV") toggleView();
    if (e.code === "Space") {
      if (player.jumps >= 2) return;
      player.vy = player.jumps === 0 ? 4.6 : 4.2;
      player.jumps++;
      player.grounded = false;
    }
    if (e.code === "KeyH") $(".hint").classList.toggle("hide");
  });
  addEventListener("keyup", function (e) {
    keys[e.code] = false;
  });
  var locked = false,
    dragging = false,
    lastX = 0,
    lastY = 0;
  canvas.addEventListener("click", function () {
    if (!locked) canvas.requestPointerLock && canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", function () {
    locked = document.pointerLockElement === canvas;
  });
  canvas.addEventListener("mousedown", function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  addEventListener("mouseup", function () {
    dragging = false;
  });
  addEventListener("mousemove", function (e) {
    var dx = 0,
      dy = 0;
    if (locked) {
      dx = e.movementX;
      dy = e.movementY;
    } else if (dragging) {
      dx = e.clientX - lastX;
      dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    } else return;
    player.yaw -= dx * 0.0024;
    player.pitch += dy * 0.0022 * (player.firstPerson ? -1 : 1);
    player.pitch = Math.max(-1.25, Math.min(1.35, player.pitch));
  });

  addEventListener("resize", function () {
    var w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  // === 桌面端：拖拽调整对话框宽度（事件委托，兼容 v-if） ===
  var resizing = false;
  addEventListener("mousedown", function (e) {
    if (!e.target.closest || !e.target.closest("#dlgResizeHandle")) return;
    e.preventDefault();
    resizing = true;
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
  });
  addEventListener("mousemove", function (e) {
    if (!resizing) return;
    var paper = document.querySelector(".dlg-paper");
    if (!paper) return;
    var w = window.innerWidth - e.clientX;
    w = Math.max(260, Math.min(w, Math.floor(window.innerWidth * 0.6)));
    paper.style.width = w + "px";
  });
  addEventListener("mouseup", function () {
    if (resizing) {
      resizing = false;
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    }
  });

  // === 移动端触控 ===
  var isMobile =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches ||
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (window.location.search || "").indexOf("mobile=1") >= 0;
  console.log(
    "[mobile] isMobile=" +
      isMobile +
      " touch=" +
      ("ontouchstart" in window) +
      " points=" +
      navigator.maxTouchPoints +
      " coarse=" +
      window.matchMedia("(pointer: coarse)").matches,
  );
  if (isMobile) {
    document.body.classList.add("is-mobile");

    // --- 虚拟摇杆 ---
    var joyBase = document.getElementById("joyBase");
    var joyThumb = document.getElementById("joyThumb");
    var joyActive = false,
      joyId = null;
    var joyDX = 0,
      joyDY = 0;
    var joyCX = 0,
      joyCY = 0;

    function updateJoyThumb() {
      var r = Math.min(Math.hypot(joyDX, joyDY), 44);
      var a = Math.atan2(joyDY, joyDX);
      joyThumb.style.transform =
        "translate(" + Math.cos(a) * r + "px, " + Math.sin(a) * r + "px)";
      keys.KeyW = joyDY < -10;
      keys.KeyS = joyDY > 10;
      keys.KeyA = joyDX < -10;
      keys.KeyD = joyDX > 10;
    }

    function resetJoy() {
      joyActive = false;
      joyId = null;
      joyDX = 0;
      joyDY = 0;
      joyThumb.style.transform = "translate(0,0)";
      keys.KeyW = keys.KeyA = keys.KeyS = keys.KeyD = false;
      joyBase.classList.remove("active");
    }

    joyBase.addEventListener(
      "touchstart",
      function (e) {
        e.preventDefault();
        if (joyActive) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          var rect = joyBase.getBoundingClientRect();
          if (
            t.clientX >= rect.left &&
            t.clientX <= rect.right &&
            t.clientY >= rect.top &&
            t.clientY <= rect.bottom
          ) {
            joyId = t.identifier;
            joyActive = true;
            joyCX = rect.left + rect.width / 2;
            joyCY = rect.top + rect.height / 2;
            joyDX = t.clientX - joyCX;
            joyDY = t.clientY - joyCY;
            updateJoyThumb();
            joyBase.classList.add("active");
            break;
          }
        }
      },
      { passive: false },
    );

    joyBase.addEventListener(
      "touchmove",
      function (e) {
        e.preventDefault();
        if (!joyActive) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === joyId) {
            joyDX = e.changedTouches[i].clientX - joyCX;
            joyDY = e.changedTouches[i].clientY - joyCY;
            updateJoyThumb();
            break;
          }
        }
      },
      { passive: false },
    );

    joyBase.addEventListener("touchend", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyId) {
          resetJoy();
          break;
        }
      }
    });

    joyBase.addEventListener("touchcancel", function (e) {
      resetJoy();
    });

    // --- 右侧屏幕拖拽旋转视角 ---
    var camTouchId = null;
    var camLastX = 0,
      camLastY = 0;
    var canvasEl2 = canvas;

    canvasEl2.addEventListener(
      "touchstart",
      function (e) {
        if (dlgTarget) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          // 右侧半屏或非摇杆区域用于视角
          if (t.clientX > window.innerWidth * 0.45 && camTouchId == null) {
            camTouchId = t.identifier;
            camLastX = t.clientX;
            camLastY = t.clientY;
          }
        }
      },
      { passive: false },
    );

    canvasEl2.addEventListener(
      "touchmove",
      function (e) {
        if (dlgTarget) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier === camTouchId) {
            var dx = t.clientX - camLastX;
            var dy = t.clientY - camLastY;
            camLastX = t.clientX;
            camLastY = t.clientY;
            player.yaw -= dx * 0.003;
            player.pitch += dy * 0.0028 * (player.firstPerson ? -1 : 1);
            player.pitch = Math.max(-1.25, Math.min(1.35, player.pitch));
          }
        }
      },
      { passive: false },
    );

    canvasEl2.addEventListener("touchend", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === camTouchId) {
          camTouchId = null;
          break;
        }
      }
    });

    canvasEl2.addEventListener("touchcancel", function (e) {
      camTouchId = null;
    });

    // --- 对话框关闭：事件委托兼容 v-if ---
    addEventListener("click", function (e) {
      if (!dlgTarget) return;
      // 关闭按钮
      if (e.target.closest && e.target.closest("#dlgCloseBtn")) {
        closeDialog();
        return;
      }
      // 点击纸面内部不触发
      var paper = document.querySelector(".dlg-paper");
      if (paper && paper.contains(e.target)) return;
      // 点击 .dlg 外部也不触发
      var dlg = document.querySelector(".dlg");
      if (!dlg || !dlg.contains(e.target)) return;
      closeDialog();
    });

    // --- 按钮 ---
    function bindBtn(id, handler) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(
        "touchstart",
        function (e) {
          e.preventDefault();
          el.classList.add("pressed");
          handler(true);
        },
        { passive: false },
      );
      el.addEventListener(
        "touchend",
        function (e) {
          e.preventDefault();
          el.classList.remove("pressed");
          handler(false);
        },
        { passive: false },
      );
      el.addEventListener("touchcancel", function (e) {
        el.classList.remove("pressed");
        handler(false);
      });
    }

    // 疾跑
    var running = false;
    bindBtn("mbtnRun", function (down) {
      running = down;
      keys.ShiftLeft = down;
    });

    // 跳跃
    bindBtn("mbtnJump", function (down) {
      if (!down) return;
      if (dlgTarget) {
        closeDialog();
        return;
      }
      if (player.jumps >= 2) return;
      player.vy = player.jumps === 0 ? 4.6 : 4.2;
      player.jumps++;
      player.grounded = false;
    });

    // 交谈/交互
    bindBtn("mbtnInteract", function (down) {
      if (!down) return;
      onInteract();
    });

    // 视角切换
    bindBtn("mbtnView", function (down) {
      if (!down) return;
      toggleView();
    });
  }

  animate();
  setTimeout(function () {
    $(".loading").classList.add("done");
    $(".title").classList.add("show");
    toast("点击画面进入汴京");
  }, 900);
}
