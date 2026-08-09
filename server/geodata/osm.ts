/**
 * OpenStreetMap — Wege- und Flaechennetz ueber die Overpass-API.
 *
 * WARUM DIESES MODUL:
 * ALKIS fuehrt den Strassenraum als EINE Verkehrsflaeche. Fahrbahn, Gehweg und
 * Radweg lassen sich daraus nicht trennen — genau diese Trennung fordert der
 * Auftraggeber aber fuer das massgetreue digitale Abbild. OpenStreetMap fuehrt
 * jede dieser Achsen als eigene Linie mit eigener Klasse, oft mit gemessener
 * Breite. Aus Linie + Breite wird hier ein Korridor-Polygon in EPSG:25832.
 *
 * EHRLICHKEIT DER MASSE: `width`/`est_width` sind die einzigen echten Werte.
 * Fehlt beides, wird eine KLASSENANNAHME gesetzt (siehe KLASSEN_BREITE). Das
 * ist eine Annahme, keine Messung — sie darf nie als amtliches Mass gelten.
 * Die geometrische Wahrheit bleibt ALKIS; OSM liefert die Untergliederung.
 *
 * Lizenz: ODbL 1.0. Der Quellenvermerk MUSS mit ausgeliefert werden
 * (OSM_QUELLE -> Gelaende.quellennachweis).
 *
 * Overpass-Nutzungsregeln: aussagekraeftiger User-Agent, hoechstens eine
 * Anfrage gleichzeitig, Ergebnisse zwischenspeichern. Beides ist hier
 * umgesetzt (Warteschlange + Dateicache unter data/cache/osm/).
 */

import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import type {
  BBox,
  FlaechenArt,
  GelaendeFlaeche,
  Punkt,
  Quellennachweis,
  Ring,
} from '../../shared/domain/types.ts';
import {
  abstand,
  bboxErweitern,
  bboxUeberschneidet,
  bboxVonPunkten,
  flaeche,
  ringNormalisieren,
  bandRing,
  wegKorridor,
} from '../../shared/geo/geometry.ts';
import { bboxNachWgs, nachUtm } from '../../shared/geo/proj.ts';
import { RANG } from './nutzung.ts';
import { cache } from '../lib/store.ts';
import { geoKonfig } from './konfig.ts';

// ---------------------------------------------------------------------------
// Quellennachweis
// ---------------------------------------------------------------------------

export const OSM_QUELLE: Omit<Quellennachweis, 'abgerufenAm'> = {
  datensatz: 'OpenStreetMap Wege- und Flaechennetz',
  dienst: 'Overpass API',
  url: 'https://overpass-api.de/api/interpreter',
  lizenz: 'Open Database License (ODbL) 1.0',
  quellenvermerk: '(c) OpenStreetMap-Mitwirkende',
};

const OVERPASS_URL = OSM_QUELLE.url;

/** Ohne Konfiguration wenigstens ein sprechender User-Agent (Overpass-Pflicht). */
export function standardUserAgent(): string {
  try {
    return geoKonfig().geokodierung.userAgent;
  } catch {
    return 'EventPlan3D/1.0 (Veranstaltungsplanung; Kontakt ueber den Betreiber)';
  }
}

// ---------------------------------------------------------------------------
// Zeichenreihenfolge (identisch zu nutzung.ts — hoehere Werte liegen oben)
// ---------------------------------------------------------------------------

// EINE Rangtabelle fuer beide Quellen: die fruehere OSM-eigene Kopie wich bei
// fuenf Klassen von nutzung.RANG ab, obwohl ihr Kommentar Gleichheit
// behauptete — beim Mischen beider Quellen in einer rangsortierten
// Zeichenliste kollidierten dadurch z. B. ALKIS-Gruen (10) und
// OSM-Bebauung (10). Seit dem Palette-Umbau ordnet der Renderer primaer nach
// palette.FLAECHEN_STIL; der gespeicherte Rang bleibt Feinsortierung und
// Traeger des Bruecken-Zuschlags — und muss dafuer quellenuebergreifend
// konsistent sein.
export const OSM_RANG = RANG;

/** Bruecken liegen ueber allem, was an derselben Stelle am Boden liegt. */
const BRUECKEN_ZUSCHLAG = 10;

