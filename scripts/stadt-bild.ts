/**
 * ZEICHNET DAS GEBAUTE STADTMODELL ALS BILD — ohne Browser, ohne WebGL.
 *
 * WARUM ES DAS BRAUCHT: Der Auftraggeber kann die laufende Anwendung nicht
 * ansehen; jeder Arbeitsschritt braucht darum ein Bild. Der uebliche Weg
 * (Bildschirmabzug der 3D-Szene ueber `EP3D.abzug()`) setzt voraus, dass das
 * Browser-Fenster EINGEBLENDET ist — ein verborgenes Fenster bekommt kein
 * `requestAnimationFrame`, rendert nicht und liefert ein leeres Bild.
 * Nachgemessen am 11.08.2026: Chrome verbrauchte in 20 s ganze 0,2 s
 * Rechenzeit, waehrend die Szene angeblich „baute" — sie stand still.
 *
 * Dieses Skript liest DIESELBEN Gelaendedateien, die die 3D-Szene liest, und
 * zeichnet einen Grundriss daraus. Es ist damit kein Ersatz fuer die
 * 3D-Ansicht, aber ein ehrlicher Beleg: Was hier zu sehen ist, LIEGT in den
 * Daten — Gebaeudegrundrisse, Verkehrsflaechen, Gruen, Wasser, Bahn.
 *
 * Die Farben kommen aus derselben Palette wie die Szene (web/src/scene/
 * palette.ts), damit Bild und Anwendung dasselbe sagen.
 *
 * Aufruf:
 *   node scripts/stadt-bild.ts                      ganze Stadt, 4 m/Bildpunkt
 *   node scripts/stadt-bild.ts --kachel 12 --mpp 1  eine Kachel, 1 m/Bildpunkt
 */

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { FLAECHEN_STIL } from '../web/src/scene/palette.ts';
import type { Gelaende, Ring } from '../shared/domain/types.ts';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const nurKachel = arg('kachel') ? Number(arg('kachel')) : null;
const mpp = Number(arg('mpp') ?? (nurKachel ? 1 : 4)); // Meter je Bildpunkt
const ZIEL = arg('ziel') ?? path.join('data', 'cache', nurKachel ? `stadt-kachel-${nurKachel}.jpg` : 'stadt-darmstadt.jpg');

// --- Gelaende einsammeln -----------------------------------------------------
const ORDNER = path.join('data', 'gelaende');
interface Kachel {
  nr: number;
  g: Gelaende;
}
const kacheln: Kachel[] = [];
for (const o of fs.readdirSync(ORDNER)) {
  const d = path.join(ORDNER, o, 'gelaende.json');
  if (!fs.existsSync(d)) continue;
  const g = JSON.parse(fs.readFileSync(d, 'utf8')) as Gelaende;
  const m = /Darmstadt Kachel (\d+)/.exec(g.name ?? '');
  if (!m) continue;
  const nr = Number(m[1]);
  if (nurKachel !== null && nr !== nurKachel) continue;
  kacheln.push({ nr, g });
}
if (!kacheln.length) {
  console.error(nurKachel ? `Kachel ${nurKachel} nicht gefunden.` : 'Keine Stadtkacheln gefunden.');
  process.exit(1);
}
kacheln.sort((a, b) => a.nr - b.nr);

let minE = Infinity;
let minN = Infinity;
let maxE = -Infinity;
let maxN = -Infinity;
for (const k of kacheln) {
  minE = Math.min(minE, k.g.bbox.minE);
  minN = Math.min(minN, k.g.bbox.minN);
  maxE = Math.max(maxE, k.g.bbox.maxE);
  maxN = Math.max(maxN, k.g.bbox.maxN);
}
const W = Math.round((maxE - minE) / mpp);
const H = Math.round((maxN - minN) / mpp);
console.log(`${kacheln.length} Kachel(n), Gebiet ${((maxE - minE) / 1000).toFixed(1)} x ${((maxN - minN) / 1000).toFixed(1)} km -> Bild ${W} x ${H} Bildpunkte a ${mpp} m`);

// --- Zeichenfläche -----------------------------------------------------------
const daten = new Uint8Array(W * H * 4);
const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const GRUND = hexRgb('#2b2f33'); // nichts erfasst — bewusst dunkel, nicht weiss
for (let i = 0; i < W * H; i++) {
  daten[i * 4] = GRUND[0];
  daten[i * 4 + 1] = GRUND[1];
  daten[i * 4 + 2] = GRUND[2];
  daten[i * 4 + 3] = 255;
}

/**
 * Fuellt ein Polygon zeilenweise (Scanline).
 *
 * Bewusst kein Kantenglaetten: Das Bild soll zeigen, WAS erfasst ist, nicht
 * huebsch aussehen. Eine weichgezeichnete Kante wuerde bei 4 m je Bildpunkt
 * Genauigkeit vortaeuschen, die es nicht gibt.
 */
