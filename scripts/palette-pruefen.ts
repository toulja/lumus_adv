/**
 * SELBSTPRUEFUNG DER PALETTE VON DER KOMMANDOZEILE.
 *
 * Dieselbe Funktion, die beim Laden der Szene laeuft — nur ohne Browser. So
 * laesst sich eine Farbaenderung pruefen, ohne die ganze Anwendung zu starten,
 * und der Abnahmelauf kann sie mitnehmen.
 *
 * Aufruf: node scripts/palette-pruefen.ts
 * Beendet mit Code 1, wenn ein Befund vorliegt.
 */

import {
  FLAECHEN_STIL,
  GRUNDTON,
  HIMMEL,
  NACHBARSCHAFT_GESAMT_M,
  NACHBARSCHAFT_M,
  PLATTE_STIL,
  lStern,
  pruefePalette,
} from '../web/src/scene/palette.ts';

const z = (v: number) => v.toFixed(2).padStart(6);

console.log('STUFENLEITER (L* aus dem Hexwert zurueckgerechnet)\n');
const toene: [string, string][] = [
  ...Object.entries(FLAECHEN_STIL).map(([k, s]) => [k, s.fuellung] as [string, string]),
  ['PLATTE', PLATTE_STIL.fuellung],
  ['GELAENDEPLATTE', GRUNDTON],
  ['HIMMEL', HIMMEL],
];
for (const [name, hex] of toene.sort((a, b) => lStern(b[1]) - lStern(a[1]))) {
  console.log(`  ${name.padEnd(16)} ${hex}  L* ${z(lStern(hex))}`);
}

console.log('\nNACHBARSCHAFT (gemessen) — Abstand je Paar\n');
const schwelleM = 0.005 * NACHBARSCHAFT_GESAMT_M;
const ton = (k: string) => (k === 'platte' ? PLATTE_STIL.fuellung : (FLAECHEN_STIL as Record<string, { fuellung: string }>)[k].fuellung);
let ueber = 0;
let unter = 0;
let verletzt = 0;
for (const [paar, laenge] of Object.entries(NACHBARSCHAFT_M).sort((a, b) => b[1] - a[1])) {
  const [a, b] = paar.split('|');
  const dl = Math.abs(lStern(ton(a)) - lStern(ton(b)));
  const relevant = laenge >= schwelleM;
  if (relevant) ueber += laenge;
  else unter += laenge;
  const ok = dl >= 9;
  if (!ok) verletzt += laenge;
  console.log(
    `  ${paar.padEnd(30)} ${String(laenge).padStart(6)} m  DL* ${z(dl)}  ` +
      `${relevant ? 'ueber Schwelle' : 'darunter     '}  ${ok ? 'ok' : 'DL* < 9 -> Farbtemperatur muss tragen'}`,
  );
}
console.log(
  `\n  Grenze ueber der Schwelle: ${Math.round(ueber)} m (${((100 * ueber) / NACHBARSCHAFT_GESAMT_M).toFixed(1)} %)` +
    `\n  Grenze mit DL* < 9:        ${Math.round(verletzt)} m (${((100 * verletzt) / NACHBARSCHAFT_GESAMT_M).toFixed(2)} %)` +
    `\n  Grenze mit DL* >= 9:       ${Math.round(NACHBARSCHAFT_GESAMT_M - verletzt)} m ` +
    `(${((100 * (NACHBARSCHAFT_GESAMT_M - verletzt)) / NACHBARSCHAFT_GESAMT_M).toFixed(2)} %)`,
);

console.log('\nSELBSTPRUEFUNG\n');
const erg = pruefePalette();
if (erg.ok) {
  console.log('  bestanden — kein Befund.');
} else {
  for (const b of erg.befunde) console.log(`  • ${b}`);
}
process.exit(erg.ok ? 0 : 1);
