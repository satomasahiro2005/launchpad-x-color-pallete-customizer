import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_BEZEL, deviceColorHex, deviceGlow } from "../devicelook.js";

const HEX = /^#[0-9a-f]{6}$/;
const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("DEVICE_BEZEL is a dark hex", () => {
  assert.match(DEVICE_BEZEL, HEX);
  const [r, g, b] = parse(DEVICE_BEZEL);
  assert.ok(r < 40 && g < 40 && b < 40);
});

test("deviceColorHex returns a valid #rrggbb for all 128 palette-ish inputs", () => {
  for (let r = 0; r <= 63; r += 9) for (let g = 0; g <= 63; g += 9) for (let b = 0; b <= 63; b += 9) {
    const hex = deviceColorHex(r, g, b);
    assert.match(hex, HEX, `${r},${g},${b} -> ${hex}`);
    assert.ok(parse(hex).every((v) => Number.isFinite(v) && v >= 0 && v <= 255));
  }
});

test("full white (63,63,63) is achromatic/neutral (channels within 12)", () => {
  const [r, g, b] = parse(deviceColorHex(63, 63, 63));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  assert.ok(max - min <= 12, `white not neutral: ${r},${g},${b}`);
  assert.ok(min > 150, "white should be bright");
});

test("off pad (0,0,0) is not black and not orange (a faint grey)", () => {
  const [r, g, b] = parse(deviceColorHex(0, 0, 0));
  assert.ok(Math.max(r, g, b) > 40, "off pad should be visible, not black");
  // not a strong orange: R must not dominate G+B hugely
  assert.ok(r <= g + b + 60, `off pad looks orange: ${r},${g},${b}`);
});

test("a bright single channel reads as that hue (red dominant for pure red)", () => {
  const [r, g, b] = parse(deviceColorHex(63, 0, 0));
  assert.ok(r > g && r > b, `pure red not red-dominant: ${r},${g},${b}`);
  const [gr, gg, gb] = parse(deviceColorHex(0, 63, 0));
  assert.ok(gg > gr && gg > gb, `pure green not green-dominant: ${gr},${gg},${gb}`);
  const [br, bg, bb] = parse(deviceColorHex(0, 0, 63));
  assert.ok(bb > br && bb > bg, `pure blue not blue-dominant: ${br},${bg},${bb}`);
});

test("raising a channel does not decrease that output channel (monotonic-ish red)", () => {
  let prev = -1;
  for (let r = 0; r <= 63; r += 7) {
    const red = parse(deviceColorHex(r, 0, 0))[0];
    assert.ok(red >= prev - 2, `red channel dropped at r=${r}`);
    prev = red;
  }
});

test("deviceGlow returns a radial-gradient with several colour stops", () => {
  const g = deviceGlow([0, 63, 63]);
  assert.match(g, /^radial-gradient\(circle/);
  const stops = g.match(/#[0-9a-f]{6}/g);
  assert.ok(stops && stops.length >= 4, "expected several gradient stops");
});

test("deviceGlow centre stop equals deviceColorHex (the centre colour)", () => {
  const raw = [31, 63, 0];
  const g = deviceGlow(raw);
  const firstHex = g.match(/#[0-9a-f]{6}/)[0];
  assert.equal(firstHex, deviceColorHex(...raw));
});

test("dim neutral (low equal RGB) is achromatic-ish and not dark-blue", () => {
  const [r, g, b] = parse(deviceColorHex(9, 9, 9));
  // should not be strongly blue (the old bug); reasonably balanced
  assert.ok(b <= Math.max(r, g) + 40, `dim grey too blue: ${r},${g},${b}`);
});
