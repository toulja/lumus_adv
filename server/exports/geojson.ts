/**
 * Export F9.1 — Projektinhalt als GeoJSON.
 *
 * Der Austausch mit GIS-Systemen der Behoerden laeuft ueber GeoJSON. Intern
 * fuehrt EventPlan3D alles in EPSG:25832 (Meter); RFC 7946 verlangt aber
 * WGS84. Darum ist WGS84 der VORGABEWERT, und der 25832-Modus traegt einen
 * ausdruecklichen Hinweis, dass er vom Standard abweicht.
 *
 * Jedes Feature bekommt "properties.art" — daran erkennt das Zielsystem, was
 * es vor sich hat, ohne die Geometrie raten zu muessen.
 */

import type {
  Blockflaeche,
  Einsatzstation,
  Gelaende,
  GelaendeGebaeude,
  LonLat,
  ObjektInstanz,
  ObjektTyp,
  ProjektInhalt,
  Punkt,
  Ring,
  Weg,
} from '../../shared/domain/types.ts';
import {
  BLOCK_TYP_LABEL,
  KATEGORIE_LABEL,
  STATION_LABEL,
  WEGE_TYP_FARBE,
  WEGE_TYP_LABEL,
} from '../../shared/domain/types.ts';
import { bezeichnung, grundflaeche, grundriss, masseVon, zugaengeWelt } from '../../shared/domain/objekte.ts';
import {
  bboxVonPunkten,
  flaeche,
  gegenUhrzeiger,
  polylinieLaenge,
  ringNormalisieren,
  wegKorridor,
} from '../../shared/geo/geometry.ts';
import { nachWgs } from '../../shared/geo/proj.ts';
import pc from 'polygon-clipping';

// ---------------------------------------------------------------------------
// Typen des Ausgabeformats
// ---------------------------------------------------------------------------

export type GeoJsonArt =
  | 'objekt'
  | 'weg'
  | 'wegkorridor'
  | 'blockflaeche'
  | 'einsatzstation'
  | 'gebaeude'
  | 'gelaendegrenze';

