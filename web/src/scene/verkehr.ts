/**
 * Verkehrsinfrastruktur und Stadtmobiliar in 3D.
 *
 * WARUM DIESE DATEI:
 * Der Auftraggeber vergleicht mit der Satellitenansicht: „ich will dass man
 * Fusswege erkennt, ich will dass man Schienen erkennt … Haltestellen etc."
 * Bodenzeichnung (stadt.ts) und Gebaeude liefern die Flaechen und die Masse der
 * Stadt — was fehlt, ist das, woran man einen Ort tatsaechlich WIEDERERKENNT:
 * das Gleis in der Strasse, der Bahnsteig, die Mauer, der Bordstein, die
 * Laterne. Genau diese Koerper baut diese Datei, aus den Massen, die
 * `server/geodata/stadtdetails.ts` aus OpenStreetMap holt.
 *
 * KEINE Fotos, keine Texturen, keine Symbole: jedes Element ist ein echter
 * Koerper an seiner echten Stelle. Wo ein Mass fehlt, greift eine Klassen-
 * annahme, die an Ort und Stelle als solche benannt ist — eine Annahme ist
 * keine Messung.
 *
 * WIE DAS GLEIS ERKENNBAR WIRD (der wichtigste Punkt der Datei):
 * Ein Gleis ist im Luftbild an DREI Dingen erkennbar, nie an einem allein:
 *   1. dem dunklen Band des Gleisbetts,
 *   2. der Querstreifung der Schwellen,
 *   3. den zwei hellen, exakt parallelen Linien der Schienen.
 * Punkt 3 traegt die Erkennung — zwei helle Linien im festen Abstand der
 * Spurweite gibt es sonst nirgends im Stadtbild. Punkt 1 liefert den Kontrast,
 * vor dem sie ueberhaupt leuchten koennen (DL* 39 zwischen Bett und Schiene),
 * Punkt 2 die Textur, die aus zwei Strichen ein Gleis macht. Darum wird hier
 * KEINE der drei Lagen eingespart.
 *
 * TECHNIK:
 * Alle Primitives werden SYNCHRON gebaut (`asynchronous: false`). Der
 * Async-Pfad von Cesium bleibt in gedrosselten Hintergrund-Tabs dauerhaft im
 * Zustand „nicht bereit" haengen — das faellt erst beim Tab-Wechsel auf.
 * Gebuendelt wird nach FARBE: jede Farbe wird zu genau einer GeometryInstance,
 * alle Instanzen einer Gruppe landen in EINEM Primitive. Aus mehreren tausend
 * Einzelkoerpern werden so eine Handvoll Zeichenaufrufe.
 * (`PerInstanceColorAppearance` nimmt die Farbe aus dem Instanz-Attribut, NICHT
 * aus einem Eckpunkt-Farbkanal — siehe FarbSammler in stadt.ts.)
 */

import * as Cesium from 'cesium';
import type { GelaendeLinienObjekt, GelaendePunktObjekt, Punkt, Ring } from '@shared/domain/types';
import {
  abstand,
  aufPolylinie,
  bandRing,
  dot,
  kreisRing,
  lot,
  norm,
  polylinieLaenge,
  rechteckRing,
  rotiere,
  sub,
} from '@shared/geo/geometry';
import { nachWgs } from '@shared/geo/proj';
import type { Hoehenlage } from './gelaende.ts';
import { zerlegeFlaeche } from './stadt.ts';
import type { Punkt3D } from './stadt.ts';

// ===========================================================================
// 1  FARBEN
// ===========================================================================

/**
 * Palette der Verkehrs- und Mobiliarkoerper.
 *
 * Sie fuegt sich in die Regeln von `palette.ts` ein — dort steht die
 * Begruendung ausfuehrlich, hier nur ihre Anwendung:
 *  - Klassifiziert wird ueber HELLIGKEIT (L*), nicht ueber Buntheit. Rot,
 *    Gruen und Blau bleiben den Planobjekten vorbehalten (Rettungswege,
 *    Sperrflaechen, Stationen); ein bunter Bestand wuerde mit ihnen
 *    konkurrieren.
 *  - Die Basiskarte ist HELL (Flaechen zwischen L* 76 und 97). Alles hier
 *    Gebaute ist deutlich dunkler und steht damit als Figur auf ihr — mit der
 *    einen, bewussten Ausnahme der Schiene.
 *
 * Alle Werte fuer L*, a* und b* sind echt gerechnet (sRGB -> linear -> XYZ D65
 * -> CIELAB), nicht geschaetzt.
 */
