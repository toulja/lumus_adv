/**
 * Geometrie-Kern von EventPlan3D.
 *
 * ALLE Funktionen rechnen in der EBENE in METERN (EPSG:25832). Das ist der
 * Grund, warum intern konsequent UTM32 gefuehrt wird: Abstaende, Breiten und
 * Flaechen sind damit direkt und ohne Projektionsfehler messbar.
 *
 * Dieselbe Datei laeuft im Server (Pruefbericht, PDF) und im Browser
 * (Live-Anzeige im Editor) — beide muessen exakt dieselben Zahlen liefern.
 */

import type { BBox, Punkt, Ring } from '../domain/types.ts';

export const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Vektoren
// ---------------------------------------------------------------------------

export function add(a: Punkt, b: Punkt): Punkt {
  return [a[0] + b[0], a[1] + b[1]];
}
export function sub(a: Punkt, b: Punkt): Punkt {
  return [a[0] - b[0], a[1] - b[1]];
}
export function skal(a: Punkt, f: number): Punkt {
  return [a[0] * f, a[1] * f];
}
export function dot(a: Punkt, b: Punkt): number {
  return a[0] * b[0] + a[1] * b[1];
}
export function kreuz(a: Punkt, b: Punkt): number {
  return a[0] * b[1] - a[1] * b[0];
}
export function laenge(a: Punkt): number {
  return Math.hypot(a[0], a[1]);
}
export function norm(a: Punkt): Punkt {
  const l = laenge(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}
export function abstand(a: Punkt, b: Punkt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
/** Linkes Lot (90 Grad gegen den Uhrzeigersinn). */
export function lot(a: Punkt): Punkt {
  return [-a[1], a[0]];
}

const RAD = Math.PI / 180;

/**
 * Dreht einen lokalen Objektpunkt in die Weltlage.
 * Konvention: rotation in Grad, IM UHRZEIGERSINN, 0 = lokales +Y zeigt nach Norden,
 * lokales +X zeigt nach Osten (Kompasslogik).
 */
export function rotiere(p: Punkt, rotationGrad: number): Punkt {
  const r = rotationGrad * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

/** Kompassrichtung (0 = Nord, im Uhrzeigersinn) als Einheitsvektor in E/N. */
export function richtungsVektor(gradKompass: number): Punkt {
  const r = gradKompass * RAD;
  return [Math.sin(r), Math.cos(r)];
}

const HIMMELSRICHTUNGEN = [
  'Norden',
  'Nordosten',
  'Osten',
  'Suedosten',
  'Sueden',
  'Suedwesten',
  'Westen',
  'Nordwesten',
];

/** Benennt eine Richtung (dE, dN) als Himmelsrichtung — fuer Klartext-Empfehlungen. */
export function himmelsrichtung(dE: number, dN: number): string {
  if (Math.abs(dE) < EPS && Math.abs(dN) < EPS) return 'Norden';
  let grad = (Math.atan2(dE, dN) / RAD + 360) % 360;
  const i = Math.round(grad / 45) % 8;
  return HIMMELSRICHTUNGEN[i];
}

// ---------------------------------------------------------------------------
// Bounding-Boxen
// ---------------------------------------------------------------------------

export function bboxVonPunkten(pts: Punkt[]): BBox {
  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;
  for (const p of pts) {
    if (p[0] < minE) minE = p[0];
    if (p[1] < minN) minN = p[1];
    if (p[0] > maxE) maxE = p[0];
    if (p[1] > maxN) maxN = p[1];
  }
  return { minE, minN, maxE, maxN };
}

export function bboxErweitern(b: BBox, m: number): BBox {
  return { minE: b.minE - m, minN: b.minN - m, maxE: b.maxE + m, maxN: b.maxN + m };
}

export function bboxUeberschneidet(a: BBox, b: BBox): boolean {
  return !(a.maxE < b.minE || b.maxE < a.minE || a.maxN < b.minN || b.maxN < a.minN);
}

export function bboxEnthaelt(b: BBox, p: Punkt): boolean {
  return p[0] >= b.minE && p[0] <= b.maxE && p[1] >= b.minN && p[1] <= b.maxN;
}

export function bboxMitte(b: BBox): Punkt {
  return [(b.minE + b.maxE) / 2, (b.minN + b.maxN) / 2];
}

export function bboxRing(b: BBox): Ring {
  return [
    [b.minE, b.minN],
    [b.maxE, b.minN],
    [b.maxE, b.maxN],
    [b.minE, b.maxN],
  ];
}

/** Flaeche der Bbox in m2. */
export function bboxFlaeche(b: BBox): number {
  return Math.max(0, b.maxE - b.minE) * Math.max(0, b.maxN - b.minN);
}

// ---------------------------------------------------------------------------
// Ringe und Polygone
// ---------------------------------------------------------------------------

/** Signierte Flaeche: positiv = gegen den Uhrzeigersinn. */
export function signierteFlaeche(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return s / 2;
}

export function flaeche(ring: Ring): number {
  return Math.abs(signierteFlaeche(ring));
}

export function umfang(ring: Ring): number {
  let u = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) u += abstand(ring[j], ring[i]);
  return u;
}

export function schwerpunkt(ring: Ring): Punkt {
  const a = signierteFlaeche(ring);
  if (Math.abs(a) < EPS) {
    // Entartetes Polygon: arithmetisches Mittel
    let e = 0;
    let n = 0;
    for (const p of ring) {
      e += p[0];
      n += p[1];
    }
    return [e / ring.length, n / ring.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Punkt-in-Polygon (Ray casting, Rand zaehlt als innen). */
export function punktInRing(p: Punkt, ring: Ring): boolean {
  if (ring.length < 3) return false;
  let innen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (abstandPunktStrecke(p, a, b) < 1e-7) return true;
    const schneidet = b[1] > p[1] !== a[1] > p[1];
    if (schneidet) {
      const x = ((a[0] - b[0]) * (p[1] - b[1])) / (a[1] - b[1]) + b[0];
      if (p[0] < x) innen = !innen;
    }
  }
  return innen;
}

export function ringNormalisieren(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const l = out[out.length - 1];
    if (!l || abstand(l, p) > 1e-6) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && abstand(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

/** Erzwingt Orientierung gegen den Uhrzeigersinn (fuer Aussenringe). */
export function gegenUhrzeiger(ring: Ring): Ring {
  return signierteFlaeche(ring) < 0 ? [...ring].reverse() : ring;
}

// ---------------------------------------------------------------------------
// Strecken
// ---------------------------------------------------------------------------

export function abstandPunktStrecke(p: Punkt, a: Punkt, b: Punkt): number {
  return abstand(p, naechsterPunktAufStrecke(p, a, b));
}

export function naechsterPunktAufStrecke(p: Punkt, a: Punkt, b: Punkt): Punkt {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return [a[0], a[1]];
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

/** Schnittparameter zweier Strecken oder null. */
export function streckenSchnitt(a1: Punkt, a2: Punkt, b1: Punkt, b2: Punkt): { t: number; u: number; p: Punkt } | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const d = kreuz(r, s);
  if (Math.abs(d) < EPS) return null;
  const q = sub(b1, a1);
  const t = kreuz(q, s) / d;
  const u = kreuz(q, r) / d;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, u, p: [a1[0] + r[0] * t, a1[1] + r[1] * t] };
}

export function streckenSchneidenSich(a1: Punkt, a2: Punkt, b1: Punkt, b2: Punkt): boolean {
  return streckenSchnitt(a1, a2, b1, b2) !== null;
}

export function abstandStreckeStrecke(a1: Punkt, a2: Punkt, b1: Punkt, b2: Punkt): number {
  if (streckenSchneidenSich(a1, a2, b1, b2)) return 0;
  return Math.min(
    abstandPunktStrecke(a1, b1, b2),
    abstandPunktStrecke(a2, b1, b2),
    abstandPunktStrecke(b1, a1, a2),
    abstandPunktStrecke(b2, a1, a2),
  );
}

// ---------------------------------------------------------------------------
// Abstaende und Ueberlappung zwischen Polygonen
// ---------------------------------------------------------------------------

/** true, wenn sich die Ringe ueberlappen (Kantenschnitt oder Enthaltensein). */
export function ringeUeberlappen(a: Ring, b: Ring): boolean {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
      if (streckenSchneidenSich(a[j], a[i], b[l], b[k])) return true;
    }
  }
  return punktInRing(a[0], b) || punktInRing(b[0], a);
}

/**
 * Kleinster Abstand zweier Ringe in Metern.
 * 0, wenn sie sich beruehren oder ueberlappen.
 */
export function abstandRingRing(a: Ring, b: Ring): number {
  if (ringeUeberlappen(a, b)) return 0;
  let min = Infinity;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
      const d = abstandStreckeStrecke(a[j], a[i], b[l], b[k]);
      if (d < min) min = d;
    }
  }
  return min;
}

/** Kleinster Abstand Punkt zu Ring (0 wenn innen). */
export function abstandPunktRing(p: Punkt, ring: Ring): number {
  if (punktInRing(p, ring)) return 0;
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = abstandPunktStrecke(p, ring[j], ring[i]);
    if (d < min) min = d;
  }
  return min;
}

