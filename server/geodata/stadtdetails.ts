/**
 * OpenStreetMap — STADTDETAILS: was einen Ort wiedererkennbar macht.
 *
 * WARUM DIESES MODUL:
 * Bodenzeichnung (osm.ts) und LoD2-Gebaeude (lod2.ts) ergeben zusammen eine
 * korrekte, aber leere Welt: Flaechen und Kloetze. Der Auftraggeber vergleicht
 * mit der Satellitenansicht und verlangt, dass man „Fusswege erkennt, Schienen
 * erkennt, Haltestellen erkennt". Genau das steht hier: Baeume, Gleise,
 * Haltestellen, Mauern, Zaeune, Hecken, Bordsteine, Laternen, Baenke, Poller,
 * Brunnen — und Zebrastreifen als Bodenmarkierung.
 *
 * KEINE Fotos, keine Texturen: jedes Element kommt mit Lage und Mass aus OSM
 * und wird als echter Koerper gebaut.
 *
 * EHRLICHKEIT DER MASSE (dieselbe Regel wie in osm.ts):
 * Gemessene OSM-Werte (`height`, `est_height`, `diameter_crown`, `gauge`,
 * `width`) schlagen immer die Klassenannahme. Wo eine Klassenannahme greift,
 * ist das an Ort und Stelle kommentiert und bei Baeumen zusaetzlich im Datum
 * vermerkt (`GelaendePunktObjekt.gemessen = false`). Eine Annahme ist keine
 * Messung und darf nie als amtliches Mass gelten.
 *
 * Lizenz: ODbL 1.0 — DETAIL_QUELLE MUSS mit ausgeliefert werden.
 *
 * Overpass-Nutzungsregeln (eine Anfrage gleichzeitig, Cache, sprechender
 * User-Agent) sind NICHT neu gebaut, sondern aus osm.ts uebernommen:
 * `overpass()` bringt Warteschlange, Dateicache und Wiederholversuch mit.
 */

import type {
  BBox,
  GelaendeFlaeche,
  GelaendeLinienObjekt,
  GelaendePunktObjekt,
  LinienArt,
  Punkt,
  PunktArt,
  Quellennachweis,
  Ring,
} from '../../shared/domain/types.ts';
import {
  abstand,
  abstandPunktStrecke,
  aufPolylinie,
  bandRing,
  bboxEnthaelt,
  bboxErweitern,
  bboxUeberschneidet,
  bboxVonPunkten,
  flaeche,
  lot,
  norm,
  polylinieLaenge,
  ringNormalisieren,
  schwerpunkt,
  sub,
} from '../../shared/geo/geometry.ts';
import { bboxNachWgs, nachUtm } from '../../shared/geo/proj.ts';
import type { OsmElement } from './osm.ts';
import { OSM_QUELLE, OSM_RANG, osmBreite, overpass, punkteNachUtm, standardUserAgent } from './osm.ts';

// ---------------------------------------------------------------------------
// Quellennachweis
// ---------------------------------------------------------------------------

export const DETAIL_QUELLE: Omit<Quellennachweis, 'abgerufenAm'> = {
  datensatz:
    'OpenStreetMap Stadtdetails (Baeume, Gleise, Haltestellen, Mauern/Zaeune/Hecken, Strassenmoebel, Ueberwege)',
  dienst: 'Overpass API',
  url: OSM_QUELLE.url,
  lizenz: OSM_QUELLE.lizenz,
  quellenvermerk: OSM_QUELLE.quellenvermerk,
};

export interface DetailOpts {
  userAgent?: string;
}

export interface Stadtdetails {
  punkte: GelaendePunktObjekt[];
  linien: GelaendeLinienObjekt[];
  /** Bahnsteige und Zebrastreifen — sie gehoeren in Gelaende.flaechen. */
  zusatzflaechen: GelaendeFlaeche[];
}

/** Was ausserhalb des Gebiets plus diesem Rand liegt, wird verworfen. */
const RAND_M = 50;

/** Kleinste sinnvolle Flaeche (identisch zu osm.ts) — darunter ist es Rauschen. */
const MIN_FLAECHE = 0.25;

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

/** Zentimeter genuegen und halbieren die Dateigroesse. */
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

function p2(p: Punkt): Punkt {
  return [r2(p[0]), r2(p[1])];
}

function linie2(l: Punkt[]): Punkt[] {
  return l.map(p2);
}

/** Erste Zahl aus einem OSM-Wert („1000", „1435;1000", „ca. 2,5"). */
function zahlAus(text: string | undefined): number | null {
  if (!text) return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function text(wert: string | undefined): string | undefined {
  const t = wert?.trim();
  return t ? t : undefined;
}

/** Lage eines KNOTENS in EPSG:25832 (`out geom` liefert lat/lon am Element). */
function knotenPos(el: OsmElement): Punkt | null {
  if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return null;
  return nachUtm([el.lon as number, el.lat as number]);
}

/**
 * Mittelpunkt eines WEGES: bei geschlossenen Wegen (Bahnsteig, Fahrradstaender)
 * der Flaechenschwerpunkt, bei offenen die Mitte der Laufstrecke. Ein blosser
 * Mittelwert der Stuetzpunkte waere bei ungleich dichter Stuetzung schief.
 */
function wegMitte(linie: Punkt[]): Punkt | null {
  if (!linie.length) return null;
  if (linie.length === 1) return linie[0];
  const geschlossen = abstand(linie[0], linie[linie.length - 1]) < 0.05;
  if (geschlossen) {
    const ring = ringNormalisieren(linie);
    if (ring.length >= 3) return schwerpunkt(ring);
  }
  const l = polylinieLaenge(linie);
  return l > 0 ? aufPolylinie(linie, l / 2).p : linie[0];
}

/** Lage eines Elements — Knoten direkt, Weg ueber seinen Mittelpunkt. */
function elementPos(el: OsmElement): Punkt | null {
  if (el.type === 'node') return knotenPos(el);
  const linie = punkteNachUtm(el.geometry);
  return linie.length ? wegMitte(linie) : null;
}

/**
 * Schneidet EIN Segment am Gebietsrand ab (Liang-Barsky).
 * Rueckgabe null = das Segment liegt vollstaendig draussen.
 */
function segmentAufGebiet(a: Punkt, b: Punkt, k: BBox): [Punkt, Punkt] | null {
  const dE = b[0] - a[0];
  const dN = b[1] - a[1];
  const kanten: [number, number][] = [
    [-dE, a[0] - k.minE],
    [dE, k.maxE - a[0]],
    [-dN, a[1] - k.minN],
    [dN, k.maxN - a[1]],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of kanten) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null; // parallel und ausserhalb
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [a[0] + dE * t0, a[1] + dN * t0],
    [a[0] + dE * t1, a[1] + dN * t1],
  ];
}

