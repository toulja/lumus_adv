/**
 * BAUHOEHE — „wie hoch ist die gebaute Oberflaeche an dieser Stelle?"
 *
 * Das Gelaende (DGM) sagt, wo der gewachsene Boden liegt. Darauf liegt der
 * Aufbau des Strassenraums: die Fahrbahn auf 0,00 m, der Gehweg 12 cm darueber,
 * ein Bahnsteig 24 cm. Diese Klasse beantwortet die Frage nach der SUMME aus
 * beidem — und zwar fuer alles gleich.
 *
 * WARUM SIE ES FUER ALLES TUN MUSS: Bis zum 09.08.2026 hatte jede Bauteilgruppe
 * ihren eigenen Nullpunkt. Die Bodenzeichnung stapelte sich in 2-mm-Stufen
 * (0,020-0,092 m), die Verkehrskoerper sassen pauschal 0,100 m ueber dem
 * Gelaende, die Planobjekte auf 0,300 m. Diese Zahlen waren gegeneinander
 * kalibriert — und genau deshalb zerbrach die Ordnung, sobald eine davon sich
 * aenderte. Mit echten Konstruktionshoehen gibt es nur noch EINE Bezugsflaeche:
 * die gebaute Oberflaeche. Eine Laterne steht auf dem Gehweg, nicht 10 cm ueber
 * dem Gelaende; und wenn der Gehweg 12 cm hoch ist, steht sie eben 12 cm hoeher.
 *
 * Laeuft im Server UND im Browser (kein Cesium, keine Node-Module).
 */

import type { GelaendeFlaeche, Punkt } from '../domain/types.ts';
import { bboxVonPunkten, punktInRing } from './geometry.ts';

export class Bauhoehe {
  private zellen = new Map<string, number[]>();
  private flaechen: GelaendeFlaeche[];
  private bboxen: { minE: number; minN: number; maxE: number; maxN: number }[];
  private zellM: number;

  /**
   * @param flaechen Bodenflaechen mit `konstruktionM` (aus dem Import).
   *   Flaechen ohne den Wert zaehlen als 0 — sie liegen auf dem Gelaende.
   */
  constructor(flaechen: GelaendeFlaeche[] | undefined, zellM = 25) {
    this.flaechen = (flaechen ?? []).filter((f) => (f.konstruktionM ?? 0) !== 0);
    this.zellM = zellM;
    this.bboxen = this.flaechen.map((f) => bboxVonPunkten(f.polygon));
    for (let i = 0; i < this.flaechen.length; i++) {
      const b = this.bboxen[i];
      for (let e = Math.floor(b.minE / zellM); e <= Math.floor(b.maxE / zellM); e++) {
        for (let n = Math.floor(b.minN / zellM); n <= Math.floor(b.maxN / zellM); n++) {
          const s = `${e}:${n}`;
          const liste = this.zellen.get(s);
          if (liste) liste.push(i);
          else this.zellen.set(s, [i]);
        }
      }
    }
  }

  /** Hat dieses Gelaende ueberhaupt Konstruktionshoehen? */
  get vorhanden(): boolean {
    return this.flaechen.length > 0;
  }

  /**
   * Aufbauhoehe ueber dem Gelaende an dieser Stelle, in Metern.
   *
   * Nur Flaechen mit einem Wert ungleich 0 sind ueberhaupt im Index — an allen
   * uebrigen Stellen (Fahrbahn, Gruen, Bebauung) ist die Antwort 0, und das
   * ist die richtige Antwort, nicht ein fehlender Wert.
   */
  ueberGrund(e: number, n: number): number {
    const liste = this.zellen.get(`${Math.floor(e / this.zellM)}:${Math.floor(n / this.zellM)}`);
    if (!liste) return 0;
    const p: Punkt = [e, n];
    // Bei Ueberdeckung gewinnt die HOECHSTE Flaeche. Die Aufteilung ist zwar
    // ueberschneidungsfrei, aber genau auf einer gemeinsamen Kante treffen
    // beide zu — dort ist die obere Antwort die sichere: ein Koerper, der auf
    // der Kante steht, soll auf dem Bordstein stehen und nicht in ihm.
    let best = 0;
    for (const i of liste) {
      const b = this.bboxen[i];
      if (e < b.minE || e > b.maxE || n < b.minN || n > b.maxN) continue;
      const f = this.flaechen[i];
      const h = f.konstruktionM ?? 0;
      if (h <= best) continue;
      if (!punktInRing(p, f.polygon)) continue;
      if ((f.loecher ?? []).some((l) => punktInRing(p, l))) continue;
      best = h;
    }
    return best;
  }
}
