import * as THREE from 'three';
import {
  ALPHABET,
  PAGES_PER_VOLUME,
  SHELVES_PER_WALL,
  VOLUMES_PER_SHELF,
  bookIndexFor,
  createPageAddress,
  createPageAddressForBookIndex,
  getPage,
  getPageForBookIndex,
  initialPageForBookIndex,
  initialPageForVolume,
  isManifestoBookIndex,
  parsePageAddress,
  search,
  titleForBookIndex,
  titleForVolume,
} from './babel-v3.js?v=w1-foundation-1';
import {
  WORLD_ALGORITHM_VERSION,
  catalogBookIndexFor,
  createWorldPageAddress,
  parseWorldPageAddress,
  parseWorldRoomAddress,
} from './world-engine.js?v=w1-foundation-1';
import {
  catalogueCoordinates,
  exactWorldRoomAddressFor,
  roomKey,
  roomTagFor,
} from './world-model.js?v=w1-foundation-1';
 
const ROOM_RADIUS = 8.9;
const APOTHEM = ROOM_RADIUS * Math.cos(Math.PI / 6);
const WALL_WIDTH = 9.04;
const WALL_HEIGHT = 4.8;
const PLAYER_RADIUS = 0.28;
const PLAYER_BOUNDARY = 6.45;
const INTERACTION_DISTANCE = 2.2;
const MAX_PAGE_COLUMNS = 80;
const MAX_CLIENT_ADDRESS_LENGTH = 1_600_000;
const CABINET_WIDTH = WALL_WIDTH - 1.6;
const CABINET_POST_WIDTH = 0.14;
const BOOK_WALL_INDICES = Object.freeze([0, 1, 3, 4]);
const BOOK_WALLS = new Set(BOOK_WALL_INDICES);
 
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f2ec);
scene.fog = new THREE.FogExp2(0xf4f2ec, 0.018);
 
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 170);
camera.position.set(0, 1.65, 5.2);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.domElement.className = 'world-canvas';
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.prepend(renderer.domElement);
 
scene.add(new THREE.HemisphereLight(0xffffff, 0x9d9a94, 1.55));
const renderedWorld = new THREE.Group();
scene.add(renderedWorld);
 
function pencilTexture(base, ink, density = 130) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = ink;
  context.lineWidth = 0.55;
  for (let index = 0; index < density; index++) {
    const x = (index * 31) % 128;
    const y = (index * 47) % 128;
    const length = 5 + (index % 17);
    context.globalAlpha = 0.045 + (index % 5) * 0.017;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + length * 0.2);
    context.stroke();
  }
  for (let index = 0; index < density / 4; index++) {
    const x = (index * 53) % 128;
    const y = (index * 19) % 128;
    context.globalAlpha = 0.045;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 11, y + 9);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}
 
function pencilMaterial(texture, color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ color, map: texture });
}
 
const paperTexture = pencilTexture('#ffffff', '#141414', 95);
const woodTexture = pencilTexture('#ffffff', '#141414', 105);
const graphiteTexture = pencilTexture('#ffffff', '#141414', 115);
const floorMaterial = pencilMaterial(paperTexture, 0xc8c8c4);
const ceilingMaterial = pencilMaterial(paperTexture, 0xd8d8d4);
const shelfMaterial = pencilMaterial(woodTexture);
const trimMaterial = pencilMaterial(graphiteTexture);
const wallMaterial = pencilMaterial(paperTexture, 0xdfdfdb);
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.82 });
const roomLineMaterial = new THREE.LineBasicMaterial({ color: 0x242424, transparent: true, opacity: 0.7 });
const bookMaterials = [
  pencilMaterial(paperTexture),
  pencilMaterial(woodTexture),
  pencilMaterial(graphiteTexture),
];
const manifestoBookMaterial = pencilMaterial(paperTexture, 0xd4af37);
const edgeCache = new WeakMap();
const BOOK_HEIGHTS = [0.66];
const BOOK_WIDTH = 0.19;
const BOOK_STEP = 0.22;
// Depth of a volume as it recedes into the shelf. Kept well above BOOK_WIDTH
// so the volume reads as a book lying spine-out on the shelf rather than a
// square-section post; BOOK_FRONT_Z anchors the visible spine face so this
// change only extends the book backward into the cabinet cavity.
const BOOK_DEPTH = 0.4;
const BOOK_FRONT_Z = -0.35;
const bookGeometries = BOOK_HEIGHTS.map(height => new THREE.BoxGeometry(BOOK_WIDTH, height, BOOK_DEPTH));
const spineGeometry = new THREE.PlaneGeometry(0.17, 0.62);
const sharedGeometries = new Set([...bookGeometries, spineGeometry]);
const SPINE_ATLAS_SIZE = 1024;
const SPINE_CELL_WIDTH = 72;
const SPINE_CELL_HEIGHT = 256;
const SPINE_ATLAS_COLUMNS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_WIDTH);
const SPINE_ATLAS_ROWS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_HEIGHT);
const SPINES_PER_ATLAS = SPINE_ATLAS_COLUMNS * SPINE_ATLAS_ROWS;
 
