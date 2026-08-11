/**
 * OSM AUS DEM ORTSAUSZUG statt aus der Overpass-API.
 *
 * Beantwortet dieselben Abfragen wie `overpass()` und liefert dieselbe Form
 * (`OsmElement[]` wie bei `out geom`) — nur aus einer Datei auf der Platte
 * statt von einem fremden Dienst. Alles, was danach kommt (Klassifizierung,
 * Breiten, Korridore, Stadtdetails), bleibt unveraendert. Der Weg wird
 * getauscht, nicht das Ergebnis; genau deshalb ist er gegen den alten Weg
 * PRUEFBAR (scripts/auszug-gegenprobe.ts).
 *
 * WARUM (Begruendung ausfuehrlich in pbf.ts): 26 Kacheln x 10 Abfragen sind
 * ein Massenabruf. Die Overpass-Nutzungsregeln weisen den ab und verweisen auf
 * Auszuege — zu Recht: an zwei Tagen hintereinander fielen dadurch 25 von 26
 * Kacheln aus. Der Auszug ist vollstaendig, wiederholbar und schnell.
 *
 * WIE DIE ABFRAGE BEANTWORTET WIRD: Die Abfragen dieses Projekts sind alle
 * maschinell erzeugt und haben eine sehr enge Form. Sie wird hier streng
 * gelesen — was der Leser nicht sicher versteht, wird ABGEWIESEN, nie
 * ueberlesen. Eine falsch verstandene Abfrage liefert sonst zu wenig Objekte,
 * und zu wenig sieht am Ende genauso aus wie „hier ist eben nichts".
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BBox } from '../../shared/domain/types.ts';
import { bboxNachWgs } from '../../shared/geo/proj.ts';
import { pbfLesen } from './pbf.ts';
import type { OsmElement } from './osm.ts';

// ---------------------------------------------------------------------------
// Datei finden
// ---------------------------------------------------------------------------

const AUSZUG_ORDNER = path.join('data', 'osm-auszug');

export interface AuszugDatei {
  pfad: string;
  /** Stand der Daten laut Dateidatum — Geofabrik erneuert taeglich. */
  stand: Date;
  bytes: number;
}

/** Der jeweils neueste `.osm.pbf` im Auszugsordner, oder nichts. */
export function auszugDatei(): AuszugDatei | null {
  if (!fs.existsSync(AUSZUG_ORDNER)) return null;
  const kandidaten = fs
    .readdirSync(AUSZUG_ORDNER)
    .filter((n) => n.endsWith('.osm.pbf'))
    .map((n) => {
      const pfad = path.join(AUSZUG_ORDNER, n);
      const st = fs.statSync(pfad);
      return { pfad, stand: st.mtime, bytes: st.size };
    })
    .sort((a, b) => b.stand.getTime() - a.stand.getTime());
  return kandidaten[0] ?? null;
}

// ---------------------------------------------------------------------------
// Abfragesprache — nur die Formen, die dieses Projekt erzeugt
// ---------------------------------------------------------------------------

/**
 * SCHLUESSEL, DIE DER VORRAT FUEHRT.
 *
 * Der Vorrat behaelt nur Elemente, die mindestens einen dieser Schluessel
 * tragen — sonst laege halb Hessen im Arbeitsspeicher. Die Liste ist die
 * Vereinigung ALLER Abfragen in osm.ts und stadtdetails.ts.
 *
 * WICHTIG: Der Abfrageleser prueft jeden angefragten Schluessel gegen diese
 * Liste und WIRFT bei einem unbekannten. Wer eine neue Abfrage hinzufuegt und
 * den Schluessel hier vergisst, bekaeme sonst still ein leeres Ergebnis — die
 * teuerste Fehlerart, die dieses Projekt kennt.
 */
const VORRAT_SCHLUESSEL = new Set([
  'highway',
  'building',
  'landuse',
  'leisure',
  'natural',
  'amenity',
  'area:highway',
  'barrier',
  'footway',
  'public_transport',
  'railway',
  'traffic_sign',
]);

interface Bedingung {
  typ: 'node' | 'way';
  schluessel: string;
  /** Genauer Wert (`="x"`), regulaerer Ausdruck (`~"x"`) oder nur vorhanden. */
  wert?: string;
  regex?: RegExp;
}

