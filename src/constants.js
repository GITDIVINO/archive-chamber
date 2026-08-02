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
export const PLAYER_RADIUS = 0.28;
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

// The two walls without shelves carry the doorways.  A wall index is also its
// axial direction, so these are neighbours [-1,+1] and [+1,-1] — exact
// opposites.  Walking therefore travels a line of rooms; every other hex stays
// reachable by address.  Doors cannot move to a book wall without deleting
// volumes, and 640 volumes per room is a frozen w1 contract.
export const DOOR_WALL_INDICES = Object.freeze([2, 5]);
export const DOOR_WALLS = new Set(DOOR_WALL_INDICES);
export const DOOR_WIDTH = 2.4;
export const DOOR_HEIGHT = 3.05;
export const DOOR_HALF_WIDTH = DOOR_WIDTH / 2;
export const WALL_THICKNESS = 0.2;

// Sized so that a cabinet of five shelves stands on the floor and still ends
// below the player's reach: at the old height the top shelf sat 2.63 away from
// the eye, past INTERACTION_DISTANCE, and could never be opened.
export const BOOK_HEIGHT = 0.46;
export const SHELF_BASE_Y = 0.26;
export const SHELF_PITCH = 0.66;
export const BOOK_WIDTH = 0.19;
export const BOOK_STEP = 0.22;
// Depth of a volume as it recedes into the shelf. Kept well above BOOK_WIDTH
// so the volume reads as a book lying spine-out on the shelf rather than a
// square-section post; BOOK_FRONT_Z anchors the visible spine face.
export const BOOK_DEPTH = 0.4;
export const BOOK_FRONT_Z = -0.35;

export const SPINE_WIDTH = 0.17;
export const SPINE_HEIGHT = 0.42;
// A 2048 atlas holds 224 spines at the same cell resolution a 1024 atlas gave
// 56, so one room needs three atlases instead of twelve.  Every spine sharing
// an atlas is merged into a single geometry, making each atlas one draw call.
export const SPINE_ATLAS_SIZE = 2048;
export const SPINE_CELL_WIDTH = 72;
// Kept proportional to the spine quad so the rotated label is not squashed.
export const SPINE_CELL_HEIGHT = 176;
export const SPINE_ATLAS_COLUMNS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_WIDTH);
export const SPINE_ATLAS_ROWS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_HEIGHT);
export const SPINES_PER_ATLAS = SPINE_ATLAS_COLUMNS * SPINE_ATLAS_ROWS;
