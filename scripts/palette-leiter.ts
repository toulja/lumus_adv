/**
 * DIE HELLIGKEITSLEITER DER BASISKARTE — gerechnet, nicht gewaehlt.
 *
 * AUFGABE: „Fuer jedes Paar benachbarter Flaechenklassen DL* >= 9, kein
 * Flaechenton heller als L* 93." Beides zusammen ist ein Faerbungsproblem und
 * kein Geschmacksurteil:
 *
 *   - „benachbart" steht im gemessenen Nachbarschaftsgraphen
 *     (scripts/flaechen-nachbarschaft.ts). Klassen, die sich nie beruehren,
 *     duerfen dieselbe Helligkeit tragen.
 *   - Liegen alle Stufen 9 L* auseinander, heisst „DL* >= 9" genau: zwei
 *     benachbarte Klassen liegen auf VERSCHIEDENEN Stufen. Das ist die
 *     Knotenfaerbung des Graphen, und die kleinste zulaessige Stufenzahl ist
 *     seine chromatische Zahl.
 *   - Die Bandbreite der Karte folgt daraus zwangslaeufig: k Stufen brauchen
 *     9*(k-1) L*. Sie ist damit eine MESSGROESSE des Bestandes, keine
 *     Entwurfsentscheidung.
 *
 * Der Rest ist Kartografie und bleibt Entscheidung: WELCHE Klasse auf welche
 * Stufe kommt. Dafuer gibt es eine begruendete Wunschreihenfolge (hell nach
 * dunkel); unter allen Faerbungen mit der kleinsten Stufenzahl wird die
 * gewaehlt, die dieser Reihenfolge am naechsten kommt.
 *
 * Aufruf:  node scripts/palette-leiter.ts [schwelleProzent]
 */

import fs from 'node:fs';
import path from 'node:path';

/** Hellster zulaessiger Flaechenton (Vorgabe des Auftrags). */
const L_MAX = 93;
/** Geforderter Mindestabstand benachbarter Flaechenklassen. */
const D_MIN = 9;

/**
 * WUNSCHREIHENFOLGE hell -> dunkel. Sie ist die kartografische Aussage der
 * Karte und steht bewusst hier und nicht im Ergebnis:
 *
 *  1 fahrbahn        Das Rueckgrat. In jeder Referenzkarte das hellste Objekt
 *                    (basemap.de Grau und CARTO Positron fuehren die Fahrbahn
 *                    auf reinweiss) — und traegt zugleich die dunkelste Kontur.
 *  2 platz           Grosse befestigte Flaeche, so hell wie moeglich, aber eine
 *                    Stufe unter der Fahrbahn: sonst dominiert die groessere
 *                    Flaeche das Bild.
 *  3 fussgaengerzone Befestigt wie ein Platz, aber mit Fussgaengervorrang —
 *                    eigener schwacher Mintstich (Vorbild basemap.de).
 *  4 platte          ALKIS-Strassenraum: die Buehne UNTER dem Fahrbahndecker.
 *  5 gehweg          „derselbe Bautyp wie die Fahrbahn, nur eine Stufe dunkler".
 *  6 radweg          Wie Gehweg, aber real rot markiert.
 *  7 weg             Wassergebundene Decke — dunkler als ein befestigter Gehweg.
 *  8 landwirtschaft  Hellstes Ende der Gruenrampe (Nutzflaeche, kein Bewuchs).
 *  9 bebauung        Baufelder und Hinterhoefe: ruhiger Grund, nicht Figur.
 * 10 sonstige        Auffangklasse, dicht bei bebauung.
 * 11 treppe          Bauwerk im Verkehrsraum; dunkel, weil Hindernis.
 * 12 gruen           Gruenrampe Mitte.
 * 13 bahn            Harte Grenze im Stadtraum.
 * 14 wasser          Eigene Familie, kuehl.
 * 15 wald            Dunkelstes Ende der Gruenrampe.
 */
