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
import { treppenlauf } from '@shared/bau/treppe';
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
  laeufe: number;
  stufen: number;
  flach: number;
  hoechsterLaufM: number;
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
  stufenHoeheM = 0.17,
): { prims: Cesium.Primitive[]; bericht: TreppenBericht } {
  const bericht: TreppenBericht = { flaechen: 0, laeufe: 0, stufen: 0, flach: 0, hoechsterLaufM: 0 };
  const treppen = (flaechen ?? []).filter((f) => f.art === 'treppe' && f.polygon.length >= 3);
  bericht.flaechen = treppen.length;
  if (!treppen.length) return { prims: [], bericht };

  const s = new Sammler();

  for (const f of treppen) {
    const lauf = treppenlauf(f.polygon, (e, n) => hoehen.bei(e, n), stufenHoeheM);
    if (lauf.flach || !lauf.stufen.length) {
      bericht.flach++;
      continue;
    }
    bericht.laeufe++;
    bericht.stufen += lauf.stufen.length;
    if (lauf.steigungM > bericht.hoechsterLaufM) bericht.hoechsterLaufM = lauf.steigungM;

    const fuss = lauf.untenM - EINBINDUNG_M;
    for (const stufe of lauf.stufen) {
      // Trittflaeche
      s.flaeche(stufe.ring.map((p) => [p[0], p[1], stufe.obenM] as Punkt3D));
      // Mantel bis zum Fuss des Laufs — der Stapel bildet die Setzstufen.
      for (let i = 0, j = stufe.ring.length - 1; i < stufe.ring.length; j = i++) {
        const a = stufe.ring[j];
        const b = stufe.ring[i];
        s.viereck(
          [a[0], a[1], fuss],
          [b[0], b[1], fuss],
          [b[0], b[1], stufe.obenM],
          [a[0], a[1], stufe.obenM],
        );
      }
    }
  }

  bericht.hoechsterLaufM = +bericht.hoechsterLaufM.toFixed(2);
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