// ---------------------------------------------------------------------------
// Klassifizierung highway=* -> FlaechenArt + Breitenannahme
// ---------------------------------------------------------------------------

/** Fahrbahn-Klassen (motorisierter Verkehr). */
const FAHRBAHN_KLASSEN = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'busway',
  'living_street',
  'road',
]);

/**
 * Ausdruecklich NICHT zeichnen: Gebaeudeinnenwege, Aufzuege, Bahnsteigkanten,
 * Planungen und Baustellen sind keine Oberflaeche des heutigen Platzes.
 */
const NICHT_ZEICHNEN = new Set([
  'corridor',
  'elevator',
  'platform',
  'proposed',
  'construction',
  'raceway',
]);

/**
 * Klassenannahmen in Metern, wenn OSM keine gemessene Breite fuehrt.
 * Bewusst konservativ: lieber etwas zu schmal als ein zu breiter Gehweg, der
 * eine Engstelle im Pruefbericht verschwinden liesse.
 */
const KLASSEN_BREITE: Record<string, number> = {
  motorway: 12,
  trunk: 10,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  residential: 5.5,
  living_street: 5,
  unclassified: 5,
  road: 5,
  service: 3.5,
  busway: 6.5,
  track: 3,
  pedestrian: 8,
  footway: 2.0,
  cycleway: 2.0,
  path: 1.5,
  steps: 1.8,
};

/** Zufahrtsrampen (…_link) sind fast immer einspurig. */
const LINK_BREITE = 5;

/** Fussgaengerueberwege spannen die Fahrbahn — schmaler waeren sie unsichtbar. */
const CROSSING_BREITE = 3;

function zahlAus(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function plausibleBreite(m: number | null): number | null {
  return m !== null && Number.isFinite(m) && m >= 0.3 && m <= 60 ? m : null;
}

/**
 * Liest eine OSM-Breitenangabe.
 * Erlaubt sind „3.5", „3,5", „3.5 m", Fuss/Zoll („10'", „10'6\"", „12 ft")
 * sowie Listen („2.5;3" — dann gilt der erste Wert).
 */
export function osmBreite(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;

  const fuss = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in|inch)?)?$/.exec(t);
  if (fuss) {
    const f = Number(fuss[1]);
    const z = fuss[2] ? Number(fuss[2]) : 0;
    return plausibleBreite(f * 0.3048 + z * 0.0254);
  }

  const meter = /^(\d+(?:\.\d+)?)\s*(?:m|meter|metre|metres|meters)?$/.exec(t);
  if (meter) return plausibleBreite(Number(meter[1]));

  // Notfall: erste Zahl im Text („ca. 3 m", „2.5;3")
  const erste = /(\d+(?:\.\d+)?)/.exec(t);
  return erste ? plausibleBreite(Number(erste[1])) : null;
}

function istEinbahn(tags: Record<string, string>): boolean {
  // „-1" ist dieselbe Fahrbahn, nur andersherum gerichtet.
  return tags.oneway === 'yes' || tags.oneway === '-1';
}

/**
 * Klassifiziert einen OSM-Weg.
 * Rueckgabe null bedeutet: nicht zeichnen (unbekannte Klasse, Bauplanung,
 * Gebaeudeinnenweg oder TUNNEL — der liegt unter der Oberflaeche).
 * Bruecken erhalten rang + 10, damit sie ueber dem Boden liegen.
 */
