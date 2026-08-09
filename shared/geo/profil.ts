/**
 * PROFIL-EXTRUSION — Querschnitt mal Achse.
 *
 * DER GEDANKE: Alles Langgestreckte im Stadtraum ist ein Querschnitt, der
 * entlang einer Achse laeuft — Gleis, Bordstein, Mauer, Rinne, Bahnsteigkante,
 * Rampe, Treppenlauf. Bisher hatte jedes dieser Bauteile seinen eigenen
 * Sondercode: das Gleisbett war ein flaches Band, die Schwelle ein flaches
 * Viereck (also ein Aufkleber), die Schiene ein 10 cm breiter Streifen ohne
 * Dicke. Kein einziges davon war ein Koerper, und keines konnte in ein anderes
 * uebergehen.
 *
 * Mit einem Extruder gibt es EIN Verfahren. Was ein Bauteil ausmacht, steht
 * dann in seinem Querschnitt — also in Daten, die man lesen, pruefen und
 * belegen kann — und nicht mehr in Programmtext.
 *
 * GEHRUNG AN KNICKEN: Der Querschnitt wird an jedem Stuetzpunkt auf der
 * Winkelhalbierenden aufgestellt, nicht senkrecht zum einzelnen Segment. Nur
 * so bleibt der Abstand zur Achse in der Kurve konstant; sonst klaffen die
 * beiden Schienen eines Gleises an jedem Knick um die halbe Segmentbreite
 * auseinander. Bei sehr spitzen Kehren wird die Gehrung begrenzt, sonst liefe
 * sie ins Unendliche.
 *
 * Diese Datei laeuft im Server UND im Browser.
 */

import type { Punkt } from '../domain/types.ts';

/** Ein Punkt des Querschnitts: quer zur Achse (q) und ueber der Bezugshoehe (z). */
export type QuerPunkt = [q: number, z: number];

export interface Querschnitt {
  bezeichnung: string;
  /**
   * Geschlossener Umriss des Werkstoffs. Erster Punkt wird NICHT wiederholt.
   * q positiv = links der Laufrichtung, z positiv = nach oben.
   */
  umriss: QuerPunkt[];
  farbe: string;
}

export interface Profil {
  id: string;
  bezeichnung: string;
  teile: Querschnitt[];
}

export interface ProfilNetz {
  bezeichnung: string;
  farbe: string;
  /** [E, N, H] je Eckpunkt, hintereinander. */
  ecken: number[];
  indizes: number[];
}

/** Zwischenpunkte einfuegen, damit der Koerper dem Gelaende folgt. */
export function verdichteAchse(achse: Punkt[], maxAbstand: number): Punkt[] {
  const out: Punkt[] = [];
  for (let i = 0; i < achse.length; i++) {
    if (i > 0) {
      const a = achse[i - 1];
      const b = achse[i];
      const teile = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxAbstand);
      for (let t = 1; t < teile; t++) {
        out.push([a[0] + ((b[0] - a[0]) * t) / teile, a[1] + ((b[1] - a[1]) * t) / teile]);
      }
    }
    out.push(achse[i]);
  }
  return out;
}

/** Doppelte Stuetzpunkte entfernen — sie machen Richtungen unbestimmt. */
function entdoppeln(achse: Punkt[]): Punkt[] {
  const out: Punkt[] = [];
  for (const p of achse) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) out.push(p);
  }
  return out;
}

/**
 * Querachsen und Gehrungsfaktoren je Stuetzpunkt.
 * `quer` zeigt nach LINKS der Laufrichtung.
 */
function rahmen(achse: Punkt[]): { quer: Punkt; streckung: number }[] {
  const out: { quer: Punkt; streckung: number }[] = [];
  for (let i = 0; i < achse.length; i++) {
    const vor = i > 0 ? richtung(achse[i - 1], achse[i]) : null;
    const nach = i < achse.length - 1 ? richtung(achse[i], achse[i + 1]) : null;
    const n1 = vor ? ([-vor[1], vor[0]] as Punkt) : null;
    const n2 = nach ? ([-nach[1], nach[0]] as Punkt) : null;
    if (!n1 || !n2) {
      out.push({ quer: (n1 ?? n2) as Punkt, streckung: 1 });
      continue;
    }
    const mx = n1[0] + n2[0];
    const my = n1[1] + n2[1];
    const l = Math.hypot(mx, my);
    if (l < 1e-9) {
      out.push({ quer: n1, streckung: 1 });
      continue;
    }
    const m: Punkt = [mx / l, my / l];
    const cos = m[0] * n1[0] + m[1] * n1[1];
    // Gehrung hoechstens vervierfachen — sonst schiesst eine Haarnadelkurve
    // den Querschnitt ins Nichts.
    const streckung = Math.min(4, Math.abs(cos) < 1e-6 ? 1 : 1 / cos);
    out.push({ quer: m, streckung });
  }
  return out;
}

