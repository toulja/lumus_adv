/**
 * Eingabepruefung fuer alle schreibenden Routen.
 *
 * Hintergrund (Sicherheitspruefung 07.08.2026): Die PATCH-Routen haben
 * Geometriefelder frueher ungeprueft uebernommen. Ein `position: {"a":1}` oder
 * eine Polylinie mit Textkoordinaten landete so in der Projektdatei und legte
 * anschliessend JEDEN Bericht lahm ("unsupported number: NaN") — die Beschaedigung
 * war dauerhaft, weil sie mitgespeichert wurde. Darum gilt: Geometrie wird an
 * der Routengrenze geprueft, nicht erst in der Regel-Engine.
 *
 * Die Grenzen sind bewusst grosszuegig — sie sollen Unsinn abfangen, nicht
 * legitime Planung einschraenken.
 */

import type { Punkt } from '../../shared/domain/types.ts';

/** Zulaessiger Zahlenbereich fuer EPSG:25832-Koordinaten (weit gefasst). */
const KOORD_MAX = 10_000_000;

/**
 * Obergrenze fuer Stuetzpunkte je Weg/Flaeche. Ein Festgelaende braucht
 * einige Dutzend; 5000 laesst jede realistische Planung zu, verhindert aber,
 * dass eine 7-MB-Polylinie dauerhaft in der Projektdatei landet und jede
 * spaetere Pruefung und PDF-Erzeugung ausbremst.
 */
export const MAX_STUETZPUNKTE = 5000;

/** Obergrenze fuer Laengenangaben in Metern (Breite, lichte Hoehe). */
const MAX_METER = 10_000;

export class EingabeFehler extends Error {}

function istZahl(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w);
}

/** Prueft einen einzelnen Punkt [E, N]. Wirft EingabeFehler mit Klartext. */
export function pruefePunkt(wert: unknown, feld: string): Punkt {
  if (!Array.isArray(wert) || wert.length !== 2) {
    throw new EingabeFehler(`${feld}: Es werden genau zwei Koordinaten [E, N] in EPSG:25832 erwartet.`);
  }
  const [e, n] = wert as unknown[];
  if (!istZahl(e) || !istZahl(n)) {
    throw new EingabeFehler(`${feld}: Die Koordinaten muessen Zahlen sein.`);
  }
  if (Math.abs(e) > KOORD_MAX || Math.abs(n) > KOORD_MAX) {
    throw new EingabeFehler(`${feld}: Die Koordinaten liegen ausserhalb des zulaessigen Bereichs.`);
  }
  return [e, n];
}

/** Prueft eine Punktfolge (Polylinie oder Polygonring). */
export function pruefePunktfolge(wert: unknown, feld: string, minPunkte: number): Punkt[] {
  if (!Array.isArray(wert)) {
    throw new EingabeFehler(`${feld}: Es wird eine Liste von Punkten erwartet.`);
  }
  if (wert.length < minPunkte) {
    throw new EingabeFehler(`${feld}: Es werden mindestens ${minPunkte} Punkte benoetigt.`);
  }
  if (wert.length > MAX_STUETZPUNKTE) {
    throw new EingabeFehler(`${feld}: Hoechstens ${MAX_STUETZPUNKTE} Stuetzpunkte sind zulaessig (${wert.length} uebergeben).`);
  }
  return wert.map((p, i) => pruefePunkt(p, `${feld}[${i}]`));
}

/** Prueft eine positive Laengenangabe in Metern. */
export function pruefeMeter(wert: unknown, feld: string): number {
  const z = typeof wert === 'string' ? Number(wert) : wert;
  if (!istZahl(z) || z <= 0) {
    throw new EingabeFehler(`${feld}: Bitte einen Wert groesser als 0 in Metern angeben.`);
  }
  if (z > MAX_METER) {
    throw new EingabeFehler(`${feld}: Der Wert ist unrealistisch gross (hoechstens ${MAX_METER} m).`);
  }
  return z;
}

/** Prueft einen Drehwinkel und normiert ihn auf 0..360 Grad. */
export function pruefeWinkel(wert: unknown, feld: string): number {
  const z = typeof wert === 'string' ? Number(wert) : wert;
  if (!istZahl(z)) throw new EingabeFehler(`${feld}: Der Drehwinkel muss eine Zahl in Grad sein.`);
  return ((z % 360) + 360) % 360;
}

/**
 * Wendet die Pruefungen auf die Geometriefelder eines Patch-Objekts an und
 * ersetzt sie durch die geprueften Werte. Nur vorhandene Felder werden
 * angefasst — ein Patch bleibt ein Patch.
 */
export function pruefeGeometriePatch(patch: Record<string, unknown>): void {
  if ('position' in patch) patch.position = pruefePunkt(patch.position, 'position');
  if ('punkt' in patch && patch.punkt !== undefined && patch.punkt !== null) {
    patch.punkt = pruefePunkt(patch.punkt, 'punkt');
  }
  if ('rotation' in patch) patch.rotation = pruefeWinkel(patch.rotation, 'rotation');
  if ('polylinie' in patch) patch.polylinie = pruefePunktfolge(patch.polylinie, 'polylinie', 2);
  if ('polygon' in patch && patch.polygon !== undefined && patch.polygon !== null) {
    patch.polygon = pruefePunktfolge(patch.polygon, 'polygon', 3);
  }
  if ('breite' in patch) patch.breite = pruefeMeter(patch.breite, 'breite');
  if ('lichteHoehe' in patch && patch.lichteHoehe !== undefined && patch.lichteHoehe !== null) {
    patch.lichteHoehe = pruefeMeter(patch.lichteHoehe, 'lichteHoehe');
  }
  if ('hoeheUeberGelaende' in patch && patch.hoeheUeberGelaende !== undefined && patch.hoeheUeberGelaende !== null) {
    const z = Number(patch.hoeheUeberGelaende);
    if (!istZahl(z) || Math.abs(z) > MAX_METER) {
      throw new EingabeFehler('hoeheUeberGelaende: Bitte eine Hoehe in Metern angeben.');
    }
    patch.hoeheUeberGelaende = z;
  }
}
