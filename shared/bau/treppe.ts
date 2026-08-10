/**
 * TREPPEN — aus einer Flaeche wird ein Lauf mit Stufen.
 *
 * DER BEFUND (09.08.2026): Das Pilotgebiet fuehrt 137 Flaechen der Art
 * „Treppe". Alle 137 waren ebene, eingefaerbte Polygone. Fuer das Auge ist das
 * ein Schoenheitsfehler; fuer eine Fluchtwegrechnung ist es ein Sachfehler.
 * Eine Treppe ist genau die Stelle, an der ein Personenstrom langsamer wird,
 * an der Rollstuhl und Rettungstrage nicht durchkommen und an der eine
 * Fluchtweglaenge nicht mehr in der Ebene gemessen werden darf.
 *
 * NEUFASSUNG 10.08.2026 — was sich gegenueber der ersten Fassung aendert:
 *
 *  1. `step_count` AUS OPENSTREETMAP GEHT VOR. Wo es steht, ist es eine
 *     Zaehlung vor Ort und damit ein Beleg; die Stufenzahl wird dann NICHT
 *     mehr aus der Hoehendifferenz geschaetzt, sondern uebernommen, und das
 *     Stufenmass ergibt sich als Hoehe geteilt durch Zahl.
 *  2. STUFENMASSE WERDEN GEPRUEFT. Kein Lauf bekommt Stufen hoeher als 21 cm
 *     oder flacher als 12 cm — die Grenzen stehen in den Bauklassen
 *     (`treppe.stufe.hoeheZulaessigMinM/MaxM`) und leiten sich vom Regelbereich
 *     der DIN 18065 ab (14 bis 19 cm). Wird die Grenze gerissen, wird die
 *     Stufenzahl angepasst und das GEMELDET, statt still eine unmoegliche
 *     Treppe zu bauen.
 *  3. L-FOERMIGE TREPPEN WERDEN GETEILT. Die Laufrichtung kam aus der
 *     Haupttraegheitsachse; bei einer Treppe mit Podest zeigt die quer durch
 *     beide Laeufe und erzeugt Stufen, die es nicht gibt. Jetzt wird das
 *     BREITENPROFIL entlang der Achse gemessen: wo eine Flaeche deutlich
 *     breiter wird, liegt ein Podest, und dort wird geteilt.
 *  4. DER UMRISS WIRD EXAKT GESCHNITTEN. Sutherland-Hodgman ist nur fuer
 *     KONVEXE Umrisse richtig; bei konkaven Treppenflaechen entarten die
 *     Ergebnisse (Kanten laufen am Rand entlang, statt das Polygon zu teilen).
 *     Jetzt wird der Umriss zuerst in Dreiecke zerlegt und jedes Dreieck
 *     einzeln geschnitten — ein Dreieck IST konvex, damit ist der Schnitt
 *     exakt, und zwar fuer jeden Umriss.
 *  5. WANGEN FUER DIE GELAENDER. Der Lauf liefert seine beiden Laengsseiten
 *     mit; daraus entstehen beim Import die Gelaender (DIN 18040-3 verlangt
 *     sie beidseitig). Sie zaehlen fuer die Fluchtwegbeurteilung.
 *
 * WAS GERECHNET WIRD und was nicht: Die Lage der Flaeche ist amtlich bzw. aus
 * OpenStreetMap. Die HOEHEN kommen aus dem Gelaendemodell — an welchem Ende
 * die Treppe oben ist, wird gemessen und nicht geraten. Die STUFENMASSE sind
 * eine Annahme der Bauklassen, ausser wo `step_count` sie belegt.
 *
 * Diese Datei ist eine REINE FUNKTION ohne Zustand: Server (Gelaender,
 * Protokoll) und Browser (Stufenkoerper) rufen sie mit denselben Eingaben auf
 * und bekommen dasselbe Ergebnis. Das ist der Grund, warum es hier keine
 * zweite Wahrheit geben kann.
 */

