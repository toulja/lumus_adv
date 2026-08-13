/**
 * HOLT DIE AMTLICHEN BAUMMERKMALE zu jedem Baum des Katasters.
 *
 * WAS IN DEN KACHELN STEHT UND WAS NICHT: Die 3D-Kacheln (i3dm) tragen nur
 * Lage und Groesse — die Hoehe muss aus dem Skalenwert abgeleitet werden
 * (SkalaY x 1,5), die Baumart steht gar nicht darin. Der Dienst haelt die
 * Sachdaten getrennt und gibt sie ueber den JWT heraus, den jede Instanz in
 * der Batch-Tabelle mitfuehrt:
 *   GET /api/v2/cesium/mesh-properties-by-jwt?token=<JWT>
 *   -> {"Höhe":32,"StammD":144,"KronenD":16,"Baumart_dt":"Linde",
 *       "Baumart_la":"Tilia","baumID":"...","DATAUF":"20200110",...}
 *
 * DAMIT WIRD AUS EINER ABLEITUNG EINE MESSUNG. Gegenprobe am ersten Baum:
 * abgeleitet 21,33 x 1,5 = 32,0 m, amtlich 32 m; Krone abgeleitet 16,01 m,
 * amtlich 16 m. Der Faktor 1,5 ist damit bestaetigt — aber der amtliche Wert
 * ist der bessere, weil er nicht auf einer Annahme ueber die Modellskalierung
 * beruht. Neu hinzu kommen Stammdurchmesser, Art und Erfassungsdatum.
 *
 * MASSVOLL ABFRAGEN: Es sind rund 36.000 Einzelabfragen an einen kommunalen
 * Dienst. Hoechstens GLEICHZEITIG_MAX laufen parallel, jede Antwort wird
 * gespeichert, und ein zweiter Lauf fragt nur nach, was noch fehlt. Wer das
 * Skript abbricht, verliert nichts.
 *
 * Aufruf: node scripts/baumarten-holen.ts [--gleichzeitig 4]
 */

import fs from 'node:fs';
import path from 'node:path';

const DIENST = 'https://3d.darmstadt.de/api/v2/cesium/mesh-properties-by-jwt';
const KATASTER = path.join('data', 'cache', 'baumkataster', 'darmstadt_stadtbaeume.json');
const MERKMALE = path.join('data', 'cache', 'baumkataster', 'darmstadt_baummerkmale.json');
const UA = 'EventPlan3D/1.0 (3D-Stadtmodell Darmstadt; Baummerkmale zum eigenen Kataster)';

const arg = (n: string, s: number): number => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1] ?? s) : s;
};
const GLEICHZEITIG_MAX = Math.max(1, Math.min(8, arg('gleichzeitig', 4)));

/** Rohzeile des Katasters: [E, N, z, SkalaX, SkalaY, SkalaZ, JWT, Laubart?]. */
type Zeile = [number, number, number, number, number, number, string, string?];

interface Merkmal {
  hoeheM?: number;
  kroneM?: number;
  stammCm?: number;
  artDt?: string;
  artLa?: string;
  baumId?: string;
  erfasst?: string;
}

const baeume = JSON.parse(fs.readFileSync(KATASTER, 'utf8')) as Zeile[];
const bekannt: Record<string, Merkmal> = fs.existsSync(MERKMALE)
  ? (JSON.parse(fs.readFileSync(MERKMALE, 'utf8')) as Record<string, Merkmal>)
  : {};
const offen = baeume.filter((b) => b[6] && !bekannt[b[6]]);
console.log(`${baeume.length.toLocaleString('de-DE')} Baeume, ${Object.keys(bekannt).length.toLocaleString('de-DE')} Merkmale schon da, ${offen.length.toLocaleString('de-DE')} offen.`);
if (!offen.length) {
  console.log('Nichts zu tun.');
  process.exit(0);
}

let fertig = 0;
let fehler = 0;
let letzteAusgabe = Date.now();
const begonnen = Date.now();

