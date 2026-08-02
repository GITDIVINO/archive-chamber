/**
 * Fixed dimensions of the rendered chamber.
 *
 * These describe the visual interpretation only.  The catalogue and placement
 * contracts live in babel-v3.js and world-engine.js and are frozen separately.
 */

export const ROOM_RADIUS = 8.9;
export const APOTHEM = ROOM_RADIUS * Math.cos(Math.PI / 6);
export const WALL_WIDTH = 9.04;
export const WALL_HEIGHT = 4.8;
export const PLAYER_BOUNDARY = 6.45;
export const INTERACTION_DISTANCE = 2.2;
export const MAX_PAGE_COLUMNS = 80;

// The longest address this client can itself produce is a v3 search record of
// ~3900 characters.  Parsing is synchronous BigInt work whose cost grows
// superlinearly with the room index, so the field is bounded at roughly twice
// that: a 1.6M-character room index froze the main thread for 2.6 seconds.
export const MAX_CLIENT_ADDRESS_LENGTH = 8192;

export const CABINET_WIDTH = WALL_WIDTH - 1.6;
export const CABINET_POST_WIDTH = 0.14;
export const BOOK_WALL_INDICES = Object.freeze([0, 1, 3, 4]);
export const BOOK_WALLS = new Set(BOOK_WALL_INDICES);

export const BOOK_HEIGHT = 0.66;
export const BOOK_WIDTH = 0.19;
export const BOOK_STEP = 0.22;
// Depth of a volume as it recedes into the shelf. Kept well above BOOK_WIDTH
// so the volume reads as a book lying spine-out on the shelf rather than a
// square-section post; BOOK_FRONT_Z anchors the visible spine face.
export const BOOK_DEPTH = 0.4;
export const BOOK_FRONT_Z = -0.35;

export const SPINE_WIDTH = 0.17;
export const SPINE_HEIGHT = 0.62;
// A 2048 atlas holds 224 spines at the same cell resolution a 1024 atlas gave
// 56, so one room needs three atlases instead of twelve.  Every spine sharing
// an atlas is merged into a single geometry, making each atlas one draw call.
export const SPINE_ATLAS_SIZE = 2048;
export const SPINE_CELL_WIDTH = 72;
export const SPINE_CELL_HEIGHT = 256;
export const SPINE_ATLAS_COLUMNS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_WIDTH);
export const SPINE_ATLAS_ROWS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_HEIGHT);
export const SPINES_PER_ATLAS = SPINE_ATLAS_COLUMNS * SPINE_ATLAS_ROWS;
