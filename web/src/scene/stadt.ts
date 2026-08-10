/**
 * Massgetreues digitales Stadtabbild.
 *
 * Vorgabe des Auftraggebers: KEINE Luftbild-Kulisse, sondern eine aus echten
 * Massen gebaute Welt — Fahrbahn, Gehweg, Radweg, Fussgaengerzone, Platz und
 * Gruenflaeche muessen als solche erkennbar sein, und zwar ueber KONTRASTE,
 * nicht ueber bunte Farben.
 *
 * Zwei Bausteine:
 *  1. Gebaeude aus den ECHTEN LoD2-Flaechen (Dach- und Wandflaechen des
 *     amtlichen Modells) — dadurch Sattel-, Walm-, Pult- und Zeltdaecher statt
 *     Quader mit flachem Deckel.
 *  2. Bodenzeichnung aus der tatsaechlichen Nutzung (ALKIS) und dem
 *     Wegenetz (OSM), gestaffelt nach Rang.
 */

import * as Cesium from 'cesium';
import type { FlaechenArt, Gelaende, GelaendeFlaeche, GelaendeLinienObjekt, Ring } from '@shared/domain/types';
import { nachUtm, nachWgs } from '@shared/geo/proj';
import { hoeheImHoehenband } from '@shared/bau/hoehenlage';
import type { Hoehenlage } from './gelaende.ts';
import { verdichteRing } from './gelaende.ts';
import {
  FLAECHEN_STIL,
  GEBAEUDE_STIL,
  KONTUR_VERSATZ_M,
  PLATTE_STIL,
  gebaeudeVariante,
  pruefePalette,
  stilFuer,
} from './palette.ts';

// ---------------------------------------------------------------------------
// Palette: EINZIGE Quelle ist palette.ts (CIELAB-konstruiert, mit
// Selbstpruefung). Diese Datei haelt keine eigenen Farbwerte mehr — die
// frueher hier gepflegte Zweitpalette ist genau der Grund gewesen, warum
// Dokumentation und Bild auseinanderliefen.
// ---------------------------------------------------------------------------

// Die Selbstpruefung laeuft einmal BEIM LADEN. Sie prueft die Palette gegen
// den GEMESSENEN Nachbarschaftsgraphen der Flaechenklassen (palette.ts,
// NACHBARSCHAFT_M) — reisst eine spaetere Farbaenderung einen der Abstaende,
// steht es in der Konsole, statt still im Bild zu verschwinden.
//
// Bewusst console.error und nicht console.warn: Eine gerissene Lesbarkeits-
// regel ist kein Schoenheitsfehler, sondern die Rueckkehr genau des Zustands,
// den der Auftraggeber beanstandet hat („Fleckenteppich aus Weiss, Creme und
// Grau"). Jeder Befund steht einzeln da, damit man ihn abarbeiten kann.
{
  const selbst = pruefePalette();
  if (!selbst.ok) {
    console.error(
      `[Palette] Selbstpruefung FEHLGESCHLAGEN — ${selbst.befunde.length} Befund(e). ` +
        `Die Basiskarte verletzt eine Lesbarkeitsregel (docs/KARTENDESIGN.md, palette.ts).`,
    );
    for (const b of selbst.befunde) console.error(`[Palette]   • ${b}`);
  } else {
    console.info('[Palette] Selbstpruefung bestanden (Deckel L* 93, Nachbarschaft DL* >= 9, Konturen, WCAG 1.4.11).');
  }
}

/** Fuellfarben je Flaechenart — abgeleitet aus palette.FLAECHEN_STIL. */
export const BODEN_FARBE: Record<FlaechenArt, string> = Object.fromEntries(
  (Object.keys(FLAECHEN_STIL) as FlaechenArt[]).map((art) => [art, FLAECHEN_STIL[art].fuellung]),
) as Record<FlaechenArt, string>;

/**
 * ALKIS fuehrt den GESAMTEN Strassenraum als eine Flaeche (Gehweg, Parkstreifen
 * und Bankett eingeschlossen). Er ist die Buehne, nicht die Fahrbahn — und
 * bekommt darum einen eigenen, ruhigeren Ton als der OSM-Decker darueber.
 */
export const PLATTE_FARBE = PLATTE_STIL.fuellung;

/**
 * Belagsabhaengige Tonwertverschiebung in Prozent.
 *
 * OSM fuehrt fuer 1.560 der Flaechen einen `surface`-Wert. Genau daraus
 * entsteht die Textur, die einen gepflasterten Platz von einer Asphaltflaeche
 * unterscheidet — ohne sie wirkt jede Flaeche derselben Klasse gleich.
 * Bewusst KLEINE Werte: der Belag darf die Klassenhierarchie nicht ueberlagern.
 */
export const BELAG_TON: Record<string, number> = {
  asphalt: -0.03,
  concrete: 0.02,
  paving_stones: 0.05, // Betonsteinpflaster: heller, ruhig
  sett: -0.02, // Kopfsteinpflaster: dunkler, koerniger Eindruck
  cobblestone: -0.04,
  gravel: 0.03,
  fine_gravel: 0.06,
  compacted: 0.01,
  ground: -0.02,
  dirt: -0.03,
  grass: 0,
  sand: 0.1,
  wood: -0.05,
  metal: 0.04,
  zebra: 0.22, // Fussgaengerueberweg: deutlich heller, er soll auffallen
  bahnsteig: 0.03,
};

/** Hellt eine Farbe um einen Anteil auf (negativ = abdunkeln). */
export function tonVerschieben(farbe: Cesium.Color, anteil: number): Cesium.Color {
  if (!anteil) return farbe;
  const m = (v: number) => Math.max(0, Math.min(1, anteil > 0 ? v + (1 - v) * anteil : v * (1 + anteil)));
  return new Cesium.Color(m(farbe.red), m(farbe.green), m(farbe.blue), farbe.alpha);
}

export const GEBAEUDE_FARBE = {
  /**
   * Wand L* 80, Dach L* 70 — der Abstand von 10 L* ist die untere Grenze, ab
   * der die Dachform ohne Licht lesbar bleibt; die Sonne erzeugt den Rest.
   * Das Dach ist zugleich leicht waermer als die Wand (Ziegel- statt Putzton).
   */
  wand: Cesium.Color.fromCssColorString(GEBAEUDE_STIL.wand),
  dach: Cesium.Color.fromCssColorString(GEBAEUDE_STIL.dach),
  /** Sockelband am Gebaeudefuss — AO-Ersatz genau dort, wo Haus auf Boden trifft. */
  sockel: Cesium.Color.fromCssColorString(GEBAEUDE_STIL.sockel),
  /** First- und Gratlinie — trennt die Dachflaechen auch bei gleicher Beleuchtung. */
  dachFirst: GEBAEUDE_STIL.dachFirst,
  /** Kante: die 3D-Entsprechung der Strassenkontur (KARTENDESIGN 4.1). */
  kante: GEBAEUDE_STIL.kante,
};