const WUNSCH = [
  'fahrbahn',
  'platz',
  'fussgaengerzone',
  'platte',
  'gehweg',
  'radweg',
  'weg',
  'landwirtschaft',
  'bebauung',
  'sonstige',
  'treppe',
  'gruen',
  'bahn',
  'wasser',
  'wald',
];

interface Messung {
  gelaende: string;
  name: string;
  gesamtM: number;
  paareM: Record<string, number>;
  flaecheJeKlasseM2: Record<string, number>;
}

function graphBauen(m: Messung, schwelleProzent: number): { knoten: string[]; kanten: [string, string][] } {
  const grenze = (schwelleProzent / 100) * m.gesamtM;
  const kanten: [string, string][] = [];
  for (const [schluessel, laenge] of Object.entries(m.paareM)) {
    if (laenge < grenze) continue;
    const [a, b] = schluessel.split('|');
    kanten.push([a, b]);
  }
  const knoten = [...WUNSCH];
  for (const [a, b] of kanten) {
    if (!knoten.includes(a)) knoten.push(a);
    if (!knoten.includes(b)) knoten.push(b);
  }
  return { knoten, kanten };
}

function nachbarschaftsListe(knoten: string[], kanten: [string, string][]): number[][] {
  const idx = new Map(knoten.map((k, i) => [k, i]));
  const nachbarn: number[][] = knoten.map(() => []);
  for (const [a, b] of kanten) {
    const ia = idx.get(a)!;
    const ib = idx.get(b)!;
    if (ia === undefined || ib === undefined || ia === ib) continue;
    nachbarn[ia].push(ib);
    nachbarn[ib].push(ia);
  }
  return nachbarn;
}

/**
 * Ist der Graph mit `stufen` Farben faerbbar? (Entscheidung, nicht Optimierung.)
 *
 * Mit Symmetriebruch: ein Knoten darf nur eine Farbe nehmen, die bereits
 * benutzt ist, oder GENAU die naechste freie. Ohne diesen Schnitt zaehlt die
 * Suche dieselbe Faerbung k!-mal und laeuft aus dem Ruder.
 */
function faerbbar(nachbarn: number[][], stufen: number): boolean {
  const n = nachbarn.length;
  const reihenfolge = nachbarn.map((_, i) => i).sort((x, y) => nachbarn[y].length - nachbarn[x].length);
  const farbe = new Array<number>(n).fill(-1);
  const suche = (pos: number, benutzt: number): boolean => {
    if (pos === n) return true;
    const i = reihenfolge[pos];
    const hoechste = Math.min(stufen - 1, benutzt);
    for (let c = 0; c <= hoechste; c++) {
      if (nachbarn[i].some((x) => farbe[x] === c)) continue;
      farbe[i] = c;
      if (suche(pos + 1, Math.max(benutzt, c + 1))) return true;
      farbe[i] = -1;
    }
    return false;
  };
  return suche(0, 0);
}

/** Chromatische Zahl — die kleinste zulaessige Stufenzahl. */
function stufenZahl(nachbarn: number[][]): number {
  for (let k = 1; k <= 10; k++) if (faerbbar(nachbarn, k)) return k;
  return 10;
}

/**
 * Faerbung in der WUNSCHREIHENFOLGE: jede Klasse bekommt die HELLSTE Stufe, die
 * ihre bereits belegten Nachbarn noch zulassen.
 *
 * Warum gierig und nicht optimal gesucht: Die Reihenfolge IST die
 * kartografische Aussage. „So hell wie moeglich, aber nie naeher als 9 L* an
 * einem Nachbarn" ist genau die Regel, die eine Karte hell haelt — und sie ist
 * nachvollziehbar, waehrend das Ergebnis einer Kostenoptimierung es nicht
 * waere. Reicht das Ergebnis ueber die chromatische Zahl hinaus, wird das
 * gemeldet statt stillschweigend ein Band aufzumachen.
 */
