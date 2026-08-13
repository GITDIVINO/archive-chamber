/**
 * Fixed dimensions of the rendered chamber.
 *
 * These describe the visual interpretation only.  The catalogue and placement
 * contracts live in babel-v3.js and world-engine.js and are frozen separately.
 */

export const ROOM_SCALE = 6;
export const ROOM_RADIUS = 8.9 * ROOM_SCALE;
// The library is built out of smoke-darkened timber and brown plaster.  The
// opening of the well is deliberately darker than a lit surface: it is depth,
// not another panel inserted into the floor.  Earlier versions made both
// colours nearly white to hide seams, which also erased every useful plane.
export const WORLD_SURFACE_COLOR = 0x8b7b70;
export const WORLD_FLOOR_COLOR = 0x57463b;
export const WORLD_CEILING_COLOR = 0x5a5350;
// Brighter than an unlit wall, deliberately. An unlit surface here now sits
// around 0x161311; haze at 0x2e1e12 is above that, so each further plane comes
// up rather than going down and the shaft gains depth instead of losing it.
// Held at near-black the fog only subtracted, and five planes back everything
// merged into one void.
export const WORLD_DISTANCE_COLOR = 0x2e1e12;

// --- the warm palette ---------------------------------------------------------
// Everything a hand touches is wood; everything that holds the building up is
// paper. The distinction is the whole colour scheme: shelves, treads and rails
// are warm because people made and use them, and the shell stays pale because
// it is architecture and was always there.
export const WOOD_COLOR = 0x744a31;
// Rails and newels a shade deeper than the casework, so a handrail crossing a
// cabinet still reads as a separate thing at distance.
export const TRIM_WOOD_COLOR = 0x2b2420;
// All bindings belong to one catalogue and therefore keep one colour.  Their
// lettering is stamped in warm metal rather than printed in black, so it stays
// legible in the pools of lantern light without turning the wall into a white
// checkerboard.
export const BOOK_COLOR = 0x624134;
export const BOOK_LETTER_COLOR = '#dec18a';
// A lantern is the only warm light in the world and the only object that emits
// rather than receives. The globe is painted near its own flame colour so it
// still reads as the source when the pool it casts is washed out by distance.
export const LAMP_GLOBE_COLOR = 0xffd18a;
export const LAMP_LIGHT_COLOR = 0xffad62;
// A pool, not a flood. At 720 the old lamp still delivered 2.8 units at the far
// end of its own range, which is why one lantern washed a whole gallery and
// nothing anywhere had a falloff. Twenty-two gives about one unit at three
// metres and a sixth of that at twelve, so the light has an edge and the dark
// between two lanterns is genuinely dark.
export const LAMP_INTENSITY = 22.0;
// Far enough to wash the wall behind it and reach the treads, short enough that
// two lanterns do not add into a flat field.
export const LAMP_RANGE = 30;
export const LANTERN_HEIGHT = 1.42;
// A reading lamp over a cabinet, not a lantern on a rail: shorter reach, and
// there are twenty of them to a chamber rather than a handful. Sized so that
// its own stretch of shelving is lit and the next lamp's is not, which is what
// gives a wall of books a rhythm of light instead of an even wash.
export const SCONCE_INTENSITY = 7.0;
export const SCONCE_RANGE = 13;
export const APOTHEM = ROOM_RADIUS * Math.cos(Math.PI / 6);
// In a regular hexagon the side length is exactly its circumradius. Deriving
// the wall from the same radius as the floor keeps all six wall endpoints on
// the floor/ceiling corners at every scale.
export const WALL_WIDTH = ROOM_RADIUS;
// Three times what it was. A cabinet is 3.6 and stays 3.6 — a person has to be
// able to reach the top shelf — so tripling the storey does not touch the
// furniture, it opens a tall band of wall above it. That band is what the
// reference has and this did not: the shelving is a low course at the bottom of
// a gallery, and everything above it is height. It also lengthens the flight,
// which spans one storey by definition, so the stair now crosses a real part of
// the shaft instead of a tenth of it.
export const WALL_HEIGHT = 14.4;
// Where a wall lantern hangs. It used to be pinned under the ceiling, which was
// head height when the ceiling was 4.8 and is four storeys of a ladder now. A
// lantern belongs at the height a person could have hung it.
export const WALL_LAMP_HEIGHT = 4.2;
export const PLAYER_BOUNDARY = APOTHEM - 1.25;
export const PLAYER_RADIUS = 0.28;
export const INTERACTION_DISTANCE = 2.2;
export const MAX_PAGE_COLUMNS = 80;

