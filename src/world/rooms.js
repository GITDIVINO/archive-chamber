/**
 * Which chamber currently exists in the scene.
 *
 * The world is unbounded in the plane and in height, but only the player's own hex is
 * ever built: entering a new room disposes the previous one. This is a renderer
 * limit, not a model one.
 */

import * as THREE from 'three';
import { freeWallsForLevel } from '../../world-engine.js';
import { catalogueCoordinates, exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';
import {
  CHAMBER_STEP,
  DOOR_HEIGHT,
  EYE_HEIGHT,
  HALL_END,
  HALL_HALF_WIDTH,
  HALL_SIDE_CENTRE,
  HALL_START,
  PLAYER_START_PITCH,
  PLAYER_START_X,
  PLAYER_START_YAW,
  PLAYER_START_Z,
  SIDE_EXIT_REACH,
  WALL_HEIGHT,
  WORLD_AMBIENT_COLOR,
  WORLD_AMBIENT_INTENSITY,
  WORLD_DISTANCE_COLOR,
  WORLD_GROUND_FILL_COLOR,
  WORLD_HEMISPHERE_INTENSITY,
  WORLD_SKY_FILL_COLOR,
} from '../constants.js';
import {
  camera,
  keyLight,
  renderedWorld,
  renderer,
  scene,
  setPortalRenderPass,
  WORLD_FOG_DENSITY,
} from '../core/view.js';
import { sceneTarget } from '../core/bloom.js';
import { player } from '../player.js';
import { crossedPassageExit, passageWallAt } from './doors.js';
import { wallBasis } from './geometry.js';
import { arrivalWallFor, passageEnds, passageExits } from './passage.js';
import { noteChamber, ordinalFor } from './register.js';
import { buildSigns, disposeSigns } from './signs.js';
import { adoptedBalusters, disposeRoom, makePortalRoom, makeRoom, paintPendingSpines } from './room.js';
import { vistaBuilder } from './vista.js';

const roomRegistry = new Map();

export const world = {
  room: { q: 0n, r: 0n, level: 0n },
  tag: '',
  // The walker's own number for this chamber. The tag above is the world's
  // name for it and is not one a person can carry; see world/register.js.
  ordinal: 1,
  address: '',
  mapCells: [],
  // Where the walker is standing, which is not always a chamber. A passage is
  // a junction of four, and saying "chamber 1" while somebody stands in the
  // middle of one is the only place this interface has been untrue.
  place: 'chamber',
  placeLabel: '',
  // True when the walker got here by turning aside in a passage, which cannot
  // be retraced. Set by the transition and read once, by the notice.
  arrivedIndirectly: false,
};

let roomChangeListener = null;
export function onRoomChange(listener) {
  roomChangeListener = listener;
}

function refreshRoomRecord() {
  const { q, r, level } = world.room;
  world.tag = roomTagFor(q, r, level);
  world.ordinal = noteChamber(world.room);
  world.address = exactWorldRoomAddressFor(q, r, level);
  // Neighbours carry the number only if the walker has been in them. A chamber
  // nobody has entered has no number, because nobody has given it one.
  world.mapCells = catalogueCoordinates(world.room).map(cell => ({
    ...cell,
    tag: roomTagFor(cell.q, cell.r, cell.level),
    ordinal: ordinalFor(cell),
  }));
}

function refreshScene() {
  const { q, r, level } = world.room;
  const activeKey = roomKey(q, r, level);
  for (const [loadedKey, room] of [...roomRegistry]) {
    if (loadedKey !== activeKey) {
      disposeRoom(room);
      renderedWorld.remove(room);
      roomRegistry.delete(loadedKey);
    }
  }
  if (!roomRegistry.has(activeKey)) {
    const room = makeRoom(q, r, level);
    roomRegistry.set(activeKey, room);
    renderedWorld.add(room);
  }
  roomRegistry.get(activeKey).position.set(0, 0, 0);
}

// What shows through the doorways depends only on the level, because every
// chamber on a level is identical and the player always stands at the origin of
// their own. So it is rebuilt when the player changes floor and left alone
// while they walk: crossing a threshold must not disturb it, or the corridor
// would visibly restart instead of continuing.
let vista = null;
let vistaLevel = null;

// There are exactly three shafts, not one per floor.
//
// Everything the vista depends on comes from which pair of walls a level leaves
// free, and that rotates with a period of three. So the shaft seen from level 0
// is the shaft seen from level 3 and from level -3, part for part. Rebuilding
// it on every change of floor cost most of a second and froze the walker on the
// stair each time they arrived; built once per residue and kept, a storey
// change is a swap of two children.
//
// The cost of keeping all three resident is three shafts' worth of geometry
// against a rebuild the walker feels. Memory here is cheap and that pause was
// not.
const vistaByResidue = new Map();

function levelResidue(level) {
  return Number(((level % 3n) + 3n) % 3n);
}

// Building one shaft is most of a second, and there are only ever three of
// them. Rather than let the walker meet that cost at the moment they arrive on
// a new floor, the two they have not seen yet are built ahead of time.
//
// Ahead of time is not enough on its own. A shaft built in one piece from an
// idle callback still stopped the world for most of a second, only now it did
// it a few seconds after the walker set off, wherever they happened to be.
// vistaBuilder does a storey per step, so the warm-up is spread over short
// slices between frames and no one of them is long enough to be seen.
const VISTA_WARM_SLICE_MS = 4;
const vistaBuilds = new Map();
let vistaWarmHandle = null;

function nextMissingResidue() {
  return [0, 1, 2].find(residue => !vistaByResidue.has(residue));
}

function stepVistaBuild(residue, deadline) {
  let build = vistaBuilds.get(residue);
  if (!build) {
    build = vistaBuilder(BigInt(residue));
    vistaBuilds.set(residue, build);
  }
  while (performance.now() < deadline) {
    const step = build.next();
    if (step.done) {
      vistaBuilds.delete(residue);
      vistaByResidue.set(residue, step.value);
      return true;
    }
  }
  return false;
}

function warmVistaCache() {
  if (vistaWarmHandle !== null || nextMissingResidue() === undefined) return;
  // One zero-delay task per slice, for the reason given at the destination
  // queue below: an idle callback can starve while WebGL keeps the frame busy.
  vistaWarmHandle = setTimeout(() => {
    vistaWarmHandle = null;
    const residue = nextMissingResidue();
    if (residue === undefined) return;
    stepVistaBuild(residue, performance.now() + VISTA_WARM_SLICE_MS);
    warmVistaCache();
  }, 0);
}

function refreshVista() {
  const level = world.room.level;
  if (vista && vistaLevel !== null && levelResidue(vistaLevel) === levelResidue(level)) {
    vistaLevel = level;
    return;
  }
  if (vista) renderedWorld.remove(vista);
  const residue = levelResidue(level);
  // A walker who climbs before the warm-up reaches this floor has to be shown
  // it now; whatever storeys are already built are kept.
  if (!vistaByResidue.has(residue)) stepVistaBuild(residue, Infinity);
  vista = vistaByResidue.get(residue);
  vistaLevel = level;
  renderedWorld.add(vista);
}

// Every onward opening of both passages is a permanent aperture onto the exact
// room it leads to. All six destinations are prepared while the walker is
// still in the chamber: there is no proxy room and no corridor-entry build.
let passageDestinations = null;
let destinationPreparationHandle = null;
let destinationPreparationGeneration = 0;
const portalPoint = new THREE.Vector3();
const portalInverse = new THREE.Matrix4();
const portalProjection = new THREE.Matrix4();
const portalFrustum = new THREE.Frustum();
// All aperture masks share one stencil value. Only one is rendered at a time
// and the buffer is cleared between them.
const PORTAL_STENCIL_REF = 1;
// The stencil plane sits 12 cm behind the physical threshold. At an oblique
// angle a plane cut to the mathematical mouth projects a little inside the
// nearer wall/ceiling edges and exposes the clear colour as a bright crack.
// Deliberate overdraw is safe because the ordinary corridor is rendered first
// and depth-tests the mask back to its true visible aperture.
const PORTAL_MASK_OVERDRAW = 0.36;

// Before a destination is drawn, the source world's depth is cleared wherever
// its doorway is actually in sight, so that everything of the destination
// beyond the threshold shows however near the source's own walls stand behind
// it; and only there, so that a doorway hidden behind a wall stays hidden.
//
// Two earlier versions each got one half wrong. A full-screen reset with the
// depth test off wrote no depth at all (WebGL ignores depthWrite then), so the
// outside of the walker's own chamber cut the far side of a side-exit shaft
// into a blank wall. Made to work, the same reset followed a stencil laid by a
// core mask that ignored depth, so doorways behind the chamber's walls were
// painted over them.
const depthResetScene = new THREE.Scene();
const depthResetCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// The depth test stays on and always passes: with it off WebGL writes nothing.
const depthResetMaterial = new THREE.ShaderMaterial({
  colorWrite: false,
  depthFunc: THREE.AlwaysDepth,
  depthTest: true,
  depthWrite: true,
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  stencilFail: THREE.KeepStencilOp,
  stencilFunc: THREE.EqualStencilFunc,
  stencilWrite: true,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }',
});
depthResetScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthResetMaterial));

