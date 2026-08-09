/**
 * GELAENDENETZ — aus dem Hoehenraster ein Dreiecksnetz mit ECHTEN Kanten.
 *
 * DAS PROBLEM, das diese Datei loest:
 * Das DGM1 des Pilotgebiets hat 2,16 Mio. Zellen. Als regelmaessiges Netz waeren
 * das 4,3 Mio. Dreiecke — zu viel, um sie in einem Rutsch zu bauen, und
 * verschwendet obendrein: 96,6 % der Flaeche ist so eben, dass dort jede
 * zweite Zelle nichts beitraegt. Umgekehrt sind es genau die 3,4 % steiler
 * Zellen (nachgemessen: 15.235 mit ueber 30 % Neigung auf einen Meter), die
 * das Gelaende ausmachen — Boeschungen, Grabenkanten, Mauerfuesse, Rampen.
 *
 * Ein gleichmaessig vergroebertes Netz macht es genau falsch herum: es spart
 * ueberall gleich viel und verliert dabei zuerst die Kanten. Deshalb wird hier
 * FEHLERGESTEUERT verfeinert — fein, wo die Form es verlangt, grob in der
 * Ebene.
 *
 * VERFAHREN: Bintree-Verfeinerung (rechtwinklige Dreiecke, Teilung an der
 * Mitte der Hypotenuse) mit gesaettigtem Fehlermass nach Lindstrom/Pascucci.
 *
 * WARUM GERADE DIESES: Es hat KEINE Risse. Ob ein Dreieck geteilt wird, haengt
 * allein an EINEM Punkt — der Mitte seiner Hypotenuse. Diesen Punkt teilt es
 * sich mit dem Nachbardreieck auf der anderen Seite, und beide treffen darum
 * zwangslaeufig dieselbe Entscheidung. Ein Netz aus unabhaengig verfeinerten
 * Kacheln oder ein Quadtree ohne Ausgleich haette an jeder Aufloesungsgrenze
 * eine haengende Ecke, und durch die sieht man im Betrieb hindurch.
 *
 * „Gesaettigt" heisst: Der Fehler eines Punktes ist immer mindestens so gross
 * wie der aller Punkte, die erst nach ihm entstehen koennen. Ohne diese
 * Saettigung bricht die Verfeinerung vor einem feinen Detail ab, das hinter
 * einer zufaellig flachen Zwischenstufe liegt — eine Stufe mitten in einer
 * sonst ebenen Rampe waere dann weg.
 *
 * Diese Datei laeuft im Server UND im Browser.
 */

import type { BBox } from '../domain/types.ts';
import type { Hoehenraster } from './raster.ts';

export interface GelaendeNetz {
  /** Eckpunkte als [E, N, H] hintereinander (EPSG:25832, Meter). */
  punkte: Float64Array;
  /** Dreiecksindizes. */
  indizes: Uint32Array;
  /** Texturkoordinaten 0..1 innerhalb der Kachel, je Eckpunkt. */
  uv: Float32Array;
  anzahlPunkte: number;
  anzahlDreiecke: number;
  /** Groesster verbliebener Hoehenfehler gegenueber dem Raster, in Metern. */
  restFehlerM: number;
}

export interface NetzOptionen {
  /**
   * Zulaessige Abweichung des Netzes vom Raster in Metern.
   *
   * 0,05 m ist bewusst gewaehlt: Der kleinste Koerper, der noch eine Rolle
   * spielt, ist der Bordstein mit 12 cm. Eine Toleranz von der halben
   * Bordsteinhoehe wuerde ihn im Gelaende bereits verschlucken.
   */
  toleranzM?: number;
  /** Feinste Kantenlaenge in Rasterschritten (1 = volle Aufloesung). */
  minSchritt?: number;
}

/**
 * Naechste Zweierpotenz-Aufloesung, die das Raster nicht unterabtastet.
 * Ein 256-m-Feld auf einem 1-m-Raster braucht 257 x 257 Stuetzstellen.
 */
function stufenAnzahl(kanteM: number, zellM: number): number {
  const noetig = Math.max(2, Math.ceil(kanteM / zellM));
  let n = 1;
  while (n < noetig) n *= 2;
  return n;
}