function createBox(group, geometry, material, position, rotation = 0, outlined = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.y = rotation;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  if (outlined) {
    let edges = edgeCache.get(geometry);
    if (!edges) {
      edges = new THREE.EdgesGeometry(geometry, 18);
      edgeCache.set(geometry, edges);
    }
    const outline = new THREE.LineSegments(edges, outlineMaterial);
    outline.position.copy(position);
    outline.rotation.y = rotation;
    outline.renderOrder = 2;
    group.add(outline);
  }
  return mesh;
}
 
function wallBasis(index) {
  const angle = Math.PI / 6 + index * Math.PI / 3;
  return {
    nx: Math.cos(angle), nz: Math.sin(angle),
    tx: -Math.sin(angle), tz: Math.cos(angle),
    rotation: -angle + Math.PI / 2,
  };
}
function axialMapOffset(q, r) {
  const spacing = APOTHEM * 2;
  const localX = spacing * (Number(q) + Number(r) / 2);
  const localZ = spacing * 0.8660254 * Number(r);
  const rotation = Math.PI / 6;
  return new THREE.Vector3(
    localX * Math.cos(rotation) - localZ * Math.sin(rotation),
    0,
    localX * Math.sin(rotation) + localZ * Math.cos(rotation),
  );
}
function pointOnWall(basis, tangent, height, inward = 0) {
  return new THREE.Vector3(
    basis.nx * (APOTHEM - inward) + basis.tx * tangent,
    height,
    basis.nz * (APOTHEM - inward) + basis.tz * tangent,
  );
}
 
function ceilingMark(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.strokeStyle = '#69717b';
  context.fillStyle = '#69717b';
  context.globalAlpha = 0.8;
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(170, 110); context.lineTo(1878, 110);
  context.moveTo(170, 402); context.lineTo(1878, 402);
  context.stroke();
  for (const x of [170, 400, 1648, 1878]) {
    context.beginPath();
    context.moveTo(x, 86); context.lineTo(x, 134);
    context.moveTo(x, 378); context.lineTo(x, 426);
    context.stroke();
  }
  context.font = '700 176px "Courier New", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 1024, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
}
 
