/**
 * Adress-Suche. Entwicklungsbetrieb ueber OSM Nominatim mit Drossel und
 * Dateicache — die Nominatim-Policy erlaubt hoechstens etwa eine Anfrage je
 * Sekunde und verlangt einen aussagekraeftigen User-Agent.
 */

import type { LonLat, Punkt } from '../../shared/domain/types.ts';
import { nachUtm } from '../../shared/geo/proj.ts';
import { cache } from '../lib/store.ts';
import { geoKonfig } from './konfig.ts';

export interface Fundstelle {
  label: string;
  lon: number;
  lat: number;
  /** EPSG:25832 */
  e: number;
  n: number;
  typ: string;
  /** Umgrenzung des Treffers, falls der Dienst eine liefert. */
  bbox4326?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

const CACHE_DATEI = 'geocode.json';
let speicher = cache.jsonLesen<Record<string, Fundstelle[]>>({}, CACHE_DATEI);
let speicherTimer: NodeJS.Timeout | null = null;

function sichern() {
  if (speicherTimer) return;
  speicherTimer = setTimeout(() => {
    speicherTimer = null;
    cache.jsonSchreiben(speicher, CACHE_DATEI);
  }, 1500);
}

let warteschlange: Promise<unknown> = Promise.resolve();
let letzterAufruf = 0;

function gedrosselt<T>(fn: () => Promise<T>, abstandMs: number): Promise<T> {
  const lauf = async (): Promise<T> => {
    const warten = Math.max(0, letzterAufruf + abstandMs - Date.now());
    if (warten) await new Promise((r) => setTimeout(r, warten));
    letzterAufruf = Date.now();
    return fn();
  };
  const p = warteschlange.then(lauf, lauf);
  warteschlange = p.catch(() => {});
  return p;
}

export async function suche(text: string, land = 'hessen'): Promise<Fundstelle[]> {
  const frage = text.trim();
  if (frage.length < 3) return [];
  const schluessel = frage.toLowerCase();
  const gecacht = speicher[schluessel];
  if (gecacht) return gecacht;

  const k = geoKonfig(land).geokodierung;
  const url =
    `${k.url}?format=jsonv2&limit=8&countrycodes=de&addressdetails=0&q=` + encodeURIComponent(frage);
  const res = await gedrosselt(() => fetch(url, { headers: { 'User-Agent': k.userAgent } }), k.drosselMs);
  if (!res.ok) throw new Error(`Adress-Suche nicht erreichbar (HTTP ${res.status}).`);
  const daten = (await res.json()) as {
    display_name: string;
    lon: string;
    lat: string;
    type: string;
    boundingbox?: string[];
  }[];

  const treffer: Fundstelle[] = daten.map((r) => {
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    const [e, n] = nachUtm([lon, lat]);
    const bb = r.boundingbox?.map(Number);
    return {
      label: r.display_name,
      lon,
      lat,
      e: Math.round(e * 100) / 100,
      n: Math.round(n * 100) / 100,
      typ: r.type,
      bbox4326:
        bb && bb.length === 4
          ? { minLat: bb[0], maxLat: bb[1], minLon: bb[2], maxLon: bb[3] }
          : undefined,
    };
  });
  speicher[schluessel] = treffer;
  sichern();
  return treffer;
}

/** Einzelnen Treffer als UTM-Punkt — Bequemlichkeit fuer Skripte. */
export async function punktFuer(text: string): Promise<Punkt | null> {
  const t = await suche(text);
  if (!t.length) return null;
  return [t[0].e, t[0].n];
}

export function alsLonLat(f: Fundstelle): LonLat {
  return [f.lon, f.lat];
}
