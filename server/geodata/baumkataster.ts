/**
 * Amtliches 3D-Baumkataster der Wissenschaftsstadt Darmstadt.
 *
 * Quelle ist der Stadtbaum-Layer von 3d.darmstadt.de (PlexMap/Geoplex,
 * Vermessungsamt): ~37.000 Baeume des Gruenflaechenamts mit gemessener
 * Position, Hoehe und Kronendurchmesser. OSM kennt im Pilotgebiet nur rund
 * ein Viertel dieser Baeume — gerade in Parks (Herrngarten) fehlen die
 * meisten. Das Kataster ist damit die ehrlichere Grundlage: gemessene Werte
 * statt Klassenannahmen.
 *
 * Die Daten liegen als vorextrahierte Zeilen im Cache
 * (data/cache/baumkataster/<stadt>_stadtbaeume.json). Extraktion: i3dm-Kacheln
 * des Tilesets, Position aus RTC_CENTER+Offsets (ECEF -> UTM32), Krone =
 * SCALE_NON_UNIFORM.x in Metern, Hoehe = SCALE_NON_UNIFORM.y * 1,5 (an der
 * Attribut-API des Dienstes verifiziert, 08.08.2026).
 *
 * LIZENZHINWEIS: Die Stadt hat die Nachnutzung mit Namensnennung gegenueber
 * OSM schriftlich erlaubt; ein formales Open-Data-Label fehlt. Der
 * Quellenvermerk ist darum Pflicht, eine schriftliche Freigabe des
 * Vermessungsamts steht als Aufgabe im Raum.
 */

import fs from 'node:fs';
import type { BBox, GelaendePunktObjekt } from '../../shared/domain/types.ts';
export type { BBox };
import { cache } from '../lib/store.ts';

/**
 * Rohzeile der Cache-Datei: [E, N, z, KronenD, SkalaY, KronenD, JWT, laubart?].
 * Das 8. Feld ist optional und kommt aus dem Baumarten-Nachlauf gegen die
 * Attribut-API (Gattung aus Baumart_la -> laubbaum/nadelbaum/immergruen).
 */
type KatasterZeile = [number, number, number, number, number, number, string, string?];

const LAUBARTEN = new Set(['laubbaum', 'nadelbaum', 'immergruen']);

/**
 * AMTLICHE SACHDATEN je Baum — Art, Hoehe, Kronen- und Stammdurchmesser.
 *
 * Die 3D-Kacheln des Dienstes tragen nur Lage und Groesse; die Sachdaten
 * liegen dahinter und werden ueber den JWT jeder Instanz herausgegeben
 * (scripts/baumarten-holen.ts holt sie einmal in die Datei unten).
 *
 * WARUM DAS ZAEHLT: Die Hoehe wurde bisher aus dem Skalenwert ABGELEITET
 * (SkalaY x 1,5). Die Ableitung ist richtig — gegen alle 36.409 amtlichen
 * Hoehen nachgemessen betraegt die Abweichung im Median 0,00 m und im
 * schlimmsten Fall 0,01 m —, aber ein amtlicher Wert ist keine Ableitung.
 * Neu hinzu kommen Baumart und Stammdurchmesser, die es vorher gar nicht gab.
 */
interface Baummerkmal {
  hoeheM?: number;
  kroneM?: number;
  stammCm?: number;
  artDt?: string;
  artLa?: string;
}
let merkmaleCache: Record<string, Baummerkmal> | null = null;
function merkmale(): Record<string, Baummerkmal> {
  if (merkmaleCache) return merkmaleCache;
  const pfad = cache.pfad('baumkataster', 'darmstadt_baummerkmale.json');
  try {
    merkmaleCache = fs.existsSync(pfad) ? (JSON.parse(fs.readFileSync(pfad, 'utf8')) as Record<string, Baummerkmal>) : {};
  } catch {
    merkmaleCache = {};
  }
  return merkmaleCache;
}

