/**
 * GLEISE — gebaut aus Netz und Querschnitt (Bauwerksmodell, Stufe 4 und 5).
 *
 * WAS SICH GEGENUEBER DER ALTEN FASSUNG AENDERT:
 *
 * 1. NETZ STATT EINZELWEGE. Die 73 Gleisstuecke des Pilotgebiets haben 146
 *    Enden, von denen 95 deckungsgleich auf dem Ende eines anderen Stuecks
 *    liegen — kuenstliche Schnitte aus der OpenStreetMap-Erfassung und dem
 *    Gebietszuschnitt. Frueher wurde jedes Stueck fuer sich gezeichnet, und
 *    genau dort brach die Schiene ab. Jetzt werden die Stuecke ueber ihre
 *    gemeinsamen Knoten zu durchgehenden Straengen verbunden
 *    (shared/geo/netz.ts).
 *
 * 2. QUERSCHNITT STATT BAENDER. Frueher war das Gleisbett ein flaches Band,
 *    die Schwelle ein flaches Viereck und die Schiene ein 10 cm breiter
 *    Streifen — drei Aufkleber uebereinander, gehalten von einer
 *    Millimeter-Staffelung. Jetzt wird ein echter Querschnitt entlang der
 *    Achse extrudiert (shared/geo/profil.ts), und zwar in ZWEI Bauarten:
 *    Rillenschiene im Belag und Schotteroberbau auf eigenem Bahnkoerper.
 *    Der Wechsel zwischen beiden passiert an einem Netzknoten, nicht mitten
 *    in der Strecke an einer zufaelligen Wegegrenze.
 *
 * 3. DIE RILLE. Sie ist bei der eingelassenen Schiene das Merkmal, an dem man
 *    ein Gleis ueberhaupt erkennt — zwei parallele helle Striche gibt es im
 *    Stadtbild oefter, zwei helle Striche mit je einer schmalen dunklen Nut
 *    daneben nur beim Gleis. Sie fehlte bisher vollstaendig.
 */

import * as Cesium from 'cesium';
import type { GelaendeLinienObjekt, Punkt } from '@shared/domain/types';
import { nachWgs } from '@shared/geo/proj';
import { achseGlaetten, straengeBilden, type NetzKante } from '@shared/geo/netz';
import { extrudiere, querKoerper, verdichteAchse, type ProfilNetz } from '@shared/geo/profil';
import { OBERBAU_FARBEN, OBERBAU_MASSE, rillenGleisProfil, schotterGleisProfil, schwellenQuerschnitt } from '@shared/bau/oberbau';
import type { Hoehenlage } from './gelaende.ts';

/** Stationsabstand der Querschnitte. Wie die Verdichtung der Bodenflaechen. */
const STATION_M = 2;

/**
 * Obergrenze der Schwellen. Bei 0,63 m Teilung sind das rund 1600 je
 * Kilometer; die Grenze faengt nur den Fall ab, dass jemand ein Gebiet mit
 * einem Rangierbahnhof laedt. Dann fehlen Schwellen am Rand, aber die Szene
 * baut in endlicher Zeit — ohne die Grenze waere es ein Einfrieren ohne Meldung.
 */
const SCHWELLEN_MAX = 40000;

export interface GleisBericht {
  stuecke: number;
  straenge: number;
  geheilteSchnitte: number;
  verzweigungen: number;
  laengeM: number;
  rillenschieneM: number;
  schotterM: number;
  schwellen: number;
  dreiecke: number;
}

class Sammler {
  private nach = new Map<string, { farbe: Cesium.Color; ecken: number[]; indizes: number[] }>();

  fuege(farbeHex: string, ecken: number[], indizes: number[]): void {
    let h = this.nach.get(farbeHex);
    if (!h) {
      h = { farbe: Cesium.Color.fromCssColorString(farbeHex), ecken: [], indizes: [] };
      this.nach.set(farbeHex, h);
    }
    const basis = h.ecken.length / 3;
    // Von UTM/NHN in Weltkoordinaten erst hier — der Extruder rechnet in
    // Metern, und das soll er auch, damit dieselbe Geometrie im Server
    // (Ausleitungen, Regelpruefung) unveraendert benutzbar bleibt.
    for (let i = 0; i < ecken.length; i += 3) {
      const [lon, lat] = nachWgs([ecken[i], ecken[i + 1]]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, ecken[i + 2]);
      h.ecken.push(c.x, c.y, c.z);
    }
    for (const idx of indizes) h.indizes.push(basis + idx);
  }

  get dreiecke(): number {
    let n = 0;
    for (const h of this.nach.values()) n += h.indizes.length / 3;
    return n;
  }

  primitive(id: string): Cesium.Primitive | null {
    const instanzen: Cesium.GeometryInstance[] = [];
    let i = 0;
    for (const h of this.nach.values()) {
      if (!h.indizes.length) continue;
      const positionen = new Float64Array(h.ecken);
      const attribute = new Cesium.GeometryAttributes();
      attribute.position = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positionen,
      });
      const geo = new Cesium.Geometry({
        attributes: attribute,
        indices: new Uint32Array(h.indizes),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
      });
      instanzen.push(
        new Cesium.GeometryInstance({
          geometry: Cesium.GeometryPipeline.computeNormal(geo),
          id: `${id}:${i++}`,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(h.farbe) },
        }),
      );
    }
    if (!instanzen.length) return null;
    return new Cesium.Primitive({
      geometryInstances: instanzen,
      // UNBELEUCHTET — wie die Bodenzeichnung, zu der die Gleiszone gehoert.
      //
      // Zweiter Anlauf (09.08.2026): Zuerst hatte ich das Gleis beleuchtet
      // gezeichnet, weil es jetzt ein Koerper mit Flanken ist. Damit lag
      // derselbe Fehler vor wie zuvor beim Gelaende — die Bodenzeichnung wird
      // ungeschattet gezeichnet und die Palette ist auf ungeschattete Toene
      // kalibriert. Die Eindeckung (L* 80) wurde von der Sonne aufgehellt und
      // verlor genau den Kontrast zur Fahrbahn (L* 97), der sie als Gleiszone
      // lesbar macht. Jetzt zeigen beide ihren wirklichen Ton.
      //
      // Die Tiefe der Rille geht dadurch nicht verloren: Sie liest sich ueber
      // den Farbabstand ihres Grundes (L* 26) zur Eindeckung — 54 Stufen, der
      // groesste Kontrast der ganzen Bodenzeichnung.
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: true }),
      asynchronous: false,
    });
  }
}