export function osmArt(
  tags: Record<string, string>,
): { art: FlaechenArt; breiteM: number; rang: number } | null {
  const roh = (tags.highway ?? tags['area:highway'] ?? '').trim().toLowerCase();
  if (!roh) return null;
  if (NICHT_ZEICHNEN.has(roh)) return null;
  // Tunnel liegen unter der Oberflaeche und gehoeren nicht in die Bodenzeichnung.
  if (tags.tunnel && tags.tunnel !== 'no') return null;

  const istLink = roh.endsWith('_link');
  const basis = istLink ? roh.slice(0, -'_link'.length) : roh;
  if (NICHT_ZEICHNEN.has(basis)) return null;

  let art: FlaechenArt;
  if (basis === 'footway') art = 'gehweg';
  else if (basis === 'cycleway') art = 'radweg';
  else if (basis === 'path') {
    art = tags.bicycle === 'designated' ? 'radweg' : tags.foot === 'designated' ? 'gehweg' : 'weg';
  } else if (basis === 'pedestrian') art = 'fussgaengerzone';
  else if (basis === 'steps') art = 'treppe';
  else if (basis === 'track') art = 'weg';
  else if (FAHRBAHN_KLASSEN.has(basis)) art = 'fahrbahn';
  else return null;

  // --- Breite: echte Angabe schlaegt Spurenzahl schlaegt Klassenannahme -----
  let breiteM = osmBreite(tags.width) ?? osmBreite(tags.est_width);

  if (breiteM === null) {
    const spuren = zahlAus(tags.lanes);
    if (spuren !== null && spuren >= 1 && spuren <= 12) breiteM = spuren * 3.0;
  }

  if (breiteM === null) {
    let klasse: number;
    if (art === 'gehweg' && tags.footway === 'crossing') klasse = CROSSING_BREITE;
    else if (istLink && art === 'fahrbahn') klasse = LINK_BREITE;
    else klasse = KLASSEN_BREITE[basis] ?? 3;
    /*
     * Einbahnstrassen tragen nur eine Fahrtrichtung — die Klassenbreite gilt
     * fuer den Zweirichtungsfall und waere hier zu breit.
     * Bewusst NUR fuer Fahrbahnen: bei Radwegen ist oneway=yes der Regelfall,
     * dort wuerde die Untergrenze von 3 m den Radweg BREITER machen als eine
     * Zweirichtungsspur — das Gegenteil der Absicht.
     */
    if (art === 'fahrbahn' && istEinbahn(tags)) klasse = Math.max(3, klasse / 2);
    breiteM = klasse;
  }

  const brueckeAktiv = Boolean(tags.bridge) && tags.bridge !== 'no';
  return {
    art,
    breiteM,
    rang: OSM_RANG[art] + (brueckeAktiv ? BRUECKEN_ZUSCHLAG : 0),
  };
}

/** Klassifiziert eine OSM-FLAECHE (landuse/leisure/natural/amenity/area:highway). */
export function osmFlaechenArt(
  tags: Record<string, string>,
): { art: FlaechenArt; rang: number } | null {
  const landuse = (tags.landuse ?? '').toLowerCase();
  const leisure = (tags.leisure ?? '').toLowerCase();
  const natural = (tags.natural ?? '').toLowerCase();

  if (landuse === 'forest' || natural === 'wood') return { art: 'wald', rang: OSM_RANG.wald };
  if (natural === 'water') return { art: 'wasser', rang: OSM_RANG.wasser };
  if (leisure === 'park' || leisure === 'garden' || leisure === 'pitch' || leisure === 'playground') {
    return { art: 'gruen', rang: OSM_RANG.gruen };
  }
  if (
    landuse === 'grass' ||
    landuse === 'meadow' ||
    landuse === 'village_green' ||
    landuse === 'recreation_ground' ||
    landuse === 'cemetery'
  ) {
    return { art: 'gruen', rang: OSM_RANG.gruen };
  }
  // scrub steht in der Abfrage, ist aber ebenfalls Gruen (Gestruepp).
  if (natural === 'scrub') return { art: 'gruen', rang: OSM_RANG.gruen };
  if ((tags.amenity ?? '').toLowerCase() === 'parking') {
    return { art: 'fahrbahn', rang: OSM_RANG.fahrbahn };
  }
  if (tags['area:highway']) {
    const k = osmArt(tags);
    return k ? { art: k.art, rang: k.rang } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Overpass-Zugriff: eine Anfrage zur Zeit, Dateicache, ein Wiederholversuch
// ---------------------------------------------------------------------------

export interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  /** Nur bei KNOTEN: `out geom` liefert deren Lage direkt am Element. */
  lat?: number;
  lon?: number;
}

interface OsmCache {
  stand: string;
  bbox: BBox;
  elements: OsmElement[];
}

let warteschlange: Promise<unknown> = Promise.resolve();

/** Overpass-Regel: nur EINE Anfrage gleichzeitig. */
function nacheinander<T>(fn: () => Promise<T>): Promise<T> {
  const p = warteschlange.then(fn, fn);
  warteschlange = p.catch(() => {});
  return p;
}

/** Erkennt die Slot-/Lastsperre von Overpass in der Fehlerseite. */
function istDrossel(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('rate_limited') ||
    t.includes('too many requests') ||
    t.includes('dispatcher_client') ||
    t.includes('please check /api/status') ||
    t.includes('slot available after')
  );
}

