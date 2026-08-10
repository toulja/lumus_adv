/**
 * ALKIS „Tatsaechliche Nutzung" (ave:Nutzung) ueber WFS.
 *
 * Das ist die Ebene, die aus dem Gelaende ein massgetreues digitales ABBILD
 * macht statt einer Luftbild-Kulisse: Fahrbahn, Gehweg, Radweg,
 * Fussgaengerzone, Platz, Gruenflaeche, Wasser und Bahn liegen hier als
 * amtlich vermessene Flaechen vor. Gezeichnet wird nach `rang` (klein = unten).
 *
 * Verifiziert am 07.08.2026 gegen Darmstadt (Heinerfest-Gebiet):
 *   GET .../alkis/vereinf/wfs?...&TYPENAMES=ave:Nutzung&COUNT=400
 *       &SRSNAME=urn:ogc:def:crs:EPSG::25832
 *       &BBOX=<minE>,<minN>,<maxE>,<maxN>,urn:ogc:def:crs:EPSG::25832
 *   -> HTTP 200, GML. Achsenreihenfolge bei EPSG::25832: RECHTSWERT zuerst.
 *
 * Warum Kachel-Paginierung: der Dienst liefert je Anfrage hoechstens COUNT
 * Objekte und meldet numberMatched="unknown" — es gibt also keine belastbare
 * Gesamtzahl und kein verlaessliches STARTINDEX-Blaettern. Deshalb wird das
 * Gebiet in Kacheln zerlegt; eine Kachel, die exakt COUNT Objekte liefert,
 * war voll und wird geviertelt. Doppelte kommen ueber die `oid` weg.
 */

import { XMLParser } from 'fast-xml-parser';
import type { BBox, FlaechenArt, GelaendeFlaeche, Quellennachweis, Ring } from '../../shared/domain/types.ts';
import { flaeche, ringNormalisieren } from '../../shared/geo/geometry.ts';
import { geoKonfig } from './konfig.ts';

/** Objektart der Ebene „tatsaechliche Nutzung" im vereinfachten ALKIS-Modell. */
export const TYPENAME_NUTZUNG = 'ave:Nutzung';

/** Obergrenze je Einzelabfrage (Vorgabe des Dienstes). */
const COUNT_JE_KACHEL = 400;
/** Kantenlaenge der Abfragekacheln in Metern. */
const KACHEL_M = 400;
/** Gleichzeitige Abfragen — der Dienst wird sonst zickig. */
const MAX_PARALLEL = 3;
/** Wie oft eine volle Kachel hoechstens geviertelt wird (400 -> 200 -> 100 -> 50 m). */
const MAX_TEILUNG = 3;
const ZEITGRENZE_MS = 30_000;
/** Kleiner als das wird nicht uebernommen (Splitter aus der Katasterkante). */
const MIN_FLAECHE_M2 = 1;

export const NUTZUNG_QUELLE: Omit<Quellennachweis, 'abgerufenAm'> = {
  datensatz: 'ALKIS Tatsaechliche Nutzung (vereinfachtes Modell)',
  dienst: `WFS 2.0.0 ${TYPENAME_NUTZUNG}`,
  url: 'https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs',
  lizenz: 'Datenlizenz Deutschland — Zero, Version 2.0 (ALKIS ohne Eigentuemerangaben)',
  quellenvermerk: '(c) HVBG, ALKIS Tatsaechliche Nutzung (vereinfachtes Modell)',
  hinweis:
    'Bodenzeichnung des Gelaendes: Verkehrs-, Vegetations-, Gewaesser- und Siedlungsflaechen. ' +
    'Geometrie in ETRS89/UTM32 (EPSG:25832), Innenhoefe als Loecher erhalten.',
};

// ---------------------------------------------------------------------------
// Zuordnung amtlicher Bezeichnungen -> FlaechenArt
// ---------------------------------------------------------------------------

/** Zeichenreihenfolge: kleiner = weiter unten. */
export const RANG: Record<FlaechenArt, number> = {
  bebauung: 0,
  sonstige: 2,
  landwirtschaft: 5,
  gruen: 10,
  wald: 12,
  wasser: 15,
  bahn: 18,
  fahrbahn: 20,
  platz: 24,
  fussgaengerzone: 26,
  weg: 28,
  gehweg: 30,
  radweg: 32,
  treppe: 34,
  // Die Gleiszone wird beim Import aus den Bodenflaechen AUSGESCHNITTEN; sie
  // liegt damit nie unter oder ueber einer anderen Klasse, sondern an deren
  // Stelle. Ihr Rang steht trotzdem oben, weil sie in einem Rueckfallweg ohne
  // Schnitt (Gelaende aus einem Altbestand) sichtbar bleiben muss.
  gleiszone: 36,
};