/**
 * Dachlandschaft.
 *
 * Die Dachform ist das, was einer deutschen Innenstadt aus der Vogelperspektive
 * ihren Charakter gibt — das Nebeneinander von Ziegel und Flachdach. Bisher
 * trugen alle 2.563 Gebaeude denselben Ton; damit sah jede Stadt gleich aus.
 *
 * Die Unterscheidung kommt aus dem AMTLICHEN Modell und ist geometrisch
 * belegt, nicht geraten: Liegt der First mehr als 0,5 m ueber der Traufe, hat
 * das Gebaeude ein geneigtes Dach (1.130 von 2.563 im Pilotgebiet). Das
 * CityGML-Attribut `Dachtyp_tridicon` verfeinert das, wo es gepflegt ist
 * (1.917 Gebaeude).
 *
 * Die Toene bleiben GEDAEMPFT. Ein Ziegeldach ist warm, kein Signalrot — die
 * kraeftigen Farben bleiben den Planobjekten vorbehalten (KARTENDESIGN 5.4).
 */
export const DACH_TON = {
  /** Ziegel, geneigt. Vier Alterungsstufen — Ziegel altern nie gleichmaessig. */
  ziegel: ['#a5887c', '#9e8177', '#aa8e82', '#987b72'],
  /** Flachdach: Bitumen oder Kies, kuehl und neutral. */
  flach: ['#a6a7a6', '#a1a2a2', '#aaabaa'],
  /** Pultdach — zwischen beiden, meist Anbauten und Nebengebaeude. */
  pult: ['#a8a29a', '#a29c95'],
  /** Metall oder Glas (nur aus OSM `roof:material`). */
  metall: '#b4bbbf',
  /** Schiefer und Zink — dunkler, kuehl. */
  schiefer: '#8b9095',
};

/**
 * Zwingt eine fremde Farbe ins Basisband der Palette.
 *
 * OSM fuehrt fuer einzelne Gebaeude `building:colour` und `roof:colour` — im
 * Zielgebiet u. a. „darkred" und ein kraeftiges Petrol. Unveraendert
 * uebernommen zerreissen solche Werte das Farbsystem: sie sind gesaettigter
 * als jedes Planobjekt und ziehen den Blick auf ein beliebiges Wohnhaus statt
 * auf den Rettungsweg. Laut KARTENDESIGN 5.4 gehoert der Bereich hoher
 * Buntheit ausschliesslich den Planobjekten.
 *
 * Der Farbton bleibt also erhalten (ein rotes Haus bleibt roetlich), aber
 * Saettigung und Helligkeit werden in das Band der Basisflaechen gerueckt.
 */
export function insBasisband(farbe: Cesium.Color, zielHelligkeit = 0.72, maxSaettigung = 0.18): Cesium.Color {
  const r = farbe.red;
  const g = farbe.green;
  const b = farbe.blue;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const hell = (max + min) / 2;
  const spanne = max - min;
  if (spanne < 1e-6) {
    // Grauton: nur die Helligkeit angleichen — mit DERSELBEN Klemme wie der
    // Bunt-Zweig. Ohne sie fiel roof:colour=black auf v=0,43 und riss ganze
    // Gebaeudekomplexe aus dem Basisband (Befund 08.08.2026).
    const v = Math.max(0.55, Math.min(0.86, hell * 0.4 + zielHelligkeit * 0.6));
    return new Cesium.Color(v, v, v, farbe.alpha);
  }
  const saettigung = hell > 0.5 ? spanne / (2 - max - min) : spanne / (max + min);
  const neueS = Math.min(saettigung, maxSaettigung);
  // Zielhelligkeit: zwischen Original und Bandmitte, damit ein dunkles Haus
  // dunkel bleibt, aber nicht mehr aus dem Band faellt.
  const neueL = Math.max(0.55, Math.min(0.86, hell * 0.4 + zielHelligkeit * 0.6));
  let ton = 0;
  if (max === r) ton = ((g - b) / spanne + (g < b ? 6 : 0)) / 6;
  else if (max === g) ton = ((b - r) / spanne + 2) / 6;
  else ton = ((r - g) / spanne + 4) / 6;
  const c = new Cesium.Color();
  Cesium.Color.fromHsl(ton, neueS, neueL, farbe.alpha, c);
  return c;
}

/**
 * Waehlt den Dachton eines Gebaeudes.
 * Reihenfolge: OSM-Farbe > OSM-Material > amtliche Dachform > Geometrie.
 */
export function dachTonFuer(g: {
  id: string;
  bodenHoehe: number;
  traufHoehe?: number;
  firstHoehe?: number;
  dachform?: string;
  dachFarbe?: string;
}): Cesium.Color {
  if (g.dachFarbe) {
    try {
      return insBasisband(Cesium.Color.fromCssColorString(g.dachFarbe), 0.66, 0.22);
    } catch {
      /* unbrauchbare OSM-Farbe ignorieren */
    }
  }
  // Deterministische Auswahl aus der Id — dieselbe Strasse sieht bei jedem
  // Laden gleich aus (kein Flimmern beim Neuladen).
  let h = 2166136261;
  for (let i = 0; i < g.id.length; i++) {
    h ^= g.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const waehle = (liste: string[]) => Cesium.Color.fromCssColorString(liste[(h >>> 8) % liste.length]);

  const form = (g.dachform ?? '').toLowerCase();
  if (form.includes('flat')) return waehle(DACH_TON.flach);
  if (form.includes('leanto') || form.includes('shed')) return waehle(DACH_TON.pult);
  if (form.includes('gable') || form.includes('hip') || form.includes('pyramid') || form.includes('mansard')) {
    return waehle(DACH_TON.ziegel);
  }

  // Ohne Attribut entscheidet die Geometrie: ein First deutlich ueber der
  // Traufe ist ein geneigtes Dach — das ist eine Messung, keine Annahme.
  // NUR wenn BEIDE Hoehen vorliegen: die Felder sind ABSOLUT (m ue. NHN,
  // Darmstadt ~150) — mit ??0 kippte ein fehlendes Feld die Klassifikation
  // deterministisch auf immer-ziegel bzw. immer-flach.
  if (g.firstHoehe === undefined || g.traufHoehe === undefined) return waehle(DACH_TON.flach);
  const aufbau = g.firstHoehe - g.traufHoehe;
  return aufbau > 0.5 ? waehle(DACH_TON.ziegel) : waehle(DACH_TON.flach);
}

/** Hintergrund — direkt aus der Palette (dort begruendet und geprueft). */
export { HIMMEL } from './palette.ts';

// ---------------------------------------------------------------------------
// Dreieckszerlegung ebener Flaechen im Raum
// ---------------------------------------------------------------------------

type P3 = [number, number, number];

/** Flaechennormale nach Newell — arbeitet auch bei leicht windschiefen Ringen. */
function normale(ring: P3[]): P3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Ohrenschnitt in der Ebene der Flaeche: die Achse mit dem groessten
 * Normalenanteil wird fallengelassen, danach wird zweidimensional zerlegt.
 */
function zerlege(ring: P3[]): [number, number, number][] {
  const punkte = [...ring];
  // geschlossene Ringe: letzten Punkt entfernen
  if (
    punkte.length > 2 &&
    Math.abs(punkte[0][0] - punkte[punkte.length - 1][0]) < 1e-6 &&
    Math.abs(punkte[0][1] - punkte[punkte.length - 1][1]) < 1e-6 &&
    Math.abs(punkte[0][2] - punkte[punkte.length - 1][2]) < 1e-6
  ) {
    punkte.pop();
  }
  const n = punkte.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  const nrm = normale(punkte);
  const ax = Math.abs(nrm[0]);
  const ay = Math.abs(nrm[1]);
  const az = Math.abs(nrm[2]);
  const [i0, i1] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2];
  const flach = punkte.map((p) => [p[i0], p[i1]] as [number, number]);

  let signiert = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    signiert += flach[j][0] * flach[i][1] - flach[i][0] * flach[j][1];
  }
  const gegenUhr = signiert > 0;

  const uebrig = [...Array(n).keys()];
  if (!gegenUhr) uebrig.reverse();
  const dreiecke: [number, number, number][] = [];
  let schutz = 0;

  const kreuz = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const drin = (a: [number, number], b: [number, number], c: [number, number], p: [number, number]) => {
    const d1 = kreuz(a, b, p);
    const d2 = kreuz(b, c, p);
    const d3 = kreuz(c, a, p);
    return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12;
  };
  // Toleranz auf DATENGENAUIGKEIT (CityGML/ALKIS runden auf mm, unsere Ringe
  // auf cm): die beiden Kopien eines Beruehrpunkts duerfen sich um Rundung
  // unterscheiden. Die alte 1e-9-Schwelle verfehlte reale Fast-Duplikate um
  // sechs Groessenordnungen — der Ohrenschnitt blockierte und der
  // Faecher-Fallback warf Bogenbaender ueber grosse Karree-Daecher.
  const deckungsgleich = (p: [number, number], q: [number, number]) =>
    Math.abs(p[0] - q[0]) < 2e-3 && Math.abs(p[1] - q[1]) < 2e-3;

  while (uebrig.length > 3 && schutz++ < 5000) {
    let geschnitten = false;
    for (let i = 0; i < uebrig.length; i++) {
      const ia = uebrig[(i + uebrig.length - 1) % uebrig.length];
      const ib = uebrig[i];
      const ic = uebrig[(i + 1) % uebrig.length];
      const a = flach[ia];
      const b = flach[ib];
      const c = flach[ic];
      if (kreuz(a, b, c) <= 1e-12) continue; // kein konvexes Ohr
      let frei = true;
      for (const k of uebrig) {
        if (k === ia || k === ib || k === ic) continue;
        const p = flach[k];
        // SELBSTBERUEHRENDE RINGE (Karree mit Innenhof): CityGML kodiert das
        // Hofloch oft als Schleife im selben Ring — Eckpunkte kommen dann
        // DOPPELT vor. Ein deckungsgleicher Punkt darf ein Ohr nicht
        // blockieren, sonst findet der Schnitt nie ein Ohr und der
        // Faecher-Fallback wirft Zacken quer ueber den Innenhof
        // (Befund Staatsarchiv-Karree, 08.08.2026: Flaeche 4.626 statt
        // 2.528,5 m2; mit dieser Ausnahme exakt und Hof bleibt offen).
        if (deckungsgleich(p, a) || deckungsgleich(p, b) || deckungsgleich(p, c)) continue;
        if (drin(a, b, c, p)) {
          frei = false;
          break;
        }
      }
      if (!frei) continue;
      dreiecke.push([ia, ib, ic]);
      uebrig.splice(i, 1);
      geschnitten = true;
      break;
    }
    if (!geschnitten) break; // entarteter Ring — Rest als Faecher
  }
  for (let i = 1; i + 1 < uebrig.length; i++) dreiecke.push([uebrig[0], uebrig[i], uebrig[i + 1]]);
  return dreiecke;
}

