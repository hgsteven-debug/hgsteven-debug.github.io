// 道具戰：擲骰、命中、打轉不削垂直速度、封包與中繼、使用鍵的補送。
import * as sync from '../js/sync.js';
import { mqttPublish } from '../js/relay.js';
import {
  encodeState, decodeState, createDict, encodeInput, decodeInput, bytesToB64, unwrapRelay,
} from '../js/wire.js';
import {
  ITEM, layoutBoxes, rollItem, itemWeights, ItemBattle, applyDriveFx, packItemBits, unpackItemBits,
} from '../js/items.js';

const fails = [];
const ok = (name, extra) => console.log('PASS', name, extra || '');
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function track() {
  const N = 600;
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    px[i] = Math.cos(a) * 280;
    pz[i] = Math.sin(a) * 280;
    py[i] = Math.sin(a * 2) * 2;
  }
  return { N, ds: (2 * Math.PI * 280) / N, length: 2 * Math.PI * 280, px, py, pz };
}

function racer(name, x, z, fi) {
  return {
    name, netId: name, parked: false,
    lap: { n: 1 },
    driver: { kind: 'local', input: { state: { item: false } }, state: {} },
    veh: {
      pos: { x, y: 1, z }, vel: { x: 0, y: 0, z: 0 }, heading: 0,
      tr: { N: 600 }, q1: { fi }, item: 0, spinT: 0, iFrame: 0, shield: false, shieldT: 0,
      boostT: 0, slowT: 0, aimed: false, attached: false,
    },
  };
}

function testOdds() {
  const leader = itemWeights(1, 4);
  const last = itemWeights(4, 4);
  assert(leader[0] > last[0], 'leader gets more darts');
  assert(last[1] > leader[1], 'back gets more seekers');
  assert(last[5] > 20 && leader[5] < 3, 'gale is for last ' + leader[5] + ' ' + last[5]);
  const rng = mulberry(3);
  let storm = 0;
  let spark = 0;
  for (let i = 0; i < 400; i++) {
    const id = rollItem(1, 4, rng);
    if (id === ITEM.STORM) storm++;
    if (id === ITEM.SPARK) spark++;
  }
  assert(spark > 120, 'leader darts ' + spark);
  assert(storm < 20, 'leader gale ' + storm);
}

function testSpinKeepsGravity() {
  const veh = {
    vel: { x: 30, y: 6, z: 0 }, heading: 0, spinT: 1.2, iFrame: 0, shieldT: 0, slowT: 0, boostT: 0, attached: false,
  };
  const g = 1.62;
  for (let i = 0; i < 30; i++) {
    applyDriveFx(veh, 1 / 60, { throttle: 1, steer: 0 });
    veh.vel.y -= g / 60;
  }
  assert(veh.vel.y < 6 - 0.5, 'moon gravity still pulls ' + veh.vel.y);
  assert(Math.hypot(veh.vel.x, veh.vel.z) < 20, 'spin bled speed ' + veh.vel.x);
  assert(veh.spinT < 1.2, 'spin timer moved');
}

function testBattle() {
  const tr = track();
  const boxes = layoutBoxes(tr);
  assert(boxes.length >= 8, 'boxes ' + boxes.length);
  const battle = new ItemBattle(tr, boxes, () => 0.999);
  const lead = racer('P1', 0, 0, 500);
  const back = racer('P4', 10, 0, 40);
  const b = boxes[0];
  back.veh.pos.x = b.x;
  back.veh.pos.y = b.y;
  back.veh.pos.z = b.z;
  battle.step(1 / 60, [lead, back]);
  assert(back.veh.item === ITEM.STORM, 'last place gale ' + back.veh.item);
  assert(!b.alive, 'box taken');
  battle.use(back, [lead, back]);
  assert(lead.veh.slowT > 1 && lead.veh.spinT === 0, 'gale slows the leader');
  assert(back.veh.boostT > 0, 'gale still boosts the user');
  lead.veh.iFrame = 0;
  lead.veh.slowT = 0;
  lead.veh.shield = true;
  lead.veh.spinT = 0;
  back.veh.item = ITEM.SPARK;
  back.veh.heading = 0;
  back.veh.pos.x = 0;
  back.veh.pos.z = 0;
  lead.veh.pos.x = 0;
  lead.veh.pos.y = back.veh.pos.y;
  lead.veh.pos.z = -8;
  battle.use(back);
  assert(battle.shots.length === 1 && battle.shots[0].kind === ITEM.SPARK, 'dart fired');
  for (let i = 0; i < 40 && lead.veh.spinT === 0 && lead.veh.shield; i++) battle.step(1 / 60, [lead, back]);
  assert(!lead.veh.shield && lead.veh.spinT === 0, 'shield blocks one hit');
  back.veh.item = ITEM.DRONE;
  lead.veh.iFrame = 0;
  lead.veh.spinT = 0;
  back.veh.pos.x = 0;
  back.veh.pos.z = 0;
  lead.veh.pos.x = 0;
  lead.veh.pos.z = -18;
  battle.use(back, [lead, back]);
  let hit = false;
  for (let i = 0; i < 180; i++) {
    battle.step(1 / 60, [lead, back]);
    if (lead.veh.spinT > 0) { hit = true; break; }
  }
  assert(hit, 'seeker caught the car ahead');
  const vy = lead.veh.vel.y;
  applyDriveFx(lead.veh, 1 / 60, {});
  assert(lead.veh.vel.y === vy, 'spin leaves vertical speed');
  lead.veh.spinT = 0.4;
  lead.veh.iFrame = 1;
  back.veh.item = ITEM.SPARK;
  back.veh.pos.z = 0;
  lead.veh.pos.z = -8;
  battle.use(back);
  for (let i = 0; i < 30; i++) battle.step(1 / 60, [lead, back]);
  assert(Math.abs(lead.veh.spinT - 0.4) < 0.001, 'invulnerable after a hit ' + lead.veh.spinT);
}