function portalTransform(from, wall, exit) {
  const there = passageExits(from, wall)[exit];
  const arrival = arrivalWallFor(there, from, from.level);
  const passageBasis = wallBasis(wall);
  if (exit === 'ahead') {
    const direction = new THREE.Vector3(passageBasis.nx, 0, passageBasis.nz);
    return {
      arrival,
      centre: direction.clone().multiplyScalar(CHAMBER_STEP),
      direction,
      doorway: new THREE.Vector3(
        passageBasis.nx * HALL_END,
        DOOR_HEIGHT / 2,
        passageBasis.nz * HALL_END,
      ),
      exit,
      rotation: 0,
      there,
      wall,
    };
  }
  const arrivalBasis = wallBasis(arrival);
  const side = exit === 'right' ? 1 : -1;
  const direction = new THREE.Vector3(
    side * passageBasis.tx,
    0,
    side * passageBasis.tz,
  );
  // The destination doorway's outward normal faces back down the side arm.
  // Three's positive Y rotation adds to atan2(x, z), so this angle maps the
  // canonical arrival wall to -direction exactly.
  const rotation = Math.atan2(-direction.x, -direction.z)
    - Math.atan2(arrivalBasis.nx, arrivalBasis.nz);
  const crossingX = passageBasis.nx * (HALL_START + HALL_SIDE_CENTRE);
  const crossingZ = passageBasis.nz * (HALL_START + HALL_SIDE_CENTRE);
  const doorwayX = crossingX + direction.x * SIDE_EXIT_REACH;
  const doorwayZ = crossingZ + direction.z * SIDE_EXIT_REACH;
  return {
    arrival,
    centre: new THREE.Vector3(
      doorwayX + direction.x * HALL_START,
      0,
      doorwayZ + direction.z * HALL_START,
    ),
    direction,
    doorway: new THREE.Vector3(doorwayX, DOOR_HEIGHT / 2, doorwayZ),
    exit,
    rotation,
    there,
    wall,
  };
}

