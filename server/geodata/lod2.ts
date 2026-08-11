/**
 * LoD2-Gebaeudemodelle aus amtlichem CityGML.
 *
 * Die Hessen-Kreisdateien sind gross (Darmstadt: 159 MB gezippt, ca. 1,56 GB
 * CityGML). Deshalb wird STREAMEND gelesen und nur behalten, was im gesuchten
 * Gebiet liegt — es landet nie die ganze Datei im Speicher oder auf der Platte.
 *
 * Zwei Quellen sind moeglich:
 *  a) lokale Datei (.gml oder .zip) ueber HEINERFEST_LOD2_DATEI oder Parameter
 *  b) Direktabruf aus dem HVBG-Downloadcenter (Muster in config/geodata.*.json)
 *
 * Hessen liefert die Hoehen als generische Attribute:
 *   AbsoluteHoehe      = Gelaendehoehe am Gebaeudefuss (m ue. NHN)  <- Basis des Gelaendes
 *   MittlereTraufHoehe = Traufhoehe absolut
 *   Firsthoehe         = Firsthoehe absolut
 * Fehlen sie (andere Laender), werden Traufe und First aus der Dachgeometrie
 * abgeleitet: tiefster bzw. hoechster Dachpunkt.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { XMLParser } from 'fast-xml-parser';
import { Unzip, UnzipInflate } from 'fflate';
import type { BBox, GelaendeGebaeude, Ring } from '../../shared/domain/types.ts';
import { bboxUeberschneidet, bboxVonPunkten, flaeche, ringNormalisieren } from '../../shared/geo/geometry.ts';
import { cache } from '../lib/store.ts';
import { geoKonfig, heuteKompakt } from './konfig.ts';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) =>
    ['boundedBy', 'surfaceMember', 'stringAttribute', 'intAttribute', 'BuildingPart', 'consistsOfBuildingPart'].includes(name),
});

interface Flaeche3D_intern {
  art: 'wand' | 'dach' | 'boden';
  ring: [number, number, number][];
  /**
   * Zu welchem BAUTEIL die Flaeche gehoert. 0 = das Building selbst, ab 1 je
   * `bldg:BuildingPart`. CityGML fuehrt zusammengesetzte Gebaeude (Karrees,
   * Anbauten, Hoefe) als EIN Building mit mehreren BuildingParts — jedes davon
   * hat seinen eigenen Grundriss und oft eigene Hoehen.
   */
  teil: number;
}

function ringAusPolygon(poly: unknown): [number, number, number][] | null {
  const lr = (poly as Record<string, any>)?.exterior?.LinearRing;
  if (!lr) return null;
  const txt = typeof lr.posList === 'object' ? lr.posList?.['#text'] : lr.posList;
  if (!txt) return null;
  const z = String(txt).split(/\s+/).filter(Boolean).map(Number);
  const ring: [number, number, number][] = [];
  for (let i = 0; i + 2 < z.length; i += 3) ring.push([z[i], z[i + 1], z[i + 2]]);
  return ring.length >= 4 ? ring : null;
}

/**
 * Sammelt die Begrenzungsflaechen — GETRENNT NACH BAUTEIL.
 *
 * `zaehler.wert` vergibt fortlaufende Teil-Nummern; jeder BuildingPart bekommt
 * seine eigene. Vorher landeten alle Teile in EINEM Topf, und der Aufrufer
 * behielt nur den groessten Grundriss: im Pilotgebiet gingen so 23,8 % der
 * amtlichen Grundflaeche verloren (555 der 2.563 Gebaeude mehrteilig, dem
 * Luisencenter fehlte ein 52-m-Fluegel). Das war nicht nur Optik — der
 * Grundriss ist die Bezugsflaeche der Regelpruefung (Engstellen, Kollisionen,
 * Mindestabstaende) und aller Exporte.
 */
interface Bauteile {
  flaechen: Flaeche3D_intern[];
  /** Attribute je Teil-Nummer (Hoehen, Dachform koennen je Teil abweichen). */
  attribute: Map<number, Record<string, string>>;
}