export function abstandPunktPolylinie(p: Punkt, linie: Punkt[]): number {
  let min = Infinity;
  for (let i = 1; i < linie.length; i++) {
    const d = abstandPunktStrecke(p, linie[i - 1], linie[i]);
    if (d < min) min = d;
  }
  return linie.length === 1 ? abstand(p, linie[0]) : min;
}

export function abstandRingPolylinie(ring: Ring, linie: Punkt[]): number {
  let min = Infinity;
  for (const p of ring) {
    const d = abstandPunktPolylinie(p, linie);
    if (d < min) min = d;
  }
  for (const p of linie) {
    const d = abstandPunktRing(p, ring);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Richtung und Betrag der kuerzesten Verschiebung, die a von b weg bewegt,
 * bis der geforderte Abstand erreicht ist. Naeherung ueber Schwerpunkte
 * plus Nachmessen — reicht fuer Handlungsempfehlungen ("0,7 m nach Norden").
 */
export function trennVerschiebung(a: Ring, b: Ring, sollAbstand: number): { dE: number; dN: number; meter: number } {
  const sa = schwerpunkt(a);
  const sb = schwerpunkt(b);
  let richtung = norm(sub(sa, sb));
  if (laenge(richtung) < EPS) richtung = [0, 1];
  // Binaere Suche auf der Verschiebungsstrecke
  let lo = 0;
  let hi = sollAbstand + abstandRingRing(a, b) + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const verschoben = a.map((p) => [p[0] + richtung[0] * mid, p[1] + richtung[1] * mid] as Punkt);
    if (abstandRingRing(verschoben, b) + 1e-6 >= sollAbstand) hi = mid;
    else lo = mid;
  }
  const m = hi;
  return { dE: richtung[0] * m, dN: richtung[1] * m, meter: m };
}

// ---------------------------------------------------------------------------
// Erzeugende Geometrie
// ---------------------------------------------------------------------------

/**
 * Grundriss eines rechteckigen Objekts.
 * laenge liegt in lokaler X-Richtung, breite in lokaler Y-Richtung.
 */
export function rechteckRing(mitte: Punkt, laengeM: number, breiteM: number, rotationGrad: number): Ring {
  const hl = laengeM / 2;
  const hb = breiteM / 2;
  const lokal: Punkt[] = [
    [-hl, -hb],
    [hl, -hb],
    [hl, hb],
    [-hl, hb],
  ];
  return lokal.map((p) => {
    const w = rotiere(p, rotationGrad);
    return [mitte[0] + w[0], mitte[1] + w[1]] as Punkt;
  });
}

export function kreisRing(mitte: Punkt, durchmesser: number, segmente = 32): Ring {
  const r = durchmesser / 2;
  const out: Ring = [];
  for (let i = 0; i < segmente; i++) {
    const a = (i / segmente) * Math.PI * 2;
    out.push([mitte[0] + Math.cos(a) * r, mitte[1] + Math.sin(a) * r]);
  }
  return out;
}

/** Vergroessert einen konvexen/einfachen Ring um m Meter nach aussen (Eckpunkt-Offset). */
export function ringPuffern(ring: Ring, m: number): Ring {
  if (m === 0) return ring;
  const s = schwerpunkt(ring);
  return ring.map((p) => {
    const r = sub(p, s);
    const l = laenge(r);
    if (l < EPS) return p;
    const f = (l + m) / l;
    return [s[0] + r[0] * f, s[1] + r[1] * f] as Punkt;
  });
}

/**
 * Wandelt eine Polylinie mit Breite in ein Flaechenpolygon (Wegkorridor).
 * Bewusst einfach gehalten: Rechteck je Segment, Rundung an den Knicken.
 * Rueckgabe ist eine LISTE von Ringen — die Vereinigung ist der Korridor.
 */
export function wegKorridor(linie: Punkt[], breite: number): Ring[] {
  const h = breite / 2;
  const ringe: Ring[] = [];
  for (let i = 1; i < linie.length; i++) {
    const a = linie[i - 1];
    const b = linie[i];
    const d = sub(b, a);
    if (laenge(d) < EPS) continue;
    const n = skal(norm(lot(d)), h);
    ringe.push([
      [a[0] + n[0], a[1] + n[1]],
      [b[0] + n[0], b[1] + n[1]],
      [b[0] - n[0], b[1] - n[1]],
      [a[0] - n[0], a[1] - n[1]],
    ]);
  }
  // Knick-Kappen, damit an Ecken kein Keil fehlt
  for (let i = 1; i < linie.length - 1; i++) ringe.push(kreisRing(linie[i], breite, 16));
  return ringe;
}

/**
 * Wandelt eine Achse mit Breite in EIN durchgehendes Band mit Gehrungsstoessen.
 *
 * Unterschied zu `wegKorridor`: dort entsteht je Segment ein Rechteck plus ein
 * Kreis an jedem Knick. Fuer die Pruefrechnung ist das richtig (die Vereinigung
 * deckt den Korridor sicher ab), fuer die DARSTELLUNG ist es falsch — die
 * Kreise lassen einen Weg in lauter Knubbel zerfallen, statt ihn als Band zu
 * zeigen. Hier wird stattdessen links und rechts je ein Randzug mit
 * Gehrungsstoessen gebildet und zu einem Ring geschlossen.
 *
 * Sehr spitze Winkel wuerden die Gehrung ins Unendliche treiben; ab der
 * Grenzlaenge wird auf einen Stumpfstoss zurueckgefallen.
 */
export function bandRing(linie: Punkt[], breite: number, gehrungsGrenze = 4): Ring | null {
  const p = ringNormalisieren(linie).length >= 2 ? entdoppeln(linie) : [];
  if (p.length < 2) return null;
  const h = breite / 2;

  const rand = (vorzeichen: number): Punkt[] => {
    const out: Punkt[] = [];
    for (let i = 0; i < p.length; i++) {
      const vor = i > 0 ? norm(sub(p[i], p[i - 1])) : null;
      const nach = i < p.length - 1 ? norm(sub(p[i + 1], p[i])) : null;
      if (!vor || !nach) {
        // Anfang und Ende: einfacher Stumpfstoss senkrecht zur Richtung
        const r = (vor ?? nach)!;
        const n = skal(norm(lot(r)), h * vorzeichen);
        out.push([p[i][0] + n[0], p[i][1] + n[1]]);
        continue;
      }
      // Gehrung: Winkelhalbierende der beiden Lote
      const n1 = norm(lot(vor));
      const n2 = norm(lot(nach));
      const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
      const cos = dot(m, n1);
      const laenge = Math.abs(cos) < 1e-6 ? gehrungsGrenze : h / cos;
      if (Math.abs(laenge) > h * gehrungsGrenze) {
        // Zu spitz — beide Kanten stumpf stossen lassen
        out.push([p[i][0] + n1[0] * h * vorzeichen, p[i][1] + n1[1] * h * vorzeichen]);
        out.push([p[i][0] + n2[0] * h * vorzeichen, p[i][1] + n2[1] * h * vorzeichen]);
      } else {
        out.push([p[i][0] + m[0] * laenge * vorzeichen, p[i][1] + m[1] * laenge * vorzeichen]);
      }
    }
    return out;
  };

  const links = rand(1);
  const rechts = rand(-1).reverse();
  const ring = ringNormalisieren([...links, ...rechts]);
  return ring.length >= 3 ? ring : null;
}

function entdoppeln(linie: Punkt[]): Punkt[] {
  const out: Punkt[] = [];
  for (const q of linie) {
    const l = out[out.length - 1];
    if (!l || abstand(l, q) > 1e-6) out.push([q[0], q[1]]);
  }
  return out;
}

export function polylinieLaenge(linie: Punkt[]): number {
  let l = 0;
  for (let i = 1; i < linie.length; i++) l += abstand(linie[i - 1], linie[i]);
  return l;
}

/** Punkt und Richtung an Wegstation s (Meter ab Anfang). */
export function aufPolylinie(linie: Punkt[], s: number): { p: Punkt; richtung: Punkt } {
  let rest = s;
  for (let i = 1; i < linie.length; i++) {
    const a = linie[i - 1];
    const b = linie[i];
    const l = abstand(a, b);
    if (l < EPS) continue;
    if (rest <= l) {
      const t = rest / l;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], richtung: norm(sub(b, a)) };
    }
    rest -= l;
  }
  const a = linie[linie.length - 2] ?? linie[0];
  const b = linie[linie.length - 1];
  return { p: [b[0], b[1]], richtung: norm(sub(b, a)) };
}