function createSpineAtlas(room) {
  const canvas = document.createElement('canvas');
  canvas.width = SPINE_ATLAS_SIZE;
  canvas.height = SPINE_ATLAS_SIZE;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const atlas = { canvas, context, material, next: 0 };
  room.userData.spineAtlases.push(atlas);
  room.userData.disposableMaterials.push(material);
  return atlas;
}
function geometryForSpineCell(column, row) {
  const inset = 2;
  const u0 = (column * SPINE_CELL_WIDTH + inset) / SPINE_ATLAS_SIZE;
  const u1 = ((column + 1) * SPINE_CELL_WIDTH - inset) / SPINE_ATLAS_SIZE;
  const vTop = 1 - (row * SPINE_CELL_HEIGHT + inset) / SPINE_ATLAS_SIZE;
  const vBottom = 1 - ((row + 1) * SPINE_CELL_HEIGHT - inset) / SPINE_ATLAS_SIZE;
  const geometry = spineGeometry.clone();
  const uv = geometry.getAttribute('uv');
  uv.setXY(0, u0, vTop);
  uv.setXY(1, u1, vTop);
  uv.setXY(2, u0, vBottom);
  uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
  return geometry;
}
function spineVisual(room, label) {
  let atlas = room.userData.spineAtlases.at(-1);
  if (!atlas || atlas.next === SPINES_PER_ATLAS) atlas = createSpineAtlas(room);
  const cell = atlas.next++;
  const column = cell % SPINE_ATLAS_COLUMNS;
  const row = Math.floor(cell / SPINE_ATLAS_COLUMNS);
  const x = column * SPINE_CELL_WIDTH;
  const y = row * SPINE_CELL_HEIGHT;
  const context = atlas.context;
  context.save();
  context.beginPath();
  context.rect(x + 2, y + 2, SPINE_CELL_WIDTH - 4, SPINE_CELL_HEIGHT - 4);
  context.clip();
  context.fillStyle = '#262626';
  context.globalAlpha = 0.88;
  context.translate(x + SPINE_CELL_WIDTH / 2, y + SPINE_CELL_HEIGHT / 2);
  context.rotate(-Math.PI / 2);
  context.font = '600 19px "Courier New", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0);
  context.restore();
  atlas.material.map.needsUpdate = true;
  return { geometry: geometryForSpineCell(column, row), material: atlas.material };
}
function shortSpineTitle(title) {
  const value = title.replace(/\s+/g, ' ').trim().slice(0, 12);
  return value || 'untitled';
}
 
function addSolidWall(room, index) {
  const basis = wallBasis(index);
  createBox(room, new THREE.BoxGeometry(WALL_WIDTH, WALL_HEIGHT, 0.2), wallMaterial, pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation);
}
 
function makeBookWall(room, index, q, r) {
  const basis = wallBasis(index);
  const canonicalWall = BOOK_WALL_INDICES.indexOf(index) + 1;
  const frame = new THREE.Group();
  frame.rotation.y = basis.rotation;
  room.add(frame);
  const frameOffset = pointOnWall(basis, 0, 0, 0.28);
  frame.position.copy(frameOffset);
  const postOffset = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  createBox(frame, new THREE.BoxGeometry(CABINET_WIDTH, 0.12, 0.54), trimMaterial, new THREE.Vector3(0, 0.24, -0.14));
  createBox(frame, new THREE.BoxGeometry(CABINET_WIDTH, 0.12, 0.54), trimMaterial, new THREE.Vector3(0, 4.56, -0.14));
  createBox(frame, new THREE.BoxGeometry(CABINET_POST_WIDTH, 4.38, 0.54), shelfMaterial, new THREE.Vector3(-postOffset, 2.4, -0.14));
  createBox(frame, new THREE.BoxGeometry(CABINET_POST_WIDTH, 4.38, 0.54), shelfMaterial, new THREE.Vector3(postOffset, 2.4, -0.14));
 
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = 0.32 + shelfIndex * 0.86;
    createBox(frame, new THREE.BoxGeometry(CABINET_WIDTH, 0.09, 0.5), trimMaterial, new THREE.Vector3(0, shelfY, -0.18));
    for (let volumeIndex = 0; volumeIndex < VOLUMES_PER_SHELF; volumeIndex++) {
      const worldLocation = {
        q,
        r,
        wall: canonicalWall,
        shelf: shelfIndex + 1,
        volume: volumeIndex + 1,
        page: 1,
      };
      const bookIndex = catalogBookIndexFor(worldLocation);
      const materialIndex = (shelfIndex + volumeIndex) % bookMaterials.length;
      const bookMaterial = isManifestoBookIndex(bookIndex) ? manifestoBookMaterial : bookMaterials[materialIndex];
      const heightIndex = 0;
      const height = BOOK_HEIGHTS[heightIndex];
      const x = -((VOLUMES_PER_SHELF - 1) * BOOK_STEP) / 2 + volumeIndex * BOOK_STEP;
      const y = shelfY + 0.07 + height / 2;
      const bookCenterZ = BOOK_FRONT_Z + BOOK_DEPTH / 2;
      createBox(frame, bookGeometries[heightIndex], bookMaterial, new THREE.Vector3(x, y, bookCenterZ));
 
      const title = shortSpineTitle(titleForBookIndex(bookIndex));
      const visual = spineVisual(room, title);
      const spine = new THREE.Mesh(visual.geometry, visual.material);
      spine.position.set(x, y, BOOK_FRONT_Z - 0.015);
      spine.rotation.y = Math.PI;
      spine.renderOrder = 3;
      spine.userData.bookIndex = bookIndex;
      spine.userData.worldLocation = worldLocation;
      spine.userData.volumeTitle = title;
      room.userData.spines.push(spine);
      frame.add(spine);
    }
  }
}
 