function laenge(p: Punkt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

/**
 * Baut alle Gleise.
 *
 * Die Bauarten werden GETRENNT vernetzt: ein Strang ist damit durchgehend in
 * derselben Bauart, und der Wechsel liegt an dem Knoten, an dem er in
 * Wirklichkeit auch liegt. Ebenso getrennt wird nach Spurweite — das Profil
 * haengt an ihr, und Meterspur und Normalspur duerfen nicht in einem Strang
 * landen.
 */
export function baueGleise(
  linien: GelaendeLinienObjekt[],
  hoehen: Hoehenlage,
  opts: { mindestZeichenbreiteM?: number } = {},
): { prims: Cesium.Primitive[]; bericht: GleisBericht } {
  // 0 = massstabstreu (Voreinstellung). Ein Wert darueber ist eine
  // Zeichenhilfe fuer das Auge und veraendert NICHT die Fahrkante — die
  // Begruendung steht bei `rillenGleisProfil`.
  const mindestBreite = opts.mindestZeichenbreiteM ?? 0;
  const gleise = linien.filter((l) => l.art === 'gleis' && l.achse.length >= 2);
  const s = new Sammler();
  const bericht: GleisBericht = {
    stuecke: gleise.length,
    straenge: 0,
    geheilteSchnitte: 0,
    verzweigungen: 0,
    laengeM: 0,
    rillenschieneM: 0,
    schotterM: 0,
    schwellen: 0,
    dreiecke: 0,
  };
  if (!gleise.length) return { prims: [], bericht };

  // Gruppen: Bauart x Spurweite
  const gruppen = new Map<string, GelaendeLinienObjekt[]>();
  for (const g of gleise) {
    const imPflaster = g.eigenerBahnkoerper === false;
    const spur = g.spurweiteM && g.spurweiteM > 0 ? g.spurweiteM : 1.0;
    const k = `${imPflaster ? 'rille' : 'schotter'}|${spur.toFixed(3)}`;
    const liste = gruppen.get(k);
    if (liste) liste.push(g);
    else gruppen.set(k, [g]);
  }

  const bezug = (e: number, n: number) => hoehen.bauOben(e, n);

  for (const [k, liste] of gruppen) {
    const [bauart, spurText] = k.split('|');
    const spur = Number(spurText);
    const kanten: NetzKante<GelaendeLinienObjekt>[] = liste.map((l) => ({ punkte: l.achse, quelle: l }));
    const { straenge, bericht: netz } = straengeBilden(kanten);
    bericht.straenge += straenge.length;
    bericht.geheilteSchnitte += netz.geheilteSchnitte;
    bericht.verzweigungen += netz.verzweigungen;

    const profil = bauart === 'rille' ? rillenGleisProfil(spur, mindestBreite) : schotterGleisProfil(spur);

    for (const strang of straenge) {
      // Glaetten VOR dem Verdichten: die Ecken zwischen den vorhandenen
      // Stuetzpunkten werden abgeschnitten, danach wird auf Stationsabstand
      // aufgefuellt.
      const achse = achseGlaetten(strang.punkte);
      const l = laenge(achse);
      bericht.laengeM += l;
      if (bauart === 'rille') bericht.rillenschieneM += l;
      else bericht.schotterM += l;

      for (const netzTeil of extrudiere(achse, profil, bezug, STATION_M) as ProfilNetz[]) {
        s.fuege(netzTeil.farbe, netzTeil.ecken, netzTeil.indizes);
      }

      // Schwellen: nur beim eigenen Bahnkoerper. Im Pflaster ist von einer
      // Schwelle nichts zu sehen — sie dort zu zeichnen waere erfunden.
      if (bauart !== 'rille') {
        const sq = schwellenQuerschnitt(spur);
        const dicht = verdichteAchse(achse, OBERBAU_MASSE.schwelleTeilung.wertM);
        for (let i = 0; i < dicht.length && bericht.schwellen < SCHWELLEN_MAX; i++) {
          const p = dicht[i];
          const q = dicht[Math.min(i + 1, dicht.length - 1)];
          const dx = q[0] - p[0];
          const dy = q[1] - p[1];
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const richtung: Punkt = [dx / len, dy / len];
          const koerper = querKoerper(p, richtung, sq.umriss, sq.tiefeM, bezug(p[0], p[1]) + sq.hoeheUeberBettung);
          s.fuege(OBERBAU_FARBEN.schwelle, koerper.ecken, koerper.indizes);
          bericht.schwellen++;
        }
      }
    }
  }

  bericht.laengeM = Math.round(bericht.laengeM);
  bericht.rillenschieneM = Math.round(bericht.rillenschieneM);
  bericht.schotterM = Math.round(bericht.schotterM);
  bericht.dreiecke = s.dreiecke;
  const p = s.primitive('gleis');
  return { prims: p ? [p] : [], bericht };
}