function portalMaskFor(transform, stencilRef) {
  // One aperture, slightly larger than the doorway and tested against the
  // source world's depth: real corridor walls, jambs and lintels hide it, and
  // the margin fills the cracks that open around oblique jamb and lintel edges.
  // What the source has standing behind the doorway is dealt with by the depth
  // reset that follows, not by ignoring depth here.
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    stencilFail: THREE.KeepStencilOp,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilRef,
    stencilWrite: true,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(
      2 * HALL_HALF_WIDTH + 2 * PORTAL_MASK_OVERDRAW,
      DOOR_HEIGHT + 2 * PORTAL_MASK_OVERDRAW,
    ),
    material,
  );
  // Keep the aperture beyond the 20 mm near clip until the same frame in which
  // crossedPassageExit hands the camera to the destination room.
  mesh.position.copy(transform.doorway).addScaledVector(transform.direction, 0.12);
  mesh.rotation.y = Math.atan2(-transform.direction.x, -transform.direction.z);
  mesh.raycast = () => {};
  const maskScene = new THREE.Scene();
  maskScene.add(mesh);
  return { maskScene, material, mesh, stencilRef };
}

function destinationMaterials(root) {
  const found = new Set();
  root.traverse(object => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) found.add(material);
  });
  return [...found];
}

function applyPortalStencil(materials, stencilRef) {
  const states = materials.map(material => ({
    material,
    stencilFail: material.stencilFail,
    stencilFunc: material.stencilFunc,
    stencilRef: material.stencilRef,
    stencilWrite: material.stencilWrite,
    stencilZFail: material.stencilZFail,
    stencilZPass: material.stencilZPass,
  }));
  for (const material of materials) {
    material.stencilWrite = true;
    material.stencilRef = stencilRef;
    material.stencilFunc = THREE.EqualStencilFunc;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.KeepStencilOp;
  }
  return states;
}

