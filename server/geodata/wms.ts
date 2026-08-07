/**
 * WMS-Abruf (Luftbild DOP20 und Kartenkaskade).
 *
 * Zwei Eigenheiten des HVBG-Dienstes, die hier bewusst behandelt werden:
 *  1. Echte Bilder kommen NUR in EPSG:25832. Da unser Gelaende ohnehin ein
 *     UTM-Gitter ist, wird nichts umprojiziert — die Kachel liegt pixelgenau
 *     auf dem Gelaendegitter. Deshalb braucht diese Plattform keinen Warper.
 *  2. Der Dienst beantwortet Anfragebursts zeitweise mit LEERBILDERN
 *     (HTTP 200, image/jpeg, aber praktisch leer). Solche Antworten duerfen
 *     niemals in den Cache. Erkennung ohne Bildbibliothek ueber die Dateigroesse:
 *     ein reales DOP20-Kachelbild liegt bei 100-500 kB, ein Leerbild bei
 *     wenigen kB. Schwelle steht in config/geodata.<land>.json.
 */

import type { BBox } from '../../shared/domain/types.ts';
import { cache } from '../lib/store.ts';
import { geoKonfig } from './konfig.ts';

class Semaphor {
  private frei: number;
  private warteschlange: (() => void)[] = [];
  constructor(n: number) {
    this.frei = n;
  }
  async nehmen(): Promise<() => void> {
    if (this.frei > 0) {
      this.frei--;
      return () => this.zurueck();
    }
    await new Promise<void>((r) => this.warteschlange.push(r));
    return () => this.zurueck();
  }
  private zurueck() {
    const naechster = this.warteschlange.shift();
    if (naechster) naechster();
    else this.frei++;
  }
}

const semaphore = new Map<string, Semaphor>();
function semaphorFuer(url: string, max: number): Semaphor {
  let s = semaphore.get(url);
  if (!s) {
    s = new Semaphor(max);
    semaphore.set(url, s);
  }
  return s;
}

function schlafen(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface WmsAnfrage {
  url: string;
  layer: string;
  version: string;
  format: string;
  crs: string;
  bbox: BBox;
  breitePx: number;
  hoehePx: number;
  transparent?: boolean;
}

function bauUrl(a: WmsAnfrage): string {
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: a.version,
    REQUEST: 'GetMap',
    LAYERS: a.layer,
    STYLES: '',
    FORMAT: a.format,
    WIDTH: String(a.breitePx),
    HEIGHT: String(a.hoehePx),
    // WMS 1.3.0 mit projiziertem CRS: BBOX in minX,minY,maxX,maxY (E,N)
    BBOX: `${a.bbox.minE},${a.bbox.minN},${a.bbox.maxE},${a.bbox.maxN}`,
  });
  p.set(a.version === '1.3.0' ? 'CRS' : 'SRS', a.crs);
  if (a.transparent) p.set('TRANSPARENT', 'TRUE');
  return `${a.url}?${p.toString()}`;
}

/**
 * Holt eine WMS-Kachel. Leerbilder werden erkannt, mit steigendem Abstand
 * wiederholt und NICHT gecacht.
 */
export async function kachel(
  a: WmsAnfrage,
  opts: { leerbildBytes: number; maxParallel: number; userAgent: string; cacheSchluessel?: string },
): Promise<{ daten: Buffer; ausCache: boolean; leer: boolean }> {
  if (opts.cacheSchluessel) {
    const c = cache.lesen('wms', opts.cacheSchluessel);
    if (c && c.length >= opts.leerbildBytes) return { daten: c, ausCache: true, leer: false };
  }

  const sem = semaphorFuer(a.url, opts.maxParallel);
  const freigeben = await sem.nehmen();
  try {
    const url = bauUrl(a);
    const wartezeiten = [0, 300, 900, 1800];
    let letzte: Buffer | null = null;
    for (const w of wartezeiten) {
      if (w) await schlafen(w);
      const res = await fetch(url, { headers: { 'User-Agent': opts.userAgent } });
      if (!res.ok) {
        if (res.status >= 500) continue;
        throw new Error(`WMS ${a.layer}: HTTP ${res.status}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      const daten = Buffer.from(await res.arrayBuffer());
      if (ct.includes('xml') || ct.includes('text')) {
        const txt = daten.toString('utf8').slice(0, 400);
        throw new Error(`WMS ${a.layer} lieferte eine Fehlermeldung statt eines Bildes: ${txt}`);
      }
      letzte = daten;
      if (daten.length >= opts.leerbildBytes) {
        if (opts.cacheSchluessel) cache.schreiben(daten, 'wms', opts.cacheSchluessel);
        return { daten, ausCache: false, leer: false };
      }
      // zu klein -> vermutlich Leerbild wegen Drossel, erneut versuchen
    }
    return { daten: letzte ?? Buffer.alloc(0), ausCache: false, leer: true };
  } finally {
    freigeben();
  }
}

/** Luftbild-Kachel fuer ein Gelaende-Patch. */
export async function orthophoto(
  bbox: BBox,
  breitePx: number,
  hoehePx: number,
  land = 'hessen',
  cacheSchluessel?: string,
): Promise<{ daten: Buffer; leer: boolean; format: string }> {
  const k = geoKonfig(land);
  const o = k.orthophoto;
  const r = await kachel(
    {
      url: o.url,
      layer: o.layer,
      version: o.version,
      format: o.format,
      crs: o.crs,
      bbox,
      breitePx,
      hoehePx,
    },
    {
      leerbildBytes: o.leerbildBytes,
      maxParallel: o.maxParallel,
      userAgent: k.geokodierung.userAgent,
      cacheSchluessel,
    },
  );
  return { daten: r.daten, leer: r.leer, format: o.format };
}

/** Kartenkachel nach Massstabskaskade (Liegenschaftskarte bis Uebersichtskarte). */
export async function karte(
  bbox: BBox,
  breitePx: number,
  hoehePx: number,
  land = 'hessen',
  cacheSchluessel?: string,
): Promise<{ daten: Buffer; leer: boolean; layer: string; bezeichnung: string }> {
  const k = geoKonfig(land);
  const spann = Math.max(bbox.maxE - bbox.minE, bbox.maxN - bbox.minN);
  const stufe = k.karte.kaskade.find((s) => spann <= s.bisSpannM) ?? k.karte.kaskade[k.karte.kaskade.length - 1];
  const r = await kachel(
    {
      url: k.karte.url,
      layer: stufe.layer,
      version: k.karte.version,
      format: k.karte.format,
      crs: k.karte.crs,
      bbox,
      breitePx,
      hoehePx,
    },
    {
      // Kartenkacheln sind PNG und duerfen legitim fast leer sein (weisse
      // Flaeche) — darum eine deutlich niedrigere Schwelle.
      leerbildBytes: 700,
      maxParallel: k.orthophoto.maxParallel,
      userAgent: k.geokodierung.userAgent,
      cacheSchluessel,
    },
  );
  return { daten: r.daten, leer: r.leer, layer: stufe.layer, bezeichnung: stufe.bezeichnung };
}
