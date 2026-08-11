/**
 * GEGENPROBE: liefert der Ortsauszug dasselbe wie die Overpass-API?
 *
 * Ein neuer Datenweg ist wertlos, wenn niemand nachgesehen hat, ob er dasselbe
 * liefert. Im Zwischenspeicher `data/cache/osm/` liegen echte Overpass-
 * Antworten frueherer Laeufe — mit Gebiet, Stand und der Pruefsumme der
 * Abfrage im Dateinamen. Damit laesst sich beides Element fuer Element
 * vergleichen, ohne den Dienst noch einmal zu behelligen.
 *
 * DIE PRUEFSUMME IST DER BEWEIS, DASS DIESELBE FRAGE GESTELLT WURDE: Der
 * Dateiname endet auf `abfrageHash(rumpf)`. Baut dieses Skript den Rumpf neu
 * zusammen und trifft dieselbe Pruefsumme, ist es garantiert dieselbe Abfrage
 * und nicht eine aehnliche.
 *
 * UNTERSCHIEDE SIND ZU ERWARTEN, und zwar aus einem harmlosen Grund: Die
 * gespeicherten Antworten sind Tage alt, der Auszug hat den Stand vom
 * 10.08.2026. OpenStreetMap veraendert sich taeglich. Die Frage ist darum
 * nicht „null Unterschied", sondern: Sind die Unterschiede so klein, wie es
 * ein paar Tage Kartierung erklaeren — und stimmt die GEOMETRIE der Objekte,
 * die es in beiden gibt, auf den Millimeter?
 *
 * Aufruf: node scripts/auszug-gegenprobe.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { initStore } from '../server/lib/store.ts';
import { auszugAbfrage, auszugDatei } from '../server/geodata/osm-auszug.ts';
import { bboxNachWgs } from '../shared/geo/proj.ts';
import type { BBox } from '../shared/domain/types.ts';

initStore();

const CACHE = path.join('data', 'cache', 'osm');

/** Dieselbe Pruefsumme wie in osm.ts (FNV-1a, 32 Bit). */
function abfrageHash(rumpf: string): string {
  let h = 2166136261;
  for (let i = 0; i < rumpf.length; i++) {
    h ^= rumpf.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const ZEBRA_ACHSE_KLASSEN =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|busway)(_link)?$';

/** Die Abfragen dieses Projekts, wortgleich wie in osm.ts / stadtdetails.ts. */
function rumpfFuer(art: string, bbox: BBox): string | null {
  const w = bboxNachWgs(bbox);
  const g = `(${w.minLat},${w.minLon},${w.maxLat},${w.maxLon})`;
  if (art === 'wege') return `[out:json][timeout:60];(way["highway"]${g};);out geom;`;
  if (art === 'flaechen')
    return (
      `[out:json][timeout:60];(` +
      `way["landuse"~"grass|forest|meadow|village_green|recreation_ground|cemetery"]${g};` +
      `way["leisure"~"park|garden|playground|pitch"]${g};` +
      `way["natural"~"water|wood|scrub"]${g};` +
      `way["amenity"="parking"]${g};` +
      `way["area:highway"]${g};` +
      `);out geom;`
    );
  if (art === 'detail_baeume')
    return `[out:json][timeout:60];(node["natural"="tree"]${g};node["natural"="shrub"]${g};way["natural"="tree_row"]${g};);out geom;`;
  if (art === 'detail_gleise') return `[out:json][timeout:60];(way["railway"~"^(tram|rail|light_rail|subway)$"]${g};);out geom;`;
  if (art === 'detail_halte')
    return (
      `[out:json][timeout:60];(` +
      `node["railway"="tram_stop"]${g};` +
      `node["highway"="bus_stop"]${g};` +
      `node["public_transport"~"^(platform|stop_position)$"]${g};` +
      `way["public_transport"~"^(platform|stop_position)$"]${g};` +
      `way["railway"="platform"]${g};` +
      `);out geom;`
    );
  if (art === 'detail_barrieren') return `[out:json][timeout:60];(way["barrier"]${g};node["barrier"="bollard"]${g};);out geom;`;
  if (art === 'detail_moebel')
    return (
      `[out:json][timeout:60];(` +
      `node["amenity"~"^(bench|fountain|drinking_water|waste_basket|bicycle_parking)$"]${g};` +
      `way["amenity"~"^(fountain|bicycle_parking)$"]${g};` +
      `node["highway"="street_lamp"]${g};` +
      `);out geom;`
    );
  if (art === 'detail_ueberwege')
    return (
      `[out:json][timeout:60];(` +
      `node["highway"="crossing"]${g};` +
      `way["footway"="crossing"]${g};` +
      `way["highway"~"${ZEBRA_ACHSE_KLASSEN}"]${g};` +
      `);out geom;`
    );
  if (art === 'detail_zeichen')
    return (
      `[out:json][timeout:60];(` +
      `node["highway"="traffic_signals"]${g};` +
      `node["highway"="stop"]${g};` +
      `node["highway"="give_way"]${g};` +
      `node["traffic_sign"]${g};` +
      `way["highway"~"${ZEBRA_ACHSE_KLASSEN}"]${g};` +
      `);out geom;`
    );
  if (art === 'detail_gebaeude') return `[out:json][timeout:60];(way["building"]${g};);out geom;`;
  return null;
}

interface Element {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  lat?: number;
  lon?: number;
}

const datei = auszugDatei();
if (!datei) {
  console.error('Kein Ortsauszug in data/osm-auszug/ — nichts zu vergleichen.');
  process.exit(1);
}
console.log(`Auszug: ${datei.pfad}, Stand ${datei.stand.toLocaleString('de-DE')}, ${(datei.bytes / 1e6).toFixed(0)} MB\n`);

const dateien = fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((n) => n.endsWith('.json')) : [];
let geprueft = 0;
let uebersprungen = 0;
const zeilen: string[] = [];
let gesamtBeide = 0;
let gesamtNurOverpass = 0;
let gesamtNurAuszug = 0;
let gesamtGeomGleich = 0;
let gesamtGeomAbweichend = 0;
let maxAbweichungM = 0;

for (const name of dateien.sort()) {
  const m = name.match(/^([a-z_]+)_(\d+)_(\d+)_(\d+)_(\d+)(?:_([a-z0-9]+))?\.json$/);
  if (!m) {
    uebersprungen++;
    continue;
  }
  const [, art, e1, n1, e2, n2, hash] = m;
  if (!hash) {
    uebersprungen++; // aeltere Datei noch ohne Pruefsumme im Namen
    continue;
  }
  const bbox: BBox = { minE: Number(e1), minN: Number(n1), maxE: Number(e2), maxN: Number(n2) };
  const rumpf = rumpfFuer(art, bbox);
  if (!rumpf) {
    uebersprungen++;
    continue;
  }
  // DER BEWEIS DER GLEICHHEIT DER FRAGE.
  if (abfrageHash(rumpf) !== hash) {
    zeilen.push(`  ${name}: Pruefsumme ${abfrageHash(rumpf)} != ${hash} — Abfrage hat sich seither geaendert, uebersprungen.`);
    uebersprungen++;
    continue;
  }

  const alt = JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8')) as { stand?: string; elements: Element[] };
  const neu = auszugAbfrage(rumpf, bbox) as unknown as Element[];

  const kA = new Map<string, Element>();
  for (const el of alt.elements) kA.set(`${el.type}${el.id}`, el);
  const kN = new Map<string, Element>();
  for (const el of neu) kN.set(`${el.type}${el.id}`, el);

  let beide = 0;
  let geomGleich = 0;
  let geomAbw = 0;
  let maxAbw = 0;
  for (const [k, a] of kA) {
    const b = kN.get(k);
    if (!b) continue;
    beide++;
    const ga = a.geometry ?? (a.lat !== undefined ? [{ lat: a.lat, lon: a.lon as number }] : []);
    const gb = b.geometry ?? (b.lat !== undefined ? [{ lat: b.lat, lon: b.lon as number }] : []);
    if (ga.length !== gb.length) {
      geomAbw++;
      continue;
    }
    let schlimmster = 0;
    for (let i = 0; i < ga.length; i++) {
      const pa = ga[i];
      const pb = gb[i];
      if (!pa || !pb) {
        if (pa !== pb) schlimmster = Infinity;
        continue;
      }
      // Grob in Meter: 1 Grad Breite = 111,3 km, 1 Grad Laenge bei 49,9 Grad = 71,7 km.
      const d = Math.hypot((pa.lat - pb.lat) * 111_300, (pa.lon - pb.lon) * 71_700);
      if (d > schlimmster) schlimmster = d;
    }
    if (schlimmster <= 0.001) geomGleich++;
    else {
      geomAbw++;
      if (schlimmster > maxAbw) maxAbw = schlimmster;
    }
  }
  const nurA = kA.size - beide;
  const nurN = kN.size - beide;
  gesamtBeide += beide;
  gesamtNurOverpass += nurA;
  gesamtNurAuszug += nurN;
  gesamtGeomGleich += geomGleich;
  gesamtGeomAbweichend += geomAbw;
  if (maxAbw > maxAbweichungM && Number.isFinite(maxAbw)) maxAbweichungM = maxAbw;
  geprueft++;

  const anteil = kA.size ? (100 * beide) / kA.size : 100;
  zeilen.push(
    `  ${art.padEnd(18)} ${((bbox.maxE - bbox.minE) / 1000).toFixed(1)}x${((bbox.maxN - bbox.minN) / 1000).toFixed(1)} km  ` +
      `Overpass ${String(kA.size).padStart(6)}  Auszug ${String(kN.size).padStart(6)}  ` +
      `gemeinsam ${String(beide).padStart(6)} (${anteil.toFixed(1)} %)  ` +
      `nur Overpass ${String(nurA).padStart(4)}  nur Auszug ${String(nurN).padStart(4)}  ` +
      `Geometrie gleich ${geomGleich}/${beide}${maxAbw > 0 ? `, groesste Abweichung ${maxAbw === Infinity ? 'Luecke' : maxAbw.toFixed(3) + ' m'}` : ''}`,
  );
}

console.log(zeilen.join('\n'));
console.log(`\n${geprueft} Abfragen verglichen, ${uebersprungen} uebersprungen (andere Abfrageform oder Datei ohne Pruefsumme).`);
console.log(`Objekte in BEIDEN Quellen:      ${gesamtBeide.toLocaleString('de-DE')}`);
console.log(`  davon Geometrie identisch:    ${gesamtGeomGleich.toLocaleString('de-DE')} (${gesamtBeide ? ((100 * gesamtGeomGleich) / gesamtBeide).toFixed(2) : '—'} %)`);
console.log(`  davon Geometrie abweichend:   ${gesamtGeomAbweichend.toLocaleString('de-DE')}${maxAbweichungM ? `, groesste Abweichung ${maxAbweichungM.toFixed(2)} m` : ''}`);
console.log(`Nur bei Overpass (aelterer Abruf, seither geloescht/geaendert): ${gesamtNurOverpass.toLocaleString('de-DE')}`);
console.log(`Nur im Auszug (seither neu kartiert):                           ${gesamtNurAuszug.toLocaleString('de-DE')}`);