function restoreStencil(states) {
  for (const state of states) {
    state.material.stencilWrite = state.stencilWrite;
    state.material.stencilRef = state.stencilRef;
    state.material.stencilFunc = state.stencilFunc;
    state.material.stencilFail = state.stencilFail;
    state.material.stencilZFail = state.stencilZFail;
    state.material.stencilZPass = state.stencilZPass;
  }
}

const apertureCorner = new THREE.Vector3();

/**
 * Limits drawing to the screen rectangle a doorway's mask covers.
 *
 * Returns false when that rectangle is empty. A corner behind the camera has
 * no meaningful projection, so then the whole frame is left open, which is
 * what the pass did before and is always correct.
 */
function scissorToAperture(mesh) {
  const { width, height } = mesh.geometry.parameters;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    apertureCorner.set(x * width / 2, y * height / 2, 0).applyMatrix4(mesh.matrixWorld);
    apertureCorner.applyMatrix4(camera.matrixWorldInverse);
    if (apertureCorner.z > -camera.near) {
      sceneTarget.scissorTest = false;
      return true;
    }
    apertureCorner.applyMatrix4(camera.projectionMatrix);
    minX = Math.min(minX, apertureCorner.x);
    minY = Math.min(minY, apertureCorner.y);
    maxX = Math.max(maxX, apertureCorner.x);
    maxY = Math.max(maxY, apertureCorner.y);
  }
  const w = sceneTarget.width;
  const h = sceneTarget.height;
  // A pixel of margin each way: the rectangle must never trim the aperture.
  const left = Math.max(0, Math.floor((minX + 1) / 2 * w) - 1);
  const bottom = Math.max(0, Math.floor((minY + 1) / 2 * h) - 1);
  const right = Math.min(w, Math.ceil((maxX + 1) / 2 * w) + 1);
  const top = Math.min(h, Math.ceil((maxY + 1) / 2 * h) + 1);
  if (right <= left || top <= bottom) return false;
  sceneTarget.scissor.set(left, bottom, right - left, top - bottom);
  sceneTarget.scissorTest = true;
  return true;
}

function renderPassagePortals() {
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  // Into the frame buffer, not onto the canvas: view.js runs the glow over it
  // once every portal has been composed.
  renderer.setRenderTarget(sceneTarget);
  renderer.clear(true, true, true);
  // A plaque names the chamber at the end of an arm, and it is painted on the
  // band above that chamber's doorway — the same band the destination's own
  // lintel has to fill, or a bright strip opens over every side exit. So the
  // aperture is a whole DOOR_HEIGHT tall and its top lands exactly on the
  // plaque, which the depth reset below then erases. Only the way back kept its
  // name, because the way back is the one exit with no portal.
  //
  // The marking belongs to the wall, not to the composition, so it is held out
  // of the ordinary pass and laid over the finished frame instead. It still
  // tests depth, so a wall between the walker and a plaque still hides it.
  if (signs) signs.visible = false;
  renderer.render(scene, camera);
  if (signs) signs.visible = true;

  if (passageDestinations) {
    // Do not pay full room draws when their apertures are outside the
    // camera. This is a projection-only optimisation: it changes neither scene
    // membership nor which portal exists.
    portalProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    portalFrustum.setFromProjectionMatrix(portalProjection);
    for (const destination of passageDestinations.entries.values()) {
      destination.maskScene.updateMatrixWorld(true);
      if (!portalFrustum.intersectsObject(destination.mesh)) continue;
      // The stencil already confines a destination to its doorway, but only
      // after every fragment of a whole chamber and its shaft has been run and
      // then discarded. Scissoring to the doorway's rectangle on screen stops
      // that work before it starts; a far doorway is a few hundred pixels, not
      // the frame.
      if (!scissorToAperture(destination.mesh)) continue;
      renderer.setRenderTarget(sceneTarget);
      renderer.clear(false, false, true);
      renderer.render(destination.maskScene, camera);

      depthResetMaterial.stencilRef = destination.stencilRef;
      renderer.render(depthResetScene, depthResetCamera);

      const states = applyPortalStencil(
        destination.materials,
        destination.stencilRef,
      );
      renderer.render(destination.portalScene, camera);
      restoreStencil(states);
    }
    sceneTarget.scissorTest = false;
    renderer.setRenderTarget(sceneTarget);
    renderer.clear(false, false, true);
  }
  // Last, over the composed frame: see the note above the base pass.
  if (signs) renderer.render(signs, camera);
  renderer.autoClear = previousAutoClear;
}

