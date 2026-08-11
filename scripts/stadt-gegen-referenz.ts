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
import type { BBox, Gelaende, Ring } from '../shared/domain/types.ts';

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
/** Eine Flaeche zaehlt, wenn ihr erster Stuetzpunkt im Rechteck liegt — dieselbe
 *  Regel fuer beide Seiten, also vergleichbar. */
const ringDrin = (ring: Ring | undefined): boolean => Boolean(ring?.length && drin(ring[0][0], ring[0][1]));

interface Zaehlung {
  flaechen: Map<string, number>;
  punkte: Map<string, number>;
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
  const plus = (m: Map<string, number>, s: string) => m.set(s, (m.get(s) ?? 0) + 1);
  for (const f of g.flaechen ?? []) if (ringDrin(f.polygon)) plus(z.flaechen, f.art);
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
  for (const l of g.linien ?? []) if (l.achse?.length && drin(l.achse[0][0], l.achse[0][1])) plus(z.linien, l.art);
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
  console.log(`  ${'Klasse'.padEnd(24)} ${'Referenz'.padStart(9)} ${'Stadt'.padStart(9)}   Befund`);
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
    console.log(`  ${k.padEnd(24)} ${String(x).padStart(9)} ${String(y).padStart(9)}${befund}`);
  }
  console.log('');
}

// Was der Auftraggeber ausdruecklich weggelassen haben wollte — ein Fehlen ist
// hier das gewuenschte Ergebnis, kein Mangel.
const MOEBEL = new Set(['bank', 'brunnen', 'fahrradstaender', 'laterne', 'papierkorb', 'trinkwasser']);

tabelle('FLAECHEN', zr.flaechen, zs.flaechen, new Set());
tabelle('PUNKTOBJEKTE', zr.punkte, zs.punkte, MOEBEL);
tabelle('LINIENOBJEKTE', zr.linien, zs.linien, new Set());
tabelle('DACHFORMEN', zr.dach, zs.dach, new Set());

console.log(`GEBAEUDE   Referenz ${zr.gebaeude}   Stadt ${zs.gebaeude}`);
console.log(
  `BAEUME     Referenz ${zr.baumMitMass} gemessen / ${zr.baumOhneMass} geschaetzt   ` +
    `Stadt ${zs.baumMitMass} gemessen / ${zs.baumOhneMass} geschaetzt`,
);
console.log(
  `\nBEFUND: ${schlechter} Klassen schlechter, ${besser} Klassen besser. ` +
    (schlechter === 0 ? 'Das Stadtmodell ist auf diesem Fleck nicht schlechter als das Pilotgebiet.' : 'Die schlechteren Klassen sind oben mit „<<" markiert.'),
);
