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
import type { FlaechenArt, Gelaende, GelaendeFlaeche, Ring } from '@shared/domain/types';
import { nachWgs } from '@shared/geo/proj';
import type { Hoehenlage } from './gelaende.ts';

// ---------------------------------------------------------------------------
// Palette: ein Graustufen-Geruest mit sparsam eingesetzter Farbe.
// Die Abstufung traegt die Information, nicht der Farbton.
// ---------------------------------------------------------------------------

/**
 * Palette nach docs/KARTENDESIGN.md, Abschnitt 5.4.
 *
 * Entscheidung HELLER GRUND — bewusst gegen die urspruengliche dunkle Fassung:
 * Alle untersuchten Referenzsysteme (basemap.de, OSM Carto, CARTO Positron)
 * legen ihr gesamtes Flaechenband zwischen L* 76 und 97. Der Grund ist nicht
 * Geschmack, sondern Arbeitsteilung: Ein Planungswerkzeug traegt farbige
 * Planobjekte — Rettungswege, Sperrflaechen, Staende, Fahrgeschaefte. Die
 * muessen herausstechen. Auf einem dunklen Grund konkurrieren sie mit dem
 * Untergrund; auf hellem Grund bleibt der gesamte Bereich L* < 65 bei hoher
 * Buntheit fuer sie reserviert und ist damit unverwechselbar.
 *
 * Alle Werte sind in CIELAB konstruiert, damit die Helligkeitsabstaende
 * belastbar sind. Die Tabelle nennt L* und den geforderten Mindestabstand.
 *
 *   Fahrbahn (OSM-Decker)   L* 97   #f5f6f8
 *   Platz / Fussgaengerzone L* 94   #ebefec
 *   Bauflaeche (Grundton)   L* 92   #ebe8e3
 *   Gehweg                  L* 90   #e1e2e5
 *   Strassenraum (Platte)   L* 88   #dadddf
 *   Gruenflaeche            L* 87   #d0dec7
 *   Radweg                  L* 86   #cfd8e2   (kuehler Stich b* -6)
 *   Wasser                  L* 82   #b9cfdc
 *   Wald                    L* 76   #adc2a1
 *   Hauptkontur             L* 58   #8b8b8d   (Abstand zur Fahrbahn 39 L*)
 *   Nebenkontur             L* 70   #aaabad
 *   Bahn                    L* 45   #6a6b6c
 */
export const BODEN_FARBE: Record<FlaechenArt, string> = {
  // Bauflaechen HELL, nicht dunkel.
  //
  // ALKIS weist jedem Quadratmeter eine Nutzung zu; die Grundstuecke der
  // Randbebauung reichen bis in Plaetze hinein. Ein dunkler Ton stanzt dadurch
  // Loecher in jede offene Flaeche — am Friedensplatz nachgemessen: zwischen
  // den hellen Platzfeldern lagen dunkle Bauflaechen-Felder, obwohl der Belag
  // dort derselbe ist. Die Figur-Grund-Trennung leisten die GEBAEUDE (hell,
  // aufragend, mit Schatten), nicht eingefaerbte Grundstuecke. Dunkel ist
  // allein das Strassennetz — wie in jeder guten Stadtkarte.
  bebauung: '#c0bab2',
  sonstige: '#bcb6ae',
  landwirtschaft: '#a9b48d',
  gruen: '#93a886',
  wald: '#7d9270', // gleiche Farbtonrichtung wie Gruen, nur staerker (5.5)
  wasser: '#7fa3ba',
  bahn: '#8a8b8f',
  fahrbahn: '#93989d', // heller Decker — die eigentliche Fahrbahn
  platz: '#cbcdc9',
  fussgaengerzone: '#cbcdc9',
  weg: '#bfb8ae',
  radweg: '#9fb0bd',
  gehweg: '#c6c9cc',
  treppe: '#c9ccce',
};

/**
 * ALKIS fuehrt den GESAMTEN Strassenraum als eine Flaeche (Gehweg, Parkstreifen
 * und Bankett eingeschlossen). Er ist die Buehne, nicht die Fahrbahn — und
 * bekommt darum einen eigenen, ruhigeren Ton als der OSM-Decker darueber.
 */
export const PLATTE_FARBE = '#a5a9ad';

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

/**
 * Konturen. Nur ZWEI Stufen fuer das ganze Netz (Vorbild basemap.de: ein
 * einziger Konturton fuer alle Strassenklassen) — mehr Stufen erzeugen genau
 * die Unruhe, die der Auftraggeber als "bunte Masse" bemaengelt hat.
 */