setPortalRenderPass(renderPassagePortals);

function disposePassageDestinations() {
  destinationPreparationGeneration++;
  if (destinationPreparationHandle !== null) {
    clearTimeout(destinationPreparationHandle);
    destinationPreparationHandle = null;
  }
  if (!passageDestinations) return;
  renderedWorld.remove(passageDestinations.group);
  for (const destination of passageDestinations.entries.values()) {
    if (!destination.adopted) disposeRoom(destination.portalRoom);
    destination.mesh.geometry.dispose();
    destination.material.dispose();
  }
  passageDestinations = null;
}

function cloneDestinationVista(template, arrivalWall) {
  // A doorway previews the exact destination room and its vertical shaft, but
  // no horizontal passage. The observer-side arm belongs to the base world;
  // rotating either copied arm into a side portal makes its long walls project
  // through the room as the obsolete rectangles/diagonals seen at left and
  // right thresholds. Once adopted, the canonical vista supplies both arms in
  // the destination frame without keeping six hidden corridor copies alive.
  const clone = template.clone(true);
  for (const child of [...clone.children]) {
    if (child.userData.vistaPassageWall !== undefined) clone.remove(child);
    // The balusters of the storeys above and below are one more draw in every
    // doorway; through a doorway those storeys are far enough off that their
    // rails and footings carry the balustrade on their own.
    else if (child.userData.balusters) clone.remove(child);
  }
  clone.userData.omittedArrivalPassage = arrivalWall;
  clone.userData.remainingPassageWalls = [];
  return clone;
}

function destinationKey(wall, exit) {
  return `${wall}:${exit}`;
}

function destinationJobs() {
  const walls = [...freeWallsForLevel(world.room.level)];
  // The straight neighbour is visible from the chamber, whereas the two side
  // destinations only become visible at the crossing. Prepare in that order,
  // beginning with the passage nearest the current viewpoint.
  walls.sort((a, b) => {
    const basisA = wallBasis(a);
    const basisB = wallBasis(b);
    const distanceA = basisA.nx * camera.position.x + basisA.nz * camera.position.z;
    const distanceB = basisB.nx * camera.position.x + basisB.nz * camera.position.z;
    return distanceB - distanceA;
  });
  return walls.flatMap(wall => ['ahead', 'left', 'right'].map(exit => ({ wall, exit })));
}

function createPassageDestinations() {
  disposePassageDestinations();
  const group = new THREE.Group();
  group.name = 'passage-destinations';
  group.userData.passageDestinations = true;
  group.userData.expected = 6;
  group.userData.ready = 0;
  group.userData.compiled = 0;
  group.userData.buildDurations = [];
  group.userData.maxBuildMs = 0;
  group.userData.buildsTriggeredInPassage = 0;
  group.userData.synchronousFallbacks = 0;
  renderedWorld.add(group);
  passageDestinations = {
    entries: new Map(),
    group,
    queue: destinationJobs(),
    roomKey: roomKey(world.room.q, world.room.r, world.room.level),
    source: { ...world.room },
  };
}

