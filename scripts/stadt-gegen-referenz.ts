/**
 * IST DAS STADTMODELL SCHLECHTER ALS DAS PILOTGEBIET? — auf demselben Fleck
 * gemessen, nicht ueber die Kachel gemittelt.
 *
 * WARUM NICHT EINFACH DICHTEN VERGLEICHEN: Der erste Versuch stellte die
 * Merkmalsdichte einer 9-km2-Stadtkachel der des 1,81-km2-Pilotgebiets
 * gegenueber — und fand ueberall weniger. Das bewies gar nichts: Das
 * Pilotgebiet ist die dicht kartierte Mathildenhoehe, die Stadtkachel enthaelt
 * Wald und Felder. Weniger Baenke je km2 kann heissen „schlechter erfasst"
 * oder „dort steht eben nichts".
 *
 * Die einzige Frage, die eine Antwort zulaesst, lautet: Was steht im
 * STADTMODELL an genau der Stelle, an der im PILOTGEBIET etwas steht? Dieses
 * Skript schneidet beide Modelle auf das Rechteck des Pilotgebiets zu und
 * zaehlt dieselben Klassen. Ein Unterschied ist dann ein Unterschied.
 *
 * Aufruf: node scripts/stadt-gegen-referenz.ts <referenz-id> <stadt-id>
 */

import fs from 'node:fs';
import path from 'node:path';
import polygonClipping from 'polygon-clipping';
import type { Gelaende, Punkt, Ring } from '../shared/domain/types.ts';

const [refId, stadtId] = process.argv.slice(2);
if (!refId || !stadtId) {
  console.error('Aufruf: node scripts/stadt-gegen-referenz.ts <referenz-id> <stadt-id>');
  process.exit(1);
}
const lade = (id: string): Gelaende =>
  JSON.parse(fs.readFileSync(path.join('data', 'gelaende', id, 'gelaende.json'), 'utf8')) as Gelaende;

const ref = lade(refId);
const stadt = lade(stadtId);
const R = ref.bbox;

// Das Referenzgebiet muss GANZ in der Stadtkachel liegen, sonst vergleicht man
// wieder Aepfel mit Birnen.
const S = stadt.bbox;
if (R.minE < S.minE || R.maxE > S.maxE || R.minN < S.minN || R.maxN > S.maxN) {
  console.error(
    `Das Referenzgebiet liegt nicht vollstaendig in der Stadtkachel.\n` +
      `  Referenz ${JSON.stringify(R)}\n  Kachel   ${JSON.stringify(S)}\n` +
      `Bitte die Kachel waehlen, die das Referenzgebiet enthaelt.`,
  );
  process.exit(1);
}

const drin = (e: number, n: number): boolean => e >= R.minE && e <= R.maxE && n >= R.minN && n <= R.maxN;
const ringDrin = (ring: Ring | undefined): boolean => Boolean(ring?.length && drin(ring[0][0], ring[0][1]));

/*
 * FLAECHEN WERDEN IN QUADRATMETERN VERGLICHEN, NICHT IN STUECKEN.
 *
 * Der erste Anlauf zaehlte Stuecke und meldete fuer „fahrbahn" 530 gegen 404 —
 * ein scheinbarer Rueckschritt von 24 %. Er war ein Artefakt des Zaehlens: Das
 * Pilotgebiet ist 1,81 km2 gross und SCHNEIDET jede Strasse an seiner Grenze
 * ab; aus einer durchgehenden Strasse werden dort mehrere Stuecke. Die
 * 9-km2-Kachel fuehrt dieselbe Strasse als EIN Stueck, dessen erster
 * Stuetzpunkt womoeglich ausserhalb des Vergleichsrechtecks liegt.
 *
 * Die Frage lautet aber nicht „wie viele Stuecke", sondern „wie viel Flaeche
 * ist erfasst". Darum wird jede Flaeche mit dem Vergleichsrechteck
 * verschnitten und ihr Anteil in m2 aufsummiert. Das ist gegen die
 * Stueckelung unempfindlich und damit die einzige faire Zahl.
 */
const RECHTECK: number[][][] = [[
  [R.minE, R.minN], [R.maxE, R.minN], [R.maxE, R.maxN], [R.minE, R.maxN], [R.minE, R.minN],
]];
function ringFlaeche(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}
/** Flaeche des Teils, der im Vergleichsrechteck liegt (m2). */
function flaecheImRechteck(polygon: Ring, loecher?: Ring[]): number {
  try {
    const mit: number[][][] = [polygon as unknown as number[][], ...((loecher ?? []) as unknown as number[][][])];
    const geschnitten = polygonClipping.intersection([mit] as never, [RECHTECK] as never) as number[][][][];
    let m2 = 0;
    for (const poly of geschnitten) {
      poly.forEach((ring, i) => {
        m2 += i === 0 ? ringFlaeche(ring) : -ringFlaeche(ring);
      });
    }
    return m2;
  } catch {
    // Verschneidung gescheitert (entartete Stuetzpunkte): lieber gar nicht
    // zaehlen als falsch zaehlen — es wird am Ende gemeldet.
    verschnittFehler++;
    return 0;
  }
}
let verschnittFehler = 0;