function makeRoom(q, r, roomTag) {
  const room = new THREE.Group();
  room.userData = { q, r, spines: [], spineAtlases: [], disposableMaterials: [] };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  room.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT + 0.01;
  room.add(ceiling);
  const markMaterial = ceilingMark(roomTag);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.85), markMaterial);
  mark.rotation.x = Math.PI / 2;
  mark.position.set(0, WALL_HEIGHT, 0);
  room.add(mark);
  room.userData.disposableMaterials.push(markMaterial);
 
  const corners = [];
  for (let index = 0; index < 6; index++) {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    corners.push(new THREE.Vector3(Math.cos(angle) * ROOM_RADIUS * 0.975, 0.01, Math.sin(angle) * ROOM_RADIUS * 0.975));
  }
  for (const corner of corners) {
    const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(corner.x, 0.02, corner.z), new THREE.Vector3(corner.x, WALL_HEIGHT, corner.z)]);
    room.add(new THREE.Line(line, roomLineMaterial));
  }
  for (let index = 0; index < 6; index++) {
    addSolidWall(room, index);
    if (BOOK_WALLS.has(index)) makeBookWall(room, index, q, r);
  }
  return room;
}
 
const roomRegistry = new Map();
let currentRoom = { q: 0n, r: 0n };
let currentRoomTag = '';
let currentMapCells = [];
 
function refreshCatalogueView() {
  currentRoomTag = roomTagFor(currentRoom.q, currentRoom.r);
  currentMapCells = catalogueCoordinates(currentRoom).map(cell => ({
    ...cell,
    tag: roomTagFor(cell.q, cell.r),
  }));
  if (typeof cellElement !== 'undefined') {
    cellElement.textContent = 'chamber ' + currentRoomTag;
    cellElement.dataset.fullAddress = exactWorldRoomAddressFor(currentRoom.q, currentRoom.r);
  }
}
 