function buildDestination(job, synchronousFallback = false) {
  if (!passageDestinations || !vista) return null;
  const key = destinationKey(job.wall, job.exit);
  const existing = passageDestinations.entries.get(key);
  if (existing) return existing;

  const started = performance.now();
  const transform = portalTransform(passageDestinations.source, job.wall, job.exit);
  const mask = portalMaskFor(transform, PORTAL_STENCIL_REF);
  const destinationVista = cloneDestinationVista(vista, transform.arrival);
  const sourceRoom = roomRegistry.get(passageDestinations.roomKey);
  const portalRoom = makePortalRoom(
    sourceRoom,
    transform.there.q,
    transform.there.r,
    transform.there.level,
  );
  const portalRoot = new THREE.Group();
  portalRoot.position.copy(transform.centre);
  portalRoot.rotation.y = transform.rotation;
  portalRoot.add(destinationVista, portalRoom);

  const portalScene = new THREE.Scene();
  // A separately rendered scene otherwise clears the colour already laid down
  // by the active room before the stencil can limit it.  With a pale clear
  // colour that bug was merely a subtle flash; in a dark library it blacked
  // out the whole frame.  A null background keeps the portal transparent
  // outside its aperture while fog still gives its contents the same depth.
  portalScene.background = null;
  portalScene.fog = new THREE.FogExp2(WORLD_DISTANCE_COLOR, WORLD_FOG_DENSITY);
  // Must track view.js exactly. A destination is seen through an opening a few
  // centimetres away, so any difference between the two lightings is a seam
  // drawn straight down the middle of a doorway.
  portalScene.add(new THREE.HemisphereLight(WORLD_SKY_FILL_COLOR, WORLD_GROUND_FILL_COLOR, WORLD_HEMISPHERE_INTENSITY));
  portalScene.add(new THREE.AmbientLight(WORLD_AMBIENT_COLOR, WORLD_AMBIENT_INTENSITY));
  // The destination room and its key light share one local frame. Leaving the
  // light at a fixed world coordinate made the same room brighter or darker
  // depending on whether it was seen ahead, left or right, and the light then
  // jumped again when the room was adopted at the threshold.
  // Straight down, for the same reason the base key is: any horizontal
  // component makes architecturally identical walls differ by which way they
  // face, and here it would also disagree with the corridor the walker is
  // standing in. The old (-28, 42, 24) survived here after the base scene was
  // corrected, which put a lit wall next to an unlit one across the threshold.
  //
  // A copy of the base key, shadow and all. Given a key without a shadow, a
  // portal scene's lighting differed from the chamber's by one shadow count,
  // and that alone made three.js compile every material a second time for the
  // doorways: half of all the shaders the game builds, most of the seconds a
  // first frame took. The shadow is drawn once per destination and kept.
  const portalKey = keyLight.clone();
  portalRoot.add(portalKey);
  portalRoot.add(portalKey.target);
  portalScene.add(portalRoot);

  // These markers contain no drawable geometry. They make it possible to
  // verify that six exact destinations exist without placing hidden structures
  // in the ordinary corridor scene.
  const root = new THREE.Group();
  root.position.copy(transform.centre);
  root.rotation.y = transform.rotation;
  root.userData.portalExit = job.exit;
  root.userData.portalWall = job.wall;
  root.userData.destination = transform.there;
  root.userData.portalRoomId = portalRoom.id;
  root.userData.bookCount = portalRoom.userData.bookMeshes.reduce(
    (total, mesh) => total + mesh.count,
    0,
  );
  root.userData.metadataDeferred = Boolean(portalRoom.userData.portalMetadata);
  root.userData.maskDepthTest = mask.material.depthTest;
  root.userData.maskHeight = mask.mesh.geometry.parameters.height;
  root.userData.maskWidth = mask.mesh.geometry.parameters.width;
  root.userData.omittedArrivalPassage = destinationVista.userData.omittedArrivalPassage;
  root.userData.remainingPassageWalls = destinationVista.userData.remainingPassageWalls;
  root.userData.localLighting = portalKey.parent === portalRoot
    && portalKey.target.parent === portalRoot;
  passageDestinations.group.add(root);

  const materials = destinationMaterials(portalRoot);
  const destination = {
    ...transform,
    ...mask,
    destinationVista,
    materials,
    portalRoom,
    portalRoot,
    portalScene,
    root,
  };
  passageDestinations.entries.set(key, destination);
  passageDestinations.queue = passageDestinations.queue.filter(candidate => (
    destinationKey(candidate.wall, candidate.exit) !== key
  ));
  const duration = performance.now() - started;
  const data = passageDestinations.group.userData;
  data.ready = passageDestinations.entries.size;
  data.buildDurations.push(duration);
  data.maxBuildMs = Math.max(data.maxBuildMs, duration);
  data.buildsTriggeredInPassage += passageWallAt(camera.position, world.room.level) === null ? 0 : 1;
  data.synchronousFallbacks += synchronousFallback ? 1 : 0;
  // Preparing the portal scene now keeps any shader compilation away from the
  // first frame in which the player turns toward an exit. Geometry and
  // instance attributes are already shared with the active room and therefore
  // warm.
  //
  // It has to be compiled for the buffer it will be drawn into. three.js picks
  // the colour space and tone mapping of a program from the render target that
  // is current at compile time, and between frames that is the canvas; the
  // doorways are drawn into sceneTarget, linear and untoned. Compiled against
  // the canvas, every material got a second program nothing ever used, and the
  // first frames spent seconds building them.
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(sceneTarget);
  const compiling = renderer.compileAsync(portalScene, camera);
  renderer.setRenderTarget(previousTarget);
  void compiling.then(() => {
    if (passageDestinations?.entries.get(key) !== destination) return;
    destination.compiled = true;
    passageDestinations.group.userData.compiled++;
  }).catch(() => {
    // Rendering remains the fallback on browsers without a working parallel
    // shader-compile path; a rejected warm-up must not break the world.
  });
  return destination;
}