/*
 * NADELBAUM ODER LAUBBAUM — aus der GATTUNG, nicht aus dem deutschen Namen.
 *
 * Der lateinische Name ist eindeutig, der deutsche schwankt. Massgeblich ist
 * hier die ERSCHEINUNG, nicht die Systematik: Die Einstufung steuert, ob die
 * Szene einen Kegel oder eine Krone zeichnet.
 *
 * Darum steht die EIBE (Taxus) bei den immergruenen und nicht bei den
 * Nadelbaeumen, obwohl sie botanisch ein Nadelholz ist — eine Eibe sieht nicht
 * aus wie eine Fichte. Dieselbe Entscheidung hatte der frueherer Abgleich
 * schon getroffen; die Gegenprobe gegen seine 1.690 bestimmten Baeume ergibt
 * mit dieser Tabelle 1.689 Treffer (99,94 %). Die eine Abweichung ist eine
 * Kalifornische Nusseibe (Torreya), die dort als Laubbaum gefuehrt war — hier
 * steht sie aus demselben Grund wie die Eibe bei den immergruenen.
 *
 * GINKGO gehoert ausdruecklich NICHT zu den Nadelbaeumen (laubabwerfend,
 * Faecherblaetter) und MAGNOLIE nicht zu den immergruenen (nur grandiflora
 * ist es) — beides waren Fehler eines ersten Entwurfs, die die Gegenprobe
 * aufgedeckt hat.
 */
const NADEL_GATTUNG = new Set([
  'abies', 'picea', 'pinus', 'larix', 'pseudotsuga', 'thuja', 'chamaecyparis', 'juniperus',
  'tsuga', 'cedrus', 'metasequoia', 'sequoiadendron', 'sequoia', 'cryptomeria', 'cupressus',
  'calocedrus', 'platycladus', 'microbiota', 'sciadopitys', 'taxodium', 'araucaria',
]);
const IMMERGRUEN_GATTUNG = new Set([
  'ilex', 'buxus', 'photinia', 'elaeagnus', 'eucalyptus', 'arbutus', 'laurus', 'olea',
  'mahonia', 'pieris', 'rhododendron', 'taxus', 'torreya', 'cephalotaxus',
]);
/** Arten, die von ihrer Gattung abweichen — hier zaehlt der volle Name. */
const IMMERGRUEN_ART = ['prunus laurocerasus', 'magnolia grandiflora', 'quercus ilex', 'viburnum tinus', 'ligustrum japonicum'];

export function laubartAus(artLa: string | undefined): 'laubbaum' | 'nadelbaum' | 'immergruen' | undefined {
  if (!artLa) return undefined;
  const s = artLa.trim().toLowerCase();
  if (IMMERGRUEN_ART.some((x) => s.startsWith(x))) return 'immergruen';
  const gattung = s.split(/\s+/)[0];
  if (IMMERGRUEN_GATTUNG.has(gattung)) return 'immergruen';
  if (NADEL_GATTUNG.has(gattung)) return 'nadelbaum';
  return 'laubbaum';
}

/** Hoehe [m] = SkalaY * 1,5 — am Dienst nachgemessen (3 Stichproben exakt). */
const HOEHE_JE_SKALA = 1.5;

/** Plausibilitaetsgrenzen wie in der Szene (gegen Ausreisser der Erfassung). */
const HOEHE_MIN = 1.5;
const HOEHE_MAX = 45;
const KRONE_MIN = 1;
const KRONE_MAX = 30;

/** Naeher als 3 m am Katasterbaum = derselbe Baum (OSM-Dublette). */
const DUBLETTE_M = 3;

export const KATASTER_QUELLE = {
  datensatz: 'Baumkataster Wissenschaftsstadt Darmstadt (Stadtbaeume)',
  dienst: '3d.darmstadt.de (PlexMap, Cesium-3D-Tiles i3dm)',
  url: 'https://3d.darmstadt.de/static/tiles/942da2a0-5b49-4130-8f19-0666dbae7864_6/tileset.json',
  lizenz: 'Nutzung mit Quellenvermerk (formale Freigabe des Vermessungsamts ausstehend)',
  quellenvermerk: '(c) Wissenschaftsstadt Darmstadt, Baumkataster',
};