import type { Punkt } from '../domain/types.ts';

export interface Stufe {
  /**
   * Trittflaeche als Menge KONVEXER Teilflaechen. Mehrere, weil der Schnitt
   * ueber die Dreieckszerlegung laeuft — bei einem einfachen Rechteckumriss
   * ist es genau eine.
   */
  teile: Punkt[][];
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
  /** Stufenzahl. */
  anzahl: number;
  /** Hoehe EINER Stufe (steigungM / anzahl). */
  stufenHoeheM: number;
  /** true = die Hoehendifferenz ist zu klein fuer einen Lauf (Rampe/Podest). */
  flach: boolean;
  /** Woher die Stufenzahl stammt. */
  herkunft: 'step_count' | 'abgeleitet';
  /** Die beiden Laengsseiten des Laufs — Grundlage der Gelaender. */
  wangen: [Punkt[], Punkt[]];
  /** Befunde, die gemeldet gehoeren (Stufenmass angepasst, Umriss entartet …). */
  befunde: string[];
}

export interface StufenGrenzen {
  hoeheM: number;
  hoeheZulaessigMinM?: number;
  hoeheZulaessigMaxM?: number;
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

// ---------------------------------------------------------------------------
// Exakter Schnitt: erst zerlegen, dann schneiden
// ---------------------------------------------------------------------------

/** Flaeche eines Rings (Schuhbandformel, vorzeichenbehaftet). */
function ringFlaeche(r: Punkt[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

/**
 * Zerlegt einen einfachen Umriss in Dreiecke (Ohrenschnitt).
 *
 * Warum hier und nicht im Renderer: Der SCHNITT braucht die Zerlegung, und der
 * Schnitt ist Teil des Modells (Stufenzahl und Trittflaechen gehen in die
 * Fluchtwegrechnung). Eine Zerlegung im Renderer waere eine zweite.
 */
export function zerlegeUmriss(ring: Punkt[]): Punkt[][] {
  const n = ring.length;
  if (n < 3) return [];
  const idx = ringFlaeche(ring) > 0 ? ring.map((_, i) => i) : ring.map((_, i) => n - 1 - i);
  const punkte = idx.map((i) => ring[i]);
  const uebrig = punkte.map((_, i) => i);
  const dreiecke: Punkt[][] = [];
  const kreuz = (o: Punkt, a: Punkt, b: Punkt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const imDreieck = (p: Punkt, a: Punkt, b: Punkt, c: Punkt) => {
    const d1 = kreuz(a, b, p);
    const d2 = kreuz(b, c, p);
    const d3 = kreuz(c, a, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let schutz = uebrig.length * uebrig.length + 16;
  while (uebrig.length > 3 && schutz-- > 0) {
    let geschnitten = false;
    for (let i = 0; i < uebrig.length; i++) {
      const a = punkte[uebrig[(i + uebrig.length - 1) % uebrig.length]];
      const b = punkte[uebrig[i]];
      const c = punkte[uebrig[(i + 1) % uebrig.length]];
      if (kreuz(a, b, c) <= 0) continue; // kein konvexes Ohr
      let frei = true;
      for (let j = 0; j < uebrig.length; j++) {
        const p = punkte[uebrig[j]];
        if (p === a || p === b || p === c) continue;
        if (imDreieck(p, a, b, c)) {
          frei = false;
          break;
        }
      }
      if (!frei) continue;
      dreiecke.push([a, b, c]);
      uebrig.splice(i, 1);
      geschnitten = true;
      break;
    }
    if (!geschnitten) break; // entarteter Umriss — Rest verwerfen
  }
  if (uebrig.length === 3) dreiecke.push(uebrig.map((i) => punkte[i]));
  return dreiecke;
}

/**
 * Schneidet ein KONVEXES Polygon an einer Halbebene ab (Sutherland-Hodgman).
 * Fuer ein Dreieck ist das exakt — genau darum wird vorher zerlegt.
 */
function halbebene(ring: Punkt[], punkt: Punkt, normale: Punkt): Punkt[] {
  const wert = (p: Punkt) => (p[0] - punkt[0]) * normale[0] + (p[1] - punkt[1]) * normale[1];
  const out: Punkt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const da = wert(a);
    const db = wert(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Scheibe zwischen zwei Schnitten quer zur Laufrichtung, exakt. */
function scheibe(dreiecke: Punkt[][], p0: Punkt, p1: Punkt, richtung: Punkt): Punkt[][] {
  const gegen: Punkt = [-richtung[0], -richtung[1]];
  const out: Punkt[][] = [];
  for (const d of dreiecke) {
    let teil = halbebene(d, p0, richtung);
    if (teil.length >= 3) teil = halbebene(teil, p1, gegen);
    if (teil.length >= 3 && Math.abs(ringFlaeche(teil)) > 1e-4) out.push(teil);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aufteilen L-foermiger Treppen
// ---------------------------------------------------------------------------

/**
 * Zerlegt eine Treppenflaeche an ihren PODESTEN.
 *
 * VERFAHREN: Entlang der Hauptachse wird das BREITENPROFIL gemessen (die
 * Ausdehnung quer zur Achse je Scheibe). Ein gerader Lauf hat ein nahezu
 * konstantes Profil. Ein L-Lauf mit Podest hat dort, wo das Podest liegt, ein
 * deutlich breiteres — das Podest ist quadratisch, der Lauf schmal. Wird das
 * Maximum deutlich groesser als der Median, liegt dort ein Podest, und die
 * Flaeche wird davor und dahinter getrennt weiterverarbeitet.
 *
 * Rueckgabe sind die Teil-Umrisse; ein gerader Lauf liefert genau einen.
 */
export function teileAnPodesten(ring: Punkt[], mindestBreiteFaktor = 1.6): Punkt[][] {
  const { richtung, mitte } = hauptachse(ring);
  const quer: Punkt = [-richtung[1], richtung[0]];
  let min = Infinity;
  let max = -Infinity;
  for (const p of ring) {
    const t = (p[0] - mitte[0]) * richtung[0] + (p[1] - mitte[1]) * richtung[1];
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const laenge = max - min;
  if (laenge < 3) return [ring];
  const dreiecke = zerlegeUmriss(ring);
  if (!dreiecke.length) return [ring];

  const scheiben = Math.max(6, Math.min(40, Math.round(laenge / 1.0)));
  const breiten: number[] = [];
  for (let i = 0; i < scheiben; i++) {
    const t0 = min + (laenge * i) / scheiben;
    const t1 = min + (laenge * (i + 1)) / scheiben;
    const p0: Punkt = [mitte[0] + richtung[0] * t0, mitte[1] + richtung[1] * t0];
    const p1: Punkt = [mitte[0] + richtung[0] * t1, mitte[1] + richtung[1] * t1];
    const teile = scheibe(dreiecke, p0, p1, richtung);
    let qmin = Infinity;
    let qmax = -Infinity;
    for (const teil of teile) {
      for (const p of teil) {
        const q = (p[0] - mitte[0]) * quer[0] + (p[1] - mitte[1]) * quer[1];
        if (q < qmin) qmin = q;
        if (q > qmax) qmax = q;
      }
    }
    breiten.push(Number.isFinite(qmin) ? qmax - qmin : 0);
  }
  const sortiert = [...breiten].filter((b) => b > 0).sort((a, b) => a - b);
  if (sortiert.length < 4) return [ring];
  const median = sortiert[Math.floor(sortiert.length / 2)];
  let breitesteI = -1;
  let breiteste = 0;
  for (let i = 1; i < breiten.length - 1; i++) {
    if (breiten[i] > breiteste) {
      breiteste = breiten[i];
      breitesteI = i;
    }
  }
  if (breitesteI < 0 || breiteste < median * mindestBreiteFaktor) return [ring];

  // Teilen: alles vor und alles hinter dem Podest.
  const tPodest0 = min + (laenge * breitesteI) / scheiben;
  const tPodest1 = min + (laenge * (breitesteI + 1)) / scheiben;
  const schnittPunkt = (t: number): Punkt => [mitte[0] + richtung[0] * t, mitte[1] + richtung[1] * t];
  const gegen: Punkt = [-richtung[0], -richtung[1]];
  const vorne = dreiecke.flatMap((d) => {
    const teil = halbebene(d, schnittPunkt(tPodest0), gegen);
    return teil.length >= 3 ? [teil] : [];
  });
  const hinten = dreiecke.flatMap((d) => {
    const teil = halbebene(d, schnittPunkt(tPodest1), richtung);
    return teil.length >= 3 ? [teil] : [];
  });
  const flaecheVon = (t: Punkt[][]) => t.reduce((s, x) => s + Math.abs(ringFlaeche(x)), 0);
  // Beide Teile muessen substanziell sein, sonst war es kein Podest.
  if (flaecheVon(vorne) < 2 || flaecheVon(hinten) < 2) return [ring];
  return [huelle(vorne), huelle(hinten)];
}

/** Konvexe Huelle einer Dreiecksmenge — der Ersatzumriss eines Teillaufs. */
function huelle(teile: Punkt[][]): Punkt[] {
  const punkte = teile.flat();
  if (punkte.length < 3) return punkte;
  const sortiert = [...punkte].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const kreuz = (o: Punkt, a: Punkt, b: Punkt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bauen = (liste: Punkt[]) => {
    const s: Punkt[] = [];
    for (const p of liste) {
      while (s.length >= 2 && kreuz(s[s.length - 2], s[s.length - 1], p) <= 0) s.pop();
      s.push(p);
    }
    s.pop();
    return s;
  };
  return [...bauen(sortiert), ...bauen([...sortiert].reverse())];
}

// ---------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------

/**
 * Baut den Treppenlauf EINER (Teil-)Flaeche.
 *
 * @param hoeheAn Gelaendehoehe an einer Stelle — die MESSUNG, aus der sich
 *   ergibt, wo oben und unten ist.
 * @param grenzen Stufenmass und zulaessige Spanne aus den Bauklassen.
 * @param stufenzahlBeleg `step_count` aus OpenStreetMap. Wo es steht, GILT es.
 * @param mindestSteigungM Darunter gilt die Flaeche als Podest oder Rampe.
 */
export function treppenlauf(
  ring: Punkt[],
  hoeheAn: (e: number, n: number) => number,
  grenzen: StufenGrenzen = { hoeheM: 0.17 },
  stufenzahlBeleg?: number,
  mindestSteigungM = 0.3,
): Treppenlauf {
  const befunde: string[] = [];
  const { richtung, mitte } = hauptachse(ring);
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
  const bergauf: Punkt = hB >= hA ? richtung : [-richtung[0], -richtung[1]];
  const fuss: Punkt = hB >= hA ? endeA : endeB;
  const quer: Punkt = [-bergauf[1], bergauf[0]];

  const leer: Treppenlauf = {
    stufen: [],
    steigungM: steigung,
    laufLaengeM: laenge,
    untenM,
    anzahl: 0,
    stufenHoeheM: 0,
    flach: true,
    herkunft: 'abgeleitet',
    wangen: [[], []],
    befunde,
  };
  if (!(steigung >= mindestSteigungM) || laenge < 0.5) return leer;

  // --- Stufenzahl: Beleg schlaegt Ableitung --------------------------------
  const minH = grenzen.hoeheZulaessigMinM ?? 0.12;
  const maxH = grenzen.hoeheZulaessigMaxM ?? 0.21;
  let anzahl: number;
  let herkunft: Treppenlauf['herkunft'];
  if (stufenzahlBeleg !== undefined && Number.isFinite(stufenzahlBeleg) && stufenzahlBeleg >= 1) {
    anzahl = Math.round(stufenzahlBeleg);
    herkunft = 'step_count';
    const h = steigung / anzahl;
    if (h < minH || h > maxH) {
      befunde.push(
        `step_count = ${anzahl} ergibt bei ${steigung.toFixed(2)} m Steigung ${(h * 100).toFixed(1)} cm je Stufe — ` +
          `ausserhalb von ${(minH * 100).toFixed(0)}–${(maxH * 100).toFixed(0)} cm. Die ZAEHLUNG bleibt stehen, ` +
          `die Hoehendifferenz aus dem Gelaendemodell ist hier vermutlich falsch.`,
      );
    }
  } else {
    anzahl = Math.max(1, Math.round(steigung / grenzen.hoeheM));
    herkunft = 'abgeleitet';
    // Zulaessige Spanne erzwingen — eine 40-cm-Stufe gibt es nicht.
    const nMin = Math.ceil(steigung / maxH);
    const nMax = Math.max(1, Math.floor(steigung / minH));
    const korrigiert = Math.min(Math.max(anzahl, nMin), Math.max(nMin, nMax));
    if (korrigiert !== anzahl) {
      befunde.push(
        `Stufenzahl von ${anzahl} auf ${korrigiert} angepasst: ${(steigung / anzahl * 100).toFixed(1)} cm je Stufe lagen ` +
          `ausserhalb von ${(minH * 100).toFixed(0)}–${(maxH * 100).toFixed(0)} cm.`,
      );
      anzahl = korrigiert;
    }
  }
  const stufenHoehe = steigung / anzahl;

  // --- Trittflaechen exakt schneiden ---------------------------------------
  const dreiecke = zerlegeUmriss(ring);
  if (!dreiecke.length) {
    befunde.push('Umriss liess sich nicht zerlegen (entartet) — keine Stufen gebaut.');
    return { ...leer, befunde };
  }
  const stufenTiefe = laenge / anzahl;
  const stufen: Stufe[] = [];
  for (let i = 0; i < anzahl; i++) {
    const p0: Punkt = [fuss[0] + bergauf[0] * i * stufenTiefe, fuss[1] + bergauf[1] * i * stufenTiefe];
    const p1: Punkt = [fuss[0] + bergauf[0] * (i + 1) * stufenTiefe, fuss[1] + bergauf[1] * (i + 1) * stufenTiefe];
    const teile = scheibe(dreiecke, p0, p1, bergauf);
    if (!teile.length) continue;
    stufen.push({ teile, obenM: untenM + ((i + 1) * steigung) / anzahl });
  }

  // --- Wangen: die beiden Laengsseiten (Grundlage der Gelaender) -----------
  let qmin = Infinity;
  let qmax = -Infinity;
  for (const p of ring) {
    const q = (p[0] - fuss[0]) * quer[0] + (p[1] - fuss[1]) * quer[1];
    if (q < qmin) qmin = q;
    if (q > qmax) qmax = q;
  }
  const wange = (q: number): Punkt[] => {
    const out: Punkt[] = [];
    const schritte = Math.max(2, anzahl);
    for (let i = 0; i <= schritte; i++) {
      const t = (laenge * i) / schritte;
      out.push([fuss[0] + bergauf[0] * t + quer[0] * q, fuss[1] + bergauf[1] * t + quer[1] * q]);
    }
    return out;
  };

  return {
    stufen,
    steigungM: steigung,
    laufLaengeM: laenge,
    untenM,
    anzahl,
    stufenHoeheM: stufenHoehe,
    flach: false,
    herkunft,
    wangen: [wange(qmin), wange(qmax)],
    befunde,
  };
}
