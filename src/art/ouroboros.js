// The ouroboros with Sisyphus inside its ring, drawn on a 2D canvas.
//
// The snake is always swallowing itself, so its scales flow from the neck
// round to the tail and into the mouth. Sisyphus pushes his stone up the inside
// of the ring against that flow: every step he takes the snake carries back,
// and he never gets anywhere. The drawing is a pure function of time, so one
// canvas can feed as many surfaces as want it (see world/relief.js).

// Colours come from the caller; the default is ink on the panel's paper. A
// caller may add `ground` to fill the square behind the drawing.
export const PAPER_PALETTE = Object.freeze({
  ink: '#1f1d1a',
  farInk: '#57514a',
  paper: '#f4f2ec',
  skin: '#e7e2d6',
});
let palette = PAPER_PALETTE;

// Everything is laid out on a 240-unit square, scaled to the canvas.
export const SIZE = 240;
const C = SIZE / 2;
const R = 88; // centreline of the snake's body
const W = 20; // body width at its thickest
const R_IN = R - W / 2; // the inner edge Sisyphus walks on

const DEG = Math.PI / 180;
// Screen angles: 0 is east, and they grow clockwise because y points down.
// The neck sits just left of the top; the body runs anticlockwise round the
// ring and the tail ends inside the mouth, just left of the top again.
const NECK = 254 * DEG;
const SPAN = 346 * DEG;
const HINGE = 270 * DEG; // the corner of the jaw, at the top of the ring

// One walking step of Sisyphus and one step of the scales are the same
// distance: his standing foot moves backwards exactly as fast as the snake
// under it, which is what makes the walk read as a treadmill and not a skate.
const FIGURE_SCALE = 1.75;
const STRIDE = 11; // figure units
const STEP_PERIOD = 1.8; // seconds for a full two-foot cycle
const GROUND_SPEED = (FIGURE_SCALE * STRIDE) / (STEP_PERIOD / 2); // at R_IN
const OMEGA = GROUND_SPEED / R_IN; // radians per second of the whole ring

const SCALE_STEP = 8; // along the centreline
const BODY_LENGTH = SPAN * R;

const FIGURE_AT = 104 * DEG;
const STONE_AHEAD = 40 * DEG;
const STONE_R = 22;

const widthAt = u => (u < 0.72 ? W : W * (1 - 0.68 * ((u - 0.72) / 0.28)));
const angleAt = u => NECK - u * SPAN;
const polar = (angle, radius) => [C + Math.cos(angle) * radius, C + Math.sin(angle) * radius];

// A deterministic stone, so it looks the same every time the page opens.
const stone = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const dots = [];
  for (let i = 0; i < 90; i++) {
    const r = Math.sqrt(random()) * 0.92;
    dots.push([random() * Math.PI * 2, r, 0.35 + random() * 0.6]);
  }
  const cracks = [];
  for (let i = 0; i < 6; i++) {
    let a = random() * Math.PI * 2;
    let r = 0.15 + random() * 0.5;
    const line = [];
    for (let j = 0; j < 5; j++) {
      line.push([a, Math.min(r, 0.97)]);
      a += (random() - 0.5) * 0.7;
      r += 0.1 + random() * 0.14;
    }
    cracks.push(line);
  }
  return { dots, cracks };
})();

function drawRing(ctx) {
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = palette.ink;
  ctx.beginPath();
  ctx.arc(C, C, R + W / 2 + 6, 0, Math.PI * 2);
  ctx.stroke();
}

// Head coordinates are bent along the ring: x runs along it (positive towards
// the tail it is eating), y runs outwards (negative) or inwards (positive).
const HEAD_SCALE = 1.3;
const bent = (x, y) => polar(HINGE + (x * HEAD_SCALE) / R, R - y * HEAD_SCALE);

// A closed outline through bent points; `smooth` rounds it through the
// midpoints so the head reads as flesh rather than a polygon.
function bentPath(ctx, points, smooth = false) {
  const at = points.map(([x, y]) => bent(x, y));
  ctx.beginPath();
  if (!smooth) {
    at.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  } else {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.moveTo(...mid(at[at.length - 1], at[0]));
    at.forEach((point, i) => ctx.quadraticCurveTo(...point, ...mid(point, at[(i + 1) % at.length])));
  }
  ctx.closePath();
}