// --- the vertical well ------------------------------------------------------
// A true opening through every floor, centred in the chamber. The guard stands
// just outside its lip, leaving enough stone between the cut and the posts for
// the edge to read as structure rather than a railing floating over nothing.
// The opening occupies seventy percent of the hexagon's area. The inner and
// outer hexagons are similar, so their areas follow the square of their radii:
// a 70% area opening therefore needs sqrt(0.7) of the outer radius.
export const WELL_FLOOR_AREA_RATIO = 0.7;
export const WELL_FLOOR_SPAN_RATIO = Math.sqrt(WELL_FLOOR_AREA_RATIO);
export const WELL_RADIUS = ROOM_RADIUS * WELL_FLOOR_SPAN_RATIO;
export const WELL_GUARD_RADIUS = WELL_RADIUS + 0.32;
export const WELL_GUARD_HEIGHT = 1.03;
export const WELL_POST_WIDTH = 0.095;
export const WELL_RAIL_THICKNESS = 0.085;
export const WELL_BALUSTERS_PER_EDGE = Math.ceil(WELL_GUARD_RADIUS / 0.78);
export const WELL_SLAB_THICKNESS = 0.16;
export const PLAYER_START_DISTANCE = (
  WELL_GUARD_RADIUS * Math.cos(Math.PI / 6) + APOTHEM
) / 2;
// Start beside one of the two exits and face back into the chamber. Beginning
// on a vertex axis made two railing edges cross the whole foreground and hid
// the floor opening; a wall-normal view shows the parallel inner and outer
// hexagons immediately.
export const PLAYER_START_ANGLE = Math.PI / 6 + 5 * Math.PI / 3;
export const PLAYER_START_X = Math.cos(PLAYER_START_ANGLE) * PLAYER_START_DISTANCE;
export const PLAYER_START_Z = Math.sin(PLAYER_START_ANGLE) * PLAYER_START_DISTANCE;
export const PLAYER_START_YAW = Math.atan2(Math.cos(PLAYER_START_ANGLE), Math.sin(PLAYER_START_ANGLE));
export const PLAYER_START_PITCH = -0.12;

// --- the stair ---------------------------------------------------------------
// The only way between floors. Every other thing in a chamber turns with the
// level — which walls carry doorways, which way the corridor runs, which wall
// is numbered one — and the stair does not. It is fixed to the same edge of the
// well on every floor, so that the one thing a walker can steer by is the one
// thing that never moves. That is what makes the well an axis rather than a
// hole.
export const STAIR_WELL_EDGE = 0;
// One flight per storey at exactly 1:2. The well is ninety units across and a
// storey is 4.8, so a stair that used the hexagon would have the slope of a
// ramp; a flight that crosses a short chord of the lip is the only proportion
// that reads as a stair at all. Shallow on purpose: from a hundred metres down
// the shaft this is the sole diagonal in a world built entirely of horizontals
// and verticals, and a steep run would read as a ladder.
export const STAIR_RISE = WALL_HEIGHT;
export const STAIR_RUN = 2 * WALL_HEIGHT;
export const STAIR_HALF_RUN = STAIR_RUN / 2;
export const STAIR_STEPS = 72;
export const STAIR_TREAD = STAIR_RUN / STAIR_STEPS;
export const STAIR_RISER = STAIR_RISE / STAIR_STEPS;
// Narrow against a forty-five unit well on purpose. Like the doorway, the stair
// belongs to the human-scale contract and never derives from ROOM_RADIUS: it is
// a person-sized object in a monumental void, and that contrast is the point.
export const STAIR_WIDTH = 2.4;
// Each step block hangs this far below its own tread. Boxes cannot be raked, so
// the soffit is serrated rather than smooth — which at any distance reads as the
// raking underside of a flight, and up close reads as steps.
export const STAIR_SOFFIT_DEPTH = 0.55;
// The guard is absent along the flight and a little beyond it, because there the
// stair's own balustrade is the guard. A railing carried across a stair would be
// a railing through a stair.
export const STAIR_GUARD_CLEARANCE = 1.5;
export const STAIR_GUARD_HALF_SPAN = STAIR_HALF_RUN + STAIR_GUARD_CLEARANCE;
// How near a walker's eye must be to a tread before it carries them. Wider than
// one riser so that stepping on is forgiving, far narrower than a storey so the
// flight above can never be mistaken for the flight below.
export const STAIR_MOUNT_REACH = 0.6;
export const EYE_HEIGHT = 1.65;