// ---------------------------------------------------------------------------
// Gebaeude aus den echten LoD2-Flaechen
// ---------------------------------------------------------------------------

/**
 * Sammelt Dreiecke GETRENNT NACH FARBE.
 *
 * Wichtig: `PerInstanceColorAppearance` nimmt die Farbe aus dem
 * GeometryInstance-Attribut, NICHT aus einem selbst angelegten
 * Eckpunkt-Farbkanal. Ein per-Eckpunkt gesetzter Farbwert wird stillschweigend
 * ignoriert und alles erscheint weiss. Darum bekommt jede Farbe ihre eigene
 * Geometrie; alle Geometrien landen anschliessend in EINEM Primitive.
 */
interface Sammler {
  positionen: number[];
  indizes: number[];
}

class FarbSammler {
  private nach = new Map<string, { farbe: Cesium.Color; s: Sammler }>();

  anhaengen(ring: P3[], farbe: Cesium.Color) {
    const dreiecke = zerlege(ring);
    if (!dreiecke.length) return;
    const schluessel = farbe.toCssHexString();
    let eintrag = this.nach.get(schluessel);
    if (!eintrag) {
      eintrag = { farbe, s: { positionen: [], indizes: [] } };
      this.nach.set(schluessel, eintrag);
    }
    const s = eintrag.s;
    const basis = s.positionen.length / 3;
    for (const p of ring) {
      const [lon, lat] = nachWgs([p[0], p[1]]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, p[2]);
      s.positionen.push(c.x, c.y, c.z);
    }
    for (const [a, b, c] of dreiecke) s.indizes.push(basis + a, basis + b, basis + c);
  }

  get anzahlDreiecke(): number {
    let n = 0;
    for (const e of this.nach.values()) n += e.s.indizes.length / 3;
    return n;
  }