export const VERKEHR_FARBEN = {
  /**
   * Gleisbett (Schotter). #7c7975 — L* 50,97 / a* +0,36 / b* +2,59.
   * Neutralgrau mit einem Hauch Waerme (Basalt-/Grauwacke-Schotter). Es ist
   * das dunkelste flaechige Element der ganzen Szene und liegt damit dicht bei
   * der Bahnkontur der Basiskarte (KONTUR_BAHN L* 39,9) — dieselbe
   * Rollenverteilung wie in basemap.de Grau, wo die Bahn das dunkelste Element
   * ist. Es ist zugleich die BUEHNE fuer die Schiene: 39 L* Abstand.
   */
  gleisbett: Cesium.Color.fromCssColorString('#7c7975'),

  /**
   * Schwelle. #57534e — L* 35,52 / a* +0,62 / b* +3,51.
   * 15,4 L* unter dem Gleisbett — genug, dass die Querstreifung als Textur
   * liest, zu wenig, dass sie mit der Schiene um Aufmerksamkeit streitet. Der
   * warme Stich (b* +3,5) steht fuer Holz- wie Betonschwelle gleichermassen;
   * eine Unterscheidung waere frei erfunden, OSM fuehrt sie nicht.
   */
  schwelle: Cesium.Color.fromCssColorString('#57534e'),

  /**
   * Schiene. #dfe3e4 — L* 89,96 / a* -1,16 / b* -0,96.
   * DER hellste Koerper der Szene und der einzige, der heller ist als seine
   * Umgebung. Das ist Absicht und entspricht der Wirklichkeit: der Schienenkopf
   * ist blank gefahren und glaenzt im Luftbild als heller Strich. 39,0 L* ueber
   * dem Gleisbett — das ist der groesste Helligkeitssprung der gesamten
   * Palette und der Grund, warum man das Gleis auf Anhieb erkennt.
   */
  schiene: Cesium.Color.fromCssColorString('#dfe3e4'),

  /**
   * Bahnsteig-Sockel. #bab7b3 — L* 74,55 / a* +0,33 / b* +2,40.
   * Sichtbeton, ruhig. 17,8 L* unter dem Gehwegton der Basiskarte (92,37): der
   * Steig hebt sich klar vom Gehweg ab, ohne wie ein Bauwerk zu wirken.
   */
  bahnsteig: Cesium.Color.fromCssColorString('#bab7b3'),

  /**
   * Mast (Haltestellenmast, Laternenmast). #6f7276 — L* 47,91 / a* -0,30 /
   * b* -2,60. Kuehles Stahlgrau. Duenne senkrechte Koerper verlieren durch die
   * Perspektive an Deckung; sie brauchen einen dunklen Ton, um ueberhaupt zu
   * lesen.
   */
  mast: Cesium.Color.fromCssColorString('#6f7276'),

  /**
   * Haltestellenschild. #8f949a — L* 61,09 / a* -0,59 / b* -3,79.
   * 13,2 L* heller als der Mast, damit die kleine Tafel sich vom Traeger loest.
   * Bewusst KEIN gelbes H-Signet: das waere ein Symbol, und Symbole gehoeren in
   * die Beschriftungsebene, nicht in den Koerper.
   */
  schild: Cesium.Color.fromCssColorString('#8f949a'),

  /**
   * Mauer. #b3aca3 — L* 70,69 / a* +0,90 / b* +5,51.
   * Warmer Putz-/Bruchsteinton, in der Farbrichtung des Grundtons (b* +4,6),
   * aber 22 L* dunkler. Die Mauer ist ein Bauwerk und darf so aussehen; sie
   * bleibt 9,3 L* unter dem Gebaeudewandton (79,98) und damit erkennbar
   * NEBENSAECHLICHER als ein Haus.
   */
  mauer: Cesium.Color.fromCssColorString('#b3aca3'),

  /**
   * Stadtmauer. #a2988b — L* 63,34 / a* +1,39 / b* +8,16.
   * 7,4 L* dunkler und deutlich waermer als die gewoehnliche Mauer — der
   * Sandsteinton historischen Mauerwerks. Die Stadtmauer ist in Darmstadt ein
   * Orientierungspunkt; dass sie sich von einer Gartenmauer unterscheidet, ist
   * gewollt.
   */
  stadtmauer: Cesium.Color.fromCssColorString('#a2988b'),

  /**
   * Zaun. #8b9095 bei Deckkraft 0,55 — L* 59,53 / a* -0,80 / b* -3,28.
   * Kuehl (Metall), dunkel, und vor allem HALBDURCHLAESSIG: ein Zaun ist
   * ueberwiegend Luft. Als massives Band gezeichnet wuerde er im Modell wie
   * eine Mauer wirken und die Beurteilung einer Flucht- oder Zufahrtssituation
   * verfaelschen. Die Deckkraft ist die ehrlichste verfuegbare Naeherung an
   * seinen Fuellgrad.
   */
  zaun: Cesium.Color.fromCssColorString('#8b9095').withAlpha(0.55),

  /**
   * Gelaender / Schutzplanke. #9aa0a5 bei Deckkraft 0,50 — L* 65,54.
   * Noch offener als ein Zaun (Handlauf plus Fuellstaebe), darum eine Stufe
   * heller und eine Stufe durchlaessiger.
   */
  gelaender: Cesium.Color.fromCssColorString('#9aa0a5').withAlpha(0.5),

  /**
   * Bordstein. #c6c3bf — L* 78,92 / a* +0,32 / b* +2,37.
   * Betongrau. Die Abstaende sind der eigentliche Zweck dieses Werts:
   * 18,3 L* unter der Fahrbahn (97,26), 13,5 unter dem Gehweg (92,37),
   * 9,0 unter der ALKIS-Strassenraumplatte (87,94) — ueber der Schwelle von 9,
   * ab der zwei Flaechen sicher getrennt lesen. Der Bordstein ist nur 12 cm
   * hoch und trotzdem das Element, das der Strasse ihre KANTE gibt. Er wird
   * nicht weggelassen.
   */
  bordstein: Cesium.Color.fromCssColorString('#c6c3bf'),

  /**
   * Leuchtenkopf. #d9dbdc — L* 87,28. Hell, weil eine Leuchte hell ist; sie
   * bleibt aber unter der Schiene (89,96), damit im Bild nichts mit dem Gleis
   * verwechselt wird.
   */
  leuchte: Cesium.Color.fromCssColorString('#d9dbdc'),

  /**
   * Bank (Holz). #9d9083 — L* 60,56 / a* +2,58 / b* +8,66.
   * Verwittertes Holz: warm genug, um als Holz zu lesen, weit entfernt von
   * einem gesaettigten Braun. Mobiliar soll den Ort beleben, nicht vom Plan
   * ablenken.
   */
  bank: Cesium.Color.fromCssColorString('#9d9083'),

  /**
   * Poller. #6a6d70 — L* 45,87. Dunkel wie der Mast; ein Poller ist ein
   * Hindernis fuer Fahrzeuge und darf im Plan hart lesen.
   */
  poller: Cesium.Color.fromCssColorString('#6a6d70'),

  /** Brunnenbecken (Stein). #b0aca6 — L* 70,52 / b* +3,59. */
  becken: Cesium.Color.fromCssColorString('#b0aca6'),

  /**
   * Wasser im Becken. #b7cedb — L* 81,47 / a* -5,03 / b* -9,04.
   * IDENTISCH mit dem Wasserton der Basiskarte (`FLAECHEN_STIL.wasser`).
   * Wasser hat in dieser Karte genau eine Farbe; zwei waeren zwei Aussagen.
   */
  wasser: Cesium.Color.fromCssColorString('#b7cedb'),

  /** Abfallbehaelter. #787b7e — L* 51,46. Klein, dunkel, unauffaellig. */
  papierkorb: Cesium.Color.fromCssColorString('#787b7e'),

  /** Fahrradstaender / Trinkwassersaeule (Metall). #8b9095 — L* 59,53. */
  metall: Cesium.Color.fromCssColorString('#8b9095'),
};

// ===========================================================================
// 2  MASSE
// ===========================================================================
// Regelmasse des Bahn- und Strassenbaus bzw. Klassenannahmen. Jede Zahl steht
// hier EINMAL und ist benannt — eine Zahl mitten im Code waere in einem halben
// Jahr nicht mehr nachvollziehbar.

/**
 * DER GEZEICHNETE BODEN LIEGT NICHT AUF NULL.
 *
 * `baueBodenzeichnung` (stadt.ts) stapelt die Nutzungsflaechen mit einem
 * winzigen Hoehenversatz je Rangstufe uebereinander, damit sie nicht flackern:
 * heute 2 cm plus 1 mm je Rang (hoechster Rang 46 = Zebrastreifen auf einer
 * Bruecke), in der Fassung von palette.ts 2 mm je Rang. Der oberste Decker
 * liegt damit zwischen 6,6 und 9,6 cm ueber dem Gelaende.
 *
 * Wer hier auf das GELAENDE baut, baut also UNTER die Strasse. Beim Gleis waere
 * das der teuerste denkbare Fehler: die Strassenbahn liegt IM Strassenraum, der
 * Fahrbahndecker deckte Gleisbett und Schwellen zu, und genau das, was der
 * Auftraggeber erkennen will, waere weg.
 *
 * Deshalb bekommt alles in dieser Datei diesen Sockel. Die Bauhoehen
 * UNTEREINANDER bleiben unangetastet und massgerecht — der Sockel verschiebt
 * nur den gemeinsamen Nullpunkt vom Gelaende auf die gezeichnete
 * Strassenoberflaeche, und dort gehoert er auch hin.
 */
