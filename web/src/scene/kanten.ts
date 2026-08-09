/**
 * KANTENKOERPER — Bordsteine, Boeschungen, Stuetzmauern.
 *
 * Sie werden hier nur GEZEICHNET. Woher sie kommen, entscheidet der Import:
 * `server/geodata/bauwerk.ts` leitet sie aus den Konstruktionshoehen zweier
 * aneinandergrenzender Flaechen ab und legt sie als `Gelaende.bruchkanten` ab.
 * Damit sehen Regelpruefung, Ausleitungen und Darstellung dieselbe Kante —
 * eine im Renderer erfundene Kante waere nur ein Bild.
 *
 * WARUM DAS DER SICHTBARE TEIL DES GANZEN UMBAUS IST:
 * Ein Bordstein ist 12 cm hoch und trotzdem das Element, das einer Strasse
 * ihre Kante gibt. Ohne ihn stossen Fahrbahn und Gehweg als zwei Farbfelder
 * aneinander — das ist der Eindruck von „flachem Papier", den der Auftraggeber
 * beschrieben hat. Bisher gab es Bordsteine nur dort, wo OpenStreetMap zufaellig
 * `barrier=kerb` fuehrt: 556 m im ganzen Pilotgebiet. Aus den Konstruktions-
 * hoehen ergeben sich 52.175 m — praktisch jede Strassenkante des Gebiets.
 *
 * VEREINBARUNG DER GEOMETRIE: Die hoehere Flaeche liegt LINKS der Laufrichtung
 * (so legt es `Bruchkante` fest). Der Koerper waechst also nach links.
 */

import * as Cesium from 'cesium';
import type { Bruchkante, Punkt } from '@shared/domain/types';
import { nachWgs } from '@shared/geo/proj';
import type { Hoehenlage } from './gelaende.ts';
import { VERKEHR_FARBEN } from './verkehr.ts';

/**
 * Breite der Bordsteinkrone. Ein Tiefbord ist 15 cm breit; sichtbar ist im
 * Modell ohnehin nur die Kante, aber ohne eine Krone waere der Stein eine
 * unendlich duenne Wand und verschwaende unter streifendem Licht.
 */
const BORD_BREITE_M = 0.15;

/**
 * Regelneigung einer Boeschung (1 : 1,5). Steiler wird gemauert — das
 * entscheidet aber der Import, nicht diese Datei.
 */
const BOESCHUNG_NEIGUNG = 1 / 1.5;

/** Wie weit der Koerper unter die untere Flaeche reicht. */
const EINBINDUNG_M = 0.05;

/**
 * Groesster Stuetzpunktabstand. Die Kantenlinien stammen aus den
 * Flaechenraendern und haben dort teils zehn Meter lange Segmente; ohne
 * Verdichtung liefe der Bordstein als Sehne unter der Gelaendekuppe hindurch —
 * derselbe Fehler wie bei den Bodenflaechen, nur an einem 12-cm-Koerper noch
 * auffaelliger.
 */
const VERDICHTUNG_M = 2;

const FARBE: Record<string, Cesium.Color> = {
  bordstein: VERKEHR_FARBEN.bordstein,
  boeschung: Cesium.Color.fromCssColorString('#cfd3c8'),
  stuetzmauer: VERKEHR_FARBEN.mauer,
  bauwerk: VERKEHR_FARBEN.mauer,
};

interface Haufen {
  farbe: Cesium.Color;
  positionen: number[];
  indizes: number[];
}

class Sammler {
  private nach = new Map<string, Haufen>();

  private haufen(farbe: Cesium.Color): Haufen {
    const k = farbe.toCssColorString();
    let h = this.nach.get(k);
    if (!h) {
      h = { farbe, positionen: [], indizes: [] };
      this.nach.set(k, h);
    }
    return h;
  }

  viereck(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], farbe: Cesium.Color) {
    const h = this.haufen(farbe);
    const basis = h.positionen.length / 3;
    for (const p of [a, b, c, d]) {
      const [lon, lat] = nachWgs([p[0], p[1]]);
      const w = Cesium.Cartesian3.fromDegrees(lon, lat, p[2]);
      h.positionen.push(w.x, w.y, w.z);
    }
    h.indizes.push(basis, basis + 1, basis + 2, basis, basis + 2, basis + 3);
  }

  primitive(id: string): Cesium.Primitive | null {
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
      // BELEUCHTET, nicht flach: Erst das Licht macht aus dem Streifen eine
      // Kante mit Sonnen- und Schattenseite — genau das, was die Strasse als
      // raeumlichen Koerper lesbar macht.
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: false }),
      // Synchron: der Async-Pfad haengt in gedrosselten Hintergrund-Tabs.
      asynchronous: false,
    });
  }
}

