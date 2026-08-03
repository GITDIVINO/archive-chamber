/**
 * Pointer lock, movement and aiming.
 *
 * This module owns the primitives only.  Which key opens which panel is wired
 * in main.js, so input never has to import the interface it drives.
 */

import * as THREE from 'three';
import { INTERACTION_DISTANCE } from '../constants.js';
import { camera, renderer } from '../core/view.js';
import { isEngaged, keys, player } from '../player.js';
import { constrainToRoom } from '../world/doors.js';
import { currentBookMeshes, world } from '../world/rooms.js';
import { reticle } from '../ui/dom.js';

const raycaster = new THREE.Raycaster();
const centerPointer = new THREE.Vector2(0, 0);
const forwardVector = new THREE.Vector3();
const rightVector = new THREE.Vector3();

const WALK_SPEED = 2.6;
const RUN_SPEED = 5.5;
const PITCH_LIMIT = 1.35;

let targetedVolume = null;

export function releasePointerLock() {
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

export function requestPointerLock() {
  if (!player.ready || document.pointerLockElement === renderer.domElement) return;
  try {
    const request = renderer.domElement.requestPointerLock();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch {
    // A failed pointer lock leaves the visible interface usable.
  }
}

export function applyLook(deltaX, deltaY, sensitivity = player.lookSensitivity) {
  player.yaw -= deltaX * sensitivity;
  player.pitch = THREE.MathUtils.clamp(player.pitch - deltaY * sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
}

export function movePlayer(delta, forwardAxis, strafeAxis, running) {
  if (forwardAxis === 0 && strafeAxis === 0) return;
  const speed = (running ? RUN_SPEED : WALK_SPEED) * delta;
  forwardVector.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  rightVector.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  camera.position.addScaledVector(forwardVector, forwardAxis * speed);
  camera.position.addScaledVector(rightVector, strafeAxis * speed);
  constrainToRoom(camera.position, world.room.level);
}

export function keyboardAxes() {
  return {
    forward: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    strafe: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    running: Boolean(keys.ShiftLeft || keys.ShiftRight),
  };
}

// Picking runs against the instanced volumes: three.js reports the instanceId,
// which indexes the per-batch record built while the room was assembled.
export function volumeInView() {
  raycaster.setFromCamera(centerPointer, camera);
  raycaster.far = INTERACTION_DISTANCE;
  const hit = raycaster.intersectObjects(currentBookMeshes(), false)[0];
  if (!hit || hit.instanceId === undefined) return null;
  return hit.object.userData.records[hit.instanceId] ?? null;
}

export function refreshTargetedVolume() {
  targetedVolume = isEngaged() ? volumeInView() : null;
  reticle.classList.toggle('target', Boolean(targetedVolume));
}

export function targetedOrAimedVolume() {
  return targetedVolume || volumeInView();
}

export function clearTarget() {
  targetedVolume = null;
  reticle.classList.remove('target');
}