function drawMouth(ctx) {
  bentPath(ctx, [[-8, 0], [2, -4.6], [15, -4.6], [14, 5.2], [6, 5], [-4, 4]]);
  ctx.fillStyle = palette.ink;
  ctx.fill();
}

function drawBody(ctx, time) {
  const flow = (time * OMEGA * R) % SCALE_STEP;
  const steps = 64;

  // The body's silhouette.
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const [x, y] = polar(angleAt(u), R + widthAt(u) / 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const u = i / steps;
    const [x, y] = polar(angleAt(u), R - widthAt(u) / 2);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = palette.paper;
  ctx.fill();
  ctx.save();
  ctx.clip();

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 0.65;
  for (let s = flow - SCALE_STEP; s < BODY_LENGTH + SCALE_STEP; s += SCALE_STEP) {
    const u = s / BODY_LENGTH;
    if (u < -0.02 || u > 1.02) continue;
    const w = widthAt(Math.min(Math.max(u, 0), 1));
    const a = angleAt(u);
    const half = SCALE_STEP / 2 / R;

    // Belly scutes on the inner band: the floor Sisyphus walks on.
    const inner = R - w / 2;
    const scuteTop = R - w * 0.1;
    const s0 = a - half * 0.78;
    const s1 = a + half * 0.78;
    ctx.beginPath();
    ctx.moveTo(...polar(s0, inner + 0.6));
    ctx.lineTo(...polar(s0, scuteTop));
    ctx.lineTo(...polar(s1, scuteTop));
    ctx.lineTo(...polar(s1, inner + 0.6));
    ctx.fillStyle = palette.skin;
    ctx.fill();
    ctx.stroke();

    // Two staggered rows of diamond scales on the back.
    for (const [row, shift] of [[0.12, 0], [0.36, 0.5]]) {
      const ac = a - shift * half * 2;
      const rc = R + w * row;
      const h = w * 0.13;
      ctx.beginPath();
      ctx.moveTo(...polar(ac - half, rc));
      ctx.lineTo(...polar(ac, rc + h));
      ctx.lineTo(...polar(ac + half, rc));
      ctx.lineTo(...polar(ac, rc - h));
      ctx.closePath();
      ctx.stroke();
      // A short engraved stroke in each scale, for the shine on it.
      ctx.beginPath();
      ctx.moveTo(...polar(ac - half * 0.35, rc - h * 0.2));
      ctx.lineTo(...polar(ac + half * 0.1, rc - h * 0.45));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Edges drawn last so the scales never nibble them.
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = palette.ink;
  for (const side of [1, -1]) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const [x, y] = polar(angleAt(u), R + (side * widthAt(u)) / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawHead(ctx) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.ink;

  // Lower jaw, under the tail.
  bentPath(ctx, [[-24, 10], [-12, 11.5], [4, 11.5], [12, 8.5], [14, 5.2], [6, 4.4], [-4, 3.6], [-10, 1.5], [-22, -1], [-30, 2]], true);
  ctx.fillStyle = palette.paper;
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Skull and upper jaw, over it.
  bentPath(ctx, [[-30, -9], [-18, -14.5], [-6, -15.5], [6, -12.5], [14, -9.5], [18, -6.5], [15, -4.2], [4, -4.4], [-6, -1], [-18, 3], [-30, 6]], true);
  ctx.fill();
  ctx.stroke();

  const line = points => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(...bent(x, y)) : ctx.lineTo(...bent(x, y))));
    ctx.stroke();
  };

  // Fangs biting into the tail.
  ctx.fillStyle = palette.paper;
  ctx.lineWidth = 0.8;
  for (const fang of [[[9, -4.4], [11, 1.8], [12.2, -4.3]], [[3, -4.4], [4, -1.2], [5, -4.4]], [[7, 4.8], [8, 1.6], [9, 4.7]]]) {
    bentPath(ctx, fang);
    ctx.fill();
    ctx.stroke();
  }

  // Brow, lip line, head plates and jaw scales.
  ctx.lineWidth = 0.7;
  line([[-15, -13.4], [-4, -13.2], [7, -10.6]]);
  line([[-20, -9.5], [-12, -10.8]]);
  line([[-18, -6], [-12, -6.5]]);
  line([[-4, -6.2], [10, -6.4], [15, -5.2]]);
  line([[-20, 7.5], [-6, 8.8], [6, 8.6], [11, 7]]);
  for (let x = -20; x < 4; x += 4) line([[x, 6.2], [x + 2, 9.6]]);
  // Nostril.
  ctx.beginPath();
  ctx.arc(...bent(15, -7.5), 0.8, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();

  // Eye: dark, with a pinpoint of paper.
  const [ex, ey] = bent(-7, -9.5);
  ctx.beginPath();
  ctx.ellipse(ex, ey, 3, 2.3, HINGE + Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex - 0.8, ey - 0.8, 0.65, 0, Math.PI * 2);
  ctx.fillStyle = palette.paper;
  ctx.fill();
}

// Two-bone IK: where the middle joint sits for a limb from `a` reaching `b`.
// `bend` picks which side the joint folds to.
function joint(a, b, l1, l2, bend) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  return [a[0] + ux * along - uy * out * bend, a[1] + uy * along + ux * out * bend];
}

function limb(ctx, a, b, c, width, colour) {
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.lineTo(...c);
  ctx.stroke();
}

// The foot's place in figure units, for a phase in [0, 1): half the cycle on
// the ground drifting back with the snake, half in the air coming forward.
function foot(phase) {
  const front = -1;
  if (phase < 0.5) return [front + STRIDE * (phase / 0.5), 0];
  const p = (phase - 0.5) / 0.5;
  return [front + STRIDE * (1 - p), -3.2 * Math.sin(Math.PI * p)];
}

function drawStoneAndFigure(ctx, time) {
  // The whole effort surges a little: a gain up the slope, then lost again.
  const surge = Math.sin(time * 0.9) * 1.4 * DEG;
  const at = FIGURE_AT + surge;
  const stoneAngle = at + STONE_AHEAD;
  const [sx, sy] = polar(stoneAngle, R_IN - STONE_R);

  // The stone rolls in place on the moving floor, turning uphill.
  const roll = -(GROUND_SPEED * time) / STONE_R - (surge * R_IN) / STONE_R;
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, STONE_R, 0, Math.PI * 2);
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.clip();
  ctx.translate(sx, sy);
  ctx.rotate(roll);
  ctx.fillStyle = palette.ink;
  for (const [a, r, size] of stone.dots) {
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * STONE_R, Math.sin(a) * r * STONE_R, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 0.7;
  for (const crack of stone.cracks) {
    ctx.beginPath();
    crack.forEach(([a, r], i) => {
      const x = Math.cos(a) * r * STONE_R;
      const y = Math.sin(a) * r * STONE_R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.rotate(-roll);
  // Shade, fixed to the light rather than the stone: hatching on the side
  // away from the centre of the ring.
  const toward = Math.atan2(C - sy, C - sx);
  ctx.rotate(toward + Math.PI / 2);
  ctx.lineWidth = 0.55;
  for (let y = 2; y < STONE_R; y += 1.6) {
    const reach = Math.sqrt(STONE_R * STONE_R - y * y);
    ctx.beginPath();
    ctx.moveTo(-reach, y);
    ctx.lineTo(reach, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(sx, sy, STONE_R, 0, Math.PI * 2);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = palette.ink;
  ctx.stroke();

  // Sisyphus, in his own frame: feet on the inner edge at the origin, up
  // towards the centre of the ring, uphill to the left.
  const [fx, fy] = polar(at, R_IN);
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(at - Math.PI / 2);
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);

  const toLocal = ([x, y]) => {
    const dx = x - fx;
    const dy = y - fy;
    const turn = -(at - Math.PI / 2);
    return [
      (dx * Math.cos(turn) - dy * Math.sin(turn)) / FIGURE_SCALE,
      (dx * Math.sin(turn) + dy * Math.cos(turn)) / FIGURE_SCALE,
    ];
  };

  const phase = (time / STEP_PERIOD) % 1;
  const strain = Math.sin(phase * Math.PI * 4);
  const hip = [6 + strain * 0.25, -14 + strain * 0.35];
  const shoulder = [hip[0] - 8.5, hip[1] - 7 + strain * 0.2];
  const head = [shoulder[0] - 2.7, shoulder[1] - 2.1];

  // Hands on the stone, a little either side of the line to its centre.
  const stoneLocal = toLocal([sx, sy]);
  const stoneRadius = STONE_R / FIGURE_SCALE;
  const reachTo = offset => {
    const a = Math.atan2(shoulder[1] - stoneLocal[1], shoulder[0] - stoneLocal[0]) + offset;
    return [stoneLocal[0] + Math.cos(a) * stoneRadius, stoneLocal[1] + Math.sin(a) * stoneRadius];
  };

  const THIGH = 8.2;
  const SHIN = 8.2;
  const UPPER_ARM = 5.4;
  const FOREARM = 5.2;
  const farFoot = foot((phase + 0.5) % 1);
  const nearFoot = foot(phase);
  const farHand = reachTo(-0.22);
  const nearHand = reachTo(0.12);

  // Far side first, in a paler ink, so the body reads in depth.
  limb(ctx, shoulder, joint(shoulder, farHand, UPPER_ARM, FOREARM, -1), farHand, 1.9, palette.farInk);
  limb(ctx, hip, joint(hip, farFoot, THIGH, SHIN, 1), farFoot, 2.5, palette.farInk);
  ctx.beginPath();
  ctx.moveTo(farFoot[0] - 0.4, farFoot[1] - 0.2);
  ctx.lineTo(farFoot[0] - 2.4, farFoot[1] - 0.2);
  ctx.stroke();

  // Torso: a tapered wedge from the hips to the shoulders.
  const along = [shoulder[0] - hip[0], shoulder[1] - hip[1]];
  const len = Math.hypot(...along);
  const n = [-along[1] / len, along[0] / len];
  ctx.beginPath();
  ctx.moveTo(hip[0] + n[0] * 1.8, hip[1] + n[1] * 1.8);
  ctx.lineTo(shoulder[0] + n[0] * 2.4, shoulder[1] + n[1] * 2.4);
  ctx.lineTo(shoulder[0] - n[0] * 2.2, shoulder[1] - n[1] * 2.2);
  ctx.lineTo(hip[0] - n[0] * 1.6, hip[1] - n[1] * 1.6);
  ctx.closePath();
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = palette.ink;
  ctx.stroke();

  // Loincloth.
  ctx.beginPath();
  ctx.moveTo(hip[0] + n[0] * 2.4 - 0.6, hip[1] + n[1] * 2.4 - 1.2);
  ctx.lineTo(hip[0] - n[0] * 2.2 - 0.6, hip[1] - n[1] * 2.2 - 1.2);
  ctx.lineTo(hip[0] - n[0] * 1.2 + 1.6, hip[1] - n[1] * 1.2 + 2.6);
  ctx.lineTo(hip[0] + n[0] * 1.6 + 0.6, hip[1] + n[1] * 1.6 + 2.2);
  ctx.closePath();
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Head, bowed into the stone.
  ctx.beginPath();
  ctx.moveTo(shoulder[0] - 0.4, shoulder[1] - 0.4);
  ctx.lineTo(head[0], head[1]);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(head[0], head[1], 2.3, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();

  // Near side over everything.
  limb(ctx, hip, joint(hip, nearFoot, THIGH, SHIN, 1), nearFoot, 2.8, palette.ink);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(nearFoot[0] - 0.4, nearFoot[1] - 0.2);
  ctx.lineTo(nearFoot[0] - 2.5, nearFoot[1] - 0.2);
  ctx.stroke();
  limb(ctx, shoulder, joint(shoulder, nearHand, UPPER_ARM, FOREARM, -1), nearHand, 2.1, palette.ink);

  ctx.restore();
}

/**
 * Draws the emblem at `time` seconds onto a context already scaled so that the
 * drawing's 240-unit square fills the area wanted.
 */
export function drawOuroboros(ctx, time, colours = PAPER_PALETTE) {
  palette = colours;
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (colours.ground) {
    ctx.fillStyle = colours.ground;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  drawRing(ctx);
  drawMouth(ctx);
  drawBody(ctx, time);
  drawHead(ctx);
  drawStoneAndFigure(ctx, time);
}