export const KONTUR = {
  haupt: '#4e5153', // Fahrbahn, Platz, Fussgaengerzone
  neben: '#5c6063', // Gehweg, Radweg, Weg, Treppe
  gruen: '#5f6b57', // Gruenflaechen und Wald
  keine: null as string | null,
};

/** Welche Klasse bekommt welche Kontur? */
export const KONTUR_FUER: Record<FlaechenArt, keyof typeof KONTUR> = {
  fahrbahn: 'haupt',
  platz: 'haupt',
  fussgaengerzone: 'haupt',
  gehweg: 'neben',
  radweg: 'neben',
  weg: 'neben',
  treppe: 'neben',
  gruen: 'gruen',
  wald: 'gruen',
  wasser: 'neben',
  bahn: 'haupt',
  bebauung: 'keine',
  landwirtschaft: 'keine',
  sonstige: 'keine',
};

export const GEBAEUDE_FARBE = {
  /**
   * Wand L* 80, Dach L* 70 — der Abstand von 10 L* ist die untere Grenze, ab
   * der die Dachform ohne Licht lesbar bleibt; die Sonne erzeugt den Rest.
   * Das Dach ist zugleich leicht waermer als die Wand (Ziegel- statt Putzton).
   */
  wand: Cesium.Color.fromCssColorString('#c8c6c4'),
  dach: Cesium.Color.fromCssColorString('#b2aaa4'),
  ersatzWand: Cesium.Color.fromCssColorString('#cbc9c7'),
  ersatzDach: Cesium.Color.fromCssColorString('#b6aea8'),
  /** Kante: die 3D-Entsprechung der Strassenkontur (KARTENDESIGN 4.1). */
  kante: '#8e8a86',
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
    // Grauton: nur die Helligkeit angleichen
    const v = hell * 0.35 + zielHelligkeit * 0.65;
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
  const aufbau = (g.firstHoehe ?? 0) - (g.traufHoehe ?? 0);
  return aufbau > 0.5 ? waehle(DACH_TON.ziegel) : waehle(DACH_TON.flach);
}

/**
 * Hintergrund. Heller, leicht kuehler Ton — er darf nicht mit den Flaechen
 * konkurrieren, aber ein schwarzer Himmel liesse die helle Stadt wie einen
 * ausgeschnittenen Zettel wirken.
 */
