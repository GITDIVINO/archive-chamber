/**
 * The corner minimap.
 *
 * Redrawing stroked text every frame was pure waste, so the canvas is only
 * repainted when the player actually moved or turned, or the room changed.
 */

import { ROOM_RADIUS } from '../constants.js';
import { camera } from '../core/view.js';
import { player } from '../player.js';
import { planePosition } from '../world/doors.js';
import { axialMapOffset } from '../world/geometry.js';
import { world } from '../world/rooms.js';
import { mapCanvas } from './dom.js';

const mapContext = mapCanvas.getContext('2d');

// A canvas cannot inherit a custom property, so the two ink colours are read
// from the document each time the map is drawn. That is also what carries
// prefers-contrast onto it: before this the map was the one surface the
// high-contrast preference could not reach, and it is the surface with the
// smallest lettering on it.
function ink(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

let needsRedraw = true;
let lastYaw = Number.NaN;
let lastX = Number.NaN;
let lastZ = Number.NaN;

export function invalidateMap() {
  needsRedraw = true;
}

export function resizeMapCanvas() {
  const scale = Math.min(devicePixelRatio, 2);
  const rect = mapCanvas.getBoundingClientRect();
  mapCanvas.width = Math.round(rect.width * scale);
  mapCanvas.height = Math.round(rect.height * scale);
  mapContext.setTransform(scale, 0, 0, scale, 0, 0);
  needsRedraw = true;
}

function drawMap() {
  const currentInk = ink('--ink', '#202020');
  const mutedInk = ink('--muted', '#6f6b63');
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
    const angle = -player.yaw;
    const dx = x - centerX;
    const dy = y - centerY;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return { x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
  };
  const screenScale = radius / ROOM_RADIUS;
  const placed = world.mapCells.map(cell => {
    const delta = axialMapOffset(cell.q - world.room.q, cell.r - world.room.r);
    return {
      cell,
      x: centerX + delta.x * screenScale,
      y: centerY + delta.z * screenScale,
      isCurrent: cell.q === world.room.q && cell.r === world.room.r,
    };
  });

  // Every hex first, then every tag. Drawing each cell complete meant the next
  // cell's outline cut across the tag already written in the last one, which is
  // the only reason the tags used to be haloed in paper white to stay legible.
  for (const { x, y, isCurrent } of placed) {
    mapContext.beginPath();
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3;
      const point = rotatePoint(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      if (index) mapContext.lineTo(point.x, point.y);
      else mapContext.moveTo(point.x, point.y);
    }
    mapContext.closePath();
    mapContext.fillStyle = isCurrent ? 'rgba(211,200,178,.2)' : 'rgba(211,200,178,.06)';
    mapContext.fill();
    mapContext.strokeStyle = isCurrent ? '#d3c8b2' : '#8f8778';
    mapContext.stroke();
  }

  // The walker's place in the plane, not in the passage: fifteen units of
  // corridor are no distance here, so the marker stops against the doorway and
  // waits there. It is drawn under the numbers rather than over them, as an
  // open ring wide enough to enclose one — a filled dot at this size struck the
  // digit out, and the two coincide whenever somebody is set down in a chamber
  // rather than walking into it.
  const stood = planePosition(camera.position, world.room.level);
  const playerPoint = rotatePoint(centerX + stood.x * screenScale, centerY + stood.z * screenScale);
  mapContext.strokeStyle = currentInk;
  mapContext.lineWidth = 1.1;
  mapContext.beginPath();
  mapContext.arc(playerPoint.x, playerPoint.y, 7.5, 0, Math.PI * 2);
  mapContext.stroke();

  // Only chambers the walker has been in carry a number, so the map fills in as
  // they go rather than presenting a wall of hashes none of which they can
  // read. A chamber nobody has entered is left blank: it has no name yet.
  for (const { cell, x, y, isCurrent } of placed) {
    if (cell.ordinal === null) continue;
    const label = rotatePoint(x, y);
    mapContext.fillStyle = isCurrent ? currentInk : mutedInk;
    mapContext.font = (isCurrent ? '700 12px' : '600 10px') + ' "Courier New", monospace';
    mapContext.fillText(String(cell.ordinal), label.x, label.y);
  }
}

export function syncMap() {
  // Keyed on the place in the plane rather than the camera, so a walker in a
  // passage — who is not moving here at all — costs no repaints either.
  const stood = planePosition(camera.position, world.room.level);
  if (!needsRedraw
    && Math.abs(player.yaw - lastYaw) < 0.004
    && Math.abs(stood.x - lastX) < 0.01
    && Math.abs(stood.z - lastZ) < 0.01) return;
  needsRedraw = false;
  lastYaw = player.yaw;
  lastX = stood.x;
  lastZ = stood.z;
  drawMap();
}
