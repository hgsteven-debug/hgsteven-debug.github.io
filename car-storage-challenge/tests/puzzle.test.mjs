import assert from "node:assert/strict";
import test from "node:test";
import { LEVELS, ITEMS } from "../js/levels.js";
import { STRINGS, LOCALES } from "../js/i18n.js";
import {
  anchorFromHover,
  bounds,
  canPlace,
  cellKey,
  hoverFromAnchor,
  isTidy,
  playableCount,
  rotateShape,
  sameShape,
} from "../js/puzzle.js";
import { playable } from "../js/layout.js";
import { capacity, demand, solveLevel } from "./solve.mjs";
import { readFileSync } from "node:fs";

test("rotation turns a wide piece tall", () => {
  const once = rotateShape(ITEMS.phone.shape);
  assert.deepEqual(bounds(once), { w: 1, h: 2 });
  assert.equal(sameShape(rotateShape(rotateShape(rotateShape(rotateShape(ITEMS.bottle.shape)))), ITEMS.bottle.shape), true);
});

test("hover and anchor are inverses", () => {
  const shape = ITEMS.cable.shape;
  const anchor = { col: 1, row: 2 };
  const hover = hoverFromAnchor(shape, anchor.col, anchor.row);
  assert.deepEqual(anchorFromHover(shape, hover.col, hover.row), anchor);
});

test("overlap and blocked cells are rejected", () => {
  const comp = LEVELS[2].compartments.find((item) => item.id === "armrest");
  const occupied = new Set([cellKey("armrest", 0, 0)]);
  assert.equal(canPlace(comp, ITEMS.coins.shape, 0, 0, occupied), false);
  assert.equal(canPlace(comp, ITEMS.coins.shape, 1, 1, new Set()), false);
  assert.equal(playable(comp, 1, 1), false);
});

test("tidy touch and a floating piece", () => {
  const comp = LEVELS[0].compartments.find((item) => item.id === "armrest");
  assert.equal(isTidy(comp, ITEMS.coins.shape, 0, 0, new Set()), true);
  assert.equal(isTidy(comp, ITEMS.coins.shape, 1, 1, new Set()), false);
});

test("levels fit inside their grids and do not overlap", () => {
  for (const level of LEVELS) {
    assert.ok(demand(level) <= capacity(level), `level ${level.id} demand`);
    const boxes = level.compartments.map((comp) => {
      const size = comp.cell || 1;
      return {
        id: comp.id,
        x0: comp.ox,
        x1: comp.ox + comp.cols * size,
        z0: comp.oz,
        z1: comp.oz + comp.rows * size,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit = a.x0 < b.x1 - 0.02 && b.x0 < a.x1 - 0.02 && a.z0 < b.z1 - 0.02 && b.z0 < a.z1 - 0.02;
        assert.equal(hit, false, `${level.id} ${a.id} overlaps ${b.id}`);
      }
    }
    for (const comp of level.compartments) {
      if (!comp.mask) continue;
      assert.equal(comp.mask.length, comp.rows);
      for (const row of comp.mask) assert.equal(row.length, comp.cols);
    }
  }
});

test("every level has a packing", () => {
  for (const level of LEVELS) {
    const result = solveLevel(level);
    assert.equal(result.ok, true, `level ${level.id} unsolved after ${result.nodes} nodes`);
    assert.equal(result.placement.length, level.spawns.length);
  }
});

test("strings stay in one table and the demo code is labelled", () => {
  assert.deepEqual(LOCALES, ["zh-Hant", "en", "fr", "ja", "ko"]);
  assert.equal(STRINGS["zh-Hant"]["promo.code"], "JOWUA-DEMO");
  assert.equal(STRINGS["zh-Hant"]["promo.label"], "示範用、非正式優惠");
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const game = readFileSync(new URL("../js/game.js", import.meta.url), "utf8");
  assert.equal(ui.includes("JOWUA-DEMO"), false);
  assert.equal(game.includes("JOWUA-DEMO"), false);
  assert.ok(playableCount(LEVELS[0].compartments[0]) > 0);
});
