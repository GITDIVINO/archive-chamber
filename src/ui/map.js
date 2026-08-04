/**
 * The corner minimap.
 *
 * Redrawing stroked text every frame was pure waste, so the canvas is only
 * repainted when the player actually moved or turned, or the room changed.
 */

import { ROOM_RADIUS } from '../constants.js';
import { camera } from '../core/view.js';
import { player } from '../player.js';
import { axialMapOffset } from '../world/geometry.js';
import { world } from '../world/rooms.js';
import { mapCanvas } from './dom.js';

const mapContext = mapCanvas.getContext('2d');

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

  // Only chambers the walker has been in carry a number, so the map fills in as
  // they go rather than presenting a wall of hashes none of which they can
  // read. A chamber nobody has entered is left blank: it has no name yet.
  for (const { cell, x, y, isCurrent } of placed) {
    if (cell.ordinal === null) continue;
    const label = rotatePoint(x, y);
    mapContext.fillStyle = isCurrent ? '#202020' : '#7d7568';
    mapContext.font = (isCurrent ? '700 12px' : '600 10px') + ' "Courier New", monospace';
    // The player marker sits at their position in the room, which is the middle
    // of the hex whenever they are set down rather than walking in — exactly on
    // top of the one number that matters most. So the current chamber's number
    // is lifted clear of it.
    mapContext.fillText(String(cell.ordinal), label.x, isCurrent ? label.y - radius * 0.5 : label.y);
  }
  const playerPoint = rotatePoint(centerX + camera.position.x * screenScale, centerY + camera.position.z * screenScale);
  mapContext.fillStyle = '#f4f2ec';
  mapContext.strokeStyle = '#202020';
  mapContext.lineWidth = 1.5;
  mapContext.beginPath();
  mapContext.arc(playerPoint.x, playerPoint.y, 4, 0, Math.PI * 2);
  mapContext.fill();
  mapContext.stroke();
}

export function syncMap() {
  if (!needsRedraw
    && Math.abs(player.yaw - lastYaw) < 0.004
    && Math.abs(camera.position.x - lastX) < 0.01
    && Math.abs(camera.position.z - lastZ) < 0.01) return;
  needsRedraw = false;
  lastYaw = player.yaw;
  lastX = camera.position.x;
  lastZ = camera.position.z;
  drawMap();
}