function disposeRoom(room) {
  const geometries = new Set();
  room.traverse(object => {
    if (object.geometry && !sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of room.userData.disposableMaterials) {
    material.map?.dispose();
    material.dispose();
  }
  renderedWorld.remove(room);
}
function refreshWorld() {
  const activeKey = roomKey(currentRoom.q, currentRoom.r);
  for (const [loadedKey, room] of [...roomRegistry]) {
    if (loadedKey !== activeKey) {
      disposeRoom(room);
      roomRegistry.delete(loadedKey);
    }
  }
  if (!roomRegistry.has(activeKey)) {
    const room = makeRoom(currentRoom.q, currentRoom.r, currentRoomTag);
    roomRegistry.set(activeKey, room);
    renderedWorld.add(room);
  }
  roomRegistry.get(activeKey).position.set(0, 0, 0);
}
 
const mapCanvas = document.querySelector('#hex-map');
const mapContext = mapCanvas.getContext('2d');
const cellElement = document.querySelector('#cell');
const soundElement = document.querySelector('#sound');
const noticeElement = document.querySelector('#notice');
const startupElement = document.querySelector('#startup-state');
const intro = document.querySelector('#intro');
const startButton = document.querySelector('#start');
const reticle = document.querySelector('#reticle');
const searchButton = document.querySelector('#open-search');
const searchPanel = document.querySelector('#search-panel');
const searchInput = document.querySelector('#search-input');
const searchSubmit = document.querySelector('#search-submit');
const addressInput = document.querySelector('#address-input');
const addressSubmit = document.querySelector('#address-submit');
const searchResult = document.querySelector('#search-result');
const closeSearchButton = document.querySelector('#close-search');
const bookPanel = document.querySelector('#book-panel');
const bookTitle = document.querySelector('#book-title');
const bookAddress = document.querySelector('#book-address');
const locationRecord = document.querySelector('#location-record');
const catalogueRecord = document.querySelector('#catalogue-record');
const pageFormat = document.querySelector('#page-format');
const bookPage = document.querySelector('#book-page');
const pageNumber = document.querySelector('.page-counter span');
const pageTotal = document.querySelector('#page-total');
const previousPage = document.querySelector('#previous-page');
const nextPage = document.querySelector('#next-page');
const closeBookButton = document.querySelector('#close-book');
const raycaster = new THREE.Raycaster();
const centerPointer = new THREE.Vector2(0, 0);
pageTotal.textContent = String(PAGES_PER_VOLUME);
 
function setStartupState(text, error = false) {
  startupElement.textContent = text;
  startupElement.classList.toggle('error', error);
}
function showNotice(text) {
  noticeElement.textContent = text;
  noticeElement.classList.add('visible');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => noticeElement.classList.remove('visible'), 1700);
}
function resizeMapCanvas() {
  const scale = Math.min(devicePixelRatio, 2);
  const rect = mapCanvas.getBoundingClientRect();
  mapCanvas.width = Math.round(rect.width * scale);
  mapCanvas.height = Math.round(rect.height * scale);
  mapContext.setTransform(scale, 0, 0, scale, 0, 0);
}
function drawMap() {
  const rect = mapCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.22;
  mapContext.clearRect(0, 0, width, height);
  mapContext.lineWidth = 1;
  mapContext.font = '700 8px "Courier New", monospace';
  mapContext.textAlign = 'center';
  mapContext.textBaseline = 'middle';
  const rotatePoint = (x, y) => {
    const angle = -yaw;
    const dx = x - centerX;
    const dy = y - centerY;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return { x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
  };
  const cells = currentMapCells;
  const screenScale = radius / ROOM_RADIUS;
  for (const cell of cells) {
    const delta = axialMapOffset(cell.q - currentRoom.q, cell.r - currentRoom.r);
    const x = centerX + delta.x * screenScale;
    const y = centerY + delta.z * screenScale;
    const points = [];
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3;
      points.push(rotatePoint(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
    }
    mapContext.beginPath();
    points.forEach((point, index) => index ? mapContext.lineTo(point.x, point.y) : mapContext.moveTo(point.x, point.y));
    mapContext.closePath();
    const isCurrent = cell.q === currentRoom.q && cell.r === currentRoom.r;
    mapContext.fillStyle = isCurrent ? 'rgba(211,200,178,.2)' : 'rgba(211,200,178,.06)';
    mapContext.fill();
    mapContext.strokeStyle = isCurrent ? '#d3c8b2' : '#8f8778';
    mapContext.stroke();
    const label = rotatePoint(x, y);
    mapContext.lineWidth = 3;
    mapContext.strokeStyle = 'rgba(244,242,236,.95)';
    mapContext.strokeText(cell.tag, label.x, label.y);
    mapContext.fillStyle = '#202020';
    mapContext.fillText(cell.tag, label.x, label.y);
    mapContext.lineWidth = 1;
  }
  const player = rotatePoint(centerX + camera.position.x * screenScale, centerY + camera.position.z * screenScale);
  mapContext.fillStyle = '#f4f2ec';
  mapContext.strokeStyle = '#202020';
  mapContext.lineWidth = 1.5;
  mapContext.beginPath();
  mapContext.arc(player.x, player.y, 4, 0, Math.PI * 2);
  mapContext.fill();
  mapContext.stroke();
}
 
let ready = false;
let locked = false;
let yaw = 0;
let pitch = 0;
const keys = {};
function releasePointerLock() {
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}
function requestPointerLock() {
  if (!ready || document.pointerLockElement === renderer.domElement) return;
  try {
    const request = renderer.domElement.requestPointerLock();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch {
    // A failed pointer lock leaves the visible interface usable.
  }
}
function constrainPlayer() {
  for (let index = 0; index < 6; index++) {
    const basis = wallBasis(index);
    const normalDistance = basis.nx * camera.position.x + basis.nz * camera.position.z;
    const wallLimit = PLAYER_BOUNDARY;
    if (normalDistance <= wallLimit) continue;
    const correction = wallLimit - normalDistance;
    camera.position.x += basis.nx * correction;
    camera.position.z += basis.nz * correction;
  }
}
 
function currentSpines() {
  return roomRegistry.get(roomKey(currentRoom.q, currentRoom.r))?.userData.spines ?? [];
}
let targetedSpine = null;
function volumeInView() {
  raycaster.setFromCamera(centerPointer, camera);
  raycaster.far = INTERACTION_DISTANCE;
  const hit = raycaster.intersectObjects(currentSpines(), false)[0];
  return hit?.object ?? null;
}
function refreshTargetedSpine() {
  targetedSpine = locked ? volumeInView() : null;
  reticle.classList.toggle('target', Boolean(targetedSpine));
}
 
let activeVolume = null;
let currentPage = 1;
let pageRenderVersion = 0;
function columnsForReaderPage() {
  const style = getComputedStyle(bookPage);
  const fontSize = Number.parseFloat(style.fontSize) || 10;
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const usableWidth = Math.max(1, bookPage.clientWidth - padding);
  return Math.min(MAX_PAGE_COLUMNS, Math.max(24, Math.floor(usableWidth / (fontSize * 0.6))));
}
function formatPage(text) {
  const columns = columnsForReaderPage();
  const lines = Array.from(
    { length: Math.ceil(text.length / columns) },
    (_, index) => text.slice(index * columns, index * columns + columns),
  );
  pageFormat.textContent = lines.length + ' lines × ' + columns + ' characters' + (columns === MAX_PAGE_COLUMNS ? '' : ' · adaptive');
  return lines.join('\n');
}
function archiveLocationForPage(page) {
  return { ...activeVolume.location, page };
}
function readerAddressLabel(kind, address) {
  if (address.length <= 180) return address;
  return kind + ' record · ' + address.length + ' characters';
}
function syncReaderAddress(page) {
  let primaryAddress;
  let primaryKind;
  if (activeVolume.kind === 'catalogue') {
    const catalogueAddress = createPageAddressForBookIndex(activeVolume.bookIndex, page);
    if (activeVolume.worldLocation) {
      primaryAddress = createWorldPageAddress({ ...activeVolume.worldLocation, page });
      primaryKind = 'world';
      locationRecord.textContent = 'copy world record';
      catalogueRecord.hidden = false;
      catalogueRecord.textContent = 'copy catalogue record';
      catalogueRecord.dataset.fullAddress = catalogueAddress;
    } else {
      primaryAddress = catalogueAddress;
      primaryKind = 'catalogue';
      locationRecord.textContent = 'copy catalogue record';
      catalogueRecord.hidden = true;
      delete catalogueRecord.dataset.fullAddress;
    }
  } else {
    primaryAddress = createPageAddress(archiveLocationForPage(page));
    primaryKind = 'archive';
    locationRecord.textContent = 'copy archive record';
    catalogueRecord.hidden = true;
    delete catalogueRecord.dataset.fullAddress;
  }
  bookAddress.textContent = readerAddressLabel(primaryKind, primaryAddress);
  bookAddress.title = 'exact ' + primaryKind + ' address';
  bookAddress.dataset.fullAddress = primaryAddress;
  locationRecord.dataset.fullAddress = primaryAddress;
}
function isPageAvailable(page) {
  if (!Number.isInteger(page) || page < 1 || page > PAGES_PER_VOLUME) return false;
  if (activeVolume?.kind === 'catalogue') return true;
  try {
    createPageAddress(archiveLocationForPage(page));
    return true;
  } catch {
    return false;
  }
}
function renderPage() {
  if (!activeVolume) return;
  const renderVersion = ++pageRenderVersion;
  const decoded = activeVolume.kind === 'catalogue'
    ? getPageForBookIndex(activeVolume.bookIndex, currentPage)
    : getPage(archiveLocationForPage(currentPage));
  if (renderVersion !== pageRenderVersion) return;
  pageNumber.textContent = String(currentPage).padStart(3, '0');
  bookPage.textContent = formatPage(decoded);
  syncReaderAddress(currentPage);
  previousPage.disabled = currentPage === 1;
  nextPage.disabled = !isPageAvailable(currentPage + 1);
}
function showCatalogueVolume(bookIndex, initialPage, titleHint = null, worldLocation = null) {
  activeVolume = {
    kind: 'catalogue',
    bookIndex: BigInt(bookIndex),
    worldLocation: worldLocation ? { ...worldLocation, page: 1 } : null,
  };
  currentPage = initialPage ?? initialPageForBookIndex(activeVolume.bookIndex);
  bookPanel.classList.add('visible');
  intro.classList.add('gone');
  releasePointerLock();
  bookTitle.textContent = titleHint || shortSpineTitle(titleForBookIndex(activeVolume.bookIndex));
  renderPage();
}
function showArchiveVolume(location, initialPage = initialPageForVolume(location), titleHint = null) {
  activeVolume = { kind: 'archive', location: { ...location, page: 1 } };
  currentPage = initialPage;
  bookPanel.classList.add('visible');
  intro.classList.add('gone');
  releasePointerLock();
  bookTitle.textContent = titleHint || shortSpineTitle(titleForVolume(activeVolume.location));
  renderPage();
}
function closeBook() {
  bookPanel.classList.remove('visible');
  requestPointerLock();
}
function openBook() {
  const hit = targetedSpine || volumeInView();
  if (!hit) {
    showNotice('aim at a book');
    return;
  }
  showCatalogueVolume(hit.userData.bookIndex, undefined, hit.userData.volumeTitle, hit.userData.worldLocation);
}
async function copyExactRecord(element, copiedText) {
  const address = element.dataset.fullAddress;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    const area = document.createElement('textarea');
    area.value = address;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const previous = element.textContent;
  element.textContent = copiedText;
  setTimeout(() => { element.textContent = previous; }, 1400);
}
 
function openSearch() {
  releasePointerLock();
  intro.classList.add('gone');
  searchPanel.classList.add('visible');
  searchResult.textContent = 'enter lower-case text using letters, spaces, commas, and periods';
  setTimeout(() => searchInput.focus(), 0);
}
function closeSearch() {
  searchPanel.classList.remove('visible');
  requestPointerLock();
}
async function runSearch() {
  const query = searchInput.value;
  if (!query) {
    searchResult.textContent = 'enter a fragment to search';
    return;
  }
  if ([...query].some(char => !ALPHABET.includes(char))) {
    searchResult.textContent = 'use only lower-case letters, spaces, commas, and periods';
    return;
  }
  searchSubmit.disabled = true;
  searchResult.textContent = 'locating an exact volume…';
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const pageAddress = search(query);
    const location = parsePageAddress(pageAddress);
    searchResult.textContent = 'one catalogue occurrence opened';
    showCatalogueVolume(bookIndexFor(location), location.page);
    searchPanel.classList.remove('visible');
  } catch (error) {
    searchResult.textContent = String(error.message).toLowerCase();
  } finally {
    searchSubmit.disabled = false;
  }
}
async function openExactAddress() {
  const candidate = addressInput.value.trim();
  if (!candidate) {
    searchResult.textContent = 'enter a full v3 or w1 page address';
    return;
  }
  if (candidate.length > MAX_CLIENT_ADDRESS_LENGTH) {
    searchResult.textContent = 'record is too long for this client';
    return;
  }
  try {
    if (candidate.startsWith(WORLD_ALGORITHM_VERSION + ';')) {
      if (candidate.split(';').length === 2) {
        const worldRoom = parseWorldRoomAddress(candidate);
        moveToWorldHex(worldRoom.q, worldRoom.r);
        searchResult.textContent = 'world room opened';
        closeSearch();
        showNotice('world room opened');
        return;
      }
      const worldLocation = parseWorldPageAddress(candidate);
      const bookIndex = catalogBookIndexFor(worldLocation);
      moveToWorldHex(worldLocation.q, worldLocation.r);
      showCatalogueVolume(bookIndex, worldLocation.page, null, worldLocation);
    } else {
      const location = parsePageAddress(candidate);
      showCatalogueVolume(bookIndexFor(location), location.page);
    }
    searchResult.textContent = 'exact record opened';
    searchPanel.classList.remove('visible');
  } catch {
    searchResult.textContent = 'enter a valid full v3 or w1 page address';
  }
}
function moveToWorldHex(q, r) {
  currentRoom = { q: BigInt(q), r: BigInt(r) };
  camera.position.set(0, 1.65, 0);
  yaw = 0;
  pitch = 0;
  targetedSpine = null;
  refreshCatalogueView();
  refreshWorld();
  drawMap();
}
 
let audio;
let gain;
let audioOn = false;
function startAudio() {
  if (audio) return;
  audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const filter = audio.createBiquadFilter();
  gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 48;
  filter.type = 'lowpass';
  filter.frequency.value = 150;
  gain.gain.value = 0.025;
  oscillator.connect(filter).connect(gain).connect(audio.destination);
  oscillator.start();
  audioOn = true;
  soundElement.textContent = 'sound: ambient';
}
function toggleAudio() {
  if (!audio) return;
  audioOn = !audioOn;
  gain.gain.setTargetAtTime(audioOn ? 0.025 : 0, audio.currentTime, 0.03);
  soundElement.textContent = audioOn ? 'sound: ambient' : 'sound: muted';
}
 
startButton.addEventListener('click', () => {
  requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  intro.classList.toggle('gone', locked || bookPanel.classList.contains('visible') || searchPanel.classList.contains('visible'));
  reticle.style.display = locked ? 'block' : 'none';
  if (!locked) {
    targetedSpine = null;
    reticle.classList.remove('target');
  }
  if (locked) startAudio();
});
document.addEventListener('pointerlockerror', () => {
  locked = false;
  reticle.style.display = 'none';
  if (!bookPanel.classList.contains('visible') && !searchPanel.classList.contains('visible')) intro.classList.remove('gone');
});
document.addEventListener('mousemove', event => {
  if (!locked) return;
  yaw -= event.movementX * 0.0021;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0021, -1.35, 1.35);
});
addEventListener('keydown', event => {
  if (event.code === 'Escape' && searchPanel.classList.contains('visible')) {
    closeSearch();
    return;
  }
  if (event.code === 'KeyE' && locked) openBook();
  if (event.code === 'KeyF' && locked) openSearch();
  if (event.code === 'KeyM') toggleAudio();
  keys[event.code] = true;
});
addEventListener('keyup', event => { keys[event.code] = false; });
searchButton.addEventListener('click', openSearch);
closeSearchButton.addEventListener('click', closeSearch);
searchSubmit.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });
addressSubmit.addEventListener('click', openExactAddress);
addressInput.addEventListener('keydown', event => { if (event.key === 'Enter') openExactAddress(); });
closeBookButton.addEventListener('click', closeBook);
locationRecord.addEventListener('click', () => copyExactRecord(locationRecord, 'record copied'));
locationRecord.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    copyExactRecord(locationRecord, 'record copied');
  }
});
catalogueRecord.addEventListener('click', () => copyExactRecord(catalogueRecord, 'record copied'));
catalogueRecord.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    copyExactRecord(catalogueRecord, 'record copied');
  }
});
function clearPointerFocus(event) {
  if (event.detail > 0) event.currentTarget.blur();
}
cellElement.addEventListener('click', event => {
  copyExactRecord(cellElement, 'room copied');
  clearPointerFocus(event);
});
 
