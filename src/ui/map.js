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
  for (const cell of world.mapCells) {
    const delta = axialMapOffset(cell.q - world.room.q, cell.r - world.room.r);
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
    const isCurrent = cell.q === world.room.q && cell.r === world.room.r;
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