/**
 * Kuerzt eine Polylinie AUF das Gebiet und zerlegt sie dabei in die Teile, die
 * darin liegen.
 *
 * Unterschied zu `abschnitteImGebiet` in osm.ts: dort bleibt ein Segment GANZ
 * erhalten, sobald es das Gebiet beruehrt. Fuer Korridorflaechen ist das
 * richtig (sie enden sonst hart an der Kante), fuer Gleise und Mauern nicht —
 * eine Strassenbahnstrecke lief damit bis zu 108 m ueber das Zielgebiet hinaus
 * (nachgemessen 07.08.2026). Hier wird am Rand geschnitten.
 */
function linieAufGebiet(linie: Punkt[], k: BBox): Punkt[][] {
  const teile: Punkt[][] = [];
  let aktuell: Punkt[] = [];
  const ablegen = () => {
    if (aktuell.length >= 2) teile.push(aktuell);
    aktuell = [];
  };
  for (let i = 1; i < linie.length; i++) {
    const s = segmentAufGebiet(linie[i - 1], linie[i], k);
    if (!s) {
      ablegen();
      continue;
    }
    const letzter = aktuell[aktuell.length - 1];
    // Ein Sprung bedeutet: die Linie war zwischendurch draussen -> neuer Teil.
    if (!letzter) aktuell.push(s[0]);
    else if (abstand(letzter, s[0]) > 1e-6) {
      ablegen();
      aktuell.push(s[0]);
    }
    if (abstand(aktuell[aktuell.length - 1], s[1]) > 1e-6) aktuell.push(s[1]);
  }
  ablegen();
  return teile;
}

function gebietsfilter(bbox: BBox): string {
  const w = bboxNachWgs(bbox);
  // Der Filter steht an JEDER Teilabfrage — Overpass QL kennt keinen
  // Bbox-Filter auf eine Anweisungsgruppe (siehe Kommentar in osm.ts).
  return `(${w.minLat},${w.minLon},${w.maxLat},${w.maxLon})`;
}

/** Kompassrichtungen aus `direction` („NE", „SSW"). */
const KOMPASS: Record<string, number> = {
  n: 0,
  nne: 22.5,
  ne: 45,
  ene: 67.5,
  e: 90,
  ese: 112.5,
  se: 135,
  sse: 157.5,
  s: 180,
  ssw: 202.5,
  sw: 225,
  wsw: 247.5,
  w: 270,
  wnw: 292.5,
  nw: 315,
  nnw: 337.5,
};

/** `direction` als Grad (0 = Nord, im Uhrzeigersinn) oder undefined. */
function richtungGrad(wert: string | undefined): number | undefined {
  const t = wert?.trim().toLowerCase();
  if (!t) return undefined;
  const buchstaben = KOMPASS[t];
  if (buchstaben !== undefined) return buchstaben;
  const n = zahlAus(t);
  if (n === null) return undefined;
  return r2(((n % 360) + 360) % 360);
}

// ---------------------------------------------------------------------------
// A) Baeume — natural=tree und natural=tree_row
// ---------------------------------------------------------------------------

/**
 * Klassenannahme fuer die Baumhoehe, wenn OSM keine fuehrt.
 * Laubbaeume im Strassenraum erreichen im Mittel rund 12 m, Nadelbaeume
 * wachsen schlanker und hoeher (16 m); ohne jede Angabe bleibt es bei 10 m.
 * ANNAHME, keine Messung — die Objekte tragen dann `gemessen: false`.
 */
const BAUM_HOEHE: Record<string, number> = { broadleaved: 12, needleleaved: 16 };
const BAUM_HOEHE_STANDARD = 10;

const LAUBART: Record<string, NonNullable<GelaendePunktObjekt['laubart']>> = {
  broadleaved: 'laubbaum',
  needleleaved: 'nadelbaum',
  evergreen: 'immergruen',
};

/** Abstand der Einzelbaeume in einer Baumreihe (Allee-Regelpflanzung). */
const BAUMREIHE_ABSTAND_M = 8;

interface BaumMass {
  hoeheM: number;
  kroneM: number;
  gemessen: boolean;
  laubart?: GelaendePunktObjekt['laubart'];
  name?: string;
}

function baumMass(tags: Record<string, string>): BaumMass {
  const blatt = (tags.leaf_type ?? '').trim().toLowerCase();

  // Hoehe: gemessen schlaegt geschaetzt schlaegt Klassenannahme.
  let hoeheM = osmBreite(tags.height) ?? osmBreite(tags.est_height);
  const gemessen = hoeheM !== null;
  if (hoeheM === null) hoeheM = BAUM_HOEHE[blatt] ?? BAUM_HOEHE_STANDARD;

  /*
   * Kronendurchmesser: `diameter_crown` ist die direkte Angabe. Sonst dient
   * der Stammumfang als Naeherung — als Faustzahl der Baumpflege entspricht
   * der Kronendurchmesser in Metern etwa dem Stammumfang in Metern mal 12.
   * Gedeckelt auf 4–18 m, damit ein Tippfehler im Umfang keinen Baum von der
   * Groesse eines Hauses erzeugt. Letzte Rueckfallebene: 55 % der Hoehe.
   */
  let kroneM = osmBreite(tags.diameter_crown);
  if (kroneM === null) {
    const umfangM = zahlAus(tags.circumference);
    if (umfangM !== null && umfangM > 0) kroneM = Math.min(18, Math.max(4, umfangM * 12));
  }
  if (kroneM === null) kroneM = hoeheM * 0.55;

  return {
    hoeheM: r2(hoeheM),
    kroneM: r2(kroneM),
    gemessen,
    laubart: LAUBART[blatt],
    // Art statt Eigenname: „Platanus x hispanica" sagt mehr als „Baum".
    name: text(tags.name) ?? text(tags['species:de']) ?? text(tags.species) ?? text(tags.genus),
  };
}

