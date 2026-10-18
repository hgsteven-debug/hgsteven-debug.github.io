// 場景：天空、光線、地形、道路、護欄、岩石、能量環
import * as THREE from 'three';
import { Track, ROAD_HALF, ROAD_HALF_K, RAIL_L, PIT_DEPTH } from './track.js';
import { clamp, lerp, smoothstep, mulberry32, fbm2, noise2 } from './util.js';
import * as TX from './textures.js';

export const QUALITY = {
  low:  { label: '低', scale: 0.62, shadows: 0,    cell: 20, rocks: 90,  aa: false, physical: false, fx: false, ring: true, carLod: 'low' },
  med:  { label: '中', scale: 0.85, shadows: 1024, cell: 13, rocks: 240, aa: true,  physical: true,  fx: true,  ring: true, carLod: 'high' },
  high: { label: '高', scale: 1.0,  shadows: 2048, cell: 9,  rocks: 320, aa: true,  physical: true,  fx: true,  ring: true, carLod: 'high' },
};

export const SUN_DIR = new THREE.Vector3(-0.5, 0.52, 0.7).normalize();
export const HAZE = new THREE.Color().setRGB(0.80, 0.66, 0.52, THREE.LinearSRGBColorSpace);
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `
varying vec3 vDir; uniform vec3 sunDir;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 horizon = vec3(0.80,0.66,0.52), mid = vec3(0.34,0.50,0.78), zenith = vec3(0.07,0.20,0.55);
  float t = clamp(h,0.0,1.0);
  vec3 col = mix(horizon, mid, smoothstep(0.0,0.22,t));
  col = mix(col, zenith, smoothstep(0.18,0.85,t));
  col = mix(col, vec3(0.42,0.32,0.22), smoothstep(0.0,-0.25,h));
  float sd = max(dot(d,sunDir),0.0);
  col += vec3(1.0,0.62,0.30)*pow(sd,6.0)*0.35;
  col += vec3(1.0,0.82,0.55)*pow(sd,40.0)*0.8;
  col += vec3(1.0,0.95,0.85)*smoothstep(0.9993,0.9998,sd)*12.0;
  gl_FragColor = vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class World {
  constructor(renderer, scene, quality) {
    this.renderer = renderer; this.scene = scene; this.q = QUALITY[quality] || QUALITY.med;
    this.qname = quality;
    this.track = new Track();
    this.rings = [];
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.tmpV = new THREE.Vector3();
  }

  async build(progress = () => {}) {
    const steps = [
      ['天空與光線', () => this.buildSky()],
      ['沙漠地形', () => this.buildTerrain()],
      ['賽道路面', () => this.buildRoad()],
      ['護欄與路標', () => this.buildRails()],
      ['岩石與山脈', () => this.buildScenery()],
      ['能量環', () => this.buildRings()],
    ];
    for (let i = 0; i < steps.length; i++) {
      progress((i / steps.length), steps[i][0]);
      await nextFrame();
      steps[i][1]();
    }
    progress(1, '完成');
    // 調整環境反射強度
    this.scene.traverse((o) => {
      if (o.material && o.material.isMeshStandardMaterial && o.material.envMapIntensity === 1) o.material.envMapIntensity = 0.55;
    });
  }

  // ---------------- 天空 ----------------
  buildSky() {
    const scene = this.scene;
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR.clone() } },
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.sky = sky;
    // 以天空球產生環境反射（一次性）
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(geo, mat));
    this.envRT = pm.fromScene(envScene, 0, 0.1, 100);
    scene.environment = this.envRT.texture;
    pm.dispose();
    scene.add(sky);
    scene.fog = new THREE.FogExp2(HAZE.clone(), 0.00042);

    const sun = new THREE.DirectionalLight(0xffe2bd, 3.2);
    sun.position.copy(SUN_DIR).multiplyScalar(150);
    if (this.q.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.q.shadows, this.q.shadows);
      const c = sun.shadow.camera;
      c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 10; c.far = 420;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x8a6a48, 0.45);
    scene.add(hemi);

    // 遠方山脊環
    const seg = 160;
    const ring = new THREE.CylinderGeometry(3300, 3300, 1, seg, 1, true);
    const pos = ring.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const top = pos.getY(i) > 0;
      const h = 120 + 330 * Math.pow(fbm2(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 4), 1.6) + 180 * noise2(a * 24, 7);
      pos.setY(i, top ? h : -150);
    }
    ring.computeVertexNormals();
    const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6a5f66), side: THREE.BackSide, fog: true });
    this.horizon = new THREE.Mesh(ring, rm);
    this.horizon.frustumCulled = false;
    const b = this.track.bounds;
    this.horizon.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    scene.add(this.horizon);
  }

  // ---------------- 地形 ----------------
  buildTerrain() {
    const tr = this.track, b = tr.bounds, M = 800, cell = this.q.cell;
    const x0 = b.minX - M, z0 = b.minZ - M;
    const nx = Math.ceil((b.maxX - b.minX + 2 * M) / cell) + 1;
    const nz = Math.ceil((b.maxZ - b.minZ + 2 * M) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    const hs = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, k = j * nx + i;
      const h = tr.terrainHeight(x, z);
      hs[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
    }
    const idx = new (nx * nz > 65535 ? Uint32Array : Uint16Array)((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, bb = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = bb; idx[p++] = bb; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const sand = new THREE.Color(0xd2a96a), sand2 = new THREE.Color(0xb98a52), rock = new THREE.Color(0x7a5f4a), rock2 = new THREE.Color(0x4f4039), dust = new THREE.Color(0xe0c08a);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = pos[k * 3], z = pos[k * 3 + 2], h = hs[k];
      const n = fbm2(x * 0.01, z * 0.01, 3);
      c.copy(sand).lerp(sand2, smoothstep(0.25, 0.6, n)).lerp(dust, smoothstep(0.55, 0.8, fbm2(x * 0.004 + 3, z * 0.004, 2)) * 0.5);
      const slope = 1 - nrm.getY(k);
      tr.terrainHeight(x, z);
      const qq = tr._q2;
      const pit = qq.near ? tr.pitEdge(qq.fi) * (1 - smoothstep(ROAD_HALF_K + 2, ROAD_HALF_K + 16, qq.al)) : 0;
      const rockT = clamp(smoothstep(0.12, 0.4, slope) + smoothstep(30, 140, h) * 0.8, 0, 1);
      c.lerp(rock, rockT).lerp(rock2, smoothstep(120, 330, h) * 0.7);
      if (pit > 0) c.lerp(rock2, pit * 0.85).multiplyScalar(1 - 0.5 * pit);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sand_tex = TX.sandTexture(this.aniso);
    sand_tex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sand_tex, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !!this.q.shadows;
    this.terrain = mesh;
    this.scene.add(mesh);
  }

  // ---------------- 道路 ----------------
  buildRoad() {
    const tr = this.track, N = tr.N;
    const loops = Math.round(tr.length / TX.ROAD_TEX_LEN);
    const vPerM = loops / tr.length;
    const pos = [], uv = [], idx = [];
    const gapSkip = (i) => tr.isGapIdx(i + 0.5);
    const rowOf = new Int32Array(N + 1).fill(-1);
    let v = 0;
    for (let i = 0; i <= N; i++) {
      const L = tr.surface(i, -ROAD_HALF_K), R = tr.surface(i, ROAD_HALF_K);
      pos.push(L.x, L.y + 0.02, L.z, R.x, R.y + 0.02, R.z);
      uv.push(0, i * tr.ds * vPerM, 1, i * tr.ds * vPerM);
    }
    for (let i = 0; i < N; i++) {
      if (gapSkip(i)) continue;
      const a = i * 2, b = a + 1, c = (i + 1) * 2, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = TX.roadTexture(this.aniso);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !!this.q.shadows;
    this.road = mesh;
    this.scene.add(mesh);

    // 路側裙邊 + 缺口斷面
    const sp = [], sc = [], si = [];
    const gray = new THREE.Color(0x8d8a86), dark = new THREE.Color(0x5a5048);
    const addQuad = (p0, p1, p2, p3, color) => {
      const o = sp.length / 3;
      for (const p of [p0, p1, p2, p3]) { sp.push(p.x, p.y, p.z); sc.push(color.r, color.g, color.b); }
      si.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      if (gapSkip(i)) continue;
      for (const side of [-1, 1]) {
        tr.surface(i, side * ROAD_HALF_K, A); tr.surface(i + 1, side * ROAD_HALF_K, B);
        C.copy(B).setY(B.y - 1.4); D.copy(A).setY(A.y - 1.4);
        if (side < 0) addQuad(A, B, C, D, gray); else addQuad(B, A, D, C, gray);
      }
    }
    for (const g of tr.gaps) {
      const i0 = g.g0, i1 = g.g0 + tr.gapLen;
      const depth = PIT_DEPTH + 1.6;
      // 缺口起點斷面（朝向缺口）
      tr.surface(i0, -ROAD_HALF_K, A); tr.surface(i0, ROAD_HALF_K, B);
      C.copy(B).setY(B.y - depth); D.copy(A).setY(A.y - depth);
      addQuad(B, A, D, C, dark);
      // 落地端斷面（朝向缺口，法線反向）
      tr.surface(i1, -ROAD_HALF_K, A); tr.surface(i1, ROAD_HALF_K, B);
      C.copy(B).setY(B.y - depth); D.copy(A).setY(A.y - depth);
      addQuad(A, B, C, D, dark);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    rg.setIndex(si); rg.computeVertexNormals();
    const rm = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.4 }));
    rm.receiveShadow = !!this.q.shadows;
    this.scene.add(rm);

    // 起跑線
    const sl = new THREE.PlaneGeometry(ROAD_HALF * 2, 2.4);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
    const g = cv.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 16, y * 32, 16, 32); }
    const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace; st.anisotropy = this.aniso;
    const sm = new THREE.Mesh(sl, new THREE.MeshStandardMaterial({ map: st, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const p0 = tr.surface(0, 0);
    sm.position.copy(p0).setY(p0.y + 0.05);
    sm.rotation.order = 'YXZ';
    sm.rotation.y = tr.headingAt(0);
    sm.rotation.x = -Math.PI / 2;
    sm.rotateZ(0);
    this.scene.add(sm);

    // 龍門架
    const gm = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.7 });
    const h0 = tr.headingAt(0);
    const grp = new THREE.Group();
    grp.position.copy(p0); grp.rotation.y = h0;
    const pw = ROAD_HALF_K + 2;
    for (const s of [-1, 1]) {
      const pm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1.2), gm);
      pm.position.set(s * pw, 5.5, 0); pm.castShadow = !!this.q.shadows; grp.add(pm);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(pw * 2 + 1.2, 1.0, 1.4), gm);
    beam.position.set(0, 11, 0); grp.add(beam);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(pw * 2 - 2, 3.2),
      new THREE.MeshBasicMaterial({ map: TX.gantryTexture(), toneMapped: false, side: THREE.DoubleSide }));
    banner.position.set(0, 9.2, 0.0); grp.add(banner);
    this.scene.add(grp);

    // 缺口警示牌（面向來車）
    const wt = TX.warnTexture();
    const wg = new THREE.PlaneGeometry(6.4, 3.2);
    const wmat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.6, side: THREE.DoubleSide });
    const warns = new THREE.InstancedMesh(wg, wmat, tr.gaps.length * 2);
    const dummy = new THREE.Object3D();
    let wi = 0;
    for (const g2 of tr.gaps) for (const s of [-1, 1]) {
      const i = tr.wrap(g2.g0 - tr.rampRows - 38);
      const sp2 = tr.surface(i, s * (RAIL_L + 2.2));
      dummy.position.set(sp2.x, sp2.y + 3.2, sp2.z);
      dummy.lookAt(dummy.position.x - tr.tx[i], dummy.position.y, dummy.position.z - tr.tz[i]);
      dummy.updateMatrix(); warns.setMatrixAt(wi++, dummy.matrix);
    }
    this.scene.add(warns);
    // 警示牌立柱
    const pg = new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6);
    const posts = new THREE.InstancedMesh(pg, gm, tr.gaps.length * 2);
    wi = 0;
    for (const g2 of tr.gaps) for (const s of [-1, 1]) {
      const i = tr.wrap(g2.g0 - tr.rampRows - 38);
      const sp2 = tr.surface(i, s * (RAIL_L + 2.2));
      dummy.position.set(sp2.x, sp2.y + 1.6 - 0.2, sp2.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); posts.setMatrixAt(wi++, dummy.matrix);
    }
    this.scene.add(posts);
  }

  // ---------------- 護欄 ----------------
  buildRails() {
    const tr = this.track, N = tr.N;
    const pos = [], idx = [], col = [];
    const A = new THREE.Vector3();
    const pts = (i, side) => {
      const inner = tr.surface(i, side * RAIL_L, new THREE.Vector3());
      const outer = tr.surface(i, side * (RAIL_L + 0.14), new THREE.Vector3());
      return [
        [inner.x, inner.y + 0.38, inner.z], [inner.x, inner.y + 0.92, inner.z],
        [outer.x, outer.y + 0.92, outer.z], [outer.x, outer.y + 0.38, outer.z],
      ];
    };
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        if (tr.isGapIdx(i + 0.5)) continue;
        const a = pts(i, side), b = pts(i + 1, side);
        // 三個面：內側、頂面、外側
        for (const [p, q] of [[0, 1], [1, 2], [2, 3]]) {
          const o = pos.length / 3;
          pos.push(...a[p], ...a[q], ...b[q], ...b[p]);
          const shade = (i % 20 < 10) ? 1 : 0.86;
          for (let k = 0; k < 4; k++) col.push(shade, shade, shade);
          if ((side < 0) === (p !== 1)) idx.push(o, o + 1, o + 2, o, o + 2, o + 3); else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, vertexColors: true, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    const rail = new THREE.Mesh(geo, mat);
    rail.castShadow = !!this.q.shadows;
    this.scene.add(rail);

    // 立柱（實例化）
    const spacing = 4;
    const list = [];
    for (const side of [-1, 1]) for (let i = 0; i < N; i += spacing) {
      if (tr.isGapIdx(i + 0.5) || tr.isGapIdx(i + spacing - 0.5)) continue;
      list.push([i, side]);
    }
    const pg = new THREE.BoxGeometry(0.14, 1.0, 0.14);
    const posts = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.6, metalness: 0.6 }), list.length);
    const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false }), Math.ceil(list.length / 3));
    const d = new THREE.Object3D();
    let ri = 0;
    list.forEach(([i, side], n) => {
      const p = tr.surface(i, side * (RAIL_L + 0.07));
      d.position.set(p.x, p.y + 0.5, p.z); d.rotation.set(0, 0, 0); d.updateMatrix(); posts.setMatrixAt(n, d.matrix);
      if (n % 3 === 0 && ri < refl.count) {
        const pi = tr.surface(i, side * (RAIL_L - 0.0));
        d.position.set(pi.x, pi.y + 0.72, pi.z);
        d.rotation.set(0, Math.atan2(tr.rx[i % N], tr.rz[i % N]), 0);
        d.updateMatrix(); refl.setMatrixAt(ri++, d.matrix);
      }
    });
    refl.count = ri;
    posts.castShadow = !!this.q.shadows;
    this.scene.add(posts); this.scene.add(refl);
  }

  // ---------------- 岩石與景物 ----------------
  buildScenery() {
    const tr = this.track, rnd = mulberry32(99);
    // 抖動的二十面體
    const geo = new THREE.IcosahedronGeometry(1, this.qname === 'high' ? 2 : 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + 0.5 * noise2(x * 2.1 + 11, z * 2.1 + y * 1.7);
      p.setXYZ(i, x * k, y * k * 0.85, z * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: false });
    const count = this.q.rocks;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const d = new THREE.Object3D(), col = new THREE.Color();
    const tmp = tr.newQuery();
    let n = 0, guard = 0;
    while (n < count && guard++ < count * 20) {
      let x, z;
      const near = rnd() < 0.65;
      if (near) {
        const i = Math.floor(rnd() * tr.N), side = rnd() < 0.5 ? -1 : 1;
        const l = side * (ROAD_HALF_K + 14 + rnd() * rnd() * 140);
        x = tr.px[i] + tr.rx[i] * l; z = tr.pz[i] + tr.rz[i] * l;
      } else {
        const b = tr.bounds;
        x = lerp(b.minX - 500, b.maxX + 500, rnd()); z = lerp(b.minZ - 500, b.maxZ + 500, rnd());
      }
      tr.query(x, z, tmp);
      if (tmp.near && tmp.al < ROAD_HALF_K + 12) continue;
      const big = rnd() < 0.06 && tmp.al > 90;
      const s = big ? 18 + rnd() * 40 : 0.8 + Math.pow(rnd(), 2.2) * 6.5;
      const y = tr.terrainHeightFromQuery(x, z, tmp);
      d.position.set(x, y + s * 0.25, z);
      d.rotation.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.4);
      d.scale.set(s * (0.9 + rnd() * 0.5), s * (big ? 1.7 + rnd() : 0.7 + rnd() * 0.6), s * (0.9 + rnd() * 0.5));
      d.updateMatrix();
      mesh.setMatrixAt(n, d.matrix);
      col.setHSL(0.07 + rnd() * 0.03, 0.28 + rnd() * 0.15, 0.22 + rnd() * 0.2);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!this.q.shadows; mesh.receiveShadow = !!this.q.shadows;
    this.scene.add(mesh);
  }

  // ---------------- 能量環 ----------------
  buildRings() {
    const tr = this.track, N = tr.N;
    const list = [];
    const nearGap = (i) => tr.gaps.some((g) => {
      let a = i - g.g0; if (a < -N / 2) a += N; if (a > N / 2) a -= N;
      return a > -tr.rampRows - 40 && a < tr.gapLen + 30;
    });
    const GR = 14;
    for (let k = 0; k < GR; k++) {
      const i = Math.round((k + 0.35) * N / GR);
      if (nearGap(i)) continue;
      const lat = (k % 2 ? 1 : -1) * 4.5;
      const p = tr.surface(i, lat); p.y += 1.9;
      list.push({ pos: p, T: new THREE.Vector3(tr.tx[i], 0, tr.tz[i]), R: 3.7, air: false, on: true, i });
    }
    for (const g of tr.gaps) {
      for (const f of [0.3, 0.72]) {
        const i = g.g0 + Math.round(tr.gapLen * f);
        const lipY = tr.py[tr.wrap(g.g0)];
        const p = tr.surface(i, 0); p.y = lipY + 5.5 + (f > 0.5 ? 0.5 : 0);
        list.push({ pos: p, T: new THREE.Vector3(tr.tx[tr.wrap(i)], 0, tr.tz[tr.wrap(i)]), R: 5.2, air: true, on: true, i: tr.wrap(i) });
      }
    }
    this.rings = list;
    const tor = new THREE.TorusGeometry(1, 0.075, 8, 32);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.6, 2.4), toneMapped: false });
    const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.6, 1.0), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.ringMesh = new THREE.InstancedMesh(tor, mat, list.length);
    this.haloMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.2, 6, 32), halo, list.length);
    this.ringMesh.frustumCulled = false; this.haloMesh.frustumCulled = false;
    this.scene.add(this.ringMesh); this.scene.add(this.haloMesh);
    this._rd = new THREE.Object3D();
    this._rq = new THREE.Quaternion();
    this._rm = new THREE.Matrix4();
    this.updateRings(0, 0);
  }

  resetRings() { for (const r of this.rings) r.on = true; }

  updateRings(dt, time) {
    const d = this._rd;
    this.rings.forEach((r, i) => {
      d.position.copy(r.pos);
      d.lookAt(r.pos.x + r.T.x, r.pos.y, r.pos.z + r.T.z);
      const pulse = 1 + 0.035 * Math.sin(time * 4 + i);
      const s = r.on ? r.R * pulse : 0.0001;
      d.scale.set(s, s, s);
      d.updateMatrix();
      this.ringMesh.setMatrixAt(i, d.matrix);
      this.haloMesh.setMatrixAt(i, d.matrix);
    });
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceMatrix.needsUpdate = true;
  }

  // 每幀：天空跟隨相機、陰影跟隨車輛
  update(camera, carPos) {
    this.sky.position.copy(camera.position);
    if (this.sun) {
      const tx = this.q.shadows ? Math.round(carPos.x / 2) * 2 : carPos.x;
      const tz = this.q.shadows ? Math.round(carPos.z / 2) * 2 : carPos.z;
      this.sun.target.position.set(tx, carPos.y, tz);
      this.sun.position.set(tx + SUN_DIR.x * 150, carPos.y + SUN_DIR.y * 150, tz + SUN_DIR.z * 150);
    }
  }
}
