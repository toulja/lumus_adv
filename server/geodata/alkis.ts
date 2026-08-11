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

/**
 * WIE VIELE OBJEKTE HAELT DER DIENST FUER DIESES RECHTECK BEREIT?
 *
 * `RESULTTYPE=hits` liefert die Antwort ohne die Daten — eine exakte Zahl in
 * `numberMatched`. Sie ist das SOLL, gegen das der Abruf sich messen lassen
 * muss. Ohne sie kann ein Import nur BEHAUPTEN, vollstaendig zu sein.
 *
 * (In der normalen Antwort steht `numberMatched="unknown"`, aber ein exaktes
 * `numberReturned` — das ist das IST. Erst beide zusammen ergeben einen Beweis.)
 */
async function wfsSoll(typename: string, bbox: BBox, land: string): Promise<number | null> {
  const k = geoKonfig(land);
  const f = k.flurstuecke;
  const p = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: f.version,
    REQUEST: 'GetFeature',
    TYPENAMES: typename,
    RESULTTYPE: 'hits',
    SRSNAME: f.srsName,
    BBOX: `${bbox.minE},${bbox.minN},${bbox.maxE},${bbox.maxN},${f.srsName}`,
  });
  const res = await fetch(`${f.url}?${p.toString()}`, { headers: { 'User-Agent': k.geokodierung.userAgent } });
  if (!res.ok) return null;
  const xml = await res.text();
  const m = /numberMatched="(\d+)"/.exec(xml);
  return m ? Number(m[1]) : null;
}

/**
 * Ein GetFeature. Liefert das Dokument UND die Zahl, die der Dienst selbst als
 * geliefert meldet — ohne die laesst sich eine Kappung nicht erkennen.
 */
async function wfsAbruf(
  typename: string,
  bbox: BBox,
  land: string,
  maxFeatures: number,
): Promise<{ doc: unknown; geliefert: number }> {
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
  const doc = parser.parse(xml);
  const gemeldet = Number(
    ((doc as Record<string, unknown>)?.FeatureCollection as Record<string, unknown> | undefined)?.['@_numberReturned'],
  );
  return { doc, geliefert: Number.isFinite(gemeldet) ? gemeldet : mitglieder(doc).length };
}

function mitglieder(doc: unknown): Record<string, unknown>[] {
  const fc = (doc as Record<string, unknown>)?.FeatureCollection as Record<string, unknown> | undefined;
  if (!fc) return [];
  const roh = fc.member;
  if (!roh) return [];
  return (Array.isArray(roh) ? roh : [roh]) as Record<string, unknown>[];
}

/** Zerlegt ein Gebiet in moeglichst quadratische Kacheln von ca. zielM Metern. */
function kachelGitter(bbox: BBox, zielM: number): BBox[] {
  const spalten = Math.max(1, Math.round((bbox.maxE - bbox.minE) / zielM));
  const zeilen = Math.max(1, Math.round((bbox.maxN - bbox.minN) / zielM));
  const dE = (bbox.maxE - bbox.minE) / spalten;
  const dN = (bbox.maxN - bbox.minN) / zeilen;
  const out: BBox[] = [];
  for (let z = 0; z < zeilen; z++) {
    for (let s = 0; s < spalten; s++) {
      out.push({ minE: bbox.minE + s * dE, maxE: bbox.minE + (s + 1) * dE, minN: bbox.minN + z * dN, maxN: bbox.minN + (z + 1) * dN });
    }
  }
  return out;
}

/** Kachelkantenlaenge des Flurstuecksabrufs. */
const FLURSTUECK_KACHEL_M = 1000;

/** Zuschlag auf das gemeldete Soll — der Bestand kann sich zwischen den Abrufen aendern. */
const FLURSTUECK_RESERVE = 1.1;

export interface FlurstueckAbruf {
  liste: AlkisFlurstueck[];
  /** Was der Dienst laut `RESULTTYPE=hits` bereithaelt (null = nicht ermittelbar). */
  soll: number | null;
  /** Was er tatsaechlich geliefert hat (Summe ueber alle Kacheln, ohne Doppelte). */
  geliefert: number;
  kacheln: number;
  /** Kacheln, die nach allen Versuchen keine Antwort gaben. */
  uebersprungen: number;
}

/**
 * FLURSTUECKE — gekachelt und mit BEWEIS statt Behauptung.
 *
 * DER BEFUND (10.08.2026, nachgemessen am Dienst): Der Abruf lief mit
 * `COUNT = maxFeatures = 800` gegen die GANZE Gebiets-Bbox. Fuer das
 * Pilotgebiet von 1,81 km2 haelt der Dienst 1.863 Flurstuecke bereit; der
 * Import nahm 800. Es fehlten 1.063 Stueck oder 57 %, und niemand merkte es:
 * `wfsAbruf` verglich nichts, und der Quellennachweis schrieb die 800 als
 * Tatsache hin („800 Flurstuecke im Gebiet.").
 *
 * DREI ENTSCHEIDUNGEN, jede am Dienst geprueft:
 *  1. KACHELN, NICHT SEITENABRUF. Die Capabilities melden ausdruecklich
 *     `ImplementsResultPaging = FALSE`. `STARTINDEX` funktioniert im Versuch,
 *     ist aber nicht zugesichert — darauf baut man kein Stadtmodell.
 *  2. KACHELGROESSE 1 km. Gemessen an der dichtesten Innenstadtkachel:
 *     4 km2 ergaben 4.176 Objekte in 6,6 MB und 1,15 s. 1 km2 liegt damit
 *     komfortabel unter jeder Grenze; `CountDefault` des Dienstes ist 100.000.
 *  3. DAS COUNT KOMMT AUS DEM SOLL, nicht aus einer Konstante. Erst `hits`
 *     fragen, dann mit `soll + 10 %` holen. Damit kann eine Kappung gar nicht
 *     mehr unbemerkt entstehen — und wenn doch, sagt der Vergleich es.
 *
 * Der Aufrufer bekommt Soll und Ist und muss die Differenz melden.
 */