/** Holt die lesbare Fehlerzeile aus der HTML-Antwort von Overpass. */
function fehlerText(text: string): string {
  const m = /Error<\/strong>:?\s*([^<]{0,300})/i.exec(text) ?? /(runtime error[^<\n]{0,200})/i.exec(text);
  return (m?.[1] ?? text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)).trim();
}

/**
 * Kurzer, stabiler Hash der Abfrage (FNV-1a) fuer den Cache-Schluessel.
 *
 * OHNE ihn invalidiert der Cache NIE: Der Schluessel bestand nur aus Art und
 * Gebiet, also lieferte eine ERWEITERTE Abfrage weiterhin die alten Elemente
 * aus data/cache/osm/. Real passiert am 08.08.2026: der neue
 * `natural=shrub`-Zweig blieb wirkungslos, bis die Cache-Datei von Hand
 * geloescht wurde. Mit dem Hash bekommt jede geaenderte Abfrage automatisch
 * eine eigene Datei; die alte bleibt liegen und schadet nicht.
 */
function abfrageHash(rumpf: string): string {
  let h = 2166136261;
  for (let i = 0; i < rumpf.length; i++) {
    h ^= rumpf.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Gemeinsamer Namensteil aller Cache-Staende EINER Abfrageart in EINEM Gebiet. */
function cachePraefix(art: string, bbox: BBox): string {
  const r = (x: number) => Math.round(x);
  return `${art}_${r(bbox.minE)}_${r(bbox.minN)}_${r(bbox.maxE)}_${r(bbox.maxN)}`;
}

function cacheSchluessel(art: string, bbox: BBox, rumpf: string): string {
  return `${cachePraefix(art, bbox)}_${abfrageHash(rumpf)}.json`;
}

/**
 * ALTBESTAND als Rueckfall, wenn der Abruf scheitert.
 *
 * Overpass antwortet unter Last mit 429/504. Ohne diesen Rueckfall entstand
 * daraus eine STILLE DATENLUECKE: am 08.08.2026 fielen bei einem Neu-Import
 * Baeume, Barrieren und Ueberwege komplett aus (349 OSM-Baeume weg), weil der
 * Abruf scheiterte und der passende Cache-Eintrag durch eine Abfrage-Aenderung
 * einen neuen Schluessel bekommen hatte. Ein veralteter Stand MIT Hinweis ist
 * ehrlicher als ein leises Nichts — und weit besser als ein abgebrochener
 * Import. Genommen wird der zuletzt geschriebene Stand derselben Art und
 * desselben Gebiets, gleich unter welchem Abfrage-Hash.
 */
function ausAltbestand(art: string, bbox: BBox): { elemente: OsmElement[]; datei: string; stand?: string } | null {
  const praefix = cachePraefix(art, bbox);
  let ordner: string[];
  try {
    ordner = fs.readdirSync(cache.pfad('osm'));
  } catch {
    return null;
  }
  const treffer = ordner
    .filter((n) => n.startsWith(praefix) && n.endsWith('.json'))
    .map((n) => {
      let zeit = 0;
      try {
        zeit = fs.statSync(cache.pfad('osm', n)).mtimeMs;
      } catch {
        /* Datei verschwunden — ueberspringen */
      }
      return { n, zeit };
    })
    .sort((a, b) => b.zeit - a.zeit);
  for (const { n } of treffer) {
    const alt = cache.jsonLesen<OsmCache | null>(null, 'osm', n);
    if (alt && Array.isArray(alt.elements) && alt.elements.length) {
      return { elemente: alt.elements, datei: n, stand: alt.stand };
    }
  }
  return null;
}

/**
 * Meldungen ueber benutzte Altbestaende — der Aufrufer (Gelaende-Import) soll
 * sie in den Quellennachweis bzw. das Auftragsprotokoll uebernehmen, damit
 * niemand einen veralteten Stand fuer frisch abgerufen haelt.
 */
export const altbestandMeldungen: string[] = [];

/**
 * Eine Overpass-Abfrage mit Warteschlange, Dateicache und Wiederholversuch.
 * Exportiert, damit weitere Module (stadtdetails.ts) DIESELBE Mechanik nutzen
 * statt eine zweite, konkurrierende Abfrage-Schlange aufzumachen — Overpass
 * erlaubt nur EINE Anfrage gleichzeitig je Nutzer.
 * `art` unterscheidet die Cache-Dateien und muss je Abfrageform eindeutig sein.
 */
export async function overpass(
  rumpf: string,
  art: string,
  bbox: BBox,
  userAgent: string,
): Promise<OsmElement[]> {
  const schluessel = cacheSchluessel(art, bbox, rumpf);
  const gecacht = cache.jsonLesen<OsmCache | null>(null, 'osm', schluessel);
  if (gecacht && Array.isArray(gecacht.elements)) return gecacht.elements;

  let elemente: OsmElement[];
  try {
    elemente = await nacheinander(async () => {
      // Drei Versuche mit wachsender Pause: Overpass ist unter Last regelmaessig
      // fuer einige Sekunden dicht (nachgestellt 08.08.2026, HTTP 429/504).
      for (let versuch = 0; versuch < 3; versuch++) {
        const res = await fetch(OVERPASS_URL, {
          method: 'POST',
          headers: {
            'User-Agent': userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: rumpf }).toString(),
        });
        if (res.ok) {
          const daten = (await res.json()) as { elements?: OsmElement[] };
          return daten.elements ?? [];
        }
        const text = await res.text().catch(() => '');
        // 429 = Drossel, 504 = Auslastung, 400 mit Dispatcher-Meldung = ebenfalls
        // Drossel (Overpass meldet die Slot-Sperre am 07.08.2026 nachweislich als
        // HTTP 400 mit HTML-Seite, nicht als 429). Alles davon ist voruebergehend.
        if (versuch < 2 && (res.status === 429 || res.status === 504 || istDrossel(text))) {
          await new Promise((r) => setTimeout(r, 5000 * (versuch + 1)));
          continue;
        }
        throw new Error(
          `Overpass-API nicht erreichbar (HTTP ${res.status}). ${fehlerText(text)}`.trim(),
        );
      }
      throw new Error(
        'Overpass-API dauerhaft ausgelastet (Drossel) — Bodenzeichnung aus OSM k. A.',
      );
    });
  } catch (fehler) {
    // Abruf gescheitert: lieber ein veralteter Stand MIT Hinweis als eine
    // stille Luecke (Begruendung bei ausAltbestand).
    const alt = ausAltbestand(art, bbox);
    if (!alt) throw fehler;
    const meldung =
      `${art}: Abruf gescheitert (${(fehler as Error).message.slice(0, 90)}) — ` +
      `es gilt der zwischengespeicherte Stand vom ${alt.stand ? new Date(alt.stand).toLocaleString('de-DE') : 'unbekannt'} ` +
      `(${alt.elemente.length} Objekte, ${alt.datei}).`;
    console.warn(`[osm] ${meldung}`);
    altbestandMeldungen.push(meldung);
    return alt.elemente;
  }

  cache.jsonSchreiben({ stand: new Date().toISOString(), bbox, elements: elemente } as OsmCache, 'osm', schluessel);
  return elemente;
}

// ---------------------------------------------------------------------------
// Geometrie-Hilfen
// ---------------------------------------------------------------------------

/** Zentimeter genuegen fuer die Bodenzeichnung und halbieren die Dateigroesse. */
function ringSauber(ring: Ring): Ring {
  return ringNormalisieren(
    ring.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] as Punkt),
  );
}

