/**
 * Zieht Kopfdatei, `bbox4326` und die vorkomprimierte Auslieferung fuer
 * BESTEHENDE Gelaende nach (Stufe B aus docs/PLAN-DARMSTADT.md).
 *
 * WOFUER: Seit dem 16.08.2026 schreibt jeder Import neben `gelaende.json` auch
 * `kopf.json` (die Liste liest nur noch den Kopf) und `gelaende.json.gz` (die
 * Route streamt vorkomprimiert). Gelaende von vorher haben beides nicht.
 *
 * Die Kopfdatei allein zoege sich beim ersten Zugriff selbst nach — das genuegt
 * fuer die Listen. Fuer den schnellen Auslieferungsweg muss aber `bbox4326` IN
 * der grossen Datei stehen, und das heisst: einmal lesen, ergaenzen, neu
 * schreiben. Genau das macht dieses Skript, sichtbar und auf einmal, statt es
 * dem naechsten Nutzer als Wartezeit unterzuschieben.
 *
 * Aufruf:
 *   node scripts/gelaende-koepfe-nachziehen.ts [--trocken]
 */

import fs from 'node:fs';
import path from 'node:path';
import { initStore, gelaende as gelaendeStore } from '../server/lib/store.ts';

initStore();

const trocken = process.argv.includes('--trocken');
const wurzel = path.resolve(process.cwd(), 'data', 'gelaende');
const ordner = fs
  .readdirSync(wurzel)
  .filter((d) => fs.existsSync(path.join(wurzel, d, 'gelaende.json')))
  .sort();

console.log(`${ordner.length} Gelaende gefunden.${trocken ? ' (Trockenlauf)' : ''}`);
console.log('');

let neu = 0;
let schon = 0;
let fehler = 0;

for (const gid of ordner) {
  const datei = path.join(wurzel, gid, 'gelaende.json');
  const mb = (fs.statSync(datei).size / 1048576).toFixed(1);
  const kopfDa = fs.existsSync(path.join(wurzel, gid, 'kopf.json'));
  const gzDa = fs.existsSync(path.join(wurzel, gid, 'gelaende.json.gz'));
  const kopf = kopfDa ? gelaendeStore.kopf(gid) : null;
  if (kopfDa && gzDa && kopf?.hatBbox4326) {
    schon++;
    console.log(`  ${gid}  ${mb.padStart(6)} MB  bereits vollstaendig`);
    continue;
  }
  if (trocken) {
    console.log(`  ${gid}  ${mb.padStart(6)} MB  wuerde nachgezogen`);
    neu++;
    continue;
  }
  const t = Date.now();
  const g = gelaendeStore.laden(gid);
  if (!g) {
    fehler++;
    console.log(`  ${gid}  ${mb.padStart(6)} MB  NICHT LESBAR — uebersprungen`);
    continue;
  }
  // speichern() ergaenzt bbox4326, schreibt kopf.json und gelaende.json.gz.
  gelaendeStore.speichern(g);
  neu++;
  console.log(`  ${gid}  ${mb.padStart(6)} MB  nachgezogen in ${((Date.now() - t) / 1000).toFixed(1)} s — ${g.name}`);
}

console.log('');
console.log(`${neu} nachgezogen, ${schon} waren vollstaendig${fehler ? `, ${fehler} nicht lesbar` : ''}.`);