export interface GeoJsonPunktGeometrie {
  type: 'Point';
  coordinates: number[];
}
export interface GeoJsonLinieGeometrie {
  type: 'LineString';
  coordinates: number[][];
}
export interface GeoJsonFlaecheGeometrie {
  type: 'Polygon';
  coordinates: number[][][];
}
export interface GeoJsonMultiFlaecheGeometrie {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export type GeoJsonGeometrie =
  | GeoJsonPunktGeometrie
  | GeoJsonLinieGeometrie
  | GeoJsonFlaecheGeometrie
  | GeoJsonMultiFlaecheGeometrie;

export interface GeoJsonFeature {
  type: 'Feature';
  id: string;
  geometry: GeoJsonGeometrie;
  properties: Record<string, unknown>;
}

export interface GeoJsonSammlung {
  type: 'FeatureCollection';
  name: string;
  /** Klartext, in welchem Bezugssystem die Koordinaten stehen. */
  koordinatensystem: string;
  /** Nur gesetzt, wenn vom GeoJSON-Standard abgewichen wird. */
  hinweis?: string;
  /** Benanntes CRS nach GeoJSON 2008 — nur im 25832-Modus. */
  crs?: { type: 'name'; properties: { name: string } };
  erzeugtAm: string;
  erzeugtVon: string;
  projekt: {
    id: string;
    name: string;
    status: string;
    zeitraumVon: string;
    zeitraumBis: string;
    maxBesucher: number;
  };
  gelaende: { id: string; name: string } | null;
  bbox: number[];
  features: GeoJsonFeature[];
}

export interface GeoJsonOpts {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  /** Vorgabe true = WGS84 (RFC 7946). false = EPSG:25832 mit Hinweis. */
  wgs84?: boolean;
}

const CRS_WGS84 = 'EPSG:4326 (WGS 84), Laenge/Breite in Grad — Vorgabe nach RFC 7946.';
const CRS_UTM32 =
  'EPSG:25832 (ETRS89 / UTM Zone 32N), Rechts-/Hochwert in Metern — internes Bezugssystem von EventPlan3D.';
const HINWEIS_UTM32 =
  'ACHTUNG: Diese Datei weicht bewusst von RFC 7946 ab. Die Koordinaten sind KEINE ' +
  'geografischen Grad, sondern Meter in EPSG:25832 (ETRS89 / UTM Zone 32N). Viele Web-Werkzeuge ' +
  'unterstellen stillschweigend WGS84 und stellen die Daten dann falsch dar. Fuer den Austausch ' +
  'nach RFC 7946 dieselbe Ausgabe mit wgs84 = true erzeugen.';

// ---------------------------------------------------------------------------
// Koordinaten-Umsetzung
// ---------------------------------------------------------------------------

function runde(x: number, stellen: number): number {
  const f = 10 ** stellen;
  return Math.round(x * f) / f;
}

/** Ein Punkt in der Ausgabe-Projektion, sinnvoll gerundet. */
function koord(p: Punkt, wgs: boolean): number[] {
  if (!wgs) return [runde(p[0], 3), runde(p[1], 3)];
  const ll: LonLat = nachWgs(p);
  return [runde(ll[0], 7), runde(ll[1], 7)];
}

/**
 * Ring in GeoJSON-Form: gegen den Uhrzeigersinn (Rechte-Hand-Regel fuer
 * Aussenringe nach RFC 7946) und geschlossen, also erster Punkt == letzter.
 */
function ringKoord(ring: Ring, wgs: boolean): number[][] {
  const sauber = ringNormalisieren(ring);
  if (sauber.length < 3) return [];
  const ccw = gegenUhrzeiger(sauber);
  const out = ccw.map((p) => koord(p, wgs));
  out.push([...out[0]]);
  return out;
}

/** Ringe aus polygon-clipping sind bereits geschlossen — nur umrechnen. */
function fertigenRingKoord(ring: number[][], wgs: boolean): number[][] {
  return ring.map((p) => koord([p[0], p[1]], wgs));
}

function flaechenGeometrie(ring: Ring, wgs: boolean): GeoJsonFlaecheGeometrie | null {
  const r = ringKoord(ring, wgs);
  if (!r.length) return null;
  return { type: 'Polygon', coordinates: [r] };
}

// ---------------------------------------------------------------------------
// Wegkorridor: Einzelrechtecke + Knickkappen zu einer Flaeche vereinigen
// ---------------------------------------------------------------------------

function korridorGeometrie(w: Weg, wgs: boolean): GeoJsonMultiFlaecheGeometrie | null {
  const teile = wegKorridor(w.polylinie, w.breite).filter((r) => r.length >= 3);
  if (!teile.length) return null;
  let multi: number[][][][] | null = null;
  try {
    const geoms = teile.map((r) => [r.map((p) => [p[0], p[1]] as [number, number])]);
    const ver = pc.union(geoms[0], ...geoms.slice(1));
    multi = ver.map((poly) => poly.map((ring) => fertigenRingKoord(ring as number[][], wgs)));
  } catch {
    // Bei entarteten Eingaben liefert der Verschnitt nichts Brauchbares —
    // dann lieber die Einzelteile ausgeben als gar nichts.
    multi = null;
  }
  if (!multi || !multi.length) {
    multi = teile.map((r) => [ringKoord(r, wgs)]).filter((p) => p[0].length > 0);
  }
  if (!multi.length) return null;
  return { type: 'MultiPolygon', coordinates: multi };
}

// ---------------------------------------------------------------------------
// Features je Elementart
// ---------------------------------------------------------------------------

function objektFeature(
  inst: ObjektInstanz,
  typ: ObjektTyp | undefined,
  wgs: boolean,
): GeoJsonFeature | null {
  if (!typ) return null;
  const ring = grundriss(typ, inst);
  const geom = flaechenGeometrie(ring, wgs);
  if (!geom) return null;
  const m = masseVon(typ, inst);
  const zug = zugaengeWelt(typ, inst).map((z) => ({
    typ: z.typ,
    breite: runde(z.breite, 2),
    weltRichtung: runde(z.weltRichtung, 1),
  }));
  return {
    type: 'Feature',
    id: inst.id,
    geometry: geom,
    properties: {
      art: 'objekt',
      id: inst.id,
      typId: inst.typId,
      typName: typ.name,
      kategorie: typ.kategorie,
      kategorieLabel: KATEGORIE_LABEL[typ.kategorie],
      name: bezeichnung(typ, inst),
      standNummer: inst.standNummer ?? 'k. A.',
      betreiber: inst.betreiberOrgId ?? 'k. A.',
      betreiberOrgId: inst.betreiberOrgId ?? null,
      status: inst.status,
      form: typ.form,
      masse: { laenge: runde(m.laenge, 2), breite: runde(m.breite, 2), hoehe: runde(m.hoehe, 2) },
      laenge: runde(m.laenge, 2),
      breite: runde(m.breite, 2),
      hoehe: runde(m.hoehe, 2),
      rotation: runde(inst.rotation, 2),
      hoeheUeberGelaende: runde(inst.hoeheUeberGelaende ?? 0, 2),
      grundflaeche: runde(grundflaeche(typ, inst), 2),
      flaechenbedarfZusatz: runde(typ.flaechenbedarfZusatz, 2),
      stromKW: typ.technik.stromKW,
      wasser: typ.technik.wasser,
      gasflaschen: typ.technik.gasflaschen,
      personenkapazitaet: typ.personenkapazitaet ?? 'k. A.',
      zugaenge: zug,
      auflagen: inst.auflagen.length,
      auflagenOffen: inst.auflagen.filter((a) => !a.erledigt).length,
      notizen: inst.notizen ?? 'k. A.',
      farbe: typ.farbe,
      erstelltVon: inst.erstelltVon,
      erstelltAm: inst.erstelltAm,
    },
  };
}

function wegFeature(w: Weg, wgs: boolean): GeoJsonFeature | null {
  if (w.polylinie.length < 2) return null;
  return {
    type: 'Feature',
    id: w.id,
    geometry: { type: 'LineString', coordinates: w.polylinie.map((p) => koord(p, wgs)) },
    properties: {
      art: 'weg',
      id: w.id,
      wegetyp: w.typ,
      wegetypLabel: WEGE_TYP_LABEL[w.typ],
      name: w.name ?? WEGE_TYP_LABEL[w.typ],
      breite: runde(w.breite, 2),
      lichteHoehe: w.lichteHoehe === undefined ? 'k. A.' : runde(w.lichteHoehe, 2),
      richtung: w.richtung,
      laenge: runde(polylinieLaenge(w.polylinie), 2),
      entfluchtungFuerPersonen: w.entfluchtungFuerPersonen ?? 'k. A.',
      farbe: WEGE_TYP_FARBE[w.typ],
      erstelltVon: w.erstelltVon,
      erstelltAm: w.erstelltAm,
    },
  };
}

function korridorFeature(w: Weg, wgs: boolean): GeoJsonFeature | null {
  const geom = korridorGeometrie(w, wgs);
  if (!geom) return null;
  return {
    type: 'Feature',
    id: `${w.id}-korridor`,
    geometry: geom,
    properties: {
      art: 'wegkorridor',
      id: `${w.id}-korridor`,
      wegId: w.id,
      wegetyp: w.typ,
      wegetypLabel: WEGE_TYP_LABEL[w.typ],
      name: `${w.name ?? WEGE_TYP_LABEL[w.typ]} — Korridor`,
      breite: runde(w.breite, 2),
      richtung: w.richtung,
      laenge: runde(polylinieLaenge(w.polylinie), 2),
      farbe: WEGE_TYP_FARBE[w.typ],
      hinweis: 'Sollbreite als Flaeche. Freie Durchgangsbreite kann durch Objekte geringer sein.',
    },
  };
}

function blockFeature(b: Blockflaeche, wgs: boolean): GeoJsonFeature | null {
  const geom = flaechenGeometrie(b.polygon, wgs);
  if (!geom) return null;
  return {
    type: 'Feature',
    id: b.id,
    geometry: geom,
    properties: {
      art: 'blockflaeche',
      id: b.id,
      typ: b.typ,
      typLabel: BLOCK_TYP_LABEL[b.typ],
      name: b.name ?? BLOCK_TYP_LABEL[b.typ],
      begruendung: b.begruendung,
      flaeche: runde(flaeche(b.polygon), 2),
      erstelltVon: b.erstelltVon,
      erstelltAm: b.erstelltAm,
    },
  };
}

/** true, wenn das Polygon der Station nach dem Bereinigen noch eine Flaeche ist. */
function stationFlaechig(s: Einsatzstation): boolean {
  return !!s.polygon && ringNormalisieren(s.polygon).length >= 3;
}

function stationFeature(s: Einsatzstation, wgs: boolean): GeoJsonFeature | null {
  // Ein entartetes Polygon (doppelte oder zu wenige Stuetzpunkte) darf die
  // Station nicht verschwinden lassen — dann gilt der Punkt.
  let geom: GeoJsonGeometrie | null = stationFlaechig(s) ? flaechenGeometrie(s.polygon as Ring, wgs) : null;
  if (!geom && s.punkt) geom = { type: 'Point', coordinates: koord(s.punkt, wgs) };
  if (!geom) return null;
  const flaechig = geom.type === 'Polygon';
  return {
    type: 'Feature',
    id: s.id,
    geometry: geom,
    properties: {
      art: 'einsatzstation',
      id: s.id,
      kategorie: s.kategorie,
      kategorieLabel: STATION_LABEL[s.kategorie],
      name: s.name,
      besetztVonOrgId: s.besetztVonOrgId ?? 'k. A.',
      flaeche: flaechig ? runde(flaeche(s.polygon as Ring), 2) : 'k. A.',
      notizen: s.notizen ?? 'k. A.',
      erstelltVon: s.erstelltVon,
      erstelltAm: s.erstelltAm,
    },
  };
}

function gebaeudeFeature(g: GelaendeGebaeude, wgs: boolean): GeoJsonFeature | null {
  const geom = flaechenGeometrie(g.grundriss, wgs);
  if (!geom) return null;
  const first = g.firstHoehe;
  const trauf = g.traufHoehe;
  const hoehe = first !== undefined ? first - g.bodenHoehe : trauf !== undefined ? trauf - g.bodenHoehe : null;
  return {
    type: 'Feature',
    id: g.id,
    geometry: geom,
    properties: {
      art: 'gebaeude',
      id: g.id,
      name: g.funktion ? `Bestandsgebaeude (${g.funktion})` : 'Bestandsgebaeude',
      bodenHoehe: runde(g.bodenHoehe, 2),
      traufHoehe: trauf === undefined ? 'k. A.' : runde(trauf, 2),
      firstHoehe: first === undefined ? 'k. A.' : runde(first, 2),
      hoehe: hoehe === null ? 'k. A.' : runde(hoehe, 2),
      dachform: g.dachform ?? 'k. A.',
      funktion: g.funktion ?? 'k. A.',
      quelle: g.quelle,
      grundflaeche: runde(flaeche(g.grundriss), 2),
    },
  };
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function projektAlsGeoJson(opts: GeoJsonOpts): GeoJsonSammlung {
  const wgs = opts.wgs84 !== false;
  const { inhalt, gelaende, typen } = opts;
  const features: GeoJsonFeature[] = [];
  const allePunkte: Punkt[] = [];

  const merke = (pts: Punkt[]) => {
    for (const p of pts) allePunkte.push(p);
  };

  for (const o of inhalt.objekte) {
    const typ = typen.get(o.typId);
    const f = objektFeature(o, typ, wgs);
    if (f && typ) {
      features.push(f);
      merke(grundriss(typ, o));
    }
  }

  for (const w of inhalt.wege) {
    const f = wegFeature(w, wgs);
    if (f) {
      features.push(f);
      merke(w.polylinie);
    }
    const k = korridorFeature(w, wgs);
    if (k) {
      features.push(k);
      // Der Korridor ragt um breite/2 ueber die Polylinie hinaus — ohne diese
      // Punkte meldet die bbox ein zu kleines Gebiet und ein Zuschnitt im
      // Ziel-GIS wuerde die Korridorraender abschneiden.
      for (const r of wegKorridor(w.polylinie, w.breite)) merke(r);
    }
  }

  for (const b of inhalt.blockflaechen) {
    const f = blockFeature(b, wgs);
    if (f) {
      features.push(f);
      merke(b.polygon);
    }
  }

  for (const s of inhalt.einsatzstationen) {
    const f = stationFeature(s, wgs);
    if (f) {
      features.push(f);
      if (f.geometry.type === 'Polygon' && s.polygon) merke(s.polygon);
      else if (s.punkt) merke([s.punkt]);
    }
  }

  if (gelaende) {
    for (const g of gelaende.gebaeude) {
      const f = gebaeudeFeature(g, wgs);
      if (f) {
        features.push(f);
        merke(g.grundriss);
      }
    }
    const grenze = flaechenGeometrie(gelaende.polygon, wgs);
    if (grenze) {
      features.push({
        type: 'Feature',
        id: `${gelaende.id}-grenze`,
        geometry: grenze,
        properties: {
          art: 'gelaendegrenze',
          id: `${gelaende.id}-grenze`,
          name: `Gelaendegrenze ${gelaende.name}`,
          gelaendeId: gelaende.id,
          hoeheMittel: runde(gelaende.hoeheMittel, 2),
          hoeheMin: runde(gelaende.hoeheMin, 2),
          hoeheMax: runde(gelaende.hoeheMax, 2),
          hoehenHerkunft: gelaende.hoehenHerkunft,
          flaeche: runde(flaeche(gelaende.polygon), 2),
        },
      });
      merke(gelaende.polygon);
    }
  }

  // Bbox in der Ausgabe-Projektion — Ecken einzeln umrechnen, die Zone ist
  // nicht achsentreu.
  let bbox: number[] = [];
  if (allePunkte.length) {
    const b = bboxVonPunkten(allePunkte);
    const ecken: Punkt[] = [
      [b.minE, b.minN],
      [b.maxE, b.minN],
      [b.maxE, b.maxN],
      [b.minE, b.maxN],
    ];
    const um = ecken.map((p) => koord(p, wgs));
    bbox = [
      Math.min(...um.map((p) => p[0])),
      Math.min(...um.map((p) => p[1])),
      Math.max(...um.map((p) => p[0])),
      Math.max(...um.map((p) => p[1])),
    ];
  }

  const sammlung: GeoJsonSammlung = {
    type: 'FeatureCollection',
    name: inhalt.projekt.name,
    koordinatensystem: wgs ? CRS_WGS84 : CRS_UTM32,
    erzeugtAm: new Date().toISOString(),
    erzeugtVon: 'EventPlan3D — Export F9.1',
    projekt: {
      id: inhalt.projekt.id,
      name: inhalt.projekt.name,
      status: inhalt.projekt.status,
      zeitraumVon: inhalt.projekt.zeitraumVon,
      zeitraumBis: inhalt.projekt.zeitraumBis,
      maxBesucher: inhalt.projekt.maxBesucher,
    },
    gelaende: gelaende ? { id: gelaende.id, name: gelaende.name } : null,
    bbox,
    features,
  };

  if (!wgs) {
    sammlung.hinweis = HINWEIS_UTM32;
    sammlung.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::25832' } };
  }
  return sammlung;
}