  zuPrimitive(id: string, durchsichtig: boolean, ungeschattet = false): Cesium.Primitive | null {
    const instanzen: Cesium.GeometryInstance[] = [];
    let i = 0;
    for (const { farbe, s } of this.nach.values()) {
      if (!s.indizes.length) continue;
      const positionen = new Float64Array(s.positionen);
      const attribute = new Cesium.GeometryAttributes();
      attribute.position = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positionen,
      });
      const geometrie = new Cesium.Geometry({
        attributes: attribute,
        indices: new Uint32Array(s.indizes),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
      });
      instanzen.push(
        new Cesium.GeometryInstance({
          geometry: Cesium.GeometryPipeline.computeNormal(geometrie),
          id: `${id}:${i++}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) },
        }),
      );
    }
    if (!instanzen.length) return null;
    return new Cesium.Primitive({
      geometryInstances: instanzen,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: durchsichtig, closed: false, flat: ungeschattet }),
      asynchronous: false,
    });
  }
}

/**
 * Baut die Bestandsgebaeude. Wo das amtliche Modell echte Dach- und
 * Wandflaechen liefert, werden genau diese gezeichnet; sonst faellt das
 * Gebaeude auf einen Quader mit flachem Deckel zurueck.
 */
/**
 * Kanten der Dachflaechen als feine Linien.
 *
 * Ohne sie verschmelzen benachbarte Baukoerper mit gleicher Wandfarbe zu einer
 * weissen Masse — der Betrachter sieht kein Haus mehr, sondern einen Klumpen.
 * Die Kante ist das kartografische Gegenstueck zur Kontur bei Strassen: sie
 * kostet fast nichts und traegt den groessten Teil der Lesbarkeit.
 *
 * Gezeichnet werden nur DACHkanten. Wandkanten waeren doppelt (jede Wand
 * grenzt an eine andere) und wuerden das Bild zusetzen.
 */
export function baueGebaeudeKanten(gelaende: Gelaende, farbe = GEBAEUDE_FARBE.kante, breitePx = 1.3): Cesium.Primitive[] {
  const inst: Cesium.GeometryInstance[] = [];
  const c = Cesium.Color.fromCssColorString(farbe);
  const cFirst = Cesium.Color.fromCssColorString(GEBAEUDE_FARBE.dachFirst);
  for (const g of gelaende.gebaeude) {
    if (g.grundriss.length < 3) continue;
    // Der Gebaeudeumriss auf Traufhoehe.
    // Jede einzelne Dachteilflaeche zu umranden ergab eine Schraffur, die das
    // Modell zusetzte statt es zu gliedern. Die Kante soll das Gebaeude vom
    // Nachbarn trennen, nicht seine Dreieckszerlegung zeigen.
    const oben = g.traufHoehe ?? g.firstHoehe ?? g.bodenHoehe + 6;
    const pos = g.grundriss.map((p) => {
      const [lon, lat] = nachWgs(p);
      return Cesium.Cartesian3.fromDegrees(lon, lat, oben + 0.05);
    });
    pos.push(pos[0]);
    inst.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: pos,
          width: breitePx,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(c),
          // Fern ausblenden: aus der Distanz verdichten sich die Kanten aller
          // Gebaeude zu einer Schraffur, die das Bild zusetzt (Befund
          // 08.08.2026, "Gebaeude sehen falsch aus"). Nah tragen sie die
          // Lesbarkeit, fern traegt sie die Dachfarbe.
          distanceDisplayCondition: new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(0, 1200),
        },
      }),
    );

    // First- und Gratlinien — NUR die Kanten oberhalb der Traufe. Sie trennen
    // die Dachflaechen eines Sattel-/Walm-/Zeltdachs auch dann, wenn beide
    // zufaellig gleich beleuchtet sind (palette.GEBAEUDE_STIL.dachFirst).
    // Kanten AN der Traufe zeichnet schon der Umriss; die 0,4-m-Schwelle
    // haelt sie heraus.
    if (g.dachflaechen?.length && g.traufHoehe !== undefined) {
      const schwelle = g.traufHoehe + 0.4;
      for (const flaeche of g.dachflaechen) {
        for (let i = 0, j = flaeche.length - 1; i < flaeche.length; j = i++) {
          const a = flaeche[j];
          const b = flaeche[i];
          if (a[2] < schwelle || b[2] < schwelle) continue;
          const [lonA, latA] = nachWgs([a[0], a[1]]);
          const [lonB, latB] = nachWgs([b[0], b[1]]);
          inst.push(
            new Cesium.GeometryInstance({
              geometry: new Cesium.PolylineGeometry({
                positions: [
                  Cesium.Cartesian3.fromDegrees(lonA, latA, a[2] + 0.05),
                  Cesium.Cartesian3.fromDegrees(lonB, latB, b[2] + 0.05),
                ],
                width: 1.0,
                vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(cFirst),
                // Firste/Grate sind Nahbereichs-Detail — fern nur Schraffur.
                distanceDisplayCondition: new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(0, 700),
              },
            }),
          );
        }
      }
    }
  }
  // In Bloecken buendeln und ALLE zurueckgeben — die fruehere Fassung baute
  // die Bloecke auf, gab aber nur die ersten 9.000 Instanzen zurueck; ab dem
  // 9.001. Gebaeude fehlten die Kanten stillschweigend.
  const prims: Cesium.Primitive[] = [];
  const BLOCK = 3000;
  for (let i = 0; i < inst.length; i += BLOCK) {
    prims.push(
      new Cesium.Primitive({
        geometryInstances: inst.slice(i, i + BLOCK),
        appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
        asynchronous: false,
      }),
    );
  }
  return prims;
}

/**
 * Geschossbaender — die Fassadengliederung.
 *
 * Eine glatte Wand liest sich aus der Naehe als Klotz; erst die waagerechten
 * Linien der Geschossdecken machen sie als Gebaeude glaubwuerdig. Gezeichnet
 * wird je Geschoss der Gebaeudeumriss als feine Linie auf Deckenhoehe.
 *
 * Die Geschosszahl kommt bevorzugt aus OSM (`building:levels`, 636 Gebaeude im
 * Pilotgebiet). Fehlt sie, wird aus der Traufhoehe geschaetzt (3,2 m je
 * Geschoss) — eine Naeherung, aber eine plausible: sie trifft die tatsaechliche
 * Geschossteilung fast immer auf einen halben Stock genau.
 */
export function baueGeschossbaender(gelaende: Gelaende, farbe = '#00000022'): Cesium.Primitive | null {
  const inst: Cesium.GeometryInstance[] = [];
  // Halbtransparentes Dunkel: die Baender sollen die Fassade gliedern, nicht
  // wie ein aufgemaltes Gitter wirken.
  const c = Cesium.Color.fromCssColorString('#3a3530').withAlpha(0.18);
  for (const g of gelaende.gebaeude) {
    if (g.grundriss.length < 3) continue;
    const traufe = g.traufHoehe ?? g.firstHoehe ?? g.bodenHoehe + 6;
    const wandHoehe = traufe - g.bodenHoehe;
    if (wandHoehe < 5) continue; // ein einstoeckiger Bau braucht kein Band

    const geschosse = g.geschosse && g.geschosse > 0 ? g.geschosse : Math.max(1, Math.round(wandHoehe / 3.2));
    if (geschosse < 2) continue;
    const geschossHoehe = wandHoehe / geschosse;

    // Baender an den Geschossdecken (nicht am Boden, nicht an der Traufe —
    // die zeichnet schon die Gebaeudekante)
    for (let etage = 1; etage < geschosse; etage++) {
      const z = g.bodenHoehe + etage * geschossHoehe;
      const pos = g.grundriss.map((p) => {
        const [lon, lat] = nachWgs(p);
        return Cesium.Cartesian3.fromDegrees(lon, lat, z);
      });
      pos.push(pos[0]);
      inst.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: pos,
            width: 1.0,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(c),
            // Geschossbaender sind Fassaden-Nahdetail: aus der Ferne werden
            // sie zur Schraffur, die ganze Quartiere schmutzig wirken laesst.
            distanceDisplayCondition: new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(0, 450),
          },
        }),
      );
    }
  }
  if (!inst.length) return null;
  void farbe;
  return new Cesium.Primitive({
    geometryInstances: inst,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
  });
}

export function baueStadt(gelaende: Gelaende): { prims: Cesium.Primitive[]; mitDach: number; ersatz: number } {
  const prims: Cesium.Primitive[] = [];
  let sammler = new FarbSammler();
  let imBuendel = 0;
  let mitDach = 0;
  let ersatz = 0;
  const BUENDEL = 900; // Gebaeude je Primitive

  const abschliessen = () => {
    const p = sammler.zuPrimitive(`gebaeude:buendel${prims.length}`, false);
    if (p) prims.push(p);
    sammler = new FarbSammler();
    imBuendel = 0;
  };

  // Wandvarianten: 5 eng benachbarte Stufen (Spanne 4 L*), deterministisch aus
  // der Gebaeude-ID — Materialkoernung statt weisser Einheitsmasse, ohne als
  // Klassenunterschied zu lesen (Begruendung in palette.GEBAEUDE_VARIANTEN).
  const wandCache = new Map<string, Cesium.Color>();
  const wandVariante = (id: string) => {
    const hex = gebaeudeVariante(id);
    let c = wandCache.get(hex);
    if (!c) {
      c = Cesium.Color.fromCssColorString(hex);
      wandCache.set(hex, c);
    }
    return c;
  };

  for (const g of gelaende.gebaeude) {
    const dachFarbe = dachTonFuer(g);
    const wandFarbe = g.wandFarbe
      ? (() => {
          try {
            return insBasisband(Cesium.Color.fromCssColorString(g.wandFarbe!), 0.78, 0.14);
          } catch {
            return wandVariante(g.id);
          }
        })()
      : wandVariante(g.id);

    const hatEcht = (g.dachflaechen?.length ?? 0) > 0;
    if (hatEcht) {
      for (const f of g.dachflaechen!) sammler.anhaengen(f as P3[], dachFarbe);
      for (const f of g.wandflaechen ?? []) sammler.anhaengen(f as P3[], wandFarbe);
      // Sockel: Das LoD2-Modell setzt jedes Gebaeude auf SEINE gemessene
      // Bodenhoehe. Wo das abgeleitete Gelaende darunter liegt, klaffte bisher
      // ein Spalt, durch den man ins unbeleuchtete Innere sah — das waren die
      // dunklen Flecken rund um die Baukoerper. Ein 4 m tiefer Sockel schliesst
      // den Spalt zuverlaessig und liegt sonst unsichtbar im Boden.
      // FARBE: das dunklere Sockelband der Palette (18 L* unter der Wand) —
      // der guenstige AO-Ersatz genau dort, wo Haus auf Boden trifft.
      if (g.grundriss.length >= 3) {
        const ring = g.grundriss;
        const oben = g.bodenHoehe + 0.2;
        const unten = g.bodenHoehe - 4;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          sammler.anhaengen(
            [
              [ring[j][0], ring[j][1], unten],
              [ring[i][0], ring[i][1], unten],
              [ring[i][0], ring[i][1], oben],
              [ring[j][0], ring[j][1], oben],
            ],
            GEBAEUDE_FARBE.sockel,
          );
        }
      }
      mitDach++;
    } else {
      // Ersatzkoerper: Grundriss auf Traufhoehe hochgezogen, flach gedeckelt
      if (g.grundriss.length < 3) continue;
      const oben = g.firstHoehe ?? g.traufHoehe ?? g.bodenHoehe + 8;
      if (oben - g.bodenHoehe < 0.3) continue;
      const unten = g.bodenHoehe;
      const ring = g.grundriss;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sammler.anhaengen(
          [
            [ring[j][0], ring[j][1], unten],
            [ring[i][0], ring[i][1], unten],
            [ring[i][0], ring[i][1], oben],
            [ring[j][0], ring[j][1], oben],
          ],
          wandFarbe,
        );
      }
      sammler.anhaengen(
        ring.map((p) => [p[0], p[1], oben] as P3),
        dachFarbe,
      );
      ersatz++;
    }
    if (++imBuendel >= BUENDEL) abschliessen();
  }
  abschliessen();
  return { prims, mitDach, ersatz };
}

// ---------------------------------------------------------------------------
// Bodenzeichnung nach tatsaechlicher Nutzung
// ---------------------------------------------------------------------------

/**
 * MASCHENWEITE, mit der eine Bodenflaeche INNEN unterteilt wird — 2 m,
 * dieselbe wie bei der Randverdichtung (`verdichteRing`).
 *
 * WAS DIESE ZAHL KOSTET, gemessen statt geschaetzt (20.000 Stichproben ueber
 * das Pilotgebiet, 10.08.2026). Zwischen zwei Stuetzpunkten laeuft die Flaeche
 * als SEHNE unter der Gelaendekuppe hindurch; die Tabelle zeigt, wie weit das
 * Gelaende dabei ueber die Flaeche steigt:
 *
 *      Masche    ueber 2 cm     99 %-Wert     groesster Wert
 *        2 m       13,4 %        19,0 cm         2,00 m
 *        1 m        3,6 %         5,8 cm         0,69 m
 *      0,5 m        0,8 %         1,8 cm         0,26 m
 *
 * Der Fehler faellt mit dem QUADRAT der Maschenweite. Der Schritt auf 1 m —
 * die Zellweite des Hoehenmodells und damit die feinste Masche, die noch eine
 * MESSUNG abfragt — wurde ausprobiert und VERWORFEN, weil er das Gegenteil
 * bewirkt: Bei 1 m verschwand in der Fussgaengeransicht die ganze Gruenflaeche
 * unter der Gelaendeplatte; das Bild war flaechig braun statt gruen (Abzug
 * `44-treppe-1m.png` gegen `44-treppe-2m.png`, gleiche Kamera, 10.08.2026).
 *
 * DER GRUND LIEGT IM RUECKFALLWEG: Grosse Flaechen — der groesste Gehweg des
 * Pilotgebiets misst 233 x 370 m — scheitern bei 1 m an der Unterteilung und
 * fallen auf `perPositionHeight` zurueck. Der aber unterteilt das Innere GAR
 * NICHT; die Flaeche haengt dann ueber ihre ganze Breite durch und liegt unter
 * dem Gelaende. Eine feinere Masche macht die kleinen Flaechen also besser und
 * die grossen schlagartig unbrauchbar. Wer das aufloesen will, muss die Masche
 * je Flaeche aus ihrer GROESSE bestimmen — nicht die Konstante drehen. Die
 * Bildzeit war uebrigens unauffaellig (2,9 ms); es ist keine Frage der
 * Rechenzeit.
 *
 * In Bogenmass, weil Cesiums `granularity` so gemessen wird: 2 m auf dem
 * Erdumfang von 40.030 km sind 2 / 6.371.000 rad.
 */
const FLAECHEN_MASCHE_RAD = 2 / 6_371_000;

/**
 * Baut die Geometrie EINER Bodenflaeche — und zwar dem Gelaende folgend, auch
 * IM INNEREN.
 *
 * DER FEHLER, DEN DAS BEHEBT (gemessen 10.08.2026, Rheinstrasse aus
 * Fussgaengerhoehe): `scene.drillPick` lieferte mitten auf der Fahrbahn nur
 * `gelaende:p8` — die Fahrbahnflaeche war im Datenbestand vorhanden
 * (`osm_fahrbahn_118` enthaelt den Punkt), wurde aber unter dem Gelaende
 * gezeichnet. Sichtbar als breites Band der Gelaendeplatte mitten in der
 * Strasse.
 *
 * URSACHE: `PolygonGeometry` mit `perPositionHeight: true` benutzt AUSSCHLIESS-
 * LICH die uebergebenen Ringpunkte und unterteilt das Innere ausdruecklich
 * nicht. Der Rand wird von `verdichteRing` alle 2 m gestuetzt — das Innere gar
 * nicht. Ein Dreieck der Triangulierung kann dadurch von einem Bordstein zum
 * gegenueberliegenden und dabei 50 m weit reichen; ueber einer gewoelbten
 * Fahrbahn oder einer Steigung laeuft es als SEHNE unter dem Gelaende durch.
 * Genau dieselbe Ursache wie bei den Raendern, nur eine Ebene tiefer: dort war
 * sie 2026-08-08 behoben worden, im Inneren blieb sie stehen.
 *
 * DIE BEHEBUNG: Cesium unterteilt das Innere sehr wohl — aber nur, wenn die
 * Punkte NICHT ihre eigene Hoehe mitbringen (`perPositionHeight: false`), denn
 * dann laeuft die Unterteilung ueber `granularity`. Also wird die Flaeche flach
 * trianguliert und JEDER entstandene Eckpunkt danach auf seine Gelaendehoehe
 * gehoben. Ergebnis ist ein Netz mit 2-m-Maschen, das dem Gelaende ueberall
 * folgt — innen wie aussen.
 *
 * Der Rueckfall auf den alten Weg bleibt: schlaegt die Unterteilung fehl
 * (entartete Ringe), wird wie bisher mit `perPositionHeight` gebaut. Lieber
 * eine Flaeche mit Durchhang als keine.
 */
function flaechengeometrie(
  hierarchie: Cesium.PolygonHierarchy,
  hoeheAn: (e: number, n: number) => number,
  versatzM: number,
): Cesium.Geometry | undefined {
  const perPosition = () =>
    Cesium.PolygonGeometry.createGeometry(
      new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchie,
        perPositionHeight: true,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
    );
  let geo: Cesium.Geometry | undefined;
  try {
    geo = Cesium.PolygonGeometry.createGeometry(
      new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchie,
        perPositionHeight: false,
        height: 0,
        granularity: FLAECHEN_MASCHE_RAD,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
    );
  } catch {
    return perPosition();
  }
  if (!geo?.attributes?.position) return perPosition();

  // Jeden Eckpunkt auf seine Gelaendehoehe heben. Der Umweg ueber
  // Kartographie und UTM ist noetig, weil die Unterteilung NEUE Punkte
  // erzeugt, deren Lage vorher niemand kennt.
  const werte = geo.attributes.position.values as Float64Array;
  const c = new Cesium.Cartesian3();
  for (let i = 0; i < werte.length; i += 3) {
    c.x = werte[i];
    c.y = werte[i + 1];
    c.z = werte[i + 2];
    const carto = Cesium.Cartographic.fromCartesian(c);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const [e, n] = nachUtm([lon, lat]);
    const w = Cesium.Cartesian3.fromDegrees(lon, lat, hoeheAn(e, n) + versatzM);
    werte[i] = w.x;
    werte[i + 1] = w.y;
    werte[i + 2] = w.z;
  }
  geo.boundingSphere = Cesium.BoundingSphere.fromVertices(Array.from(werte));
  return geo;
}

/**
 * BRUECKENKOERPER — der Ueberbau unter der Fahrbahn und seine Widerlager.
 *
 * Die Fahrbahn einer Bruecke wird von `baueBodenzeichnung` bereits auf ihrer
 * Hoehenebene gezeichnet (also zwischen den Widerlagern gespannt statt dem
 * Gelaende folgend). Was fehlt, ist der KOERPER darunter: ohne ihn schwebt
 * eine Flaeche in der Luft, und die lichte Hoehe waere eine Zahl ohne Bild.
 *
 * Gebaut wird der Mantel vom Deck bis zur Unterkante (Deck minus
 * Ueberbaudicke) plus die Unterseite. Wo der Ueberbau auf das Gelaende trifft,
 * entsteht dadurch von allein das Widerlager: der Mantel laeuft dort in den
 * Boden. Das ist keine Konstruktion, sondern eine Folge — und genau darum
 * stimmt es auch an schiefen Widerlagern.
 */
export function baueBrueckenkoerper(
  flaechen: GelaendeFlaeche[] | undefined,
  hoehen: Hoehenlage,
): { prims: Cesium.Primitive[]; bericht: { bruecken: number; kleinsteLichteHoeheM: number | null } } {
  const bericht = { bruecken: 0, kleinsteLichteHoeheM: null as number | null };
  const ecken: number[] = [];
  const indizes: number[] = [];
  const farbe = Cesium.Color.fromCssColorString(GEBAEUDE_STIL.wand);

  const punkt = (e: number, n: number, h: number) => {
    const [lon, lat] = nachWgs([e, n]);
    const c = Cesium.Cartesian3.fromDegrees(lon, lat, h);
    ecken.push(c.x, c.y, c.z);
    return ecken.length / 3 - 1;
  };

  for (const f of flaechen ?? []) {
    const eb = f.lage?.hoehenEbene;
    const dicke = f.lage?.ueberbauDickeM;
    if (!f.lage?.bruecke || !eb || !dicke || f.polygon.length < 3) continue;
    bericht.bruecken++;
    if (f.lage.lichteHoeheM !== undefined) {
      if (bericht.kleinsteLichteHoeheM === null || f.lage.lichteHoeheM < bericht.kleinsteLichteHoeheM) {
        bericht.kleinsteLichteHoeheM = f.lage.lichteHoeheM;
      }
    }
    const deck = (e: number, n: number) => eb.a * (e - eb.e0) + eb.b * (n - eb.n0) + eb.c;
    const ring = verdichteRing(f.polygon);
    // Mantel
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const ao = punkt(a[0], a[1], deck(a[0], a[1]));
      const bo = punkt(b[0], b[1], deck(b[0], b[1]));
      const bu = punkt(b[0], b[1], deck(b[0], b[1]) - dicke);
      const au = punkt(a[0], a[1], deck(a[0], a[1]) - dicke);
      indizes.push(ao, bo, bu, ao, bu, au);
    }
    // Unterseite — sie ist es, an der die lichte Hoehe gemessen wird.
    const unten = ring.map((p) => punkt(p[0], p[1], deck(p[0], p[1]) - dicke));
    const dreiecke = zerlege(ring.map((p) => [p[0], p[1], 0] as P3));
    for (const [x, y, z] of dreiecke) indizes.push(unten[x], unten[z], unten[y]);
  }

  if (!indizes.length) return { prims: [], bericht };
  const positionen = new Float64Array(ecken);
  const attribute = new Cesium.GeometryAttributes();
  attribute.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionen,
  });
  const geo = Cesium.GeometryPipeline.computeNormal(
    new Cesium.Geometry({
      attributes: attribute,
      indices: new Uint32Array(indizes),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
    }),
  );
  const prim = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: geo,
      id: 'bruecke',
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) },
    }),
    // BELEUCHTET: Erst Licht und Schatten machen aus der Platte ein Bauwerk —
    // und der Schatten unter der Bruecke ist das, was die lichte Hoehe zeigt.
    appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: false }),
    asynchronous: false,
  });
  return { prims: [prim], bericht };
}

/**
 * Legt die Nutzungsflaechen als duenne, dem Gelaende folgende Schichten auf.
 * Der Rang bestimmt die Reihenfolge UND einen winzigen Hoehenversatz — ohne ihn
 * flackern uebereinanderliegende Flaechen (Gehweg auf Strassenverkehrsflaeche).
 */
export function baueBodenzeichnung(
  flaechen: GelaendeFlaeche[],
  hoehen: Hoehenlage,
  nurArten?: Set<FlaechenArt>,
): Cesium.Primitive[] {
  // Reihenfolge aus der PALETTE, nicht aus dem gespeicherten Rang: die
  // Rangskala der Palette ist die einzige, die zur Hoehenstaffel passt. Der
  // gespeicherte Rang bleibt Feinsortierung INNERHALB einer Klasse — er traegt
  // die Bruecken-Zuschlaege und hebt Auflagen (Zebra) ueber ihre Fahrbahn.
  const stilVon = (f: GelaendeFlaeche) => stilFuer(f.art, f.quelle === 'alkis' ? 'alkis' : 'osm');
  const sortiert = [...flaechen]
    .filter((f) => !nurArten || nurArten.has(f.art))
    .sort((a, b) => stilVon(a).rang - stilVon(b).rang || a.rang - b.rang);

  // WICHTIG: Bodenflaechen werden mit Cesiums PolygonGeometry gebaut, nicht mit
  // der eigenen Dreieckszerlegung. Grund: Nach der Vereinigung je Klasse ist
  // der Strassenraum EIN Netz MIT LOECHERN — die Baubloecke sind die Loecher.
  // Die eigene Zerlegung kennt nur den Aussenring und wuerde die Loecher
  // zufuellen; die Platte deckte dann die ganze Stadt zu.
  const fuellungen: Cesium.GeometryInstance[] = [];
  const konturen: Cesium.GeometryInstance[] = [];
  // WASSER WIRD GETRENNT GESAMMELT — es ist die einzige Flaechenklasse, die
  // DURCHSCHEINEND gezeichnet wird. Erst dadurch sieht man die Sohle darunter,
  // und erst dadurch ist ein Gewaesser im Bild ein Gewaesser und keine
  // eingefaerbte Platte. Vorher hatte keine der 14 Wasserflaechen eine Sohle;
  // seit dem 10.08.2026 senkt der Import das Hoehenmodell darunter ab
  // (server/geodata/gelaende.ts, wasserEinebnen).
  const wasserflaechen: Cesium.GeometryInstance[] = [];

  for (const f of sortiert) {
    if (f.polygon.length < 3) continue;

    // ALKIS liefert den gesamten Strassenraum als Buehne, OSM die Fahrbahn
    // darauf. Beide tragen die Art "fahrbahn" — stilFuer() loest das auf und
    // liefert fuer die ALKIS-Geometrie die ruhige PLATTE (KARTENDESIGN 5.2).
    const stil = stilVon(f);
    const farbe = tonVerschieben(Cesium.Color.fromCssColorString(stil.fuellung), BELAG_TON[f.belag ?? ''] ?? 0);
    // Hoehenstaffel JE KLASSE (rang x 2 mm aus der Palette) statt einer
    // Einheitshoehe. Die Aufteilung ist zwar ueberschneidungsfrei GEDACHT,
    // aber die Import-Rueckfallwege duerfen bewusst doppelt zeichnen ("die
    // amtliche Basis ist die Wahrheit, ein Loch waere schlimmer") — mit einer
    // Einheitshoehe flimmert genau dann jede dieser Stellen. Die Staffel macht
    // die Darstellung gegen jede Restueberlappung robust.
    // Auflagen (Zebrastreifen, Bahnsteige, Brunnenbecken) liegen als oberste
    // Schicht AUF dem Boden: ueber der hoechsten Klassenstufe (treppe, 9,2 cm).
    const istAuflage = f.belag === 'zebra' || f.belag === 'bahnsteig' || f.belag === 'wasserbecken';
    // KONSTRUKTIONSHOEHE STATT MILLIMETER-STAPEL (Bauwerksmodell, Stufe 2).
    //
    // Liegt eine Konstruktionshoehe an der Flaeche, ist SIE die Hoehe: der
    // Gehweg liegt dann 12 cm ueber der Fahrbahn, weil er gebaut ist, nicht
    // weil eine Rangstufe ihn anhebt. Die alte Staffel (rang x 2 mm) bleibt
    // als Rueckfallweg fuer Gelaende ohne Bauklassen erhalten — dort hat sie
    // ihren Zweck: Restueberlappungen der Import-Notwege nicht flimmern zu
    // lassen. Bei echten Hoehen erledigt sich das von selbst, weil die
    // Flaechen dann gar nicht mehr koplanar sind.
    //
    // Auflagen (Zebrastreifen, Bahnsteige, Brunnenbecken) liegen AUF ihrer
    // Wirtsflaeche: deren Bauhoehe plus 6 mm. Ein fester Wert waere hier
    // falsch — ein Zebrastreifen auf einem 12 cm hohen Platz laege sonst
    // darunter.
    const konstruktion = f.konstruktionM;
    const versatz =
      konstruktion !== undefined
        ? konstruktion + (istAuflage ? 0.006 : 0)
        : istAuflage
          ? 0.098
          : stil.hoehenversatzM;

    // RUHENDES WASSER WIRD ALS EBENE GEZEICHNET, nicht drapiert. Der Spiegel
    // steht an der Flaeche (Import, wasserEinebnen). Ohne ihn bekaeme die
    // Oberflaeche ihre Hoehen von den UFERPUNKTEN, und zwischen zwei
    // verschieden hohen Ufern haengt die Flaeche durch — im Grossen Woog um bis
    // zu 20 cm, worauf der eingeebnete Seegrund als heller Zacken durchstach.
    // HOEHENBAND VOR GELAENDE: Traegt die Flaeche eine Hoehenebene, liegt sie
    // NICHT auf dem Gelaende — eine Bruecke spannt zwischen ihren Widerlagern,
    // eine Rampe faellt gleichmaessig vom Portal weg. Ohne diesen Zweig folgte
    // die Bruecke dem Gelaende und waere ein Weg (server/geodata/hoehenband.ts).
    // Die Formel steht in shared/bau/hoehenlage.ts — dieselbe, aus der der
    // Import die Sohle gerechnet hat. Zwei Formeln waeren zwei Wahrheiten.
    const hatBand = f.lage ? hoeheImHoehenband(f.lage, f.polygon[0][0], f.polygon[0][1]) !== null : false;
    const hoeheAn = hatBand
      ? (e: number, n: number) => hoeheImHoehenband(f.lage, e, n) as number
      : f.wasserspiegelM != null
        ? () => f.wasserspiegelM as number
        : (e: number, n: number) => hoehen.bei(e, n);

    // VERDICHTEN vor dem Drapieren: ohne Zwischenpunkte laeuft eine lange
    // Flaechenkante als Sehne unter der Gelaendekuppe hindurch und der Boden
    // stoesst mitten in der Flaeche durch (Begruendung bei verdichteRing).
    const nachWelt = (ring: Ring) =>
      verdichteRing(ring).map((p) => {
        const [lon, lat] = nachWgs(p);
        return Cesium.Cartesian3.fromDegrees(lon, lat, hoeheAn(p[0], p[1]) + versatz);
      });

    try {
      const hierarchie = new Cesium.PolygonHierarchy(
        nachWelt(f.polygon),
        (f.loecher ?? []).filter((l) => l.length >= 3).map((l) => new Cesium.PolygonHierarchy(nachWelt(l))),
      );
      const geometrie = flaechengeometrie(hierarchie, hoeheAn, versatz);
      if (geometrie) {
        const instanz = new Cesium.GeometryInstance({
          geometry: geometrie,
          id: `boden:${f.art}:${f.id}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(f.art === 'wasser' ? farbe.withAlpha(0.72) : farbe) },
        });
        if (f.art === 'wasser') wasserflaechen.push(instanz);
        else fuellungen.push(instanz);
      }
    } catch {
      /* entartete Flaeche ueberspringen, statt die ganze Ebene zu verlieren */
    }

    // --- Kontur ------------------------------------------------------------
    // Die Massnahme gegen "die Strassen sind nicht zu erkennen": eine duenne,
    // BILDSCHIRMFESTE Linie am Rand (KARTENDESIGN 1.1: die Kontur ist eine
    // Pixelgroesse und skaliert beim Zoomen nicht mit). Farbe und Gewicht je
    // Klasse kommen aus der Palette; die Meterbreite der Palette wird auf die
    // dort geforderten 0,7-1,6 px abgebildet (x4: 0,20 m -> 0,8 px usw.).
    // Die Kontur liegt KONTUR_VERSATZ_M UNTER ihrer Fuellung: wo zwei Klassen
    // aneinanderstossen, deckt die hoehere Fuellung die fremde Kontur ab und
    // die Wege "fliessen" durcheinander statt sich zu zerschneiden.
    if (stil.kontur && !istAuflage) {
      const c = Cesium.Color.fromCssColorString(stil.kontur);
      const breitePx = Math.max(0.7, Math.min(1.6, (stil.konturBreiteM ?? 0.25) * 4));
      const konturVersatz = versatz + KONTUR_VERSATZ_M;
      const nachWeltKontur = (ring: Ring) =>
        verdichteRing(ring).map((p) => {
          const [lon, lat] = nachWgs(p);
          return Cesium.Cartesian3.fromDegrees(lon, lat, hoeheAn(p[0], p[1]) + konturVersatz);
        });
      for (const ring of [f.polygon, ...(f.loecher ?? [])]) {
        if (ring.length < 3) continue;
        const pos = nachWeltKontur(ring);
        pos.push(pos[0]);
        konturen.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: pos,
              width: breitePx,
              vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(c) },
          }),
        );
      }
    }
  }

  const prims: Cesium.Primitive[] = [];
  const BLOCK = 500;
  for (let i = 0; i < fuellungen.length; i += BLOCK) {
    prims.push(
      new Cesium.Primitive({
        geometryInstances: fuellungen.slice(i, i + BLOCK),
        // Ungeschattet: der Boden traegt seine Information ueber die
        // Farbabstufung, nicht ueber Licht und Schatten.
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: true }),
        asynchronous: false,
      }),
    );
  }
  for (let i = 0; i < konturen.length; i += 3000) {
    prims.push(
      new Cesium.Primitive({
        geometryInstances: konturen.slice(i, i + 3000),
        appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
        asynchronous: false,
      }),
    );
  }
  // Die Wasseroberflaeche ZULETZT und DURCHSCHEINEND — sonst verdeckt sie die
  // Sohle, die der Import unter ihr eingeschnitten hat, und das Gewaesser
  // waere wieder eine Platte.
  if (wasserflaechen.length) {
    prims.push(
      new Cesium.Primitive({
        geometryInstances: wasserflaechen,
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: false, flat: true }),
        asynchronous: false,
      }),
    );
  }
  return prims;
}

