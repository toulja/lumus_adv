/**
 * Baut das Heinerfest-Gelaende (Darmstadter Innenstadt) aus amtlichen Daten.
 * Aufruf:  npm run gelaende:heinerfest
 *
 * Quelle der LoD2-Gebaeude:
 *   1. Umgebungsvariable HEINERFEST_LOD2_DATEI (lokale .gml oder .zip)
 *   2. sonst Direktabruf aus dem HVBG-Downloadcenter (159 MB)
 *
 * Der Lauf dauert je nach Quelle einige Minuten — die CityGML-Datei fuer
 * Darmstadt ist entpackt rund 1,6 GB gross und wird streamend gelesen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { initStore, nutzer, organisationen } from '../server/lib/store.ts';
import { importStarten, auftrag } from '../server/geodata/gelaende.ts';
import type { BBox } from '../shared/domain/types.ts';

initStore();

const konfigDatei = path.resolve(process.cwd(), 'config', 'heinerfest.json');
if (!fs.existsSync(konfigDatei)) {
  console.error(`config/heinerfest.json fehlt (${konfigDatei}).`);
  process.exit(1);
}
const konf = JSON.parse(fs.readFileSync(konfigDatei, 'utf8')) as {
  name: string;
  gebietBbox25832: BBox;
  bereiche: { name: string }[];
};

const veranstalter = organisationen.eines((o) => o.typ === 'veranstalter');
const anleger = veranstalter ? nutzer.eines((n) => n.orgId === veranstalter.id) : undefined;
if (!anleger) {
  console.error('Keine Veranstalter-Organisation gefunden. Bitte zuerst `npm run seed` ausfuehren.');
  process.exit(1);
}

const lokal = process.env.HEINERFEST_LOD2_DATEI;
console.log(`Gelaende:      ${konf.name}`);
console.log(`Gebiet:        E ${konf.gebietBbox25832.minE}-${konf.gebietBbox25832.maxE}, N ${konf.gebietBbox25832.minN}-${konf.gebietBbox25832.maxN} (EPSG:25832)`);
console.log(`Groesse:       ${(((konf.gebietBbox25832.maxE - konf.gebietBbox25832.minE) * (konf.gebietBbox25832.maxN - konf.gebietBbox25832.minN)) / 1e6).toFixed(2)} km2`);
console.log(`Bereiche:      ${konf.bereiche.map((b) => b.name).join(', ')}`);
console.log(`LoD2-Quelle:   ${lokal ? `lokale Datei ${lokal}` : 'HVBG-Downloadcenter (Download 159 MB)'}`);
console.log('');

const a = importStarten({
  name: konf.name,
  bbox: konf.gebietBbox25832,
  land: 'hessen',
  kreis: 'Kreisfreie Stadt Darmstadt',
  nutzerId: anleger.id,
  ohneLuftbild: process.argv.includes('--ohne-luftbild'),
});

let letzteMeldung = 0;
const zeiger = setInterval(() => {
  const s = auftrag(a.id)!;
  const neue = s.meldungen.slice(letzteMeldung);
  letzteMeldung = s.meldungen.length;
  for (const m of neue) console.log(`  ${m}`);
  process.stdout.write(`\r  [${'#'.repeat(Math.round(s.fortschritt * 30)).padEnd(30, '.')}] ${(s.fortschritt * 100).toFixed(0)} % — ${s.schritt}          `);
  if (s.status === 'fertig' || s.status === 'fehler') {
    clearInterval(zeiger);
    console.log('');
    if (s.status === 'fehler') {
      console.error(`\nFEHLER: ${s.fehler}`);
      process.exit(1);
    }
    console.log(`\nFertig. Gelaende-ID: ${s.gelaendeId}`);
    process.exit(0);
  }
}, 2000);