/** Zwischenpunkte einfuegen, damit der Koerper dem Gelaende folgt. */
function verdichte(linie: Punkt[]): Punkt[] {
  const out: Punkt[] = [];
  for (let i = 0; i < linie.length; i++) {
    if (i > 0) {
      const a = linie[i - 1];
      const b = linie[i];
      const teile = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / VERDICHTUNG_M);
      for (let t = 1; t < teile; t++) {
        out.push([a[0] + ((b[0] - a[0]) * t) / teile, a[1] + ((b[1] - a[1]) * t) / teile]);
      }
    }
    out.push(linie[i]);
  }
  return out;
}

/**
 * Baut die Kantenkoerper.
 *
 * Die Hoehen der Kante stehen zwar im Datensatz, werden hier aber aus dem
 * GELAENDE plus dem gespeicherten Aufbau neu bestimmt. Grund: Nach dem
 * Verdichten liegen Zwischenpunkte vor, die es beim Ableiten noch nicht gab.
 * Zwischen zwei Stuetzpunkten linear zu interpolieren hiesse, die Kante als
 * Sehne unter der Gelaendekuppe durchzufuehren — der Aufbau (12 cm) ist
 * dagegen entlang der ganzen Kante konstant und darf deshalb uebernommen
 * werden.
 */
export function baueKanten(kanten: Bruchkante[] | undefined, hoehen: Hoehenlage): Cesium.Primitive[] {
  if (!kanten?.length) return [];
  const s = new Sammler();

  for (const k of kanten) {
    if (k.linie.length < 2 || k.hoehenOben.length < 2) continue;
    const farbe = FARBE[k.bauart] ?? VERKEHR_FARBEN.bordstein;
    // Aufbau der beiden Seiten aus dem ersten Stuetzpunkt zurueckrechnen.
    const gelaende0 = hoehen.bei(k.linie[0][0], k.linie[0][1]);
    const aufbauOben = k.hoehenOben[0] - gelaende0;
    const aufbauUnten = k.hoehenUnten[0] - gelaende0;
    const dh = aufbauOben - aufbauUnten;
    if (!(dh > 0.005)) continue;

    const linie = verdichte(k.linie);
    // Breite des Koerpers quer zur Achse: Bordstein bekommt eine schmale
    // Krone, eine Boeschung die Breite, die ihre Regelneigung verlangt.
    const breite = k.bauart === 'boeschung' ? Math.max(BORD_BREITE_M, dh / BOESCHUNG_NEIGUNG) : BORD_BREITE_M;

    for (let i = 1; i < linie.length; i++) {
      const a = linie[i - 1];
      const b = linie[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      // Links der Laufrichtung liegt die hoehere Flaeche.
      const lx = (-dy / l) * breite;
      const ly = (dx / l) * breite;

      const gA = hoehen.bei(a[0], a[1]);
      const gB = hoehen.bei(b[0], b[1]);
      const obenA = gA + aufbauOben;
      const obenB = gB + aufbauOben;
      const untenA = gA + aufbauUnten;
      const untenB = gB + aufbauUnten;

      // 1. Sichtflaeche: die eigentliche Kante, senkrecht zwischen den Hoehen.
      s.viereck(
        [a[0], a[1], untenA - EINBINDUNG_M],
        [b[0], b[1], untenB - EINBINDUNG_M],
        [b[0], b[1], obenB],
        [a[0], a[1], obenA],
        farbe,
      );
      // 2. Krone bzw. Boeschungsschraege nach links, auf die hoehere Seite.
      s.viereck(
        [a[0], a[1], obenA],
        [b[0], b[1], obenB],
        [b[0] + lx, b[1] + ly, obenB],
        [a[0] + lx, a[1] + ly, obenA],
        farbe,
      );
    }
  }

  const p = s.primitive('kante');
  return p ? [p] : [];
}

/** Kennzahlen fuer die Oberflaeche („52.175 m Bordstein aus 2.254 Kanten"). */
export function kantenBilanz(kanten: Bruchkante[] | undefined): { bauart: string; anzahl: number; laengeM: number }[] {
  const nach = new Map<string, { anzahl: number; laengeM: number }>();
  for (const k of kanten ?? []) {
    let l = 0;
    for (let i = 1; i < k.linie.length; i++) {
      l += Math.hypot(k.linie[i][0] - k.linie[i - 1][0], k.linie[i][1] - k.linie[i - 1][1]);
    }
    const e = nach.get(k.bauart) ?? { anzahl: 0, laengeM: 0 };
    e.anzahl++;
    e.laengeM += l;
    nach.set(k.bauart, e);
  }
  return [...nach.entries()]
    .map(([bauart, e]) => ({ bauart, anzahl: e.anzahl, laengeM: Math.round(e.laengeM) }))
    .sort((a, b) => b.laengeM - a.laengeM);
}