/**
 * Baut das Netz einer quadratischen Kachel.
 *
 * @param kachel Quadratische Bbox. Nicht quadratische Kacheln werden auf die
 *   laengere Kante aufgefuellt — die Bintree-Teilung setzt gleiche Schenkel
 *   voraus, sonst entarten die Dreiecke zu Splittern.
 */
export function netzAusRaster(raster: Hoehenraster, kachel: BBox, optionen: NetzOptionen = {}): GelaendeNetz {
  const toleranz = optionen.toleranzM ?? 0.05;
  const minSchritt = Math.max(1, optionen.minSchritt ?? 1);

  const breite = kachel.maxE - kachel.minE;
  const hoehe = kachel.maxN - kachel.minN;
  const kante = Math.max(breite, hoehe);
  const n = stufenAnzahl(kante, raster.kopf.zellM * minSchritt);
  const seite = n + 1;
  const schrittM = kante / n;

  // --- Hoehen an allen Stuetzstellen ---------------------------------------
  // Einmal abfragen, nicht je Dreieck: die Rasterabfrage ist bilinear und
  // wuerde sonst hunderttausendfach dieselbe Zelle anfassen.
  const h = new Float64Array(seite * seite);
  const eBei = (i: number) => kachel.minE + i * schrittM;
  const nBei = (j: number) => kachel.minN + j * schrittM;
  const mittel = raster.statistik().mittel;
  for (let j = 0; j < seite; j++) {
    for (let i = 0; i < seite; i++) {
      h[j * seite + i] = raster.hoeheOder(eBei(i), nBei(j), mittel);
    }
  }

  // --- Gesaettigte Fehler an den Teilungspunkten ---------------------------
  const fehler = new Float32Array(seite * seite);
  let restFehler = 0;

  /**
   * Rekursiv absteigen und den Fehler von unten nach oben saettigen.
   * Ein Dreieck ist (apex | v1, v2) mit der Hypotenuse v1-v2.
   */
  const saettigen = (ax: number, ay: number, x1: number, y1: number, x2: number, y2: number): number => {
    const mx = (x1 + x2) >> 1;
    const my = (y1 + y2) >> 1;
    // Unterste Stufe: die Hypotenuse ist nur noch einen Schritt lang.
    if (Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1) return 0;
    const echt = h[my * seite + mx];
    const genaehert = (h[y1 * seite + x1] + h[y2 * seite + x2]) / 2;
    const eigen = Math.abs(echt - genaehert);
    const links = saettigen(mx, my, ax, ay, x1, y1);
    const rechts = saettigen(mx, my, x2, y2, ax, ay);
    const gesamt = Math.max(eigen, links, rechts);
    const i = my * seite + mx;
    if (gesamt > fehler[i]) fehler[i] = gesamt;
    return gesamt;
  };

  // ANFANGSDREIECKE: Das Quadrat wird an seiner DIAGONALEN geteilt, und die
  // Diagonale ist die Hypotenuse beider Dreiecke — der rechte Winkel liegt in
  // den beiden anderen Ecken. Wer hier eine Kathete als Hypotenuse einsetzt,
  // bekommt Teilungspunkte, die nicht auf der laengsten Seite liegen; die
  // Rekursion erzeugt dann entartete Dreiecke mit doppelten Eckpunkten und das
  // Netz bekommt Loecher (nachgemessen 09.08.2026: 331 m2 von 65.536 fehlten).
  saettigen(n, 0, 0, 0, n, n);
  saettigen(0, n, n, n, 0, 0);

  // --- Netz erzeugen -------------------------------------------------------
  const punkteIndex = new Int32Array(seite * seite).fill(-1);
  const punkte: number[] = [];
  const uv: number[] = [];
  const indizes: number[] = [];

  const punktId = (x: number, y: number): number => {
    const k = y * seite + x;
    const vorhanden = punkteIndex[k];
    if (vorhanden >= 0) return vorhanden;
    const id = punkte.length / 3;
    const e = eBei(x);
    const nn = nBei(y);
    punkte.push(e, nn, h[k]);
    // Texturkoordinaten beziehen sich auf die KACHEL, nicht auf das
    // aufgefuellte Quadrat — sonst sitzt das Luftbild verschoben.
    uv.push(breite > 0 ? (e - kachel.minE) / breite : 0, hoehe > 0 ? (nn - kachel.minN) / hoehe : 0);
    punkteIndex[k] = id;
    return id;
  };

  const bauen = (ax: number, ay: number, x1: number, y1: number, x2: number, y2: number): void => {
    const feinstGenug = Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1;
    if (!feinstGenug) {
      const mx = (x1 + x2) >> 1;
      const my = (y1 + y2) >> 1;
      if (fehler[my * seite + mx] > toleranz) {
        bauen(mx, my, ax, ay, x1, y1);
        bauen(mx, my, x2, y2, ax, ay);
        return;
      }
      const echt = h[my * seite + mx];
      const genaehert = (h[y1 * seite + x1] + h[y2 * seite + x2]) / 2;
      const d = Math.abs(echt - genaehert);
      if (d > restFehler) restFehler = d;
    }
    // Nur Punkte innerhalb der Kachel zeichnen: bei nicht quadratischen
    // Kacheln liegt ein Teil des aufgefuellten Quadrats ausserhalb.
    if (eBei(Math.min(ax, x1, x2)) > kachel.maxE || nBei(Math.min(ay, y1, y2)) > kachel.maxN) return;
    // Umlaufsinn GEGEN den Uhrzeigersinn (von oben gesehen): so zeigen die
    // gerechneten Normalen nach oben. Bei umgekehrtem Umlauf steht das
    // Gelaende im Gegenlicht, sobald es nicht mehr ungeschattet gezeichnet wird.
    indizes.push(punktId(ax, ay), punktId(x2, y2), punktId(x1, y1));
  };

  bauen(n, 0, 0, 0, n, n);
  bauen(0, n, n, n, 0, 0);

  return {
    punkte: new Float64Array(punkte),
    uv: new Float32Array(uv),
    indizes: new Uint32Array(indizes),
    anzahlPunkte: punkte.length / 3,
    anzahlDreiecke: indizes.length / 3,
    restFehlerM: restFehler,
  };
}

