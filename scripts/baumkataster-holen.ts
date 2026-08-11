/**
 * HOLT DAS AMTLICHE 3D-BAUMKATASTER DER STADT DARMSTADT — fuer die GANZE Stadt.
 *
 * WARUM ES DAS BRAUCHT (Befund 11.08.2026, beim Stadtausbau):
 * Der Zwischenspeicher enthielt 1.690 Baeume auf 1,2 km2 — den Ausschnitt, der
 * fuer das Pilotgebiet am Grossen Woog einmal von Hand gezogen wurde. Das
 * Stadtgebiet hat 122 km2. Auf 99 % der Flaeche haette das Stadtmodell also
 * nur OSM-Baeume gehabt: geschaetzte Klassenhoehen statt gemessener, und im
 * Pilotgebiet kennt OSM nachweislich nur rund ein Viertel der Baeume.
 *
 * Das waere genau die stille Qualitaetsminderung, die der Auftraggeber
 * ausgeschlossen hat („in der Qualitaet wie wir sie jetzt haben, nicht
 * schlechter"). Der Kachelbaum des Dienstes deckt E 472000–484000,
 * N 5516000–5534000 ab — die ganze Stadt. Es fehlte kein Datum, es fehlte ein
 * Skript.
 *
 * WAS GELESEN WIRD: 3D Tiles, Instanzen-Format i3dm. Je Kachel stehen im
 * Feature-Table ein Bezugspunkt (RTC_CENTER, erdfest kartesisch) und je Baum
 * ein Versatz dazu (POSITION) sowie SCALE_NON_UNIFORM. Aus x/z wird der
 * Kronendurchmesser in Metern, aus y die Hoehe (Faktor 1,5, am
 * Attributdienst nachgemessen — siehe server/geodata/baumkataster.ts).
 *
 * ZEILENFORMAT (unveraendert wie bisher, damit der Leser nichts merkt):
 *   [E, N, z, SkalaX, SkalaY, SkalaZ, JWT, Laubart?]
 * Die Laubart steht NICHT in den Kacheln — sie kommt aus einem Nachlauf gegen
 * die Attribut-API. Baeume ohne Laubart bleiben ohne; erfunden wird nichts.
 *
 * LIZENZ: Nachnutzung mit Namensnennung (Stadt Darmstadt / Vermessungsamt);
 * ein formales Open-Data-Label fehlt weiterhin. Quellenvermerk ist Pflicht.
 *
 * Aufruf: node scripts/baumkataster-holen.ts [--nurzaehlen]
 */

import fs from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';

const BASIS = 'https://3d.darmstadt.de/static/tiles/942da2a0-5b49-4130-8f19-0666dbae7864_6';
const ZIEL = path.join('data', 'cache', 'baumkataster', 'darmstadt_stadtbaeume.json');
const nurZaehlen = process.argv.includes('--nurzaehlen');

// Erdfest kartesisch (WGS84) -> ETRS89 / UTM 32N. proj4 rechnet den
// Geozentrik-Fall direkt; eine eigene Umkehrung der Ellipsoidformel waere eine
// vermeidbare Fehlerquelle.
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const ECEF = '+proj=geocent +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
const nachUtm32 = proj4(ECEF, 'EPSG:25832');

async function holeJson(pfad: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASIS}/${pfad}`, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`${pfad}: HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

interface Knoten {
  content?: { uri?: string };
  children?: Knoten[];
}

/** Alle Inhalts-Verweise eines Kachelbaums, in der Reihenfolge des Baums. */
function inhalte(wurzel: Knoten): string[] {
  const out: string[] = [];
  const gehe = (x: Knoten) => {
    if (x.content?.uri) out.push(x.content.uri);
    for (const c of x.children ?? []) gehe(c);
  };
  gehe(wurzel);
  return out;
}

/** Steigt in die Unter-Kachelbaeume ab und sammelt alle i3dm-Dateien. */
async function alleI3dm(): Promise<string[]> {
  const dateien: string[] = [];
  const besucht = new Set<string>();
  const gehe = async (pfad: string): Promise<void> => {
    if (besucht.has(pfad)) return;
    besucht.add(pfad);
    const t = (await holeJson(pfad)) as { root: Knoten };
    const basis = pfad.includes('/') ? pfad.slice(0, pfad.lastIndexOf('/') + 1) : '';
    for (const u of inhalte(t.root)) {
      const voll = basis + u;
      if (u.endsWith('.json')) await gehe(voll);
      else if (u.endsWith('.i3dm')) dateien.push(voll);
    }
  };
  await gehe('tileset.json');
  return dateien;
}