previousPage.addEventListener('click', event => {
  if (currentPage > 1) { currentPage--; renderPage(); }
  clearPointerFocus(event);
});
nextPage.addEventListener('click', event => {
  if (isPageAvailable(currentPage + 1)) { currentPage++; renderPage(); }
  clearPointerFocus(event);
});
 
let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (locked && ready) {
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 5.5 : 2.6) * delta;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.KeyW) camera.position.addScaledVector(forward, speed);
    if (keys.KeyS) camera.position.addScaledVector(forward, -speed);
    if (keys.KeyA) camera.position.addScaledVector(right, -speed);
    if (keys.KeyD) camera.position.addScaledVector(right, speed);
    constrainPlayer();
  }
  refreshTargetedSpine();
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  drawMap();
  renderer.render(scene, camera);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  resizeMapCanvas();
  if (bookPanel.classList.contains('visible')) renderPage();
  drawMap();
});
 
async function initializeLibrary() {
  startButton.disabled = true;
  setStartupState('building chamber…');
  try {
    currentRoom = { q: 0n, r: 0n };
    refreshCatalogueView();
    refreshWorld();
    camera.position.set(0, 1.65, 5.2);
    resizeMapCanvas();
    drawMap();
    ready = true;
    startButton.disabled = false;
    setStartupState('ready');
  } catch (error) {
    console.error(error);
    setStartupState('library unavailable', true);
    showNotice('library unavailable');
  }
}
 
initializeLibrary();
requestAnimationFrame(animate);
 