function flaechenSammeln(knoten: Record<string, any>, ziel: Bauteile, teil: number, zaehler: { wert: number }) {
  for (const b of knoten.boundedBy ?? []) {
    for (const [schluessel, art] of [
      ['WallSurface', 'wand'],
      ['RoofSurface', 'dach'],
      ['GroundSurface', 'boden'],
    ] as const) {
      const s = b[schluessel];
      if (!s) continue;
      const ms = s.lod2MultiSurface?.MultiSurface;
      for (const sm of ms?.surfaceMember ?? []) {
        const ring = ringAusPolygon(sm.Polygon);
        if (ring) ziel.flaechen.push({ art, ring, teil });
      }
    }
  }
  for (const gruppe of knoten.consistsOfBuildingPart ?? []) {
    for (const p of gruppe.BuildingPart ?? []) {
      zaehler.wert += 1;
      const eigenerTeil = zaehler.wert;
      // Hoehen und Dachform koennen je BuildingPart abweichen (ein
      // Hof-Karree hat pro Fluegel eine eigene Traufe). Fehlt etwas, erbt
      // der Teil spaeter vom Building.
      ziel.attribute.set(eigenerTeil, attribute(p));
      flaechenSammeln(p, ziel, eigenerTeil, zaehler);
    }
  }
}

function attribute(knoten: Record<string, any>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const liste of [knoten.stringAttribute, knoten.intAttribute]) {
    for (const a of liste ?? []) {
      const name = a['@_name'];
      if (name != null) m[name] = typeof a.value === 'object' ? String(a.value?.['#text'] ?? '') : String(a.value ?? '');
    }
  }
  return m;
}

/** Grundriss: bevorzugt die Bodenflaeche, sonst die tiefste (nahezu waagrechte) Flaeche. */
function grundrissAus(flaechen: Flaeche3D_intern[]): Ring | null {
  const boeden = flaechen.filter((f) => f.art === 'boden');
  const kandidaten = boeden.length ? boeden : flaechen;
  let bester: Ring | null = null;
  let besteFlaeche = 0;
  for (const f of kandidaten) {
    const ring2d = ringNormalisieren(f.ring.map((p) => [p[0], p[1]] as [number, number]));
    if (ring2d.length < 3) continue;
    const a = flaeche(ring2d);
    if (a > besteFlaeche) {
      besteFlaeche = a;
      bester = ring2d;
    }
  }
  if (!boeden.length && bester) {
    // Ohne Bodenflaeche: der Umriss aller Wandfusspunkte ist verlaesslicher
    const wandFuss = flaechen
      .filter((f) => f.art === 'wand')
      .flatMap((f) => f.ring)
      .filter((p, _i, alle) => p[2] <= Math.min(...alle.map((q) => q[2])) + 0.4);
    if (wandFuss.length >= 3) {
      const umriss = konvexeHuelle(wandFuss.map((p) => [p[0], p[1]] as [number, number]));
      if (umriss.length >= 3 && flaeche(umriss) > besteFlaeche * 0.6) bester = umriss;
    }
  }
  return bester && besteFlaeche > 0.5 ? bester : null;
}

function konvexeHuelle(punkte: [number, number][]): Ring {
  if (punkte.length < 3) return punkte;
  const p = [...punkte].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const kreuz = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const unten: [number, number][] = [];
  for (const q of p) {
    while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], q) <= 0) unten.pop();
    unten.push(q);
  }
  const oben: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], q) <= 0) oben.pop();
    oben.push(q);
  }
  unten.pop();
  oben.pop();
  return [...unten, ...oben];
}

