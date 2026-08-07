/**
 * ALKIS (vereinfachtes Modell) ueber WFS — Flurstuecke und Gebaeudegrundrisse.
 *
 * Der Dienst liefert ausschliesslich GML, kein JSON. Die BBOX-Achsenreihenfolge
 * ist die klassische Fehlerquelle: bei urn:ogc:def:crs:EPSG::25832 kommt der
 * RECHTSWERT zuerst (am 07.08.2026 gegen Darmstadt verifiziert), bei
 * urn:ogc:def:crs:EPSG::4326 dagegen die Breite.
 */

import { XMLParser } from 'fast-xml-parser';
import type { BBox, Ring } from '../../shared/domain/types.ts';
import { flaeche, ringNormalisieren } from '../../shared/geo/geometry.ts';
import { geoKonfig } from './konfig.ts';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['member', 'surfaceMember', 'patches', 'PolygonPatch', 'exterior'].includes(name),
});

export interface AlkisFlurstueck {
  id: string;
  kennzeichen: string;
  gemarkung: string;
  flur: string;
  nummer: string;
  /** Amtliche Flaeche laut Kataster (m2). */
  flaecheAmtlich: number | null;
  /** Aus der Geometrie gerechnete Flaeche (m2) — Kontrollwert. */
  flaecheGerechnet: number;
  lagebezeichnung: string;
  polygon: Ring;
}

export interface AlkisGebaeude {
  id: string;
  funktion: string;
  nutzung: string;
  polygon: Ring;
}

function textVon(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
  return String(v);
}

/** Sammelt alle posList-Ringe unterhalb eines Knotens (2D, E/N). */
function ringeSammeln(knoten: unknown, treffer: Ring[] = []): Ring[] {
  if (!knoten || typeof knoten !== 'object') return treffer;
  const o = knoten as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'posList') {
      const zahlen = textVon(v)
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      // srsDimension kann 2 oder 3 sein — anhand der Groessenordnung erkennen:
      // Rechtswerte liegen bei 3-6 * 10^5, Hochwerte bei 5,5 * 10^6, Hoehen < 2000.
      const dim = zahlen.length % 3 === 0 && zahlen.length % 2 !== 0 ? 3 : erkenneDimension(zahlen);
      const ring: Ring = [];
      for (let i = 0; i + 1 < zahlen.length; i += dim) ring.push([zahlen[i], zahlen[i + 1]]);
      const sauber = ringNormalisieren(ring);
      if (sauber.length >= 3) treffer.push(sauber);
    } else if (typeof v === 'object') {
      if (Array.isArray(v)) for (const e of v) ringeSammeln(e, treffer);
      else ringeSammeln(v, treffer);
    }
  }
  return treffer;
}

function erkenneDimension(zahlen: number[]): 2 | 3 {
  if (zahlen.length < 6) return 2;
  // Bei 3D steht an Position 2 eine Hoehe (< 2000), bei 2D ein Rechtswert (> 100000)
  return Math.abs(zahlen[2]) < 5000 ? 3 : 2;
}

async function wfsAbruf(typename: string, bbox: BBox, land: string, maxFeatures: number): Promise<unknown> {
  const k = geoKonfig(land);
  const f = k.flurstuecke;
  const p = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: f.version,
    REQUEST: 'GetFeature',
    TYPENAMES: typename,
    COUNT: String(maxFeatures),
    SRSNAME: f.srsName,
    // Achsenreihenfolge EN: Rechtswert zuerst
    BBOX: `${bbox.minE},${bbox.minN},${bbox.maxE},${bbox.maxN},${f.srsName}`,
  });
  const res = await fetch(`${f.url}?${p.toString()}`, {
    headers: { 'User-Agent': k.geokodierung.userAgent },
  });
  if (!res.ok) throw new Error(`ALKIS-WFS ${typename}: HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.includes('ExceptionReport')) {
    const m = /<[^>]*ExceptionText[^>]*>([^<]*)</.exec(xml);
    throw new Error(`ALKIS-WFS ${typename}: ${m?.[1] ?? 'Dienstfehler'}`);
  }
  return parser.parse(xml);
}

function mitglieder(doc: unknown): Record<string, unknown>[] {
  const fc = (doc as Record<string, unknown>)?.FeatureCollection as Record<string, unknown> | undefined;
  if (!fc) return [];
  const roh = fc.member;
  if (!roh) return [];
  return (Array.isArray(roh) ? roh : [roh]) as Record<string, unknown>[];
}

export async function flurstuecke(bbox: BBox, land = 'hessen'): Promise<AlkisFlurstueck[]> {
  const k = geoKonfig(land).flurstuecke;
  const doc = await wfsAbruf(k.typenameFlurstueck, bbox, land, k.maxFeatures);
  const out: AlkisFlurstueck[] = [];
  for (const m of mitglieder(doc)) {
    const fs = m.Flurstueck as Record<string, unknown> | undefined;
    if (!fs) continue;
    const ringe = ringeSammeln(fs.geometrie ?? fs);
    if (!ringe.length) continue;
    const groesster = ringe.reduce((a, b) => (flaeche(b) > flaeche(a) ? b : a));
    const amtlich = Number(textVon(fs.flaeche));
    out.push({
      id: String(fs['@_id'] ?? textVon(fs.oid) ?? `fs_${out.length}`),
      kennzeichen: textVon(fs.flstkennz),
      gemarkung: textVon(fs.gemarkung),
      flur: textVon(fs.flur),
      nummer: [textVon(fs.flstnrzae), textVon(fs.flstnrnen)].filter(Boolean).join('/'),
      flaecheAmtlich: Number.isFinite(amtlich) && amtlich > 0 ? amtlich : null,
      flaecheGerechnet: Math.round(flaeche(groesster) * 10) / 10,
      lagebezeichnung: textVon(fs.lagebeztxt),
      polygon: groesster,
    });
  }
  return out;
}

export async function gebaeudegrundrisse(bbox: BBox, land = 'hessen'): Promise<AlkisGebaeude[]> {
  const k = geoKonfig(land).flurstuecke;
  const doc = await wfsAbruf(k.typenameGebaeude, bbox, land, k.maxFeatures);
  const out: AlkisGebaeude[] = [];
  for (const m of mitglieder(doc)) {
    const g = m.GebaeudeBauwerk as Record<string, unknown> | undefined;
    if (!g) continue;
    const ringe = ringeSammeln(g.geometrie ?? g);
    if (!ringe.length) continue;
    const groesster = ringe.reduce((a, b) => (flaeche(b) > flaeche(a) ? b : a));
    out.push({
      id: String(g['@_id'] ?? textVon(g.oid) ?? `geb_${out.length}`),
      funktion: textVon(g.funktion),
      nutzung: textVon(g.gebnutzbez),
      polygon: groesster,
    });
  }
  return out;
}
