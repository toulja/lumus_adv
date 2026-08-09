/**
 * Misst die TATSAECHLICHE Dachfarbe jedes Gebaeudes aus dem DOP20-Orthophoto.
 *
 * Bisher wurden Dachtoene deterministisch aus Dachform und Gebaeude-Id
 * gewaehlt — plausibel, aber erfunden. Dabei liegt das amtliche Luftbild
 * (0,2 m Bodenaufloesung) bereits als Gelaendetextur vor: von oben gesehen IST
 * der Grundriss das Dach. Die Medianfarbe aller Orthophoto-Pixel im Grundriss
 * ist darum eine MESSUNG der Dachfarbe — ein rotes Ziegeldach ist im Modell
 * rot, weil es rot ist.
 *
 * Der Median (je Kanal) haelt Stoerer heraus: uebergehende Baumkronen,
 * Gauben-Schatten, Dachfenster. Die Einordnung ins Farbsystem passiert weiter
 * clientseitig (insBasisband drueckt Saettigung/Helligkeit ins Basisband der
 * Palette) — der FARBTON bleibt der gemessene.
 *
 * Quelle: (c) HVBG, DOP20 (Datenlizenz Deutschland — Zero 2.0).
 */

import fs from 'node:fs';
import { decode } from 'jpeg-js';
import type { Gelaende } from '../../shared/domain/types.ts';
import { punktInRing } from '../../shared/geo/geometry.ts';
import { gelaende as gelaendeStore } from '../lib/store.ts';

interface KachelBild {
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
  breite: number;
  hoehe: number;
  daten: Uint8Array; // RGBA
}

/** Mindestzahl an Dachpixeln, unter der keine Aussage getroffen wird. */
const MIN_PROBEN = 12;

/**
 * Laedt und dekodiert eine Gelaendetextur. Die Georeferenz kommt aus der
 * Patch-bbox — die Kacheln sind NICHT quadratisch (typisch 300 x 333 m bei
 * quadratischem Pixelbild), E- und N-Massstab sind daher getrennt zu rechnen.
 */
function ladeKachel(gelaendeId: string, bbox: { minE: number; minN: number; maxE: number; maxN: number }, datei: string): KachelBild | null {
  let pfad: string;
  try {
    pfad = gelaendeStore.texturPfad(gelaendeId, datei);
  } catch {
    return null;
  }
  if (!fs.existsSync(pfad)) return null;
  try {
    const bild = decode(fs.readFileSync(pfad), { useTArray: true, formatAsRGBA: true });
    return {
      minE: bbox.minE,
      minN: bbox.minN,
      maxE: bbox.maxE,
      maxN: bbox.maxN,
      breite: bild.width,
      hoehe: bild.height,
      daten: bild.data as Uint8Array,
    };
  } catch {
    return null;
  }
}

function median(werte: number[]): number {
  const s = [...werte].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Misst die Dachfarben und schreibt sie als `dachFarbe` an die Gebaeude.
 * Vorhandene OSM-Farben werden ueberschrieben — eine Messung schlaegt eine
 * Fremdangabe. Gibt die Bilanz zurueck; speichert NICHT selbst.
 */
export function dachfarbenMessen(g: Gelaende): { gemessen: number; uebersprungen: number } {
  const kacheln: KachelBild[] = [];
  for (const p of g.patches) {
    if (p.texturDatei) {
      const k = ladeKachel(g.id, p.bbox, p.texturDatei);
      if (k) kacheln.push(k);
    }
  }
  if (!kacheln.length) return { gemessen: 0, uebersprungen: g.gebaeude.length };

  const farbeBei = (e: number, n: number): [number, number, number] | null => {
    for (const k of kacheln) {
      if (e < k.minE || e >= k.maxE || n <= k.minN || n > k.maxN) continue;
      const sp = Math.min(k.breite - 1, Math.floor(((e - k.minE) / (k.maxE - k.minE)) * k.breite));
      const ze = Math.min(k.hoehe - 1, Math.floor(((k.maxN - n) / (k.maxN - k.minN)) * k.hoehe));
      const i = (ze * k.breite + sp) * 4;
      return [k.daten[i], k.daten[i + 1], k.daten[i + 2]];
    }
    return null;
  };

  let gemessen = 0;
  let uebersprungen = 0;
  for (const geb of g.gebaeude) {
    const ring = geb.grundriss;
    if (ring.length < 3) {
      uebersprungen++;
      continue;
    }
    let minE = Infinity;
    let minN = Infinity;
    let maxE = -Infinity;
    let maxN = -Infinity;
    for (const [e, n] of ring) {
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
    }
    // Probenraster: fein genug fuer kleine Daecher, gedeckelt fuer grosse
    // (ein 50x50-m-Dach braucht keine 60.000 Proben fuer einen Median).
    const schritt = Math.max(0.4, Math.min(2, Math.sqrt((maxE - minE) * (maxN - minN)) / 24));
    const r: number[] = [];
    const gn: number[] = [];
    const b: number[] = [];
    for (let e = minE + schritt / 2; e <= maxE; e += schritt) {
      for (let n = minN + schritt / 2; n <= maxN; n += schritt) {
        if (!punktInRing([e, n], ring)) continue;
        const farbe = farbeBei(e, n);
        if (!farbe) continue;
        r.push(farbe[0]);
        gn.push(farbe[1]);
        b.push(farbe[2]);
      }
    }
    if (r.length < MIN_PROBEN) {
      uebersprungen++;
      continue;
    }
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    geb.dachFarbe = `#${hex(median(r))}${hex(median(gn))}${hex(median(b))}`;
    gemessen++;
  }
  return { gemessen, uebersprungen };
}