async function hole(token: string): Promise<Merkmal | null> {
  for (let versuch = 0; versuch < 3; versuch++) {
    try {
      const r = await fetch(`${DIENST}?token=${encodeURIComponent(token)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429 || r.status >= 500) {
        await new Promise((x) => setTimeout(x, 1000 * (versuch + 1)));
        continue;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as Record<string, unknown>;
      const zahl = (v: unknown): number | undefined => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const text = (v: unknown): string | undefined => {
        const s = String(v ?? '').trim();
        return s && s !== 'null' ? s : undefined;
      };
      return {
        hoeheM: zahl(j['Höhe']),
        kroneM: zahl(j.KronenD),
        stammCm: zahl(j.StammD),
        artDt: text(j.Baumart_dt),
        artLa: text(j.Baumart_la),
        baumId: text(j.baumID),
        erfasst: text(j.DATAUF),
      };
    } catch {
      await new Promise((x) => setTimeout(x, 500 * (versuch + 1)));
    }
  }
  return null;
}

function speichern(): void {
  fs.writeFileSync(MERKMALE, JSON.stringify(bekannt));
}

// Warteschlange mit fester Breite — nicht 36.000 Anfragen auf einmal loslassen.
let naechster = 0;
async function arbeiter(): Promise<void> {
  while (naechster < offen.length) {
    const b = offen[naechster++];
    const m = await hole(b[6]);
    if (m) bekannt[b[6]] = m;
    else fehler++;
    fertig++;
    if (Date.now() - letzteAusgabe > 15_000) {
      letzteAusgabe = Date.now();
      const s = (Date.now() - begonnen) / 1000;
      const rest = ((offen.length - fertig) / Math.max(1, fertig / s) / 60).toFixed(1);
      console.log(`  ${fertig.toLocaleString('de-DE')}/${offen.length.toLocaleString('de-DE')} (${(fertig / s).toFixed(0)}/s), ${fehler} Fehler, noch rund ${rest} min`);
      speichern();
    }
  }
}
await Promise.all(Array.from({ length: GLEICHZEITIG_MAX }, () => arbeiter()));
speichern();

// --- Auswertung --------------------------------------------------------------
const werte = Object.values(bekannt);
const mitArt = werte.filter((m) => m.artDt).length;
const mitHoehe = werte.filter((m) => m.hoeheM).length;
const mitStamm = werte.filter((m) => m.stammCm).length;
console.log(`\n${werte.length.toLocaleString('de-DE')} Merkmalsaetze in ${MERKMALE}`);
console.log(`  mit Baumart:          ${mitArt.toLocaleString('de-DE')}`);
console.log(`  mit amtlicher Hoehe:  ${mitHoehe.toLocaleString('de-DE')}`);
console.log(`  mit Stammdurchmesser: ${mitStamm.toLocaleString('de-DE')}`);
console.log(`  nicht beantwortet:    ${fehler.toLocaleString('de-DE')}`);

// GEGENPROBE DER ABLEITUNG: Wie gut trifft SkalaY x 1,5 die amtliche Hoehe?
// Das ist der eigentliche Wert dieses Laufs — er sagt, wie sehr man der
// bisherigen Annahme trauen durfte.
const abw: number[] = [];
for (const b of baeume) {
  const m = bekannt[b[6]];
  if (!m?.hoeheM) continue;
  abw.push(Math.abs(b[4] * 1.5 - m.hoeheM));
}
abw.sort((a, b) => a - b);
if (abw.length) {
  const p = (q: number) => abw[Math.min(abw.length - 1, Math.floor(abw.length * q))].toFixed(2);
  console.log(`\nGEGENPROBE der bisherigen Ableitung (SkalaY x 1,5) gegen die amtliche Hoehe, ${abw.length.toLocaleString('de-DE')} Baeume:`);
  console.log(`  Median ${p(0.5)} m, P90 ${p(0.9)} m, groesste ${abw[abw.length - 1].toFixed(2)} m`);
}

const arten = new Map<string, number>();
for (const m of werte) if (m.artDt) arten.set(m.artDt, (arten.get(m.artDt) ?? 0) + 1);
const top = [...arten.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`\n${arten.size} verschiedene Baumarten. Haeufigste:`);
for (const [a, n] of top) console.log(`  ${String(n).padStart(6)}  ${a}`);