// ---------------------------------------------------------------------------
// Fahrbahnmarkierungen und Flaechen-Beschriftung
// ---------------------------------------------------------------------------

/** Leitlinie innerorts nach StVO-Praxis: 3 m Strich, 6 m Luecke. */
const STRICH_M = 3;
const TAKT_M = 9;
/** Knapp ueber dem Fahrbahn-Decker (0,084), unter Radweg-Auflage (0,088). */
const MARKIERUNG_VERSATZ_M = 0.086;
/**
 * Real sind Leitlinien weiss — auf unserem HELLEN Fahrbahn-Decker (L* 96,9)
 * waere Weiss aber unsichtbar. Die amtliche Referenz loest es genauso:
 * basemap.de zeichnet `Mittellinie_ausser_Autobahn` in rgb(153,153,153) auf
 * der weissen Fahrbahn (KARTENDESIGN 2.5).
 */
const MARKIERUNG_FARBE = '#999999';

/**
 * Fahrbahnmarkierungen aus den beim Import geretteten Markierungslinien
 * (Leitlinie fuer Hauptstrassen, Spurtrennstriche wo OSM die Spurenzahl
 * kennt — der Versatz je Spur ist serverseitig bereits gerechnet). Die
 * Striche folgen der 3/6-m-Taktung realer Leitlinien.
 */
