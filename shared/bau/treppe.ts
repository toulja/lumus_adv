/**
 * TREPPEN — aus einer Flaeche wird ein Lauf mit Stufen.
 *
 * DER BEFUND (09.08.2026): Das Pilotgebiet fuehrt 137 Flaechen der Art
 * „Treppe". Alle 137 waren ebene, eingefaerbte Polygone. Fuer das Auge ist das
 * ein Schoenheitsfehler; fuer eine Fluchtwegrechnung ist es ein Sachfehler.
 * Eine Treppe ist genau die Stelle, an der ein Personenstrom langsamer wird,
 * an der Rollstuhl und Rettungstrage nicht durchkommen und an der eine
 * Fluchtweglaenge nicht mehr in der Ebene gemessen werden darf. Ueber eine
 * ebene Flaeche laeuft jede Rechnung ungehindert hinweg.
 *
 * WAS HIER GERECHNET WIRD und was nicht:
 * Die Lage der Flaeche ist amtlich bzw. aus OpenStreetMap. Die HOEHEN kommen
 * aus dem Gelaendemodell — an welchem Ende die Treppe oben ist, wird also
 * gemessen und nicht geraten. Die STUFENMASSE dagegen sind eine Annahme aus
 * den Bauklassen (17 cm Steigung, 29 cm Auftritt); OpenStreetMap fuehrt
 * `step_count` nur selten, und niemand hat die Treppen vor Ort vermessen. Die
 * Anzahl der Stufen ergibt sich aus der gemessenen Hoehendifferenz geteilt
 * durch die angenommene Steigung — sie ist damit so gut wie das Hoehenmodell
 * und so unsicher wie die Annahme.
 *
 * Laeuft im Server UND im Browser.
 */

import type { Punkt } from '../domain/types.ts';

export interface Stufe {
  /** Umriss der Trittflaeche in EPSG:25832. */
  ring: Punkt[];
  /** Absolute Hoehe der Trittflaeche (m ue. NHN). */
  obenM: number;
}

export interface Treppenlauf {
  stufen: Stufe[];
  /** Gemessene Hoehendifferenz zwischen unterem und oberem Ende. */
  steigungM: number;
  /** Laenge des Laufs in der Grundflaeche. */
  laufLaengeM: number;
  /** Fuss des Laufs (absolute Hoehe). */
  untenM: number;
  /** Aus der Hoehendifferenz abgeleitete Stufenzahl. */
  anzahl: number;
  /** true = die Hoehendifferenz ist zu klein fuer einen Lauf (Rampe/Podest). */
  flach: boolean;
}

/**
 * Hauptachse einer Flaeche ueber die Haupttraegheitsachse (PCA).
 *
 * Nicht die laengste Kante: Treppenpolygone sind oft in viele kurze Kanten
 * zerlegt, und dann zeigt die laengste Kante quer statt laengs. Die
 * Traegheitsachse benutzt alle Punkte und trifft die Laufrichtung auch bei
 * unregelmaessigen Umrissen.
 */
export function hauptachse(ring: Punkt[]): { richtung: Punkt; mitte: Punkt } {
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p[0];
    sy += p[1];
  }
  const mitte: Punkt = [sx / ring.length, sy / ring.length];
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of ring) {
    const dx = p[0] - mitte[0];
    const dy = p[1] - mitte[1];
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  // Groesster Eigenwert der 2x2-Kovarianzmatrix.
  const spur = xx + yy;
  const det = xx * yy - xy * xy;
  const wurzel = Math.sqrt(Math.max(0, (spur * spur) / 4 - det));
  const lambda = spur / 2 + wurzel;
  let rx = lambda - yy;
  let ry = xy;
  if (Math.hypot(rx, ry) < 1e-9) {
    rx = xy;
    ry = lambda - xx;
  }
  const l = Math.hypot(rx, ry) || 1;
  return { richtung: [rx / l, ry / l], mitte };
}

/**
 * Schneidet ein Polygon an einer Halbebene ab (Sutherland-Hodgman).
 *
 * GRENZE DES VERFAHRENS, offen benannt: Bei einem KONKAVEN Umriss kann das
 * Ergebnis Kanten enthalten, die am Rand entlanglaufen statt das Polygon zu
 * teilen. Treppenlaeufe sind nahezu immer konvexe Vierecke, darum traegt es
 * hier; fuer beliebige Flaechen waere ein echter Polygonschnitt noetig.
 */
