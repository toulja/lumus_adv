/**
 * Misst die Serverseite (Stufe A aus docs/PLAN-DARMSTADT.md).
 *
 * WOFUER: Die Oberflaeche wartet heute Sekunden auf zwei blosse Namenslisten.
 * Bevor daran etwas geaendert wird, muss der Ist-Zustand als Zahl vorliegen —
 * und zwar wiederholbar, auf jedem Rechner gleich, damit "schneller" belegbar
 * ist statt gefuehlt.
 *
 * GEMESSEN WIRD, WAS DER BROWSER TATSAECHLICH TUT: dieselben HTTP-Aufrufe in
 * derselben Reihenfolge, ueber den API-Port. Nicht die Funktionen im Server
 * direkt — die wuerden das Anmelden, die Serialisierung und das Netz
 * unterschlagen, also genau die Kosten, um die es geht.
 *
 * Je Aufruf drei Laeufe, gewertet wird der MEDIAN: der erste Lauf traegt
 * Dateisystem-Zwischenspeicher des Betriebssystems, die Ausreisser nach oben
 * traegt alles Moegliche.
 *
 * Aufruf (Server muss laufen):
 *   node scripts/leistung-messen.ts [--gelaende <id>] [--kennung <text>]
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://127.0.0.1:4720';
const EMAIL = process.env.HEINERFEST_MESS_EMAIL ?? 'veranstalter@heinerfest.de';
const PASSWORT = process.env.HEINERFEST_MESS_PASSWORT ?? 'heiner1234';
const LAEUFE = 3;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const median = (werte: number[]): number => {
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

interface Messwert {
  pfad: string;
  medianMs: number;
  laeufe: number[];
  bytes: number;
  kodierung: string | null;
  status: number;
}

async function anmelden(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/auth/anmelden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, passwort: PASSWORT }),
    });
  } catch {
    console.error(`Kein Server auf ${API}. Bitte zuerst \`npm run dev\` starten.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Anmeldung fehlgeschlagen (${res.status}). Konto ${EMAIL} vorhanden? Sonst \`npm run seed\`.`);
    process.exit(1);
  }
  const keks = res.headers.get('set-cookie');
  if (!keks) {
    console.error('Server hat kein Sitzungscookie geschickt.');
    process.exit(1);
  }
  return keks.split(';')[0];
}

async function miss(pfad: string, keks: string): Promise<Messwert> {
  const laeufe: number[] = [];
  let bytes = 0;
  let kodierung: string | null = null;
  let status = 0;
  for (let i = 0; i < LAEUFE; i++) {
    const t = performance.now();
    const res = await fetch(`${API}${pfad}`, { headers: { cookie: keks } });
    const puffer = await res.arrayBuffer();
    laeufe.push(performance.now() - t);
    bytes = puffer.byteLength;
    kodierung = res.headers.get('content-encoding');
    status = res.status;
  }
  return { pfad, medianMs: Math.round(median(laeufe)), laeufe: laeufe.map((l) => Math.round(l)), bytes, kodierung, status };
}

const keks = await anmelden();

// Welches Gelaende? Vorgabe schlaegt alles; sonst das des ersten Projekts —
// das ist das, was der Nutzer beim Oeffnen tatsaechlich laedt.
let gelaendeId = arg('gelaende');
if (!gelaendeId) {
  const res = await fetch(`${API}/api/projekte`, { headers: { cookie: keks } });
  const liste = (await res.json()) as { projekt: { gelaendeId: string } }[];
  gelaendeId = liste[0]?.projekt.gelaendeId;
}
if (!gelaendeId) {
  console.error('Kein Gelaende gefunden. Bitte --gelaende <id> angeben.');
  process.exit(1);
}

const messungen: Messwert[] = [];
for (const pfad of ['/api/projekte', '/api/gelaende', `/api/gelaende/${gelaendeId}`, `/api/gelaende/${gelaendeId}/hoehen.bin`]) {
  messungen.push(await miss(pfad, keks));
}

const bericht = {
  art: 'server' as const,
  zeitpunkt: new Date().toISOString(),
  kennung: arg('kennung') ?? null,
  gelaendeId,
  rechner: os.hostname(),
  cpu: os.cpus()[0]?.model ?? 'k. A.',
  kerne: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 1073741824),
  node: process.version,
  laeufeJeAufruf: LAEUFE,
  messungen,
};

const ordner = path.resolve(process.cwd(), 'data', 'cache', 'leistung');
fs.mkdirSync(ordner, { recursive: true });
const datei = path.join(ordner, `${bericht.zeitpunkt.replace(/[:.]/g, '-')}_server.json`);
fs.writeFileSync(datei, JSON.stringify(bericht, null, 1));

console.log(`Rechner: ${bericht.rechner} — ${bericht.cpu}, ${bericht.kerne} Kerne, ${bericht.ramGb} GB, Node ${bericht.node}`);
console.log(`Gelaende: ${gelaendeId}`);
console.log('');
console.log('Aufruf                                        Median    Umfang  Kodierung');
for (const m of messungen) {
  const kurz = m.pfad.replace(gelaendeId, '<id>');
  const mb = m.bytes >= 1048576 ? `${(m.bytes / 1048576).toFixed(1)} MB` : `${(m.bytes / 1024).toFixed(0)} kB`;
  console.log(
    `${kurz.padEnd(44)}${String(m.medianMs).padStart(6)} ms${mb.padStart(10)}  ${m.kodierung ?? 'keine'}${m.status !== 200 ? `  [HTTP ${m.status}]` : ''}`,
  );
}
console.log('');
console.log(`Bericht: ${path.relative(process.cwd(), datei)}`);