export function baueFahrbahnmarkierungen(linien: GelaendeLinienObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const farbe = Cesium.Color.fromCssColorString(MARKIERUNG_FARBE);
  const inst: Cesium.GeometryInstance[] = [];

  const striche = (achse: Ring) => {
    // Kumulierte Laengen fuer Punkt-bei-Station
    const laengen = [0];
    for (let i = 1; i < achse.length; i++) {
      laengen.push(laengen[i - 1] + Math.hypot(achse[i][0] - achse[i - 1][0], achse[i][1] - achse[i - 1][1]));
    }
    const gesamt = laengen[laengen.length - 1];
    const punktBei = (s: number): Ring[number] => {
      let i = 1;
      while (i < laengen.length - 1 && laengen[i] < s) i++;
      const t = (s - laengen[i - 1]) / Math.max(1e-9, laengen[i] - laengen[i - 1]);
      return [
        achse[i - 1][0] + (achse[i][0] - achse[i - 1][0]) * t,
        achse[i - 1][1] + (achse[i][1] - achse[i - 1][1]) * t,
      ];
    };
    // Erst ab 6 m Strassenlaenge lohnt ein Strich
    for (let s = TAKT_M / 2; s + STRICH_M < gesamt; s += TAKT_M) {
      const a = punktBei(s);
      const b = punktBei(s + STRICH_M);
      const [lonA, latA] = nachWgs(a);
      const [lonB, latB] = nachWgs(b);
      inst.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [
              Cesium.Cartesian3.fromDegrees(lonA, latA, hoehen.bei(a[0], a[1]) + MARKIERUNG_VERSATZ_M),
              Cesium.Cartesian3.fromDegrees(lonB, latB, hoehen.bei(b[0], b[1]) + MARKIERUNG_VERSATZ_M),
            ],
            width: 1.4,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) },
        }),
      );
    }
  };

  for (const l of linien) {
    if (l.art !== 'markierung' || l.achse.length < 2) continue;
    striche(l.achse);
  }

  const prims: Cesium.Primitive[] = [];
  for (let i = 0; i < inst.length; i += 3000) {
    prims.push(
      new Cesium.Primitive({
        geometryInstances: inst.slice(i, i + 3000),
        appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
        asynchronous: false,
      }),
    );
  }
  return prims;
}