function halbebene(ring: Punkt[], punkt: Punkt, normale: Punkt): Punkt[] {
  const drin = (p: Punkt) => (p[0] - punkt[0]) * normale[0] + (p[1] - punkt[1]) * normale[1] >= 0;
  const schnitt = (a: Punkt, b: Punkt): Punkt => {
    const da = (a[0] - punkt[0]) * normale[0] + (a[1] - punkt[1]) * normale[1];
    const db = (b[0] - punkt[0]) * normale[0] + (b[1] - punkt[1]) * normale[1];
    const t = da / (da - db);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out: Punkt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const aDrin = drin(a);
    const bDrin = drin(b);
    if (aDrin) out.push(a);
    if (aDrin !== bDrin) out.push(schnitt(a, b));
  }
  return out;
}

/**
 * Baut den Treppenlauf einer Flaeche.
 *
 * @param hoeheAn Gelaendehoehe an einer Stelle — die MESSUNG, aus der sich
 *   ergibt, wo oben und unten ist.
 * @param stufenHoeheM Angenommene Steigung je Stufe (aus den Bauklassen).
 * @param mindestSteigungM Darunter gilt die Flaeche als Podest oder Rampe und
 *   bekommt keine Stufen — eine „Treppe" mit 9 cm Gesamthoehe waere erfunden.
 */
export function treppenlauf(
  ring: Punkt[],
  hoeheAn: (e: number, n: number) => number,
  stufenHoeheM = 0.17,
  mindestSteigungM = 0.3,
): Treppenlauf {
  const { richtung, mitte } = hauptachse(ring);
  // Ausdehnung entlang der Hauptachse bestimmen.
  let min = Infinity;
  let max = -Infinity;
  for (const p of ring) {
    const t = (p[0] - mitte[0]) * richtung[0] + (p[1] - mitte[1]) * richtung[1];
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const laenge = max - min;
  const endeA: Punkt = [mitte[0] + richtung[0] * min, mitte[1] + richtung[1] * min];
  const endeB: Punkt = [mitte[0] + richtung[0] * max, mitte[1] + richtung[1] * max];

  // Hoehen an beiden Enden MESSEN, leicht nach innen versetzt: genau auf der
  // Kante liegt der Gelaendewert schon halb auf der Nachbarflaeche.
  const einwaerts = Math.min(0.8, laenge * 0.15);
  const hA = hoeheAn(endeA[0] + richtung[0] * einwaerts, endeA[1] + richtung[1] * einwaerts);
  const hB = hoeheAn(endeB[0] - richtung[0] * einwaerts, endeB[1] - richtung[1] * einwaerts);
  const untenM = Math.min(hA, hB);
  const steigung = Math.abs(hB - hA);
  // Laufrichtung zeigt IMMER bergauf.
  const bergauf: Punkt = hB >= hA ? richtung : [-richtung[0], -richtung[1]];
  const fuss: Punkt = hB >= hA ? endeA : endeB;

  if (!(steigung >= mindestSteigungM) || laenge < 0.5) {
    return { stufen: [], steigungM: steigung, laufLaengeM: laenge, untenM, anzahl: 0, flach: true };
  }

  const anzahl = Math.max(1, Math.round(steigung / stufenHoeheM));
  const stufenTiefe = laenge / anzahl;
  const stufen: Stufe[] = [];
  for (let i = 0; i < anzahl; i++) {
    // Scheibe zwischen zwei Schnitten quer zur Laufrichtung.
    const t0 = i * stufenTiefe;
    const t1 = (i + 1) * stufenTiefe;
    const p0: Punkt = [fuss[0] + bergauf[0] * t0, fuss[1] + bergauf[1] * t0];
    const p1: Punkt = [fuss[0] + bergauf[0] * t1, fuss[1] + bergauf[1] * t1];
    let scheibe = halbebene(ring, p0, bergauf);
    if (scheibe.length >= 3) scheibe = halbebene(scheibe, p1, [-bergauf[0], -bergauf[1]]);
    if (scheibe.length < 3) continue;
    stufen.push({ ring: scheibe, obenM: untenM + ((i + 1) * steigung) / anzahl });
  }

  return { stufen, steigungM: steigung, laufLaengeM: laenge, untenM, anzahl, flach: false };
}
