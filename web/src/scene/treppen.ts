/**
 * TREPPEN als Koerper (Bauwerksmodell, Stufe 6).
 *
 * Die 137 Treppenflaechen des Pilotgebiets waren bis zum 09.08.2026 ebene
 * Polygone. Hier bekommen sie ihre Stufen — jede als eigener Koerper, dessen
 * Trittflaeche auf einer gemessenen Hoehe liegt.
 *
 * Gebaut wird als STAPEL: Jede Stufe ist ein Prisma vom Fuss des Laufs bis zu
 * ihrer eigenen Trittflaeche. Uebereinandergelegt ergeben sie genau die
 * Silhouette einer Treppe, und zwar ohne dass Setzstufe und Trittflaeche
 * einzeln zusammengesetzt werden muessten. Das ist robust gegen schiefe und
 * unregelmaessige Umrisse — und solche sind der Normalfall, weil die Flaechen
 * aus dem Kataster bzw. aus OpenStreetMap stammen und nicht aus einer
 * Treppenplanung.
 */

import * as Cesium from 'cesium';
import type { GelaendeFlaeche } from '@shared/domain/types';
import { nachWgs } from '@shared/geo/proj';
import { teileAnPodesten, treppenlauf } from '@shared/bau/treppe';
import type { Hoehenlage } from './gelaende.ts';
import { zerlegeFlaeche, type Punkt3D } from './stadt.ts';

/**
 * Sichtbeton, etwas dunkler als der Gehwegton der Basiskarte. Eine Treppe ist
 * ein Bauwerk und darf sich vom Belag absetzen; sie bleibt aber unter den
 * Farben der Planobjekte, mit denen sie nicht konkurrieren soll.
 */
const TREPPE_FARBE = '#c9c5c0';

/** Wie weit der Stufenstapel unter den Fuss des Laufs reicht (Einbindung). */
const EINBINDUNG_M = 0.15;

export interface TreppenBericht {
  flaechen: number;
  /** Laufteile nach dem Schnitt an Podesten — mehr als `flaechen` bei L-Treppen. */
  teile: number;
  laeufe: number;
  stufen: number;
  flach: number;
  hoechsterLaufM: number;
  /** Laeufe, deren Stufenzahl aus OpenStreetMap gezaehlt ist. */
  mitBeleg: number;
  /** Kleinste und groesste gebaute Stufenhoehe — die Abnahmezahl. */
  stufenHoeheMinM: number | null;
  stufenHoeheMaxM: number | null;
  befunde: string[];
}

class Sammler {
  ecken: number[] = [];
  indizes: number[] = [];

  flaeche(ring: Punkt3D[]): void {
    if (ring.length < 3) return;
    const dreiecke = zerlegeFlaeche(ring);
    if (!dreiecke.length) return;
    const basis = this.ecken.length / 3;
    for (const p of ring) {
      const [lon, lat] = nachWgs([p[0], p[1]]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, p[2]);
      this.ecken.push(c.x, c.y, c.z);
    }
    for (const [a, b, c] of dreiecke) this.indizes.push(basis + a, basis + b, basis + c);
  }

  viereck(a: Punkt3D, b: Punkt3D, c: Punkt3D, d: Punkt3D): void {
    const basis = this.ecken.length / 3;
    for (const p of [a, b, c, d]) {
      const [lon, lat] = nachWgs([p[0], p[1]]);
      const w = Cesium.Cartesian3.fromDegrees(lon, lat, p[2]);
      this.ecken.push(w.x, w.y, w.z);
    }
    this.indizes.push(basis, basis + 1, basis + 2, basis, basis + 2, basis + 3);
  }
}

/**
 * Baut die Treppen.
 *
 * Das Stufenmass kommt als Vorgabe herein, nicht aus dieser Datei: es ist eine
 * Angabe der Bauklassen (`config/bauklassen/*.json`, Klasse „treppe") und
 * traegt dort seinen Verifikationsstatus. Hier wird nur gebaut.
 */
