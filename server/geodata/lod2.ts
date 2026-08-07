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
import { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import type { BBox, GelaendeGebaeude, Ring } from '../../shared/domain/types.ts';
import { bboxUeberschneidet, bboxVonPunkten, flaeche, ringNormalisieren } from '../../shared/geo/geometry.ts';
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

function flaechenSammeln(knoten: Record<string, any>, out: Flaeche3D_intern[]) {
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
        if (ring) out.push({ art, ring });
      }
    }
  }
  for (const teil of knoten.consistsOfBuildingPart ?? []) {
    for (const p of teil.BuildingPart ?? []) flaechenSammeln(p, out);
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

function gebaeudeAusBlock(block: string, bbox: BBox): GelaendeGebaeude | null {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(block) as Record<string, any>;
  } catch {
    return null;
  }
  const b = doc.Building;
  if (!b) return null;
  const flaechen: Flaeche3D_intern[] = [];
  flaechenSammeln(b, flaechen);
  if (!flaechen.length) return null;

  const grundriss = grundrissAus(flaechen);
  if (!grundriss) return null;
  const bb = bboxVonPunkten(grundriss);
  if (!bboxUeberschneidet(bb, bbox)) return null;

  const attrs = attribute(b);
  // LAGEZURERD (Lage zur Erdoberflaeche) ist ein amtliches ALKIS-Merkmal:
  // Werte kleiner 0 bezeichnen unterirdische Bauwerke (Tiefgaragen, Tunnel).
  // Die duerfen weder als Hindernis noch als Hoehenstuetzpunkt zaehlen.
  const lage = Number(attrs.LAGEZURERD);
  if (Number.isFinite(lage) && lage < 0) return null;

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
  const zahl = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : undefined;
  };
  const boden = zahl(attrs.AbsoluteHoehe) ?? (Number.isFinite(zMin) ? zMin : 0);
  const traufe = zahl(attrs.MittlereTraufHoehe) ?? (Number.isFinite(dachMin) ? dachMin : undefined);
  const first = zahl(attrs.Firsthoehe) ?? (Number.isFinite(dachMax) ? dachMax : undefined);

  // Die ECHTEN Flaechen mitnehmen — ohne sie waere jedes Gebaeude ein Quader
  // mit flachem Deckel. Mit ihnen bekommt es seine wirkliche Dachform.
  const runde = (f: Flaeche3D_intern): [number, number, number][] =>
    f.ring.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100]);
  const dachflaechen = flaechen.filter((f) => f.art === 'dach').map(runde);
  const wandflaechen = flaechen.filter((f) => f.art === 'wand').map(runde);

  return {
    id: String(b['@_id'] ?? attrs.ALKISOID ?? `lod2_${Math.round(bb.minE)}_${Math.round(bb.minN)}`),
    grundriss: grundriss.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
    bodenHoehe: Math.round(boden * 100) / 100,
    traufHoehe: traufe !== undefined ? Math.round(traufe * 100) / 100 : undefined,
    firstHoehe: first !== undefined ? Math.round(first * 100) / 100 : undefined,
    dachform: attrs.Dachtyp_tridicon || undefined,
    funktion: typeof b.function === 'string' ? b.function : undefined,
    quelle: 'lod2',
    dachflaechen: dachflaechen.length ? dachflaechen : undefined,
    wandflaechen: wandflaechen.length ? wandflaechen : undefined,
  };
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
        const g = gebaeudeAusBlock(block, bbox);
        if (g && !gesehen.has(g.id)) {
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
      // ZIP komplett lesen ist bei 159 MB vertretbar; die entpackten GML-Teile
      // werden einzeln als Text durch den Streamparser geschickt.
      const eintraege = unzipSync(new Uint8Array(fs.readFileSync(datei)));
      const gefunden: GelaendeGebaeude[] = [];
      for (const [name, daten] of Object.entries(eintraege)) {
        if (!/\.(gml|xml)$/i.test(name)) continue;
        const teil = await ausStrom(
          (async function* () {
            yield Buffer.from(daten);
          })(),
          bbox,
          opts.bericht,
        );
        gefunden.push(...teil);
      }
      return { gebaeude: gefunden, quelle };
    }
    const strom = fs.createReadStream(datei, { highWaterMark: 4 * 1024 * 1024 });
    const gebaeude = await ausStrom(strom as unknown as AsyncIterable<Uint8Array>, bbox, opts.bericht);
    return { gebaeude, quelle };
  }

  const k = geoKonfig(opts.land ?? 'hessen');
  const res = await fetch(quelle.url!, { headers: { 'User-Agent': k.geokodierung.userAgent } });
  if (!res.ok || !res.body) throw new Error(`LoD2-Download fehlgeschlagen: HTTP ${res.status}`);
  const istZip = (res.headers.get('content-type') ?? '').includes('zip') || /\.zip$/i.test(quelle.url!);
  if (istZip) {
    const eintraege = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const gefunden: GelaendeGebaeude[] = [];
    for (const [name, daten] of Object.entries(eintraege)) {
      if (!/\.(gml|xml)$/i.test(name)) continue;
      const teil = await ausStrom(
        (async function* () {
          yield Buffer.from(daten);
        })(),
        bbox,
        opts.bericht,
      );
      gefunden.push(...teil);
    }
    return { gebaeude: gefunden, quelle };
  }
  const gebaeude = await ausStrom(Readable.fromWeb(res.body as never) as unknown as AsyncIterable<Uint8Array>, bbox, opts.bericht);
  return { gebaeude, quelle };
}