/** Liest eine Kataster-Cachedatei als Punktobjekte im Gebiet. */
function ausDatei(bbox: BBox, datei: string, praefix: string): GelaendePunktObjekt[] {
  const pfad = cache.pfad('baumkataster', datei);
  if (!fs.existsSync(pfad)) return [];
  let roh: KatasterZeile[];
  try {
    roh = JSON.parse(fs.readFileSync(pfad, 'utf8')) as KatasterZeile[];
  } catch {
    return [];
  }
  const out: GelaendePunktObjekt[] = [];
  for (const zeile of roh) {
    const e = zeile[0];
    const n = zeile[1];
    if (!Number.isFinite(e) || !Number.isFinite(n)) continue;
    if (e < bbox.minE || e > bbox.maxE || n < bbox.minN || n > bbox.maxN) continue;
    // Ohne Finite-Pruefung propagiert ein fehlender Skalenwert als NaN durch
    // Math.max/min bis in hoeheM/kroneM — der Baum waere dann unsichtbar oder
    // riesig, ohne dass irgendwo ein Fehler auftaucht.
    if (!Number.isFinite(zeile[3]) || !Number.isFinite(zeile[4])) continue;
    // AMTLICHER WERT VOR ABLEITUNG: Liegt der Sachdatensatz vor, gilt er.
    // Sonst bleibt es bei der Ableitung aus dem Skalenwert (nachgemessen
    // deckungsgleich, siehe Baummerkmal).
    const m = merkmale()[zeile[6]] ?? {};
    const krone = Math.max(KRONE_MIN, Math.min(KRONE_MAX, m.kroneM ?? zeile[3]));
    const hoehe = Math.max(HOEHE_MIN, Math.min(HOEHE_MAX, m.hoeheM ?? zeile[4] * HOEHE_JE_SKALA));
    // Die 8. Spalte der Kataster-Zeile ist der alte Nachlauf; sie gilt nur
    // noch, wo kein Sachdatensatz vorliegt.
    const laubart =
      laubartAus(m.artLa) ?? (zeile[7] && LAUBARTEN.has(zeile[7]) ? (zeile[7] as 'laubbaum' | 'nadelbaum' | 'immergruen') : undefined);
    out.push({
      id: `${praefix}_${Math.round(e * 100)}_${Math.round(n * 100)}`,
      art: 'baum',
      pos: [Math.round(e * 100) / 100, Math.round(n * 100) / 100],
      hoeheM: Math.round(hoehe * 10) / 10,
      kroneM: Math.round(krone * 10) / 10,
      ...(laubart ? { laubart } : {}),
      ...(m.artDt ? { artDt: m.artDt } : {}),
      ...(m.artLa ? { artLa: m.artLa } : {}),
      ...(m.stammCm ? { stammCm: Math.round(m.stammCm) } : {}),
      // Amtlich vermessen — die Werte sind Messungen, keine Klassenannahmen.
      gemessen: true,
    });
  }
  return out;
}

/**
 * DAS GEBIET DES AUSZUGS — die Angabe, die bisher fehlte.
 *
 * Ein Katasterauszug ist ein AUSSCHNITT, kein Vollbestand. Der Darmstaedter
 * Auszug deckt das urspruengliche Pilotgebiet ab; als das Gebiet auf den
 * Grossen Woog erweitert wurde, gab es dort keine Katasterbaeume mehr, und wo
 * OpenStreetMap duenn ist, blieb die Flaeche leer — ohne eine einzige Meldung.
 * Genau das war der Befund „an neuen Stellen fehlen Baeume".
 *
 * Das Gebiet wird nicht konfiguriert, sondern aus der Datei GEMESSEN (alle
 * enthaltenen Punkte). Eine konfigurierte Angabe koennte veralten; die
 * gemessene nicht.
 */
