/**
 * RAEUMT UNREFERENZIERTE GELAENDEORDNER AUS `data/gelaende/`.
 *
 * WARUM ES DAS BRAUCHT (Befund des Auftraggebers, 09.08.2026): Jeder
 * Probeimport legt einen vollstaendigen Ordner an — Hoehenraster, Texturkacheln,
 * Flaechen. Nach einem Tag Arbeit lagen 50 davon auf der Platte, zusammen
 * 1,2 GB, und zwei wurden benutzt. Das ist kein Schoenheitsfehler: Wer nach dem
 * „richtigen" Gelaende sucht, findet fuenfzig Kandidaten.
 *
 * WAS ALS REFERENZIERT GILT: Jede Zeichenkette `gel_…` in einer beliebigen
 * `projekt.json`. Bewusst grob — lieber ein Ordner zu viel behalten als einer
 * zu wenig.
 *
 * ES WIRD NICHT GELOESCHT, SONDERN VERSCHOBEN, nach `data/gelaende-abgelegt/`.
 * Ein Import ist teuer (Hoehenmodell, Kacheln, Overpass); ein versehentlich
 * geloeschter Ordner kostet mehr als der Plattenplatz, den er belegt. Wer
 * endgueltig aufraeumen will, loescht diesen einen Ordner von Hand.
 *
 * Aufruf:  node scripts/gelaende-aufraeumen.ts          (zeigt nur an)
 *          node scripts/gelaende-aufraeumen.ts --tun    (verschiebt wirklich)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GELAENDE = join('data', 'gelaende');
const ABGELEGT = join('data', 'gelaende-abgelegt');
const PROJEKTE = join('data', 'projekte');

function groesseMb(ordner: string): number {
  let bytes = 0;
  const gehe = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const voll = join(p, e.name);
      if (e.isDirectory()) gehe(voll);
      else bytes += statSync(voll).size;
    }
  };
  gehe(ordner);
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function referenzierte(): Map<string, string[]> {
  const treffer = new Map<string, string[]>();
  if (!existsSync(PROJEKTE)) return treffer;
  for (const p of readdirSync(PROJEKTE)) {
    const datei = join(PROJEKTE, p, 'projekt.json');
    if (!existsSync(datei)) continue;
    const ids = readFileSync(datei, 'utf8').match(/gel_[a-f0-9]+/g) ?? [];
    for (const id of new Set(ids)) {
      const liste = treffer.get(id);
      if (liste) liste.push(p);
      else treffer.set(id, [p]);
    }
  }
  return treffer;
}

const tun = process.argv.includes('--tun');
const benutzt = referenzierte();
if (!existsSync(GELAENDE)) {
  console.log(`${GELAENDE} gibt es nicht — nichts zu tun.`);
  process.exit(0);
}
const alle = readdirSync(GELAENDE, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

console.log(`${alle.length} Gelaendeordner, ${benutzt.size} davon von Projekten referenziert.\n`);
for (const [id, projekte] of benutzt) {
  console.log(`  BEHALTEN  ${id}  <- ${projekte.join(', ')}${alle.includes(id) ? '' : '  (ORDNER FEHLT!)'}`);
}

const weg = alle.filter((id) => !benutzt.has(id));
let mb = 0;
for (const id of weg) mb += groesseMb(join(GELAENDE, id));
console.log(`\n  ${weg.length} unreferenzierte Ordner, zusammen ${mb.toLocaleString('de-DE')} MB.`);

if (!tun) {
  console.log('\nNichts veraendert. Mit `--tun` werden sie nach data/gelaende-abgelegt/ verschoben.');
  process.exit(0);
}
if (weg.length) {
  mkdirSync(ABGELEGT, { recursive: true });
  for (const id of weg) renameSync(join(GELAENDE, id), join(ABGELEGT, id));
}
console.log(`\n${weg.length} Ordner (${mb.toLocaleString('de-DE')} MB) nach ${ABGELEGT} verschoben.`);