export function baueTreppen(
  flaechen: GelaendeFlaeche[] | undefined,
  hoehen: Hoehenlage,
  stufenmass: { hoeheM: number; hoeheZulaessigMinM?: number; hoeheZulaessigMaxM?: number } = { hoeheM: 0.17 },
): { prims: Cesium.Primitive[]; bericht: TreppenBericht } {
  const bericht: TreppenBericht = {
    flaechen: 0,
    teile: 0,
    laeufe: 0,
    stufen: 0,
    flach: 0,
    hoechsterLaufM: 0,
    mitBeleg: 0,
    stufenHoeheMinM: null,
    stufenHoeheMaxM: null,
    befunde: [],
  };
  const treppen = (flaechen ?? []).filter((f) => f.art === 'treppe' && f.polygon.length >= 3);
  bericht.flaechen = treppen.length;
  if (!treppen.length) return { prims: [], bericht };

  const s = new Sammler();

  for (const f of treppen) {
    // AN PODESTEN TEILEN: Bei einer L-foermigen Treppe zeigt die
    // Haupttraegheitsachse quer durch beide Laeufe, und die Stufen laegen
    // schraeg zu beiden. Der Schnitt am Podest macht daraus zwei gerade Laeufe.
    const teile = teileAnPodesten(f.polygon);
    bericht.teile += teile.length;
    for (const teil of teile) {
      // Eine gezaehlte Stufenzahl gilt fuer den GANZEN Aufgang. Auf einen
      // Teillauf angewandt waere sie falsch — dann lieber die Ableitung.
      const beleg = teile.length === 1 ? f.stufenzahl : undefined;
      const lauf = treppenlauf(teil, (e, n) => hoehen.bei(e, n), stufenmass, beleg);
      for (const b of lauf.befunde) bericht.befunde.push(`${f.id}: ${b}`);
      if (lauf.flach || !lauf.stufen.length) {
        bericht.flach++;
        continue;
      }
      bericht.laeufe++;
      bericht.stufen += lauf.anzahl;
      if (lauf.herkunft === 'step_count') bericht.mitBeleg++;
      if (lauf.steigungM > bericht.hoechsterLaufM) bericht.hoechsterLaufM = lauf.steigungM;
      if (bericht.stufenHoeheMinM === null || lauf.stufenHoeheM < bericht.stufenHoeheMinM) bericht.stufenHoeheMinM = lauf.stufenHoeheM;
      if (bericht.stufenHoeheMaxM === null || lauf.stufenHoeheM > bericht.stufenHoeheMaxM) bericht.stufenHoeheMaxM = lauf.stufenHoeheM;

      const fuss = lauf.untenM - EINBINDUNG_M;
      for (const stufe of lauf.stufen) {
        // Jede Stufe besteht aus konvexen TEILEN (exakter Schnitt ueber die
        // Dreieckszerlegung) — bei einem einfachen Umriss ist es genau einer.
        for (const ring of stufe.teile) {
          s.flaeche(ring.map((p) => [p[0], p[1], stufe.obenM] as Punkt3D));
          // Mantel bis zum Fuss des Laufs — der Stapel bildet die Setzstufen.
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j];
            const b = ring[i];
            s.viereck(
              [a[0], a[1], fuss],
              [b[0], b[1], fuss],
              [b[0], b[1], stufe.obenM],
              [a[0], a[1], stufe.obenM],
            );
          }
        }
      }
    }
  }

  bericht.hoechsterLaufM = +bericht.hoechsterLaufM.toFixed(2);
  if (bericht.stufenHoeheMinM !== null) bericht.stufenHoeheMinM = +bericht.stufenHoeheMinM.toFixed(3);
  if (bericht.stufenHoeheMaxM !== null) bericht.stufenHoeheMaxM = +bericht.stufenHoeheMaxM.toFixed(3);
  if (!s.indizes.length) return { prims: [], bericht };

  const positionen = new Float64Array(s.ecken);
  const attribute = new Cesium.GeometryAttributes();
  attribute.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionen,
  });
  const geo = Cesium.GeometryPipeline.computeNormal(
    new Cesium.Geometry({
      attributes: attribute,
      indices: new Uint32Array(s.indizes),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
    }),
  );
  const prim = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: geo,
      id: 'treppe',
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(TREPPE_FARBE)) },
    }),
    // BELEUCHTET: Erst Licht und Schatten machen aus dem Stapel eine Treppe.
    appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false, flat: false }),
    asynchronous: false,
  });
  return { prims: [prim], bericht };
}
