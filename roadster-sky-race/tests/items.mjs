// 道具戰：擲骰、命中、打轉不削垂直速度、封包與中繼、使用鍵的補送。
import * as sync from '../js/sync.js';
import { mqttPublish } from '../js/relay.js';
import {
  encodeState, decodeState, createDict, encodeInput, decodeInput, bytesToB64, unwrapRelay,
} from '../js/wire.js';
import {
  ITEM, layoutBoxes, rollItem, itemWeights, ItemBattle, applyDriveFx, packItemBits, unpackItemBits, stepDrift,
} from '../js/items.js';
import { armStartBoost, takeStartBoost, armAiStart } from '../js/race.js';

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
  assert((dec.self.itemNext | 0) === 0, 'empty queue ' + dec.self.itemNext);
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
  const queued = encodeState(Object.assign({}, plain, {
    self: Object.assign({ item: ITEM.DRONE, itemNext: ITEM.AEGIS, aimed: true, hitKind: ITEM.SPARK, hitBlock: true }, plain.self),
    cars: [Object.assign({ item: ITEM.AEGIS, shield: true, itemNext: ITEM.STORM }, plain.cars[0])],
    battle: {
      on: true,
      boxes: [{ alive: true }, { alive: false }, { alive: true }],
      shots: [{ kind: ITEM.SPARK, x: 12.4, y: 1.5, z: -3, owner: 'P3', target: '' }],
    },
  }), {}, 0);
  assert(queued.length === on.length, 'queue adds no bytes ' + queued.length + ' vs ' + on.length);
  const decQ = decodeState(queued, createDict());
  assert(decQ.self.item === ITEM.DRONE && decQ.self.itemNext === ITEM.AEGIS, 'owner queue ' + decQ.self.itemNext);
  assert(decQ.self.hitKind === ITEM.SPARK && decQ.self.hitBlock === true, 'hit nibble still free');
  assert(decQ.cars[0].item === ITEM.AEGIS && decQ.cars[0].itemNext == null, 'others do not get a queue');
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

function testSlots() {
  const tr = track();
  const boxes = layoutBoxes(tr);
  const battle = new ItemBattle(tr, boxes, () => 0.1);
  const me = racer('P1', 0, 0, 10);
  const b0 = boxes[0];
  me.veh.pos.x = b0.x; me.veh.pos.y = b0.y; me.veh.pos.z = b0.z;
  battle.step(1 / 60, [me]);
  const first = me.veh.item | 0;
  assert(first >= 1 && !(me.veh.itemNext | 0), 'first slot ' + first + ' next ' + me.veh.itemNext);
  const b1 = boxes[1];
  me.veh.pos.x = b1.x; me.veh.pos.y = b1.y; me.veh.pos.z = b1.z;
  battle.step(1 / 60, [me]);
  const queued = me.veh.itemNext | 0;
  assert(me.veh.item === first && queued >= 1, 'second slot ' + queued);
  assert(battle.use(me), 'use older item');
  assert(me.veh.item === queued && !(me.veh.itemNext | 0), 'shift ' + me.veh.item);
  me.veh.item = ITEM.SPARK;
  me.veh.itemNext = ITEM.DRONE;
  me.veh.boostT = 0;
  me.veh.boostPower = 0;
  me.veh.coinPing = false;
  const b2 = boxes[2];
  me.veh.pos.x = b2.x; me.veh.pos.y = b2.y; me.veh.pos.z = b2.z;
  battle.step(1 / 60, [me]);
  assert(!b2.alive, 'full box still pops');
  assert(me.veh.item === ITEM.SPARK && me.veh.itemNext === ITEM.DRONE, 'full keeps both');
  assert(me.veh.boostT >= 0.42 && me.veh.boostPower === 14 && me.veh.coinPing, 'speed token');
  me.veh.boostT = 1.2;
  me.veh.boostPower = 30;
  const b3 = boxes[3];
  b3.alive = true;
  me.veh.pos.x = b3.x; me.veh.pos.y = b3.y; me.veh.pos.z = b3.z;
  battle.step(1 / 60, [me]);
  assert(me.veh.boostT === 1.2 && me.veh.boostPower === 30, 'token does not weaken a stronger boost');
}

function driftVeh() {
  return {
    grounded: true, attached: false, spinT: 0, driftT: 0, _driftHeld: false,
    vel: { x: 0, y: 0, z: -24 }, boostT: 0, boostPower: 0, driftBoost: 0,
  };
}