/**
 * Vergleichsschluessel: Kleinschreibung, Umlaute aufgeloest, alles andere raus.
 * Der Dienst liefert die Bezeichnungen MIT Umlauten („Straßenverkehr",
 * „Fläche besonderer funktionaler Prägung") — ohne diese Normalisierung
 * griffe keine einzige Regel.
 */
function schluessel(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Objektarten der ALKIS-Objektartengruppen „Tatsaechliche Nutzung"
 * (AX_TatsaechlicheNutzung: 41000 Siedlung, 42000 Verkehr, 43000 Vegetation,
 * 44000 Gewaesser). Schluessel sind die normalisierten amtlichen Bezeichnungen.
 */
const NUTZART_ART: Record<string, FlaechenArt> = {
  // --- 42000 Verkehr -------------------------------------------------------
  strassenverkehr: 'fahrbahn', // AX_Strassenverkehr
  strasse: 'fahrbahn', // AX_Strasse
  strassenachse: 'fahrbahn', // AX_Strassenachse
  fahrbahnachse: 'fahrbahn', // AX_Fahrbahnachse
  weg: 'weg', // AX_Weg
  fahrwegachse: 'weg', // AX_Fahrwegachse
  platz: 'platz', // AX_Platz
  bahnverkehr: 'bahn', // AX_Bahnverkehr
  bahnstrecke: 'bahn', // AX_Bahnstrecke
  gleis: 'bahn', // AX_Gleis
  flugverkehr: 'platz', // AX_Flugverkehr — befestigte Verkehrsflaeche
  schiffsverkehr: 'wasser', // AX_Schiffsverkehr — Hafen-/Wasserflaeche

  // --- 43000 Vegetation ----------------------------------------------------
  landwirtschaft: 'landwirtschaft', // AX_Landwirtschaft
  wald: 'wald', // AX_Wald
  gehoelz: 'wald', // AX_Gehoelz
  heide: 'gruen', // AX_Heide
  moor: 'gruen', // AX_Moor
  sumpf: 'gruen', // AX_Sumpf
  unlandvegetationsloseflaeche: 'sonstige', // AX_UnlandVegetationsloseFlaeche
  unland: 'sonstige',
  vegetationsloseflaeche: 'sonstige',

  // --- 44000 Gewaesser -----------------------------------------------------
  fliessgewaesser: 'wasser', // AX_Fliessgewaesser
  wasserlauf: 'wasser', // AX_Wasserlauf
  hafenbecken: 'wasser', // AX_Hafenbecken
  stehendesgewaesser: 'wasser', // AX_StehendesGewaesser
  meer: 'wasser', // AX_Meer

  // --- 41000 Siedlung ------------------------------------------------------
  wohnbauflaeche: 'bebauung', // AX_Wohnbauflaeche
  industrieundgewerbeflaeche: 'bebauung', // AX_IndustrieUndGewerbeflaeche
  halde: 'sonstige', // AX_Halde
  bergbaubetrieb: 'sonstige', // AX_Bergbaubetrieb
  tagebaugrubesteinbruch: 'sonstige', // AX_TagebauGrubeSteinbruch
  flaechegemischternutzung: 'bebauung', // AX_FlaecheGemischterNutzung
  flaechebesondererfunktionalerpraegung: 'bebauung', // AX_FlaecheBesondererFunktionalerPraegung
  sportfreizeitunderholungsflaeche: 'gruen', // AX_SportFreizeitUndErholungsflaeche
  friedhof: 'gruen', // AX_Friedhof
};

/**
 * Verfeinerung ueber das Attribut `bez` (amtliche Funktion / Vegetationsmerkmal).
 * Erst dadurch wird aus „Weg" ein Gehweg und aus „Platz" ein Marktplatz.
 * Bewusst EXAKTE Schluessel statt Teilstrings: „Gruenanlage" ist gruen,
 * „Gruenland" (Landwirtschaft) dagegen nicht.
 */
const BEZ_ART: Record<string, FlaechenArt> = {
  // Verkehr, fussgaengergepraegt
  fussgaengerzone: 'fussgaengerzone',
  fussgaengerbereich: 'fussgaengerzone',
  // Plaetze
  marktplatz: 'platz',
  festplatz: 'platz',
  parkplatz: 'platz',
  rastplatz: 'platz',
  raststaette: 'platz',
  // Wege
  gehweg: 'gehweg',
  fussweg: 'gehweg',
  radweg: 'radweg',
  radundfussweg: 'radweg',
  fussundradweg: 'radweg',
  treppe: 'treppe',
  fahrweg: 'weg',
  hauptwirtschaftsweg: 'weg',
  reitweg: 'weg',
  // Gruen / Erholung
  park: 'gruen',
  gruenanlage: 'gruen',
  gruenflaeche: 'gruen',
  gartenland: 'gruen',
  kleingarten: 'gruen',
  sportanlage: 'gruen',
  spielplatz: 'gruen',
  freizeitanlage: 'gruen',
  campingplatz: 'gruen',
  wochenendplatz: 'gruen',
  golfplatz: 'gruen',
  botanischergarten: 'gruen',
  zoo: 'gruen',
  safaripark: 'gruen',
  schwimmbadfreibad: 'gruen',
  friedhof: 'gruen',
  segelfluggelaende: 'gruen',
};

/** Notnagel fuer Bezeichnungen, die (noch) nicht in der Tabelle stehen. */
function artRaten(nk: string): FlaechenArt {
  if (!nk) return 'sonstige';
  if (nk.includes('strasse')) return 'fahrbahn';
  if (nk.includes('bahn')) return 'bahn';
  if (nk.includes('gewaesser') || nk.includes('wasser') || nk.includes('hafen') || nk.includes('meer')) return 'wasser';
  if (nk.includes('wald') || nk.includes('forst') || nk.includes('gehoelz')) return 'wald';
  if (nk.includes('landwirtschaft') || nk.includes('acker')) return 'landwirtschaft';
  if (nk.includes('platz')) return 'platz';
  if (nk.includes('weg')) return 'weg';
  if (nk.includes('erholung') || nk.includes('gruen') || nk.includes('friedhof') || nk.includes('garten')) return 'gruen';
  if (nk.includes('bauflaeche') || nk.includes('gewerbe') || nk.includes('siedlung') || nk.includes('praegung')) {
    return 'bebauung';
  }
  return 'sonstige';
}

/** Bildet die amtlichen Bezeichnungen (nutzart + bez) auf Art und Zeichenrang ab. */
export function artAus(nutzart: string, bez: string): { art: FlaechenArt; rang: number } {
  const nk = schluessel(nutzart);
  const bk = schluessel(bez);
  let art: FlaechenArt = NUTZART_ART[nk] ?? artRaten(nk);
  const verfeinert = BEZ_ART[bk];
  if (verfeinert) art = verfeinert;
  return { art, rang: RANG[art] };
}

// ---------------------------------------------------------------------------
// GML lesen
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['member', 'surfaceMember', 'interior', 'patches', 'PolygonPatch'].includes(name),
});

