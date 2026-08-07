/**
 * Laedt die Geodaten-Konfiguration je Bundesland.
 * Architekturvorgabe des Lastenhefts: pro Bundesland eine Konfigurationsdatei,
 * gleiche Pipeline. Neue Laender brauchen also nur config/geodata.<code>.json.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface GeoKonfig {
  bundesland: string;
  name: string;
  epsg: number;
  stand: string;
  hinweis?: string;
  geokodierung: { art: string; url: string; drosselMs: number; userAgent: string; hinweis?: string; lizenz: string };
  orthophoto: {
    art: string;
    url: string;
    layer: string;
    version: string;
    format: string;
    crs: string;
    maxPixel: number;
    bodenaufloesungM: number;
    leerbildBytes: number;
    maxParallel: number;
    lizenz: string;
    quellenvermerk: string;
    hinweis?: string;
  };
  karte: {
    art: string;
    url: string;
    version: string;
    crs: string;
    format: string;
    kaskade: { bisSpannM: number; layer: string; bezeichnung: string }[];
    lizenz: string;
    quellenvermerk: string;
    hinweis?: string;
  };
  flurstuecke: {
    art: string;
    url: string;
    version: string;
    typenameFlurstueck: string;
    typenameGebaeude: string;
    srsName: string;
    bboxAchsen: string;
    maxFeatures: number;
    lizenz: string;
    quellenvermerk: string;
    hinweis?: string;
  };
  gebaeude3d: {
    art: string;
    urlMuster: string;
    datumFormat: string;
    crs: string;
    kreise: { name: string; datei: string; groesseMb?: number }[];
    attribute: Record<string, string>;
    lizenz: string;
    quellenvermerk: string;
    hinweis?: string;
  };
  gelaendehoehen: {
    art: string;
    quelleBevorzugt: string;
    quelleFallback: string;
    hinweis: string;
    importFormate: string[];
    lizenz: string;
    quellenvermerk: string;
  };
  rechtsgrundlagen: { regelwerk: string; datei: string };
}

const cache = new Map<string, GeoKonfig>();

export function geoKonfig(land = 'hessen'): GeoKonfig {
  const schluessel = land.toLowerCase();
  const vorhanden = cache.get(schluessel);
  if (vorhanden) return vorhanden;
  const datei = path.resolve(process.cwd(), 'config', `geodata.${schluessel}.json`);
  if (!fs.existsSync(datei)) {
    throw new Error(
      `Keine Geodaten-Konfiguration fuer „${land}“ gefunden (erwartet: ${datei}). ` +
        `Weitere Bundeslaender werden durch Anlegen einer solchen Datei aktiviert.`,
    );
  }
  const k = JSON.parse(fs.readFileSync(datei, 'utf8')) as GeoKonfig;
  cache.set(schluessel, k);
  return k;
}

export function verfuegbareLaender(): string[] {
  const dir = path.resolve(process.cwd(), 'config');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^geodata\.(.+)\.json$/.exec(f)?.[1])
    .filter(Boolean) as string[];
}

/** Datum im Downloadcenter-Format JJJJMMTT (der Pfad enthaelt das Tagesdatum). */
export function heuteKompakt(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
