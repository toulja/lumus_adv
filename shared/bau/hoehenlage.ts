/**
 * DIE HOEHE EINES BAUWERKS AN EINER STELLE — eine Formel, zwei Verbraucher.
 *
 * Server und Browser stellen dieselbe Frage: „Wie hoch liegt diese Flaeche bei
 * (E, N)?" Bis zum 10.08.2026 beantworteten sie sie an zwei Stellen — der
 * Import rechnete die Rampensohle, der Renderer las eine Ebene aus dem
 * Ergebnis. Solange beide dieselbe Ebene meinten, ging das gut; es waren
 * trotzdem zwei Stellen, an denen sich etwas aendern konnte.
 *
 * Darum steht die Formel hier — in `shared/`, wo beide sie holen.
 *
 * WOHER DIE EBENE KOMMT: Bei einer Bruecke ist sie die Verbindung der beiden
 * Widerlager, bei einer Rampe die Ausgleichsebene durch die gemessenen
 * Sohlenpunkte des Strangs (server/geodata/hoehenband.ts). Fehlt sie, folgt
 * die Flaeche dem Gelaende — das ist die Antwort des Aufrufers, nicht diese.
 */

import type { Hoehenband } from '../domain/types.ts';

/**
 * Hoehe der Flaechenoberkante aus dem Hoehenband — oder `null`, wenn das
 * Hoehenband dazu nichts sagt und die Flaeche dem Gelaende folgen muss.
 */
export function hoeheImHoehenband(lage: Hoehenband | undefined, e: number, n: number): number | null {
  const eb = lage?.hoehenEbene;
  if (!eb) return null;
  return eb.a * (e - eb.e0) + eb.b * (n - eb.n0) + eb.c;
}