/** Billiger Vorfilter: liegt im Rohtext des Bloecks ueberhaupt eine Koordinate im Gebiet? */
function grobImGebiet(block: string, bbox: BBox): boolean {
  const m = /<gml:posList[^>]*>([^<]{0,200})/.exec(block);
  if (!m) return false;
  const z = m[1].trim().split(/\s+/).map(Number);
  for (let i = 0; i + 1 < Math.min(z.length, 30); i += 3) {
    const e = z[i];
    const n = z[i + 1];
    if (e >= bbox.minE - 300 && e <= bbox.maxE + 300 && n >= bbox.minN - 300 && n <= bbox.maxN + 300) return true;
  }
  return false;
}

/**
 * Wertet EINEN `<bldg:Building>`-Block aus und liefert je BAUTEIL einen
 * Baukoerper.
 *
 * WARUM JE BAUTEIL (Befund 08.08.2026, an der amtlichen Quelle nachgemessen):
 * 555 der 2.563 Pilot-Gebaeude bestehen aus mehreren BuildingParts (bis zu 24).
 * Vorher wurde je Building EIN Koerper gebildet und davon nur der GROESSTE
 * Grundriss behalten — 107.830 m2 (23,8 %) amtliche Grundflaeche fielen weg.
 * Beim Luisencenter fehlte ein 52 m langer Fluegel. Sichtbar war das kaum,
 * weil die Dach- und Wandflaechen ALLER Teile weiter gezeichnet wurden: das
 * Bild zeigte den Fluegel, der Grundriss kannte ihn nicht. Genau daran haengen
 * aber die Regelpruefung (Engstellen, Kollisionen, Mindestabstaende), die
 * Exporte (Vadere-Hindernisse, GeoJSON, glTF), der Lageplan, die 2D-Karte und
 * der Sockel, der die Fuge zum Gelaende schliesst.
 */