export function katasterGebiet(stadt = 'darmstadt'): BBox | null {
  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;
  let punkte = 0;
  for (const datei of [`${stadt}_stadtbaeume.json`, `${stadt}_topobaeume.json`]) {
    const pfad = cache.pfad('baumkataster', datei);
    if (!fs.existsSync(pfad)) continue;
    let roh: KatasterZeile[];
    try {
      roh = JSON.parse(fs.readFileSync(pfad, 'utf8')) as KatasterZeile[];
    } catch {
      continue;
    }
    for (const zeile of roh) {
      const e = zeile[0];
      const n = zeile[1];
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;
      punkte++;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
    }
  }
  return punkte ? { minE, minN, maxE, maxN } : null;
}

/**
 * Liest die Katasterbaeume im Gebiet; ohne Cache-Dateien leer (kein Fehler).
 * Zwei amtliche Ebenen: das Pflegekataster (Stadtbaeume, mit Baumart) und die
 * photogrammetrisch erfassten Topobaeume (Baeume ausserhalb der staedtischen
 * Pflege — Parkinneres, Privatgrund). Topobaeume, die naeher als 2,5 m an
 * einem Stadtbaum stehen, sind derselbe reale Baum und fallen weg.
 */
export function katasterBaeume(bbox: BBox, stadt = 'darmstadt'): GelaendePunktObjekt[] {
  const stadtbaeume = ausDatei(bbox, `${stadt}_stadtbaeume.json`, 'katbaum');
  const topo = ausDatei(bbox, `${stadt}_topobaeume.json`, 'topobaum');
  if (!topo.length) return stadtbaeume;
  const out = [...stadtbaeume];
  for (const t of topo) {
    let doppelt = false;
    for (const s of stadtbaeume) {
      if (Math.hypot(s.pos[0] - t.pos[0], s.pos[1] - t.pos[1]) <= 2.5) {
        doppelt = true;
        break;
      }
    }
    if (!doppelt) out.push(t);
  }
  return out;
}

/**
 * Mischt Katasterbaeume mit den OSM-Punktobjekten: Kataster gewinnt, ein
 * OSM-Baum naeher als DUBLETTE_M an einem Katasterbaum faellt weg (derselbe
 * reale Baum, doppelt erfasst). Nicht-Baum-Punkte bleiben unberuehrt.
 */
export function mischeBaeume(
  kataster: GelaendePunktObjekt[],
  osmPunkte: GelaendePunktObjekt[],
): { punkte: GelaendePunktObjekt[]; osmBehalten: number; osmDubletten: number } {
  if (!kataster.length) return { punkte: osmPunkte, osmBehalten: 0, osmDubletten: 0 };

  // Gitterindex ueber die Katasterbaeume — 1.690 x 780 Einzelvergleiche waeren
  // unnoetig; mit 8-m-Zellen sind es je OSM-Baum hoechstens 9 Zellen.
  const ZELLE = 8;
  const gitter = new Map<string, GelaendePunktObjekt[]>();
  const schluessel = (e: number, n: number) => `${Math.floor(e / ZELLE)}_${Math.floor(n / ZELLE)}`;
  for (const b of kataster) {
    const s = schluessel(b.pos[0], b.pos[1]);
    const liste = gitter.get(s);
    if (liste) liste.push(b);
    else gitter.set(s, [b]);
  }
  const hatNachbarn = (e: number, n: number): boolean => {
    for (let de = -1; de <= 1; de++) {
      for (let dn = -1; dn <= 1; dn++) {
        const liste = gitter.get(`${Math.floor(e / ZELLE) + de}_${Math.floor(n / ZELLE) + dn}`);
        if (!liste) continue;
        for (const b of liste) {
          if (Math.hypot(b.pos[0] - e, b.pos[1] - n) <= DUBLETTE_M) return true;
        }
      }
    }
    return false;
  };

  const punkte: GelaendePunktObjekt[] = [...kataster];
  let osmBehalten = 0;
  let osmDubletten = 0;
  for (const p of osmPunkte) {
    if (p.art !== 'baum') {
      punkte.push(p);
      continue;
    }
    if (hatNachbarn(p.pos[0], p.pos[1])) {
      osmDubletten++;
      continue;
    }
    osmBehalten++;
    punkte.push(p);
  }
  return { punkte, osmBehalten, osmDubletten };
}
