/**
 * BEGRUENUNG IN 3D — Baeume und Hecken als echte Koerper.
 *
 * WARUM DIESE DATEI:
 * `server/geodata/stadtdetails.ts` liefert fuer die Darmstaedter Innenstadt 753
 * Baeume mit Lage, Hoehe, Kronendurchmesser und Laubart sowie die Hecken als
 * Linienzuege. Bisher landete davon nichts im Bild. Genau diese Objekte machen
 * aber den Unterschied zwischen „Kloetze auf grauen Flaechen" und einer Stadt,
 * die man wiedererkennt: eine Allee ist im Luftbild das auffaelligste Merkmal
 * einer Strasse, und ein Platz ohne seine Baumreihen sieht aus wie ein
 * Parkplatz.
 *
 * KEINE Fotos, keine Billboards, keine Sprites: jeder Baum ist ein Stamm plus
 * eine Krone aus echter Geometrie, an seiner echten Lage, mit seiner echten
 * Hoehe, wo OSM sie fuehrt. Wo OSM sie nicht fuehrt, greift dieselbe
 * Klassenannahme wie im Server — und sie ist hier wie dort benannt, nicht
 * versteckt (`GelaendePunktObjekt.gemessen`, ausgewertet in `baumBilanz`).
 *
 * ---------------------------------------------------------------------------
 * DREI ENTSCHEIDUNGEN, DIE MAN BEIM LESEN KENNEN MUSS
 * ---------------------------------------------------------------------------
 * 1. VARIATION IST PFLICHT, ZUFALL IST VERBOTEN.
 *    Ein Wald aus identischen Kugeln sieht falsch aus — das Auge erkennt die
 *    Wiederholung sofort und liest sie als Grafik, nicht als Bestand. Also
 *    streuen Farbton, Hoehe, Kronendurchmesser und Kronendrehung. Aber
 *    ausschliesslich DETERMINISTISCH aus der Objekt-Id: mit `Math.random()`
 *    saehe dieselbe Strasse bei jedem Neuaufbau der Szene anders aus, und ein
 *    Screenshot in einer Genehmigungsakte waere nicht reproduzierbar.
 *    (Dieselbe Regel wie `gebaeudeVariante()` in palette.ts.)
 * 2. ALLES SYNCHRON GEBAUT (`asynchronous: false`).
 *    Gedrosselte Hintergrund-Tabs liefern kein requestAnimationFrame; Cesiums
 *    Async-Pfad bleibt dort haengen und die Baeume erschienen nie.
 * 3. NACH FARBE GEBUENDELT.
 *    753 Baeume x 2 Koerper waeren 1506 Primitives — das ist kein Bild mehr,
 *    das ist eine Diashow. Stattdessen sammelt `GruenSammler` alle Dreiecke je
 *    Farbton in EINE Geometrie; ein Primitive traegt dann rund 400 Baeume in
 *    einem guten Dutzend Farb-Instanzen.
 */

import * as Cesium from 'cesium';
import type { GelaendeLinienObjekt, GelaendePunktObjekt } from '@shared/domain/types';
import { bandRing, signierteFlaeche } from '@shared/geo/geometry';
import { nachWgs } from '@shared/geo/proj';
import type { Hoehenlage } from './gelaende.ts';
import { zerlegeFlaeche, type Punkt3D } from './stadt.ts';

// ===========================================================================
// 1  FARBEN
// ===========================================================================

/**
 * Die Toene der Begruenung.
 *
 * WARUM SO GEDAEMPFT — das ist keine Geschmacksfrage, sondern die
 * Arbeitsteilung des Werkzeugs:
 *
 * (a) Dies ist ein PLANUNGSWERKZEUG, kein Naturfoto. Auf dem fertigen Plan
 *     liegen Rettungswege, Feuerwehrzufahrten, Sperrflaechen, Staende und
 *     Fahrgeschaefte — und die muessen auf den ersten Blick herausstechen.
 *     palette.ts reserviert dafuer ausdruecklich den Bereich „dunkel UND bunt"
 *     (L* < 65 bei Chroma > 40; Konstanten PLAN_L_MAX / PLAN_CHROMA_MIN).
 *     KEIN Ton hier kommt diesem Reservat nahe: der bunteste Wert erreicht
 *     C* 28,3, also nicht einmal drei Viertel der Untergrenze. Ein sattes
 *     Laubgruen wuerde dagegen mit einem gruenen Sammelplatz-Symbol
 *     konkurrieren — und im Zweifel gewinnt dann der Baum, nicht die
 *     Sicherheitsinformation.
 * (b) Baeume sind BESTAND, kein Planinhalt. Bestand traegt gedaempfte Toene,
 *     Planung traegt Signalfarben. Diese Trennung ist die einzige, die auch
 *     noch funktioniert, wenn zwanzig Objekte gleichzeitig im Bild sind.
 * (c) Die Kronen sind trotzdem deutlich DUNKLER als die Gruenflaechen unter
 *     ihnen (Flaeche „gruen" L* 85,5 · „wald" L* 74,0). Ein Baum ueber einer
 *     Wiese liest sich damit als Koerper auf einer Flaeche und nicht als
 *     Fleck in ihr.
 *
 * Alle Werte fuer L*, a* und b* gerechnet in CIELAB (D65), gleiche Rechnung wie
 * `lStern()` in palette.ts.
 */