function scheduleDestinationPreparation() {
  if (
    !passageDestinations
    || destinationPreparationHandle !== null
    || passageDestinations.queue.length === 0
  ) return;
  const generation = destinationPreparationGeneration;
  const prepareOne = () => {
    destinationPreparationHandle = null;
    if (generation !== destinationPreparationGeneration || !passageDestinations) return;
    const job = passageDestinations.queue[0];
    if (job) buildDestination(job);
    scheduleDestinationPreparation();
  };
  // requestIdleCallback can starve indefinitely while WebGL keeps the frame
  // busy. That left only some directions prepared, so a turn in the middle of
  // a passage exposed a blank or structurally different destination. Each job
  // measures about one millisecond; one zero-delay task per neighbour yields
  // between jobs without making correctness depend on browser idleness.
  destinationPreparationHandle = setTimeout(prepareOne, 0);
}

function destinationFor(wall, exit) {
  if (!passageDestinations) createPassageDestinations();
  const key = destinationKey(wall, exit);
  return passageDestinations.entries.get(key)
    ?? buildDestination({ wall, exit }, true);
}

function resetPassageDestinations() {
  createPassageDestinations();
  scheduleDestinationPreparation();
}

/** Keeps all six exact neighbours prepared independently of camera position. */
export function syncPassageDestinations() {
  const currentRoomKey = roomKey(world.room.q, world.room.r, world.room.level);
  if (!passageDestinations || passageDestinations.roomKey !== currentRoomKey) {
    resetPassageDestinations();
  }
  scheduleDestinationPreparation();
  return passageDestinations.entries.size;
}

// The signs over the ways out of the two passages. Unlike the corridor these
// cannot be shared: they name particular chambers, and half of what they say
// depends on where the walker has already been. So they are rebuilt with the
// room — which is also when the answer can have changed.
let signs = null;

function refreshSigns() {
  if (signs) {
    renderedWorld.remove(signs);
    disposeSigns(signs);
  }
  signs = buildSigns(world.room);
  renderedWorld.add(signs);
}

export function buildCurrentRoom() {
  // Portal vistas share the current vertical-vista buffers. Release those
  // dependants before a level change can replace and dispose the source.
  disposePassageDestinations();
  refreshRoomRecord();
  refreshScene();
  refreshVista();
  refreshSigns();
  // Start preparing the six views now, while the walker is in the chamber.
  // Entering either corridor never creates or swaps geometry.
  resetPassageDestinations();
  // The other two shafts, while nobody is climbing.
  warmVistaCache();
  roomChangeListener?.();
}

/** Selects a different chamber outright; catalogue lookups never call this. */
export function moveToWorldHex(q, r, level = 0n) {
  disposePassageDestinations();
  world.arrivedIndirectly = false;
  world.room = { q: BigInt(q), r: BigInt(r), level: BigInt(level) };
  // The chamber centre is now an open well. Exact-address travel returns the
  // walker to the same safe viewing point used on first load.
  camera.position.set(PLAYER_START_X, 1.65, PLAYER_START_Z);
  player.yaw = PLAYER_START_YAW;
  player.pitch = PLAYER_START_PITCH;
  buildCurrentRoom();
}

/**
 * Leaves a passage through any of its three onward openings.
 *
 * The room that becomes current is the exact object that was already visible
 * through the opening. Ahead and side exits use the same inverse-transform and
 * adoption path, so no direction can acquire a different threshold behaviour.
 */