function textVon(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
  return String(v);
}

function erkenneDimension(zahlen: number[]): 2 | 3 {
  if (zahlen.length < 6) return 2;
  // Bei 3D steht an Position 2 eine Hoehe (< 5000), bei 2D ein Rechtswert (> 100000).
  return Math.abs(zahlen[2]) < 5000 ? 3 : 2;
}

/** Erster posList-Ring unterhalb eines Knotens, auf 2 Nachkommastellen gerundet. */
function ringAus(knoten: unknown): Ring | null {
  if (!knoten || typeof knoten !== 'object') return null;
  if (Array.isArray(knoten)) {
    for (const e of knoten) {
      const r = ringAus(e);
      if (r) return r;
    }
    return null;
  }
  const o = knoten as Record<string, unknown>;
  const roh = o.posList;
  if (roh !== undefined) {
    const zahlen = textVon(roh).split(/\s+/).filter(Boolean).map(Number);
    const dim = zahlen.length % 3 === 0 && zahlen.length % 2 !== 0 ? 3 : erkenneDimension(zahlen);
    const ring: Ring = [];
    for (let i = 0; i + 1 < zahlen.length; i += dim) {
      ring.push([Math.round(zahlen[i] * 100) / 100, Math.round(zahlen[i + 1] * 100) / 100]);
    }
    const sauber = ringNormalisieren(ring);
    return sauber.length >= 3 ? sauber : null;
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const r = ringAus(v);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Sammelt Polygon-Knoten. In ein Polygon wird NICHT weiter abgestiegen —
 * sonst kaeme ein Patch doppelt zurueck.
 */
function polygonKnoten(knoten: unknown, treffer: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!knoten || typeof knoten !== 'object') return treffer;
  if (Array.isArray(knoten)) {
    for (const e of knoten) polygonKnoten(e, treffer);
    return treffer;
  }
  for (const [k, v] of Object.entries(knoten as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    if (k === 'Polygon' || k === 'PolygonPatch') {
      for (const p of Array.isArray(v) ? v : [v]) {
        if (p && typeof p === 'object') treffer.push(p as Record<string, unknown>);
      }
    } else {
      polygonKnoten(v, treffer);
    }
  }
  return treffer;
}

function mitglieder(doc: unknown): Record<string, unknown>[] {
  const fc = (doc as Record<string, unknown>)?.FeatureCollection as Record<string, unknown> | undefined;
  if (!fc) return [];
  const roh = fc.member;
  if (!roh) return [];
  return (Array.isArray(roh) ? roh : [roh]) as Record<string, unknown>[];
}

/** Wandelt ein Nutzungs-Feature in eine oder mehrere Gelaendeflaechen. */
function flaechenAusFeature(n: Record<string, unknown>, oid: string): GelaendeFlaeche[] {
  const nutzart = textVon(n.nutzart);
  const bez = textVon(n.bez);
  // `name` traegt bei Verkehrsflaechen den amtlichen Strassennamen
  // („Zeughausstraße") — der gehoert in die Bezeichnung, unveraendert.
  const name = textVon(n.name);
  const { art, rang } = artAus(nutzart, bez);
  const amtlich = bez ? `${nutzart} (${bez})` : nutzart;
  const bezeichnung = [name, amtlich].filter(Boolean).join(' — ');

  const polys = polygonKnoten(n.geometrie ?? n);
  const out: GelaendeFlaeche[] = [];
  for (const p of polys) {
    const aussen = ringAus(p.exterior);
    if (!aussen || flaeche(aussen) < MIN_FLAECHE_M2) continue;
    const loecher: Ring[] = [];
    const roh = p.interior;
    for (const i of Array.isArray(roh) ? roh : roh ? [roh] : []) {
      const loch = ringAus(i);
      if (loch && flaeche(loch) >= MIN_FLAECHE_M2) loecher.push(loch);
    }
    out.push({
      id: polys.length > 1 ? `${oid}_${out.length}` : oid,
      art,
      polygon: aussen,
      ...(loecher.length ? { loecher } : {}),
      quelle: 'alkis',
      bezeichnung: bezeichnung || undefined,
      rang,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

/** Zerlegt das Gebiet in moeglichst quadratische Kacheln von ca. zielM Metern. */
function kachelGitter(bbox: BBox, zielM: number): BBox[] {
  const spalten = Math.max(1, Math.round((bbox.maxE - bbox.minE) / zielM));
  const zeilen = Math.max(1, Math.round((bbox.maxN - bbox.minN) / zielM));
  const dE = (bbox.maxE - bbox.minE) / spalten;
  const dN = (bbox.maxN - bbox.minN) / zeilen;
  const out: BBox[] = [];
  for (let z = 0; z < zeilen; z++) {
    for (let s = 0; s < spalten; s++) {
      out.push({
        minE: bbox.minE + s * dE,
        maxE: bbox.minE + (s + 1) * dE,
        minN: bbox.minN + z * dN,
        maxN: bbox.minN + (z + 1) * dN,
      });
    }
  }
  return out;
}

function vierteln(b: BBox): BBox[] {
  const mE = (b.minE + b.maxE) / 2;
  const mN = (b.minN + b.maxN) / 2;
  return [
    { minE: b.minE, minN: b.minN, maxE: mE, maxN: mN },
    { minE: mE, minN: b.minN, maxE: b.maxE, maxN: mN },
    { minE: b.minE, minN: mN, maxE: mE, maxN: b.maxN },
    { minE: mE, minN: mN, maxE: b.maxE, maxN: b.maxN },
  ];
}

async function kachelHolen(bb: BBox, land: string): Promise<{ doc: unknown; anzahl: number }> {
  const k = geoKonfig(land);
  const f = k.flurstuecke; // gleicher ALKIS-WFS wie Flurstuecke/Gebaeude
  const p = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: f.version,
    REQUEST: 'GetFeature',
    TYPENAMES: TYPENAME_NUTZUNG,
    COUNT: String(COUNT_JE_KACHEL),
    SRSNAME: f.srsName,
    // Achsenreihenfolge EN: Rechtswert zuerst (verifiziert 07.08.2026)
    BBOX: `${bb.minE},${bb.minN},${bb.maxE},${bb.maxN},${f.srsName}`,
  });
  const res = await fetch(`${f.url}?${p.toString()}`, {
    headers: { 'User-Agent': k.geokodierung.userAgent },
    signal: AbortSignal.timeout(ZEITGRENZE_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.includes('ExceptionReport')) {
    const m = /<[^>]*ExceptionText[^>]*>([^<]*)</.exec(xml);
    throw new Error(m?.[1] ?? 'Dienstfehler');
  }
  const doc = parser.parse(xml);
  const fc = (doc as Record<string, unknown>)?.FeatureCollection as Record<string, unknown> | undefined;
  const gemeldet = Number(fc?.['@_numberReturned']);
  return { doc, anzahl: Number.isFinite(gemeldet) ? gemeldet : mitglieder(doc).length };
}

async function mitWiederholung<T>(arbeit: () => Promise<T>, versuche = 2): Promise<T> {
  let letzter: unknown;
  for (let i = 0; i < versuche; i++) {
    try {
      return await arbeit();
    } catch (e) {
      letzter = e;
      if (i + 1 < versuche) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw letzter instanceof Error ? letzter : new Error(String(letzter));
}

async function pool<T>(aufgaben: T[], parallel: number, arbeit: (t: T) => Promise<void>): Promise<void> {
  let naechster = 0;
  const laeufer = Array.from({ length: Math.min(parallel, aufgaben.length) }, async () => {
    while (naechster < aufgaben.length) {
      await arbeit(aufgaben[naechster++]);
    }
  });
  await Promise.all(laeufer);
}

/**
 * Holt die tatsaechliche Nutzung fuer ein Gebiet.
 * Wirft nie: faellt der Dienst aus, kommt ein leeres Array zurueck und der
 * Grund steht auf der Konsole — ein Gelaende ohne Bodenzeichnung ist besser
 * als ein abgebrochener Import.
 */
export async function nutzungsflaechen(
  bbox: BBox,
  land = 'hessen',
  opts: { kachelM?: number; parallel?: number } = {},
): Promise<GelaendeFlaeche[]> {
  const gefunden = new Map<string, GelaendeFlaeche[]>();
  let uebersprungen = 0;
  try {
    const kachelM = Math.max(50, opts.kachelM ?? KACHEL_M);
    const parallel = Math.max(1, opts.parallel ?? MAX_PARALLEL);
    let welle = kachelGitter(bbox, kachelM).map((bb) => ({ bb, tiefe: 0 }));

    while (welle.length) {
      const naechste: { bb: BBox; tiefe: number }[] = [];
      await pool(welle, parallel, async (a) => {
        let ergebnis: { doc: unknown; anzahl: number };
        try {
          ergebnis = await mitWiederholung(() => kachelHolen(a.bb, land));
        } catch (e) {
          uebersprungen++;
          console.warn(
            `[nutzung] Kachel ${Math.round(a.bb.minE)}/${Math.round(a.bb.minN)}-` +
              `${Math.round(a.bb.maxE)}/${Math.round(a.bb.maxN)} uebersprungen: ${(e as Error).message}`,
          );
          return;
        }
        for (const m of mitglieder(ergebnis.doc)) {
          const n = m.Nutzung as Record<string, unknown> | undefined;
          if (!n) continue;
          const oid = textVon(n.oid) || String(n['@_id'] ?? '');
          if (!oid || gefunden.has(oid)) continue;
          const teile = flaechenAusFeature(n, oid);
          if (teile.length) gefunden.set(oid, teile);
        }
        // Volle Kachel = moeglicherweise abgeschnitten -> feiner nachfragen.
        if (ergebnis.anzahl >= COUNT_JE_KACHEL && a.tiefe < MAX_TEILUNG) {
          for (const bb of vierteln(a.bb)) naechste.push({ bb, tiefe: a.tiefe + 1 });
        }
      });
      welle = naechste;
    }
  } catch (e) {
    console.warn(`[nutzung] Abruf fehlgeschlagen: ${(e as Error).message}`);
  }
  if (uebersprungen) console.warn(`[nutzung] ${uebersprungen} Kachel(n) ohne Daten — Ergebnis ist unvollstaendig.`);

  const out: GelaendeFlaeche[] = [];
  for (const teile of gefunden.values()) out.push(...teile);
  // Zeichenreihenfolge vorbereiten: unten zuerst, innerhalb eines Rangs die
  // grossen Flaechen zuerst (kleine liegen dann sichtbar darauf).
  out.sort((a, b) => a.rang - b.rang || flaeche(b.polygon) - flaeche(a.polygon));
  return out;
}