/**
 * Zerlegt einen Abfragerumpf in Bedingungen.
 *
 * Erlaubt sind genau:
 *   [out:json][timeout:N];(<anweisung>;…);out geom;
 *   [out:json][timeout:N];<anweisung>;out geom;
 * mit <anweisung> = (node|way)["k"](s,w,n,e)
 *                 | (node|way)["k"="v"](s,w,n,e)
 *                 | (node|way)["k"~"re"](s,w,n,e)
 *
 * Alles andere wirft. Das ist Absicht: `relation(<id>)` wird an anderer Stelle
 * beantwortet, und jede kuenftige Abfrageform soll hier auffallen, statt
 * stillschweigend leer zurueckzukommen.
 */
export function abfrageLesen(rumpf: string): Bedingung[] {
  const ohneKopf = rumpf.replace(/^\s*\[out:json\]\[timeout:\d+\];/, '');
  if (ohneKopf === rumpf) throw new Error(`Auszug: unbekannter Abfragekopf in „${rumpf.slice(0, 60)}…".`);
  const kern = ohneKopf.replace(/out\s+geom\s*;\s*$/, '').trim();
  const innen = kern.startsWith('(') && kern.endsWith(');') ? kern.slice(1, -2) : kern.replace(/;$/, '');

  const bedingungen: Bedingung[] = [];
  for (const roh of innen.split(';')) {
    const a = roh.trim();
    if (!a) continue;
    const m = a.match(/^(node|way)\["([^"]+)"(?:(=|~)"([^"]*)")?\]\(([-\d.,]+)\)$/);
    if (!m) throw new Error(`Auszug: Anweisung „${a}" wird nicht verstanden. Der Auszugsleser kennt nur node/way mit einem Kennzeichenfilter und Gebietsangabe.`);
    const [, typ, schluessel, art, wert] = m;
    if (!VORRAT_SCHLUESSEL.has(schluessel)) {
      throw new Error(
        `Auszug: Schluessel „${schluessel}" steht nicht in VORRAT_SCHLUESSEL (osm-auszug.ts). ` +
          `Der Vorrat fuehrt ihn nicht, die Antwort waere faelschlich leer. Schluessel dort ergaenzen.`,
      );
    }
    const b: Bedingung = { typ: typ as 'node' | 'way', schluessel };
    if (art === '=') b.wert = wert;
    else if (art === '~') b.regex = new RegExp(wert);
    bedingungen.push(b);
  }
  if (!bedingungen.length) throw new Error(`Auszug: Abfrage ohne Anweisung: „${rumpf.slice(0, 80)}".`);
  return bedingungen;
}