const BODEN_STAPEL_M = 0;

/** Bahnsteig: Regelmass eines kurzen Strassenbahn-Kaps. */
const STEIG_LAENGE_M = 6;
const STEIG_BREITE_M = 2.5;
const STEIG_HOEHE_M = 0.2;
/** Mast des Haltestellenzeichens. */
const HALTE_MAST_M = 3.2;
const HALTE_MAST_DICKE_M = 0.12;
/** Schild quer oben am Mast. */
const HALTE_SCHILD_BREITE_M = 0.9;
const HALTE_SCHILD_HOEHE_M = 0.45;
const HALTE_SCHILD_DICKE_M = 0.08;

/** Laterne: Klassenmasse, wenn OSM keine Hoehe fuehrt (stadtdetails setzt 5 m). */
const LATERNE_HOEHE_M = 5;
const LATERNE_MAST_DICKE_M = 0.16;
const LATERNE_AUSLEGER_M = 1.1;
const LATERNE_KOPF_L_M = 0.55;
const LATERNE_KOPF_B_M = 0.24;

/** Bank: Regelmasse einer Parkbank. */
const BANK_LAENGE_M = 1.8;
const BANK_TIEFE_M = 0.45;
const BANK_SITZ_M = 0.45;
const BANK_LEHNE_M = 0.88;

const POLLER_HOEHE_M = 0.9;
const POLLER_DICKE_M = 0.16;

const BRUNNEN_D_M = 3.0;
const BRUNNEN_RAND_M = 0.35;

const PAPIERKORB_D_M = 0.42;
const PAPIERKORB_HOEHE_M = 0.9;

const RAD_BUEGEL_ANZAHL = 3;
const RAD_BUEGEL_ABSTAND_M = 0.7;
const RAD_BUEGEL_LAENGE_M = 0.9;
const RAD_BUEGEL_HOEHE_M = 0.75;
const RAD_BUEGEL_DICKE_M = 0.06;

const TRINKWASSER_HOEHE_M = 1.0;
const TRINKWASSER_D_M = 0.28;

/**
 * Alle bodenstaendigen Koerper reichen um diesen Betrag unter die gezeichnete
 * Oberflaeche. Das Hoehenmodell ist eine Interpolation; ohne dieses Einbinden
 * stuende ein Koerper an einer Gelaendekante auf einer unsichtbaren Stufe und
 * schiene zu schweben.
 */
const EINSINKEN_M = 0.16;

/**
 * Groesstes Bandstueck in Stuetzpunkten. Ein Band wird aus laengeren Achsen in
 * ueberlappende Stuecke zerlegt (ein SEGMENT Ueberlappung, damit keine Luecke
 * entsteht). Zwei Gruende: die Dreieckszerlegung eines sehr langen Bandrings
 * kostet quadratisch, und je laenger der Ring, desto groesser die Gefahr, dass
 * er sich an einer engen Kurve selbst schneidet und die Zerlegung entartet.
 */
const BAND_MAX_PUNKTE = 48;

// ===========================================================================
// 3  BAUKASTEN — Dreiecke sammeln, nach Farbe gebuendelt
// ===========================================================================

interface Haufen {
  farbe: Cesium.Color;
  positionen: number[];
  indizes: number[];
}

/**
 * Sammelt Dreiecke getrennt nach Farbe und gibt sie als EIN Primitive aus.
 *
 * Gleiches Vorgehen wie `FarbSammler` in stadt.ts, nur fuer die hier
 * gebrauchten Bauteile (Baender, Quader, Zylinder). Der Umweg ueber ein
 * eigenes Dreiecksnetz statt ueber viele `PolygonGeometry`-Instanzen ist kein
 * Selbstzweck: 10 000 Schwellen als Einzelpolygone kosten Sekunden im
 * Aufbau — als ein Netz sind es 20 000 Dreiecke und ein Zeichenaufruf.
 */
class TeileSammler {
  private nach = new Map<string, Haufen>();

  private haufen(farbe: Cesium.Color): Haufen {
    const schluessel = farbe.toCssColorString();
    let h = this.nach.get(schluessel);
    if (!h) {
      h = { farbe, positionen: [], indizes: [] };
      this.nach.set(schluessel, h);
    }
    return h;
  }

  private punkt(h: Haufen, p: Punkt3D): void {
    const [lon, lat] = nachWgs([p[0], p[1]]);
    const c = Cesium.Cartesian3.fromDegrees(lon, lat, p[2]);
    h.positionen.push(c.x, c.y, c.z);
  }

  /** Beliebige ebene Flaeche im Raum (Ohrenschnitt aus stadt.ts). */
  flaeche(ring: Punkt3D[], farbe: Cesium.Color): void {
    if (ring.length < 3) return;
    const dreiecke = zerlegeFlaeche(ring);
    if (!dreiecke.length) return;
    const h = this.haufen(farbe);
    const basis = h.positionen.length / 3;
    for (const p of ring) this.punkt(h, p);
    for (const [a, b, c] of dreiecke) h.indizes.push(basis + a, basis + b, basis + c);
  }

  /**
   * Viereck bekannter, einfacher Form (Wandstueck, Schwelle, Streifen).
   * Spart die Zerlegung — bei zehntausenden Bauteilen ist das der Unterschied
   * zwischen einem Wimpernschlag und einer Gedenksekunde.
   */
  viereck(a: Punkt3D, b: Punkt3D, c: Punkt3D, d: Punkt3D, farbe: Cesium.Color): void {
    const h = this.haufen(farbe);
    const basis = h.positionen.length / 3;
    this.punkt(h, a);
    this.punkt(h, b);
    this.punkt(h, c);
    this.punkt(h, d);
    h.indizes.push(basis, basis + 1, basis + 2, basis, basis + 2, basis + 3);
  }

  get leer(): boolean {
    for (const h of this.nach.values()) if (h.indizes.length) return false;
    return true;
  }