function testDrift() {
  const veh = driftVeh();
  for (let i = 0; i < 20; i++) stepDrift(veh, 1 / 60, 1, 1);
  stepDrift(veh, 1 / 60, 0, 0);
  assert(veh.boostT === 0 && !veh.driftBoost, 'short drift gives nothing ' + veh.driftT);
  const tier1 = driftVeh();
  for (let i = 0; i < 40; i++) stepDrift(tier1, 1 / 60, 0.8, 1);
  assert(tier1.driftT > 0.6 && tier1.boostT === 0, 'still charging ' + tier1.driftT);
  stepDrift(tier1, 1 / 60, 0, 0);
  assert(tier1.driftBoost === 1 && tier1.boostT >= 0.4 && tier1.boostPower === 22, 'tier 1 ' + tier1.boostT);
  const tier2 = driftVeh();
  for (let i = 0; i < 70; i++) stepDrift(tier2, 1 / 60, -1, 1);
  stepDrift(tier2, 1 / 60, 0, 0);
  assert(tier2.driftBoost === 2 && tier2.boostT >= 0.62 && tier2.boostPower === 30, 'tier 2');
  const held = driftVeh();
  held.boostT = 1.35;
  held.boostPower = 40;
  for (let i = 0; i < 70; i++) stepDrift(held, 1 / 60, 1, 1);
  stepDrift(held, 1 / 60, 0, 0);
  assert(held.boostT === 1.35 && held.boostPower === 40, 'keeps the stronger boost');
  const air = driftVeh();
  air.grounded = false;
  stepDrift(air, 0.8, 1, 1);
  assert(air.driftT === 0 && air.boostT === 0, 'air does not charge');
  const slow = driftVeh();
  slow.vel.z = -8;
  stepDrift(slow, 0.8, 1, 1);
  assert(slow.driftT === 0, 'too slow');
}

function freshStart(diff, name) {
  return { name: name || 'CPU 1', veh: { boostT: 0, boostPower: 0 }, driver: { kind: 'local', difficulty: diff || 'normal' } };
}

function testStart() {
  const early = freshStart();
  armStartBoost(early, 2.4, 0);
  armStartBoost(early, 2.1, 1);
  assert(early._startEarly && !early._startArm, 'early press');
  armStartBoost(early, 0.7, 0);
  armStartBoost(early, 0.7, 1);
  assert(!early._startArm, 'early press blocks the window');
  assert(takeStartBoost(early) === false, 'no boost');
  const held = freshStart();
  armStartBoost(held, 3.2, 1);
  armStartBoost(held, 0.7, 1);
  assert(!held._startArm, 'holding through the lights');
  assert(takeStartBoost(held) === false, 'hold gives nothing');
  const okR = freshStart();
  armStartBoost(okR, 1.5, 0);
  armStartBoost(okR, 0.7, 1);
  assert(okR._startArm && !okR._startEarly, 'window tap');
  assert(takeStartBoost(okR) === true, 'granted');
  assert(okR.veh.boostT >= 0.55 && okR.veh.boostPower === 28 && okR.veh.launchBoost, 'launch boost');
  assert(takeStartBoost(okR) === false, 'once');
  const late = freshStart();
  armStartBoost(late, 1.2, 0);
  armStartBoost(late, 0.2, 1);
  assert(!late._startArm, 'too late');
  const hard = freshStart('hard', 'CPU 2');
  armAiStart(hard, 0.68);
  assert(hard._startArm, 'hard always');
  const easy = freshStart('easy', 'CPU 2');
  armAiStart(easy, 0.68);
  assert(!easy._startArm, 'easy never');
  let armed = 0;
  for (let n = 1; n <= 8; n++) {
    const ai = freshStart('normal', 'CPU ' + n);
    for (let cd = 0.9; cd >= 0.5; cd -= 0.02) armAiStart(ai, cd);
    if (ai._startArm) armed++;
  }
  assert(armed > 0 && armed < 8, 'normal is mixed ' + armed);
}

try { testOdds(); ok('odds'); } catch (e) { bad('odds', e); }
try { testSpinKeepsGravity(); ok('spin keeps vertical speed'); } catch (e) { bad('spin keeps vertical speed', e); }
try { testBattle(); ok('pickup, gale, shield, seeker'); } catch (e) { bad('pickup, gale, shield, seeker', e); }
try { testSlots(); ok('two slots and full-hands token'); } catch (e) { bad('two slots and full-hands token', e); }
try { testDrift(); ok('drift boost'); } catch (e) { bad('drift boost', e); }
try { testStart(); ok('start boost'); } catch (e) { bad('start boost', e); }
try { testWire(); ok('wire and relay'); } catch (e) { bad('wire and relay', e); }
if (fails.length) { console.error('FAILED', fails.join(', ')); process.exit(1); }