/**
 * Beschriftungspunkte der Karte („P" auf Parkplaetzen) — beim Import VOR der
 * Flaechen-Vereinigung gewonnen, weil die Union Einzelflaechen samt
 * Bezeichnung verschmilzt.
 */
export function baueBeschriftungen(
  beschriftungen: NonNullable<Gelaende['beschriftungen']>,
  hoehen: Hoehenlage,
): Cesium.LabelCollection | null {
  const sammlung = new Cesium.LabelCollection();
  for (const b of beschriftungen) {
    const [lon, lat] = nachWgs(b.pos);
    sammlung.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(b.pos[0], b.pos[1]) + 1.2),
      text: b.text,
      // Blau wie das reale Zeichen 314, aber entsaettigt unter dem
      // Planobjekt-Reservat der Palette.
      font: '700 14px system-ui, sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#35598c'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(80, 1.1, 900, 0.5),
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 1500, 0.0),
    });
  }
  return sammlung.length ? sammlung : null;
}

/** Zaehlt die Flaechen je Art — fuer die Legende in der Oberflaeche. */
export function flaechenBilanz(flaechen: GelaendeFlaeche[]): { art: FlaechenArt; anzahl: number; farbe: string }[] {
  const z = new Map<FlaechenArt, number>();
  for (const f of flaechen) z.set(f.art, (z.get(f.art) ?? 0) + 1);
  return [...z.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([art, anzahl]) => ({ art, anzahl, farbe: BODEN_FARBE[art] }));
}

export { zerlege as zerlegeFlaeche };
export type { P3 as Punkt3D, Ring as Ring2D };