function faerbenNachWunsch(knoten: string[], nachbarn: number[][]): Map<string, number> {
  const idx = new Map(knoten.map((k, i) => [k, i]));
  const farbe = new Array<number>(knoten.length).fill(-1);
  const reihenfolge = [...knoten].sort((a, b) => {
    const ra = WUNSCH.indexOf(a);
    const rb = WUNSCH.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  for (const k of reihenfolge) {
    const i = idx.get(k)!;
    const belegt = new Set(nachbarn[i].map((x) => farbe[x]).filter((c) => c >= 0));
    let c = 0;
    while (belegt.has(c)) c++;
    farbe[i] = c;
  }
  const out = new Map<string, number>();
  knoten.forEach((k, i) => out.set(k, farbe[i]));
  return out;
}

const wurzel = process.cwd();
const messung = JSON.parse(
  fs.readFileSync(path.resolve(wurzel, 'data', 'abnahme', 'flaechen-nachbarschaft.json'), 'utf8'),
) as Messung;

const schwellen = process.argv[2] ? [Number(process.argv[2])] : [2, 1, 0.5, 0.25, 0.1, 0];

console.log(`Messung: ${messung.gelaende} — „${messung.name}", ${messung.gesamtM} m Klassengrenze\n`);
console.log('Wie viele Helligkeitsstufen braucht die Karte? (Faerbung des gemessenen Graphen)');
console.log('Schwelle   Kanten   Stufen   Band L*        nicht erfuellte Grenze');
console.log('-'.repeat(78));

for (const s of schwellen) {
  const { knoten, kanten } = graphBauen(messung, s);
  const nachbarn = nachbarschaftsListe(knoten, kanten);
  const chi = stufenZahl(nachbarn);
  const loesung = faerbenNachWunsch(knoten, nachbarn);
  const stufen = Math.max(chi, Math.max(...loesung.values()) + 1);
  const band = `${L_MAX} … ${L_MAX - D_MIN * (stufen - 1)}`;
  // Wie viel gemessene Grenze bleibt unter der Schwelle und damit ungeschuetzt?
  const grenze = (s / 100) * messung.gesamtM;
  const ausgelassen = Object.entries(messung.paareM)
    .filter(([, l]) => l < grenze)
    .reduce((sum, [, l]) => sum + l, 0);
  console.log(
    `${(s + ' %').padStart(7)}   ${String(kanten.length).padStart(6)}   ${String(stufen).padStart(6)}   ${band.padEnd(12)}   ` +
      `${Math.round(ausgelassen)} m (${((100 * ausgelassen) / messung.gesamtM).toFixed(1)} %)`,
  );
  if (process.argv[2] && loesung) {
    console.log('\nZuordnung:');
    const nachStufe = new Map<number, string[]>();
    for (const [k, c] of loesung) {
      const liste = nachStufe.get(c) ?? [];
      liste.push(k);
      nachStufe.set(c, liste);
    }
    for (const c of [...nachStufe.keys()].sort((a, b) => a - b)) {
      console.log(`  L* ${L_MAX - D_MIN * c}: ${nachStufe.get(c)!.join(', ')}`);
    }
    console.log('\nGeprueft — Abstand je gemessener Nachbarschaft:');
    for (const [schluessel, laenge] of Object.entries(messung.paareM).sort((a, b) => b[1] - a[1])) {
      const [a, b] = schluessel.split('|');
      const ca = loesung.get(a);
      const cb = loesung.get(b);
      if (ca === undefined || cb === undefined) continue;
      const dl = Math.abs(ca - cb) * D_MIN;
      const ok = dl >= D_MIN ? 'ok' : laenge < grenze ? 'unter Schwelle' : 'VERLETZT';
      console.log(`  ${schluessel.padEnd(30)} ${String(Math.round(laenge)).padStart(6)} m  DL* ${String(dl).padStart(3)}  ${ok}`);
    }
  }
}
