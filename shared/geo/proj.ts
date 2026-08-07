/**
 * Projektionen. Intern gilt ausschliesslich EPSG:25832 (ETRS89 / UTM 32N),
 * WGS84 nur fuer Anzeige, Geokodierung und Austauschformate (GeoJSON).
 */

import proj4 from 'proj4';
import type { BBox, LonLat, Punkt, Ring } from '../domain/types.ts';

proj4.defs(
  'EPSG:25832',
  '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);
proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);

const WGS84 = 'EPSG:4326';
const UTM32 = 'EPSG:25832';

/** [lon, lat] -> [E, N] in EPSG:25832. */
export function nachUtm(ll: LonLat): Punkt {
  const [e, n] = proj4(WGS84, UTM32, [ll[0], ll[1]]);
  return [e, n];
}

/** [E, N] -> [lon, lat]. */
export function nachWgs(p: Punkt): LonLat {
  const [lon, lat] = proj4(UTM32, WGS84, [p[0], p[1]]);
  return [lon, lat];
}

export function ringNachWgs(ring: Ring): LonLat[] {
  return ring.map(nachWgs);
}

export function ringNachUtm(ring: LonLat[]): Ring {
  return ring.map(nachUtm);
}

export function bboxNachWgs(b: BBox): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  // Ecken einzeln transformieren und umschliessen — die Zone ist nicht achsentreu.
  const ecken: Punkt[] = [
    [b.minE, b.minN],
    [b.maxE, b.minN],
    [b.maxE, b.maxN],
    [b.minE, b.maxN],
  ];
  const ll = ecken.map(nachWgs);
  return {
    minLon: Math.min(...ll.map((p) => p[0])),
    minLat: Math.min(...ll.map((p) => p[1])),
    maxLon: Math.max(...ll.map((p) => p[0])),
    maxLat: Math.max(...ll.map((p) => p[1])),
  };
}

export function bboxNachUtm(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }): BBox {
  const ecken: LonLat[] = [
    [b.minLon, b.minLat],
    [b.maxLon, b.minLat],
    [b.maxLon, b.maxLat],
    [b.minLon, b.maxLat],
  ];
  const en = ecken.map(nachUtm);
  return {
    minE: Math.min(...en.map((p) => p[0])),
    minN: Math.min(...en.map((p) => p[1])),
    maxE: Math.max(...en.map((p) => p[0])),
    maxN: Math.max(...en.map((p) => p[1])),
  };
}

/**
 * Meridiankonvergenz in Grad: Winkel zwischen Gitternord (UTM) und geografisch
 * Nord. Wird fuer den Nordpfeil im massstaeblichen Lageplan gebraucht — dort
 * zeigt "oben" Gitternord, der Nordpfeil muss um diesen Winkel gedreht werden.
 */
export function meridiankonvergenz(p: Punkt): number {
  const [lon, lat] = nachWgs(p);
  const lon0 = 9; // Hauptmeridian Zone 32
  const rad = Math.PI / 180;
  return Math.atan(Math.tan((lon - lon0) * rad) * Math.sin(lat * rad)) / rad;
}

/** Grober Massstabsfaktor der Abbildung — zur Kontrolle der Streckentreue. */
export function massstabsfaktor(p: Punkt): number {
  const [lon, lat] = nachWgs(p);
  const rad = Math.PI / 180;
  const dl = (lon - 9) * rad;
  const cos = Math.cos(lat * rad);
  return 0.9996 * (1 + (dl * dl * cos * cos) / 2);
}
