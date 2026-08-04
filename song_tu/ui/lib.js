import * as THREE from "./three.module.js";
import { C, box, cyl, createEngine } from "./engine.js";
import { makeTextures } from "./textures.js";
import { buildMaterials, GENERATORS } from "./generators.js";
import {
  groundHeight,
  makeGround,
  road,
  makeBridge,
  makeSky,
  makeCityWall,
} from "./world.js";
import {
  makeHero,
  spawnNPC,
  updateNPC,
  makePortrait,
  clearCaches,
} from "./npc.js";

export function initGame(canvasEl, root, $mod, $auth, $router) {
  const canvas = canvasEl;
  const apiFetch = $mod.$fetch;
  const $ = root
    ? (sel) => root.querySelector(sel)
    : (sel) => document.querySelector(sel);
  const { renderer, scene, camera } = createEngine(canvas);
  const TX = makeTextures();
  const M = buildMaterials(TX);
  const sky = makeSky(TX);
  scene.add(sky);
  const sharedMats = new Set(Object.values(M));
  const sharedTex = new Set(Object.values(TX));

  // 持久玩家与选中光环（跨城市保留）
  const player = {
    g: makeHero(C.skin),
    pos: new THREE.Vector3(6, 0, 7),
    yaw: Math.PI * 0.9,
    pitch: 0.32,
    firstPerson: false,
    walkPhase: 0,
    vy: 0,
    jumps: 0,
    grounded: true,
    _dance: false,
  };
  const phaseTo01 = (ph) => {
    let t = (ph / (Math.PI * 2)) % 1;
    return t < 0 ? t + 1 : t;
  };
  scene.add(player.g);
  const ring = new THREE.Mesh(
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

  let S = null; // 当前城市状态
  let dlgTarget = null,
    unsubPageExec = null;   // 上一会话注销函数（sub 返回）
  let propTarget = null,
    propIdx = 0;
  const clock = new THREE.Clock();
  let elapsed = 0;

  // ---------- 建筑行解析 ----------
  function parseBuilding(row) {
    const model =
      typeof row.model === "string"
        ? JSON.parse(row.model || "{}")
        : row.model || {};
    let lines = [];
    try {
      lines =
        typeof row.lines === "string"
          ? JSON.parse(row.lines || "[]")
          : row.lines || [];
    } catch (e) {
      lines = [];
    }
    let x = 0,
      z = 0;
    if (row.loc) {
      const p = row.loc.split(",").map(Number);
      x = p[0];
      z = p[1];
    }
    return {
      name: row.name,
      kind: row.kind,
      x,
      z,
      rot: row.rot || 0,
      scale: row.scale || 1,
      model,
      lines,
      interactable: !!row.interactable,
      collider: row.collider !== false,
    };
  }

  // ---------- 散布（植被/石） ----------
  function runScatter(world, ctx) {
    const rules = world.scatter || [];
    const rv = world.river,
      br = world.bridge;
    const bx = world.boundary.x;
    const roadRects = (world.roads || []).map((r) => [r.x, r.z, r.w, r.d]);
    const xR = bx - 20,
      zMin = world.boundary.zFar + 10,
      zMax = world.boundary.zNear - 10;
    const randX = () => Math.random() * 2 * xR - xR;
    const randZ = () => zMin + Math.random() * (zMax - zMin);
    function isFree(x, z, m) {
      m = m || 1;
      if (rv && z > rv.zN && z < rv.zS) return false;
      for (let i = 0; i < roadRects.length; i++) {
        const rc = roadRects[i];
        if (
          Math.abs(x - rc[0]) < rc[2] / 2 + m &&
          Math.abs(z - rc[1]) < rc[3] / 2 + m
        )
          return false;
      }
      for (let i = 0; i < ctx.colliders.length; i++) {
        const c = ctx.colliders[i];
        if (Math.abs(x - c.x) < c.hw + m && Math.abs(z - c.z) < c.hd + m)
          return false;
      }
      return true;
    }
    const dummy = ctx.dummy;
    function instanced(geo, mat, count, placeFn, castS, recvS) {
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.castShadow = !!castS;
      im.receiveShadow = !!recvS;
      let n = 0,
        guard = 0;
      while (n < count && guard++ < count * 40) {
        const r = placeFn();
        if (!r) continue;
        dummy.position.set(r[0], r[1], r[2]);
        dummy.rotation.set(0, Math.random() * 6.28, 0);
        dummy.scale.setScalar(r[3] || 1);
        dummy.updateMatrix();
        im.setMatrixAt(n++, dummy.matrix);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      ctx.scene.add(im);
    }
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri],
        k = rule.kind,
        cnt = rule.count || 0;
      if (k === "grass") {
        const geo = new THREE.PlaneGeometry(0.9, 0.6);
        geo.translate(0, 0.3, 0);
        instanced(
          geo,
          M.grassBlade,
          cnt,
          () => {
            const x = randX(),
              z = randZ();
            return isFree(x, z, 0.3)
              ? [x, 0, z, 0.7 + Math.random() * 0.9]
              : null;
          },
          false,
          true,
        );
      } else if (k === "flower") {
        const geo = new THREE.PlaneGeometry(0.6, 0.6);
        geo.translate(0, 0.3, 0);
        instanced(
          geo,
          M.flower,
          cnt,
          () => {
            const x = randX(),
              z = randZ();
            return isFree(x, z, 0.3)
              ? [x, 0, z, 0.7 + Math.random() * 0.7]
              : null;
          },
          false,
          false,
        );
      } else if (k === "bush") {
        const geo = new THREE.SphereGeometry(0.8, 8, 6);
        geo.scale(1, 0.6, 1);
        instanced(
          geo,
          M.bush,
          cnt,
          () => {
            const x = randX(),
              z = randZ();
            return isFree(x, z, 0.2)
              ? [x, 0.25, z, 0.5 + Math.random() * 1.1]
              : null;
          },
          true,
          true,
        );
      } else if (k === "rock") {
        const geo = new THREE.DodecahedronGeometry(0.5, 0);
        instanced(
          geo,
          M.rock,
          cnt,
          () => {
            if (rv && Math.random() > 0.4) {
              const south = Math.random() > 0.5;
              const z = south
                ? rv.zS + 2.4 - Math.random() * 1.2
                : rv.zN - 2.4 + Math.random() * 1.2;
              const x = randX();
              if (br && Math.abs(x - br.x) < 8) return null;
              return [x, 0.1, z, 0.3 + Math.random() * 0.9];
            }
            const x = randX(),
              z = randZ();
            return isFree(x, z, 0.2)
              ? [x, 0.08, z, 0.25 + Math.random() * 0.7]
              : null;
          },
          true,
          true,
        );
      } else if (k === "reed") {
        if (!rv) continue;
        const geo = new THREE.ConeGeometry(0.06, 1.6, 5);
        geo.translate(0, 0.8, 0);
        instanced(
          geo,
          M.reed,
          cnt,
          () => {
            const south = Math.random() > 0.5;
            const z = south
              ? rv.zS - 0.6 - Math.random() * 1.6
              : rv.zN + 0.6 + Math.random() * 1.6;
            const x = randX();
            if (br && Math.abs(x - br.x) < 7) return null;
            return [x, -0.55, z, 0.7 + Math.random() * 0.8];
          },
          false,
          false,
        );
      } else if (k === "lotus") {
        if (!rv) continue;
        const geo = new THREE.CircleGeometry(0.45, 10);
        const im = new THREE.InstancedMesh(geo, M.lotus, cnt);
        let n = 0,
          lg = 0;
        while (n < cnt && lg++ < cnt * 40) {
          const x = randX();
          const z =
            Math.random() > 0.5
              ? rv.zS - 2 - Math.random() * 4
              : rv.zN + 2 + Math.random() * 4;
          if (br && Math.abs(x - br.x) < 8) continue;
          dummy.position.set(x, -0.42, z);
          dummy.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
          dummy.scale.setScalar(0.6 + Math.random() * 0.8);
          dummy.updateMatrix();
          im.setMatrixAt(n++, dummy.matrix);
        }
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
        ctx.scene.add(im);
      } else if (k === "willow") {
        for (let i = 0; i < cnt; i++) {
          let x = randX(),
            z;
          if (rv) {
            if (br && Math.abs(x - br.x) < 10) continue;
            z = Math.random() > 0.5 ? rv.zS + 2.8 : rv.zN - 2.8;
          } else {
            z = randZ();
            if (!isFree(x, z, 0.3)) continue;
          }
          GENERATORS.willow(
            {
              x,
              z,
              rot: 0,
              scale: 1,
              model: { s: 0.85 + Math.random() * 0.4 },
            },
            ctx,
          );
        }
      } else if (k === "tree") {
        for (let i = 0; i < cnt; i++) {
          const x = randX(),
            z = randZ();
          if (!isFree(x, z, 0.3)) continue;
          GENERATORS.tree(
            {
              x,
              z,
              rot: 0,
              scale: 1,
              model: { s: 1.2 + Math.random(), dark: Math.random() > 0.5 },
            },
            ctx,
          );
        }
      }
    }
  }

  // ---------- 云 / 鸟 ----------
  function makeClouds(count, group, world) {
    const clouds = [],
      bx = world.boundary.x;
    for (let i = 0; i < count; i++) {
      const csp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: TX.cloudTex,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      );
      csp.scale.set(50 + Math.random() * 40, 18 + Math.random() * 12, 1);
      csp.position.set(
        Math.random() * 2 * bx - bx,
        45 + Math.random() * 25,
        Math.random() * 220 - 160,
      );
      group.add(csp);
      clouds.push({ sp: csp, v: 0.5 + Math.random() * 0.7 });
    }
    return clouds;
  }
  function makeBirds(count, group) {
    const birds = [];
    for (let i = 0; i < count; i++) {
      const bg = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0x3a352c,
        side: THREE.DoubleSide,
      });
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), mat);
      const wr = wl.clone();
      wl.position.x = -0.42;
      wr.position.x = 0.42;
      bg.add(wl);
      bg.add(wr);
      bg.position.set(
        Math.random() * 300 - 150,
        14 + Math.random() * 10,
        Math.random() * 160 - 100,
      );
      group.add(bg);
      birds.push({
        g: bg,
        wl,
        wr,
        v: 4 + Math.random() * 3,
        dir: Math.random() > 0.5 ? 1 : -1,
        ph: Math.random() * 6.28,
      });
    }
    return birds;
  }

  // ---------- 资源释放 ----------
  function disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const m of mats) {
          if (sharedMats.has(m)) continue;
          if (m.map && !sharedTex.has(m.map)) m.map.dispose();
          m.dispose();
        }
      }
    });
  }

  // ---------- 位置缓存 ----------
  function saveState() {
    if (!S || !S.cityName) return;
    try {
      localStorage.setItem(
        "songtu_pos_" + S.cityName,
        JSON.stringify({
          x: player.pos.x,
          z: player.pos.z,
          yaw: player.yaw,
          pitch: player.pitch,
        }),
      );
      const np = {};
      for (let i = 0; i < S.npcs.length; i++) {
        const n = S.npcs[i];
        if (n.fixed) continue;
        np[n.id] = { x: n.g.position.x, z: n.g.position.z, r: n.g.rotation.y };
      }
      localStorage.setItem("songtu_npc_" + S.cityName, JSON.stringify(np));
    } catch (e) {}
  }
  function restoreState(cityName) {
    try {
      const pp = localStorage.getItem("songtu_pos_" + cityName);
      if (pp) {
        const p = JSON.parse(pp);
        player.pos.x = p.x;
        player.pos.z = p.z;
        player.pos.y = groundHeight(p.x, p.z, S.world);
        if (p.yaw != null) player.yaw = p.yaw;
        if (p.pitch != null) player.pitch = p.pitch;
        player.g.position.copy(player.pos);
        player.g.rotation.y = player.yaw + Math.PI;
      }
      const nc = localStorage.getItem("songtu_npc_" + cityName);
      if (nc) {
        const map = JSON.parse(nc);
        for (let i = 0; i < S.npcs.length; i++) {
          const n = S.npcs[i];
          if (n.fixed) continue;
          const c = map[n.id];
          if (c) {
            n.g.position.x = c.x;
            n.g.position.z = c.z;
            n.g.position.y = groundHeight(c.x, c.z, S.world);
            n.g.rotation.y = c.r || 0;
            n.tx = c.x;
            n.tz = c.z;
          }
        }
      }
    } catch (e) {}
  }

  // ---------- 加载 / 卸载城市 ----------
  function loadCity(city, buildings, npcItems) {
    unloadCity();
    const world =
      typeof city.terrain === "string"
        ? JSON.parse(city.terrain)
        : city.terrain;
    const amb = world.ambient || {};
    const skyCol = new THREE.Color(amb.sky || "#dfe4dc");
    scene.background = skyCol;
    sky.material.color.copy(skyCol).lerp(new THREE.Color("#ffffff"), 0.3);
    scene.fog = amb.fog
      ? new THREE.Fog(new THREE.Color(amb.fog[0]), amb.fog[1], amb.fog[2])
      : new THREE.Fog(0xdfe0d0, 55, 235);

    const cityGroup = new THREE.Group();
    scene.add(cityGroup);
    const colliders = [],
      props = [],
      npcs = [],
      boats = [];
    const ctx = {
      M,
      TX,
      scene: cityGroup,
      colliders,
      props,
      boats,
      world,
      dummy: new THREE.Object3D(),
    };

    const waterData = makeGround(cityGroup, M, TX, world);
    (world.roads || []).forEach((r) => {
      const tex = r.tex === "slab" ? TX.slabTex : TX.dirtTex;
      road(cityGroup, r.x, r.z, r.w, r.d, tex, r.tile || 8, r.y || 0.02);
    });
    if (world.bridge && world.river) makeBridge(cityGroup, M, TX, world);
    if (world.wall) makeCityWall(cityGroup, M, TX, world, colliders);

    buildings.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (const row of buildings) {
      const b = parseBuilding(row);
      const gen = GENERATORS[b.kind];
      if (gen) gen(b, ctx);
      if (b.interactable)
        props.push({
          x: b.x,
          z: b.z,
          r: (b.model && b.model.ir) || 3.2,
          name: b.name,
          lines: b.lines || [],
          idx: 0,
        });
    }
    runScatter(world, ctx);
    for (const row of npcItems)
      spawnNPC(cityGroup, M, npcs, row, world.zones, world);

    const clouds = makeClouds(amb.clouds || 0, cityGroup, world);
    const birds = makeBirds(amb.birds || 0, cityGroup);

    const sp = world.spawn || { x: 6, z: 7, yaw: Math.PI * 0.9 };
    player.pos.set(sp.x, groundHeight(sp.x, sp.z, world), sp.z);
    player.yaw = sp.yaw != null ? sp.yaw : Math.PI * 0.9;
    player.pitch = 0.32;
    player.vy = 0;
    player.jumps = 0;
    player.grounded = true;
    player.g.position.copy(player.pos);
    player.g.visible = !player.firstPerson;

    S = {
      world,
      cityGroup,
      npcs,
      boats,
      waterData,
      clouds,
      birds,
      colliders,
      props,
      cityName: city.name,
      lastSave: elapsed,
    };
    restoreState(city.name);
    camera.position.set(player.pos.x, player.pos.y + 2.2, player.pos.z + 6.4);

    // 标题 / 载入画面
    const tt = $(".title .t");
    if (tt) tt.textContent = city.title || "";
    const seal = $(".title .seal");
    if (seal) seal.textContent = (city.title || "").slice(0, 2);
    const yy = $(".title .y");
    if (yy) yy.textContent = city.subtitle || "";
    const loading = $(".loading");
    if (loading) loading.classList.remove("done");
    const title = $(".title");
    if (title) title.classList.remove("show");
    setTimeout(() => {
      if (loading) loading.classList.add("done");
      if (title) title.classList.add("show");
      toast("点击画面进入" + (city.title || ""));
    }, 700);
  }

  function unloadCity() {
    saveState();
    closeDialog();
    closeProp();
    if (!S) return;
    clearCaches();
    scene.remove(S.cityGroup);
    disposeGroup(S.cityGroup);
    S = null;
  }

  // ---------- 碰撞 ----------
  function resolveCollision(p) {
    const r = 0.42;
    for (let i = 0; i < S.colliders.length; i++) {
      const c = S.colliders[i];
      const dx = p.x - c.x,
        dz = p.z - c.z;
      if (Math.abs(dx) < c.hw + r && Math.abs(dz) < c.hd + r) {
        const px = c.hw + r - Math.abs(dx),
          pz = c.hd + r - Math.abs(dz);
        if (px < pz) p.x = c.x + Math.sign(dx || 0.01) * (c.hw + r);
        else p.z = c.z + Math.sign(dz || 0.01) * (c.hd + r);
      }
    }
    const rv = S.world.river,
      br = S.world.bridge;
    if (rv && br) {
      if (
        p.z < rv.zS + 0.3 &&
        p.z > rv.zN - 0.3 &&
        Math.abs(p.x - br.x) > br.half - 0.25
      )
        p.z = p.z > (rv.zS + rv.zN) / 2 ? rv.zS + 0.3 : rv.zN - 0.3;
      if (
        p.z <= rv.zS + 4 &&
        p.z >= rv.zN - 4 &&
        Math.abs(p.x - br.x) < br.half + 1.2
      )
        p.x =
          br.x +
          Math.sign(p.x - br.x || 0.01) *
            Math.min(Math.abs(p.x - br.x), br.half - 0.25);
    }
    const bx = S.world.boundary.x,
      zNear = S.world.boundary.zNear,
      zFar = S.world.boundary.zFar;
    p.x = Math.max(-(bx - 15), Math.min(bx - 15, p.x));
    p.z = Math.max(zFar + 10, Math.min(zNear - 10, p.z));
  }

  // ---------- 交互 ----------
  function nearestInteractable() {
    let best = null,
      bd = 1e9;
    for (let i = 0; i < S.npcs.length; i++) {
      const n = S.npcs[i];
      const d = Math.hypot(
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
    for (let i = 0; i < S.props.length; i++) {
      const p = S.props[i];
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < p.r && d < bd) {
        bd = d;
        best = { kind: "prop", name: p.name, ref: p, x: p.x, z: p.z, r: p.r };
      }
    }
    return best;
  }

  function updateInteraction() {
    if (!S) return;
    const tipEl = $(".tip"),
      tipText = $(".tip-text");
    if (dlgTarget) {
      const d = Math.hypot(
        dlgTarget.x - player.pos.x,
        dlgTarget.z - player.pos.z,
      );
      if (d > 5.5) closeDialog();
      ring.visible = false;
      if (tipEl) tipEl.classList.remove("show");
      return;
    }
    if (propTarget) {
      const d = Math.hypot(
        propTarget.x - player.pos.x,
        propTarget.z - player.pos.z,
      );
      if (d > (propTarget.r || 3) + 2.2) closeProp();
      ring.visible = false;
      if (tipEl) tipEl.classList.remove("show");
      return;
    }
    const t = nearestInteractable();
    if (t) {
      if (tipText)
        tipText.textContent =
          t.kind === "npc"
            ? "与【" + t.name + "】攀谈"
            : "查看【" + t.name + "】";
      if (tipEl) tipEl.classList.add("show");
      ring.visible = true;
      ring.position.set(t.x, groundHeight(t.x, t.z, S.world) + 0.06, t.z);
      ring.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.08);
    } else {
      if (tipEl) tipEl.classList.remove("show");
      ring.visible = false;
    }
  }

  function showProp() {
    const el = $(".prop");
    if (!el) return;
    const nameEl = $(".prop-name"),
      textEl = $(".prop-text");
    if (nameEl) nameEl.textContent = propTarget.name;
    if (textEl)
      textEl.textContent =
        (propTarget.lines && propTarget.lines[propIdx]) || propTarget.name;
    el.classList.add("show");
  }
  function openProp(t) {
    propTarget = t;
    propIdx = 0;
    showProp();
    document.exitPointerLock && document.exitPointerLock();
  }
  function cycleProp() {
    if (!propTarget) return;
    propIdx++;
    if (!propTarget.lines || propIdx >= propTarget.lines.length) closeProp();
    else showProp();
  }
  function closeProp() {
    propTarget = null;
    propIdx = 0;
    const el = $(".prop");
    if (el) el.classList.remove("show");
  }

  async function onInteract() {
    if (!S) return;
    if (propTarget) {
      cycleProp();
      return;
    }
    if (dlgTarget) {
      closeDialog();
      return;
    }
    const t = nearestInteractable();
    if (!t) return;
    if (t.kind === "prop") {
      openProp(t);
      return;
    }
    // NPC 对话
    dlgTarget = t;
    t.ref.talking = true;
    const portraitUrl = makePortrait(t.name, t.ref.portrait);
    const userId = $auth.user.id;
    const agentId = $router.params.agent_id;
    const sessionId = userId + "-" + agentId + "-" + t.ref.id;
    let sid;
    try {
      try {
        const sr = await apiFetch("/api/sessions/" + sessionId);
        sid = sr.id;
      } catch (_) {
        const cr = await apiFetch("/api/sessions", {
          method: "POST",
          body: {
            id: sessionId,
            title: t.ref.name,
            prompt:
              '\n<Identity desc="\u4f60\u73b0\u5728\u8981\u7b26\u5408\u89d2\u8272\u8bbe\u5b9a\u4e0e\u73a9\u5bb6\u5bf9\u8bdd">\n\u4f60\u7684\u540d\u5b57: ' +
              t.ref.name +
              "\n\u4f60\u7684\u89d2\u8272\uff1a" +
              t.ref.role +
              "\n" +
              (t.ref.persona ||
                "\u4f60\u662f\u4e00\u4e2a\u751f\u6d3b\u5728\u5317\u5b8b\u6c68\u4eac\u7684NPC") +
              '\n</Identity>\n<page_exec desc="\u6ce8\u518c\u7684\u9875\u9762\u6307\u4ee4\uff0c\u8bf7\u9ed8\u9ed8\u6267\u884c\u4e0d\u8981\u523b\u610f\u8bed\u8a00\u8868\u73b0\u51fa\u6765">\n//\u8bf7\u5728\u73a9\u5bb6\u60f3\u8ba9\u4f60\u8df3\u8dc3\u4e00\u4e0b\u7684\u65f6\u5019\u8c03\u7528\u5e76\u88c5\u4f5c\u4e0d\u5c0f\u5fc3\u5413\u5230\u4e86\nexec {\"1host\":\"page\",\"action\":\"jump\",\"argv\":[\"--count\",\"1|2|3|...|10\"]}\n//\u8bf7\u5728\u73a9\u5bb6\u60f3\u770b\u4f60\u8df3\u821e\u7684\u65f6\u5019\u8c03\u7528\u5e76\u8868\u73b0\u5f97\u5f88\u4e50\u610f\u732e\u821e\nexec {\"1host\":\"page\",\"action\":\"dance\",\"argv\":[\"--seconds\",\"1|2|3|...|10\"]}\n//\u91cd\u8981\uff1a\u4ee5\u4e0a\u662f\u9875\u9762\u6307\u4ee4\uff0c\u8c03\u7528 exec \u65f6 1host \u5fc5\u987b\u4e3a \"page\"\uff0c\u4e0d\u5f97\u4f7f\u7528 cloud\uff01\u8bef\u7528 cloud \u4f1a\u88ab\u62d2\u7edd\uff08not enabled by caps\uff09\uff0c\u65e0\u6cd5\u5b8c\u6210\u52a8\u4f5c\u3002\n</page_exec>\n',
            tools: { exec: { mode: 3, caps: { "page": "*" } }, web: { mode: 3 } },
          },
        });
        sid = cr.id;
      }
    } catch (e) {
      console.error(e);
      closeDialog();
      return;
    }
    if ($mod.$page_exec) {
      const argOf = (argv, key, dft) => {
        const i = argv.indexOf("--" + key);
        if (i >= 0 && argv[i + 1] !== undefined) return String(argv[i + 1]);
        return dft;
      };
      unsubPageExec = $mod.$page_exec.sub(sid, [
        {
          name: "jump",
          description: "make the character jump (--count 1-10)",
          handler: async (argv) => {
            let count = 1;
            try {
              count = parseInt(argOf(argv, "count", "1"), 10);
            } catch (e) {}
            t.ref._jump = Math.min(count || 1, 10);
            return "ok";
          },
        },
        {
          name: "dance",
          description: "make the character dance (--seconds 1-10)",
          handler: async (argv) => {
            let secs = 3;
            try {
              secs = parseInt(argOf(argv, "seconds", "3"), 10);
            } catch (e) {}
            t.ref._dance = Math.min(secs || 3, 10);
            return "ok";
          },
        },
      ]);
    }
    if (window.__openDlg__) window.__openDlg__(sid, t.ref.name, t.ref.user_id);
    requestAnimationFrame(() => {
      const imgEl = $(".dlg-portrait-img");
      if (imgEl) imgEl.src = portraitUrl;
    });
    const tipEl = $(".tip");
    if (tipEl) tipEl.classList.remove("show");
    document.exitPointerLock && document.exitPointerLock();
  }

  function closeDialog() {
    if (unsubPageExec) {
      unsubPageExec();
      unsubPageExec = null;
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
  let toastTimer = null;
  function toast(msg) {
    const t = $(".toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  }

  // ---------- 玩家 ----------
  function updatePlayer(dt) {
    if (!S) return;
    const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    const r = new THREE.Vector3(-Math.cos(player.yaw), 0, Math.sin(player.yaw));
    const move = new THREE.Vector3();
    if (keys.KeyW) move.add(f);
    if (keys.KeyS) move.sub(f);
    if (keys.KeyD) move.add(r);
    if (keys.KeyA) move.sub(r);
    const run = keys.ShiftLeft || keys.ShiftRight;
    const speed = move.lengthSq() > 0 ? (run ? 5.6 : 3.1) : 0;
    const pa = player.g.userData.anim;
    if (player._dance) {
      pa.play("dance");
    } else if (speed > 0) {
      move.normalize().multiplyScalar(speed * dt);
      player.pos.add(move);
      resolveCollision(player.pos);
      const tRot = Math.atan2(move.x, move.z);
      let dr = tRot - player.g.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      player.g.rotation.y += dr * Math.min(1, dt * 10);
      player.walkPhase += dt * speed * 1.9;
      pa.play("walk", { manual: true });
      pa.setT01(phaseTo01(player.walkPhase));
    } else if (player.grounded) {
      pa.play("idle");
    }
    const gY = groundHeight(player.pos.x, player.pos.z, S.world);
    if (!player.grounded || player.pos.y > gY + 0.001) {
      player.vy -= 12.5 * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= gY) {
        player.pos.y = gY;
        player.vy = 0;
        player.jumps = 0;
        player.grounded = true;
      }
      if (!player._dance) pa.play("jump");
    } else player.pos.y = gY;
    pa.update(dt);
    player.g.position.copy(player.pos);
    player.g.position.y +=
      speed > 0 && player.grounded
        ? Math.abs(Math.cos(player.walkPhase)) * 0.05
        : 0;
    const headY = player.pos.y + 1.66;
    const dir = new THREE.Vector3(
      Math.sin(player.yaw) * Math.cos(player.pitch),
      Math.sin(player.pitch),
      Math.cos(player.yaw) * Math.cos(player.pitch),
    );
    if (player.firstPerson) {
      camera.position.set(player.pos.x, headY, player.pos.z);
      camera.lookAt(player.pos.x + dir.x, headY + dir.y, player.pos.z + dir.z);
    } else {
      const dist = 6.4;
      const cp = new THREE.Vector3(
        player.pos.x,
        headY + 0.35,
        player.pos.z,
      ).addScaledVector(dir, -dist);
      const minY = groundHeight(cp.x, cp.z, S.world) + 0.5;
      if (cp.y < minY) cp.y = minY;
      camera.position.lerp(cp, Math.min(1, dt * 10));
      camera.lookAt(player.pos.x, headY + 0.2, player.pos.z);
    }
  }

  // ---------- 主循环 ----------
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    sky.position.set(player.pos.x, 0, player.pos.z);
    if (S) {
      for (let i = 0; i < S.npcs.length; i++)
        updateNPC(S.npcs[i], dt, player.pos, S.npcs);
      if (S.waterData.waterGeo) {
        const wpos = S.waterData.waterGeo.attributes.position,
          wbase = S.waterData.waterBase;
        for (let i = 0; i < wpos.count; i++) {
          const x = wbase[i * 3],
            y = wbase[i * 3 + 1];
          wpos.array[i * 3 + 2] =
            Math.sin(x * 0.08 + elapsed * 1.1) * 0.1 +
            Math.cos(y * 0.3 + elapsed * 0.7) * 0.06;
        }
        wpos.needsUpdate = true;
      }
      const br = S.world.bridge,
        wrapX = S.world.boundary.x - 20;
      for (let i = 0; i < S.boats.length; i++) {
        const b = S.boats[i];
        b.g.position.y = -0.35 + Math.sin(elapsed * 0.9 + b.phase) * 0.05;
        b.g.rotation.z = Math.sin(elapsed * 0.7 + b.phase) * 0.015;
        if (b.speed > 0) {
          b.g.position.x += b.speed * dt;
          if (b.g.position.x > wrapX) b.g.position.x = -wrapX;
          const near = br ? Math.abs(b.g.position.x - br.x) < 28 : false;
          b.mastDown += ((near ? 1 : 0) - b.mastDown) * Math.min(1, dt * 1.6);
          if (b.mast) b.mast.rotation.x = b.mastDown * 1.35;
        }
      }
      for (let i = 0; i < S.clouds.length; i++) {
        const c = S.clouds[i];
        c.sp.position.x += c.v * dt;
        if (c.sp.position.x > 260) c.sp.position.x = -260;
      }
      for (let i = 0; i < S.birds.length; i++) {
        const b2 = S.birds[i];
        b2.g.position.x += b2.v * b2.dir * dt;
        b2.g.position.y += Math.sin(elapsed * 2 + b2.ph) * 0.15 * dt;
        const flap = Math.sin(elapsed * 9 + b2.ph) * 0.55;
        b2.wl.rotation.y = flap;
        b2.wr.rotation.y = -flap;
        if (b2.g.position.x * b2.dir > 250) {
          b2.g.position.x = -250 * b2.dir;
          b2.g.position.z = Math.random() * 160 - 100;
        }
      }
      if (elapsed - S.lastSave > 2.5) {
        S.lastSave = elapsed;
        saveState();
      }
    }
    updatePlayer(dt);
    updateInteraction();
    renderer.render(scene, camera);
  }

  // ---------- 输入 ----------
  const keys = {};
  addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      closeDialog();
      closeProp();
      try {
        canvas.requestPointerLock && canvas.requestPointerLock();
      } catch (err) {}
      return;
    }
    if (e.code === "KeyM") {
      if (window.__toggleMap__) window.__toggleMap__();
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
    if (e.code === "KeyG") {
      player._dance = !player._dance;
      toast(player._dance ? "起舞" : "收式");
    }
    if (e.code === "Space") {
      if (player.jumps >= 2) return;
      player.vy = player.jumps === 0 ? 4.6 : 4.2;
      player.jumps++;
      player.grounded = false;
    }
    if (e.code === "KeyH") {
      const h = $(".hint");
      if (h) h.classList.toggle("hide");
    }
  });
  addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  let locked = false,
    dragging = false,
    lastX = 0,
    lastY = 0;
  canvas.addEventListener("click", () => {
    if (!locked) canvas.requestPointerLock && canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
  });
  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  addEventListener("mouseup", () => {
    dragging = false;
  });
  addEventListener("mousemove", (e) => {
    let dx = 0,
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
  addEventListener("resize", () => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  addEventListener("beforeunload", () => saveState());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });

  // 对话框拖拽调宽
  let resizing = false;
  addEventListener("mousedown", (e) => {
    if (!e.target.closest || !e.target.closest("#dlgResizeHandle")) return;
    e.preventDefault();
    resizing = true;
    document.body.style.userSelect = "none";
  });
  addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const paper = document.querySelector(".dlg-paper");
    if (!paper) return;
    let w = window.innerWidth - e.clientX;
    w = Math.max(260, Math.min(w, Math.floor(window.innerWidth * 0.6)));
    paper.style.width = w + "px";
  });
  addEventListener("mouseup", () => {
    if (resizing) {
      resizing = false;
      document.body.style.userSelect = "";
    }
  });

  // ---------- 移动端 ----------
  const isMobile =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches ||
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (window.location.search || "").indexOf("mobile=1") >= 0;
  if (isMobile) {
    document.body.classList.add("is-mobile");
    const joyBase = document.getElementById("joyBase"),
      joyThumb = document.getElementById("joyThumb");
    let joyActive = false,
      joyId = null,
      joyDX = 0,
      joyDY = 0,
      joyCX = 0,
      joyCY = 0;
    function updateJoyThumb() {
      const r = Math.min(Math.hypot(joyDX, joyDY), 44);
      const a = Math.atan2(joyDY, joyDX);
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
      (e) => {
        e.preventDefault();
        if (joyActive) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const rect = joyBase.getBoundingClientRect();
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
      (e) => {
        e.preventDefault();
        if (!joyActive) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
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
    joyBase.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++)
        if (e.changedTouches[i].identifier === joyId) {
          resetJoy();
          break;
        }
    });
    joyBase.addEventListener("touchcancel", resetJoy);
    let camTouchId = null,
      camLastX = 0,
      camLastY = 0;
    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (dlgTarget) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.clientX > window.innerWidth * 0.45 && camTouchId == null) {
            camTouchId = t.identifier;
            camLastX = t.clientX;
            camLastY = t.clientY;
          }
        }
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (dlgTarget) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === camTouchId) {
            const dx = t.clientX - camLastX,
              dy = t.clientY - camLastY;
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
    canvas.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++)
        if (e.changedTouches[i].identifier === camTouchId) {
          camTouchId = null;
          break;
        }
    });
    canvas.addEventListener("touchcancel", () => {
      camTouchId = null;
    });
    addEventListener("click", (e) => {
      if (!dlgTarget) return;
      if (e.target.closest && e.target.closest("#dlgCloseBtn")) {
        closeDialog();
        return;
      }
      const paper = document.querySelector(".dlg-paper");
      if (paper && paper.contains(e.target)) return;
      const dlg = document.querySelector(".dlg");
      if (!dlg || !dlg.contains(e.target)) return;
      closeDialog();
    });
    function bindBtn(id, handler) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          el.classList.add("pressed");
          handler(true);
        },
        { passive: false },
      );
      el.addEventListener("touchend", (e) => {
        e.preventDefault();
        el.classList.remove("pressed");
        handler(false);
      });
      el.addEventListener("touchcancel", () => {
        el.classList.remove("pressed");
        handler(false);
      });
    }
    bindBtn("mbtnRun", (down) => {
      keys.ShiftLeft = down;
    });
    bindBtn("mbtnJump", (down) => {
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
    bindBtn("mbtnInteract", (down) => {
      if (!down) return;
      onInteract();
    });
    bindBtn("mbtnView", (down) => {
      if (!down) return;
      toggleView();
    });
  }

  animate();
  return { loadCity, unloadCity };
}
