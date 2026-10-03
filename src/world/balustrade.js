/**
 * The stone balustrade: one modular system for every guard in the building.
 *
 * Every railing round the well and along the galleries is assembled from the
 * same handful of modules, set out by one rule, so that hundreds of them in a
 * row read as one piece of architecture rather than as props:
 *
 * - a stepped plinth (wide footing, recessed band, narrow ledge),
 * - faceted stone balusters, octagonal in plan, standing on the ledge,
 * - a layered upper rail (projecting moulding, recessed band, broad mass,
 *   chamfered handrail),
 * - square pillars at every turn of direction and at intervals along long
 *   runs, each with a plinth, a shaft, a capital and a platform on top,
 * - a lantern that can stand on any pillar's platform.
 *
 * A run is a straight line with stations along it. Pillars stand on stations,
 * balusters are spread evenly between the pillar faces, never closer to a
 * pillar than half a gap and never leaving a sliver at the end of a bay. Turns
 * of any angle (the hexagon's 120°, the 90° at the end of a gallery) are made
 * by ending two runs on the same station and standing a pillar there, which
 * covers the joint.
 *
 * The output is plain data, as in well.js and columns.js: box parts for the
 * plinth, rail, pillars and lantern fittings, which merge into the room's and
 * the shaft's existing batches at no extra draw call, and a list of baluster
 * placements, which the room draws as one instanced mesh. Every box carries a
 * `keep` level so the shaft can shed detail with distance:
 *   0  the walker's own chamber only,
 *   1  also the nearer storeys of the shaft,
 *   2  everywhere, down to the last storey in the fog.
 *
 * The stone is the walls' own material, darkened through vertex colour, so it
 * costs no material and no draw call of its own. Recesses are darker than the
 * faces that stand forward, the foot of everything is darker still where dirt
 * collects, and each run is a shade apart from the next, the way blocks from
 * different beds of one quarry are. The warmth comes from the lanterns, never
 * from the stone.
 */

import * as THREE from 'three';

// --- the profile ----------------------------------------------------------------
// One metre and a little more, as the guard always was, but heavier in every
// member than a real balustrade would be.

/** Total height of a run, to the top of the handrail. */
export const BALUSTRADE_HEIGHT = 1.09;
/** The widest member of a run, front to back: the footing. */
export const BALUSTRADE_DEPTH = 0.38;
/** Width of a pillar's shaft: a little wider than any band of a run, so no
 * face of a run lies in the plane of a pillar's face it passes through. */
export const PILLAR_WIDTH = 0.36;
/** Centre to centre of two balusters, before a bay evens it out. */
export const BALUSTER_PITCH = 0.26;
const BALUSTER_FOOT = 0.19;
const BALUSTER_TOP = 0.8;
const BALUSTER_HEIGHT = BALUSTER_TOP - BALUSTER_FOOT;

// [depth, bottom, top, tone, keep]. Tone is how much light a face of that band
// gives back: the bands that stand forward catch it, the recessed ones are in
// their own shadow.
const PLINTH_BANDS = [
  [0.38, 0, 0.08, 0.6, 2],
  [0.3, 0.08, 0.15, 0.42, 1],
  [0.34, 0.15, BALUSTER_FOOT, 0.66, 1],
];
const RAIL_BANDS = [
  // The projecting moulding under the rail.
  [0.32, BALUSTER_TOP, 0.84, 0.62, 1],
  // A recessed band, in shadow under the mass.
  [0.24, 0.84, 0.89, 0.4, 0],
  // The broad stone mass.
  [0.34, 0.89, 1.0, 0.7, 2],
  // The handrail, and the chamfer that rounds its top over.
  [0.3, 1.0, 1.07, 0.78, 1],
  [0.22, 1.07, BALUSTRADE_HEIGHT, 0.84, 0],
];
// [width, bottom, top, tone, keep]
const PILLAR_BANDS = [
  [0.46, 0, 0.12, 0.58, 1],
  [0.4, 0.12, 0.2, 0.5, 0],
  [PILLAR_WIDTH, 0.2, 1.12, 0.66, 2],
  [0.42, 1.12, 1.19, 0.74, 1],
  [0.38, 1.19, 1.25, 0.8, 0],
];
/** Top of a pillar's platform, where a lantern stands. */
export const PILLAR_HEIGHT = 1.25;
// The distant shaft keeps one box for a whole pillar, from floor to platform.
const DISTANT_PILLAR = [PILLAR_WIDTH, 0, PILLAR_HEIGHT, 0.66, 2];

// The lantern: a dark iron foot, a glowing globe and a small cap. The globe's
// centre stands this far above the platform.
export const LANTERN_GLOBE_RISE = 0.22;
export const LANTERN_GLOBE_SIZE = 0.22;

// --- the stone's tone ---------------------------------------------------------------