function richtung(a: Punkt, b: Punkt): Punkt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/**
 * Extrudiert ein Profil entlang einer Achse.
 *
 * @param bezugsHoehe Liefert die Hoehe, auf der z = 0 liegt — in der Regel die
 *   gebaute Oberflaeche (`hoehen.bauOben`). Damit folgt der Koerper dem
 *   Gelaende UND dem Strassenaufbau, ohne dass der Querschnitt davon weiss.
 * @param stationM Abstand der Querschnitte. 2 m entspricht der Verdichtung der
 *   Bodenflaechen; groeber liefe der Koerper als Sehne unter der
 *   Gelaendekuppe hindurch.
 */
export function extrudiere(
  achse: Punkt[],
  profil: Profil,
  bezugsHoehe: (e: number, n: number) => number,
  stationM = 2,
): ProfilNetz[] {
  const punkte = entdoppeln(verdichteAchse(entdoppeln(achse), stationM));
  if (punkte.length < 2) return [];
  const rahmenListe = rahmen(punkte);
  const netze: ProfilNetz[] = [];

  for (const teil of profil.teile) {
    const n = teil.umriss.length;
    if (n < 3) continue;
    const ecken: number[] = [];
    const indizes: number[] = [];

    // Eckpunkte: je Station der ganze Umriss.
    for (let s = 0; s < punkte.length; s++) {
      const p = punkte[s];
      const { quer, streckung } = rahmenListe[s];
      const basis = bezugsHoehe(p[0], p[1]);
      for (const [q, z] of teil.umriss) {
        ecken.push(p[0] + quer[0] * q * streckung, p[1] + quer[1] * q * streckung, basis + z);
      }
    }

    // Mantel: je Stationspaar und Umrisskante ein Viereck.
    for (let s = 0; s < punkte.length - 1; s++) {
      const a = s * n;
      const b = (s + 1) * n;
      for (let j = 0; j < n; j++) {
        const j2 = (j + 1) % n;
        indizes.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
      }
    }

    // Deckel an beiden Enden — sonst sieht man in den Koerper hinein.
    const faecher = (versatz: number, umgekehrt: boolean) => {
      for (let j = 1; j < n - 1; j++) {
        if (umgekehrt) indizes.push(versatz, versatz + j + 1, versatz + j);
        else indizes.push(versatz, versatz + j, versatz + j + 1);
      }
    };
    faecher(0, true);
    faecher((punkte.length - 1) * n, false);

    netze.push({ bezeichnung: teil.bezeichnung, farbe: teil.farbe, ecken, indizes });
  }
  return netze;
}

/**
 * Setzt einen Querschnitt EINMAL an einer Stelle quer zur Richtung — fuer
 * Bauteile, die sich wiederholen statt durchzulaufen (Schwellen, Stufen).
 */
export function querKoerper(
  mitte: Punkt,
  laufrichtung: Punkt,
  umriss: QuerPunkt[],
  tiefeM: number,
  basisHoehe: number,
): { ecken: number[]; indizes: number[] } {
  const quer: Punkt = [-laufrichtung[1], laufrichtung[0]];
  const n = umriss.length;
  const ecken: number[] = [];
  const indizes: number[] = [];
  for (const seite of [-tiefeM / 2, tiefeM / 2]) {
    for (const [q, z] of umriss) {
      ecken.push(
        mitte[0] + quer[0] * q + laufrichtung[0] * seite,
        mitte[1] + quer[1] * q + laufrichtung[1] * seite,
        basisHoehe + z,
      );
    }
  }
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    indizes.push(j, n + j, n + j2, j, n + j2, j2);
  }
  for (let j = 1; j < n - 1; j++) {
    indizes.push(0, j + 1, j);
    indizes.push(n, n + j, n + j + 1);
  }
  return { ecken, indizes };
}