function gebaeudeAusBlock(block: string, bbox: BBox): GelaendeGebaeude[] {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(block) as Record<string, any>;
  } catch {
    return [];
  }
  const b = doc.Building;
  if (!b) return [];
  const bauteile: Bauteile = { flaechen: [], attribute: new Map() };
  flaechenSammeln(b, bauteile, 0, { wert: 0 });
  if (!bauteile.flaechen.length) return [];

  const attrsBau = attribute(b);
  // LAGEZURERD (Lage zur Erdoberflaeche) ist ein amtliches ALKIS-Merkmal:
  // Werte kleiner 0 bezeichnen unterirdische Bauwerke (Tiefgaragen, Tunnel).
  // Die duerfen weder als Hindernis noch als Hoehenstuetzpunkt zaehlen.
  const lageBau = Number(attrsBau.LAGEZURERD);
  if (Number.isFinite(lageBau) && lageBau < 0) return [];

  // Leerstring/fehlend -> undefined. WICHTIG: 0 ist eine LEGITIME Hoehe
  // (NHN-nahe Kuestenlagen) — nur ein leerer oder unlesbarer Attributwert gilt
  // als fehlend, nicht der Zahlenwert 0. Die fruehere Prueferei `n !== 0`
  // haette an der Nord-/Ostseekueste gemessene Hoehen verworfen.
  const zahl = (v: string | undefined) => {
    if (v === undefined || String(v).trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const runde = (f: Flaeche3D_intern): [number, number, number][] =>
    f.ring.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100]);

  const nachTeil = new Map<number, Flaeche3D_intern[]>();
  for (const f of bauteile.flaechen) {
    const liste = nachTeil.get(f.teil);
    if (liste) liste.push(f);
    else nachTeil.set(f.teil, [f]);
  }

  const basisId = String(b['@_id'] ?? attrsBau.ALKISOID ?? '');
  const mehrteilig = nachTeil.size > 1;
  const out: GelaendeGebaeude[] = [];

  for (const [teil, flaechen] of [...nachTeil.entries()].sort((a, b2) => a[0] - b2[0])) {
    const grundriss = grundrissAus(flaechen);
    if (!grundriss) continue;
    const bb = bboxVonPunkten(grundriss);
    if (!bboxUeberschneidet(bb, bbox)) continue;

    // Teil-Attribute schlagen die des Buildings; fehlende erbt der Teil.
    const attrs = { ...attrsBau, ...(bauteile.attribute.get(teil) ?? {}) };
    const lage = Number(attrs.LAGEZURERD);
    if (Number.isFinite(lage) && lage < 0) continue;

    let zMin = Infinity;
    let dachMin = Infinity;
    let dachMax = -Infinity;
    for (const f of flaechen) {
      for (const [, , z] of f.ring) {
        if (z < zMin) zMin = z;
        if (f.art === 'dach') {
          if (z < dachMin) dachMin = z;
          if (z > dachMax) dachMax = z;
        }
      }
    }
    const boden = zahl(attrs.AbsoluteHoehe) ?? (Number.isFinite(zMin) ? zMin : 0);
    const traufe = zahl(attrs.MittlereTraufHoehe) ?? (Number.isFinite(dachMin) ? dachMin : undefined);
    const first = zahl(attrs.Firsthoehe) ?? (Number.isFinite(dachMax) ? dachMax : undefined);

    // Die ECHTEN Flaechen mitnehmen — ohne sie waere jedes Gebaeude ein Quader
    // mit flachem Deckel. Mit ihnen bekommt es seine wirkliche Dachform.
    const dachflaechen = flaechen.filter((f) => f.art === 'dach').map(runde);
    const wandflaechen = flaechen.filter((f) => f.art === 'wand').map(runde);

    // Einteilige Gebaeude behalten ihre bisherige Id — nur mehrteilige
    // bekommen den Teil-Zusatz, damit bestehende Bezuege (Hoehen-Overrides in
    // Projekten) nicht ins Leere laufen.
    const id = mehrteilig
      ? `${basisId || `lod2_${Math.round(bb.minE)}_${Math.round(bb.minN)}`}#${teil}`
      : basisId || `lod2_${Math.round(bb.minE)}_${Math.round(bb.minN)}`;

    out.push({
      id,
      grundriss: grundriss.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
      bodenHoehe: Math.round(boden * 100) / 100,
      traufHoehe: traufe !== undefined ? Math.round(traufe * 100) / 100 : undefined,
      firstHoehe: first !== undefined ? Math.round(first * 100) / 100 : undefined,
      dachform: attrs.Dachtyp_tridicon || undefined,
      funktion: typeof b.function === 'string' ? b.function : undefined,
      quelle: 'lod2',
      dachflaechen: dachflaechen.length ? dachflaechen : undefined,
      wandflaechen: wandflaechen.length ? wandflaechen : undefined,
    });
  }
  return out;
}

/** Liest CityGML aus einem beliebigen Text-Strom und filtert auf das Gebiet. */
export async function ausStrom(
  strom: AsyncIterable<Uint8Array | string>,
  bbox: BBox,
  bericht?: (gefunden: number, gelesenMb: number) => void,
): Promise<GelaendeGebaeude[]> {
  const START = '<bldg:Building ';
  const ENDE = '</bldg:Building>';
  const dekoder = new TextDecoder('utf8');
  const gefunden: GelaendeGebaeude[] = [];
  const gesehen = new Set<string>();
  let puffer = '';
  let bytes = 0;
  let letzterBericht = 0;

  for await (const stueck of strom) {
    bytes += typeof stueck === 'string' ? stueck.length : stueck.byteLength;
    puffer += typeof stueck === 'string' ? stueck : dekoder.decode(stueck, { stream: true });
    for (;;) {
      const s = puffer.indexOf(START);
      if (s < 0) {
        if (puffer.length > 200_000) puffer = puffer.slice(-100_000);
        break;
      }
      const e = puffer.indexOf(ENDE, s);
      if (e < 0) {
        if (s > 0) puffer = puffer.slice(s);
        break;
      }
      const block = puffer.slice(s, e + ENDE.length);
      puffer = puffer.slice(e + ENDE.length);
      if (grobImGebiet(block, bbox)) {
        // Ein Block kann MEHRERE Baukoerper liefern (ein BuildingPart je Teil).
        for (const g of gebaeudeAusBlock(block, bbox)) {
          if (gesehen.has(g.id)) continue;
          gesehen.add(g.id);
          gefunden.push(g);
        }
      }
    }
    if (bericht && bytes - letzterBericht > 50_000_000) {
      letzterBericht = bytes;
      bericht(gefunden.length, Math.round(bytes / 1_000_000));
    }
  }
  return gefunden;
}

