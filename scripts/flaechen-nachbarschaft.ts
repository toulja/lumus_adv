/**
 * NACHBARSCHAFT DER FLAECHENKLASSEN — gemessen, nicht angenommen.
 *
 * WOZU: Die Lesbarkeitsregel der Basiskarte lautet „zwischen benachbarten
 * Flaechenklassen mindestens DL* 9". „Benachbart" ist dabei KEINE Eigenschaft
 * der Farbleiter, sondern eine des Bestandes: Es zaehlt, welche Klassen im
 * Gebiet wirklich aneinanderstossen — und mit wie viel gemeinsamer Kante.
 * Zwei Klassen, die sich nie beruehren, duerfen dieselbe Helligkeit tragen;
 * zwei, die sich ueber Kilometer beruehren, muessen weit auseinander.
 *
 * Ohne diese Messung waere die Leiter geraten. Mit ihr ist sie gerechnet.
 *
 * Verfahren (dasselbe wie bei der Kantenableitung in server/geodata/bauwerk.ts,
 * damit beide dieselbe Nachbarschaft sehen): Jede Ringkante einer Flaeche wird
 * beidseitig um SEITE_M versetzt abgetastet; die Flaeche auf der Gegenseite ist
 * der Nachbar. Die Segmentlaenge wird dem Klassenpaar gutgeschrieben.
 *
 * Aufruf:
 *   node scripts/flaechen-nachbarschaft.ts [gelaendeId]
 * Ohne Angabe wird das zuletzt geaenderte Gelaende genommen.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GelaendeFlaeche, Punkt } from '../shared/domain/types.ts';
import { bboxVonPunkten, punktInRing } from '../shared/geo/geometry.ts';

/** Abstand, in dem beiderseits einer Kante nach dem Nachbarn gesucht wird. */
const SEITE_M = 0.4;
/** Kuerzere Randstuecke sind Rundungsartefakte der Vereinigung. */
const MIN_SEGMENT_M = 0.3;

/**
 * ZEICHENKLASSE einer Flaeche — nicht ihre Flaechenart.
 *
 * Der Unterschied ist genau die aufgeloeste Doppelbelegung: ALKIS
 * „Strassenverkehr" und OSM „Fahrbahn" tragen beide die Art `fahrbahn`, sind
 * aber zwei verschiedene Toene (Platte und Decker). Fuer die Farbleiter zaehlt
 * die Zeichenklasse.
 */
function klasse(f: GelaendeFlaeche): string {
  return f.art === 'fahrbahn' && f.quelle === 'alkis' ? 'platte' : f.art;
}