// ---------------------------------------------------------------------------
// Die gezeichnete Flaeche ist zugleich die gerechnete
// ---------------------------------------------------------------------------

/**
 * Abfragbare Gelaendeoberflaeche — dieselbe Flaeche, die gezeichnet wird.
 *
 * WARUM DAS SEIN MUSS: Ein fehlergesteuertes Netz weicht innerhalb eines
 * Dreiecks um bis zu der eingestellten Toleranz vom Raster ab. Fragt die
 * Darstellung das Netz und die Platzierung das Raster, sitzt ein Stand
 * genau um diesen Betrag ueber oder unter dem sichtbaren Boden — derselbe
 * Fehler wie bisher, nur kleiner. Deshalb gibt es hier genau EINE Antwort auf
 * die Frage „wie hoch ist der Boden hier", und alles benutzt sie: Darstellung,
 * Objektplatzierung, Regelpruefung, Vadere-Ausleitung.
 *
 * Der Index ist ein gleichmaessiges Fach-Gitter ueber die Dreiecke. Er ist
 * bewusst kein Baum: Gelaendedreiecke sind klein und gleichmaessig verteilt,
 * da traegt das einfachste Verfahren am weitesten.
 */
export class Gelaendeoberflaeche {
  private punkte: Float64Array;
  private indizes: Uint32Array;
  private faecher: Uint32Array[];
  private minE: number;
  private minN: number;
  private fachM: number;
  private spalten: number;
  private zeilen: number;
  readonly ersatzHoehe: number;