function stepThrough(wall, exit) {
  world.arrivedIndirectly = exit !== 'ahead';
  const transform = destinationFor(wall, exit);
  portalInverse.makeRotationY(transform.rotation).setPosition(transform.centre).invert();
  portalPoint.copy(camera.position).applyMatrix4(portalInverse);
  camera.position.copy(portalPoint);
  player.yaw -= transform.rotation;

  // Adopt the exact room that was visible through the aperture. Detaching it
  // before disposing the portal worlds preserves geometry, atlas progress and
  // shadows; refreshScene below disposes only the chamber being left.
  if (transform.portalRoom && transform.portalRoot) {
    transform.portalRoot.remove(transform.portalRoom);
    transform.portalRoom.position.set(0, 0, 0);
    transform.portalRoom.rotation.set(0, 0, 0);
    transform.portalRoom.scale.set(1, 1, 1);
    transform.portalRoom.userData.deferSpines = false;
    adoptedBalusters(transform.portalRoom);
    transform.adopted = true;
    roomRegistry.set(
      roomKey(transform.there.q, transform.there.r, transform.there.level),
      transform.portalRoom,
    );
    renderedWorld.add(transform.portalRoom);
  }
  world.room = transform.there;
  disposePassageDestinations();
  buildCurrentRoom();
  return world.room;
}

// A passage is named by its two ends, in the order passageIdFor fixes, so the
// same corridor reads the same walking either way. An end nobody has entered
// has no number, because nobody has given it one.
function passageLabelFor(wall) {
  const ends = passageEnds(world.room, wall).map(end => ordinalFor(end) ?? '?');
  return 'passage ' + ends[0] + ' – ' + ends[1];
}

/**
 * Keeps world.place in step with where the walker actually is.
 *
 * Returns true when it changed, so the status line is rewritten on crossing a
 * threshold rather than every frame.
 */
export function syncPlace() {
  const wall = passageWallAt(camera.position, world.room.level);
  const place = wall === null ? 'chamber' : 'passage';
  const label = wall === null ? 'chamber ' + world.ordinal : passageLabelFor(wall);
  if (place === world.place && label === world.placeLabel) return false;
  world.place = place;
  world.placeLabel = label;
  return true;
}

/**
 * Called once a frame after movement. Returns the chamber entered, or null.
 *
 * Walking back out of the near end of a passage is not a transition: that end
 * belongs to the chamber the player is already in.
 */
export function syncDoorways() {
  const crossing = crossedPassageExit(camera.position, world.room.level);
  if (!crossing) return null;
  return stepThrough(crossing.wall, crossing.exit);
}

/**
 * Called once a frame after movement. Returns +1, -1 or 0.
 *
 * A flight spans exactly one storey, so a walker who has risen a whole
 * WALL_HEIGHT above this chamber's floor is standing on the floor above, and
 * one who has fallen that far is standing on the floor below. Nothing about
 * them moves at the crossing except which chamber is called theirs: they keep
 * their x and z, because the flight stands in the same place on every floor,
 * and their feet return to zero because the floor under them is now that one.
 *
 * The head and foot of the run are both pinned by the collision, so the height
 * lands on the boundary exactly rather than overshooting past it.
 */
export function syncStair() {
  const footY = camera.position.y - EYE_HEIGHT;
  // A millimetre of tolerance. The height at the end of the run is exactly a
  // storey, but the walker is pinned there by a correction applied to x and z
  // and the height is read back out of them, so it arrives a few bits short.
  const reached = WALL_HEIGHT - 0.001;
  if (footY < reached && footY > -reached) return 0;
  const delta = footY > 0 ? 1n : -1n;
  // A storey is climbed, not turned aside into: the way back is the same
  // flight, so this arrival is not one the notice has to warn about.
  world.arrivedIndirectly = false;
  world.room = { q: world.room.q, r: world.room.r, level: world.room.level + delta };
  camera.position.y = EYE_HEIGHT;
  buildCurrentRoom();
  return Number(delta);
}

/**
 * Paints a slice of the current room's spine labels.
 *
 * Called once a frame from the loop. A room is built without its lettering so
 * that crossing a threshold costs geometry only; the labels follow over the
 * next frame or two, in slices small enough that none of them shows.
 */
export function paintRoomLabels(budgetMs) {
  const { q, r, level } = world.room;
  const room = roomRegistry.get(roomKey(q, r, level));
  if (room) paintPendingSpines(room, budgetMs);
}

// The floor volumes and the galleries' volumes: every book in the current
// chamber that can be taken down.
export function currentBookMeshes() {
  const { q, r, level } = world.room;
  const room = roomRegistry.get(roomKey(q, r, level));
  if (!room) return [];
  const { bookMeshes, galleryBooks } = room.userData;
  return galleryBooks ? [...bookMeshes, galleryBooks] : bookMeshes;
}