/** Laenge des Achsenteils im Vergleichsrechteck (m) — dieselbe Ueberlegung. */
function laengeImRechteck(achse: Punkt[]): number {
  let m = 0;
  for (let i = 1; i < achse.length; i++) {
    const a = achse[i - 1];
    const b = achse[i];
    // Grob, aber fuer beide Seiten gleich: der Abschnitt zaehlt, wenn seine
    // Mitte im Rechteck liegt.
    if (!drin((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
    m += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return m;
}

interface Zaehlung {
  /** m2 im Vergleichsrechteck, nicht Stueckzahl. */
  flaechen: Map<string, number>;
  punkte: Map<string, number>;
  /** m im Vergleichsrechteck, nicht Stueckzahl. */
  linien: Map<string, number>;
  dach: Map<string, number>;
  gebaeude: number;
  baumMitMass: number;
  baumOhneMass: number;
}

function zaehle(g: Gelaende): Zaehlung {
  const z: Zaehlung = {
    flaechen: new Map(),
    punkte: new Map(),
    linien: new Map(),
    dach: new Map(),
    gebaeude: 0,
    baumMitMass: 0,
    baumOhneMass: 0,
  };
  const plus = (m: Map<string, number>, s: string, wert = 1) => m.set(s, (m.get(s) ?? 0) + wert);
  for (const f of g.flaechen ?? []) {
    const m2 = flaecheImRechteck(f.polygon, f.loecher);
    if (m2 > 0) plus(z.flaechen, f.art, m2);
  }
  for (const p of g.punkte ?? []) {
    if (!drin(p.pos[0], p.pos[1])) continue;
    plus(z.punkte, p.art);
    if (p.art === 'baum') {
      // Der Unterschied, auf den es ankommt: gemessene Hoehe und Krone
      // (Kataster) gegen Klassenannahme (OSM).
      if (p.gemessen) z.baumMitMass++;
      else z.baumOhneMass++;
    }
  }
  for (const l of g.linien ?? []) {
    const m = laengeImRechteck(l.achse ?? []);
    if (m > 0) plus(z.linien, l.art, m);
  }
  for (const b of g.gebaeude ?? []) {
    if (!ringDrin(b.grundriss)) continue;
    z.gebaeude++;
    plus(z.dach, b.dachform ?? 'ohne');
  }
  return z;
}

const zr = zaehle(ref);
const zs = zaehle(stadt);
const km2 = ((R.maxE - R.minE) * (R.maxN - R.minN)) / 1e6;

console.log(`GLEICHES GEBIET, ZWEI MODELLE — ${km2.toFixed(2)} km2`);
console.log(`  Referenz   ${refId}  „${ref.name}"`);
console.log(`  Stadtmodell ${stadtId}  „${stadt.name}"`);
console.log(`  Ausschnitt E ${R.minE}–${R.maxE}, N ${R.minN}–${R.maxN}\n`);

let schlechter = 0;
let besser = 0;
function tabelle(titel: string, a: Map<string, number>, b: Map<string, number>, erwartetWeg: Set<string>): void {
  const alle = [...new Set([...a.keys(), ...b.keys()])].sort();
  if (!alle.length) return;
  console.log(`${titel}`);
  console.log(`  ${'Klasse'.padEnd(24)} ${'Referenz'.padStart(10)} ${'Stadt'.padStart(10)}   Befund`);
  for (const k of alle) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    let befund = '';
    if (erwartetWeg.has(k)) befund = y === 0 ? '  (auf Anweisung weggelassen)' : '  ACHTUNG: sollte weg sein!';
    else if (x > 0 && y === 0) {
      befund = '  << FEHLT';
      schlechter++;
    } else if (y < x * 0.9) {
      befund = `  << weniger (${((100 * y) / x).toFixed(0)} %)`;
      schlechter++;
    } else if (y > x * 1.1) {
      befund = `  mehr (${((100 * y) / x).toFixed(0)} %)`;
      besser++;
    }
    const z = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('de-DE') : v % 1 === 0 ? String(v) : v.toFixed(1));
    console.log(`  ${k.padEnd(24)} ${z(x).padStart(10)} ${z(y).padStart(10)}${befund}`);
  }
  console.log('');
}

// Was der Auftraggeber ausdruecklich weggelassen haben wollte — ein Fehlen ist
// hier das gewuenschte Ergebnis, kein Mangel.
const MOEBEL = new Set(['bank', 'brunnen', 'fahrradstaender', 'laterne', 'papierkorb', 'trinkwasser']);

tabelle('FLAECHEN — Quadratmeter im Vergleichsrechteck', zr.flaechen, zs.flaechen, new Set());
tabelle('PUNKTOBJEKTE — Stueck', zr.punkte, zs.punkte, MOEBEL);
tabelle('LINIENOBJEKTE — laufende Meter', zr.linien, zs.linien, new Set());
tabelle('DACHFORMEN — Stueck', zr.dach, zs.dach, new Set());
if (verschnittFehler) console.log(`(${verschnittFehler} Flaechen liessen sich nicht verschneiden und blieben ungezaehlt.)
`);

console.log(`GEBAEUDE   Referenz ${zr.gebaeude}   Stadt ${zs.gebaeude}`);
console.log(
  `BAEUME     Referenz ${zr.baumMitMass} gemessen / ${zr.baumOhneMass} geschaetzt   ` +
    `Stadt ${zs.baumMitMass} gemessen / ${zs.baumOhneMass} geschaetzt`,
);
console.log(
  `\nBEFUND: ${schlechter} Klassen schlechter, ${besser} Klassen besser. ` +
    (schlechter === 0 ? 'Das Stadtmodell ist auf diesem Fleck nicht schlechter als das Pilotgebiet.' : 'Die schlechteren Klassen sind oben mit „<<" markiert.'),
);