type Zeile = [number, number, number, number, number, number, string, string?];

/**
 * Zerlegt eine i3dm-Kachel.
 *
 * Der Kopf ist 32 Byte: Kennung, Fassung, Gesamtlaenge, dann vier Laengen
 * (Feature-Table JSON/binaer, Batch-Table JSON/binaer) und das glTF-Format.
 * Danach folgen die Bloecke in genau dieser Reihenfolge.
 */
function i3dmLesen(buf: Buffer, datei: string): Zeile[] {
  if (buf.toString('ascii', 0, 4) !== 'i3dm') throw new Error(`${datei}: keine i3dm-Kachel.`);
  const ftJson = buf.readUInt32LE(12);
  const ftBin = buf.readUInt32LE(16);
  const btJson = buf.readUInt32LE(20);
  const ft = JSON.parse(buf.toString('utf8', 32, 32 + ftJson)) as {
    INSTANCES_LENGTH: number;
    RTC_CENTER?: { byteOffset: number };
    POSITION?: { byteOffset: number };
    SCALE_NON_UNIFORM?: { byteOffset: number };
  };
  const anzahl = ft.INSTANCES_LENGTH;
  if (!anzahl) return [];
  // ABWEISEN statt raten: POSITION_QUANTIZED oder fehlende Skalen wuerden
  // stillschweigend falsche Baeume ergeben.
  if (!ft.POSITION || !ft.RTC_CENTER || !ft.SCALE_NON_UNIFORM) {
    throw new Error(`${datei}: Feature-Table ohne RTC_CENTER/POSITION/SCALE_NON_UNIFORM — dieser Leser kann sie nicht deuten (${JSON.stringify(Object.keys(ft))}).`);
  }
  const binVon = 32 + ftJson;
  const rtcX = buf.readFloatLE(binVon + ft.RTC_CENTER.byteOffset);
  const rtcY = buf.readFloatLE(binVon + ft.RTC_CENTER.byteOffset + 4);
  const rtcZ = buf.readFloatLE(binVon + ft.RTC_CENTER.byteOffset + 8);

  // Der Bezugspunkt kommt als 32-Bit-Gleitkomma und traegt damit auf
  // Erdradius-Groesse nur rund 0,5 m Aufloesung. Das ist die Bauart des
  // Formats, nicht ein Fehler des Lesers: die Genauigkeit steckt in den
  // Versaetzen. Der Punkt wird darum aus dem Kachelnamen NICHT korrigiert —
  // eine Korrektur waere eine Annahme. Die Streuung wird am Ende gemessen.
  const posVon = binVon + ft.POSITION.byteOffset;
  const sclVon = binVon + ft.SCALE_NON_UNIFORM.byteOffset;
  const btVon = binVon + ftBin;
  let tokens: string[] = [];
  if (btJson) {
    const bt = JSON.parse(buf.toString('utf8', btVon, btVon + btJson)) as { _token?: string[] };
    tokens = bt._token ?? [];
  }

  const zeilen: Zeile[] = [];
  for (let i = 0; i < anzahl; i++) {
    const x = rtcX + buf.readFloatLE(posVon + i * 12);
    const y = rtcY + buf.readFloatLE(posVon + i * 12 + 4);
    const z = rtcZ + buf.readFloatLE(posVon + i * 12 + 8);
    const sx = buf.readFloatLE(sclVon + i * 12);
    const sy = buf.readFloatLE(sclVon + i * 12 + 4);
    const sz = buf.readFloatLE(sclVon + i * 12 + 8);
    const [e, n, h] = nachUtm32.forward([x, y, z]) as [number, number, number];
    zeilen.push([
      Math.round(e * 100) / 100,
      Math.round(n * 100) / 100,
      Math.round(h * 100) / 100,
      Math.round(sx * 100) / 100,
      Math.round(sy * 100) / 100,
      Math.round(sz * 100) / 100,
      tokens[i] ?? '',
    ]);
  }
  return zeilen;
}

// --- Lauf --------------------------------------------------------------------

