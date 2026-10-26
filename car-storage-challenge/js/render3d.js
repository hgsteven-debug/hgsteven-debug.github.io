import { listCells, cellWorld, makeCamera } from "./layout.js";
import { createSettle, stepBody } from "./physics.js";
import { initialDpr, degradeDpr, createLoop } from "./perf.js";

const ACCENT = "#d6ff3c";

export async function createWebGLView(canvas) {
  let THREE;
  try {
    THREE = await import("../vendor/three.module.min.js");
  } catch (err) {
    console.warn("Three.js failed to load", err);
    return null;
  }
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) return null;
    const view = new WebGLView(canvas, THREE);
    return view.ok ? view : null;
  } catch (err) {
    console.warn("WebGL view failed", err);
    return null;
  }
}

class WebGLView {
  constructor(canvas, THREE) {
    this.mode = "webgl";
    this.canvas = canvas;
    this.THREE = THREE;
    this.ok = false;
    this.ready = false;
    this.dpr = initialDpr();
    this.effects = true;
    this.degradeSteps = 0;
    this.warmup = 24;
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.dirty = true;
    this.width = 0;
    this.height = 0;
    this.level = null;
    this.items = null;
    this.placed = [];
    this.ghost = null;
    this.playableRecords = [];
    this.fitPoints = [];
    this.compById = {};
    this.settles = new Map();
    this.sprites = new Map();
    this.textures = new Map();
    this.tmp = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
    if (!renderer.getContext()) return;
    this.renderer = renderer;
    renderer.setPixelRatio(this.dpr);
    renderer.setClearColor(0x111111, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    const hemi = new THREE.HemisphereLight(0xf4f4f4, 0x202020, 0.95);
    const sun = new THREE.DirectionalLight(0xffffff, 0.72);
    sun.position.set(-5, 14, 7);
    sun.castShadow = false;
    this.scene.add(hemi, sun);
    this.lights = { hemi, sun };

    this.staticGroup = new THREE.Group();
    this.spriteGroup = new THREE.Group();
    this.scene.add(this.staticGroup, this.spriteGroup);

    this.cellMesh = null;
    this.hitMesh = null;
    this.itemMesh = null;
    this.ghostMesh = null;
    this.contact = null;

    this.loop = createLoop((dt) => this.onFrame(dt));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.ok = true;
    this.loop.request();
  }

  setLevel(level, items) {
    this.level = level;
    this.items = items;
    this.compById = Object.fromEntries(level.compartments.map((comp) => [comp.id, comp]));
    this.placed = [];
    this.ghost = null;
    this.settles.clear();
    this.clearSprites();
    this.buildStatic();
    this.buildItems();
    for (const item of Object.values(items)) this.prepareArt(item);
    this.resize();
  }

  setState({ placed, ghost }) {
    this.placed = placed || [];
    this.ghost = ghost || null;
    const live = new Set(this.placed.map((item) => item.uid));
    for (const item of this.placed) {
      if (!this.settles.has(item.uid)) {
        const center = this.centroid(item);
        this.settles.set(item.uid, createSettle(center.x, center.y, center.z));
      }
    }
    for (const uid of [...this.settles.keys()]) {
      if (!live.has(uid)) this.settles.delete(uid);
    }
    this.writeDynamic();
    this.loop.request();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2 || !this.fitPoints.length) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    const cam = makeCamera(width, height, this.fitPoints);
    this.camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
    this.camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
    this.camera.left = -cam.halfH * cam.aspect;
    this.camera.right = cam.halfH * cam.aspect;
    this.camera.top = cam.halfH;
    this.camera.bottom = -cam.halfH;
    this.camera.near = 0.1;
    this.camera.far = 90;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.loop.request();
  }