/**
 * Uebergabepuffer zwischen fflate-Rueckrufen und async-Iteration — MIT
 * Gegendruck: der Erzeuger wartet, wenn der Verbraucher nicht nachkommt.
 * Ohne diese Bremse laege die entpackte GML am Ende doch komplett im
 * Speicher, nur haeppchenweise angeliefert.
 */
class ByteSchlange {
  private puffer: (Uint8Array | null)[] = [];
  private wecker: (() => void) | null = null;
  private platzWecker: (() => void) | null = null;

  schiebe(d: Uint8Array | null) {
    this.puffer.push(d);
    this.wecker?.();
    this.wecker = null;
  }

  /** Erzeugerseite: warten, bis der Puffer wieder klein ist. */
  async freierPlatz(max: number) {
    while (this.puffer.length > max) {
      await new Promise<void>((r) => (this.platzWecker = r));
      this.platzWecker = null;
    }
  }

  async *stroeme(): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.puffer.length) {
        const d = this.puffer.shift()!;
        this.platzWecker?.();
        this.platzWecker = null;
        if (d === null) return;
        yield d;
        continue;
      }
      await new Promise<void>((r) => (this.wecker = r));
      this.wecker = null;
    }
  }
}

/**
 * Liest die GML-Eintraege eines ZIP-Archivs STREAMEND: das Archiv kommt in
 * 4-MiB-Stuecken von der Platte, jeder Eintrag verlaesst den Entpacker in
 * kleinen Stuecken und geht direkt durch ausStrom().
 *
 * Der fruehere Weg (unzipSync + ein Buffer je Eintrag) konnte fuer Darmstadt
 * NIE funktionieren: die entpackte GML hat 1,56 GB, Buffer.toString() bricht
 * bei Nodes Stringgrenze (~512 MB) mit "Cannot create a string longer than
 * 0x1fffffe8 characters" ab (nachgestellt 08.08.2026).
 */
async function ausZipDatei(
  datei: string,
  bbox: BBox,
  bericht?: (g: number, mb: number) => void,
): Promise<GelaendeGebaeude[]> {
  const gefunden: GelaendeGebaeude[] = [];
  const verbraucher: Promise<void>[] = [];
  let schlange: ByteSchlange | null = null;
  let zipFehler: Error | null = null;

  const entpacker = new Unzip();
  entpacker.register(UnzipInflate);
  entpacker.onfile = (eintrag) => {
    if (!/\.(gml|xml)$/i.test(eintrag.name)) return;
    const s = new ByteSchlange();
    schlange = s;
    eintrag.ondata = (fehler, daten, fertig) => {
      if (fehler) {
        zipFehler = zipFehler ?? fehler;
        s.schiebe(null); // Verbraucher freigeben, sonst wartet er ewig
        return;
      }
      if (daten?.length) s.schiebe(daten);
      if (fertig) s.schiebe(null);
    };
    verbraucher.push(
      ausStrom(s.stroeme(), bbox, bericht).then((teil) => {
        gefunden.push(...teil);
      }),
    );
    eintrag.start();
  };

  const strom = fs.createReadStream(datei, { highWaterMark: 4 * 1024 * 1024 });
  for await (const stueck of strom as AsyncIterable<Buffer>) {
    entpacker.push(new Uint8Array(stueck.buffer, stueck.byteOffset, stueck.byteLength), false);
    if (zipFehler) break;
    // Gegendruck: erst weiterlesen, wenn der Parser aufgeholt hat (~4 MB Puffer)
    if (schlange) await (schlange as ByteSchlange).freierPlatz(64);
  }
  entpacker.push(new Uint8Array(0), true);
  await Promise.all(verbraucher);
  if (zipFehler) throw zipFehler;
  return gefunden;
}

