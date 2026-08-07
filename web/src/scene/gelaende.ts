/**
 * Gelaendedarstellung.
 *
 * Der Cesium-Globus bleibt AUS. Stattdessen wird das Gelaende als eigenes
 * Dreiecksnetz gebaut: jede Kachel ist ein regelmaessiges Gitter in
 * EPSG:25832-Koordinaten mit den amtlichen Hoehen. Die Luftbildkachel wird vom
 * WMS in genau derselben UTM-Bbox geholt, also sitzt sie pixelgenau auf dem
 * Netz — es gibt keine Umprojizierung und damit auch keinen Versatz an den
 * Kachelraendern, wie er beim Warpen nach WGS84 entsteht.
 */

import * as Cesium from 'cesium';
import type { Gelaende, GelaendePatch, Punkt } from '@shared/domain/types';
import { nachUtm, nachWgs } from '@shared/geo/proj';

/**
 * Grundton der Gelaendeplatte.
 *
 * Sie liegt unter allem und wird ueberall dort sichtbar, wo keine
 * Nutzungsflaeche kartiert ist — Hinterhoefe, Baulücken, Boeschungen. Ein
 * dunkler Ton reisst dort Loecher in die Karte; darum liegt sie auf dem
 * Grundton der Bebauungsflaechen, leicht abgesetzt.
 */
export const GRUNDPLATTE = '#c0bab2';

/** Schnelles Nachschlagen der Gelaendehoehe an beliebiger Stelle. */
export class Hoehenlage {
  private patches: GelaendePatch[];
  readonly mittel: number;

  constructor(gelaende: Gelaende | null) {
    this.patches = gelaende?.patches ?? [];
    this.mittel = gelaende?.hoeheMittel ?? 0;
  }

  /** Bilineare Auswertung im Kachelgitter; ausserhalb die mittlere Hoehe. */
  bei(e: number, n: number): number {
    for (const p of this.patches) {
      if (e < p.bbox.minE || e > p.bbox.maxE || n < p.bbox.minN || n > p.bbox.maxN) continue;
      const fx = ((e - p.bbox.minE) / (p.bbox.maxE - p.bbox.minE)) * (p.spalten - 1);
      const fy = ((n - p.bbox.minN) / (p.bbox.maxN - p.bbox.minN)) * (p.zeilen - 1);
      const x0 = Math.max(0, Math.min(p.spalten - 2, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(p.zeilen - 2, Math.floor(fy)));
      const tx = fx - x0;
      const ty = fy - y0;
      const h00 = p.hoehen[y0][x0];
      const h10 = p.hoehen[y0][x0 + 1];
      const h01 = p.hoehen[y0 + 1][x0];
      const h11 = p.hoehen[y0 + 1][x0 + 1];
      return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
    }
    return this.mittel;
  }

  /** Punkt in Weltkoordinaten, wahlweise mit Aufschlag ueber Grund. */
  welt(p: Punkt, ueberGrund = 0): Cesium.Cartesian3 {
    const [lon, lat] = nachWgs(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat, this.bei(p[0], p[1]) + ueberGrund);
  }

  /** Ring in Weltkoordinaten (alle Punkte auf Gelaendehoehe + Aufschlag). */
  weltRing(ring: Punkt[], ueberGrund = 0): Cesium.Cartesian3[] {
    return ring.map((p) => this.welt(p, ueberGrund));
  }
}

/** Rechnet einen Cesium-Weltpunkt zurueck nach EPSG:25832. */
export function weltNachUtm(c: Cesium.Cartesian3): Punkt | null {
  const carto = Cesium.Cartographic.fromCartesian(c);
  if (!carto) return null;
  return nachUtm([Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]);
}

/**
 * Baut die Gelaende-Primitives: je Kachel ein texturiertes Dreiecksnetz.
 * Ohne Luftbild wird eine ruhige Graphitflaeche gezeichnet, damit das Gelaende
 * trotzdem als Koerper lesbar bleibt.
 */
export function baueGelaende(gelaende: Gelaende, mitLuftbild: boolean): Cesium.Primitive[] {
  const prims: Cesium.Primitive[] = [];
  for (const patch of gelaende.patches) {
    const geo = kachelGeometrie(patch);
    if (!geo) continue;
    const instanz = new Cesium.GeometryInstance({
      geometry: geo,
      id: `gelaende:${patch.id}`,
    });
    const material =
      mitLuftbild && patch.texturDatei
        ? new Cesium.Material({
            fabric: {
              type: 'Image',
              uniforms: { image: `/api/gelaende/${gelaende.id}/textur/${patch.texturDatei}` },
            },
          })
        : Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(GRUNDPLATTE) });

    prims.push(
      new Cesium.Primitive({
        geometryInstances: instanz,
        appearance: new Cesium.MaterialAppearance({
          material,
          faceForward: false,
          closed: false,
          // Ungeschattet: das Luftbild bringt seine eigene Belichtung mit, und
          // die Ersatzflaeche soll ihren Farbwert unveraendert zeigen.
          flat: true,
          // Gelaende ist matt — kein Glanzlicht, sonst wirkt das Luftbild speckig
          translucent: false,
        }),
        // Synchron bauen: gedrosselte Hintergrund-Tabs liefern kein
        // requestAnimationFrame, der Async-Pfad von Cesium bleibt dort haengen.
        asynchronous: false,
      }),
    );
  }
  return prims;
}

function kachelGeometrie(patch: GelaendePatch): Cesium.Geometry | null {
  const { spalten, zeilen, bbox, hoehen } = patch;
  if (spalten < 2 || zeilen < 2) return null;
  const anzahl = spalten * zeilen;
  const positionen = new Float64Array(anzahl * 3);
  const st = new Float32Array(anzahl * 2);

  let i = 0;
  for (let z = 0; z < zeilen; z++) {
    const n = bbox.minN + ((bbox.maxN - bbox.minN) * z) / (zeilen - 1);
    for (let s = 0; s < spalten; s++) {
      const e = bbox.minE + ((bbox.maxE - bbox.minE) * s) / (spalten - 1);
      const [lon, lat] = nachWgs([e, n]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, hoehen[z][s]);
      positionen[i * 3] = c.x;
      positionen[i * 3 + 1] = c.y;
      positionen[i * 3 + 2] = c.z;
      // s waechst nach Osten, z nach Norden. Cesium legt Bilder mit
      // umgedrehter Y-Achse an, darum entspricht t=0 dem Suedrand.
      st[i * 2] = s / (spalten - 1);
      st[i * 2 + 1] = z / (zeilen - 1);
      i++;
    }
  }

  const indizes = new Uint32Array((spalten - 1) * (zeilen - 1) * 6);
  let k = 0;
  for (let z = 0; z < zeilen - 1; z++) {
    for (let s = 0; s < spalten - 1; s++) {
      const a = z * spalten + s;
      const b = a + 1;
      const c = a + spalten;
      const d = c + 1;
      indizes[k++] = a;
      indizes[k++] = c;
      indizes[k++] = b;
      indizes[k++] = b;
      indizes[k++] = c;
      indizes[k++] = d;
    }
  }

  // GeometryAttributes nimmt keine Optionen entgegen — Felder einzeln setzen.
  const attribute = new Cesium.GeometryAttributes();
  attribute.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionen,
  });
  attribute.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: st,
  });

  const geometrie = new Cesium.Geometry({
    attributes: attribute,
    indices: indizes,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
  });

  return Cesium.GeometryPipeline.computeNormal(geometrie);
}