export const HIMMEL = '#cfd9e2';

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
        if (drin(a, b, c, flach[k])) {
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
export function baueGebaeudeKanten(gelaende: Gelaende, farbe = GEBAEUDE_FARBE.kante, breitePx = 1.3): Cesium.Primitive | null {
  const inst: Cesium.GeometryInstance[] = [];
  const c = Cesium.Color.fromCssColorString(farbe);
  for (const g of gelaende.gebaeude) {
    if (g.grundriss.length < 3) continue;
    // NUR der Gebaeudeumriss auf Traufhoehe.
    // Zuvor wurde jede einzelne Dachteilflaeche umrandet — bei vielen kleinen
    // Facetten ergab das eine Schraffur, die das Modell zusetzte statt es zu
    // gliedern. Die Kante soll das Gebaeude vom Nachbarn trennen, nicht seine
    // Dreieckszerlegung zeigen.
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
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(c) },
      }),
    );
  }
  if (!inst.length) return null;
  const BLOCK = 3000;
  const prims: Cesium.GeometryInstance[][] = [];
  for (let i = 0; i < inst.length; i += BLOCK) prims.push(inst.slice(i, i + BLOCK));
  // Cesium erlaubt nur EIN Primitive je Rueckgabe — bei mehr als BLOCK
  // Gebaeuden wird zusammengefasst; die Zahl ist gross genug fuer 1 km2.
  return new Cesium.Primitive({
    geometryInstances: inst.slice(0, BLOCK * 3),
    appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
    asynchronous: false,
  });
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
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(c) },
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

  for (const g of gelaende.gebaeude) {
    const dachFarbe = dachTonFuer(g);
    const wandFarbe = g.wandFarbe
      ? (() => {
          try {
            return insBasisband(Cesium.Color.fromCssColorString(g.wandFarbe!), 0.78, 0.14);
          } catch {
            return GEBAEUDE_FARBE.wand;
          }
        })()
      : GEBAEUDE_FARBE.wand;

    const hatEcht = (g.dachflaechen?.length ?? 0) > 0;
    if (hatEcht) {
      for (const f of g.dachflaechen!) sammler.anhaengen(f as P3[], dachFarbe);
      for (const f of g.wandflaechen ?? []) sammler.anhaengen(f as P3[], wandFarbe);
      // Sockel: Das LoD2-Modell setzt jedes Gebaeude auf SEINE gemessene
      // Bodenhoehe. Wo das abgeleitete Gelaende darunter liegt, klaffte bisher
      // ein Spalt, durch den man ins unbeleuchtete Innere sah — das waren die
      // dunklen Flecken rund um die Baukoerper. Ein 4 m tiefer Sockel schliesst
      // den Spalt zuverlaessig und liegt sonst unsichtbar im Boden.
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
            wandFarbe,
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
 * Legt die Nutzungsflaechen als duenne, dem Gelaende folgende Schichten auf.
 * Der Rang bestimmt die Reihenfolge UND einen winzigen Hoehenversatz — ohne ihn
 * flackern uebereinanderliegende Flaechen (Gehweg auf Strassenverkehrsflaeche).
 */
export function baueBodenzeichnung(
  flaechen: GelaendeFlaeche[],
  hoehen: Hoehenlage,
  nurArten?: Set<FlaechenArt>,
): Cesium.Primitive[] {
  const sortiert = [...flaechen]
    .filter((f) => !nurArten || nurArten.has(f.art))
    .sort((a, b) => a.rang - b.rang);

  // WICHTIG: Bodenflaechen werden mit Cesiums PolygonGeometry gebaut, nicht mit
  // der eigenen Dreieckszerlegung. Grund: Nach der Vereinigung je Klasse ist
  // der Strassenraum EIN Netz MIT LOECHERN — die Baubloecke sind die Loecher.
  // Die eigene Zerlegung kennt nur den Aussenring und wuerde die Loecher
  // zufuellen; die Platte deckte dann die ganze Stadt zu.
  const fuellungen: Cesium.GeometryInstance[] = [];
  const konturen: Cesium.GeometryInstance[] = [];

  for (const f of sortiert) {
    if (f.polygon.length < 3) continue;

    // ALKIS liefert den gesamten Strassenraum als Buehne, OSM die Fahrbahn
    // darauf. Beide tragen die Art "fahrbahn" — die Quelle entscheidet ueber
    // die Rolle und damit ueber den Ton (KARTENDESIGN 5.2).
    const istPlatte = f.art === 'fahrbahn' && f.quelle === 'alkis';
    const ton = istPlatte ? PLATTE_FARBE : (BODEN_FARBE[f.art] ?? BODEN_FARBE.sonstige);
    const farbe = tonVerschieben(Cesium.Color.fromCssColorString(ton), BELAG_TON[f.belag ?? ''] ?? 0);
    // EINE Hoehe fuer alle Bodenflaechen — mit EINER Ausnahme.
    // Nach der ueberschneidungsfreien Aufteilung liegt an keiner Stelle mehr
    // als eine Bodenflaeche; der alte Hoehenstapel ist ueberfluessig.
    // AUSNAHME sind aufgemalte Markierungen (Zebrastreifen) und Bahnsteige:
    // sie sind bewusst KEINE Bodenklassen, sondern liegen als Auflage AUF dem
    // Boden — auf gleicher Hoehe wuerden sie mit ihm um jeden Pixel kaempfen.
    const istAuflage = f.belag === 'zebra' || f.belag === 'bahnsteig';
    const versatz = istAuflage ? 0.07 : 0.03;

    const nachWelt = (ring: Ring) =>
      ring.map((p) => {
        const [lon, lat] = nachWgs(p);
        return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + versatz);
      });

    try {
      const hierarchie = new Cesium.PolygonHierarchy(
        nachWelt(f.polygon),
        (f.loecher ?? []).filter((l) => l.length >= 3).map((l) => new Cesium.PolygonHierarchy(nachWelt(l))),
      );
      fuellungen.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: hierarchie,
            perPositionHeight: true,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          id: `boden:${f.art}:${f.id}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) },
        }),
      );
    } catch {
      /* entartete Flaeche ueberspringen, statt die ganze Ebene zu verlieren */
    }

    // --- Kontur ------------------------------------------------------------
    // Die Massnahme gegen "die Strassen sind nicht zu erkennen": eine duenne,
    // BILDSCHIRMFESTE Linie am Rand. Bildschirmfest heisst, sie bleibt beim
    // Herauszoomen sichtbar, waehrend eine in Metern gedachte Kontur
    // verschwaende (KARTENDESIGN 1.1 und 5.1).
    const konturStufe = istPlatte ? 'keine' : KONTUR_FUER[f.art];
    const konturTon = KONTUR[konturStufe];
    if (konturTon) {
      const c = Cesium.Color.fromCssColorString(konturTon);
      const breitePx = konturStufe === 'haupt' ? 1.7 : 1.2;
      for (const ring of [f.polygon, ...(f.loecher ?? [])]) {
        if (ring.length < 3) continue;
        const pos = nachWelt(ring);
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
  return prims;
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