class FlaechenIndex {
  private zellen = new Map<string, number[]>();
  private bboxen: { minE: number; minN: number; maxE: number; maxN: number }[];
  private flaechen: GelaendeFlaeche[];
  private zellM: number;
  // Keine Parameter-Properties: Node fuehrt TypeScript nur „strip-only" aus
  // (ARCHITEKTUR.md 2.3), und dabei gibt es sie nicht.
  constructor(flaechen: GelaendeFlaeche[], zellM = 25) {
    this.flaechen = flaechen;
    this.zellM = zellM;
    this.bboxen = flaechen.map((f) => bboxVonPunkten(f.polygon));
    for (let i = 0; i < flaechen.length; i++) {
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
  bei(p: Punkt, ausser = -1): number {
    const liste = this.zellen.get(`${Math.floor(p[0] / this.zellM)}:${Math.floor(p[1] / this.zellM)}`);
    if (!liste) return -1;
    for (const i of liste) {
      if (i === ausser) continue;
      const b = this.bboxen[i];
      if (p[0] < b.minE || p[0] > b.maxE || p[1] < b.minN || p[1] > b.maxN) continue;
      const f = this.flaechen[i];
      if (!punktInRing(p, f.polygon)) continue;
      if ((f.loecher ?? []).some((h) => punktInRing(p, h))) continue;
      return i;
    }
    return -1;
  }
}

export interface NachbarschaftsErgebnis {
  /** Gemeinsame Kantenlaenge je Klassenpaar, Schluessel „a|b" alphabetisch. */
  paare: Map<string, number>;
  /** Gesamtlaenge aller Klassengrenzen. */
  gesamtM: number;
  /** Flaechensumme je Klasse (m2) — sagt, wie gross eine Klasse im Bild ist. */
  flaecheJeKlasse: Map<string, number>;
  klassen: string[];
}

export function nachbarschaftMessen(flaechen: GelaendeFlaeche[]): NachbarschaftsErgebnis {
  const index = new FlaechenIndex(flaechen);
  const paare = new Map<string, number>();
  const flaecheJeKlasse = new Map<string, number>();
  let gesamt = 0;

  for (let ai = 0; ai < flaechen.length; ai++) {
    const A = flaechen[ai];
    if (A.polygon.length < 3) continue;
    const kA = klasse(A);
    // Flaechensumme (Schuhbandformel, Loecher abgezogen)
    const ringFlaeche = (r: Punkt[]) => {
      let s = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
      return Math.abs(s) / 2;
    };
    flaecheJeKlasse.set(
      kA,
      (flaecheJeKlasse.get(kA) ?? 0) + ringFlaeche(A.polygon) - (A.loecher ?? []).reduce((s, l) => s + ringFlaeche(l), 0),
    );

    for (const ring of [A.polygon, ...(A.loecher ?? [])]) {
      if (ring.length < 3) continue;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const laenge = Math.hypot(dx, dy);
        if (laenge < MIN_SEGMENT_M) continue;
        const lx = -dy / laenge;
        const ly = dx / laenge;
        const m: Punkt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const links: Punkt = [m[0] + lx * SEITE_M, m[1] + ly * SEITE_M];
        const rechts: Punkt = [m[0] - lx * SEITE_M, m[1] - ly * SEITE_M];
        const iLinks = index.bei(links);
        const aLinks = iLinks === ai;
        const nachbarIdx = aLinks ? index.bei(rechts, ai) : iLinks;
        if (nachbarIdx < 0) continue;
        const kB = klasse(flaechen[nachbarIdx]);
        if (kB === kA) continue;
        // Jede Kante wird von BEIDEN Flaechen gefunden — darum halbieren.
        const schluessel = [kA, kB].sort().join('|');
        paare.set(schluessel, (paare.get(schluessel) ?? 0) + laenge / 2);
        gesamt += laenge / 2;
      }
    }
  }
  return { paare, gesamtM: gesamt, flaecheJeKlasse, klassen: [...flaecheJeKlasse.keys()].sort() };
}

// ---------------------------------------------------------------------------
// Aufruf von der Kommandozeile
// ---------------------------------------------------------------------------

function neuestesGelaende(wurzel: string): string {
  const ordner = fs
    .readdirSync(wurzel)
    .filter((n) => n.startsWith('gel_') && fs.existsSync(path.join(wurzel, n, 'gelaende.json')))
    .map((n) => ({ n, t: fs.statSync(path.join(wurzel, n, 'gelaende.json')).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!ordner.length) throw new Error(`Kein Gelaende unter ${wurzel}`);
  return ordner[0].n;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('flaechen-nachbarschaft.ts')) {
  const wurzel = path.resolve(process.cwd(), 'data', 'gelaende');
  const gid = process.argv[2] ?? neuestesGelaende(wurzel);
  const datei = path.join(wurzel, gid, 'gelaende.json');
  const g = JSON.parse(fs.readFileSync(datei, 'utf8')) as { name: string; flaechen: GelaendeFlaeche[] };
  const erg = nachbarschaftMessen(g.flaechen);

  console.log(`Gelaende ${gid} — „${g.name}", ${g.flaechen.length} Flaechen`);
  console.log(`Klassengrenzen gesamt: ${erg.gesamtM.toFixed(0)} m\n`);

  console.log('Flaechenanteil je Klasse:');
  const gesamtFlaeche = [...erg.flaecheJeKlasse.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...erg.flaecheJeKlasse.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${(v / 1000).toFixed(1).padStart(8)} Tm2  ${((100 * v) / gesamtFlaeche).toFixed(1).padStart(5)} %`);
  }

  console.log('\nGemeinsame Klassengrenze (absteigend):');
  const sortiert = [...erg.paare.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sortiert) {
    const anteil = (100 * v) / erg.gesamtM;
    console.log(`  ${k.padEnd(30)} ${v.toFixed(0).padStart(7)} m  ${anteil.toFixed(2).padStart(6)} %`);
  }

  // Maschinenlesbar fuer die Palettenrechnung
  const ausgabe = {
    gelaende: gid,
    name: g.name,
    gemessenAm: new Date().toISOString().slice(0, 10),
    gesamtM: Math.round(erg.gesamtM),
    klassen: erg.klassen,
    flaecheJeKlasseM2: Object.fromEntries([...erg.flaecheJeKlasse].map(([k, v]) => [k, Math.round(v)])),
    paareM: Object.fromEntries(sortiert.map(([k, v]) => [k, Math.round(v)])),
  };
  const ziel = path.resolve(process.cwd(), 'data', 'abnahme', 'flaechen-nachbarschaft.json');
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, JSON.stringify(ausgabe, null, 2));
  console.log(`\nGeschrieben: ${path.relative(process.cwd(), ziel)}`);
}
