/**
 * Baut ein Gelaende fuer ein BELIEBIGES Rechteck — ohne Konfigurationsdatei.
 *
 * WOFUER: `gelaende:heinerfest` baut immer dasselbe Pilotgebiet. Fuer die
 * Abnahme („Ein Import ueber den Grossen Woog liefert dort Baeume — oder das
 * Protokoll sagt ausdruecklich, warum nicht") und fuer jede Ausweitung braucht
 * es einen Weg, ein anderes Gebiet zu bestellen, ohne Programmtext zu aendern.
 *
 * Aufruf:
 *   node scripts/gelaende-gebiet.ts <minE> <minN> <maxE> <maxN> "<Name>" [--ohne-luftbild]
 * Beispiel (Grosser Woog, Darmstadt):
 *   node scripts/gelaende-gebiet.ts 475800 5524200 476800 5525000 "Grosser Woog"
 */

import { initStore, nutzer, organisationen } from '../server/lib/store.ts';
import { importStarten, auftrag } from '../server/geodata/gelaende.ts';

initStore();

const [minE, minN, maxE, maxN] = process.argv.slice(2, 6).map(Number);
const name = process.argv[6] ?? 'Gebiet';
if (![minE, minN, maxE, maxN].every(Number.isFinite)) {
  console.error('Aufruf: node scripts/gelaende-gebiet.ts <minE> <minN> <maxE> <maxN> "<Name>" [--ohne-luftbild]');
  process.exit(1);
}

const veranstalter = organisationen.eines((o) => o.typ === 'veranstalter');
const anleger = veranstalter ? nutzer.eines((n) => n.orgId === veranstalter.id) : undefined;
if (!anleger) {
  console.error('Keine Veranstalter-Organisation gefunden. Bitte zuerst `npm run seed` ausfuehren.');
  process.exit(1);
}

console.log(`Gelaende: ${name}`);
console.log(`Gebiet:   E ${minE}-${maxE}, N ${minN}-${maxN} (EPSG:25832), ${(((maxE - minE) * (maxN - minN)) / 1e6).toFixed(2)} km2`);
console.log('');

const a = importStarten({
  name,
  bbox: { minE, minN, maxE, maxN },
  land: 'hessen',
  kreis: 'Kreisfreie Stadt Darmstadt',
  nutzerId: anleger.id,
  ohneLuftbild: process.argv.includes('--ohne-luftbild'),
});

let gelesen = 0;
const zeiger = setInterval(() => {
  const s = auftrag(a.id)!;
  for (const m of s.meldungen.slice(gelesen)) console.log('  ' + m);
  gelesen = s.meldungen.length;
  if (s.status === 'fertig' || s.status === 'fehler') {
    clearInterval(zeiger);
    console.log('');
    if (s.status === 'fehler') {
      console.error(`Fehlgeschlagen: ${s.fehler}`);
      process.exit(1);
    }
    console.log(`Fertig. Gelaende-ID: ${s.gelaendeId}`);
    process.exit(0);
  }
}, 400);