/** Ist das der Sonderfall „eine benannte Relation mit Geometrie"? */
export function relationAbfrage(rumpf: string): number | null {
  const m = rumpf.match(/^\s*\[out:json\]\[timeout:\d+\];relation\((\d+)\);out\s+geom;\s*$/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Vorrat — einmal je Prozess aufgebaut, danach beantwortet er alles sofort
// ---------------------------------------------------------------------------

interface VorratElement {
  el: OsmElement;
  /** Umgrenzung in WGS84, fuer den Gebietsvergleich. */
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface Vorrat {
  /** Gebiet, fuer das er gebaut wurde (WGS84, mit Rand). */
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  /** Je Schluessel die Elemente, die ihn tragen. */
  nachSchluessel: Map<string, VorratElement[]>;
  stand: Date;
  datei: string;
  knoten: number;
  wege: number;
}

let vorrat: Vorrat | null = null;

/**
 * RAND UM DAS GEBIET.
 *
 * Ein Weg, der die Gebietsgrenze kreuzt, braucht seine Knoten JENSEITS der
 * Grenze, sonst endet er dort abrupt. 3 km sind reichlich fuer alles, was in
 * einem Stadtgebiet vorkommt, und kosten im Vorrat kaum etwas.
 */
const VORRAT_RAND_GRAD = 0.03; // rund 3,3 km in Nord-, 2,2 km in Ost-Richtung

/**
 * Baut den Vorrat fuer ein Gebiet auf. DREI Durchgaenge, mit Absicht:
 *
 *  1. Knoten im Gebiet einsammeln (Koordinaten) und die, die selbst Kennzeichen
 *     tragen, gleich als Elemente behalten.
 *  2. Wege lesen. Behalten wird, wer einen tragenden Schluessel hat UND
 *     mindestens einen Knoten im Gebiet — Letzteres ist der Gebietsfilter.
 *  3. Knoten NACHLESEN, die den behaltenen Wegen noch fehlen.
 *
 * Der dritte Durchgang ist nicht Bequemlichkeit, sondern Genauigkeit: Ohne ihn
 * haetten alle Wege, die ueber den Rand hinausreichen, Luecken in der
 * Geometrie — bei einer Autobahn faende sich ein Knoten im Gebiet und der
 * Rest waere „null". Mit ihm ist die Geometrie jedes behaltenen Weges
 * VOLLSTAENDIG. Der Durchgang kostet rund 13 Sekunden, einmal je Prozess.
 */
export function vorratAufbauen(bbox: BBox, melde?: (s: string) => void): Vorrat {
  const datei = auszugDatei();
  if (!datei) {
    throw new Error(
      `Kein OSM-Ortsauszug gefunden. Erwartet wird eine Datei „*.osm.pbf" in ${AUSZUG_ORDNER}. ` +
        `Herunterladen mit: node scripts/osm-auszug-holen.ts`,
    );
  }
  const w = bboxNachWgs(bbox);
  const minLat = w.minLat - VORRAT_RAND_GRAD;
  const maxLat = w.maxLat + VORRAT_RAND_GRAD;
  const minLon = w.minLon - VORRAT_RAND_GRAD;
  const maxLon = w.maxLon + VORRAT_RAND_GRAD;

  const t0 = Date.now();
  const roh = fs.readFileSync(datei.pfad);
  const bytes = new Uint8Array(roh.buffer, roh.byteOffset, roh.byteLength);

  // --- 1. Knoten im Gebiet ---------------------------------------------------
  const lat = new Map<number, number>();
  const lon = new Map<number, number>();
  const knotenElemente: VorratElement[] = [];
  pbfLesen(bytes, {
    knoten: (k) => {
      if (k.lat < minLat || k.lat > maxLat || k.lon < minLon || k.lon > maxLon) return;
      lat.set(k.id, k.lat);
      lon.set(k.id, k.lon);
      if (!k.hatTags) return;
      const tags = k.tags();
      let treffer = false;
      for (const s in tags) {
        if (VORRAT_SCHLUESSEL.has(s)) {
          treffer = true;
          break;
        }
      }
      if (!treffer) return;
      knotenElemente.push({
        el: { type: 'node', id: k.id, tags, lat: k.lat, lon: k.lon },
        minLat: k.lat,
        maxLat: k.lat,
        minLon: k.lon,
        maxLon: k.lon,
      });
    },
  });
  melde?.(`  Auszug 1/3: ${lat.size.toLocaleString('de-DE')} Knoten im Gebiet, davon ${knotenElemente.length.toLocaleString('de-DE')} mit Kennzeichen (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // --- 2. Wege ---------------------------------------------------------------
  const t1 = Date.now();
  interface RohWeg {
    id: number;
    refs: number[];
    tags: Record<string, string>;
  }
  const wege: RohWeg[] = [];
  const fehlend = new Set<number>();
  pbfLesen(bytes, {
    weg: (wg) => {
      // Erst das Gebiet pruefen (billig), dann die Kennzeichen (teuer).
      let drin = false;
      for (const r of wg.refs) {
        if (lat.has(r)) {
          drin = true;
          break;
        }
      }
      if (!drin) return;
      const tags = wg.tags();
      let treffer = false;
      for (const s in tags) {
        if (VORRAT_SCHLUESSEL.has(s)) {
          treffer = true;
          break;
        }
      }
      if (!treffer) return;
      wege.push({ id: wg.id, refs: wg.refs, tags });
      for (const r of wg.refs) if (!lat.has(r)) fehlend.add(r);
    },
  });
  melde?.(`  Auszug 2/3: ${wege.length.toLocaleString('de-DE')} Wege, ${fehlend.size.toLocaleString('de-DE')} Knoten fehlen noch (${((Date.now() - t1) / 1000).toFixed(1)} s)`);

  // --- 3. Fehlende Knoten nachlesen -----------------------------------------
  const t2 = Date.now();
  if (fehlend.size) {
    pbfLesen(bytes, {
      knoten: (k) => {
        if (!fehlend.has(k.id)) return;
        lat.set(k.id, k.lat);
        lon.set(k.id, k.lon);
      },
    });
  }
  let ohneKoordinate = 0;
  for (const r of fehlend) if (!lat.has(r)) ohneKoordinate++;
  melde?.(`  Auszug 3/3: nachgelesen, ${ohneKoordinate} Knoten bleiben ohne Koordinate (${((Date.now() - t2) / 1000).toFixed(1)} s)`);

  // --- Elemente bauen --------------------------------------------------------
  const nachSchluessel = new Map<string, VorratElement[]>();
  const eintragen = (v: VorratElement) => {
    for (const s in v.el.tags) {
      if (!VORRAT_SCHLUESSEL.has(s)) continue;
      const liste = nachSchluessel.get(s);
      if (liste) liste.push(v);
      else nachSchluessel.set(s, [v]);
    }
  };
  for (const k of knotenElemente) eintragen(k);
  for (const wg of wege) {
    const geometry: ({ lat: number; lon: number } | null)[] = [];
    let aMinLat = 90;
    let aMaxLat = -90;
    let aMinLon = 180;
    let aMaxLon = -180;
    for (const r of wg.refs) {
      const la = lat.get(r);
      const lo = lon.get(r);
      if (la === undefined || lo === undefined) {
        // Genau wie Overpass bei `out geom`: fehlende Stuetzstelle bleibt eine
        // Luecke und wird nicht erfunden.
        geometry.push(null);
        continue;
      }
      geometry.push({ lat: la, lon: lo });
      if (la < aMinLat) aMinLat = la;
      if (la > aMaxLat) aMaxLat = la;
      if (lo < aMinLon) aMinLon = lo;
      if (lo > aMaxLon) aMaxLon = lo;
    }
    if (aMaxLat < aMinLat) continue; // kein einziger Punkt bekannt
    eintragen({ el: { type: 'way', id: wg.id, tags: wg.tags, geometry }, minLat: aMinLat, maxLat: aMaxLat, minLon: aMinLon, maxLon: aMaxLon });
  }

  melde?.(`  Auszug fertig: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${datei.pfad} (Stand ${datei.stand.toLocaleDateString('de-DE')})`);
  return {
    minLat,
    minLon,
    maxLat,
    maxLon,
    nachSchluessel,
    stand: datei.stand,
    datei: datei.pfad,
    knoten: knotenElemente.length,
    wege: wege.length,
  };
}

/** Vorrat fuer dieses Gebiet bereitstellen — vorhandenen wiederverwenden. */
export function vorratBereit(bbox: BBox, melde?: (s: string) => void): Vorrat {
  const w = bboxNachWgs(bbox);
  if (vorrat && w.minLat >= vorrat.minLat && w.maxLat <= vorrat.maxLat && w.minLon >= vorrat.minLon && w.maxLon <= vorrat.maxLon) {
    return vorrat;
  }
  vorrat = vorratAufbauen(bbox, melde);
  return vorrat;
}

/** Vorrat vorab fuer ein GROSSES Gebiet bauen (Stadtlauf: einmal statt 26-mal). */
export function vorratVorbereiten(bbox: BBox, melde?: (s: string) => void): void {
  vorratBereit(bbox, melde);
}

/** Welcher Auszug hat geliefert — fuer den Quellennachweis. */
export function auszugStand(): { datei: string; stand: Date } | null {
  return vorrat ? { datei: vorrat.datei, stand: vorrat.stand } : null;
}

// ---------------------------------------------------------------------------
// Abfrage beantworten
// ---------------------------------------------------------------------------

/**
 * Beantwortet eine Overpass-Abfrage aus dem Vorrat.
 *
 * Die Reihenfolge der Elemente ist die des Vorrats, nicht die von Overpass.
 * Das ist zulaessig: Overpass sichert keine Reihenfolge zu, und alle Auswerter
 * dieses Projekts arbeiten mengenweise. Doppelte (ein Element, das zwei
 * Bedingungen erfuellt) werden entfernt — Overpass tut das mit `(…)` ebenso.
 */
export function auszugAbfrage(rumpf: string, bbox: BBox): OsmElement[] {
  const v = vorratBereit(bbox);
  const w = bboxNachWgs(bbox);
  const bedingungen = abfrageLesen(rumpf);

  const raus: OsmElement[] = [];
  const gesehen = new Set<string>();
  for (const b of bedingungen) {
    for (const v2 of v.nachSchluessel.get(b.schluessel) ?? []) {
      if (v2.el.type !== b.typ) continue;
      // Gebiet: Overpass liefert alles, was das Rechteck BERUEHRT.
      if (v2.maxLat < w.minLat || v2.minLat > w.maxLat || v2.maxLon < w.minLon || v2.minLon > w.maxLon) continue;
      const wert = v2.el.tags?.[b.schluessel];
      if (wert === undefined) continue;
      if (b.wert !== undefined && wert !== b.wert) continue;
      if (b.regex && !b.regex.test(wert)) continue;
      const schluessel = `${v2.el.type}${v2.el.id}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      raus.push(v2.el);
    }
  }
  return raus;
}

// ---------------------------------------------------------------------------
// Sonderfall: eine benannte Relation mit voller Geometrie
// ---------------------------------------------------------------------------

/**
 * `relation(<id>);out geom;` — im Stadtlauf die Stadtgrenze.
 *
 * BEWUSST OHNE VORRAT: Diese Abfrage kommt genau einmal je Stadtlauf, und die
 * Stadtgrenze ist nichts, was der schluesselgefilterte Vorrat fuehrt (ihre
 * Teilstuecke tragen oft gar keine Kennzeichen). Drei eigene Durchgaenge sind
 * ehrlicher als eine Sonderregel im Vorrat.
 *
 * Rueckgabe hat die Form, die der Aufrufer von Overpass kennt: EIN Element mit
 * `members`, jedes Mitglied mit Rolle und Geometrie.
 */
export function relationMitGeometrie(id: number): OsmElement[] {
  const datei = auszugDatei();
  if (!datei) throw new Error(`Kein OSM-Ortsauszug in ${AUSZUG_ORDNER}.`);
  const roh = fs.readFileSync(datei.pfad);
  const bytes = new Uint8Array(roh.buffer, roh.byteOffset, roh.byteLength);

  let gefunden: { tags: Record<string, string>; mitglieder: { typ: string; ref: number; rolle: string }[] } | null = null;
  pbfLesen(bytes, {
    relation: (r) => {
      if (r.id !== id) return;
      gefunden = { tags: r.tags(), mitglieder: r.mitglieder.map((m) => ({ typ: m.typ, ref: m.ref, rolle: m.rolle })) };
    },
  });
  if (!gefunden) throw new Error(`Auszug: Relation ${id} kommt in ${datei.pfad} nicht vor.`);
  const rel = gefunden as { tags: Record<string, string>; mitglieder: { typ: string; ref: number; rolle: string }[] };

  const wegIds = new Set(rel.mitglieder.filter((m) => m.typ === 'way').map((m) => m.ref));
  const knotenIds = new Set(rel.mitglieder.filter((m) => m.typ === 'node').map((m) => m.ref));
  const refs = new Map<number, number[]>();
  pbfLesen(bytes, {
    weg: (wg) => {
      if (!wegIds.has(wg.id)) return;
      refs.set(wg.id, wg.refs);
      for (const r of wg.refs) knotenIds.add(r);
    },
  });
  const lat = new Map<number, number>();
  const lon = new Map<number, number>();
  pbfLesen(bytes, {
    knoten: (k) => {
      if (!knotenIds.has(k.id)) return;
      lat.set(k.id, k.lat);
      lon.set(k.id, k.lon);
    },
  });

  const members = rel.mitglieder.map((m) => {
    if (m.typ === 'way') {
      const geometry = (refs.get(m.ref) ?? [])
        .map((r) => {
          const la = lat.get(r);
          const lo = lon.get(r);
          return la === undefined || lo === undefined ? null : { lat: la, lon: lo };
        })
        .filter((p): p is { lat: number; lon: number } => p !== null);
      return { type: 'way', ref: m.ref, role: m.rolle, geometry };
    }
    if (m.typ === 'node') {
      const la = lat.get(m.ref);
      const lo = lon.get(m.ref);
      return { type: 'node', ref: m.ref, role: m.rolle, lat: la, lon: lo };
    }
    return { type: m.typ, ref: m.ref, role: m.rolle };
  });

  return [{ type: 'relation', id, tags: rel.tags, members } as unknown as OsmElement];
}