function geschlossen(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const z = ring[ring.length - 1];
  return abstand(a, z) < 1e-9 ? ring : [...ring, [a[0], a[1]] as Punkt];
}

/**
 * Zerlegt eine Polylinie in die Abschnitte, die das Zielgebiet ueberhaupt
 * beruehren. Overpass liefert bei `out geom` die VOLLE Geometrie jedes Weges —
 * eine Hauptstrasse kann kilometerweit aus dem Gebiet herauslaufen.
 */
function abschnitteImGebiet(linie: Punkt[], ziel: BBox): Punkt[][] {
  const teile: Punkt[][] = [];
  let aktuell: Punkt[] = [];
  for (let i = 1; i < linie.length; i++) {
    if (bboxUeberschneidet(bboxVonPunkten([linie[i - 1], linie[i]]), ziel)) {
      if (!aktuell.length) aktuell.push(linie[i - 1]);
      aktuell.push(linie[i]);
    } else if (aktuell.length) {
      teile.push(aktuell);
      aktuell = [];
    }
  }
  if (aktuell.length) teile.push(aktuell);
  return teile;
}

/**
 * Korridor einer Achse als Polygone [Aussenring, ...Loecher].
 *
 * Bevorzugt wird `bandRing`: EIN durchgehendes Band mit Gehrungsstoessen. Das
 * ist fuer die Darstellung entscheidend — `wegKorridor` setzt an jeden Knick
 * eine Rundkappe, wodurch ein Weg im Bild in lauter Knubbel zerfaellt statt
 * als Band zu lesen. Nur wenn das Band an entarteter Geometrie scheitert,
 * wird auf die robustere Korridorbildung zurueckgefallen.
 */
