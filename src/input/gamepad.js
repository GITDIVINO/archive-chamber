/**
 * Gamepad support.
 *
 * Standard-mapping layout: left stick walks, right stick looks, A reads the
 * aimed volume, X opens the catalogue, and the left stick press runs.
 * Controllers are polled per frame rather than event-driven, which is how the
 * Gamepad API is meant to be read.
 */

const DEAD_ZONE = 0.18;
const LOOK_SPEED = 2.6;

const BUTTON_READ = 0;
const BUTTON_BACK = 1;
const BUTTON_CATALOGUE = 2;
const BUTTON_RUN = 10;

const pressed = new Set();

function applyDeadZone(value) {
  if (Math.abs(value) < DEAD_ZONE) return 0;
  // Rescale so the stick still reaches full tilt after the dead zone is cut.
  const scaled = (Math.abs(value) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(value) * scaled * scaled;
}

function activeGamepad() {
  if (typeof navigator.getGamepads !== 'function') return null;
  for (const pad of navigator.getGamepads()) {
    if (pad?.connected && pad.axes.length >= 4) return pad;
  }
  return null;
}

export function isGamepadConnected() {
  return activeGamepad() !== null;
}

/**
 * Reads one frame of gamepad state.  Button fields are edge-triggered so a
 * held button opens the reader once rather than every frame.
 */
export function pollGamepad() {
  const pad = activeGamepad();
  if (!pad) {
    pressed.clear();
    return null;
  }
  const wasPressed = button => {
    const down = Boolean(pad.buttons[button]?.pressed);
    const key = String(button);
    const had = pressed.has(key);
    if (down) pressed.add(key); else pressed.delete(key);
    return down && !had;
  };
  return {
    forward: -applyDeadZone(pad.axes[1]),
    strafe: applyDeadZone(pad.axes[0]),
    lookX: applyDeadZone(pad.axes[2]) * LOOK_SPEED,
    lookY: applyDeadZone(pad.axes[3]) * LOOK_SPEED,
    running: Boolean(pad.buttons[BUTTON_RUN]?.pressed),
    read: wasPressed(BUTTON_READ),
    back: wasPressed(BUTTON_BACK),
    catalogue: wasPressed(BUTTON_CATALOGUE),
  };
}