export const VEGETATION_FARBEN = {
  /**
   * Stamm und Ast. L* 32,70 / a* +4,38 / b* +10,90 / C* 11,75.
   * Ein entsaettigtes Rindenbraun — dunkel genug, dass der Stamm die Krone
   * traegt statt mit ihr zu verschmelzen, und so unbunt, dass eine Reihe
   * Stammquerschnitte im Bild nicht als Punktsignatur missverstanden wird.
   */
  stamm: '#5a4a3c',

  /**
   * LAUBBAUM — fuenf eng benachbarte Toene.
   * L* 62,59 · 64,13 · 65,70 · 67,37 · 69,25 (Schritte 1,5–1,9 L*).
   * Die Spanne von 6,7 L* ist bewusst KLEINER als der Abstand zwischen zwei
   * Vegetations-Flaechenklassen (gruen 85,5 -> wald 74,0 = 11,5 L*): ein
   * hellerer Baum kann damit nie als „andere Klasse" gelesen werden, er ist
   * nur ein anderer Baum. Der Farbton wandert dabei minimal mit (b* 22,4 nach
   * 18,0), weil Baumarten sich real nicht nur in der Helligkeit unterscheiden
   * — eine reine Helligkeitsreihe wirkt wie ein Schattenverlauf, nicht wie
   * verschiedene Baeume.
   */
  laub: ['#879f6f', '#8ba375', '#8fa77c', '#95ab82', '#9ab088'],

  /**
   * NADELBAUM — vier Toene, DUNKLER und KUEHLER als Laub.
   * L* 46,41 · 48,38 · 50,36 · 52,60, b* ~ +9.
   * Der Abstand zum hellsten Laubton betraegt 10,0 L*, der Farbton liegt um
   * rund 12 b*-Einheiten kuehler (Laub b* +18 bis +22). Beides zusammen ist
   * der Grund, warum eine Fichte zwischen Platanen auch im Graustufendruck
   * noch als andere Art erkennbar bleibt. Fachlich stimmt es ausserdem:
   * Nadelgehoelz reflektiert deutlich weniger und blaeulicher als Laub.
   */
  nadel: ['#57755f', '#5c7a63', '#617f68', '#66856c'],

  /**
   * IMMERGRUEN (Stechpalme, Kirschlorbeer, Buchs als Baumform) — drei Toene
   * zwischen den beiden Familien. L* 54,55 · 56,48 · 58,98.
   * Immergruenes Laub ist dunkler als sommergruenes, aber nicht so kuehl wie
   * Nadel — genau das zeigt die Zwischenlage.
   */
  immergruen: ['#6b8a71', '#708f76', '#7d956f'],

  /**
   * HECKE. L* 57,35 / a* -16,45 / b* +17,86 / C* 24,28.
   * Der Farbton des Laubes (b* +17,9 wie die Laubfamilie), aber 5,2 L*
   * dunkler als der dunkelste Baumton. Eine Hecke ist dicht geschnittenes
   * Laub — sie wirft in sich Schatten und ist darum real dunkler als eine
   * lockere Krone. Zugleich haelt der Abstand die Hecke sicher von der
   * Gruenflaeche getrennt, auf der sie meistens steht.
   */
  hecke: '#78916a',
};

// ===========================================================================
// 2  MASSE
// ===========================================================================

/**
 * Freier Stamm (Kronenansatz) als Anteil der Baumhoehe. 40 % ist der Aufbau
 * eines Strassenbaums, wie ihn die Baumpflege beschreibt.
 *
 * ACHTUNG, hier steckt ein bewusster Kompromiss: Der Zylinder wird bis in die
 * KRONENMITTE gezogen, nicht nur bis 0,4 h. Sonst klaffte bei schmalen Kronen
 * eine Luecke zwischen Stammspitze und Kronenunterkante und der Baum schwebte.
 * Der SICHTBARE freie Stamm ist trotzdem der Bereich unterhalb der Krone —
 * und der ist dort, wo die Krone nur aus der Klassenannahme stammt, etwas
 * laenger als 40 %. Das ist so gewollt: Vorrang hat die GEMESSENE Baumhoehe,
 * die Krone endet exakt an ihr. Lieber ein etwas hoher Kronenansatz als ein
 * Baum, der seine amtliche Hoehe verfehlt.
 */
const STAMM_ANTEIL = 0.4;

/** Stammdurchmesser = Baumhoehe / 18 (schlanker Zylinder). */
const STAMM_SCHLANKHEIT = 18;

/** Senkrechter Kronenradius = 0,85 x waagerechter — die leichte Abplattung. */
const KRONE_ABPLATTUNG = 0.85;