function korridorPolygone(linie: Punkt[], breiteM: number, ziel: BBox): Ring[][] {
  const ringe: Ring[] = [];
  for (const teil of abschnitteImGebiet(linie, ziel)) {
    const band = bandRing(teil, breiteM);
    if (band && band.length >= 3) ringe.push(band);
    else ringe.push(...wegKorridor(teil, breiteM));
  }
  if (!ringe.length) return [];
  if (ringe.length === 1) {
    const r = ringSauber(ringe[0]);
    return r.length >= 3 ? [[r]] : [];
  }
  try {
    const geoms = ringe.map((r) => [geschlossen(r)]);
    const vereint = polygonClipping.union(geoms[0], ...geoms.slice(1));
    const out: Ring[][] = [];
    for (const poly of vereint) {
      const ringeSauber = poly.map((r) => ringSauber(r as Ring)).filter((r) => r.length >= 3);
      if (ringeSauber.length) out.push(ringeSauber);
    }
    if (out.length) return out;
  } catch {
    /* Einzelringe behalten */
  }
  return ringe.map((r) => [ringSauber(r)]).filter((p) => p[0].length >= 3);
}

export function punkteNachUtm(geometrie: OsmElement['geometry']): Punkt[] {
  const out: Punkt[] = [];
  for (const p of geometrie ?? []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    out.push(nachUtm([p.lon, p.lat]));
  }
  return out;
}

function bezeichnungVon(tags: Record<string, string>, ersatz: string): string {
  return tags.name?.trim() || ersatz;
}

/**
 * Oberflaechenart aus `surface` (asphalt, paving_stones, sett, cobblestone,
 * gravel, grass …). Sie entscheidet ueber den Farbton INNERHALB einer Klasse:
 * ein Kopfsteinpflasterplatz sieht anders aus als eine Asphaltflaeche.
 * Fehlt das Tag, bleibt das Feld leer — geraten wird nichts.
 */
function belagVon(tags: Record<string, string>): string | undefined {
  const s = tags.surface?.trim().toLowerCase();
  return s ? s : undefined;
}

/** Kleinste sinnvolle Flaeche — darunter ist es Rauschen, kein Belag. */
const MIN_FLAECHE = 0.25;

/**
 * Bildet die Ergebnis-Polygone eines OSM-Weges ab.
 * `praefix` trennt die beiden Abfragen (w = Achse/Korridor, f = Flaeche): ein
 * und derselbe Weg kann in BEIDEN Abfragen auftauchen (z. B. highway=pedestrian
 * mit area:highway=pedestrian), und GelaendeFlaeche.id muss eindeutig bleiben.
 */
function alsGelaendeFlaechen(
  praefix: 'w' | 'f',
  wegId: number,
  polygone: Ring[][],
  art: FlaechenArt,
  rang: number,
  bezeichnung: string,
  belag?: string,
): GelaendeFlaeche[] {
  const out: GelaendeFlaeche[] = [];
  for (const poly of polygone) {
    const aussen = poly[0];
    if (!aussen || aussen.length < 3 || flaeche(aussen) < MIN_FLAECHE) continue;
    const loecher = poly.slice(1).filter((r) => r.length >= 3 && flaeche(r) >= MIN_FLAECHE);
    const basis = `osm_${praefix}${wegId}`;
    out.push({
      id: out.length === 0 ? basis : `${basis}_${out.length}`,
      art,
      polygon: aussen,
      loecher: loecher.length ? loecher : undefined,
      quelle: 'osm',
      bezeichnung,
      rang,
      belag,
    });
  }
  return out;
}

