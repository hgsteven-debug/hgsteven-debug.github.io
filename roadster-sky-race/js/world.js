// 場景：天空、光線、地形、道路、護欄、岩石、能量環
import * as THREE from 'three';
import { Track, ROAD_HALF, ROAD_HALF_K, RAIL_L, PIT_DEPTH, DEFAULT_TRACK } from './track.js';
import { clamp, lerp, smoothstep, mulberry32, fbm2, noise2 } from './util.js';
import * as TX from './textures.js';

export const QUALITY = {
  low:  { label: '低', scale: 0.62, shadows: 0,    cell: 20, rocks: 90,  aa: false, physical: false, fx: false, ring: true, carLod: 'low' },
  med:  { label: '中', scale: 0.85, shadows: 1024, cell: 13, rocks: 240, aa: true,  physical: true,  fx: true,  ring: true, carLod: 'high' },
  high: { label: '高', scale: 1.0,  shadows: 1024, cell: 9,  rocks: 320, aa: true,  physical: true,  fx: true,  ring: true, carLod: 'high' },
};

export const SUN_DIR = new THREE.Vector3(-0.5, 0.52, 0.7).normalize();
export const HAZE = new THREE.Color().setRGB(0.80, 0.66, 0.52, THREE.LinearSRGBColorSpace);
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `
varying vec3 vDir; uniform vec3 sunDir; uniform float skyKind;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  if (skyKind > 2.5) {
    float stars = step(0.996, fract(sin(dot(d * 90.0, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
    float stars2 = step(0.9985, fract(sin(dot(d.zyx * 140.0, vec3(39.346, 11.135, 83.155))) * 24634.6345));
    vec3 col = vec3(0.0) + vec3(0.85, 0.9, 1.0) * stars + vec3(1.0) * stars2;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec3 horizon, mid, zenith;
  if (skyKind > 1.5) { // night
    horizon = vec3(0.10,0.12,0.22); mid = vec3(0.04,0.06,0.16); zenith = vec3(0.01,0.02,0.08);
  } else if (skyKind > 0.5) { // sunset
    horizon = vec3(0.95,0.45,0.28); mid = vec3(0.55,0.28,0.45); zenith = vec3(0.12,0.14,0.38);
  } else {
    horizon = vec3(0.80,0.66,0.52); mid = vec3(0.34,0.50,0.78); zenith = vec3(0.07,0.20,0.55);
  }
  float t = clamp(h,0.0,1.0);
  vec3 col = mix(horizon, mid, smoothstep(0.0,0.22,t));
  col = mix(col, zenith, smoothstep(0.18,0.85,t));
  if (skyKind < 0.5) col = mix(col, vec3(0.42,0.32,0.22), smoothstep(0.0,-0.25,h));
  float sd = max(dot(d,sunDir),0.0);
  if (skyKind > 1.5) {
    col += vec3(0.55,0.65,1.0)*pow(sd,8.0)*0.25;
    // 簡易星點
    float stars = step(0.997, fract(sin(dot(d.xy*40.0,vec2(12.9898,78.233)))*43758.5453));
    col += vec3(stars)*smoothstep(0.1,0.5,h)*0.8;
  } else {
    col += vec3(1.0,0.62,0.30)*pow(sd,6.0)*0.35;
    col += vec3(1.0,0.82,0.55)*pow(sd,40.0)*0.8;
    col += vec3(1.0,0.95,0.85)*smoothstep(0.9993,0.9998,sd)*12.0;
  }
  gl_FragColor = vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class World {
  constructor(renderer, scene, quality, trackId = DEFAULT_TRACK) {
    this.renderer = renderer; this.scene = scene; this.q = QUALITY[quality] || QUALITY.med;
    this.qname = quality;
    this.track = new Track(trackId);
    this.theme = this.track.theme;
    this.rings = [];
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.tmpV = new THREE.Vector3();
  }

  async build(progress = () => {}) {
    const steps = [
      ['load.sky', () => this.buildSky()],
      ['load.land', () => this.buildTerrain()],
      ['load.road', () => this.buildRoad()],
      ['load.rails', () => this.buildRails()],
      ['load.rocks', () => this.buildScenery()],
      ['load.rings', () => this.buildRings()],
      ['load.extras', () => this.buildExtras()],
    ];
    for (let i = 0; i < steps.length; i++) {
      progress((i / steps.length), steps[i][0]);
      await nextFrame();
      steps[i][1]();
    }
    progress(1, 'load.done');
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
      uniforms: { sunDir: { value: new THREE.Vector3(...this.theme.sun).normalize() }, skyKind: { value: this.theme.skyKind === 'space' ? 3.0 : (this.theme.skyKind === 'night' ? 2.0 : (this.theme.skyKind === 'sunset' ? 1.0 : 0.0)) } },
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
    const th = this.theme;
    const haze = new THREE.Color().setRGB(th.fog[0], th.fog[1], th.fog[2], THREE.LinearSRGBColorSpace);
    scene.fog = new THREE.FogExp2(haze, th.fogDen);
    const sunDir = new THREE.Vector3(...th.sun).normalize();
    this.sunDir = sunDir;

    const sun = new THREE.DirectionalLight(th.sunCol, th.sunInt);
    sun.position.copy(sunDir).multiplyScalar(150);
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
    const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGnd, th.hemiInt);
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
    const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.horizon), side: THREE.BackSide, fog: true });
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
    const tc = this.theme.sand;
    const sand = new THREE.Color(tc[0]), sand2 = new THREE.Color(tc[1]), rock = new THREE.Color(tc[2]), rock2 = new THREE.Color(tc[3]), dust = new THREE.Color(tc[4]);
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
    const gapSkip = (i) => (tr.hiddenRoad ? tr.hiddenRoad(i) : tr.isGapIdx(i + 0.5));
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
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.5,
      side: tr.hasRibbon ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !!this.q.shadows;
    this.road = mesh;
    this.scene.add(mesh);

    // 路側裙邊 + 缺口斷面
    const sp = [], sc = [], si = [];
    const gray = new THREE.Color(this.theme.road[0]), dark = new THREE.Color(this.theme.road[1]);
    const addQuad = (p0, p1, p2, p3, color) => {
      const o = sp.length / 3;
      for (const p of [p0, p1, p2, p3]) { sp.push(p.x, p.y, p.z); sc.push(color.r, color.g, color.b); }
      si.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      if (gapSkip(i)) continue;
      if (tr.kind && tr.kind[tr.wrap(i)] !== 0) continue;
      for (const side of [-1, 1]) {
        tr.surface(i, side * ROAD_HALF_K, A); tr.surface(i + 1, side * ROAD_HALF_K, B);
        C.copy(B).setY(B.y - 1.4); D.copy(A).setY(A.y - 1.4);
        if (side < 0) addQuad(A, B, C, D, gray); else addQuad(B, A, D, C, gray);
      }
    }
    for (const g of tr.gaps) {
      const glen = tr.gapSpan ? tr.gapSpan(g) : tr.gapLen;
      const i0 = g.g0, i1 = tr.wrap(g.g0 + glen);
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
        if (!tr.hasRail(i + 0.5)) continue;
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
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.rail, vertexColors: true, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    const rail = new THREE.Mesh(geo, mat);
    rail.castShadow = !!this.q.shadows;
    this.scene.add(rail);

    // 立柱（實例化）
    const spacing = 4;
    const list = [];
    for (const side of [-1, 1]) for (let i = 0; i < N; i += spacing) {
      if (!tr.hasRail(i + 0.5) || !tr.hasRail(i + spacing - 0.5)) continue;
      list.push([i, side]);
    }
    const pg = new THREE.BoxGeometry(0.14, 1.0, 0.14);
    const posts = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: this.theme.post, roughness: 0.6, metalness: 0.6 }), list.length);
    const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: this.theme.refl, toneMapped: false }), Math.ceil(list.length / 3));
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
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.rock, roughness: 0.95, metalness: 0, flatShading: false });
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
      const span = tr.gapSpan ? tr.gapSpan(g) : tr.gapLen;
      return a > -tr.rampRows - 40 && a < span + 30;
    });
    const GR = 14;
    for (let k = 0; k < GR; k++) {
      const i = Math.round((k + 0.35) * N / GR);
      if (nearGap(i)) continue;
      if (tr.kind && tr.kind[tr.wrap(i)]) continue;
      const lat = (k % 2 ? 1 : -1) * 4.5;
      const p = tr.surface(i, lat); p.y += 1.9;
      list.push({ pos: p, T: new THREE.Vector3(tr.tx[i], 0, tr.tz[i]), R: 3.7, air: false, on: true, i });
    }
    for (const g of tr.gaps) {
      for (const f of [0.3, 0.72]) {
        const glen = tr.gapSpan ? tr.gapSpan(g) : tr.gapLen;
        const i = g.g0 + Math.round(glen * f);
        const lipY = tr.py[tr.wrap(g.g0)];
        const p = tr.surface(i, 0); p.y = lipY + 5.5 + (f > 0.5 ? 0.5 : 0);
        list.push({ pos: p, T: new THREE.Vector3(tr.tx[tr.wrap(i)], 0, tr.tz[tr.wrap(i)]), R: 5.2, air: true, on: true, i: tr.wrap(i) });
      }
    }
    this.rings = list;
    const tor = new THREE.TorusGeometry(1, 0.075, 8, 32);
    const rc = this.theme.ring;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rc[0], rc[1], rc[2]), toneMapped: false });
    const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(rc[0]*0.5, rc[1]*0.4, rc[2]*0.4), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
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


  // 海岸橋樑／隧道、雪山夜燈等主題裝飾（低面數）
  buildExtras() {
    const th = this.theme, tr = this.track, def = tr.def;
    if (!def) return;
    const group = new THREE.Group();
    const wrap = tr.wrap;
    if (def.bridges) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6a7580, metalness: 0.7, roughness: 0.4 });
      const decks = [];
      const pillars = [];
      for (const f of def.bridges) {
        const i = wrap(Math.round(f * tr.N));
        const segs = 8;
        for (let k = -segs; k <= segs; k++) {
          const j = wrap(i + k * 2);
          decks.push([tr.px[j], tr.py[j] - 0.8, tr.pz[j], tr.px[wrap(j + 1)], tr.py[wrap(j + 1)] - 0.8, tr.pz[wrap(j + 1)]]);
          if (k % 2 === 0) {
            for (const side of [-1, 1]) {
              pillars.push({
                x: tr.px[j] + tr.rx[j] * side * ROAD_HALF_K * 1.05,
                y: tr.py[j] - Math.max(2, tr.py[j] * 0.08 + 3),
                z: tr.pz[j] + tr.rz[j] * side * ROAD_HALF_K * 1.05,
                h: Math.max(4, tr.py[j] * 0.15 + 6),
              });
            }
          }
        }
      }
      const dummy = new THREE.Object3D();
      if (decks.length) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(ROAD_HALF_K * 2.2, 0.5, tr.ds * 2.2), mat, decks.length);
        decks.forEach((p, n) => {
          dummy.position.set(p[0], p[1], p[2]);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.lookAt(p[3], p[4], p[5]);
          dummy.updateMatrix();
          mesh.setMatrixAt(n, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
      if (pillars.length) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 1, 0.35), mat, pillars.length);
        pillars.forEach((p, n) => {
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, p.h, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(n, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }
    if (def.tunnel != null) {
      const i = wrap(Math.round(def.tunnel * tr.N));
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.9, side: THREE.DoubleSide });
      const arches = [];
      for (let k = -18; k <= 18; k++) {
        const j = wrap(i + k);
        arches.push([tr.px[j], tr.py[j] + 1.2, tr.pz[j], tr.px[wrap(j + 1)], tr.py[wrap(j + 1)] + 1.2, tr.pz[wrap(j + 1)]]);
      }
      const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(ROAD_HALF_K + 2.5, ROAD_HALF_K + 2.5, tr.ds * 1.1, 12, 1, true, 0, Math.PI), mat, arches.length);
      const dummy = new THREE.Object3D();
      arches.forEach((p, n) => {
        dummy.position.set(p[0], p[1], p[2]);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.lookAt(p[3], p[4], p[5]);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
    if (tr.obstacles && tr.obstacles.length) {
      for (const o of tr.obstacles) {
        const len = o.len || 3.6, ht = o.ht || 1.15;
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(len, ht, 1.65),
          new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.5, metalness: 0.25 }),
        );
        body.position.set(o.x, o.y + 0.1, o.z);
        body.rotation.y = o.yaw || 0;
        body.castShadow = !!this.q.shadows;
        const cab = new THREE.Mesh(
          new THREE.BoxGeometry(len * 0.4, 0.62, 1.45),
          new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.25, metalness: 0.45 }),
        );
        cab.position.set(-len * 0.06, ht * 0.55, 0);
        body.add(cab);
        const wgeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
        const wmat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const w = new THREE.Mesh(wgeo, wmat);
          w.rotation.z = Math.PI / 2;
          w.position.set(sx * len * 0.32, -ht * 0.42, sz * 0.72);
          body.add(w);
        }
        group.add(body);
      }
      if (tr.stunt) {
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x5a534c, roughness: 0.92 });
        for (let i = tr.stunt.jump0; i <= tr.stunt.jump1; i += 2) {
          const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.28, Math.max(1.6, tr.ds * 2.1)), deckMat);
          deck.position.set(tr.px[i], tr.py[i] + 0.15, tr.pz[i]);
          deck.rotation.y = Math.atan2(tr.tx[i], tr.tz[i]);
          group.add(deck);
        }
      }
    }
    if (th.skyKind === 'night') {
      const spots = [];
      for (let i = 0; i < tr.N; i += 28) {
        for (const side of [-1, 1]) {
          spots.push([
            tr.px[i] + tr.rx[i] * side * (ROAD_HALF_K + 1.2),
            tr.py[i] + 3.2,
            tr.pz[i] + tr.rz[i] * side * (ROAD_HALF_K + 1.2),
          ]);
        }
      }
      if (spots.length) {
        const mesh = new THREE.InstancedMesh(
          new THREE.SphereGeometry(0.25, 6, 4),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 0.7), toneMapped: false }),
          spots.length,
        );
        const dummy = new THREE.Object3D();
        spots.forEach((p, n) => {
          dummy.position.set(p[0], p[1], p[2]);
          dummy.updateMatrix();
          mesh.setMatrixAt(n, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }
    this.scene.add(group);
    this.extras = group;
    this._cityBlocks();
    this._moonSet();
    this._stuntGuides();
  }

  // 月球：地球、慢落的塵、低面數隕石。
  _moonSet() {
    const tr = this.track;
    if (!tr || !tr.def || !tr.def.moon) return;
    const b = tr.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(26, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x2d6eb8 }),
    );
    const land = new THREE.Mesh(
      new THREE.SphereGeometry(26.3, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x3c8f4e }),
    );
    land.scale.set(0.72, 0.55, 0.42);
    land.position.set(8, 6, 10);
    earth.add(land);
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(27.2, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xe7eef5, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    earth.add(cloud);
    earth.position.set(cx - 180, (tr.py[0] || 0) + 150, cz - 220);
    this.scene.add(earth);
    this.earth = earth;

    const n = this.qname === 'low' ? 70 : 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = 0.3 + Math.random() * 3.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xc8c4bc, size: 0.45, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(dust);
    this.moonDust = dust;

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1, metalness: 0 });
    const q = tr.newQuery();
    const rng = (i) => {
      const x = Math.sin(i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    const bowls = [];
    const stones = [];
    for (let i = 0; i < 14; i++) {
      const f = rng(i + 3);
      const ang = f * Math.PI * 2;
      const rad = 40 + rng(i + 9) * 80;
      const x = cx + Math.cos(ang) * rad;
      const z = cz + Math.sin(ang) * rad;
      tr.query(x, z, q);
      if (q.near && q.al < 24) continue;
      bowls.push({ x, y: tr.terrainHeight(x, z) + 0.2, z, s: (4 + f * 6) / 4 });
      stones.push({
        x: x + 6, y: tr.terrainHeight(x + 6, z + 4) + 0.8, z: z + 4,
        s: (1.1 + f * 1.6) / 1.1, rx: f, ry: f * 2,
      });
    }
    const dummy = new THREE.Object3D();
    if (bowls.length) {
      const mesh = new THREE.InstancedMesh(new THREE.TorusGeometry(4, 0.55, 4, 7), rockMat, bowls.length);
      bowls.forEach((p, n) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(p.s, p.s, p.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.extras.add(mesh);
    }
    if (stones.length) {
      const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.1, 0), rockMat, stones.length);
      stones.forEach((p, n) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, p.ry, 0.3);
        dummy.scale.set(p.s, p.s, p.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.extras.add(mesh);
    }
  }

  // 街道環道：離開路面的方塊樓，沒有招牌或標誌。
  _cityBlocks() {
    const tr = this.track;
    if (!tr || !tr.def || !tr.def.city) return;
    const b = tr.bounds;
    const step = this.qname === 'low' ? 58 : 44;
    const cap = this.qname === 'low' ? 36 : this.qname === 'high' ? 84 : 60;
    const spots = [];
    const q = tr.newQuery();
    for (let x = b.minX - 16; x <= b.maxX + 16 && spots.length < cap; x += step) {
      for (let z = b.minZ - 16; z <= b.maxZ + 16 && spots.length < cap; z += step) {
        const hsh = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        const f = hsh - Math.floor(hsh);
        const jx = x + (f - 0.5) * 16;
        const jz = z + (((f * 7.1) % 1) - 0.5) * 16;
        tr.query(jx, jz, q);
        if (q.near && q.al < 36) continue;
        spots.push({
          x: jx, z: jz,
          w: 14 + (f * 17 % 12),
          d: 12 + (f * 13 % 14),
          ht: 8 + (f * 31 % 26),
          c: f,
        });
      }
    }
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.05 }),
      spots.length,
    );
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const palette = [0x8d97a3, 0x6a7582, 0xc2b6a4, 0x4e5966, 0x9aa6b0, 0x7d6a5c];
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.ht / 2, s.z);
      dummy.scale.set(s.w, s.ht, s.d);
      dummy.rotation.set(0, (s.c * 6) % 1 > 0.72 ? 0.35 : 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setHex(palette[Math.floor(s.c * palette.length) % palette.length]);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.cityBlocks = mesh;
  }

  // 迴旋試煉：路面箭頭與檢查門，標出該往哪開。
  _stuntGuides() {
    const tr = this.track;
    if (!tr || !tr.stunt || !tr.frame) return;
    const idxs = [];
    for (let i = 0; i < tr.N; i += 14) {
      if (tr.hiddenRoad && tr.hiddenRoad(i)) continue;
      idxs.push(i);
    }
    if (idxs.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.02, -1.15,
        0.62, 0.02, 0.55,
        0.16, 0.02, 0.28,
        0, 0.02, -1.15,
        -0.16, 0.02, 0.28,
        -0.62, 0.02, 0.55,
      ], 3));
      const arrows = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, toneMapped: false, side: THREE.DoubleSide,
      }), idxs.length);
      const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      idxs.forEach((i, n) => {
        const f = tr.frame(i);
        const kind = tr.kind ? tr.kind[tr.wrap(i)] : 0;
        if (kind === 2) col.setHex(0x7ad7ff);
        else if (kind === 3 || kind === 4) col.setHex(0xff8ad4);
        else if (kind === 1) col.setHex(0xffb703);
        else col.setHex(0xffe29a);
        right.copy(f.right).multiplyScalar(2.35);
        up.copy(f.normal).multiplyScalar(1);
        fwd.copy(f.tangent).multiplyScalar(-2.7);
        m.makeBasis(right, up, fwd);
        m.setPosition(f.pos.x + f.normal.x * 0.28, f.pos.y + f.normal.y * 0.28, f.pos.z + f.normal.z * 0.28);
        arrows.setMatrixAt(n, m);
        arrows.setColorAt(n, col);
      });
      arrows.instanceMatrix.needsUpdate = true;
      if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
      this.scene.add(arrows);
      this.stuntArrows = arrows;
    }
    const cps = tr.checkpoints || [];
    if (!cps.length) return;
    const postGeo = new THREE.BoxGeometry(0.42, 6.2, 0.42);
    const beamGeo = new THREE.BoxGeometry(ROAD_HALF * 2 + 1.6, 0.38, 0.38);
    const gmat = new THREE.MeshBasicMaterial({ color: 0xffcc66, toneMapped: false });
    const gates = new THREE.Group();
    for (const raw of cps) {
      const i = tr.wrap(raw);
      if (i < 24) continue;
      const f = tr.frame(i);
      if (f.normal.y < 0.55) continue;
      const left = new THREE.Mesh(postGeo, gmat);
      const rightM = new THREE.Mesh(postGeo, gmat);
      left.position.copy(f.pos).addScaledVector(f.right, -(ROAD_HALF + 0.2)).addScaledVector(f.normal, 3.1);
      rightM.position.copy(f.pos).addScaledVector(f.right, ROAD_HALF + 0.2).addScaledVector(f.normal, 3.1);
      const beam = new THREE.Mesh(beamGeo, gmat);
      const bm = new THREE.Matrix4().makeBasis(f.right, f.normal, f.tangent);
      beam.quaternion.setFromRotationMatrix(bm);
      beam.position.copy(f.pos).addScaledVector(f.normal, 6.2);
      gates.add(left, rightM, beam);
    }
    this.scene.add(gates);
    this.stuntGates = gates;
  }

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
    if (this.moonDust && carPos) {
      const attr = this.moonDust.geometry.attributes.position;
      const arr = attr.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= 0.012;
        if (arr[i] < 0.15) arr[i] = 2.4 + (i % 7) * 0.2;
      }
      attr.needsUpdate = true;
      this.moonDust.position.set(carPos.x, carPos.y, carPos.z);
    }
    if (this.sun) {
      const tx = this.q.shadows ? Math.round(carPos.x / 2) * 2 : carPos.x;
      const tz = this.q.shadows ? Math.round(carPos.z / 2) * 2 : carPos.z;
      this.sun.target.position.set(tx, carPos.y, tz);
      this.sun.position.set(tx + SUN_DIR.x * 150, carPos.y + SUN_DIR.y * 150, tz + SUN_DIR.z * 150);
    }
  }
}