/** Streuung von Hoehe und Kronendurchmesser: +/- 8 %. */
const STREUUNG = 0.08;

/**
 * Unterteilungsstufe der Kronenkugel. 0 = Ikosaeder (20 Dreiecke, kantig),
 * 1 = 80 Dreiecke, 2 = 320. Stufe 1 ist die Grenze, ab der eine Krone in der
 * Arbeitsansicht rund wirkt; Stufe 2 vervierfachte die Dreiecke fuer einen
 * Unterschied, den man erst mit der Nase am Bildschirm sieht.
 * 753 Baeume x 80 Dreiecke = rund 60 000 Dreiecke, das traegt jede GPU.
 */
const KUGEL_UNTERTEILUNG = 1;

/** Umfangssegmente von Kegel (Nadelbaum) und Stammzylinder. */
const KEGEL_SEGMENTE = 12;
const STAMM_SEGMENTE = 8;

/** Baeume je Primitive. Zwei Buendel fuer das Zielgebiet. */
const BUENDEL_BAEUME = 400;

/**
 * Klassenannahmen, IDENTISCH zu server/geodata/stadtdetails.ts. Sie greifen
 * nur, wenn ein Datensatz das Feld gar nicht traegt — der Regelfall ist, dass
 * der Server sie schon gesetzt hat. Doppelt gefuehrt, damit die Anzeige nicht
 * heimlich einen anderen Baum zeichnet als der Datensatz beschreibt.
 */
const BAUM_HOEHE_ERSATZ = 10;
const KRONE_ANTEIL_ERSATZ = 0.55;

/**
 * Schranken gegen Tippfehler in OSM. Ein `height=120` an einem Strassenbaum
 * ist keine Messung, sondern ein Vertipper — und wuerde als 120-m-Kugel das
 * halbe Modell verdecken. Die Bandbreite deckt vom Jungbaum bis zur
 * Altbuche alles ab, was in einer deutschen Innenstadt steht.
 */
const HOEHE_MIN = 1.5;
const HOEHE_MAX = 45;
const KRONE_MIN = 1.0;
const KRONE_MAX = 25;

/** Hecke: Oberkante schmaler als die Basis (geschnittene Hecke laeuft an). */
const HECKE_OBEN_ANTEIL = 0.65;
/** Unter dieser Dicke waere die Hecke eine Flaeche ohne Koerper. */
const HECKE_BREITE_MIN = 0.3;
/** Minimale Bauhoehe, damit ein fehlerhafter Datensatz kein Nullvolumen ergibt. */
const HECKE_HOEHE_MIN = 0.3;

// ===========================================================================
// 3  DETERMINISTISCHE STREUUNG
// ===========================================================================

/**
 * Streuwert aus der Objekt-Id — stabil ueber alle Sitzungen hinweg.
 *
 * WARUM NICHT `Math.random()`: das Bild aenderte sich bei jedem Neuaufbau der
 * Szene. Zwei Screenshots derselben Planung zeigten verschiedene Baeume, und
 * in einem Genehmigungsverfahren ist genau das ein Mangel.
 *
 * WARUM NICHT DIE BLOSSE QUERSUMME der Zeichen: OSM vergibt Ids fortlaufend.
 * Die Baeume einer Allee tragen deshalb fast gleiche Ids, und eine Quersumme
 * bildet benachbarte Zahlen auf benachbarte Werte ab — die Allee bekaeme
 * einen sichtbaren Farb- und Hoehenverlauf von einem Ende zum anderen. Das
 * waere schlimmer als gar keine Streuung, weil es wie eine Aussage aussieht.
 * FNV-1a (dieselbe Konstruktion wie `gebaeudeVariante()` in palette.ts) mischt
 * die Bits und ist trotzdem vollstaendig reproduzierbar.
 */