// The longest address this client can itself produce is a v3 search record of
// ~3900 characters.  Parsing is synchronous BigInt work whose cost grows
// superlinearly with the room index, so the field is bounded at roughly twice
// that: a 1.6M-character room index froze the main thread for 2.6 seconds.
export const MAX_CLIENT_ADDRESS_LENGTH = 8192;

export const CABINET_SECTIONS_PER_WALL = 6;
// One wall is one cabinet, but adjacent cabinets must still read as separate
// pieces at a hex corner. A 0.6m setback at either end leaves roughly 0.33m of
// clear air between their actual depth volumes instead of letting them overlap.
export const CABINET_CORNER_CLEARANCE = 0.6;
export const CABINET_RUN_WIDTH = WALL_WIDTH - 2 * CABINET_CORNER_CLEARANCE;
export const CABINET_POST_WIDTH = 0.14;
// Which walls carry shelves is no longer fixed: it turns with the level, and
// the placement decides it. Only the count is constant; six cabinet sections
// on each of those four walls keep a w3 room at 3840 volumes.
export const SHELVED_WALLS_PER_ROOM = 4;

// The two walls without shelves carry the doorways, and which two those are
// turns with the level. See world-engine.js: on one level alone a walker can
// never leave their corridor, so the axis rotates as you climb.
// The room became six times wider to hold six continuous catalogue sections,
// but a walker did not become six times larger with it. Door and passage sizes
// therefore belong to a separate human-scale contract and never derive from
// ROOM_RADIUS. The opening remains visible across the gallery without turning
// the corridor into a low hangar.
export const DOOR_WIDTH = 4.2;
export const DOOR_HEIGHT = 3.6;
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
// length moves no chamber and takes no room on the map. It does, however, need
// enough visual space for a legible crossing. It is deliberately independent
// of ROOM_RADIUS: a passage lives outside the hex plane, so Euclidean distance
// between full room models must not dictate how long a walk through it feels.
export const HALL_HALF_WIDTH = 2.25;
// The mouth of the passage: where the chamber's own deep doorway ends. The
// doorway begins flush with the room's other walls and is built outward from
// there, so its outer face — and with it the passage — stands this far out.
export const HALL_START = APOTHEM + DOOR_WALL_OFFSET + DOOR_WALL_THICKNESS / 2;
export const HALL_LENGTH = 18;
export const HALL_END = HALL_START + HALL_LENGTH;
export const HALL_SIDE_CENTRE = HALL_LENGTH / 2;
// All four mouths of the junction are the same corridor. The former side
// opening reused the narrower 4.2 m doorway and pinched a 4.5 m passage at its
// centre, making left/right views visibly different from ahead/back.
export const HALL_SIDE_HALF = HALL_HALF_WIDTH;
// A raw plus-shaped junction leaves four square blocks only 3.18 m from its
// centre. Seen diagonally they fill most of the frame and read as stray walls.
// Cutting each inner corner keeps the four arms legible without turning the
// human-scale corridor into another monumental chamber.
export const HALL_JUNCTION_CHAMFER = 1.2;
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
export const HALL_OPENING_HEIGHT = 3.15;
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
// At the closest reading distance a spine is smaller than 18 × 44 screen
// pixels. Matching that useful resolution keeps the same 1 288 labels per
// atlas while cutting each GPU upload from 16 MiB to 4 MiB. Atlases are also
// attached one per frame; entering a corridor must never coincide with a
// three-texture upload spike.
export const SPINE_ATLAS_SIZE = 1024;
export const SPINE_CELL_WIDTH = 24;
// Kept proportional to the spine quad so the rotated label is not squashed.
export const SPINE_CELL_HEIGHT = 96;
export const SPINE_ATLAS_COLUMNS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_WIDTH);
export const SPINE_ATLAS_ROWS = Math.floor(SPINE_ATLAS_SIZE / SPINE_CELL_HEIGHT);
export const SPINES_PER_ATLAS = SPINE_ATLAS_COLUMNS * SPINE_ATLAS_ROWS;