function testWire() {
  const ctx = {};
  const dict = createDict();
  const plain = {
    t: 'state', race: 'race', track: 'moon', ack: 3,
    self: { x: 1, y: 2, z: 3, vx: 4, vy: 1.62, vz: 0, heading: 0.2, qx: 0, qy: 0, qz: 0, qw: 1, speed: 4, energy: 80, groundY: 1 },
    selfId: 'P3', selfLap: { n: 1, t: 1 },
    cars: [{ id: 'P1', name: 'P1', kind: 'ai', x: 8, y: 1, z: 0, vx: 1, vy: 0, vz: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 1 }],
  };
  const off = encodeState(plain, ctx, 0);
  const on = encodeState(Object.assign({}, plain, {
    self: Object.assign({ item: ITEM.DRONE, aimed: true, hitKind: ITEM.SPARK, hitBlock: true }, plain.self),
    cars: [Object.assign({ item: ITEM.AEGIS, shield: true }, plain.cars[0])],
    battle: {
      on: true,
      boxes: [{ alive: true }, { alive: false }, { alive: true }],
      shots: [{ kind: ITEM.SPARK, x: 12.4, y: 1.5, z: -3, owner: 'P3', target: '' }],
    },
  }), {}, 0);
  const decOff = decodeState(off, dict);
  assert(!decOff.battle, 'items off stays lean');
  const dec = decodeState(on, createDict());
  assert(dec.battle && dec.battle.on && dec.battle.boxes.length === 3, 'boxes');
  assert(dec.battle.boxes[1].alive === false && dec.battle.boxes[0].alive === true, 'mask');
  assert(dec.self.item === ITEM.DRONE && dec.self.aimed, 'self item');
  assert(dec.self.hitKind === ITEM.SPARK && dec.self.hitBlock === true, 'hit text ' + dec.self.hitKind);
  assert(dec.cars[0].shield && dec.cars[0].item === ITEM.AEGIS, 'shield bit');
  assert(dec.battle.shots.length === 1 && Math.abs(dec.battle.shots[0].x - 12.4) < 0.08, 'shot pos');
  const env = { from: 'host', nonce: 'n', b: bytesToB64(on) };
  const relay = mqttPublish('skyroadster/v1/AB2CDE', JSON.stringify(env));
  const msg = unwrapRelay(env);
  assert(msg && msg.t === 'state' && msg.battle && msg.battle.shots[0].kind === ITEM.SPARK, 'relay shot');
  assert(relay.length > on.length, 'relay envelope');
  const grown = on.length - off.length;
  assert(grown > 0 && grown < 48, 'battle bytes ' + grown + ' off ' + off.length + ' on ' + on.length);
  const bits = unpackItemBits(packItemBits({ item: 6, shield: true, spinT: 0.4 }));
  assert(bits.item === 6 && bits.shield && bits.spin, JSON.stringify(bits));
  const lost = encodeInput({
    t: 'input', seq: 8, steer: 0.2, throttle: 1, brake: 0, lift: false, nitro: false, item: false, pitch: 0,
    hist: [{ seq: 7, steer: 0.2, throttle: 1, brake: 0, lift: false, nitro: false, item: true, pitch: 0 }],
  });
  const input = decodeInput(lost);
  const remote = { seq: 6, cmd: sync.zeroInput(), lastAt: 0 };
  sync.acceptInputs(remote, input, 1000);
  assert(remote.cmd.item === true, 'item press survived in the last commands ' + JSON.stringify(remote.cmd));
  const idle = (on.length - off.length) * 15;
  console.log('BAND', JSON.stringify({
    off: off.length, on: on.length, extra: grown,
    extraBps: idle,
    extraMb10Direct: +((idle * 600) / 1e6).toFixed(3),
  }));
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

try { testOdds(); ok('odds'); } catch (e) { bad('odds', e); }
try { testSpinKeepsGravity(); ok('spin keeps vertical speed'); } catch (e) { bad('spin keeps vertical speed', e); }
try { testBattle(); ok('pickup, gale, shield, seeker'); } catch (e) { bad('pickup, gale, shield, seeker', e); }
try { testWire(); ok('wire and relay'); } catch (e) { bad('wire and relay', e); }
if (fails.length) { console.error('FAILED', fails.join(', ')); process.exit(1); }