  constructor(netze: { punkte: Float64Array; indizes: Uint32Array }[], gebiet: BBox, ersatzHoehe: number, fachM = 16) {
    // Alle Kachelnetze in EIN Feld zusammenlegen — der Index kennt danach
    // keine Kacheln mehr, und eine Abfrage an einer Kachelgrenze braucht
    // keinen Sonderfall.
    let punktAnzahl = 0;
    let indexAnzahl = 0;
    for (const n of netze) {
      punktAnzahl += n.punkte.length;
      indexAnzahl += n.indizes.length;
    }
    this.punkte = new Float64Array(punktAnzahl);
    this.indizes = new Uint32Array(indexAnzahl);
    let pv = 0;
    let iv = 0;
    for (const n of netze) {
      this.punkte.set(n.punkte, pv);
      for (let i = 0; i < n.indizes.length; i++) this.indizes[iv + i] = n.indizes[i] + pv / 3;
      pv += n.punkte.length;
      iv += n.indizes.length;
    }

    this.minE = gebiet.minE;
    this.minN = gebiet.minN;
    this.fachM = fachM;
    this.spalten = Math.max(1, Math.ceil((gebiet.maxE - gebiet.minE) / fachM));
    this.zeilen = Math.max(1, Math.ceil((gebiet.maxN - gebiet.minN) / fachM));
    this.ersatzHoehe = ersatzHoehe;

    // Zweimal zaehlen statt Feld-von-Feldern: bei ueber einer Million
    // Dreiecken sparen die typisierten Felder ein Vielfaches an Speicher.
    const anzahl = new Uint32Array(this.spalten * this.zeilen);
    const fachBereich = (d: number): [number, number, number, number] => {
      const a = this.indizes[d * 3] * 3;
      const b = this.indizes[d * 3 + 1] * 3;
      const c = this.indizes[d * 3 + 2] * 3;
      const eMin = Math.min(this.punkte[a], this.punkte[b], this.punkte[c]);
      const eMax = Math.max(this.punkte[a], this.punkte[b], this.punkte[c]);
      const nMin = Math.min(this.punkte[a + 1], this.punkte[b + 1], this.punkte[c + 1]);
      const nMax = Math.max(this.punkte[a + 1], this.punkte[b + 1], this.punkte[c + 1]);
      return [
        Math.max(0, Math.floor((eMin - this.minE) / fachM)),
        Math.min(this.spalten - 1, Math.floor((eMax - this.minE) / fachM)),
        Math.max(0, Math.floor((nMin - this.minN) / fachM)),
        Math.min(this.zeilen - 1, Math.floor((nMax - this.minN) / fachM)),
      ];
    };
    const dreiecke = this.indizes.length / 3;
    for (let d = 0; d < dreiecke; d++) {
      const [s0, s1, z0, z1] = fachBereich(d);
      for (let z = z0; z <= z1; z++) for (let s = s0; s <= s1; s++) anzahl[z * this.spalten + s]++;
    }
    this.faecher = new Array(this.spalten * this.zeilen);
    for (let i = 0; i < anzahl.length; i++) this.faecher[i] = new Uint32Array(anzahl[i]);
    const gefuellt = new Uint32Array(this.spalten * this.zeilen);
    for (let d = 0; d < dreiecke; d++) {
      const [s0, s1, z0, z1] = fachBereich(d);
      for (let z = z0; z <= z1; z++) {
        for (let s = s0; s <= s1; s++) {
          const k = z * this.spalten + s;
          this.faecher[k][gefuellt[k]++] = d;
        }
      }
    }
  }

  /**
   * Hoehe der gezeichneten Oberflaeche. Ausserhalb des Netzes: Ersatzhoehe.
   * Innerhalb wird baryzentrisch im getroffenen Dreieck interpoliert — also
   * exakt der Wert, den auch die Grafikkarte an dieser Stelle zeichnet.
   */
  hoeheBei(e: number, n: number): number {
    const s = Math.floor((e - this.minE) / this.fachM);
    const z = Math.floor((n - this.minN) / this.fachM);
    if (s < 0 || z < 0 || s >= this.spalten || z >= this.zeilen) return this.ersatzHoehe;
    const fach = this.faecher[z * this.spalten + s];
    for (let i = 0; i < fach.length; i++) {
      const d = fach[i] * 3;
      const a = this.indizes[d] * 3;
      const b = this.indizes[d + 1] * 3;
      const c = this.indizes[d + 2] * 3;
      const e1 = this.punkte[a];
      const n1 = this.punkte[a + 1];
      const e2 = this.punkte[b];
      const n2 = this.punkte[b + 1];
      const e3 = this.punkte[c];
      const n3 = this.punkte[c + 1];
      const nenner = (n2 - n3) * (e1 - e3) + (e3 - e2) * (n1 - n3);
      if (Math.abs(nenner) < 1e-12) continue;
      const l1 = ((n2 - n3) * (e - e3) + (e3 - e2) * (n - n3)) / nenner;
      const l2 = ((n3 - n1) * (e - e3) + (e1 - e3) * (n - n3)) / nenner;
      const l3 = 1 - l1 - l2;
      // Kleine Toleranz: ein Punkt genau auf einer Dreieckskante gehoert zu
      // beiden Nachbarn, und beide liefern denselben Wert.
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      return l1 * this.punkte[a + 2] + l2 * this.punkte[b + 2] + l3 * this.punkte[c + 2];
    }
    return this.ersatzHoehe;
  }