export async function flurstueckeMitNachweis(bbox: BBox, land = 'hessen'): Promise<FlurstueckAbruf> {
  const k = geoKonfig(land).flurstuecke;
  const gefunden = new Map<string, AlkisFlurstueck>();
  let uebersprungen = 0;
  let gekappt = 0;

  /*
   * DAS SOLL KOMMT AUS EINER EINZIGEN ABFRAGE UEBER DAS GANZE GEBIET.
   *
   * Die naheliegende Summe der Kachel-Sollwerte ist FALSCH, und zwar messbar:
   * Sie ergab fuer das Pilotgebiet 1.907 gegen 1.863 aus einer Gesamtabfrage —
   * 44 Flurstuecke liegen auf einer Kachelgrenze und werden in beiden Kacheln
   * mitgezaehlt. Ein Soll, das die Doppelten mitzaehlt, kann ein
   * doppelfreies Ist nie erreichen; der Import haette sich dauerhaft selbst
   * fuer unvollstaendig erklaert.
   */
  let soll: number | null = null;
  try {
    soll = await wfsSoll(k.typenameFlurstueck, bbox, land);
  } catch {
    soll = null;
  }

  const warteschlange = kachelGitter(bbox, FLURSTUECK_KACHEL_M).map((bb) => ({ bb, tiefe: 0 }));
  let kacheln = 0;
  while (warteschlange.length) {
    const { bb, tiefe } = warteschlange.shift() as { bb: BBox; tiefe: number };
    kacheln++;
    let kachelSoll: number | null = null;
    try {
      kachelSoll = await wfsSoll(k.typenameFlurstueck, bb, land);
    } catch {
      kachelSoll = null;
    }
    if (kachelSoll === 0) continue;

    const menge = kachelSoll === null ? k.maxFeatures : Math.max(50, Math.ceil(kachelSoll * FLURSTUECK_RESERVE));
    let ergebnis: { doc: unknown; geliefert: number };
    try {
      ergebnis = await wfsAbruf(k.typenameFlurstueck, bb, land, menge);
    } catch (e) {
      uebersprungen++;
      console.warn(`[alkis] Flurstueckskachel ${Math.round(bb.minE)}/${Math.round(bb.minN)} uebersprungen: ${(e as Error).message}`);
      continue;
    }
    for (const fs of flurstueckeAusDoc(ergebnis.doc)) {
      const schluessel = fs.kennzeichen || fs.id;
      if (!gefunden.has(schluessel)) gefunden.set(schluessel, fs);
    }
    // Kam die Antwort genau an der bestellten Grenze zurueck, war sie moeglicher-
    // weise abgeschnitten — dann vierteln statt hoffen (Muster aus nutzung.ts).
    if (ergebnis.geliefert >= menge && tiefe < 3) {
      const mE = (bb.minE + bb.maxE) / 2;
      const mN = (bb.minN + bb.maxN) / 2;
      for (const t of [
        { minE: bb.minE, minN: bb.minN, maxE: mE, maxN: mN },
        { minE: mE, minN: bb.minN, maxE: bb.maxE, maxN: mN },
        { minE: bb.minE, minN: mN, maxE: mE, maxN: bb.maxN },
        { minE: mE, minN: mN, maxE: bb.maxE, maxN: bb.maxN },
      ]) {
        warteschlange.push({ bb: t, tiefe: tiefe + 1 });
      }
      gekappt++;
    }
  }
  if (gekappt) console.warn(`[alkis] ${gekappt} Flurstueckskachel(n) liefen an die Grenze und wurden geviertelt.`);
  return { liste: [...gefunden.values()], soll, geliefert: gefunden.size, kacheln, uebersprungen };
}

/** Rueckwaertsvertraeglich: nur die Liste, ohne Nachweis. */
export async function flurstuecke(bbox: BBox, land = 'hessen'): Promise<AlkisFlurstueck[]> {
  return (await flurstueckeMitNachweis(bbox, land)).liste;
}

function flurstueckeAusDoc(doc: unknown): AlkisFlurstueck[] {
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

/*
 * ENTFERNT AM 11.08.2026: gebaeudegrundrisse().
 *
 * Die Funktion hatte im ganzen Programm keinen einzigen Aufrufer — die
 * Gebaeude kommen aus LoD2 (server/geodata/lod2.ts), mit Trauf- und
 * Firsthoehe und echten Dachflaechen. Ein zweiter, flacher Gebaeudeweg waere
 * eine zweite Wahrheit gewesen; ausserdem war er der letzte Verbraucher der
 * ungekachelten 800er-Kappung.
 */
