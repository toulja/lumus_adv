/**
 * LEGT JE STADTKACHEL EIN PROJEKT AN, damit man das Stadtmodell auch ANSEHEN
 * kann.
 *
 * WARUM: Ein Gelaende ohne Projekt ist in der Oberflaeche nicht erreichbar —
 * die 3D-Karte IST die Projektansicht (Befund des Auftraggebers vom
 * 08.08.2026: „Ich finde die Karte nicht"). Nach dem Stadtlauf liegen 26
 * Gelaende auf der Platte und kein einziger Weg dorthin.
 *
 * Die Projekte heissen wie die Kacheln und tragen die Lage im Namen, damit
 * man in der Uebersicht sieht, welches Stueck Stadt man oeffnet. Bestehende
 * Projekte werden NICHT angefasst — insbesondere nicht „Darmstadt 3D", das
 * auf dem Pilotgebiet steht.
 *
 * Aufruf: node scripts/stadt-projekte.ts [--basis http://localhost:4720]
 *         (der Server muss laufen)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Gelaende } from '../shared/domain/types.ts';

const arg = (name: string, standard: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? standard) : standard;
};
const BASIS = arg('basis', 'http://localhost:4720');

const res = await fetch(`${BASIS}/api/auth/anmelden`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'veranstalter@heinerfest.de', passwort: 'heiner1234' }),
});
if (!res.ok) throw new Error(`Anmeldung gescheitert: HTTP ${res.status}. Laeuft der Server auf ${BASIS}?`);
const keks = res.headers.get('set-cookie')?.split(';')[0] ?? '';

// Die Uebersicht liefert das Projekt VERSCHACHTELT (ProjektUebersicht.projekt).
const vorhanden = (await (await fetch(`${BASIS}/api/projekte`, { headers: { Cookie: keks } })).json()) as { projekt: { gelaendeId: string } }[];
const schonDa = new Set(vorhanden.map((p) => p.projekt.gelaendeId));

const ORDNER = path.join('data', 'gelaende');
type Eintrag = { nr: number; id: string; name: string; gebaeude: number };
const kacheln: Eintrag[] = [];
for (const ordner of fs.readdirSync(ORDNER)) {
  const datei = path.join(ORDNER, ordner, 'gelaende.json');
  if (!fs.existsSync(datei)) continue;
  const g = JSON.parse(fs.readFileSync(datei, 'utf8')) as Gelaende;
  const m = /Kachel (\d+)/.exec(g.name ?? '');
  if (!m || !g.name?.startsWith('Darmstadt')) continue;
  kacheln.push({ nr: Number(m[1]), id: ordner, name: g.name, gebaeude: g.gebaeude?.length ?? 0 });
}
kacheln.sort((a, b) => a.nr - b.nr);

let angelegt = 0;
for (const k of kacheln) {
  if (schonDa.has(k.id)) {
    console.log(`  ${String(k.nr).padStart(2)}  schon vorhanden`);
    continue;
  }
  const r = await fetch(`${BASIS}/api/projekte`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: keks },
    body: JSON.stringify({
      name: `Darmstadt 3D — ${k.name.replace('Darmstadt ', '')}`,
      gelaendeId: k.id,
      // Pflichtfeld: Grundlage der Regelpruefung. Diese Projekte sind reine
      // ANSICHTEN des Stadtmodells, keine Veranstaltungen — der Wert ist
      // bewusst klein gesetzt und keine Aussage ueber eine Kapazitaet.
      maxBesucher: 1,
      beschreibung: 'Ansicht einer Stadtkachel des 3D-Modells Darmstadt. Keine Veranstaltungsplanung.',
    }),
  });
  if (!r.ok) {
    console.log(`  ${String(k.nr).padStart(2)}  FEHLER HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
    continue;
  }
  const antwort = (await r.json()) as { id?: string; projekt?: { id: string } };
  const p = { id: antwort.id ?? antwort.projekt?.id ?? '(ohne Id)' };
  angelegt++;
  console.log(`  ${String(k.nr).padStart(2)}  ${p.id}  ${k.gebaeude.toLocaleString('de-DE')} Gebaeude  -> ${k.id}`);
}
console.log(`\n${angelegt} Projekte angelegt, ${kacheln.length - angelegt} waren schon da.`);