/** Klassenannahme fuer Einzelstraeucher ohne Massangabe. */
const STRAUCH_HOEHE_M = 1.5;

async function baeume(bbox: BBox, ziel: BBox, ua: string): Promise<GelaendePunktObjekt[]> {
  const g = gebietsfilter(bbox);
  const rumpf =
    `[out:json][timeout:60];(` +
    `node["natural"="tree"]${g};` +
    `node["natural"="shrub"]${g};` +
    `way["natural"="tree_row"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_baeume', bbox, ua);

  const out: GelaendePunktObjekt[] = [];
  for (const el of elemente) {
    const tags = el.tags ?? {};

    // Einzelstrauch: niedriger Busch ohne Stamm — eigene Art, damit die
    // Darstellung ihn nicht als Mini-Baum mit Stamm zeichnet.
    if (el.type === 'node' && tags.natural === 'shrub') {
      const pos = knotenPos(el);
      if (!pos || !bboxEnthaelt(ziel, pos)) continue;
      const hoehe = osmBreite(tags.height);
      const krone = osmBreite(tags.diameter_crown);
      out.push({
        id: `det_strauch_n${el.id}`,
        art: 'strauch',
        pos: p2(pos),
        hoeheM: r2(hoehe ?? STRAUCH_HOEHE_M),
        kroneM: r2(krone ?? Math.max(1, (hoehe ?? STRAUCH_HOEHE_M) * 1.2)),
        gemessen: hoehe !== null,
      });
      continue;
    }

    if (el.type === 'node' && tags.natural === 'tree') {
      const pos = knotenPos(el);
      if (!pos || !bboxEnthaelt(ziel, pos)) continue;
      const m = baumMass(tags);
      out.push({ id: `det_baum_n${el.id}`, art: 'baum', pos: p2(pos), ...m });
      continue;
    }

    /*
     * Baumreihen (Alleen) sind in OSM nur eine LINIE mit einem Tag. Ohne
     * Auffuellung fehlt genau das, was eine Strasse praegt: die Baumreihe.
     * Darum alle 8 m ein Baum entlang der Achse — die Zahl ist der uebliche
     * Pflanzabstand einer Allee, also ebenfalls eine Annahme.
     */
    if (el.type === 'way' && tags.natural === 'tree_row') {
      const achse = punkteNachUtm(el.geometry);
      if (achse.length < 2) continue;
      const m = baumMass(tags);
      let lfd = 0;
      for (const teil of linieAufGebiet(achse, ziel)) {
        const l = polylinieLaenge(teil);
        const anzahl = Math.floor(l / BAUMREIHE_ABSTAND_M) + 1;
        for (let i = 0; i < anzahl; i++) {
          const pos = aufPolylinie(teil, i * BAUMREIHE_ABSTAND_M).p;
          if (!bboxEnthaelt(ziel, pos)) continue;
          out.push({ id: `det_baum_r${el.id}_${lfd++}`, art: 'baum', pos: p2(pos), ...m });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// B) Gleise — railway=tram|rail|light_rail|subway
// ---------------------------------------------------------------------------

const GLEIS_ARTEN = new Set(['tram', 'rail', 'light_rail', 'subway']);

/** Schienenoberkante ueber Grund. */
const GLEIS_HOEHE_M = 0.15;
/** Bahnkoerper mit Schotterbett braucht mehr Platz als eine Rillenschiene. */
const GLEIS_BREITE_BAHNKOERPER_M = 3.0;
const GLEIS_BREITE_STRASSE_M = 2.6;

/** Belaege, die eindeutig fuer eine im Strassenraum eingelassene Schiene sprechen. */
const STRASSENBELAG = new Set(['asphalt', 'paving_stones', 'sett']);

/**
 * HEURISTIK, keine Messung: OSM fuehrt kein Feld „eigener Bahnkoerper".
 * Gewertet wird `embedded=yes` (ausdruecklich eingelassene Rillenschiene) und
 * ein Strassenbelag ueber dem Gleis. Beides fehlt haeufig — dann gilt der
 * Bahnkoerper als eigen. Im Zweifel liegt das Gleis also etwas breiter im
 * Bild, als es tatsaechlich ist.
 *
 * NACHGEMESSEN 07.08.2026, Darmstadt Innenstadt: KEINER der 73 Gleiswege dort
 * traegt `embedded` oder `surface` — die Heuristik liefert also 73 von 73 mal
 * „eigener Bahnkoerper", obwohl die Strecke ueberwiegend im Strassenraum
 * liegt. Das Feld ist damit ein Hinweis, KEINE Aussage ueber den Bestand.
 * Wer es besser braucht, muss es aus dem Liniennetzplan des Betreibers
 * nachtragen — geraten wird hier nicht.
 */
function eigenerBahnkoerper(tags: Record<string, string>): boolean {
  if ((tags.embedded ?? '').trim().toLowerCase() === 'yes') return false;
  const belag = (tags.surface ?? '').trim().toLowerCase();
  if (STRASSENBELAG.has(belag)) return false;
  return true;
}

/** Spurweite: `gauge` steht in MILLIMETERN. */
function spurweiteM(tags: Record<string, string>, art: string): number {
  const mm = zahlAus(tags.gauge);
  if (mm !== null && mm >= 300 && mm <= 3000) return r2(mm / 1000);
  // Darmstadt faehrt Meterspur; Vollbahn und die uebrigen Arten Normalspur.
  return art === 'tram' ? 1.0 : 1.435;
}

async function gleise(bbox: BBox, ziel: BBox, ua: string): Promise<GelaendeLinienObjekt[]> {
  const g = gebietsfilter(bbox);
  // Der Regex laesst abandoned/razed/disused/proposed/construction gar nicht
  // erst durch — das sind eigene Werte von `railway` bzw. eigene Schluessel.
  const rumpf =
    `[out:json][timeout:60];(` +
    `way["railway"~"^(tram|rail|light_rail|subway)$"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_gleise', bbox, ua);

  const out: GelaendeLinienObjekt[] = [];
  for (const el of elemente) {
    if (el.type !== 'way') continue;
    const tags = el.tags ?? {};
    const art = (tags.railway ?? '').trim().toLowerCase();
    if (!GLEIS_ARTEN.has(art)) continue;
    // Doppelt gesichert: ein noch als `railway=rail` gefuehrtes, aber
    // stillgelegtes Gleis liegt nicht mehr im Stadtbild.
    if (tags.disused && tags.disused !== 'no') continue;
    if (tags.abandoned && tags.abandoned !== 'no') continue;
    // Tunnel liegen unter der Oberflaeche. Bruecken bleiben.
    if (tags.tunnel && tags.tunnel !== 'no') continue;

    const achse = punkteNachUtm(el.geometry);
    if (achse.length < 2) continue;

    const eigen = eigenerBahnkoerper(tags);
    const teile = linieAufGebiet(achse, ziel);
    for (let i = 0; i < teile.length; i++) {
      if (teile[i].length < 2) continue;
      out.push({
        id: teile.length === 1 ? `det_gleis_w${el.id}` : `det_gleis_w${el.id}_${i}`,
        art: 'gleis',
        achse: linie2(teile[i]),
        hoeheM: GLEIS_HOEHE_M,
        breiteM: eigen ? GLEIS_BREITE_BAHNKOERPER_M : GLEIS_BREITE_STRASSE_M,
        spurweiteM: spurweiteM(tags, art),
        name: text(tags.name) ?? text(tags.ref),
        eigenerBahnkoerper: eigen,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// C) Haltestellen und Bahnsteige
// ---------------------------------------------------------------------------

/**
 * Ein und dieselbe Haltestelle steht in OSM regelmaessig dreifach: als
 * `railway=tram_stop` am Gleis, als `public_transport=stop_position` und als
 * `public_transport=platform` am Bahnsteig. Ungefiltert stuenden drei Marken
 * uebereinander. Innerhalb dieses Radius gilt gleicher Name = dieselbe Anlage.
 */
const HALTE_BUENDEL_M = 25;

/** Bahnsteig: begehbare, erhoehte Flaeche — dieselbe Ebene wie ein Gehweg. */
const BAHNSTEIG_RANG = OSM_RANG.gehweg;

interface HalteRoh {
  id: string;
  pos: Punkt;
  name?: string;
}

/**
 * Fasst Eintraege desselben Namens innerhalb HALTE_BUENDEL_M zu einem Punkt
 * zusammen (Mittel aller Mitglieder). Namenlose Eintraege werden untereinander
 * ebenso gebuendelt: sie stammen praktisch immer vom selben Halt, der nur an
 * einer seiner Rollen den Namen traegt.
 */
function halteBuendeln(roh: HalteRoh[]): GelaendePunktObjekt[] {
  interface Gruppe {
    id: string;
    name?: string;
    summeE: number;
    summeN: number;
    anzahl: number;
    mitte: Punkt;
  }
  const gruppen: Gruppe[] = [];
  for (const h of roh) {
    const schluessel = (h.name ?? '').toLowerCase();
    let treffer: Gruppe | null = null;
    for (const gr of gruppen) {
      if ((gr.name ?? '').toLowerCase() !== schluessel) continue;
      if (abstand(gr.mitte, h.pos) <= HALTE_BUENDEL_M) {
        treffer = gr;
        break;
      }
    }
    if (treffer) {
      treffer.summeE += h.pos[0];
      treffer.summeN += h.pos[1];
      treffer.anzahl += 1;
      treffer.mitte = [treffer.summeE / treffer.anzahl, treffer.summeN / treffer.anzahl];
    } else {
      gruppen.push({ id: h.id, name: h.name, summeE: h.pos[0], summeN: h.pos[1], anzahl: 1, mitte: h.pos });
    }
  }
  return gruppen.map((gr) => ({
    id: gr.id,
    art: 'haltestelle' as PunktArt,
    pos: p2(gr.mitte),
    name: gr.name,
  }));
}

async function haltestellen(
  bbox: BBox,
  ziel: BBox,
  ua: string,
): Promise<{ punkte: GelaendePunktObjekt[]; flaechen: GelaendeFlaeche[] }> {
  const g = gebietsfilter(bbox);
  const rumpf =
    `[out:json][timeout:60];(` +
    `node["railway"="tram_stop"]${g};` +
    `node["highway"="bus_stop"]${g};` +
    `node["public_transport"~"^(platform|stop_position)$"]${g};` +
    `way["public_transport"~"^(platform|stop_position)$"]${g};` +
    `way["railway"="platform"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_halte', bbox, ua);

  const roh: HalteRoh[] = [];
  const flaechen: GelaendeFlaeche[] = [];

  for (const el of elemente) {
    const tags = el.tags ?? {};
    const oepnv = (tags.public_transport ?? '').trim().toLowerCase();
    const istHalt =
      tags.railway === 'tram_stop' ||
      tags.highway === 'bus_stop' ||
      oepnv === 'platform' ||
      oepnv === 'stop_position';

    const pos = elementPos(el);
    if (istHalt && pos && bboxEnthaelt(ziel, pos)) {
      roh.push({
        id: `det_halt_${el.type === 'node' ? 'n' : 'w'}${el.id}`,
        pos,
        name: text(tags.name),
      });
    }

    // Bahnsteige sind zusaetzlich eine echte Flaeche — ohne sie schwebt die
    // Haltestellenmarke ueber der Fahrbahn statt ueber dem Steig.
    if (el.type === 'way' && (tags.railway === 'platform' || oepnv === 'platform')) {
      const linie = punkteNachUtm(el.geometry);
      if (linie.length < 4 || abstand(linie[0], linie[linie.length - 1]) > 0.05) continue;
      const ring = ringNormalisieren(linie2(linie));
      if (ring.length < 3 || flaeche(ring) < MIN_FLAECHE) continue;
      if (!bboxUeberschneidet(bboxVonPunkten(ring), ziel)) continue;
      flaechen.push({
        id: `det_bahnsteig_w${el.id}`,
        art: 'platz',
        polygon: ring,
        quelle: 'osm',
        bezeichnung: text(tags.name) ?? 'Bahnsteig',
        rang: BAHNSTEIG_RANG,
        belag: 'bahnsteig',
      });
    }
  }

  return { punkte: halteBuendeln(roh), flaechen };
}

// ---------------------------------------------------------------------------
// D) Barrieren — Mauern, Stadtmauern, Zaeune, Hecken, Bordsteine, Gelaender
// ---------------------------------------------------------------------------

const BARRIERE_ART: Record<string, LinienArt> = {
  wall: 'mauer',
  city_wall: 'stadtmauer',
  fence: 'zaun',
  hedge: 'hecke',
  kerb: 'bordstein',
  handrail: 'gelaender',
  guard_rail: 'gelaender',
  // Eine Stuetzmauer ist baulich eine Mauer; die Hangseite kennt OSM nicht.
  retaining_wall: 'mauer',
};

/** Klassenannahmen in Metern, wenn OSM keine `height` fuehrt. */
const BARRIERE_HOEHE: Record<LinienArt, number> = {
  mauer: 1.8,
  stadtmauer: 4.0,
  zaun: 1.2,
  hecke: 1.4,
  bordstein: 0.12,
  gelaender: 1.0,
  gleis: GLEIS_HOEHE_M,
  // Portale entstehen NICHT hier, sondern beim Hoehenband
  // (server/geodata/hoehenband.ts) — dort steht ihre lichte Hoehe. Der Wert
  // hier ist nur der Rueckfall, falls jemand ein Portal aus OSM erzeugt.
  portal: 2.2,
  // Markierungen sind Farbe auf der Fahrbahn — praktisch ohne Bauhoehe.
  markierung: 0.02,
};

/** Dicke quer zur Achse — durchweg Klassenannahme, OSM fuehrt sie fast nie. */
const BARRIERE_BREITE: Record<LinienArt, number> = {
  mauer: 0.4,
  stadtmauer: 1.2,
  zaun: 0.1,
  hecke: 0.8,
  bordstein: 0.25,
  markierung: 0.12,
  gelaender: 0.08,
  portal: 0.35,
  gleis: GLEIS_BREITE_STRASSE_M,
};

/** Poller: Klassenhoehe eines Strassenpollers. */
const POLLER_HOEHE_M = 0.9;

async function barrieren(
  bbox: BBox,
  ziel: BBox,
  ua: string,
): Promise<{ linien: GelaendeLinienObjekt[]; punkte: GelaendePunktObjekt[] }> {
  const g = gebietsfilter(bbox);
  // barrier=bollard ist ein PUNKT (Poller), kein Linienzug — er wird hier
  // gleich mitgeholt, damit die Strassenmoebel-Abfrage ihn nicht doppelt
  // liefert.
  const rumpf =
    `[out:json][timeout:60];(` +
    `way["barrier"]${g};` +
    `node["barrier"="bollard"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_barrieren', bbox, ua);

  const linien: GelaendeLinienObjekt[] = [];
  const punkte: GelaendePunktObjekt[] = [];

  for (const el of elemente) {
    const tags = el.tags ?? {};
    const roh = (tags.barrier ?? '').trim().toLowerCase();

    if (el.type === 'node') {
      if (roh !== 'bollard') continue;
      const pos = knotenPos(el);
      if (!pos || !bboxEnthaelt(ziel, pos)) continue;
      punkte.push({
        id: `det_poller_n${el.id}`,
        art: 'poller',
        pos: p2(pos),
        hoeheM: osmBreite(tags.height) ?? POLLER_HOEHE_M,
        gemessen: osmBreite(tags.height) !== null,
      });
      continue;
    }

    if (el.type !== 'way') continue;
    const art = BARRIERE_ART[roh];
    if (!art) continue; // gate, block, lift_gate … sind keine Linienbauwerke
    const achse = punkteNachUtm(el.geometry);
    if (achse.length < 2) continue;

    const gemessen = osmBreite(tags.height);
    const hoeheM = gemessen ?? BARRIERE_HOEHE[art];
    const breiteM = osmBreite(tags.width) ?? BARRIERE_BREITE[art];

    const teile = linieAufGebiet(achse, ziel);
    for (let i = 0; i < teile.length; i++) {
      if (teile[i].length < 2) continue;
      linien.push({
        id: teile.length === 1 ? `det_${art}_w${el.id}` : `det_${art}_w${el.id}_${i}`,
        art,
        achse: linie2(teile[i]),
        hoeheM: r2(hoeheM),
        breiteM: r2(breiteM),
        name: text(tags.name),
      });
    }
  }
  return { linien, punkte };
}

// ---------------------------------------------------------------------------
// E) Strassenmoebel — Baenke, Laternen, Brunnen, Papierkoerbe, Fahrradstaender
// ---------------------------------------------------------------------------

const MOEBEL_ART: Record<string, PunktArt> = {
  bench: 'bank',
  fountain: 'brunnen',
  drinking_water: 'trinkwasser',
  waste_basket: 'papierkorb',
  bicycle_parking: 'fahrradstaender',
};

/** Klassenhoehe einer Strassenlaterne, wenn OSM keine fuehrt. */
const LATERNE_HOEHE_M = 5;

async function strassenmoebel(
  bbox: BBox,
  ziel: BBox,
  ua: string,
): Promise<{ punkte: GelaendePunktObjekt[]; flaechen: GelaendeFlaeche[]; linien: GelaendeLinienObjekt[] }> {
  const g = gebietsfilter(bbox);
  // Brunnen und Fahrradstaender sind haeufig als FLAECHE erfasst — dann zaehlt
  // ihr Mittelpunkt, sonst fehlten sie ganz.
  const rumpf =
    `[out:json][timeout:60];(` +
    `node["amenity"~"^(bench|fountain|drinking_water|waste_basket|bicycle_parking)$"]${g};` +
    `way["amenity"~"^(fountain|bicycle_parking)$"]${g};` +
    `node["highway"="street_lamp"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_moebel', bbox, ua);

  const out: GelaendePunktObjekt[] = [];
  const flaechen: GelaendeFlaeche[] = [];
  const linien: GelaendeLinienObjekt[] = [];
  for (const el of elemente) {
    const tags = el.tags ?? {};
    const amenity = (tags.amenity ?? '').trim().toLowerCase();
    const istLaterne = tags.highway === 'street_lamp';
    const art = istLaterne ? 'laterne' : MOEBEL_ART[amenity];
    if (!art) continue;

    // Als FLAECHE erfasste Brunnen bekommen ihre ECHTE Geometrie: das
    // Wasserbecken als Auflage-Flaeche, der Beckenrand als niedrige Mauer
    // entlang des Rings. Die pauschale 3-m-Scheibe aus dem Punkt-Pfad waere
    // fuer den grossen Herrngarten-Brunnen schlicht falsch.
    if (art === 'brunnen' && el.type === 'way') {
      const ring = ringNormalisieren(punkteNachUtm(el.geometry).map(p2));
      if (ring.length >= 3 && flaeche(ring) >= 4) {
        // Flaechenschwerpunkt, NICHT wegMitte(): ringNormalisieren entfernt den
        // Schlusspunkt, damit greift die geschlossen-Erkennung in wegMitte
        // nicht mehr und sie liefert die Streckenmitte des Umrings — bei einem
        // runden Becken ein Punkt auf dem Rand statt in der Mitte.
        const mitte = schwerpunkt(ring);
        if (bboxEnthaelt(ziel, mitte)) {
          flaechen.push({
            id: `det_brunnen_w${el.id}`,
            art: 'wasser',
            polygon: ring,
            quelle: 'osm',
            bezeichnung: text(tags.name) ?? 'Brunnen',
            rang: OSM_RANG.treppe + 1, // Auflage auf Platz/Gehweg
            belag: 'wasserbecken',
          });
          linien.push({
            id: `det_brunnenrand_w${el.id}`,
            art: 'mauer',
            achse: [...ring, ring[0]],
            hoeheM: 0.4,
            breiteM: 0.3,
          });
        }
        continue;
      }
    }

    const pos = elementPos(el);
    if (!pos || !bboxEnthaelt(ziel, pos)) continue;

    const hoehe = osmBreite(tags.height);
    const eintrag: GelaendePunktObjekt = {
      id: `det_${art}_${el.type === 'node' ? 'n' : 'w'}${el.id}`,
      art,
      pos: p2(pos),
      name: text(tags.name),
    };
    if (istLaterne) {
      eintrag.hoeheM = r2(hoehe ?? LATERNE_HOEHE_M);
      eintrag.gemessen = hoehe !== null;
    } else if (hoehe !== null) {
      eintrag.hoeheM = r2(hoehe);
      eintrag.gemessen = true;
    }
    // Eine Bank hat eine Blickrichtung — ohne sie stuenden alle Baenke gleich.
    if (art === 'bank') eintrag.drehungGrad = richtungGrad(tags.direction);
    out.push(eintrag);
  }
  return { punkte: out, flaechen, linien };
}

// ---------------------------------------------------------------------------
// F) Ueberwege — Zebrastreifen als Bodenmarkierung
// ---------------------------------------------------------------------------

/** Laenge quer zur Fahrbahn und Tiefe in Fahrtrichtung (Regelmasse RASt 06). */
const ZEBRA_QUER_M = 4;
const ZEBRA_LAENGS_M = 3;

/** Eine Markierung liegt AUF allem — sie ist Farbe auf dem Belag. */
const ZEBRA_RANG = OSM_RANG.treppe + 2;

/** Naeher als das an einem Ueberweg-WEG liegt der Knoten desselben Uebergangs. */
const ZEBRA_DOPPEL_M = 4;

/** Fahrbahnklassen, deren Achse die Ausrichtung des Zebrastreifens vorgibt. */
const ZEBRA_ACHSE_KLASSEN =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|busway)(_link)?$';

/** Ein „unmarked crossing" traegt keine Markierung — dort waere ein Zebra gelogen. */
function traegtMarkierung(tags: Record<string, string>): boolean {
  const c = (tags.crossing ?? '').trim().toLowerCase();
  if (c === 'unmarked' || c === 'no' || c === 'informal') return false;
  return (tags['crossing:markings'] ?? '').trim().toLowerCase() !== 'no';
}

function zebraFlaeche(id: string, ring: Ring, name?: string): GelaendeFlaeche | null {
  const sauber = ringNormalisieren(ring.map(p2));
  if (sauber.length < 3 || flaeche(sauber) < MIN_FLAECHE) return null;
  return {
    id,
    art: 'gehweg',
    polygon: sauber,
    quelle: 'osm',
    bezeichnung: name ?? 'Fussgaengerueberweg',
    rang: ZEBRA_RANG,
    belag: 'zebra',
  };
}

async function ueberwege(bbox: BBox, ziel: BBox, ua: string): Promise<GelaendeFlaeche[]> {
  const g = gebietsfilter(bbox);
  /*
   * Die Fahrbahnachsen stecken bewusst in DERSELBEN Abfrage: ein
   * `highway=crossing` ist nur ein Knoten ohne eigene Richtung — erst die
   * Achse der Strasse, auf der er liegt, sagt, wie der Zebrastreifen liegt.
   */
  const rumpf =
    `[out:json][timeout:60];(` +
    `node["highway"="crossing"]${g};` +
    `way["footway"="crossing"]${g};` +
    `way["highway"~"${ZEBRA_ACHSE_KLASSEN}"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_ueberwege', bbox, ua);

  const achsen: Punkt[][] = [];
  const knoten: OsmElement[] = [];
  const wege: OsmElement[] = [];

  for (const el of elemente) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      if (tags.highway === 'crossing') knoten.push(el);
      continue;
    }
    if (el.type !== 'way') continue;
    if (tags.footway === 'crossing') {
      wege.push(el);
      continue;
    }
    if (tags.highway) {
      const linie = punkteNachUtm(el.geometry);
      if (linie.length >= 2) achsen.push(linie);
    }
  }

  const out: GelaendeFlaeche[] = [];
  const wegMittenGesehen: Punkt[] = [];

  // --- Ueberwege, die als eigener WEG erfasst sind ---------------------------
  // Der Weg IST die Querungsachse; das Band darum ist die Markierung.
  for (const el of wege) {
    const tags = el.tags ?? {};
    if (!traegtMarkierung(tags)) continue;
    const linie = punkteNachUtm(el.geometry);
    if (linie.length < 2) continue;
    const teile = linieAufGebiet(linie, ziel);
    for (let i = 0; i < teile.length; i++) {
      const band = bandRing(teile[i], ZEBRA_LAENGS_M);
      if (!band) continue;
      const f = zebraFlaeche(
        teile.length === 1 ? `det_zebra_w${el.id}` : `det_zebra_w${el.id}_${i}`,
        band,
        text(tags.name),
      );
      if (!f) continue;
      out.push(f);
      const m = wegMitte(teile[i]);
      if (m) wegMittenGesehen.push(m);
    }
  }

  // --- Ueberwege, die nur als KNOTEN erfasst sind ---------------------------
  for (const el of knoten) {
    const tags = el.tags ?? {};
    if (!traegtMarkierung(tags)) continue;
    const pos = knotenPos(el);
    if (!pos || !bboxEnthaelt(ziel, pos)) continue;
    // Liegt der Knoten auf einem bereits gezeichneten Ueberweg-Weg, waere er
    // dieselbe Markierung ein zweites Mal.
    if (wegMittenGesehen.some((m) => abstand(m, pos) < ZEBRA_DOPPEL_M)) continue;

    /*
     * Ausrichtung: Richtung der naechstgelegenen Fahrbahnachse. `laengs` zeigt
     * in Fahrtrichtung, `quer` (das Lot) ueber die Fahrbahn — in dieser
     * Richtung liegen die ZEBRA_QUER_M.
     * NAEHERUNG: Findet sich keine Achse, wird der Ueberweg nord-sued
     * ausgerichtet. Das ist geraten und nur besser als gar keine Markierung.
     */
    let laengs: Punkt = [1, 0]; // -> quer = [0,1] = Nord-Sued
    let beste = Infinity;
    for (const achse of achsen) {
      for (let i = 1; i < achse.length; i++) {
        const d = abstandPunktStrecke(pos, achse[i - 1], achse[i]);
        if (d < beste) {
          beste = d;
          laengs = norm(sub(achse[i], achse[i - 1]));
        }
      }
    }
    if (beste > 25) laengs = [1, 0]; // zu weit weg — keine belastbare Zuordnung

    const quer = norm(lot(laengs));
    const hq = ZEBRA_QUER_M / 2;
    const hl = ZEBRA_LAENGS_M / 2;
    const ring: Ring = [
      [pos[0] - quer[0] * hq - laengs[0] * hl, pos[1] - quer[1] * hq - laengs[1] * hl],
      [pos[0] + quer[0] * hq - laengs[0] * hl, pos[1] + quer[1] * hq - laengs[1] * hl],
      [pos[0] + quer[0] * hq + laengs[0] * hl, pos[1] + quer[1] * hq + laengs[1] * hl],
      [pos[0] - quer[0] * hq + laengs[0] * hl, pos[1] - quer[1] * hq + laengs[1] * hl],
    ];
    const f = zebraFlaeche(`det_zebra_n${el.id}`, ring, text(tags.name));
    if (f) out.push(f);
  }

  return out;
}

// ---------------------------------------------------------------------------
// G) Lichtsignalanlagen und Verkehrszeichen
// ---------------------------------------------------------------------------

/**
 * Ampeln (`highway=traffic_signals`) und Verkehrszeichen (`highway=stop`,
 * `highway=give_way`, `traffic_sign=*`).
 *
 * OSM fuehrt diese Elemente als KNOTEN AUF der Fahrbahnachse — nicht dort, wo
 * der Mast wirklich steht. Ein Signalgeber mitten auf der Fahrbahn waere
 * falsch; darum wird der Knoten quer zur Fahrbahn an den Rand versetzt
 * (halbe Fahrbahnbreite + Gehwegabstand) und die Ausrichtung von der
 * Fahrbahnachse uebernommen. Beides ist eine ABLEITUNG aus der Achse, keine
 * Vermessung des Maststandorts — `gemessen` bleibt darum false.
 */
const AMPEL_VERSATZ_M = 5.5;
const ZEICHEN_VERSATZ_M = 4.5;
/** Weiter als das von einer Fahrbahnachse entfernt gilt die Zuordnung nicht. */
const ACHSE_MAX_M = 30;

async function verkehrszeichen(bbox: BBox, ziel: BBox, ua: string): Promise<GelaendePunktObjekt[]> {
  const g = gebietsfilter(bbox);
  const rumpf =
    `[out:json][timeout:60];(` +
    `node["highway"="traffic_signals"]${g};` +
    `node["highway"="stop"]${g};` +
    `node["highway"="give_way"]${g};` +
    `node["traffic_sign"]${g};` +
    `way["highway"~"${ZEBRA_ACHSE_KLASSEN}"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'detail_zeichen', bbox, ua);

  const achsen: Punkt[][] = [];
  const knoten: OsmElement[] = [];
  for (const el of elemente) {
    if (el.type === 'node') {
      knoten.push(el);
      continue;
    }
    if (el.type !== 'way' || !el.tags?.highway) continue;
    const linie = punkteNachUtm(el.geometry);
    if (linie.length >= 2) achsen.push(linie);
  }

  const out: GelaendePunktObjekt[] = [];
  for (const el of knoten) {
    const tags = el.tags ?? {};
    const hw = (tags.highway ?? '').trim();
    const istAmpel = hw === 'traffic_signals';
    const zeichenNr = text(tags.traffic_sign);
    const istZeichen = hw === 'stop' || hw === 'give_way' || Boolean(zeichenNr);
    if (!istAmpel && !istZeichen) continue;

    const pos = knotenPos(el);
    if (!pos || !bboxEnthaelt(ziel, pos)) continue;

    // Naechste Fahrbahnachse suchen — sie gibt Richtung UND Versatzseite vor.
    let laengs: Punkt | null = null;
    let beste = Infinity;
    for (const achse of achsen) {
      for (let i = 1; i < achse.length; i++) {
        const d = abstandPunktStrecke(pos, achse[i - 1], achse[i]);
        if (d < beste) {
          beste = d;
          laengs = norm(sub(achse[i], achse[i - 1]));
        }
      }
    }
    let stand = pos;
    let drehung = 0;
    if (laengs && beste <= ACHSE_MAX_M) {
      const quer = norm(lot(laengs));
      const v = istAmpel ? AMPEL_VERSATZ_M : ZEICHEN_VERSATZ_M;
      stand = [pos[0] + quer[0] * v, pos[1] + quer[1] * v];
      // Der Signalgeber schaut ENTGEGEN der Fahrtrichtung, also auf den
      // ankommenden Verkehr.
      drehung = ((Math.atan2(-laengs[0], -laengs[1]) * 180) / Math.PI + 360) % 360;
    }

    out.push({
      id: `det_${istAmpel ? 'ampel' : 'zeichen'}_n${el.id}`,
      art: istAmpel ? 'ampel' : 'verkehrszeichen',
      pos: p2(stand),
      drehungGrad: r2(drehung),
      // Standort aus der Achse abgeleitet, nicht vermessen.
      gemessen: false,
      ...(zeichenNr ? { zeichen: zeichenNr } : hw === 'stop' ? { zeichen: 'DE:206' } : hw === 'give_way' ? { zeichen: 'DE:205' } : {}),
      name: text(tags.name),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alles zusammen
// ---------------------------------------------------------------------------

/**
 * Holt alle Stadtdetails eines Gebiets.
 *
 * Jede Teilabfrage steht fuer sich: faellt eine aus (Overpass-Drossel,
 * Zeitueberschreitung), bleiben die uebrigen erhalten. Ein Modell ohne Baenke
 * ist besser als gar keins — und der Ausfall wird gemeldet, nicht verschwiegen.
 */
export async function stadtdetails(bbox: BBox, opts?: DetailOpts): Promise<Stadtdetails> {
  const ua = opts?.userAgent ?? standardUserAgent();
  const ziel = bboxErweitern(bbox, RAND_M);

  const punkte: GelaendePunktObjekt[] = [];
  const linien: GelaendeLinienObjekt[] = [];
  const zusatzflaechen: GelaendeFlaeche[] = [];

  async function teil(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      console.warn(`[stadtdetails] ${name} nicht geladen: ${(e as Error).message}`);
    }
  }

  await teil('Baeume', async () => {
    punkte.push(...(await baeume(bbox, ziel, ua)));
  });
  await teil('Gleise', async () => {
    linien.push(...(await gleise(bbox, ziel, ua)));
  });
  await teil('Haltestellen', async () => {
    const h = await haltestellen(bbox, ziel, ua);
    punkte.push(...h.punkte);
    zusatzflaechen.push(...h.flaechen);
  });
  await teil('Barrieren', async () => {
    const b = await barrieren(bbox, ziel, ua);
    linien.push(...b.linien);
    punkte.push(...b.punkte);
  });
  await teil('Strassenmoebel', async () => {
    const m = await strassenmoebel(bbox, ziel, ua);
    punkte.push(...m.punkte);
    zusatzflaechen.push(...m.flaechen);
    linien.push(...m.linien);
  });
  await teil('Ueberwege', async () => {
    zusatzflaechen.push(...(await ueberwege(bbox, ziel, ua)));
  });
  await teil('Verkehrszeichen', async () => {
    punkte.push(...(await verkehrszeichen(bbox, ziel, ua)));
  });

  return { punkte, linien, zusatzflaechen };
}

// ---------------------------------------------------------------------------
// OSM-Gebaeudemerkmale — Farbe, Dachform, Name, Geschosse
// ---------------------------------------------------------------------------

export interface OsmGebaeudeMerkmal {
  /** `roof:colour` — CSS-Farbname oder Hex, unveraendert uebernommen. */
  dachFarbe?: string;
  /** `building:colour`. */
  wandFarbe?: string;
  /** `roof:shape` — gabled, hipped, flat, pyramidal … */
  dachformOsm?: string;
  name?: string;
  /** `building:levels`. */
  geschosse?: number;
  /** Grundriss in EPSG:25832 — Schluessel fuer die Zuordnung ueber die LAGE. */
  grundriss: Ring;
}

/**
 * Liest die OSM-Gebaeude eines Gebiets mit ihren Merkmalen.
 *
 * WOFUER: Das amtliche LoD2-Modell ist geometrisch die Wahrheit, kennt aber
 * weder Farbe noch Name. OSM kennt beides, ist aber geometrisch gruober. Diese
 * Funktion liefert darum den GRUNDRISS mit — damit ein spaeterer Schritt jedes
 * OSM-Gebaeude ueber seine LAGE (Ueberdeckung/Schwerpunkt) dem amtlichen
 * Gebaeude zuordnen kann. Hier wird ausdruecklich NICHT zugeordnet: diese
 * Datei holt Daten, sie verschmilzt sie nicht.
 *
 * Schluessel der Map ist die OSM-Way-Id als Zeichenkette.
 *
 * Farbwerte werden NICHT umgerechnet: OSM fuehrt sowohl „#8b4513" als auch
 * „brown"; beides versteht die CSS-Farbauswertung im Frontend direkt.
 */
export async function osmGebaeudeMerkmale(
  bbox: BBox,
  opts?: DetailOpts,
): Promise<Map<string, OsmGebaeudeMerkmal>> {
  const ua = opts?.userAgent ?? standardUserAgent();
  const ziel = bboxErweitern(bbox, RAND_M);
  const g = gebietsfilter(bbox);
  const rumpf = `[out:json][timeout:60];(way["building"]${g};);out geom;`;
  const elemente = await overpass(rumpf, 'detail_gebaeude', bbox, ua);

  const out = new Map<string, OsmGebaeudeMerkmal>();
  for (const el of elemente) {
    if (el.type !== 'way') continue;
    const tags = el.tags ?? {};
    if ((tags.building ?? '').trim().toLowerCase() === 'no') continue;

    const linie = punkteNachUtm(el.geometry);
    // Nur geschlossene Wege sind Grundrisse.
    if (linie.length < 4 || abstand(linie[0], linie[linie.length - 1]) > 0.05) continue;
    const grundriss = ringNormalisieren(linie2(linie));
    if (grundriss.length < 3 || flaeche(grundriss) < 1) continue;
    if (!bboxUeberschneidet(bboxVonPunkten(grundriss), ziel)) continue;

    const geschosse = zahlAus(tags['building:levels']);
    out.set(String(el.id), {
      dachFarbe: text(tags['roof:colour']),
      wandFarbe: text(tags['building:colour']),
      dachformOsm: text(tags['roof:shape']),
      name: text(tags.name),
      geschosse: geschosse !== null && geschosse >= 1 && geschosse <= 200 ? geschosse : undefined,
      grundriss,
    });
  }
  return out;
}