/** Liest die OSM-Weg-Nummer aus einer erzeugten Flaechen-Id zurueck. */
function osmIdVon(id: string): string {
  return /^osm_[wf](\d+)/.exec(id)?.[1] ?? id;
}

// ---------------------------------------------------------------------------
// 1. Wege (Linien) -> Korridorflaechen
// ---------------------------------------------------------------------------

export async function osmWegflaechen(
  bbox: BBox,
  opts?: { userAgent?: string },
): Promise<GelaendeFlaeche[]> {
  const w = bboxNachWgs(bbox);
  const rumpf =
    `[out:json][timeout:60];(way["highway"](${w.minLat},${w.minLon},${w.maxLat},${w.maxLon}););out geom;`;
  const elemente = await overpass(rumpf, 'wege', bbox, opts?.userAgent ?? standardUserAgent());

  // Etwas Rand, damit Wege am Gebietsrand nicht abrupt enden.
  const ziel = bboxErweitern(bbox, 60);
  const out: GelaendeFlaeche[] = [];

  for (const el of elemente) {
    if (el.type !== 'way') continue;
    const tags = el.tags ?? {};
    const k = osmArt(tags);
    if (!k) continue;
    const linie = punkteNachUtm(el.geometry);
    if (linie.length < 2) continue;

    /*
     * Geschlossene Wege mit area=yes bzw. area:highway sind FLAECHEN
     * (Marktplatz, Fussgaengerzone). Als Korridor gepuffert ergaeben sie nur
     * einen Ring um den Rand und liessen die Mitte leer.
     */
    const istRing = linie.length >= 4 && abstand(linie[0], linie[linie.length - 1]) < 0.05;
    const alsFlaeche = istRing && (tags.area === 'yes' || Boolean(tags['area:highway']));

    let polygone: Ring[][];
    if (alsFlaeche) {
      const ring = ringSauber(linie);
      polygone = ring.length >= 3 ? [[ring]] : [];
    } else {
      polygone = korridorPolygone(linie, k.breiteM, ziel);
    }
    const flaechen = alsGelaendeFlaechen(
      'w',
      el.id,
      polygone,
      k.art,
      k.rang,
      bezeichnungVon(tags, tags.highway ?? ''),
      belagVon(tags),
    );

    // Fahrbahnen tragen ihre Achse und die getaggten Fahrdaten mit — die
    // Grundlage fuer Leitlinien und Spurtrennstriche in der Darstellung.
    // Nur Getaggtes wird uebernommen (lanes/oneway), geraten wird nichts.
    if (k.art === 'fahrbahn' && !alsFlaeche && flaechen.length) {
      const achsen = abschnitteImGebiet(linie, ziel).filter((t) => t.length >= 2);
      const spuren = zahlAus(tags.lanes);
      // Die Achsen gehoeren dem WEG, nicht jedem seiner Korridor-Teilstuecke:
      // ein Weg kann mehrere Polygone liefern (Union-Reste, Gebietsschnitt).
      // Haengte man die volle Achsenliste an jedes Teilstueck, entstuenden im
      // Import so viele Markierungssaetze wie Teilstuecke — dieselbe Leitlinie
      // mehrfach uebereinander.
      const ersteFlaeche = flaechen[0];
      ersteFlaeche.achsen = achsen.length ? achsen : undefined;
      for (const f of flaechen) {
        f.breiteM = k.breiteM;
        if (spuren !== null && spuren >= 1 && spuren <= 12) f.spuren = spuren;
        if (tags.oneway === 'yes' || tags.oneway === '-1') f.einbahn = true;
        f.strassenklasse = (tags.highway ?? '').replace(/_link$/, '') || undefined;
      }
    }
    out.push(...flaechen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Flaechen (geschlossene Wege) -> Gruen, Wald, Wasser, Parkplatz, Platz
// ---------------------------------------------------------------------------

export async function osmFlaechen(
  bbox: BBox,
  opts?: { userAgent?: string },
): Promise<GelaendeFlaeche[]> {
  const w = bboxNachWgs(bbox);
  /*
   * Der Gebietsfilter steht an JEDER Teilabfrage, nicht hinter der Gruppe.
   * Overpass QL kennt keinen Bbox-Filter auf eine Anweisungsgruppe — die Form
   * „( … )(bbox)" quittiert der Dienst mit „parse error: ';' expected - '('
   * found" (am 07.08.2026 gegen overpass-api.de nachgestellt).
   */
  const g = `(${w.minLat},${w.minLon},${w.maxLat},${w.maxLon})`;
  const rumpf =
    `[out:json][timeout:60];(` +
    `way["landuse"~"grass|forest|meadow|village_green|recreation_ground|cemetery"]${g};` +
    `way["leisure"~"park|garden|playground|pitch"]${g};` +
    `way["natural"~"water|wood|scrub"]${g};` +
    `way["amenity"="parking"]${g};` +
    `way["area:highway"]${g};` +
    `);out geom;`;
  const elemente = await overpass(rumpf, 'flaechen', bbox, opts?.userAgent ?? standardUserAgent());

  const out: GelaendeFlaeche[] = [];
  for (const el of elemente) {
    if (el.type !== 'way') continue;
    const g = el.geometry ?? [];
    if (g.length < 4) continue;
    const a = g[0];
    const z = g[g.length - 1];
    // Nur GESCHLOSSENE Wege sind Flaechen — offene Linien waeren Zaeune o. Ae.
    if (!a || !z || a.lat !== z.lat || a.lon !== z.lon) continue;

    const tags = el.tags ?? {};
    const k = osmFlaechenArt(tags);
    if (!k) continue;
    const ring = ringSauber(punkteNachUtm(g));
    if (ring.length < 3) continue;

    // Parkplaetze tragen ihre Rolle IMMER in der Bezeichnung (auch benannte:
    // „Name (Parkplatz)") — die Darstellung erkennt sie daran und beschriftet
    // sie mit „P", sonst laese ein Parkplatz wie eine Fahrbahnflaeche.
    const istParkplatz = tags.amenity === 'parking';
    const ersatz = istParkplatz
      ? 'Parkplatz'
      : (tags.landuse ?? tags.leisure ?? tags.natural ?? tags.amenity ?? tags['area:highway'] ?? '');
    let bezeichnung = bezeichnungVon(tags, ersatz);
    if (istParkplatz && !/parkplatz/i.test(bezeichnung)) bezeichnung = `${bezeichnung} (Parkplatz)`;
    out.push(
      ...alsGelaendeFlaechen('f', el.id, [[ring]], k.art, k.rang, bezeichnung, belagVon(tags)),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Beides zusammen — die fertige Bodenzeichnung
// ---------------------------------------------------------------------------

/**
 * Holt Flaechen UND Wege. Faellt eine der beiden Abfragen aus, bleibt die
 * andere erhalten: eine unvollstaendige Bodenzeichnung ist besser als gar
 * keine, und der Fehler wird gemeldet statt verschwiegen.
 * Ergebnis ist nach rang sortiert — in dieser Reihenfolge gezeichnet stimmt
 * die Ueberdeckung (Gruen unten, Fahrbahn darueber, Gehweg/Radweg zuoberst).
 */
export async function osmBodenzeichnung(
  bbox: BBox,
  opts?: { userAgent?: string },
): Promise<GelaendeFlaeche[]> {
  const out: GelaendeFlaeche[] = [];
  const alsFlaecheGesehen = new Set<string>();
  try {
    for (const f of await osmFlaechen(bbox, opts)) {
      alsFlaecheGesehen.add(osmIdVon(f.id));
      out.push(f);
    }
  } catch (e) {
    console.warn(`[osm] Flaechen nicht geladen: ${(e as Error).message}`);
  }
  try {
    for (const f of await osmWegflaechen(bbox, opts)) {
      // Wege mit area:highway liefern beide Abfragen — die Flaeche gilt.
      if (alsFlaecheGesehen.has(osmIdVon(f.id))) continue;
      out.push(f);
    }
  } catch (e) {
    console.warn(`[osm] Wege nicht geladen: ${(e as Error).message}`);
  }
  out.sort((a, b) => a.rang - b.rang);
  return out;
}
