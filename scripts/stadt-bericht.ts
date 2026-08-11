/**
 * BERICHT UEBER DAS GEBAUTE STADTMODELL — aus den Gelaendedateien, nicht aus
 * dem Gedaechtnis des Laufs.
 *
 * WARUM AUS DEN DATEIEN: Der Stadtlauf meldet, was er zu tun glaubte. Was
 * WIRKLICH auf der Platte liegt, steht in `data/gelaende/*​/gelaende.json`.
 * Nur das zaehlt — ein Lauf kann abbrechen, eine Kachel kann aelter sein als
 * ihr Nachbar, und ein Ordner kann von einem frueheren Versuch stammen.
 *
 * Der Bericht nennt neben den Mengen ausdruecklich die LUECKEN: fehlende
 * Hoehenabdeckung, unvollstaendige Flurstuecke, benutzten Altbestand. Ein
 * Stadtmodell, das nur seine Erfolge zaehlt, ist kein Nachweis.
 *
 * Aufruf: node scripts/stadt-bericht.ts [--stadt Darmstadt]
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Gelaende } from '../shared/domain/types.ts';

const arg = (name: string, standard: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? standard) : standard;
};
const stadt = arg('stadt', 'Darmstadt');
const ORDNER = path.join('data', 'gelaende');

interface Zeile {
  nr: number;
  id: string;
  name: string;
  km2: number;
  gebaeude: number;
  dachEcht: number;
  flaechen: number;
  baeume: number;
  linien: number;
  flurstuecke: number;
  luecken: string[];
  mb: number;
  erstellt: string;
}

function groesseMb(ordner: string): number {
  let bytes = 0;
  const gehe = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const voll = path.join(p, e.name);
      if (e.isDirectory()) gehe(voll);
      else bytes += fs.statSync(voll).size;
    }
  };
  gehe(ordner);
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

const zeilen: Zeile[] = [];
for (const ordner of fs.existsSync(ORDNER) ? fs.readdirSync(ORDNER) : []) {
  const datei = path.join(ORDNER, ordner, 'gelaende.json');
  if (!fs.existsSync(datei)) continue;
  const g = JSON.parse(fs.readFileSync(datei, 'utf8')) as Gelaende;
  const m = /Kachel (\d+)/.exec(g.name ?? '');
  if (!g.name?.startsWith(stadt) || !m) continue;
  const bb = g.bbox;
  zeilen.push({
    nr: Number(m[1]),
    id: ordner,
    name: g.name,
    km2: ((bb.maxE - bb.minE) * (bb.maxN - bb.minN)) / 1e6,
    gebaeude: g.gebaeude?.length ?? 0,
    // „Echte" Dachform = aus LoD2 uebernommen, nicht aus dem Grundriss geraten.
    dachEcht: (g.gebaeude ?? []).filter((b) => b.dachform && b.dachform !== 'flach').length,
    flaechen: g.flaechen?.length ?? 0,
    baeume: (g.punkte ?? []).filter((p) => p.art === 'baum').length,
    linien: g.linien?.length ?? 0,
    flurstuecke: g.flurstuecke?.length ?? 0,
    luecken: (g.datenluecken ?? []).map((d) => `${d.bezeichnung}: ${d.text.slice(0, 90)}`),
    mb: groesseMb(path.join(ORDNER, ordner)),
    erstellt: g.erstelltAm ?? '',
  });
}
zeilen.sort((a, b) => a.nr - b.nr);

if (!zeilen.length) {
  console.log(`Keine Kacheln von „${stadt}" in ${ORDNER} gefunden.`);
  process.exit(0);
}

console.log(`STADTMODELL ${stadt.toUpperCase()} — ${zeilen.length} Kacheln auf der Platte\n`);
console.log('  Nr  Gelaende-ID           km2   Gebaeude  m.Dach  Flaechen  Baeume  Linien  Flurst.     MB');
console.log('  ' + '-'.repeat(97));
for (const z of zeilen) {
  console.log(
    `  ${String(z.nr).padStart(2)}  ${z.id}  ${z.km2.toFixed(0).padStart(3)}  ` +
      `${z.gebaeude.toLocaleString('de-DE').padStart(8)}  ${z.dachEcht.toLocaleString('de-DE').padStart(6)}  ` +
      `${z.flaechen.toLocaleString('de-DE').padStart(8)}  ${z.baeume.toLocaleString('de-DE').padStart(6)}  ` +
      `${z.linien.toLocaleString('de-DE').padStart(6)}  ${z.flurstuecke.toLocaleString('de-DE').padStart(7)}  ` +
      `${z.mb.toFixed(0).padStart(5)}`,
  );
}
const summe = (f: (z: Zeile) => number) => zeilen.reduce((s, z) => s + f(z), 0);
console.log('  ' + '-'.repeat(97));
console.log(
  `  SUMME                        ${summe((z) => z.km2).toFixed(0).padStart(3)}  ` +
    `${summe((z) => z.gebaeude).toLocaleString('de-DE').padStart(8)}  ${summe((z) => z.dachEcht).toLocaleString('de-DE').padStart(6)}  ` +
    `${summe((z) => z.flaechen).toLocaleString('de-DE').padStart(8)}  ${summe((z) => z.baeume).toLocaleString('de-DE').padStart(6)}  ` +
    `${summe((z) => z.linien).toLocaleString('de-DE').padStart(6)}  ${summe((z) => z.flurstuecke).toLocaleString('de-DE').padStart(7)}  ` +
    `${summe((z) => z.mb).toFixed(0).padStart(5)}`,
);

// --- Luecken ---------------------------------------------------------------
console.log('\nDATENLUECKEN (was das Modell NICHT weiss):');
let mitLuecke = 0;
for (const z of zeilen) {
  if (!z.luecken.length) continue;
  mitLuecke++;
  console.log(`  Kachel ${z.nr}:`);
  for (const l of z.luecken) console.log(`    - ${l}`);
}
if (!mitLuecke) console.log('  keine gemeldet.');
else console.log(`  ${mitLuecke} von ${zeilen.length} Kacheln mit gemeldeter Luecke.`);

// --- Vollstaendigkeit gegen den Auftrag ------------------------------------
const nummern = new Set(zeilen.map((z) => z.nr));
const fehlend: number[] = [];
for (let i = 1; i <= Math.max(...nummern); i++) if (!nummern.has(i)) fehlend.push(i);
console.log(
  fehlend.length
    ? `\nFEHLENDE KACHELN: ${fehlend.join(', ')} — erneut bauen mit: node scripts/gelaende-stadt.ts --nur <Nr>`
    : `\nAlle Kacheln 1 bis ${Math.max(...nummern)} liegen vor.`,
);