// ---------------------------------------------------------------------------
// Freie Durchgangsbreite (F4.2) — Kernalgorithmus der Engstellen-Erkennung
// ---------------------------------------------------------------------------

export interface Blockierer {
  id: string;
  art: 'objekt' | 'gebaeude' | 'blockflaeche';
  ring: Ring;
  bezeichnung: string;
}

export interface Engstelle {
  /** Station entlang der Polylinie in Metern. */
  station: number;
  /** Groesste zusammenhaengende freie Breite im Querschnitt. */
  freieBreite: number;
  /** Mitte des freien Bereichs (EPSG:25832). */
  ort: Punkt;
  /** Querschnittslinie fuer die Darstellung. */
  schnitt: [Punkt, Punkt];
  /** Wer die Engstelle verursacht. */
  verursacher: { id: string; art: Blockierer['art']; bezeichnung: string }[];
}

/**
 * Schneidet eine Strecke gegen einen Ring und liefert die INNENLIEGENDEN
 * Parameterintervalle [t0,t1] mit t in [0,1].
 */
export function streckeInRing(a: Punkt, b: Punkt, ring: Ring): [number, number][] {
  const ts: number[] = [0, 1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const s = streckenSchnitt(a, b, ring[j], ring[i]);
    if (s) ts.push(s.t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1];
    const t1 = ts[i];
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const pm: Punkt = [a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm];
    if (punktInRing(pm, ring)) {
      const letzte = out[out.length - 1];
      if (letzte && t0 - letzte[1] < 1e-9) letzte[1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}

/**
 * Ermittelt die freie Durchgangsbreite entlang eines Weges.
 * Verfahren: alle `schrittM` Meter ein Querschnitt senkrecht zur Wegachse ueber
 * die volle Soll-Breite; Objekte blockieren Intervalle; gesucht ist der
 * groesste zusammenhaengende freie Abschnitt.
 */
export function durchgangsbreiten(
  linie: Punkt[],
  breite: number,
  blockierer: Blockierer[],
  schrittM = 0.5,
): Engstelle[] {
  const gesamt = polylinieLaenge(linie);
  if (gesamt < EPS || linie.length < 2) return [];
  const h = breite / 2;
  const ergebnisse: Engstelle[] = [];
  const anzahl = Math.max(2, Math.ceil(gesamt / schrittM) + 1);

  // Vorfilter: nur Blockierer, deren Bbox den Wegkorridor beruehrt
  const korridorBbox = bboxErweitern(bboxVonPunkten(linie), h + 1);
  const kandidaten = blockierer.filter((b) => bboxUeberschneidet(bboxVonPunkten(b.ring), korridorBbox));

  for (let i = 0; i < anzahl; i++) {
    const s = Math.min(gesamt, (i * gesamt) / (anzahl - 1));
    const { p, richtung } = aufPolylinie(linie, s);
    const n = norm(lot(richtung));
    const a: Punkt = [p[0] - n[0] * h, p[1] - n[1] * h];
    const b: Punkt = [p[0] + n[0] * h, p[1] + n[1] * h];

    const belegt: { von: number; bis: number; q: Blockierer }[] = [];
    for (const k of kandidaten) {
      for (const [t0, t1] of streckeInRing(a, b, k.ring)) belegt.push({ von: t0, bis: t1, q: k });
    }
    if (belegt.length === 0) {
      ergebnisse.push({ station: s, freieBreite: breite, ort: p, schnitt: [a, b], verursacher: [] });
      continue;
    }
    belegt.sort((x, y) => x.von - y.von);
    // Groesste Luecke suchen
    let besteVon = 0;
    let besteBis = 0;
    let cursor = 0;
    const zusammen: { von: number; bis: number; q: Blockierer[] }[] = [];
    for (const b2 of belegt) {
      const letzte = zusammen[zusammen.length - 1];
      if (letzte && b2.von <= letzte.bis + 1e-9) {
        letzte.bis = Math.max(letzte.bis, b2.bis);
        letzte.q.push(b2.q);
      } else zusammen.push({ von: b2.von, bis: b2.bis, q: [b2.q] });
    }
    for (const z of zusammen) {
      if (z.von - cursor > besteBis - besteVon) {
        besteVon = cursor;
        besteBis = z.von;
      }
      cursor = Math.max(cursor, z.bis);
    }
    if (1 - cursor > besteBis - besteVon) {
      besteVon = cursor;
      besteBis = 1;
    }
    const freieBreite = Math.max(0, (besteBis - besteVon) * breite);
    const tm = (besteVon + besteBis) / 2;
    const ort: Punkt = [a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm];
    const verursacherMap = new Map<string, Blockierer>();
    for (const z of zusammen) for (const q of z.q) verursacherMap.set(q.id, q);
    ergebnisse.push({
      station: s,
      freieBreite,
      ort,
      schnitt: [a, b],
      verursacher: [...verursacherMap.values()].map((q) => ({ id: q.id, art: q.art, bezeichnung: q.bezeichnung })),
    });
  }
  return ergebnisse;
}

/** Die schmalste Stelle eines Weges. */
export function engsteStelle(engstellen: Engstelle[]): Engstelle | null {
  if (!engstellen.length) return null;
  return engstellen.reduce((a, b) => (b.freieBreite < a.freieBreite ? b : a));
}

// ---------------------------------------------------------------------------
// Hoehen-Interpolation (Gelaende aus verstreuten Stuetzpunkten)
// ---------------------------------------------------------------------------

export interface Stuetzpunkt {
  e: number;
  n: number;
  h: number;
}

/**
 * Inverse-Distance-Weighting mit Nachbarschaftsgitter.
 * Wird genutzt, um aus den amtlichen LoD2-Bodenhoehen ein Gelaendegitter zu
 * bauen, solange kein DGM1 importiert ist.
 */
export class HoehenFeld {
  private zellen = new Map<string, Stuetzpunkt[]>();
  private zellGroesse: number;
  readonly mittel: number;
  readonly min: number;
  readonly max: number;
  private leer: boolean;

  constructor(punkte: Stuetzpunkt[], zellGroesse = 100) {
    this.zellGroesse = zellGroesse;
    this.leer = punkte.length === 0;
    let summe = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (const p of punkte) {
      const k = this.schluessel(p.e, p.n);
      let liste = this.zellen.get(k);
      if (!liste) {
        liste = [];
        this.zellen.set(k, liste);
      }
      liste.push(p);
      summe += p.h;
      if (p.h < mn) mn = p.h;
      if (p.h > mx) mx = p.h;
    }
    this.mittel = punkte.length ? summe / punkte.length : 0;
    this.min = punkte.length ? mn : 0;
    this.max = punkte.length ? mx : 0;
  }

  private schluessel(e: number, n: number): string {
    return `${Math.floor(e / this.zellGroesse)}:${Math.floor(n / this.zellGroesse)}`;
  }

  hoeheBei(e: number, n: number): number {
    if (this.leer) return this.mittel;
    const cz = this.zellGroesse;
    const ce = Math.floor(e / cz);
    const cn = Math.floor(n / cz);
    let gesammelt: Stuetzpunkt[] = [];
    for (let ring = 0; ring <= 6 && gesammelt.length < 6; ring++) {
      gesammelt = [];
      for (let de = -ring; de <= ring; de++) {
        for (let dn = -ring; dn <= ring; dn++) {
          const liste = this.zellen.get(`${ce + de}:${cn + dn}`);
          if (liste) gesammelt.push(...liste);
        }
      }
    }
    if (!gesammelt.length) return this.mittel;
    gesammelt.sort((a, b) => (a.e - e) ** 2 + (a.n - n) ** 2 - ((b.e - e) ** 2 + (b.n - n) ** 2));
    const nah = gesammelt.slice(0, 8);
    let zaehler = 0;
    let nenner = 0;
    for (const p of nah) {
      const d2 = (p.e - e) ** 2 + (p.n - n) ** 2;
      if (d2 < 1e-6) return p.h;
      const w = 1 / d2;
      zaehler += w * p.h;
      nenner += w;
    }
    return nenner > 0 ? zaehler / nenner : this.mittel;
  }
}

// ---------------------------------------------------------------------------
// Formatierung (einheitlich in UI, Bericht und PDF)
// ---------------------------------------------------------------------------

export function meter(x: number, stellen = 2): string {
  return `${x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} m`;
}

export function quadratmeter(x: number, stellen = 1): string {
  return `${x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} m2`;
}

export function zahl(x: number, stellen = 2): string {
  return x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}