  projectCells() {
    if (!this.playableRecords.length || !this.width) return [];
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld(true);
    return this.playableRecords.map((rec) => {
      this.tmp.set(rec.x, rec.y, rec.z);
      this.tmp.project(this.camera);
      return {
        compId: rec.compId,
        col: rec.col,
        row: rec.row,
        playable: true,
        x: (this.tmp.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-this.tmp.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    });
  }

  pick(clientX, clientY) {
    if (!this.hitMesh || !this.width) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.hitMesh);
    if (hits.length && hits[0].instanceId != null) {
      const rec = this.playableRecords[hits[0].instanceId];
      if (rec) return { compId: rec.compId, col: rec.col, row: rec.row };
    }
    const plane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), -0.7);
    const point = new this.THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null;
    let best = null;
    let bestD = Infinity;
    for (const rec of this.playableRecords) {
      const dist = Math.hypot(rec.x - point.x, rec.z - point.z);
      if (dist < bestD) {
        bestD = dist;
        best = rec;
      }
    }
    if (best && bestD <= best.size * 0.9) {
      return { compId: best.compId, col: best.col, row: best.row };
    }
    return null;
  }

  onFrame(dt) {
    const awake = this.step(dt);
    if (this.width > 0) this.renderer.render(this.scene, this.camera);
    this.measure(dt);
    if (this.warmup > 0) this.warmup -= 1;
    if (!this.ready && this.width > 0) this.ready = true;
    const again = awake || this.warmup > 0 || this.dirty;
    this.dirty = false;
    return again;
  }

  step(dt) {
    let awake = false;
    let moved = false;
    for (const body of this.settles.values()) {
      if (!body.awake) continue;
      stepBody(body, dt);
      moved = true;
      if (body.awake) awake = true;
    }
    if (moved) this.writeDynamic();
    return awake;
  }

  measure(dt) {
    if (this.degradeSteps >= 2) return;
    this.fpsAcc += dt;
    this.fpsN += 1;
    if (this.fpsN < 20) return;
    const fps = this.fpsN / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsN = 0;
    if (fps < 30) this.degrade();
  }

  degrade() {
    if (this.degradeSteps >= 2) return;
    this.degradeSteps += 1;
    this.effects = false;
    if (this.contact) this.contact.visible = false;
    if (this.lights?.sun) this.lights.sun.intensity = 0.45;
    const next = degradeDpr(this.dpr);
    if (next < this.dpr - 0.001) {
      this.dpr = next;
      this.resize();
    }
    this.warmup += 20;
    console.info("graphics degraded", { dpr: this.dpr, effects: this.effects });
  }

  buildStatic() {
    const THREE = this.THREE;
    this.disposeGroup(this.staticGroup);
    for (const mesh of [this.cellMesh, this.hitMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.cellMesh = null;
    this.hitMesh = null;
    const cells = listCells(this.level.compartments);
    const playableCells = cells.filter((cell) => cell.playable);
    this.playableRecords = playableCells;
    const geos = [];
    const fit = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const comp of this.level.compartments) {
      const size = comp.cell || 1;
      const x0 = comp.ox;
      const z0 = comp.oz;
      const x1 = comp.ox + comp.cols * size;
      const z1 = comp.oz + comp.rows * size;
      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x1);
      minZ = Math.min(minZ, z0);
      maxZ = Math.max(maxZ, z1);
      fit.push({ x: x0 - 0.2, y: comp.y, z: z0 - 0.2 });
      fit.push({ x: x1 + 0.2, y: comp.y + 0.7, z: z1 + 0.2 });
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      geos.push(paintBox(THREE, x1 - x0 + 0.16, 0.1, z1 - z0 + 0.16, cx, comp.y - 0.08, cz, "#2c2c2c"));
      for (let row = 0; row < comp.rows; row++) {
        for (let col = 0; col < comp.cols; col++) {
          const open = !comp.mask || !!comp.mask[row]?.[col];
          if (open) continue;
          const world = cellWorld(comp, col, row);
          geos.push(paintBox(THREE, size * 0.96, 0.22, size * 0.96, world.x, comp.y + 0.08, world.z, "#1a1a1a"));
        }
      }
      if (comp.id === "doorL") {
        geos.push(paintBox(THREE, 0.28, 0.7, z1 - z0, x0 - 0.28, 0.45, cz, "#242424"));
      }
      if (comp.id === "doorR") {
        geos.push(paintBox(THREE, 0.28, 0.7, z1 - z0, x1 + 0.28, 0.45, cz, "#242424"));
      }
      if (comp.id === "seatL" || comp.id === "seatR") {
        geos.push(paintBox(THREE, x1 - x0, 0.85, 0.28, cx, 0.7, z0 - 0.22, "#3a3a3a"));
        geos.push(paintBox(THREE, 0.7, 0.28, 0.24, cx, 1.15, z0 - 0.22, "#4a4a4a"));
      }
      if (comp.id === "console") {
        geos.push(paintBox(THREE, x1 - x0, 0.06, 0.08, cx, comp.y + 0.08, z0 + 0.08, ACCENT));
      }
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const floorW = maxX - minX + 2.4;
    const floorD = maxZ - minZ + 2.6;
    geos.push(paintBox(THREE, floorW, 0.16, floorD, cx, -0.16, cz, "#141414"));
    geos.push(paintBox(THREE, Math.min(6.2, floorW * 0.7), 0.45, 0.7, cx, 0.35, minZ - 0.7, "#1c1c1c"));
    geos.push(paintBox(THREE, floorW * 0.72, 0.35, 0.6, cx, 0.28, maxZ + 0.55, "#1a1a1a"));
    const wheel = new THREE.TorusGeometry(0.42, 0.045, 5, 10);
    wheel.rotateX(Math.PI / 2.3);
    wheel.translate(cx - 1.5, 0.72, minZ - 0.65);
    paint(THREE, wheel, "#2a2a2a");
    geos.push(wheel);
    const cupGeo = new THREE.CylinderGeometry(0.22, 0.2, 0.1, 8);
    cupGeo.translate(cx + 0.7, 0.62, minZ - 0.62);
    paint(THREE, cupGeo, "#303030");
    geos.push(cupGeo);
    const cupGeo2 = new THREE.CylinderGeometry(0.22, 0.2, 0.1, 8);
    cupGeo2.translate(cx + 1.35, 0.62, minZ - 0.62);
    paint(THREE, cupGeo2, "#303030");
    geos.push(cupGeo2);

    fit.push({ x: minX - 0.7, y: 0.2, z: minZ - 1.15 });
    fit.push({ x: maxX + 0.7, y: 1.2, z: maxZ + 1.05 });
    this.fitPoints = fit;

    const merged = mergeGeometries(THREE, geos);
    const cabin = new THREE.Mesh(
      merged,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    cabin.frustumCulled = false;
    this.staticGroup.add(cabin);
    for (const geo of geos) geo.dispose();

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(5.4, floorW * 0.55), 0.9),
      new THREE.MeshBasicMaterial({
        color: 0xbdbdbd,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    glass.rotation.x = -Math.PI / 2.5;
    glass.position.set(cx - 0.2, 0.95, minZ - 0.85);
    this.staticGroup.add(glass);

    const shadow = shadowTexture(THREE);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW * 0.92, floorD * 0.92),
      new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.set(cx, 0.01, cz);
    this.contact.visible = this.effects;
    this.staticGroup.add(this.contact);

    const ventGeo = new THREE.BoxGeometry(0.34, 0.05, 0.08);
    const vents = new THREE.InstancedMesh(
      ventGeo,
      new THREE.MeshLambertMaterial({ color: 0x8a8a8a }),
      6,
    );
    for (let i = 0; i < 6; i++) {
      this.dummy.position.set(cx - 1.5 + i * 0.42, 0.6, minZ - 0.48);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      vents.setMatrixAt(i, this.dummy.matrix);
    }
    vents.count = 6;
    vents.instanceMatrix.needsUpdate = true;
    vents.frustumCulled = false;
    this.staticGroup.add(vents);

    const cap = Math.max(8, playableCells.length);
    this.cellMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.07, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      cap,
    );
    this.hitMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.7, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      cap,
    );
    this.cellMesh.frustumCulled = false;
    this.hitMesh.frustumCulled = false;
    const cellEntries = playableCells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      sx: cell.size * 0.9,
      sy: 1,
      sz: cell.size * 0.9,
      color: "#3a3a3a",
      yShift: 0,
    }));
    this.fillInstances(this.cellMesh, cellEntries);
    this.fillInstances(this.hitMesh, playableCells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      sx: cell.size,
      sy: 1,
      sz: cell.size,
      color: "#ffffff",
      yShift: 0.2,
    })));
    this.scene.add(this.cellMesh, this.hitMesh);
  }

  buildItems() {
    const THREE = this.THREE;
    if (this.itemMesh) {
      this.scene.remove(this.itemMesh);
      this.itemMesh.geometry.dispose();
      this.itemMesh.material.dispose();
    }
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh.geometry.dispose();
      this.ghostMesh.material.dispose();
    }
    this.itemMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      96,
    );
    this.ghostMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false }),
      16,
    );
    this.itemMesh.frustumCulled = false;
    this.ghostMesh.frustumCulled = false;
    this.itemMesh.count = 0;
    this.ghostMesh.count = 0;
    this.scene.add(this.itemMesh, this.ghostMesh);
  }

  writeDynamic() {
    const entries = [];
    for (const placed of this.placed) {
      const comp = this.compById[placed.compId];
      const def = this.items[placed.defId];
      const settle = this.settles.get(placed.uid);
      const lift = settle ? settle.y - settle.ty : 0;
      for (const [x, y] of placed.shape) {
        const world = cellWorld(comp, placed.col + x, placed.row + y);
        entries.push({
          x: world.x,
          y: world.y + lift,
          z: world.z,
          sx: world.size * 0.82,
          sy: def.thickness || 0.2,
          sz: world.size * 0.82,
          color: def.color,
          yShift: (def.thickness || 0.2) / 2,
        });
      }
    }
    this.fillInstances(this.itemMesh, entries);
    this.writeGhost();
    this.writeSprites();
  }

  writeGhost() {
    if (!this.ghost || !this.compById[this.ghost.compId]) {
      if (this.ghostMesh) this.ghostMesh.count = 0;
      return;
    }
    const comp = this.compById[this.ghost.compId];
    const def = this.items[this.ghost.defId];
    const color = this.ghost.valid ? ACCENT : "#6a6a6a";
    const entries = this.ghost.shape.map(([x, y]) => {
      const world = cellWorld(comp, this.ghost.col + x, this.ghost.row + y);
      const thick = def?.thickness || 0.2;
      return {
        x: world.x,
        y: world.y + 0.16,
        z: world.z,
        sx: world.size * 0.82,
        sy: thick,
        sz: world.size * 0.82,
        color,
        yShift: thick / 2,
      };
    });
    this.fillInstances(this.ghostMesh, entries);
  }

  writeSprites() {
    const live = new Set();
    for (const placed of this.placed) {
      live.add(placed.uid);
      let sprite = this.sprites.get(placed.uid);
      if (!sprite) {
        sprite = this.makeSprite(placed.defId);
        this.sprites.set(placed.uid, sprite);
        this.spriteGroup.add(sprite);
      }
      const center = this.centroid(placed);
      const settle = this.settles.get(placed.uid);
      const lift = settle ? settle.y - settle.ty : 0;
      const thick = this.items[placed.defId]?.thickness || 0.2;
      sprite.position.set(center.x, center.y + thick + 0.28 + lift, center.z);
    }
    for (const [uid, sprite] of this.sprites) {
      if (live.has(uid)) continue;
      this.spriteGroup.remove(sprite);
      sprite.material.dispose();
      this.sprites.delete(uid);
    }
  }

  centroid(placed) {
    const comp = this.compById[placed.compId];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const [cx, cy] of placed.shape) {
      const world = cellWorld(comp, placed.col + cx, placed.row + cy);
      x += world.x;
      y += world.y;
      z += world.z;
    }
    const n = Math.max(1, placed.shape.length);
    return { x: x / n, y: y / n, z: z / n };
  }

  makeSprite(defId) {
    const THREE = this.THREE;
    const map = this.textures.get(defId) || this.emojiTexture(this.items[defId]);
    const material = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.62, 0.62, 1);
    return sprite;
  }

  emojiTexture(def) {
    const cached = this.textures.get(def.id);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = "96px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.emoji || "", 64, 72);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.textures.set(def.id, texture);
    return texture;
  }

  prepareArt(def) {
    this.emojiTexture(def);
    if (!def.image) return;
    if (!/\.ktx2$/i.test(def.image)) {
      console.warn("Ship item textures as .ktx2", def.image);
      return;
    }
    import("../vendor/basis/KTX2Loader.js")
      .then((mod) => {
        const loader = new mod.KTX2Loader();
        loader.setTranscoderPath("../vendor/basis/");
        loader.detectSupport(this.renderer);
        return loader.loadAsync(def.image);
      })
      .then((texture) => {
        texture.colorSpace = this.THREE.SRGBColorSpace;
        this.textures.set(def.id, texture);
        this.clearSprites();
        this.writeSprites();
        this.loop.request();
      })
      .catch((err) => {
        console.warn("KTX2 texture unavailable", def.image, err);
      });
  }

  fillInstances(mesh, entries) {
    if (!mesh) return;
    const count = Math.min(entries.length, mesh.instanceMatrix.count);
    mesh.count = count;
    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      this.dummy.position.set(entry.x, entry.y + (entry.yShift || 0), entry.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(entry.sx, entry.sy, entry.sz);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.set(entry.color);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  clearSprites() {
    for (const sprite of this.sprites.values()) {
      this.spriteGroup.remove(sprite);
      sprite.material.dispose();
    }
    this.sprites.clear();
  }

  disposeGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose?.());
      else material?.dispose?.();
    }
  }
}

