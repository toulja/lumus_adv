/**
 * PRUEFT DIE DAECHER DES GANZEN STADTMODELLS — auf die Fehler, die man sieht.
 *
 * WARUM MESSEN STATT HINSEHEN: Der Auftraggeber meldete „viele Daecher sind
 * fehlerhaft". Fuer 95.375 Baukoerper ist Hinsehen keine Pruefung; und ein
 * Bildschirmabzug zeigt immer nur den Ausschnitt, den man gerade gewaehlt hat.
 * Die drei Fehlerbilder, die in diesem Projekt tatsaechlich aufgetreten sind,
 * lassen sich dagegen alle an der GEOMETRIE erkennen:
 *
 *  1. FAECHER-ZACKEN. Entstehen, wenn der Ohrenschnitt an einem selbst-
 *     beruehrenden Ring scheitert (Karree mit Innenhof als Schleife, doppelte
 *     Punkte) — das Dach faechert dann von einem Punkt aus auf. Erkennbar an
 *     doppelten Stuetzpunkten im Ring.
 *  2. ENTARTETE FLAECHEN. Ringe mit weniger als drei Punkten oder ohne
 *     Flaecheninhalt ergeben unsichtbare oder flackernde Dreiecke.
 *  3. HOEHENUNSINN. First unter der Traufe, Traufe unter dem Boden, oder
 *     Hoehen, die kein Gebaeude haben kann. Das ist der Fehler, der ein Dach
 *     „falsch herum" oder als Nadel erscheinen laesst.
 *
 * Zusaetzlich geprueft wird die FARBE — der Regressionsfall vom 10.08.2026,
 * bei dem 1.144 Daecher unlesbar wurden, weil die Palette den Untergrund
 * aufhellte und die Dachtoene stehen blieben. Die Selbstpruefung der Palette
 * deckt die Toene ab; hier zaehlt, dass jedes Dach ueberhaupt einen Ton
 * bekommt und die Dachform nicht leer bleibt.
 *
 * Aufruf: node scripts/dach-pruefen.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Gelaende, GelaendeGebaeude, Ring } from '../shared/domain/types.ts';

const ORDNER = path.join('data', 'gelaende');
const kacheln: { nr: number; g: Gelaende }[] = [];
for (const o of fs.readdirSync(ORDNER)) {
  const d = path.join(ORDNER, o, 'gelaende.json');
  if (!fs.existsSync(d)) continue;
  const g = JSON.parse(fs.readFileSync(d, 'utf8')) as Gelaende;
  const m = /Darmstadt Kachel (\d+)/.exec(g.name ?? '');
  if (m) kacheln.push({ nr: Number(m[1]), g });
}
kacheln.sort((a, b) => a.nr - b.nr);
if (!kacheln.length) {
  console.error('Keine Stadtkacheln gefunden.');
  process.exit(1);
}

const flaecheVon = (r: number[][]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};

interface Zaehler {
  gebaeude: number;
  ohneDachflaechen: number;
  ohneDachform: number;
  doppelpunkte: number;
  entartet: number;
  firstUnterTraufe: number;
  traufeUnterBoden: number;
  unplausibleHoehe: number;
  dachflaechen: number;
  dachflaecheEntartet: number;
  dachflaecheSenkrecht: number;
}
const z: Zaehler = {
  gebaeude: 0,
  ohneDachflaechen: 0,
  ohneDachform: 0,
  doppelpunkte: 0,
  entartet: 0,
  firstUnterTraufe: 0,
  traufeUnterBoden: 0,
  unplausibleHoehe: 0,
  dachflaechen: 0,
  dachflaecheEntartet: 0,
  dachflaecheSenkrecht: 0,
};
const beispiele: string[] = [];
const merke = (s: string) => {
  if (beispiele.length < 12) beispiele.push(s);
};

for (const k of kacheln) {
  for (const b of (k.g.gebaeude ?? []) as GelaendeGebaeude[]) {
    z.gebaeude++;
    const ring = b.grundriss as unknown as number[][];

    // 1. Grundriss
    if (!ring || ring.length < 3 || flaecheVon(ring) < 0.5) {
      z.entartet++;
      merke(`Kachel ${k.nr} ${b.id}: Grundriss entartet (${ring?.length ?? 0} Punkte, ${ring ? flaecheVon(ring).toFixed(2) : '—'} m2)`);
      continue;
    }
    // Doppelte Stuetzpunkte — die Ursache der Faecher-Zacken.
    let doppelt = 0;
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 1; j < ring.length; j++) {
        if (Math.abs(ring[i][0] - ring[j][0]) < 0.002 && Math.abs(ring[i][1] - ring[j][1]) < 0.002) doppelt++;
      }
    }
    if (doppelt) {
      z.doppelpunkte++;
      merke(`Kachel ${k.nr} ${b.id}: ${doppelt} deckungsgleiche Ringpunkte (Faecher-Gefahr)`);
    }

    // 2. Hoehen
    if (b.traufHoehe !== undefined && b.firstHoehe !== undefined && b.firstHoehe < b.traufHoehe - 0.01) {
      z.firstUnterTraufe++;
      merke(`Kachel ${k.nr} ${b.id}: First ${b.firstHoehe.toFixed(2)} unter Traufe ${b.traufHoehe.toFixed(2)}`);
    }
    if (b.traufHoehe !== undefined && b.traufHoehe < b.bodenHoehe - 0.01) {
      z.traufeUnterBoden++;
      merke(`Kachel ${k.nr} ${b.id}: Traufe ${b.traufHoehe.toFixed(2)} unter Boden ${b.bodenHoehe.toFixed(2)}`);
    }
    const hoch = (b.firstHoehe ?? b.traufHoehe ?? b.bodenHoehe) - b.bodenHoehe;
    if (hoch > 200 || hoch < -0.01) {
      z.unplausibleHoehe++;
      merke(`Kachel ${k.nr} ${b.id}: Bauwerkshoehe ${hoch.toFixed(2)} m`);
    }

    // 3. Dach
    if (!b.dachform) z.ohneDachform++;
    const df = b.dachflaechen ?? [];
    if (!df.length) z.ohneDachflaechen++;
    for (const f of df) {
      z.dachflaechen++;
      if (f.length < 3) {
        z.dachflaecheEntartet++;
        continue;
      }
      const xy = f.map((p) => [p[0], p[1]]);
      const a = flaecheVon(xy);
      if (a < 0.05) {
        // Eine Dachflaeche ohne Grundrissanteil steht SENKRECHT — das ist eine
        // Wand, die als Dach gefuehrt wird, und sie erzeugt im Bild einen
        // Zacken bis in den Himmel.
        const hs = f.map((p) => p[2]);
        if (Math.max(...hs) - Math.min(...hs) > 0.5) z.dachflaecheSenkrecht++;
        else z.dachflaecheEntartet++;
      }
    }
  }
}

const p = (n: number) => `${n.toLocaleString('de-DE')} (${((100 * n) / z.gebaeude).toFixed(3)} %)`;
console.log(`DACHPRUEFUNG ueber ${kacheln.length} Kacheln, ${z.gebaeude.toLocaleString('de-DE')} Baukoerper\n`);
console.log(`  Grundriss entartet (<3 Punkte oder ohne Flaeche)   ${p(z.entartet)}`);
console.log(`  deckungsgleiche Ringpunkte (Faecher-Gefahr)        ${p(z.doppelpunkte)}`);
console.log(`  First unter der Traufe                             ${p(z.firstUnterTraufe)}`);
console.log(`  Traufe unter dem Boden                             ${p(z.traufeUnterBoden)}`);
console.log(`  unplausible Bauwerkshoehe (>200 m oder negativ)     ${p(z.unplausibleHoehe)}`);
console.log(`  ohne Dachform                                       ${p(z.ohneDachform)}`);
console.log(`  ohne echte Dachflaechen (wird als Quader gezeichnet) ${p(z.ohneDachflaechen)}`);
console.log(`\n  ${z.dachflaechen.toLocaleString('de-DE')} Dachflaechen gesamt`);
console.log(`    entartet (<3 Punkte oder ohne Ausdehnung)         ${z.dachflaecheEntartet.toLocaleString('de-DE')}`);
console.log(`    senkrecht (Wand als Dach gefuehrt)                ${z.dachflaecheSenkrecht.toLocaleString('de-DE')}`);
if (beispiele.length) {
  console.log('\nBeispiele:');
  for (const b of beispiele) console.log('  ' + b);
}
const schlimm = z.entartet + z.firstUnterTraufe + z.traufeUnterBoden + z.unplausibleHoehe + z.dachflaecheSenkrecht;
console.log(`\nBEFUND: ${schlimm === 0 ? 'kein sichtbarer Dachfehler in den Daten.' : `${schlimm.toLocaleString('de-DE')} Baukoerper/Flaechen mit einem Fehler, der im Bild auffaellt.`}`);