/**
 * ZIP-Download in den Plattencache (data/cache/lod2/) — streamend geschrieben.
 * Der Dateiname kommt aus der URL OHNE das Tagesdatum des Downloadcenter-Pfads,
 * darum trifft ein erneuter Import desselben Kreises den Cache.
 */
async function zipInCache(url: string, userAgent: string): Promise<string> {
  const name = decodeURIComponent(path.basename(new URL(url).pathname)) || 'lod2.zip';
  const ziel = cache.pfad('lod2', name);
  if (fs.existsSync(ziel) && fs.statSync(ziel).size > 1024) return ziel;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok || !res.body) throw new Error(`LoD2-Download fehlgeschlagen: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const tmp = `${ziel}.tmp`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, ziel);
  return ziel;
}

export interface Lod2Quelle {
  art: 'datei' | 'download';
  beschreibung: string;
  url?: string;
  datei?: string;
}

/** Ermittelt die Quelle: lokale Datei hat Vorrang (spart 159 MB Download). */
export function quelleErmitteln(land = 'hessen', kreis?: string): Lod2Quelle | null {
  const lokal = process.env.HEINERFEST_LOD2_DATEI;
  if (lokal && fs.existsSync(lokal)) {
    return { art: 'datei', beschreibung: `Lokale CityGML-Datei ${lokal}`, datei: lokal };
  }
  const k = geoKonfig(land).gebaeude3d;
  const eintrag = kreis ? k.kreise.find((x) => x.name === kreis) : k.kreise[0];
  if (!eintrag) return null;
  const url = k.urlMuster
    .replace('{datum}', heuteKompakt())
    .replace('{kreis}', encodeURIComponent(eintrag.name))
    .replace('{datei}', encodeURIComponent(eintrag.datei));
  return { art: 'download', beschreibung: `HVBG-Downloadcenter, ${eintrag.name}`, url };
}

/**
 * DER BAUKOERPER-VORRAT — dasselbe Archiv nicht zwoelfmal entpacken.
 *
 * WARUM (gemessen 10.08.2026): Das LoD2-Archiv eines Kreises ist EINE Datei;
 * Darmstadt-LoD2.zip hat 166 MB und enthaelt 1,63 GB CityGML mit 74.869
 * Gebaeudebloecken. Jeder Import entpackt sie vollstaendig und wirft danach
 * weg, was nicht im Zielgebiet liegt — fuer 1,81 km2 passierten 8.504 von
 * 74.869 Bloecken den Vorfilter. Bei EINEM Lauf sind das ertragbare 13 bis 17
 * Sekunden Fixkosten. Bei zwoelf Stadtkacheln ist es dieselbe Arbeit zwoelfmal.
 *
 * Der Vorrat zieht die Zerlegung EINMAL vor: 94.793 fertige Baukoerper, je
 * einer als Zeile. Danach ist jeder Lauf ein Bbox-Filter ueber eine Datei
 * statt ein Entpacklauf ueber 1,63 GB.
 *
 * ZEILENWEISE (NDJSON), NICHT EIN GROSSES JSON: 94.793 Koerper ergeben rund
 * 158 MB. Als ein einziger Aufruf von `JSON.stringify` waere das nah an Nodes
 * Zeichenkettengrenze von 536 MB — dieselbe Wand, an der der frueherere
 * Entpackweg schon einmal gestorben ist (Kommentar bei `ausZipDatei`). Zeile
 * fuer Zeile gibt es diese Grenze nicht, und der Filter kann streamen.
 *
 * DER VORRAT IST KEIN ZWEITER DATENBESTAND: Er entsteht aus derselben Datei
 * mit demselben Zerlegeweg und wird verworfen, sobald das Archiv juenger ist.
 */
function vorratPfad(datei: string): string {
  return cache.pfad('lod2', `${path.basename(datei).replace(/\.zip$/i, '')}.baukoerper.ndjson`);
}

/** Legt den Vorrat an — einmalig, ueber das GANZE Archiv. */
export async function vorratAnlegen(datei: string, bericht?: (g: number, mb: number) => void): Promise<{ pfad: string; anzahl: number; bytes: number }> {
  const ziel = vorratPfad(datei);
  const gesamt: BBox = { minE: -Infinity, minN: -Infinity, maxE: Infinity, maxN: Infinity };
  const alle = await ausZipDatei(datei, gesamt, bericht);
  const strom = fs.createWriteStream(ziel + '.teil');
  for (const g of alle) {
    // DIE HUELLE STEHT VOR DEM JSON, durch einen Tabulator getrennt.
    // Ohne sie muesste der Leser jede der 94.794 Zeilen auspacken, nur um zu
    // entscheiden, dass er sie nicht braucht — gemessen 28,4 s und damit
    // LANGSAMER als das Entpacken des Archivs (13-17 s). Mit ihr kostet die
    // Entscheidung vier Zahlen.
    const h = bboxVonPunkten(g.grundriss);
    const zeile = `${Math.floor(h.minE)} ${Math.floor(h.minN)} ${Math.ceil(h.maxE)} ${Math.ceil(h.maxN)}\t${JSON.stringify(g)}\n`;
    if (!strom.write(zeile)) await new Promise<void>((r) => strom.once('drain', () => r()));
  }
  await new Promise<void>((r) => strom.end(r));
  fs.renameSync(ziel + '.teil', ziel);
  return { pfad: ziel, anzahl: alle.length, bytes: fs.statSync(ziel).size };
}

/**
 * Liest den Vorrat, wenn es ihn gibt und er nicht aelter ist als das Archiv.
 * Gibt `null` zurueck, wenn kein brauchbarer Vorrat da ist — dann laeuft der
 * gewoehnliche Weg, und nichts ist verloren.
 */
async function ausVorrat(datei: string, bbox: BBox, bericht?: (g: number, mb: number) => void): Promise<GelaendeGebaeude[] | null> {
  const pfad = vorratPfad(datei);
  try {
    const vs = fs.statSync(pfad);
    const as = fs.statSync(datei);
    if (vs.mtimeMs < as.mtimeMs) return null; // Archiv ist neuer — Vorrat verworfen
  } catch {
    return null;
  }
  /*
   * AUF BYTEEBENE, NICHT AUF ZEICHENEBENE.
   *
   * Der erste Versuch las die Datei mit `encoding: 'utf8'` und schnitt sie mit
   * `split('\n')` — gemessen 32,8 s und damit doppelt so lang wie das
   * Entpacken des Archivs, das der Vorrat gerade ersetzen sollte. Die Kosten
   * stecken nicht im Auspacken der Gebaeude, sondern darin, 160 MB in
   * Zeichenketten zu verwandeln, von denen 94 % sofort weggeworfen werden.
   *
   * Jetzt bleibt die Datei ein Puffer. Gesucht wird nach den Bytes 0x0A
   * (Zeilenende) und 0x09 (Tabulator); dekodiert und ausgepackt wird nur, was
   * die Huellpruefung ueberlebt.
   */
  const puffer = await fs.promises.readFile(pfad);
  const out: GelaendeGebaeude[] = [];
  const ZEILE = 0x0a;
  const TAB = 0x09;
  let von = 0;
  while (von < puffer.length) {
    let bis = puffer.indexOf(ZEILE, von);
    if (bis < 0) bis = puffer.length;
    const tab = puffer.indexOf(TAB, von);
    if (tab > von && tab < bis) {
      const kopf = puffer.toString('latin1', von, tab);
      const leer1 = kopf.indexOf(' ');
      const leer2 = kopf.indexOf(' ', leer1 + 1);
      const leer3 = kopf.indexOf(' ', leer2 + 1);
      const minE = +kopf.slice(0, leer1);
      const minN = +kopf.slice(leer1 + 1, leer2);
      const maxE = +kopf.slice(leer2 + 1, leer3);
      const maxN = +kopf.slice(leer3 + 1);
      if (!(minE > bbox.maxE || maxE < bbox.minE || minN > bbox.maxN || maxN < bbox.minN)) {
        // Der Kopf ist auf ganze Meter GERUNDET (floor/ceil) und damit bewusst
        // etwas zu gross — er darf nur VORfiltern. Entschieden wird an der
        // echten Huelle, sonst liefert der Vorrat ein anderes Ergebnis als das
        // Archiv: gemessen 5.493 statt 5.471 Gebaeude, 22 Randfaelle zu viel.
        const g = JSON.parse(puffer.toString('utf8', tab + 1, bis)) as GelaendeGebaeude;
        if (bboxUeberschneidet(bboxVonPunkten(g.grundriss), bbox)) out.push(g);
      }
    }
    von = bis + 1;
  }
  bericht?.(out.length, puffer.length / (1024 * 1024));
  return out;
}

/** Laedt LoD2-Gebaeude fuer ein Gebiet — aus lokaler Datei oder per Download. */
export async function gebaeudeFuerGebiet(
  bbox: BBox,
  opts: { land?: string; kreis?: string; quelle?: Lod2Quelle; bericht?: (g: number, mb: number) => void } = {},
): Promise<{ gebaeude: GelaendeGebaeude[]; quelle: Lod2Quelle }> {
  const quelle = opts.quelle ?? quelleErmitteln(opts.land, opts.kreis);
  if (!quelle) throw new Error('Keine LoD2-Quelle konfiguriert.');

  if (quelle.art === 'datei') {
    const datei = quelle.datei!;
    if (/\.zip$/i.test(datei)) {
      const vorrat = await ausVorrat(datei, bbox, opts.bericht);
      if (vorrat) return { gebaeude: vorrat, quelle };
      const gebaeude = await ausZipDatei(datei, bbox, opts.bericht);
      return { gebaeude, quelle };
    }
    const strom = fs.createReadStream(datei, { highWaterMark: 4 * 1024 * 1024 });
    const gebaeude = await ausStrom(strom as unknown as AsyncIterable<Uint8Array>, bbox, opts.bericht);
    return { gebaeude, quelle };
  }

  const k = geoKonfig(opts.land ?? 'hessen');
  if (/\.zip$/i.test(quelle.url!)) {
    const zipPfad = await zipInCache(quelle.url!, k.geokodierung.userAgent);
    // AUCH HIER DER VORRAT. Die Quelle heisst `download`, das Archiv liegt aber
    // laengst im Zwischenspeicher — genau dieser Weg laeuft im Betrieb. Der
    // Vorrat sass zuerst nur im `datei`-Zweig und griff dadurch nie; gemessen
    // blieben die 21 s Entpackzeit stehen, obwohl die Zeilendatei bereitlag.
    const vorrat = await ausVorrat(zipPfad, bbox, opts.bericht);
    if (vorrat) return { gebaeude: vorrat, quelle };
    const gebaeude = await ausZipDatei(zipPfad, bbox, opts.bericht);
    return { gebaeude, quelle };
  }
  const res = await fetch(quelle.url!, { headers: { 'User-Agent': k.geokodierung.userAgent } });
  if (!res.ok || !res.body) throw new Error(`LoD2-Download fehlgeschlagen: HTTP ${res.status}`);
  if ((res.headers.get('content-type') ?? '').includes('zip')) {
    // URL ohne .zip-Endung, Antwort trotzdem ein Archiv: erst auf Platte, dann streamend entpacken.
    const ziel = cache.pfad('lod2', 'lod2-download.zip');
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(ziel));
    const gebaeude = await ausZipDatei(ziel, bbox, opts.bericht);
    return { gebaeude, quelle };
  }
  const gebaeude = await ausStrom(Readable.fromWeb(res.body as never) as unknown as AsyncIterable<Uint8Array>, bbox, opts.bericht);
  return { gebaeude, quelle };
}
