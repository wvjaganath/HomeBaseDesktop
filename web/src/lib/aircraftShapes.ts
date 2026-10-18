/**
 * Top-view aircraft silhouettes for the radar maps, picked by ICAO type
 * designator (adsb.lol's `t`, e.g. C172, B738, B744, A388, EC35) and, when
 * the type is unknown, by the ADS-B emitter category the aircraft broadcasts
 * (A1 light … A5 heavy, A7 rotorcraft, B1 glider …).
 *
 * The shapes are HomeBase's own, drawn on a 64×64 grid with the nose up and
 * the centre at (32, 32). Each is built from half an outline mirrored across
 * the centre line, plus engines/rotors, as one Path2D (one fill per plane).
 */

export type ShapeClass =
  | 'light'
  | 'turboprop'
  | 'bizjet'
  | 'regional'
  | 'narrow'
  | 'wide'
  | 'quad'
  | 'heli'
  | 'glider'
  | 'fighter'
  | 'balloon'
  | 'ground';

type Pt = [number, number];

/** Right half of an outline, nose to tail on the centre line; mirrored to x' = 64 − x. */
function mirrored(half: Pt[]): string {
  const left = [...half].reverse().map(([x, y]): Pt => [64 - x, y]);
  const all = [...half, ...left];
  return `M${all.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}
const rect = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h${-w}Z`;
/**
 * An ellipse as a path (two arcs). Every part winds clockwise, like the
 * outlines, so overlaps (an engine under a wing) fill instead of cutting holes.
 */
const ellipse = (cx: number, cy: number, rx: number, ry: number): string =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 1 ${rx * 2} 0a${rx} ${ry} 0 1 1 ${-rx * 2} 0Z`;
/** The same part on both sides of the centre line. */
const pair = (make: (x: number) => string, x: number): string => make(x) + make(64 - x);

const PATHS: Record<ShapeClass, string> = {
  // Single piston, high wing (Cessna 172 and friends): straight wing, short body, prop.
  light: mirrored([
    [32, 9],
    [33.6, 11],
    [33.6, 21],
    [61, 21],
    [61, 28],
    [33.6, 28],
    [33, 47],
    [43, 47],
    [43, 52],
    [32.6, 52],
    [32, 53],
  ]) + rect(26, 7.6, 12, 1.8),

  // Twin turboprop (ATR, Dash 8, King Air): straight wing, nacelles forward of the wing.
  turboprop: mirrored([
    [32, 5],
    [33.8, 8],
    [34, 24],
    [62, 25],
    [62, 30],
    [34, 31],
    [33.6, 53],
    [44, 55],
    [44, 59],
    [32.8, 58],
    [32, 60],
  ]) + pair((x) => rect(x - 1.8, 17, 3.6, 13), 43) + pair((x) => rect(x - 4, 16, 8, 1.4), 43),

  // Business jet: swept wing, engines on the rear fuselage, T-tail.
  bizjet: mirrored([
    [32, 6],
    [33.6, 9],
    [33.8, 25],
    [56, 38],
    [56, 41],
    [33.8, 35],
    [33.6, 50],
    [43, 57],
    [43, 60],
    [32.6, 59],
    [32, 61],
  ]) + pair((x) => ellipse(x, 46, 2.2, 5), 37.2),

  // Regional / rear-engine jet (CRJ, ERJ-145, MD-80, 717).
  regional: mirrored([
    [32, 3],
    [33.4, 6],
    [33.6, 24],
    [58, 37],
    [58, 40],
    [33.6, 33],
    [33.4, 52],
    [43, 58],
    [43, 61],
    [32.6, 60],
    [32, 62],
  ]) + pair((x) => ellipse(x, 46, 2, 5), 36.6),

  // Narrow-body twin (737, A320, 757, E-Jets): swept wing, an engine under each wing.
  narrow: mirrored([
    [32, 3],
    [33.6, 6],
    [34, 24],
    [61, 39],
    [61, 43],
    [34, 35],
    [33.8, 52],
    [45, 58],
    [45, 61],
    [33, 59.5],
    [32, 61.5],
  ]) + pair((x) => ellipse(x, 32, 2.2, 4.2), 44),

  // Wide-body twin (777, 787, A330, A350): wider body, bigger engines.
  wide: mirrored([
    [32, 2],
    [34.2, 5],
    [34.8, 23],
    [62, 39],
    [62, 43.5],
    [34.8, 35],
    [34.4, 52],
    [47, 58],
    [47, 61.5],
    [33.4, 60],
    [32, 62],
  ]) + pair((x) => ellipse(x, 31.6, 3, 5.2), 45),

  // Four engines (747, A380, A340, C-17).
  quad: mirrored([
    [32, 2],
    [34.6, 5],
    [35, 22],
    [62.5, 38],
    [62.5, 42.5],
    [35, 34],
    [34.6, 52],
    [47, 58],
    [47, 61.5],
    [33.4, 60],
    [32, 62],
  ]) + pair((x) => ellipse(x, 29.6, 2.6, 4.6), 43) + pair((x) => ellipse(x, 35.6, 2.4, 4.2), 53.5),

  // Helicopter: rotor blades, cabin, tail boom, tail rotor.
  heli:
    ellipse(32, 29, 6, 9.5) +
    rect(31, 37, 2, 20) +
    rect(27.5, 55, 9, 2) +
    // Main rotor: two blades as thin bars crossing over the cabin.
    `M13.4 12.6l2.8-2.8 34.4 34.4-2.8 2.8Z` +
    `M47.8 9.8l2.8 2.8-34.4 34.4-2.8-2.8Z`,

  // Glider: very long thin wings, slim body.
  glider: mirrored([
    [32, 10],
    [33.2, 12],
    [33.2, 25.6],
    [63, 26.6],
    [63, 29.4],
    [33.2, 30.4],
    [32.8, 52],
    [40, 53],
    [40, 55.5],
    [32.4, 55.5],
    [32, 57],
  ]),

  // Fast jet: delta.
  fighter: mirrored([
    [32, 3],
    [33.6, 10],
    [34, 26],
    [55, 46],
    [55, 50],
    [36, 49],
    [41, 56],
    [41, 59],
    [33, 58],
    [32, 60],
  ]),

  balloon: ellipse(32, 32, 11, 11),
  ground: 'M24 24h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V26a2 2 0 0 1 2-2Z',
};

/** Drawn size in CSS pixels (the 64-unit grid is scaled to this). */
export const SHAPE_SIZE: Record<ShapeClass, number> = {
  light: 22,
  glider: 26,
  heli: 24,
  turboprop: 25,
  bizjet: 22,
  fighter: 22,
  regional: 25,
  narrow: 28,
  wide: 34,
  quad: 38,
  balloon: 14,
  ground: 12,
};

// --- type designators -------------------------------------------------------
// Explicit lists for the common types; prefixes for whole families.

const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const QUAD = set(`B741 B742 B743 B744 B748 B74D B74R B74S BLCF A388 A342 A343 A345 A346 A124 A225 IL76 IL86 IL96
  C17 C5 C5M K35R K35E KC35 E3CF E3TF E6 B52 C130 C30J A400 P3 AN12 AN70 VC10 B703 DC8 BA46 RJ70 RJ85 RJ1H DHC7`);
const WIDE = set(`B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X A306 A30B A310 A332 A333 A337 A338 A339
  A359 A35K MD11 DC10 L101 IL62 K46 KC10 KC46`);
const NARROW = set(`B731 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM B752 B753 A318 A319 A320 A321 A19N
  A20N A21N BCS1 BCS3 E170 E175 E75L E75S E190 E195 E290 E295 C919 MC23 SU95 T204 B461 B462 B463`);
const REGIONAL = set(`CRJ1 CRJ2 CRJ7 CRJ9 CRJX E135 E145 E35L E45X MD81 MD82 MD83 MD87 MD88 MD90 B712 B721 B722 DC91 DC93
  DC95 F70 F100 F28 YK42 T134`);
const BIZJET = set(`GLF2 GLF3 GLF4 GLF5 GLF6 GL5T GL6T GL7T GL8T GLEX GALX G150 G200 G280 CL30 CL35 CL60 C25A C25B C25C C25M
  C500 C501 C510 C525 C526 C550 C551 C55B C560 C56X C650 C680 C68A C700 C750 E50P E55P E545 E550 LJ23 LJ24 LJ25 LJ31
  LJ35 LJ40 LJ45 LJ55 LJ60 LJ70 LJ75 FA10 FA20 FA50 FA5X FA6X FA7X FA8X F2TH F900 H25A H25B H25C HDJT PC24 PRM1 BE40
  SF50 EA50 ASTR WW24 J328`);
const TURBOPROP = set(`DH8A DH8B DH8C DH8D AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 SF34 SB20 JS31 JS32 JS41 E120 D228 D328
  B190 BE20 BE30 BE9L BE9T BE10 B350 BE58 BE55 BE60 BE76 BE95 PA23 PA27 PA30 PA31 PA34 PA44 PAY1 PAY2 PAY3 PAY4 C303
  C310 C320 C335 C340 C402 C404 C414 C421 C425 C441 DHC6 L410 AN26 AN24 AN28 AN32 CN35 C295 SW3 SW4 MU2 P68 DA42
  DA62 AC90 AC95 BN2P TBM7 TBM8 TBM9`);
const LIGHT = set(`C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C206 C207 C208 C210 C77R P28A P28B P28R P28T P32R
  P32T P46T PA18 PA22 PA24 PA28 PA32 PA38 PA46 SR20 SR22 SR2T DA20 DA40 DA50 BE23 BE24 BE33 BE35 BE36 M20P M20T M20
  PC12 PC6 PC7 PC9 PC21 AA5 RV4 RV6 RV7 RV8 RV9 RV10 RV12 RV14 GLAS COL3 COL4 TB20 TB21 TOBA J3 CH60 AT3 A210 KODI
  G115 TECN S22T DV20 EV97 ULAC AN2 T6 DR40 RF6 Z42 CP10 HUSK L8 C82R`);
const HELI = set(`EC20 EC25 EC30 EC35 EC45 EC55 EC75 EC120 EC130 EC135 EC145 EC155 EC175 EC225 H125 H130 H135 H145 H155
  H160 H175 H215 H225 AS32 AS35 AS50 AS55 AS65 AS3B B06 B06T B105 B212 B222 B230 B407 B412 B427 B429 B430 B505 B525
  S61 S64 S70 S76 S92 H60 UH1 UH60 MH60 CH47 H47 H53 H64 AH64 A109 A119 A129 A139 A149 A169 A189 AW09 R22 R44 R66
  MD52 MD60 MD5 EXPL NH90 K226 MI8 MI17 MI24 KA32 CABR G2CA HUCO`);
const FIGHTER = set(`F16 F15 F18 F18S F14 F22 F35 EUFI RFAL TOR MIR2 J10 J20 F5 T38 T7 HAWK M346 L39 L159 A4 MG29 SU27
  SU30 SU35 GRIF JAS39 A37 F4 F117 B1 B2 AJET`);
const GLIDER = set(`GLID ASK21 ASW27 DG1T DG80 LS8 DUOD ARCP JANU ASH25 ASW20 DISC VENT`);

/** Which silhouette to draw for an aircraft. */
export function shapeFor(type: string, category: string): ShapeClass {
  const t = type.trim().toUpperCase();
  if (t) {
    if (HELI.has(t)) return 'heli';
    if (QUAD.has(t)) return 'quad';
    if (WIDE.has(t)) return 'wide';
    if (NARROW.has(t)) return 'narrow';
    if (REGIONAL.has(t)) return 'regional';
    if (BIZJET.has(t)) return 'bizjet';
    if (TURBOPROP.has(t)) return 'turboprop';
    if (LIGHT.has(t)) return 'light';
    if (FIGHTER.has(t)) return 'fighter';
    if (GLIDER.has(t)) return 'glider';
    // Families by prefix.
    if (/^(B74|A38|A34)/.test(t)) return 'quad';
    if (/^(B76|B77|B78|A33|A35)/.test(t)) return 'wide';
    if (/^(B73|B3[789X]M?|A3[12]|A2[01]N|E1[79]|E2[09])/.test(t)) return 'narrow';
    if (/^(CRJ|E13|E14|MD8|MD9)/.test(t)) return 'regional';
    if (/^(GLF|CL[36]|C25|C5[0-6]|C6|C7|LJ|FA|F9|H25)/.test(t)) return 'bizjet';
    if (/^(DH8|AT[4-7]|BE[0-9]|PA3|C3|C4)/.test(t)) return 'turboprop';
    if (/^(C1[5-8]|C2[01]|P28|PA[1-4]|SR2|DA[24]|M20|RV)/.test(t)) return 'light';
    if (/^(EC|AS[3-6]|H1[2-7]|B[0-5]0[5-9]?|S[679]|R[246]|A1[0-9]9)/.test(t)) return 'heli';
  }
  switch (category.toUpperCase()) {
    case 'A1':
      return 'light';
    case 'A2':
      return 'bizjet';
    case 'A3':
    case 'A4':
      return 'narrow';
    case 'A5':
      return 'wide';
    case 'A6':
      return 'fighter';
    case 'A7':
      return 'heli';
    case 'B1':
      return 'glider';
    case 'B2':
      return 'balloon';
    case 'C1':
    case 'C2':
    case 'C3':
      return 'ground';
    default:
      return 'narrow';
  }
}

const cache = new Map<ShapeClass, Path2D>();
/** The Path2D for a class (built once). */
export function shapePath(c: ShapeClass): Path2D {
  let p = cache.get(c);
  if (!p) {
    p = new Path2D(PATHS[c]);
    cache.set(c, p);
  }
  return p;
}

/** SVG path data, for legends drawn in markup. */
export const shapeSvg = (c: ShapeClass): string => PATHS[c];
