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
// Which walls carry shelves is no longer fixed: it turns with the level, and
// the placement decides it. Only the count is constant, and it is the count
// that keeps a room at 640 volumes.
export const SHELVED_WALLS_PER_ROOM = 4;

// The two walls without shelves carry the doorways, and which two those are
// turns with the level. See world-engine.js: on one level alone a walker can
// never leave their corridor, so the axis rotates as you climb.
export const DOOR_WIDTH = 2.4;
export const DOOR_HEIGHT = 3.05;
export const DOOR_HALF_WIDTH = DOOR_WIDTH / 2;
export const WALL_THICKNESS = 0.2;
// The free walls are built deep, so a doorway is a short passage to walk
// through rather than a hole to step over — the narrow hallway the story puts
// between one gallery and the next.
export const DOOR_WALL_THICKNESS = 1.2;
// The extra depth is taken outward, never inward. Centred on the apothem like
// a plain wall, a doorway this deep stood half a unit proud of its neighbours,
// and at a hex corner that half unit has nowhere to go: it rode out in front of
// the cabinet on the wall beside it. Pushed out by this much instead, both
// walls share one inner face, the corner closes exactly, and the depth grows
// into the space between chambers, which is empty and belongs to the passage.
export const DOOR_WALL_OFFSET = (DOOR_WALL_THICKNESS - WALL_THICKNESS) / 2;

// --- the passage -------------------------------------------------------------
// Behind each doorway is a passage, and a passage is not in the hex plane: its
// length moves no chamber and takes no room on the map. That is why it may be
// this long while the hexes stay exactly as adjacent as they were, and it is
// what makes room for the two side openings that reach the flanking chambers.
// See src/world/passage.js for the topology this geometry serves.
export const HALL_LENGTH = 15;
export const HALL_HALF_WIDTH = DOOR_HALF_WIDTH;
// The mouth of the passage: where the chamber's own deep doorway ends. The
// doorway begins flush with the room's other walls and is built outward from
// there, so its outer face — and with it the passage — stands this far out.
export const HALL_START = APOTHEM + DOOR_WALL_OFFSET + DOOR_WALL_THICKNESS / 2;
export const HALL_END = HALL_START + HALL_LENGTH;
export const HALL_SIDE_CENTRE = HALL_LENGTH / 2;
export const HALL_SIDE_HALF = DOOR_HALF_WIDTH;
// The side openings are arms of the same corridor, not recesses in its wall.
// A passage is a junction of four chambers and it should look like one: from
// the crossing at its middle every way on is the same length, and only what is
// written over each says where it goes. The crossing is HALL_SIDE_CENTRE from
// either end of the passage, so each arm reaches exactly that far sideways.
export const ALCOVE_DEPTH = HALL_SIDE_CENTRE - HALL_HALF_WIDTH;
// Every way out of a passage is cut lower than the passage itself, so that each
// carries a lintel. That band is the only surface in a passage wide enough and
// square enough to write on, and a walker standing at the junction needs to be
// told which chamber each of the three onward ways leads to. See world/signs.js.
export const HALL_OPENING_HEIGHT = 2.5;
export const HALL_LINTEL_HEIGHT = DOOR_HEIGHT - HALL_OPENING_HEIGHT;
// The far end has no wall to lower, so it gets a beam across it instead.
export const HALL_TRANSOM_DEPTH = 0.18;
export const ALCOVE_REACH = HALL_HALF_WIDTH + ALCOVE_DEPTH;
// The far end of a side arm, where the chamber's own doorway begins — the same
// place, and the same margin, at which the way ahead hands a walker over.
export const SIDE_EXIT_REACH = ALCOVE_REACH + 0.05;
// Both ends of a passage carry their own doorway rather than sharing one, so
// two chambers on the corridor axis stand this far apart when drawn: a passage
// between two mouths, and a mouth is HALL_START from each centre. Only when
// drawn: on the map and in the placement they are still exactly neighbours.
export const CHAMBER_STEP = 2 * HALL_START + HALL_LENGTH;

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
