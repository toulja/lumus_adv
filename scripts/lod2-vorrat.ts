/**
 * LEGT DEN BAUKOERPER-VORRAT AN — einmal je LoD2-Archiv.
 *
 * WOFUER: Ein Import entpackt heute das ganze Kreisarchiv (Darmstadt: 166 MB
 * ZIP, 1,63 GB CityGML, 74.869 Gebaeudebloecke) und wirft danach weg, was
 * nicht im Zielgebiet liegt. Fuer EINEN Lauf sind das 13 bis 17 Sekunden. Fuer
 * die zwoelf Kacheln eines Stadtlaufs ist es dieselbe Arbeit zwoelfmal.
 *
 * Nach diesem Skript liegt neben dem Archiv eine Zeilendatei mit den fertigen
 * Baukoerpern; jeder weitere Import ist ein Bbox-Filter darueber.
 *
 * Der Vorrat ist KEIN zweiter Datenbestand: Er entsteht aus derselben Datei
 * mit demselben Zerlegeweg (`gebaeudeFuerGebiet` liefert danach exakt
 * dieselben Objekte) und wird von selbst verworfen, sobald das Archiv juenger
 * ist als er.
 *
 * Aufruf:  node scripts/lod2-vorrat.ts [pfad/zum/archiv.zip]
 * Ohne Pfad nimmt es die in config/geodata.hessen.json konfigurierte Datei.
 */

import fs from 'node:fs';
import { initStore } from '../server/lib/store.ts';
import { vorratAnlegen } from '../server/geodata/lod2.ts';

initStore();

const datei = process.argv[2] ?? 'data/cache/lod2/Darmstadt-LoD2.zip';
if (!fs.existsSync(datei)) {
  console.error(`Archiv nicht gefunden: ${datei}`);
  console.error('Aufruf: node scripts/lod2-vorrat.ts [pfad/zum/archiv.zip]');
  process.exit(1);
}

console.log(`Archiv:  ${datei} (${(fs.statSync(datei).size / 1e6).toFixed(0)} MB)`);
console.log('Zerlege einmalig das ganze Archiv — das dauert ein bis zwei Minuten.');
const t0 = Date.now();
let zuletzt = 0;
const r = await vorratAnlegen(datei, (g, mb) => {
  const jetzt = Date.now();
  if (jetzt - zuletzt < 2000) return;
  zuletzt = jetzt;
  console.log(`  ${g.toLocaleString('de-DE')} Baukoerper, ${mb.toFixed(0)} MB gelesen`);
});
console.log('');
console.log(`Vorrat:  ${r.pfad}`);
console.log(`         ${r.anzahl.toLocaleString('de-DE')} Baukoerper, ${(r.bytes / 1e6).toFixed(1)} MB`);
console.log(`Dauer:   ${((Date.now() - t0) / 1000).toFixed(1)} s`);