/** A repeatable -1..1 from an integer, for module-to-module variation. */
function hashSigned(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * The vertex shade for a stone part of `tone`: dirt collects at the foot of
 * everything, so the lowest fifteen centimetres of a run or a pillar are
 * darker, fading out by forty. `floor` is the height of the floor the run
 * stands on, in the same space as the vertex.
 */
export function stoneShade(tone, floor = 0) {
  return vertex => {
    const rise = Math.min(1, Math.max(0, (vertex.y - floor) / 0.4));
    return tone * (0.72 + 0.28 * rise);
  };
}

// --- one run ------------------------------------------------------------------------

/** A new, empty set of balustrade output. */
export function balustradeSet() {
  return { parts: [], balusters: [] };
}

function bandPart(out, centre, rotation, length, band, floor, variation, role) {
  const [depth, bottom, top, tone, keep] = band;
  out.parts.push({
    size: [length, top - bottom, depth],
    position: new THREE.Vector3(centre.x, floor + (bottom + top) / 2, centre.z),
    rotation,
    kind: 'stone',
    tone: tone * variation,
    floor,
    keep,
    role,
  });
}

/**
 * A pillar standing at `x/z` on a floor at `floor`, turned by `rotation`, with
 * or without a lantern on its platform.
 */
export function addPillar(out, x, z, floor, rotation, { lantern = false, seed = 0 } = {}) {
  const variation = 1 + 0.05 * hashSigned(seed);
  for (const band of PILLAR_BANDS) {
    const [width, bottom, top, tone, keep] = band;
    out.parts.push({
      size: [width, top - bottom, width],
      position: new THREE.Vector3(x, floor + (bottom + top) / 2, z),
      rotation,
      kind: 'stone',
      tone: tone * variation,
      floor,
      keep,
      // Only the room keeps the moulded pillar; the shaft swaps it whole.
      role: 'pillar',
      lantern,
    });
  }
  // The shaft's own pillar, one box, for the storeys where the moulding is
  // under a pixel. Marked so the room never builds it.
  const [width, bottom, top, tone] = DISTANT_PILLAR;
  out.parts.push({
    size: [width, top - bottom, width],
    position: new THREE.Vector3(x, floor + (bottom + top) / 2, z),
    rotation,
    kind: 'stone',
    tone: tone * variation,
    floor,
    keep: 2,
    distantOnly: true,
    role: 'pillar',
    lantern,
  });
  if (lantern) addLantern(out, x, z, floor + PILLAR_HEIGHT, rotation);
}

/** A lantern standing on a platform whose top is at `y`. */
export function addLantern(out, x, z, y, rotation) {
  const at = height => new THREE.Vector3(x, y + height, z);
  // An iron foot and a short neck.
  out.parts.push({ size: [0.17, 0.05, 0.17], position: at(0.025), rotation, kind: 'metal', keep: 0 });
  out.parts.push({ size: [0.06, 0.07, 0.06], position: at(0.085), rotation, kind: 'metal', keep: 0 });
  // The globe. The room gives it a round body; the shaft a box of the same size.
  out.parts.push({
    size: [LANTERN_GLOBE_SIZE, LANTERN_GLOBE_SIZE, LANTERN_GLOBE_SIZE],
    position: at(LANTERN_GLOBE_RISE),
    rotation,
    kind: 'lamp',
    keep: 2,
  });
  // The cap and its finial.
  out.parts.push({ size: [0.14, 0.04, 0.14], position: at(0.35), rotation, kind: 'metal', keep: 1 });
  out.parts.push({ size: [0.035, 0.07, 0.035], position: at(0.405), rotation, kind: 'metal', keep: 0 });
}

/**
 * A straight run of balustrade.
 *
 * The run's centre line starts at `origin` and heads along `angle` (radians,
 * in the x/z plane); `from` and `to` are distances along that line. `stations`
 * are the distances at which a pillar stands, each `{ t, build, lantern }`:
 * `build: false` reserves the place without building a pillar, for a pillar
 * another run (or a corner) supplies. A run's ends that are not stations stop
 * flat against whatever they meet: a wall, the end of a gap, or a pier the run
 * is buried in. `balusterFrom` and `balusterTo` keep the balusters to a
 * shorter stretch than the run itself, for a run whose ends are buried.
 */
export function addRun(out, {
  origin,
  angle,
  floor = 0,
  from,
  to,
  stations = [],
  seed = 0,
  balusterFrom = from,
  balusterTo = to,
}) {
  const length = to - from;
  if (length <= 0) return;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const rotation = -angle;
  const point = t => new THREE.Vector3(origin.x + dx * t, 0, origin.z + dz * t);
  const variation = 1 + 0.06 * hashSigned(seed);
  const middle = point((from + to) / 2);
  for (const band of PLINTH_BANDS) bandPart(out, middle, rotation, length, band, floor, variation, 'plinth');
  for (const band of RAIL_BANDS) bandPart(out, middle, rotation, length, band, floor, variation, 'rail');

  const pillars = [...stations].sort((a, b) => a.t - b.t);
  pillars.forEach((station, index) => {
    if (!station.build) return;
    const at = point(station.t);
    addPillar(out, at.x, at.z, floor, rotation, { lantern: station.lantern, seed: seed * 31 + index });
  });

  // The bays between pillar faces, or between a pillar and a flat end.
  const lo = Math.max(from, balusterFrom);
  const hi = Math.min(to, balusterTo);
  const marks = [
    { t: lo, pillar: pillars.some(station => Math.abs(station.t - lo) < 1e-6) },
    ...pillars.filter(station => station.t > lo + 1e-6 && station.t < hi - 1e-6)
      .map(station => ({ t: station.t, pillar: true })),
    { t: hi, pillar: pillars.some(station => Math.abs(station.t - hi) < 1e-6) },
  ];
  for (let index = 1; index < marks.length; index++) {
    const start = marks[index - 1].t + (marks[index - 1].pillar ? PILLAR_WIDTH / 2 : 0);
    const end = marks[index].t - (marks[index].pillar ? PILLAR_WIDTH / 2 : 0);
    const clear = end - start;
    if (clear < BALUSTER_PITCH * 0.75) continue;
    // Evenly through the bay: the pitch gives way a little rather than leave
    // a narrow gap at one end.
    const count = Math.max(1, Math.round(clear / BALUSTER_PITCH));
    const spacing = clear / count;
    for (let baluster = 0; baluster < count; baluster++) {
      const at = point(start + (baluster + 0.5) * spacing);
      out.balusters.push({
        x: at.x,
        y: floor + BALUSTER_FOOT,
        z: at.z,
        rotation,
        // Each stone a shade apart from its neighbours.
        tone: variation * (1 + 0.07 * hashSigned(seed * 977 + index * 131 + baluster)),
      });
    }
  }
}

// --- the baluster -----------------------------------------------------------------
// [radius, height]: a square-cut foot, a narrow neck, the swelling body, a
// waist, and a block at the top to take the rail. Octagonal throughout, each
// facet flat, so the carved stone catches a lantern face by face.
// Seven bands of eight facets, 224 vertices: three thousand of them in a
// chamber are still most of a million vertices a draw, so every band has to
// earn its place in the silhouette.
const BALUSTER_PROFILE = [
  [0.064, 0],
  [0.064, 0.05],
  [0.04, 0.11],
  [0.06, 0.24],
  [0.035, 0.46],
  [0.052, 0.52],
  [0.058, 0.55],
  [0.058, BALUSTER_HEIGHT],
];
// The shaft's baluster: the same height and width, four facets and three
// bands, which is all a few pixels can show.
const DISTANT_BALUSTER_PROFILE = [
  [0.056, 0],
  [0.036, 0.12],
  [0.056, 0.26],
  [0.034, 0.48],
  [0.054, BALUSTER_HEIGHT],
];

/**
 * A faceted lathe: every facet its own four vertices and normal, indexed,
 * with a vertex colour that darkens toward the foot.
 */
function facetedLathe(profile, sides, turn) {
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const corner = (radius, side) => {
    const angle = turn + side / sides * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  };
  const shade = y => 0.62 + 0.38 * Math.min(1, y / 0.3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let band = 1; band < profile.length; band++) {
    const [r0, y0] = profile[band - 1];
    const [r1, y1] = profile[band];
    for (let side = 0; side < sides; side++) {
      const [x00, z00] = corner(r0, side);
      const [x01, z01] = corner(r0, side + 1);
      const [x10, z10] = corner(r1, side);
      const [x11, z11] = corner(r1, side + 1);
      const quad = [[x00, y0, z00], [x01, y0, z01], [x11, y1, z11], [x10, y1, z10]];
      a.fromArray(quad[0]);
      b.fromArray(quad[1]);
      c.fromArray(quad[3]);
      normal.crossVectors(c.sub(a), b.sub(a)).normalize();
      const base = positions.length / 3;
      for (const vertex of quad) {
        positions.push(...vertex);
        normals.push(normal.x, normal.y, normal.z);
        const tone = shade(vertex[1]);
        colors.push(tone, tone, tone);
        uvs.push(side / sides, vertex[1] / BALUSTER_HEIGHT);
      }
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The baluster the walker's own chamber draws: eight facets. */
export const balusterGeometry = facetedLathe(BALUSTER_PROFILE, 8, Math.PI / 8);
/** The baluster the shaft draws: four facets, square to the run. */
export const distantBalusterGeometry = facetedLathe(DISTANT_BALUSTER_PROFILE, 4, Math.PI / 4);

const instanceMatrix = new THREE.Matrix4();
const instanceColor = new THREE.Color();

/**
 * One instanced mesh for a list of balusters, offset by `offsetY` each, and
 * all in the walls' stone. Pass several lists to draw them in one call.
 */
export function instancedBalusters(geometry, material, lists) {
  const total = lists.reduce((sum, { balusters }) => sum + balusters.length, 0);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, total));
  let index = 0;
  for (const { balusters, offsetY = 0 } of lists) {
    for (const baluster of balusters) {
      instanceMatrix.makeRotationY(baluster.rotation).setPosition(baluster.x, baluster.y + offsetY, baluster.z);
      mesh.setMatrixAt(index, instanceMatrix);
      mesh.setColorAt(index, instanceColor.setScalar(baluster.tone * 0.68));
      index++;
    }
  }
  mesh.count = total;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.raycast = () => {};
  mesh.userData.balusters = total;
  return mesh;
}