function paint(THREE, geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function paintBox(THREE, w, h, d, x, y, z, hex) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return paint(THREE, geo, hex);
}

function mergeGeometries(THREE, geos) {
  let vCount = 0;
  let iCount = 0;
  for (const geo of geos) {
    vCount += geo.getAttribute("position").count;
    iCount += geo.getIndex().count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const indices = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const geo of geos) {
    const position = geo.getAttribute("position");
    const normal = geo.getAttribute("normal");
    const color = geo.getAttribute("color");
    const index = geo.getIndex();
    for (let i = 0; i < position.count; i++) {
      positions[(vOff + i) * 3] = position.getX(i);
      positions[(vOff + i) * 3 + 1] = position.getY(i);
      positions[(vOff + i) * 3 + 2] = position.getZ(i);
      normals[(vOff + i) * 3] = normal.getX(i);
      normals[(vOff + i) * 3 + 1] = normal.getY(i);
      normals[(vOff + i) * 3 + 2] = normal.getZ(i);
      colors[(vOff + i) * 3] = color.getX(i);
      colors[(vOff + i) * 3 + 1] = color.getY(i);
      colors[(vOff + i) * 3 + 2] = color.getZ(i);
    }
    for (let i = 0; i < index.count; i++) indices[iOff + i] = index.getX(i) + vOff;
    vOff += position.count;
    iOff += index.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

function shadowTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 124);
  grad.addColorStop(0, "rgba(0,0,0,0.38)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