  get dreiecke(): number {
    return this.indizes.length / 3;
  }
}

/**
 * Zerlegt ein Gebiet in quadratische Kacheln, die AM RASTER AUSGERICHTET sind.
 *
 * WARUM AUSGERICHTET: Faellt die Kachelkante mitten in eine Rasterzelle, muss
 * jede Stuetzstelle zwischen vier Zellen interpoliert werden — und aus einer
 * senkrechten Kante wird eine Rampe von einer Zellbreite. Genau das soll das
 * Modell ja gerade nicht mehr tun. Mit ausgerichteten Kacheln liegt jede
 * Stuetzstelle exakt auf einem Rasterwert.
 *
 * @param kachelM Kantenlaenge. 256 m ist eine Zweierpotenz mal Rasterweite —
 *   die Bintree-Teilung braucht das, und 257 x 257 Stuetzstellen je Kachel
 *   sind eine handliche Groesse.
 */
/**
 * Huelle eines Gebietes auf dem GLOBALEN Kachelraster.
 *
 * WARUM GLOBAL VERANKERT (an Vielfachen von kachelM in UTM, nicht am Gebiet):
 * Zwei benachbarte Importe bekommen so exakt dieselben Kachelkanten. Beim
 * spaeteren Zusammensetzen groesserer Gebiete (Hessen, Deutschland) stossen die
 * Netze damit kantengenau aneinander, statt sich zu ueberlappen.
 *
 * WOFUER: Das Hoehenraster MUSS diese Huelle abdecken, nicht nur das bestellte
 * Gebiet. Die Kacheln sind quadratisch (die Bintree-Teilung verlangt gleiche
 * Schenkel) und ragen darum bis zu kachelM ueber das Gebiet hinaus. Wird das
 * Raster nur fuer das Gebiet gebaut, liefert die Hoehenabfrage im Ueberhang die
 * ERSATZHOEHE — und aus dem Ueberhang wird eine flache Platte auf mittlerer
 * Gelaendehoehe (Befund 09.08.2026: 217 m noerdlich des Gebietes lag das
 * Gelaende erfunden eben auf 162,5 m). Gemessene Hoehen gibt es dort sehr wohl,
 * sie wurden nur nicht angefordert.
 *
 * @param randM Mindestabstand, den die Huelle ueber das Gebiet hinausreicht,
 *   bevor auf die Kachelkante aufgerundet wird.
 */
export function kachelHuelle(gebiet: BBox, kachelM = 256, randM = 0): BBox {
  return {
    minE: Math.floor((gebiet.minE - randM) / kachelM) * kachelM,
    minN: Math.floor((gebiet.minN - randM) / kachelM) * kachelM,
    maxE: Math.ceil((gebiet.maxE + randM) / kachelM) * kachelM,
    maxN: Math.ceil((gebiet.maxN + randM) / kachelM) * kachelM,
  };
}

export function kachelnAmRaster(gebiet: BBox, ursprungE: number, ursprungN: number, kachelM = 256): BBox[] {
  const vonE = ursprungE + Math.floor((gebiet.minE - ursprungE) / kachelM) * kachelM;
  const vonN = ursprungN + Math.floor((gebiet.minN - ursprungN) / kachelM) * kachelM;
  const out: BBox[] = [];
  for (let n = vonN; n < gebiet.maxN; n += kachelM) {
    for (let e = vonE; e < gebiet.maxE; e += kachelM) {
      out.push({ minE: e, minN: n, maxE: e + kachelM, maxN: n + kachelM });
    }
  }
  return out;
}
