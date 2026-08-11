/**
 * HOLT DEN OSM-ORTSAUSZUG von Geofabrik nach `data/osm-auszug/`.
 *
 * Warum ein Auszug und nicht die Overpass-API: siehe server/geodata/pbf.ts.
 * Kurz — ein Stadtmodell ist ein Massenabruf, und die Nutzungsregeln der
 * Overpass-API weisen Massenabrufe ausdruecklich ab. Der Auszug ist zudem
 * vollstaendig und hat einen FESTEN Stand, ist also wiederholbar.
 *
 * DIE PRUEFSUMME WIRD GEPRUEFT, nicht nur mitgeladen. Ein abgebrochener
 * Download von 343 MB sieht wie eine Datei aus; der Leser wuerde ihn als
 * beschaedigtes Format melden, aber erst nach Minuten und an falscher Stelle.
 *
 * Lizenz: ODbL 1.0, (c) OpenStreetMap-Mitwirkende. Der Quellenvermerk geht
 * ueber gelaende.ts in jeden Quellennachweis.
 *
 * Aufruf: node scripts/osm-auszug-holen.ts [--gebiet europe/germany/hessen]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (name: string, standard: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? standard) : standard;
};

const gebiet = arg('gebiet', 'europe/germany/hessen');
const ordner = path.join('data', 'osm-auszug');
const name = `${gebiet.split('/').pop()}-latest.osm.pbf`;
const ziel = path.join(ordner, name);
const url = `https://download.geofabrik.de/${gebiet}-latest.osm.pbf`;

fs.mkdirSync(ordner, { recursive: true });

console.log(`Hole ${url}`);
const kopf = await fetch(url, { method: 'HEAD', redirect: 'follow' });
const bytes = Number(kopf.headers.get('content-length') ?? 0);
const stand = kopf.headers.get('last-modified') ?? 'unbekannt';
console.log(`  ${(bytes / 1e6).toFixed(0)} MB, Stand ${stand}`);

if (fs.existsSync(ziel) && fs.statSync(ziel).size === bytes) {
  console.log(`  ${ziel} liegt schon in dieser Groesse vor — nichts zu tun.`);
} else {
  const t0 = Date.now();
  const antwort = await fetch(url, { redirect: 'follow' });
  if (!antwort.ok || !antwort.body) throw new Error(`Download gescheitert: HTTP ${antwort.status}`);
  // Erst in eine Nebendatei, dann umbenennen: ein abgebrochener Lauf soll
  // keinen halben Auszug hinterlassen, der wie ein ganzer aussieht.
  const teil = `${ziel}.teil`;
  const strom = fs.createWriteStream(teil);
  let geladen = 0;
  let letzteMeldung = 0;
  for await (const stueck of antwort.body as unknown as AsyncIterable<Uint8Array>) {
    geladen += stueck.length;
    strom.write(stueck);
    if (bytes && geladen - letzteMeldung > 25_000_000) {
      letzteMeldung = geladen;
      console.log(`  ${(geladen / 1e6).toFixed(0)} / ${(bytes / 1e6).toFixed(0)} MB`);
    }
  }
  await new Promise<void>((r) => strom.end(r));
  fs.renameSync(teil, ziel);
  console.log(`  geladen in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// --- Pruefsumme ------------------------------------------------------------
const md5Url = `${url}.md5`;
const md5Antwort = await fetch(md5Url, { redirect: 'follow' });
if (!md5Antwort.ok) {
  console.log(`  ACHTUNG: Pruefsumme ${md5Url} nicht abrufbar (HTTP ${md5Antwort.status}) — Datei UNGEPRUEFT.`);
  process.exit(0);
}
const erwartet = (await md5Antwort.text()).trim().split(/\s+/)[0];
const hash = crypto.createHash('md5');
hash.update(fs.readFileSync(ziel));
const gerechnet = hash.digest('hex');
if (gerechnet !== erwartet) {
  fs.renameSync(ziel, `${ziel}.beschaedigt`);
  throw new Error(`Pruefsumme stimmt NICHT: ${gerechnet} statt ${erwartet}. Die Datei wurde nach ${ziel}.beschaedigt umbenannt.`);
}
console.log(`  Pruefsumme stimmt: ${gerechnet}`);
console.log(`\nFertig: ${ziel}`);
console.log('Der Import benutzt ihn ab sofort automatisch statt der Overpass-API.');