function streuwert(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 0..999 auf -1..+1 abbilden. */
function mittig(x: number): number {
  return (x / 999) * 2 - 1;
}

function klemm(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

interface Streuung {
  /** Index im Farbband der jeweiligen Laubart. */
  ton: number;
  hoeheFaktor: number;
  kroneFaktor: number;
  /** Drehung der Krone um die Hochachse (rad) — bricht das Facettenmuster. */
  drehung: number;
}

/**
 * Vier voneinander unabhaengige Groessen aus EINEM Hashwert: die Bits von
 * FNV-1a sind gut durchmischt, verschiedene Schiebeweiten liefern darum
 * praktisch unkorrelierte Werte.
 *
 * Die Drehung ist der billigste Trick mit der groessten Wirkung: ohne sie
 * stehen alle 753 Kronen mit exakt derselben Facettenstellung im Bild, und
 * das Auge erkennt das Muster sofort als Computergrafik.
 */
function streuung(id: string, anzahlToene: number): Streuung {
  const h = streuwert(id);
  return {
    ton: h % anzahlToene,
    hoeheFaktor: 1 + STREUUNG * mittig((h >>> 7) % 1000),
    kroneFaktor: 1 + STREUUNG * mittig((h >>> 17) % 1000),
    drehung: (((h >>> 3) % 360) * Math.PI) / 180,
  };
}

// ===========================================================================
// 4  BAUSTEINE: KUGEL, KEGEL, ZYLINDER
// ===========================================================================

/** Ein Netz im LOKALEN System des Objekts: x = Ost, y = Nord, z = hoch, Meter. */
interface Netz {
  ecken: [number, number, number][];
  dreiecke: [number, number, number][];
}

/**
 * Einheitskugel durch Ikosaeder-Unterteilung.
 *
 * Warum Ikosaeder und nicht Laengen-/Breitenkreise: eine Kugel aus Meridianen
 * hat an den Polen eine dichte Dreiecksrosette und am Aequator lange, duenne
 * Dreiecke — bei Streiflicht sieht man beides. Der unterteilte Ikosaeder
 * verteilt die Ecken gleichmaessig und braucht fuer dieselbe Rundung weniger
 * Dreiecke.
 *
 * Die Flaechenliste ist die Standardaufstellung des Ikosaeders; sie ist von
 * aussen betrachtet gegen den Uhrzeigersinn orientiert, die Normalen zeigen
 * also nach aussen.
 */
let kugelZwischenspeicher: Netz | null = null;

function einheitsKugel(): Netz {
  if (kugelZwischenspeicher) return kugelZwischenspeicher;

  const t = (1 + Math.sqrt(5)) / 2;
  const roh: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const ecken = roh.map(auf1);
  let dreiecke: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let stufe = 0; stufe < KUGEL_UNTERTEILUNG; stufe++) {
    const mitten = new Map<string, number>();
    const mitte = (a: number, b: number): number => {
      const schluessel = a < b ? `${a}_${b}` : `${b}_${a}`;
      const vorhanden = mitten.get(schluessel);
      if (vorhanden !== undefined) return vorhanden;
      const p = ecken[a];
      const q = ecken[b];
      ecken.push(auf1([p[0] + q[0], p[1] + q[1], p[2] + q[2]]));
      const index = ecken.length - 1;
      mitten.set(schluessel, index);
      return index;
    };
    const naechste: [number, number, number][] = [];
    for (const [a, b, c] of dreiecke) {
      const ab = mitte(a, b);
      const bc = mitte(b, c);
      const ca = mitte(c, a);
      // Reihenfolge beibehalten -> Orientierung bleibt nach aussen
      naechste.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    dreiecke = naechste;
  }

  kugelZwischenspeicher = { ecken, dreiecke };
  return kugelZwischenspeicher;
}

/** Auf Einheitslaenge bringen. */
function auf1(p: [number, number, number]): [number, number, number] {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/**
 * Kegel als Faecher: Mantelflaeche von der Grundkreisecke zur Spitze, dazu
 * eine geschlossene Grundflaeche. Ohne die Grundflaeche saehe man von schraeg
 * unten in den hohlen Baum hinein — und genau von dort schaut die
 * Fussgaengerperspektive.
 *
 * Ergebnis liegt mit dem Grundkreis in z = 0, die Spitze bei z = 1,
 * Grundradius 1. Skaliert wird beim Einsetzen.
 */
function einheitsKegel(segmente: number): Netz {
  const ecken: [number, number, number][] = [];
  for (let i = 0; i < segmente; i++) {
    const w = (i / segmente) * Math.PI * 2;
    ecken.push([Math.cos(w), Math.sin(w), 0]);
  }
  const spitze = ecken.push([0, 0, 1]) - 1;
  const mittelpunkt = ecken.push([0, 0, 0]) - 1;

  const dreiecke: [number, number, number][] = [];
  for (let i = 0; i < segmente; i++) {
    const j = (i + 1) % segmente;
    dreiecke.push([i, j, spitze]); // Mantel, Normale nach aussen
    dreiecke.push([mittelpunkt, j, i]); // Grundflaeche, Normale nach unten
  }
  return { ecken, dreiecke };
}

/**
 * Stammzylinder als Mantel ohne Deckel: unten steht er im Boden, oben steckt
 * er in der Krone. Zwei Deckel waeren zwei Flaechen, die nie jemand sieht.
 *
 * Ergebnis: Radius 1, Hoehe 1 (z von 0 bis 1).
 */
function einheitsZylinder(segmente: number): Netz {
  const ecken: [number, number, number][] = [];
  for (let i = 0; i < segmente; i++) {
    const w = (i / segmente) * Math.PI * 2;
    ecken.push([Math.cos(w), Math.sin(w), 0]);
  }
  for (let i = 0; i < segmente; i++) {
    const w = (i / segmente) * Math.PI * 2;
    ecken.push([Math.cos(w), Math.sin(w), 1]);
  }
  const dreiecke: [number, number, number][] = [];
  for (let i = 0; i < segmente; i++) {
    const j = (i + 1) % segmente;
    dreiecke.push([i, j, segmente + j]);
    dreiecke.push([i, segmente + j, segmente + i]);
  }
  return { ecken, dreiecke };
}

const KEGEL_NETZ = einheitsKegel(KEGEL_SEGMENTE);
const ZYLINDER_NETZ = einheitsZylinder(STAMM_SEGMENTE);

// ===========================================================================
// 5  SAMMLER — Dreiecke nach Farbe buendeln
// ===========================================================================

/**
 * Sammelt Dreiecke GETRENNT NACH FARBE und gibt sie als EIN Primitive aus.
 *
 * Der Grund fuer die Trennung ist derselbe wie beim `FarbSammler` in stadt.ts:
 * `PerInstanceColorAppearance` liest die Farbe aus dem Instanz-Attribut, NICHT
 * aus einem Eckpunkt-Farbkanal. Ein per Eckpunkt gesetzter Farbwert wird
 * stillschweigend ignoriert und alles erscheint weiss. Also je Farbe eine
 * eigene Geometrie — und alle Geometrien zusammen in ein Primitive.
 */
class GruenSammler {
  private nach = new Map<string, { farbe: Cesium.Color; positionen: number[]; indizes: number[] }>();

  /** Haengt ein fertiges Weltnetz an. `ecken` sind Weltpunkte, `dreiecke` Indizes darin. */
  netz(farbeHex: string, ecken: Cesium.Cartesian3[], dreiecke: [number, number, number][]): void {
    if (ecken.length < 3 || !dreiecke.length) return;
    let eintrag = this.nach.get(farbeHex);
    if (!eintrag) {
      eintrag = {
        farbe: Cesium.Color.fromCssColorString(farbeHex),
        positionen: [],
        indizes: [],
      };
      this.nach.set(farbeHex, eintrag);
    }
    const basis = eintrag.positionen.length / 3;
    for (const c of ecken) eintrag.positionen.push(c.x, c.y, c.z);
    for (const [a, b, c] of dreiecke) eintrag.indizes.push(basis + a, basis + b, basis + c);
  }

  get leer(): boolean {
    for (const e of this.nach.values()) if (e.indizes.length) return false;
    return true;
  }

  zuPrimitive(id: string): Cesium.Primitive | null {
    const instanzen: Cesium.GeometryInstance[] = [];
    let i = 0;
    for (const { farbe, positionen, indizes } of this.nach.values()) {
      if (!indizes.length) continue;
      const werte = new Float64Array(positionen);
      const attribute = new Cesium.GeometryAttributes();
      attribute.position = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: werte,
      });
      const geometrie = new Cesium.Geometry({
        attributes: attribute,
        indices: new Uint32Array(indizes),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(werte)),
      });
      instanzen.push(
        new Cesium.GeometryInstance({
          // Normalen aus der Geometrie rechnen: die Krone bekommt dadurch
          // weiche Schattierung statt Facetten, der Koerper wirkt rund.
          geometry: Cesium.GeometryPipeline.computeNormal(geometrie),
          id: `${id}:${i++}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) },
        }),
      );
    }
    if (!instanzen.length) return null;
    return new Cesium.Primitive({
      geometryInstances: instanzen,
      // closed:false wie bei den Gebaeuden in stadt.ts — ohne Rueckseiten-
      // Aussortierung faellt kein Koerper aus, falls ein Ring einmal falsch
      // herum ankommt. Ins Innere eines geschlossenen Volumens sieht ohnehin
      // niemand, die Mehrkosten sind damit rein rechnerisch.
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: false }),
      // Siehe Kopfkommentar: gedrosselte Tabs haengen im Async-Pfad.
      asynchronous: false,
    });
  }
}

// ===========================================================================
// 6  BAEUME
// ===========================================================================

/** Farbband zur Laubart. Ohne Angabe gilt Laubbaum (siehe `baueBaeume`). */
function farbband(laubart: GelaendePunktObjekt['laubart']): string[] {
  if (laubart === 'nadelbaum') return VEGETATION_FARBEN.nadel;
  if (laubart === 'immergruen') return VEGETATION_FARBEN.immergruen;
  return VEGETATION_FARBEN.laub;
}

/**
 * Baut alle Baeume aus den Punktobjekten.
 *
 * Je Baum entstehen zwei Koerper: Stamm (Zylinder) und Krone (Ellipsoid,
 * Kegel oder Kugel je nach Laubart). Beide werden im lokalen Ost-Nord-Hoch-
 * System des Baumstandorts erzeugt und mit EINER Rahmenmatrix in die Welt
 * gesetzt. Das ist nicht nur schneller als eine Umrechnung je Eckpunkt (eine
 * Projektionsrechnung statt rund sechzig), es ist auch richtiger: die Krone
 * bleibt dadurch eine echte Kugel und wird nicht durch die Kruemmung der
 * Bezugsflaeche verzogen.
 *
 * OHNE ANGABE DER LAUBART wird Laubbaum gezeichnet. Begruendung: von den 753
 * Baeumen des Zielgebiets tragen 479 ein `leaf_type`, und der Strassenbaum in
 * einer hessischen Innenstadt ist ganz ueberwiegend sommergruenes Laub
 * (Platane, Linde, Ahorn). Das ist eine ANNAHME fuer die Darstellung — in der
 * Bilanz (`baumBilanz`) wird sie deshalb NICHT mitgezaehlt.
 */
export function baueBaeume(punkte: GelaendePunktObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const kugel = einheitsKugel();
  const prims: Cesium.Primitive[] = [];
  let sammler = new GruenSammler();
  let imBuendel = 0;

  const abschliessen = (): void => {
    if (!sammler.leer) {
      const p = sammler.zuPrimitive(`baum:buendel${prims.length}`);
      if (p) prims.push(p);
    }
    sammler = new GruenSammler();
    imBuendel = 0;
  };

  for (const b of punkte) {
    if (b.art !== 'baum' && b.art !== 'strauch') continue;

    // --- Masse: gemessen schlaegt Annahme, danach Streuung, danach Schranke --
    const rohHoehe = b.hoeheM ?? BAUM_HOEHE_ERSATZ;
    const rohKrone = b.kroneM ?? rohHoehe * KRONE_ANTEIL_ERSATZ;
    const band = farbband(b.laubart);
    const s = streuung(b.id, band.length);
    const hoehe = klemm(rohHoehe * s.hoeheFaktor, HOEHE_MIN, HOEHE_MAX);
    const kroneR = klemm(rohKrone * s.kroneFaktor, KRONE_MIN, KRONE_MAX) / 2;

    // --- Rahmen: einmal je Baum, danach nur noch Matrixmultiplikationen -----
    // Der Baum steht auf der GEBAUTEN Oberflaeche, nicht auf einem pauschalen
    // Sockel. Frueher waren es 0,1 m ueber dem Gelaende (wie verkehr.ts), weil
    // die Bodenzeichnung 2-9,8 cm hoch stapelte und der Stammfuss sonst darin
    // steckte. Mit Konstruktionshoehen ist der Boden eines Baumes an der
    // Strasse der Gehweg (12 cm) und im Park das Gelaende (0 cm) — genau das
    // liefert `bauOben`. Die 2 cm Rest sind Einbindung, damit der Fuss bei
    // streifendem Licht nicht als Fuge aufblitzt.
    const [lonB, latB] = nachWgs(b.pos);
    const rahmen = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(lonB, latB, hoehen.bauOben(b.pos[0], b.pos[1]) - 0.02),
    );
    const welt = (p: [number, number, number]): Cesium.Cartesian3 =>
      Cesium.Matrix4.multiplyByPoint(rahmen, new Cesium.Cartesian3(p[0], p[1], p[2]), new Cesium.Cartesian3());

    const sin = Math.sin(s.drehung);
    const cos = Math.cos(s.drehung);
    /** Lokales Netz skalieren, um die Hochachse drehen, anheben, in die Welt setzen. */
    const einsetzen = (netz: Netz, rx: number, ry: number, rz: number, z0: number, farbe: string): void => {
      const ecken = netz.ecken.map((p) => {
        const x = p[0] * rx;
        const y = p[1] * ry;
        return welt([x * cos - y * sin, x * sin + y * cos, p[2] * rz + z0]);
      });
      sammler.netz(farbe, ecken, netz.dreiecke);
    };

    const stammFrei = hoehe * STAMM_ANTEIL;
    const stammR = hoehe / STAMM_SCHLANKHEIT / 2;
    const kronenFarbe = band[s.ton];

    if (b.art === 'strauch') {
      // Strauch: bodennaher, abgeplatteter Busch OHNE Stamm — die Baum-Klemmen
      // gelten hier nicht (ein 1-m-Busch darf 1 m bleiben).
      const strauchHoehe = klemm((b.hoeheM ?? 1.5) * s.hoeheFaktor, 0.4, 4);
      const strauchR = klemm((b.kroneM ?? strauchHoehe * 1.2) * s.kroneFaktor, 0.5, 6) / 2;
      // Mitte auf halber Hoehe, Unterkante knapp UNTER dem Sockel (der Rahmen
      // steht schon auf Gelaende + 0,1 m) — der Busch waechst aus dem Boden.
      einsetzen(kugel, strauchR, strauchR, strauchHoehe / 2, strauchHoehe / 2 - 0.06, VEGETATION_FARBEN.hecke);
      if (++imBuendel >= BUENDEL_BAEUME) abschliessen();
      continue;
    }

    if (b.laubart === 'nadelbaum') {
      // Kegel: Grundkreis auf dem Kronenansatz, Spitze exakt auf der Baumhoehe.
      const kegelHoehe = Math.max(0.5, hoehe - stammFrei);
      einsetzen(KEGEL_NETZ, kroneR, kroneR, kegelHoehe, stammFrei, kronenFarbe);
      einsetzen(ZYLINDER_NETZ, stammR, stammR, stammFrei, 0, VEGETATION_FARBEN.stamm);
    } else if (b.laubart === 'immergruen') {
      // Immergruen: eine geschlossene, kompakte Kugel.
      //
      // Die Kugel wird VERTIKAL an die verfuegbare Hoehe gekoppelt, statt sie
      // per max() anzuheben: bei breiter Krone und niedrigem Baum (27 Faelle im
      // Pilotbestand, z. B. h=6 m mit 10 m Krone) ragte die alte Konstruktion
      // 23 % ueber die GEMESSENE Baumhoehe hinaus und meterweit unter den
      // Boden. Die Messung ist die Obergrenze, nicht ein Richtwert.
      const rzImmer = Math.min(kroneR, (hoehe - Math.min(stammFrei, hoehe * 0.25)) / 2);
      const mitteZ = hoehe - rzImmer;
      einsetzen(kugel, kroneR, kroneR, rzImmer, mitteZ, kronenFarbe);
      einsetzen(ZYLINDER_NETZ, stammR, stammR, mitteZ, 0, VEGETATION_FARBEN.stamm);
    } else {
      // LAUBBAUM aus mehreren Ballen statt einer Kugel.
      //
      // Eine einzelne Kugel bleibt im Bild eine Kugel — sie hat einen glatten
      // Umriss, und ein Baum hat keinen. Eine echte Laubkrone besteht aus
      // Astpartien, die sich ueberlappen; genau dieser unregelmaessige Umriss
      // laesst sie als Baum lesen. Drei bis vier gegeneinander versetzte Ballen
      // erzeugen ihn mit vertretbarem Aufwand.
      //
      // Die Ballen bleiben INNERHALB des gemessenen Kronendurchmessers und die
      // Oberkante auf der gemessenen Baumhoehe — die Messung wird nicht
      // aufgeweicht, nur die Form innerhalb der Messung wird glaubwuerdiger.
      // Wie beim Immergruen: die vertikale Halbachse folgt der verfuegbaren
      // Hoehe, damit die Kronenoberkante die gemessene Baumhoehe TRIFFT statt
      // sie zu ueberschreiten.
      const rz = Math.min(kroneR * KRONE_ABPLATTUNG, (hoehe - Math.min(stammFrei, hoehe * 0.25)) / 2);
      const mitteZ = hoehe - rz;

      // Ballenanordnung deterministisch aus der Id — dieselbe Baumreihe sieht
      // bei jedem Laden gleich aus.
      const BALLEN = 4;
      const ballenR = kroneR * 0.62;
      const versatz = kroneR * 0.42;
      for (let i = 0; i < BALLEN; i++) {
        const winkel = s.drehung + (i * Math.PI * 2) / BALLEN;
        // Ein Ballen sitzt hoeher (Kronenspitze), die uebrigen tiefer verteilt
        const obenAn = i === 0;
        const dx = obenAn ? 0 : Math.cos(winkel) * versatz;
        const dy = obenAn ? 0 : Math.sin(winkel) * versatz;
        const dz = obenAn ? rz * 0.28 : -rz * 0.18 + Math.sin(winkel * 1.7) * rz * 0.12;
        const r = obenAn ? ballenR * 0.92 : ballenR;
        const ecken = kugel.ecken.map((p) => {
          const x = p[0] * r + dx;
          const y = p[1] * r + dy;
          return welt([
            x * cos - y * sin,
            x * sin + y * cos,
            p[2] * r * KRONE_ABPLATTUNG + mitteZ + dz,
          ]);
        });
        sammler.netz(kronenFarbe, ecken, kugel.dreiecke);
      }
      // Stamm bis in die Kronenmitte — siehe STAMM_ANTEIL.
      einsetzen(ZYLINDER_NETZ, stammR, stammR, mitteZ, 0, VEGETATION_FARBEN.stamm);
    }

    if (++imBuendel >= BUENDEL_BAEUME) abschliessen();
  }
  abschliessen();
  return prims;
}

// ===========================================================================
// 7  HECKEN
// ===========================================================================

/**
 * Baut die Hecken als aufragende Baender entlang ihrer Achse.
 *
 * `bandRing` (shared/geo/geometry.ts) liefert das Band MIT Gehrungsstoessen —
 * anders als `wegKorridor`, das je Segment ein Rechteck und an jedem Knick
 * einen Kreis erzeugt. Fuer eine Hecke waere das falsch: sie zerfiele in eine
 * Kette von Knubbeln statt als durchgehender Koerper zu lesen.
 *
 * Die Oberkante ist schmaler als die Basis (HECKE_OBEN_ANTEIL). Das ist keine
 * Verzierung: eine geschnittene Hecke laeuft nach oben an, und die schraege
 * Flanke faengt das Licht anders als eine senkrechte Wand — ohne sie sieht
 * eine Hecke aus wie eine gruen gestrichene Mauer.
 *
 * Alle uebrigen Linienarten (Mauer, Zaun, Gleis, Bordstein …) werden hier
 * ausdruecklich NICHT gezeichnet; sie sind kein Gruen und gehoeren in ein
 * eigenes Modul.
 */
export function baueHecken(linien: GelaendeLinienObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const sammler = new GruenSammler();

  for (const l of linien) {
    if (l.art !== 'hecke' || l.achse.length < 2) continue;

    const breite = Math.max(HECKE_BREITE_MIN, l.breiteM);
    const hoeheM = Math.max(HECKE_HOEHE_MIN, l.hoeheM);
    let unten = bandRing(l.achse, breite);
    if (!unten || unten.length < 3) continue;
    let oben = bandRing(l.achse, breite * HECKE_OBEN_ANTEIL);
    /*
     * Beide Baender entstehen aus derselben Achse und derselben Gehrungsregel,
     * die Ecken entsprechen einander also 1:1. Der Test ist die Absicherung
     * fuer den Ausnahmefall, dass die Doppelpunkt-Bereinigung im schmaleren
     * Band eine Ecke mehr zusammenfallen laesst — dann bleibt die Hecke eben
     * senkrecht statt schief, aber sie verschwindet nicht.
     */
    if (!oben || oben.length !== unten.length) oben = unten;

    /*
     * Umlaufsinn vereinheitlichen. Bei einem im Uhrzeigersinn umlaufenden Ring
     * zeigten die gerechneten Normalen der Flanken nach INNEN — die Hecke waere
     * von der falschen Seite beleuchtet und stuende als dunkler Riegel im Bild.
     * Beide Ringe muessen dabei gemeinsam gedreht werden, sonst waere die
     * Zuordnung unten/oben verdreht und die Flanken verwundeten sich.
     */
    if (signierteFlaeche(unten) < 0) {
      unten = [...unten].reverse();
      oben = [...oben].reverse();
    }

    const n = unten.length;
    // Fuss UNTER der gezeichneten Oberflaeche (0,098 m Auflagen + Sockel
    // 0,1 m), Oberkante ueber dem Sockel: eine Hecke waechst aus dem Boden,
    // sie steht nicht darauf. Die alten 2 cm lagen MITTEN in der
    // Bodenzeichnung — die Hecke war unten angeschnitten.
    const ecken = [
      ...unten.map((p) => hoehen.welt(p, -0.05)),
      ...oben.map((p) => hoehen.welt(p, 0.1 + hoeheM)),
    ];

    const dreiecke: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      dreiecke.push([i, j, n + j]);
      dreiecke.push([i, n + j, n + i]);
    }
    // Deckflaeche. Die Zerlegung braucht nur die Grundrissform; die Hochwerte
    // sind dafuer ohne Belang, darum eine ebene Kopie.
    const deckel: Punkt3D[] = oben.map((p) => [p[0], p[1], 0]);
    for (const [a, b, c] of zerlegeFlaeche(deckel)) dreiecke.push([n + a, n + b, n + c]);
    // Eine Bodenflaeche entfaellt: die Hecke steht auf dem Gelaende.

    sammler.netz(VEGETATION_FARBEN.hecke, ecken, dreiecke);
  }

  const p = sammler.zuPrimitive('hecke:buendel0');
  return p ? [p] : [];
}

// ===========================================================================
// 8  BILANZ
// ===========================================================================

/**
 * Zaehlt den Baumbestand — fuer die Legende und fuer den Nachweis, wie viel
 * davon wirklich gemessen ist.
 *
 * `gemessen` sind ausschliesslich die Baeume, deren HOEHE aus OSM stammt
 * (`gemessen === true`, gesetzt in stadtdetails.ts). Alle anderen tragen eine
 * Klassenannahme; sie sind darstellbar, aber kein Mass.
 *
 * `laubbaum` und `nadelbaum` zaehlen NUR ausdruecklich getaggte Baeume. Die
 * Darstellung zeichnet Baeume ohne `leaf_type` als Laubbaum — hier werden sie
 * bewusst nicht dazugerechnet, sonst waere eine Annahme als Erhebung
 * ausgewiesen. `gesamt - laubbaum - nadelbaum` ergibt also die Baeume ohne
 * Angabe PLUS die immergruenen; das ist gewollt und muss in der Anzeige als
 * „k. A." erscheinen, nie als Null.
 */
export function baumBilanz(punkte: GelaendePunktObjekt[]): {
  gesamt: number;
  gemessen: number;
  laubbaum: number;
  nadelbaum: number;
} {
  let gesamt = 0;
  let gemessen = 0;
  let laubbaum = 0;
  let nadelbaum = 0;
  for (const p of punkte) {
    if (p.art !== 'baum') continue;
    gesamt++;
    if (p.gemessen === true) gemessen++;
    if (p.laubart === 'laubbaum') laubbaum++;
    else if (p.laubart === 'nadelbaum') nadelbaum++;
  }
  return { gesamt, gemessen, laubbaum, nadelbaum };
}