  /**
   * @param ungeschattet true = ohne Licht rechnen. Fuer BODENnahe Flaechen
   *   richtig (sie tragen ihre Information ueber die Farbabstufung, genau wie
   *   die Bodenzeichnung), fuer aufragende Koerper falsch — die brauchen
   *   Licht, sonst sind Mauer und Boden derselbe Fleck.
   */
  primitive(id: string, durchsichtig: boolean, ungeschattet: boolean): Cesium.Primitive | null {
    const instanzen: Cesium.GeometryInstance[] = [];
    let i = 0;
    for (const h of this.nach.values()) {
      if (!h.indizes.length) continue;
      const positionen = new Float64Array(h.positionen);
      const attribute = new Cesium.GeometryAttributes();
      attribute.position = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positionen,
      });
      const geometrie = new Cesium.Geometry({
        attributes: attribute,
        indices: new Uint32Array(h.indizes),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
      });
      instanzen.push(
        new Cesium.GeometryInstance({
          // Normalen IMMER rechnen, auch fuer ungeschattete Netze: das ist der
          // Weg, den FarbSammler in stadt.ts seit jeher geht und der sich im
          // Betrieb bewaehrt hat. Eine Geometrie ohne Normalen an eine
          // Appearance zu geben, die sie doch anfordert, endet in einem
          // „Appearance/Geometry mismatch" — der Preis dafuer waere ein
          // schwarzes Bild, der Preis hier sind ein paar Millisekunden.
          geometry: Cesium.GeometryPipeline.computeNormal(geometrie),
          id: `${id}:${i++}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(h.farbe) },
        }),
      );
    }
    if (!instanzen.length) return null;
    return new Cesium.Primitive({
      geometryInstances: instanzen,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: durchsichtig,
        // closed bleibt FALSCH: damit steht faceForward auf wahr, die Normalen
        // werden zum Auge gedreht und die Ruecklaufkultur eines Rings spielt
        // keine Rolle. Bei durchsichtigen Koerpern verhindert es zusaetzlich
        // das Doppel-Blending von Vorder- und Rueckseite.
        closed: false,
        flat: ungeschattet,
      }),
      // Synchron: der Async-Pfad haengt in gedrosselten Hintergrund-Tabs.
      asynchronous: false,
    });
  }
}

// --- Kleine Geometriehelfer ------------------------------------------------

/** Doppelte Stuetzpunkte entfernen — sie machen Richtungen unbestimmt. */
function entdoppeln(linie: Punkt[]): Punkt[] {
  const out: Punkt[] = [];
  for (const p of linie) {
    const l = out[out.length - 1];
    if (!l || abstand(l, p) > 1e-6) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Zerlegt eine lange Achse in ueberlappende Stuecke (Ueberlappung: ein ganzes
 * Segment). Die Ueberlappung wird doppelt gezeichnet — bei gleicher Farbe und
 * gleicher Hoehe ist das unsichtbar, waehrend eine Stossfuge an einer Kurve
 * eine sichtbare Luecke im Band hinterliesse.
 */
function bandStuecke(linie: Punkt[], maxPunkte = BAND_MAX_PUNKTE): Punkt[][] {
  if (linie.length <= maxPunkte) return [linie];
  const out: Punkt[][] = [];
  for (let start = 0; start < linie.length - 1; start += maxPunkte - 2) {
    const stueck = linie.slice(start, start + maxPunkte);
    if (stueck.length >= 2) out.push(stueck);
  }
  return out;
}

/**
 * Absolute Hoehe der GEZEICHNETEN Oberflaeche an einer Stelle — auf ihr stehen
 * alle Koerper dieser Datei (siehe BODEN_STAPEL_M).
 */
function standHoehe(hoehen: Hoehenlage, p: Punkt): number {
  return hoehen.bei(p[0], p[1]) + BODEN_STAPEL_M;
}

/** Waagerechte Flaeche, die dem Gelaende in einem festen Abstand folgt. */
function flaecheAufGelaende(
  s: TeileSammler,
  ring: Ring,
  hoehen: Hoehenlage,
  ueberGrund: number,
  farbe: Cesium.Color,
): void {
  if (ring.length < 3) return;
  s.flaeche(
    ring.map((p) => [p[0], p[1], hoehen.bauOben(p[0], p[1]) + ueberGrund] as Punkt3D),
    farbe,
  );
}

/**
 * Aufragender Koerper ueber einem Ring, der dem GELAENDE folgt: Mantel plus
 * Deckel. Fuer lange Bauwerke (Mauer, Zaun, Bordstein) — ihre Oberkante muss
 * dem Gelaende folgen, sonst waechst eine Mauer am Hang aus dem Boden heraus.
 */
function koerperAufGelaende(
  s: TeileSammler,
  ring: Ring,
  hoehen: Hoehenlage,
  hoehe: number,
  farbe: Cesium.Color,
): void {
  if (ring.length < 3) return;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const ha = standHoehe(hoehen, a);
    const hb = standHoehe(hoehen, b);
    s.viereck(
      [a[0], a[1], ha - EINSINKEN_M],
      [b[0], b[1], hb - EINSINKEN_M],
      [b[0], b[1], hb + hoehe],
      [a[0], a[1], ha + hoehe],
      farbe,
    );
  }
  flaecheAufGelaende(s, ring, hoehen, BODEN_STAPEL_M + hoehe, farbe);
}

/**
 * Aufragender Koerper mit FESTEN absoluten Hoehen (kleine Objekte).
 * Bei einem Poller oder einer Bank waere eine gelaendefolgende Oberkante
 * falsch — die Sitzflaeche einer Bank ist waagerecht, auch am Hang.
 */
function koerperFest(
  s: TeileSammler,
  ring: Ring,
  unten: number,
  oben: number,
  farbe: Cesium.Color,
  mitBoden = false,
): void {
  if (ring.length < 3 || oben <= unten) return;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    s.viereck([a[0], a[1], unten], [b[0], b[1], unten], [b[0], b[1], oben], [a[0], a[1], oben], farbe);
  }
  s.flaeche(
    ring.map((p) => [p[0], p[1], oben] as Punkt3D),
    farbe,
  );
  if (mitBoden) {
    s.flaeche(
      ring.map((p) => [p[0], p[1], unten] as Punkt3D),
      farbe,
    );
  }
}

/** Rechteck von Punkt a nach Punkt b mit gegebener Breite (Ausleger, Buegel). */
function balkenRing(a: Punkt, b: Punkt, breite: number): Ring | null {
  const r = norm(sub(b, a));
  if (r[0] === 0 && r[1] === 0) return null;
  const n = lot(r);
  const h = breite / 2;
  return [
    [a[0] + n[0] * h, a[1] + n[1] * h],
    [b[0] + n[0] * h, b[1] + n[1] * h],
    [b[0] - n[0] * h, b[1] - n[1] * h],
    [a[0] - n[0] * h, a[1] - n[1] * h],
  ];
}

/**
 * Stabile Pseudo-Ausrichtung aus einer Id (0 bis 360 Grad).
 *
 * WOFUER: Bei Laternen und Baenken fuehrt OSM die Ausrichtung fast nie. Alle
 * gleich auszurichten waere die schlechtere Luege — eine Reihe exakt
 * gleichgedrehter Baenke liest sich als ORDNUNG und damit als Aussage ueber
 * den Bestand. Eine Streuung liest sich als „unbekannt".
 * NICHT `Math.random()`: das flackerte bei jedem Neuaufbau der Szene. Dieselbe
 * Ueberlegung und derselbe FNV-1a wie bei `gebaeudeVariante(id)` in palette.ts.
 * Das Ergebnis ist ANSICHT, kein Mass.
 */
function streuungGrad(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 360000) / 1000;
}

/** Bekannte Ausrichtung, sonst stabile Streuung. */
function drehungVon(p: GelaendePunktObjekt): number {
  return p.drehungGrad ?? streuungGrad(p.id);
}

// ===========================================================================
// 4  GLEISE — ausgelagert
// ===========================================================================
//
// Die frueher hier stehende `baueGleise` zeichnete je OSM-Weg drei flache
// Baender (Bett, Schwelle, Schiene), gehalten von einer Millimeter-Staffelung.
// Sie ist am 09.08.2026 ersetzt worden durch web/src/scene/gleise.ts: dort
// wird ein echter Querschnitt entlang eines VERNETZTEN Strangs extrudiert
// (shared/geo/netz.ts, shared/geo/profil.ts, shared/bau/oberbau.ts).
// Begruendung und Messwerte: docs/BAUWERKSMODELL.md, Stufe 4 und 5.

// ===========================================================================
// 5  HALTESTELLEN
// ===========================================================================

/** Eine Beschriftung, die die Szene in ihre LabelCollection uebernimmt. */
export interface HalteBeschriftung {
  pos: Cesium.Cartesian3;
  text: string;
}

export interface HaltestellenBau {
  prims: Cesium.Primitive[];
  labels: HalteBeschriftung[];
}

/**
 * Baut die Haltestellen: flacher Bahnsteig-Sockel, schlanker Mast, kleines
 * Schild quer oben. Der Name wird NICHT hier gesetzt, sondern zurueckgegeben —
 * Beschriftungen gehoeren in die eine LabelCollection der Szene, sonst
 * ueberzeichnen sich mehrere Sammlungen gegenseitig.
 *
 * AUSRICHTUNG: `drehungGrad`, wo OSM sie fuehrt. Sonst liegt der Steig
 * gitternord — die Achse des zugehoerigen Gleises steht dieser Funktion nicht
 * zur Verfuegung, und eine geratene Ausrichtung waere bei einem 6 m langen
 * Koerper deutlich sichtbar. Hier wird also NICHT gestreut: anders als bei
 * einer Bank ist die Lage eines Bahnsteigs eine Aussage.
 */
export function baueHaltestellen(punkte: GelaendePunktObjekt[], hoehen: Hoehenlage): HaltestellenBau {
  const s = new TeileSammler();
  const labels: HalteBeschriftung[] = [];

  for (const p of punkte) {
    if (p.art !== 'haltestelle') continue;
    const boden = standHoehe(hoehen, p.pos);
    const dreh = p.drehungGrad ?? 0;

    // Bahnsteig-Sockel
    koerperFest(
      s,
      rechteckRing(p.pos, STEIG_LAENGE_M, STEIG_BREITE_M, dreh),
      boden - EINSINKEN_M,
      boden + STEIG_HOEHE_M,
      VERKEHR_FARBEN.bahnsteig,
    );

    // Mast: am Ende des Steigs, damit er das Warteflaechenmass nicht zerteilt.
    const versatzLokal = rotiere([STEIG_LAENGE_M / 2 - 0.6, 0], dreh);
    const mastPos: Punkt = [p.pos[0] + versatzLokal[0], p.pos[1] + versatzLokal[1]];
    koerperFest(
      s,
      rechteckRing(mastPos, HALTE_MAST_DICKE_M, HALTE_MAST_DICKE_M, dreh),
      boden,
      boden + HALTE_MAST_M,
      VERKEHR_FARBEN.mast,
    );

    // Schild QUER zum Steig: seine lange Seite steht senkrecht auf der langen
    // Seite des Bahnsteigs — so liest es sich aus der Strasse heraus.
    koerperFest(
      s,
      rechteckRing(mastPos, HALTE_SCHILD_DICKE_M, HALTE_SCHILD_BREITE_M, dreh),
      boden + HALTE_MAST_M - HALTE_SCHILD_HOEHE_M,
      boden + HALTE_MAST_M,
      VERKEHR_FARBEN.schild,
      true,
    );

    // Namenlose Halte bekommen keine Beschriftung — „Haltestelle" waere kein
    // Name, sondern eine Behauptung.
    if (p.name) {
      const [lon, lat] = nachWgs(mastPos);
      labels.push({
        pos: Cesium.Cartesian3.fromDegrees(lon, lat, boden + HALTE_MAST_M + 0.5),
        text: p.name,
      });
    }
  }

  const prim = s.primitive('haltestelle', false, false);
  return { prims: prim ? [prim] : [], labels };
}

// ===========================================================================
// 6  BARRIEREN
// ===========================================================================

/** Farbe je Barrierenart. */
const BARRIERE_FARBE: Record<string, Cesium.Color> = {
  mauer: VERKEHR_FARBEN.mauer,
  stadtmauer: VERKEHR_FARBEN.stadtmauer,
  zaun: VERKEHR_FARBEN.zaun,
  gelaender: VERKEHR_FARBEN.gelaender,
  bordstein: VERKEHR_FARBEN.bordstein,
};

/** Halbdurchlaessig gezeichnete Arten — sie sind ueberwiegend Luft. */
const DURCHSCHEINEND = new Set(['zaun', 'gelaender']);

/**
 * Baut Mauern, Stadtmauern, Zaeune, Gelaender und Bordsteine als aufragende
 * Baender in ihrer echten Hoehe und Dicke (beides kommt aus
 * `stadtdetails.ts`: gemessene `height`/`width`, sonst Klassenannahme).
 *
 * BORDSTEINE sind nur 12 cm hoch und trotzdem der Grund, warum diese Funktion
 * existiert: sie geben der Strasse ihre Kante. Ohne sie stossen Fahrbahn und
 * Gehweg als zwei Farbfelder aneinander; mit ihnen entsteht die Fuge, an der
 * das Auge die Strasse als raeumlichen Koerper liest. Sie werden nicht
 * weggelassen und nicht „zur Vereinfachung" hoeher gemacht.
 *
 * HECKEN kommen hier bewusst NICHT vor, obwohl sie dieselbe Datenstruktur
 * benutzen: sie sind Vegetation und gehoeren zu den Baeumen, nicht zum Bau.
 * Waeren sie hier UND dort, stuende jede Hecke doppelt im Modell.
 */
export function baueBarrieren(linien: GelaendeLinienObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const massiv = new TeileSammler();
  const offen = new TeileSammler();

  for (const l of linien) {
    const farbe = BARRIERE_FARBE[l.art];
    if (!farbe) continue; // Gleise und Hecken laufen hier absichtlich vorbei
    const achse = entdoppeln(l.achse);
    if (achse.length < 2) continue;
    if (!(l.hoeheM > 0) || !(l.breiteM > 0)) continue;

    const s = DURCHSCHEINEND.has(l.art) ? offen : massiv;
    for (const stueck of bandStuecke(achse)) {
      const ring = bandRing(stueck, l.breiteM);
      if (ring) koerperAufGelaende(s, ring, hoehen, l.hoeheM, farbe);
    }
  }

  const prims: Cesium.Primitive[] = [];
  // Aufragende Koerper werden BELEUCHTET: erst das Licht macht aus einem
  // grauen Streifen eine Mauer mit Sonnen- und Schattenseite.
  const a = massiv.primitive('barriere', false, false);
  if (a) prims.push(a);
  const b = offen.primitive('barriere_offen', true, false);
  if (b) prims.push(b);
  return prims;
}

// ===========================================================================
// 7  STRASSENMOEBEL
// ===========================================================================

/**
 * Baut das Stadtmobiliar: Laternen, Baenke, Poller, Brunnen, Papierkoerbe,
 * Fahrradstaender, Trinkwassersaeulen.
 *
 * HALTUNG: klein, ruhig, gedaempft. Diese Koerper sollen den Ort BELEBEN und
 * die Massstaeblichkeit stuetzen — eine Bank neben einem geplanten Stand sagt
 * sofort, wie gross der Stand ist. Sie duerfen aber nie vom Plan ablenken:
 * keine Signalfarben, keine Symbole, keine Uebertreibung der Masse.
 *
 * BAEUME und HALTESTELLEN laufen hier absichtlich vorbei: Baeume gehoeren zur
 * Vegetation, Haltestellen zu `baueHaltestellen()`. Jedes Element wird genau
 * einmal gebaut.
 */
// ===========================================================================
//    LICHTSIGNALANLAGEN UND VERKEHRSZEICHEN
// ===========================================================================

/**
 * Regelmasse nach RiLSA bzw. StVO-Aufstellvorschriften.
 * Signalgeber Ø 200 mm, drei Kammern -> Gehaeuse rund 0,95 m hoch; Unterkante
 * ueber Gehweg mindestens 2,10 m. Verkehrszeichen: Unterkante 2,00 m ueber
 * Gehweg, Rundschild Ø 600 mm (Regelgroesse innerorts).
 */
const AMPEL_MAST_H_M = 3.6;
const AMPEL_MAST_D_M = 0.13;
/** Unterkante des Signalgebers ueber Gehweg (RiLSA: mindestens 2,10 m). */
const AMPEL_KOPF_UNTEN_M = 2.15;
/** Gehaeuse: drei Kammern à 200 mm Leuchte. */
const AMPEL_KOPF_H_M = 1.0;
const AMPEL_KOPF_B_M = 0.34;
const AMPEL_KOPF_T_M = 0.24;
const AMPEL_LAMPE_D_M = 0.2;
/**
 * KONTRASTBLENDE — der schwarze Rahmen um den Signalgeber.
 * Sie ist das praegnanteste Merkmal einer deutschen Lichtsignalanlage: erst
 * sie macht die Ampel gegen jeden Hintergrund als Ampel lesbar. Ohne sie war
 * im Modell nur ein dunkles Kaestchen am Mast zu sehen (Nutzerbefund
 * 09.08.2026: „ich sehe sie noch gar nicht"). Regelmass rund 0,55 x 1,25 m.
 */
const AMPEL_BLENDE_B_M = 0.56;
const AMPEL_BLENDE_H_M = 1.26;
const AMPEL_BLENDE_T_M = 0.05;
/** Sonnenblende ueber jeder Leuchte. */
const AMPEL_SCHIRM_T_M = 0.13;
/** Fussgaengersignal: zwei Kammern, tiefer angebracht. */
const AMPEL_FUSS_UNTEN_M = 0.95;
const AMPEL_FUSS_H_M = 0.68;

const ZEICHEN_MAST_H_M = 2.6;
const ZEICHEN_MAST_D_M = 0.06;
const ZEICHEN_SCHILD_D_M = 0.6;
const ZEICHEN_SCHILD_UNTEN_M = 2.0;
const ZEICHEN_DICKE_M = 0.05;

/**
 * Farben. Die Lampen tragen ihre Signalfarben, bleiben aber deutlich unter
 * dem Buntheits-Reservat der Planobjekte (palette.PLAN_CHROMA_MIN = 40) —
 * sie sind 20 cm gross und sollen den Ort kenntlich machen, nicht mit einem
 * Rettungsweg um Aufmerksamkeit streiten.
 */
const ZEICHEN_FARBEN = {
  mast: Cesium.Color.fromCssColorString('#6f7276'),
  gehaeuse: Cesium.Color.fromCssColorString('#4a4d50'),
  /** Kontrastblende — dunkelster Koerper der Szene neben der Bahnkontur. */
  blende: Cesium.Color.fromCssColorString('#33363a'),
  rot: Cesium.Color.fromCssColorString('#b4544c'),
  gelb: Cesium.Color.fromCssColorString('#c19a4e'),
  gruen: Cesium.Color.fromCssColorString('#5f8f66'),
  /** Schildflaeche: Vorfahrt/Halt sind rot umrandet, Rest neutral. */
  schildRot: Cesium.Color.fromCssColorString('#b4544c'),
  schildNeutral: Cesium.Color.fromCssColorString('#c9ccce'),
};

/**
 * Ampeln und Verkehrszeichen als Koerper.
 *
 * WAS HIER NICHT BEHAUPTET WIRD: Das Piktogramm eines Schildes wird nicht
 * modelliert — OSM fuehrt fuer die meisten Standorte nur „stop" bzw.
 * „give_way", nicht die Schildgeometrie. Gezeichnet wird darum Mast und
 * Schildflaeche in der Regelgroesse; die Zeichennummer steht im Datensatz
 * (`zeichen`) und kann in der Oberflaeche angezeigt werden.
 */
export function baueVerkehrszeichen(punkte: GelaendePunktObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const s = new TeileSammler();

  for (const p of punkte) {
    if (p.art !== 'ampel' && p.art !== 'verkehrszeichen') continue;
    const boden = standHoehe(hoehen, p.pos);
    const dreh = ((p.drehungGrad ?? 0) * Math.PI) / 180;
    // Blickrichtung des Signalgebers/Schildes und die Querachse dazu.
    const vor: Punkt = [Math.sin(dreh), Math.cos(dreh)];
    const quer: Punkt = [vor[1], -vor[0]];

    /** Quader um `mitte`, ausgerichtet an (vor, quer). */
    const quader = (mitte: Punkt, breite: number, tiefe: number, unten: number, oben: number, farbe: Cesium.Color) => {
      const hb = breite / 2;
      const ht = tiefe / 2;
      const ring: Ring = [
        [mitte[0] - quer[0] * hb - vor[0] * ht, mitte[1] - quer[1] * hb - vor[1] * ht],
        [mitte[0] + quer[0] * hb - vor[0] * ht, mitte[1] + quer[1] * hb - vor[1] * ht],
        [mitte[0] + quer[0] * hb + vor[0] * ht, mitte[1] + quer[1] * hb + vor[1] * ht],
        [mitte[0] - quer[0] * hb + vor[0] * ht, mitte[1] - quer[1] * hb + vor[1] * ht],
      ];
      koerperFest(s, ring, unten, oben, farbe, true);
    };
    /** Punkt `d` Meter vor dem Standpunkt. */
    const davor = (d: number): Punkt => [p.pos[0] + vor[0] * d, p.pos[1] + vor[1] * d];

    if (p.art === 'ampel') {
      koerperFest(s, kreisRing(p.pos, AMPEL_MAST_D_M, 8), boden - EINSINKEN_M, boden + AMPEL_MAST_H_M, ZEICHEN_FARBEN.mast);

      // 1. Kontrastblende — der schwarze Rahmen, an dem man die Ampel erkennt.
      const blendeMitte = davor(AMPEL_MAST_D_M / 2 + AMPEL_BLENDE_T_M / 2);
      const blendeUnten = boden + AMPEL_KOPF_UNTEN_M - (AMPEL_BLENDE_H_M - AMPEL_KOPF_H_M) / 2;
      quader(blendeMitte, AMPEL_BLENDE_B_M, AMPEL_BLENDE_T_M, blendeUnten, blendeUnten + AMPEL_BLENDE_H_M, ZEICHEN_FARBEN.blende);

      // 2. Signalgeber-Gehaeuse davor
      const kopfMitte = davor(AMPEL_MAST_D_M / 2 + AMPEL_BLENDE_T_M + AMPEL_KOPF_T_M / 2);
      const kopfUnten = boden + AMPEL_KOPF_UNTEN_M;
      quader(kopfMitte, AMPEL_KOPF_B_M, AMPEL_KOPF_T_M, kopfUnten, kopfUnten + AMPEL_KOPF_H_M, ZEICHEN_FARBEN.gehaeuse);

      // 3. Drei Leuchten mit Sonnenblende, in Fahrtrichtung schauend
      const vorderkante = AMPEL_MAST_D_M / 2 + AMPEL_BLENDE_T_M + AMPEL_KOPF_T_M;
      const lampen: [number, Cesium.Color][] = [
        [AMPEL_KOPF_H_M - 0.2, ZEICHEN_FARBEN.rot],
        [AMPEL_KOPF_H_M / 2, ZEICHEN_FARBEN.gelb],
        [0.2, ZEICHEN_FARBEN.gruen],
      ];
      for (const [dz, farbe] of lampen) {
        const z = kopfUnten + dz;
        const m = davor(vorderkante + 0.015);
        // Senkrecht stehende Scheibe in der Ebene (quer, hoch)
        const scheibe: Punkt3D[] = [];
        for (let i = 0; i < 12; i++) {
          const w = (i / 12) * Math.PI * 2;
          scheibe.push([
            m[0] + quer[0] * ((Math.cos(w) * AMPEL_LAMPE_D_M) / 2),
            m[1] + quer[1] * ((Math.cos(w) * AMPEL_LAMPE_D_M) / 2),
            z + (Math.sin(w) * AMPEL_LAMPE_D_M) / 2,
          ]);
        }
        s.flaeche(scheibe, farbe);
        // Sonnenblende: kurzes Dach ueber der Leuchte
        const schirmMitte = davor(vorderkante + AMPEL_SCHIRM_T_M / 2);
        quader(
          schirmMitte,
          AMPEL_LAMPE_D_M + 0.06,
          AMPEL_SCHIRM_T_M,
          z + AMPEL_LAMPE_D_M / 2,
          z + AMPEL_LAMPE_D_M / 2 + 0.025,
          ZEICHEN_FARBEN.gehaeuse,
        );
      }

      // 4. Fussgaengersignal am selben Mast, tiefer und zur Seite blickend —
      // an einer Fussgaengerfurt gehoert es dazu und macht den Mast als
      // Anlage erkennbar. Zwei Kammern (rot oben, gruen unten).
      const fussMitte = davor(AMPEL_MAST_D_M / 2 + 0.11);
      const fussUnten = boden + AMPEL_FUSS_UNTEN_M;
      quader(fussMitte, 0.26, 0.22, fussUnten, fussUnten + AMPEL_FUSS_H_M, ZEICHEN_FARBEN.gehaeuse);
      for (const [dz, farbe] of [
        [AMPEL_FUSS_H_M - 0.17, ZEICHEN_FARBEN.rot],
        [0.17, ZEICHEN_FARBEN.gruen],
      ] as [number, Cesium.Color][]) {
        const z = fussUnten + dz;
        const m = davor(AMPEL_MAST_D_M / 2 + 0.11 + 0.12);
        const scheibe: Punkt3D[] = [];
        for (let i = 0; i < 10; i++) {
          const w = (i / 10) * Math.PI * 2;
          scheibe.push([
            m[0] + quer[0] * (Math.cos(w) * 0.075),
            m[1] + quer[1] * (Math.cos(w) * 0.075),
            z + Math.sin(w) * 0.075,
          ]);
        }
        s.flaeche(scheibe, farbe);
      }
      continue;
    }

    // --- Verkehrszeichen: Mast, Schildkoerper, Rand ------------------------
    koerperFest(s, kreisRing(p.pos, ZEICHEN_MAST_D_M, 6), boden - EINSINKEN_M, boden + ZEICHEN_MAST_H_M, ZEICHEN_FARBEN.mast);
    const zeichen = p.zeichen ?? '';
    // Rot umrandet sind die Vorschriftzeichen (Halt 206, Vorfahrt gewaehren
    // 205, Geschwindigkeit 274). Der Rest bleibt neutral.
    const randRot = /DE:(205|206|274)/.test(zeichen);
    const zMitte = boden + ZEICHEN_SCHILD_UNTEN_M + ZEICHEN_SCHILD_D_M / 2;
    const scheibeBei = (radius: number, tiefe: number): Punkt3D[] => {
      const m = davor(ZEICHEN_MAST_D_M / 2 + tiefe);
      const out: Punkt3D[] = [];
      for (let i = 0; i < 14; i++) {
        const w = (i / 14) * Math.PI * 2;
        out.push([
          m[0] + quer[0] * Math.cos(w) * radius,
          m[1] + quer[1] * Math.cos(w) * radius,
          zMitte + Math.sin(w) * radius,
        ]);
      }
      return out;
    };
    // Schildkoerper als flacher Zylinder: aus JEDER Richtung sichtbar, nicht
    // nur von vorn (die frueher gezeichnete Einzelscheibe verschwand, sobald
    // man von der Seite kam).
    const vorne = scheibeBei(ZEICHEN_SCHILD_D_M / 2, ZEICHEN_DICKE_M);
    const hinten = scheibeBei(ZEICHEN_SCHILD_D_M / 2, 0);
    for (let i = 0; i < vorne.length; i++) {
      const j = (i + 1) % vorne.length;
      s.viereck(hinten[i], hinten[j], vorne[j], vorne[i], ZEICHEN_FARBEN.mast);
    }
    s.flaeche(vorne, randRot ? ZEICHEN_FARBEN.schildRot : ZEICHEN_FARBEN.schildNeutral);
    s.flaeche([...hinten].reverse(), ZEICHEN_FARBEN.mast);
    // Helles Innenfeld — so liest das Schild als Ring mit Feld statt als
    // Farbfleck. Das PIKTOGRAMM wird bewusst nicht erfunden.
    if (randRot) {
      s.flaeche(scheibeBei(ZEICHEN_SCHILD_D_M / 2 - 0.075, ZEICHEN_DICKE_M + 0.004), ZEICHEN_FARBEN.schildNeutral);
    }
  }

  // Beleuchtet wie alle aufragenden Koerper — der Mast soll eine Sonnenseite
  // haben, sonst steht er als Papierstreifen im Bild.
  const p = s.primitive('verkehrszeichen', false, false);
  return p ? [p] : [];
}

export function baueStrassenmoebel(punkte: GelaendePunktObjekt[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const s = new TeileSammler();

  for (const p of punkte) {
    const boden = standHoehe(hoehen, p.pos);

    switch (p.art) {
      // --- Laterne: Mast, kurzer Ausleger, Leuchtenkopf --------------------
      case 'laterne': {
        const hoehe = p.hoeheM && p.hoeheM > 0 ? p.hoeheM : LATERNE_HOEHE_M;
        const kopfH = boden + hoehe;
        koerperFest(
          s,
          kreisRing(p.pos, LATERNE_MAST_DICKE_M, 6),
          boden - EINSINKEN_M,
          kopfH,
          VERKEHR_FARBEN.mast,
        );
        // Der Ausleger zeigt in Richtung `drehungGrad`, sonst in eine stabile
        // Streurichtung (siehe streuungGrad) — Ansicht, kein Mass.
        const rad = (drehungVon(p) * Math.PI) / 180;
        const richtung: Punkt = [Math.sin(rad), Math.cos(rad)];
        const ende: Punkt = [
          p.pos[0] + richtung[0] * LATERNE_AUSLEGER_M,
          p.pos[1] + richtung[1] * LATERNE_AUSLEGER_M,
        ];
        const arm = balkenRing(p.pos, ende, 0.09);
        if (arm) koerperFest(s, arm, kopfH - 0.16, kopfH - 0.04, VERKEHR_FARBEN.mast, true);
        const kopf = balkenRing(
          [ende[0] - richtung[0] * LATERNE_KOPF_L_M * 0.5, ende[1] - richtung[1] * LATERNE_KOPF_L_M * 0.5],
          [ende[0] + richtung[0] * LATERNE_KOPF_L_M * 0.5, ende[1] + richtung[1] * LATERNE_KOPF_L_M * 0.5],
          LATERNE_KOPF_B_M,
        );
        if (kopf) koerperFest(s, kopf, kopfH - 0.28, kopfH - 0.12, VERKEHR_FARBEN.leuchte, true);
        break;
      }

      // --- Bank: Sitzflaeche und Lehne ------------------------------------
      case 'bank': {
        const dreh = drehungVon(p);
        // Zwei Wangen tragen die Sitzflaeche. Sie stehen nicht im Auftrag, aber
        // eine Sitzflaeche, die 45 cm ueber dem Pflaster SCHWEBT, faellt aus
        // Fussgaengerhoehe sofort als Fehler auf — und genau diese Sicht ist
        // der Massstab, an dem die Szene gemessen wird.
        for (const seite of [-1, 1]) {
          const wange = rotiere([(seite * (BANK_LAENGE_M - 0.24)) / 2, 0], dreh);
          koerperFest(
            s,
            rechteckRing([p.pos[0] + wange[0], p.pos[1] + wange[1]], 0.06, BANK_TIEFE_M, dreh),
            boden - EINSINKEN_M,
            boden + BANK_SITZ_M - 0.06,
            VERKEHR_FARBEN.bank,
          );
        }
        koerperFest(
          s,
          rechteckRing(p.pos, BANK_LAENGE_M, BANK_TIEFE_M, dreh),
          boden + BANK_SITZ_M - 0.06,
          boden + BANK_SITZ_M,
          VERKEHR_FARBEN.bank,
          true,
        );
        // Die Lehne sitzt HINTEN: `drehungGrad` ist die Blickrichtung der Bank
        // (lokales +Y), die Lehne liegt also auf -Y.
        const zurueck = rotiere([0, -BANK_TIEFE_M / 2], dreh);
        const lehnePos: Punkt = [p.pos[0] + zurueck[0], p.pos[1] + zurueck[1]];
        koerperFest(
          s,
          rechteckRing(lehnePos, BANK_LAENGE_M, 0.06, dreh),
          boden + BANK_SITZ_M - 0.02,
          boden + BANK_LEHNE_M,
          VERKEHR_FARBEN.bank,
        );
        break;
      }

      // --- Poller ----------------------------------------------------------
      case 'poller': {
        const hoehe = p.hoeheM && p.hoeheM > 0 ? p.hoeheM : POLLER_HOEHE_M;
        koerperFest(
          s,
          kreisRing(p.pos, POLLER_DICKE_M, 8),
          boden - EINSINKEN_M,
          boden + hoehe,
          VERKEHR_FARBEN.poller,
        );
        break;
      }

      // --- Brunnen: flaches Becken mit Wasserflaeche ------------------------
      case 'brunnen': {
        koerperFest(
          s,
          kreisRing(p.pos, BRUNNEN_D_M, 20),
          boden - EINSINKEN_M,
          boden + BRUNNEN_RAND_M,
          VERKEHR_FARBEN.becken,
        );
        // Wasserspiegel knapp unter der Beckenkante — dadurch liegt das Wasser
        // sichtbar IM Becken und nicht wie eine Platte darauf.
        s.flaeche(
          kreisRing(p.pos, BRUNNEN_D_M - 0.5, 20).map(
            (q) => [q[0], q[1], boden + BRUNNEN_RAND_M - 0.08] as Punkt3D,
          ),
          VERKEHR_FARBEN.wasser,
        );
        break;
      }

      // --- Papierkorb -------------------------------------------------------
      case 'papierkorb': {
        koerperFest(
          s,
          kreisRing(p.pos, PAPIERKORB_D_M, 8),
          boden - EINSINKEN_M,
          boden + PAPIERKORB_HOEHE_M,
          VERKEHR_FARBEN.papierkorb,
        );
        break;
      }

      // --- Fahrradstaender: ein paar Anlehnbuegel ---------------------------
      case 'fahrradstaender': {
        const dreh = drehungVon(p);
        for (let i = 0; i < RAD_BUEGEL_ANZAHL; i++) {
          const quer = (i - (RAD_BUEGEL_ANZAHL - 1) / 2) * RAD_BUEGEL_ABSTAND_M;
          const a = rotiere([quer, -RAD_BUEGEL_LAENGE_M / 2], dreh);
          const b = rotiere([quer, RAD_BUEGEL_LAENGE_M / 2], dreh);
          const ring = balkenRing(
            [p.pos[0] + a[0], p.pos[1] + a[1]],
            [p.pos[0] + b[0], p.pos[1] + b[1]],
            RAD_BUEGEL_DICKE_M,
          );
          if (ring) koerperFest(s, ring, boden, boden + RAD_BUEGEL_HOEHE_M, VERKEHR_FARBEN.metall);
        }
        break;
      }

      // --- Trinkwassersaeule -------------------------------------------------
      case 'trinkwasser': {
        koerperFest(
          s,
          kreisRing(p.pos, TRINKWASSER_D_M, 8),
          boden - EINSINKEN_M,
          boden + TRINKWASSER_HOEHE_M,
          VERKEHR_FARBEN.metall,
        );
        break;
      }

      default:
        // baum -> Vegetation, haltestelle -> baueHaltestellen()
        break;
    }
  }

  const p = s.primitive('moebel', false, false);
  return p ? [p] : [];
}