console.log(`Kachelbaum wird durchlaufen: ${BASIS}`);
const dateien = await alleI3dm();
console.log(`${dateien.length} i3dm-Kacheln gefunden.`);
if (nurZaehlen) process.exit(0);

const alle: Zeile[] = [];
let fehler = 0;
let geladen = 0;
for (const d of dateien) {
  try {
    const r = await fetch(`${BASIS}/${d}`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    alle.push(...i3dmLesen(buf, d));
    geladen++;
    if (geladen % 10 === 0 || geladen === dateien.length) {
      console.log(`  ${geladen}/${dateien.length} Kacheln, ${alle.length.toLocaleString('de-DE')} Baeume`);
    }
  } catch (e) {
    fehler++;
    console.log(`  FEHLER ${d}: ${(e as Error).message}`);
  }
}

if (fehler) {
  // Ein unvollstaendiges Kataster ueber ein vollstaendiges zu schreiben, waere
  // ein stiller Rueckschritt — lieber gar nichts als heimlich weniger.
  console.error(`\n${fehler} von ${dateien.length} Kacheln nicht lesbar. Es wird NICHTS geschrieben, damit kein unvollstaendiges Kataster das bisherige ueberschreibt.`);
  process.exit(1);
}

// --- Doppelte entfernen ------------------------------------------------------
// Der Kachelbaum hat mehrere Aufloesungsstufen; derselbe Baum kann in mehr als
// einer Kachel stehen. Kennzeichen ist der JWT; wo er fehlt, entscheidet die
// Lage auf den Zentimeter.
const gesehen = new Set<string>();
const eindeutig: Zeile[] = [];
for (const z of alle) {
  const k = z[6] || `${z[0]}|${z[1]}`;
  if (gesehen.has(k)) continue;
  gesehen.add(k);
  eindeutig.push(z);
}

// --- Laubart aus dem bisherigen Bestand uebernehmen --------------------------
// Sie steht nicht in den Kacheln, sondern kam aus einem Nachlauf gegen die
// Attribut-API. Was frueher schon bestimmt wurde, geht nicht verloren; der
// Rest bleibt ehrlich ohne Angabe.
let mitArt = 0;
if (fs.existsSync(ZIEL)) {
  const alt = JSON.parse(fs.readFileSync(ZIEL, 'utf8')) as Zeile[];
  const artNach = new Map<string, string>();
  for (const z of alt) if (z[6] && z[7]) artNach.set(z[6], z[7]);
  for (const z of eindeutig) {
    const a = artNach.get(z[6]);
    if (a) {
      z[7] = a;
      mitArt++;
    }
  }
  console.log(`\nBisheriger Bestand: ${alt.length.toLocaleString('de-DE')} Baeume, davon ${artNach.size.toLocaleString('de-DE')} mit bestimmter Laubart.`);
}

// --- Ausdehnung messen -------------------------------------------------------
let minE = Infinity;
let minN = Infinity;
let maxE = -Infinity;
let maxN = -Infinity;
for (const z of eindeutig) {
  if (z[0] < minE) minE = z[0];
  if (z[0] > maxE) maxE = z[0];
  if (z[1] < minN) minN = z[1];
  if (z[1] > maxN) maxN = z[1];
}

fs.mkdirSync(path.dirname(ZIEL), { recursive: true });
fs.writeFileSync(ZIEL, JSON.stringify(eindeutig));
console.log(`\n${eindeutig.length.toLocaleString('de-DE')} Baeume geschrieben nach ${ZIEL}`);
console.log(`  ${alle.length - eindeutig.length} Doppelte entfernt (mehrere Aufloesungsstufen im Kachelbaum).`);
console.log(`  ${mitArt.toLocaleString('de-DE')} mit uebernommener Laubart, ${(eindeutig.length - mitArt).toLocaleString('de-DE')} ohne Angabe.`);
console.log(`  Ausdehnung E ${minE.toFixed(0)}–${maxE.toFixed(0)}, N ${minN.toFixed(0)}–${maxN.toFixed(0)}` + ` = ${(((maxE - minE) * (maxN - minN)) / 1e6).toFixed(0)} km2`);
console.log('\nDie Stadtkacheln muessen danach NEU gebaut werden — Katasterbaeume werden beim Import zugeordnet.');