function fuelle(ring: Ring, loecher: Ring[] | undefined, farbe: [number, number, number]): void {
  const pts = ring as unknown as number[][];
  if (pts.length < 3) return;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  const zy0 = Math.max(0, Math.floor((maxN - y1) / mpp));
  const zy1 = Math.min(H - 1, Math.ceil((maxN - y0) / mpp));
  for (let zy = zy0; zy <= zy1; zy++) {
    const n = maxN - (zy + 0.5) * mpp;
    const x: number[] = [];
    const sammle = (r: number[][]) => {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j];
        const b = r[i];
        if (a[1] > n === b[1] > n) continue;
        x.push(a[0] + ((n - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    };
    sammle(pts);
    // Loecher zaehlen in derselben Schnittliste mit — die Parität sorgt dafür,
    // dass ein Innenhof frei bleibt (gerade-ungerade-Regel).
    for (const l of loecher ?? []) sammle(l as unknown as number[][]);
    x.sort((p, q) => p - q);
    for (let k = 0; k + 1 < x.length; k += 2) {
      const von = Math.max(0, Math.ceil((x[k] - minE) / mpp));
      const bis = Math.min(W - 1, Math.floor((x[k + 1] - minE) / mpp));
      for (let zx = von; zx <= bis; zx++) {
        const i = (zy * W + zx) * 4;
        daten[i] = farbe[0];
        daten[i + 1] = farbe[1];
        daten[i + 2] = farbe[2];
      }
    }
  }
}

// --- Zeichnen: Flaechen nach Rang, dann Gebaeude ------------------------------
// Dieselbe Reihenfolge wie die Szene: was unten liegt, zuerst.
let flaechenGezeichnet = 0;
const alleFlaechen: { art: string; polygon: Ring; loecher?: Ring[]; rang: number }[] = [];
for (const k of kacheln) {
  for (const f of k.g.flaechen ?? []) {
    alleFlaechen.push({ art: f.art, polygon: f.polygon, loecher: f.loecher, rang: FLAECHEN_STIL[f.art]?.rang ?? 10 });
  }
}
alleFlaechen.sort((a, b) => a.rang - b.rang);
for (const f of alleFlaechen) {
  const stil = FLAECHEN_STIL[f.art as keyof typeof FLAECHEN_STIL] ?? FLAECHEN_STIL.sonstige;
  fuelle(f.polygon, f.loecher, hexRgb(stil.fuellung));
  flaechenGezeichnet++;
}

// Gebaeude zuletzt und in EINEM hellen Ton: In der Draufsicht ist die Aussage
// „hier steht ein Haus", nicht „welche Dachfarbe". Ein heller Ton auf dem
// dunkleren Gewebe macht die Stadtstruktur lesbar.
const HAUS: [number, number, number] = [226, 224, 219];
let gebaeudeGezeichnet = 0;
for (const k of kacheln) {
  for (const b of k.g.gebaeude ?? []) {
    fuelle(b.grundriss, undefined, HAUS);
    gebaeudeGezeichnet++;
  }
}

/*
 * BAEUME NACH ART GEFAERBT — damit man der Karte ansieht, was das Modell
 * ueber sie weiss.
 *
 * Seit dem Nachlauf gegen die Attribut-API traegt jeder Katasterbaum seine
 * amtliche Art (36.408 von 49.630; die uebrigen sind OSM-Baeume ausserhalb
 * des Katasterausschnitts). Nadel- und immergruene Gehoelze bekommen darum
 * einen eigenen Ton — ein Nadelwald sieht im Bild anders aus als eine
 * Lindenallee, und wo gar keine Art bekannt ist, sagt der graugruene Ton
 * genau das.
 */
const BAUM_LAUB: [number, number, number] = [104, 132, 96];
const BAUM_NADEL: [number, number, number] = [54, 92, 78];
const BAUM_IMMER: [number, number, number] = [76, 112, 92];
const BAUM_OHNE: [number, number, number] = [126, 138, 122];
let baeumeGezeichnet = 0;
for (const k of kacheln) {
  for (const p of k.g.punkte ?? []) {
    if (p.art !== 'baum') continue;
    const zx = Math.round((p.pos[0] - minE) / mpp);
    const zy = Math.round((maxN - p.pos[1]) / mpp);
    if (zx < 0 || zx >= W || zy < 0 || zy >= H) continue;
    const f = p.laubart === 'nadelbaum' ? BAUM_NADEL : p.laubart === 'immergruen' ? BAUM_IMMER : p.artLa ? BAUM_LAUB : BAUM_OHNE;
    // Bei feiner Aufloesung bekommt der Baum seine gemessene Krone, sonst
    // bliebe er ein Punkt und die Art waere nicht ablesbar.
    const r = mpp <= 1 ? Math.max(0, Math.round((p.kroneM ?? 4) / 2 / mpp)) : 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = zx + dx;
        const y = zy + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * 4;
        daten[i] = f[0];
        daten[i + 1] = f[1];
        daten[i + 2] = f[2];
      }
    }
    baeumeGezeichnet++;
  }
}

fs.mkdirSync(path.dirname(ZIEL), { recursive: true });
const bild = jpeg.encode({ data: Buffer.from(daten), width: W, height: H }, 88);
fs.writeFileSync(ZIEL, bild.data);
console.log(`${flaechenGezeichnet.toLocaleString('de-DE')} Flaechen, ${gebaeudeGezeichnet.toLocaleString('de-DE')} Gebaeudegrundrisse, ${baeumeGezeichnet.toLocaleString('de-DE')} Baeume gezeichnet.`);
console.log(`-> ${ZIEL} (${(bild.data.length / 1e6).toFixed(1)} MB)`);
