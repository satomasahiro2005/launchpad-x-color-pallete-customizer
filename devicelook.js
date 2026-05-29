// Device-look: how raw palette RGB (0-63) actually looks on the Launchpad X's
// diffused LEDs. Built by photographing the full mat1jaczyyy palette on the
// device, sampling every pad's per-channel radial profile, and fitting ONE
// physical model to the photos by least-squares (no per-colour special cases):
//
//   per-channel amplitude A_c(raw)  ·  diffusion PSF K(d)  ·  SENSOR CLIP at 1
//   then white-balance (von-Kries, referenced to idx127 white) → sRGB
//
// The clip is what makes bright pads form a flat, often white, core (sharp),
// while dim/single-channel pads stay a smooth soft glow — all emergent.
// Fit RMS ≈ 8/255 vs the photos.
//
// Shared by the editor (app.js) and the "show palette" page (show.js).

export const DEVICE_BEZEL = "#161616"; // one uniform dark grey for frame + gaps

const GAMMA = 0.45, SIGMA = 0.9984, PEXP = 1.8312;
// Ambient seen where the LED is dark. Not forced neutral — tuned to the dim grey
// idx121 look (slightly warm), so an off/unlit pad reads like a faint grey pad.
const AMBN = [0.46, 0.196, 0.31];
const WB = [2.2293, 0.9243, 0.5518];           // von-Kries gains -> idx127 neutral
// A_c(raw) = per-channel LED amplitude for features [x,y,z,x²,y²,z²,xy,xz,yz,mn,mn²],
// x,y,z = (R,G,B)/63 ^GAMMA, mn = min(x,y,z). NO constant term, so raw(0,0,0) emits
// nothing → the off pad is just the neutral ambient (a neutral dark pad, not the
// WB-skewed orange). Uniform for all pads — no 0,0,0 special-case. A may exceed 1
// (it clips after the PSF, forming the bright core).
const ACOEF = {
  r: [0.4986, 0.2239, -0.0300, 0.7337, -0.4436, -0.1610, -0.4458, -0.5521, 0.3946, -0.0525, 0.0818],
  g: [0.2065, 0.3914, 0.1299, -0.2913, 0.4869, -0.3606, 0.0713, 0.2474, -0.0117, -0.3860, 0.1131],
  b: [-0.0855, 0.0108, 1.2644, 0.1002, 0.1234, -0.0901, 0.0836, 0.0020, -0.0019, 0.0822, -0.2169],
};

const lift = (v) => Math.pow(v / 63, GAMMA);
function features(r, g, b) {
  const x = lift(r), y = lift(g), z = lift(b), mn = Math.min(x, y, z);
  return [x, y, z, x * x, y * y, z * z, x * y, x * z, y * z, mn, mn * mn];
}
function amplitude(coef, f) {
  let v = 0;
  for (let i = 0; i < f.length; i++) v += f[i] * coef[i];
  return Math.max(0, Math.min(4, v));
}
const K = (d) => Math.exp(-Math.pow(d / SIGMA, PEXP)); // diffusion PSF, 1 at centre
const toSrgb = (c) => { c = Math.min(1, Math.max(0, c)); return (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255; };
const hex2 = (v) => Math.round(v).toString(16).padStart(2, "0");

// displayed sRGB at radius-fraction d (0 = centre, 1 = pad edge): white-balanced
// LED emission (clipped at the sensor) over an *achromatic* ambient floor that is
// gated to (1-maxLED)² — so it only shows where the LED is dark (an off/unlit pad
// reads as a neutral grey) and never washes lit pads. No flat global constant.
function pixel(f, d) {
  const k = K(d);
  const ledR = Math.min(1, amplitude(ACOEF.r, f) * k);
  const ledG = Math.min(1, amplitude(ACOEF.g, f) * k);
  const ledB = Math.min(1, amplitude(ACOEF.b, f) * k);
  const g = (1 - Math.max(ledR, ledG, ledB)) ** 2;
  return `#${hex2(toSrgb(ledR * WB[0] + AMBN[0] * g))}${hex2(toSrgb(ledG * WB[1] + AMBN[1] * g))}${hex2(toSrgb(ledB * WB[2] + AMBN[2] * g))}`;
}

// Solid centre colour (swatches/labels).
export function deviceColorHex(r, g, b) {
  return pixel(features(r, g, b), 0);
}

// Round LED glow as a CSS radial-gradient. Stops sample the model along the
// radius so the flat clipped core (sharp/white centre) and the soft falloff
// both render; the dark bezel between cells frames each pad.
export function deviceGlow([r, g, b]) {
  const f = features(r, g, b);
  const stops = [0, 0.15, 0.3, 0.45, 0.6, 0.78, 1].map(
    (d) => `${pixel(f, d)} ${Math.round(d * 100)}%`
  );
  return `radial-gradient(circle at 50% 50%, ${stops.join(", ")})`;
}
