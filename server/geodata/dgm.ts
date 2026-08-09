/**
 * DGM1 — das amtliche Gelaendemodell in seiner ECHTEN Aufloesung.
 *
 * WAS SICH HIER AENDERT (09.08.2026):
 * Bisher wurden die Hoehen auf ein 4,7-m-Gitter heruntergerechnet und dabei
 * geglaettet — aus einem 1-m-Modell wurde eine weiche Decke, unter der jede
 * Kante verschwand (Begruendung und Messwerte: docs/BAUWERKSMODELL.md, 1).
 * Ab hier wird das Raster in seiner Aufloesung uebernommen und binaer
 * gespeichert.
 *
 * SPEICHERDISZIPLIN: Die Darmstaedter DGM1-Lieferung ist ein ZIP von 349 MB
 * mit 160 Kacheln. Es wird NICHT als Ganzes gelesen. Aus dem Zentralverzeichnis
 * am Dateiende werden die Eintraege bestimmt, danach werden ausschliesslich die
 * Kacheln entpackt, die das Zielgebiet beruehren — bei 1 km2 Gebiet sind das
 * ein bis vier. Der Einbruch beim LoD2-Import („Cannot create a string longer
 * than 0x1fffffe8", 08.08.2026) kam genau daher, dass ein Archiv vollstaendig
 * in den Speicher gelegt wurde; dieser Weg wird hier von vornherein vermieden.
 *
 * QUELLE (verifiziert 08.08.2026, docs/DATENQUELLEN.md):
 * https://gds.hessen.de/downloadcenter/<JJJJMMTT>/3D-Daten/
 *   Digitales%20Gel%C3%A4ndemodell%20(DGM1)/<Kreis>/<Gemeinde>%20-%20DGM1.zip
 * Kacheln: dgm1_32_<Ekm>_<Nkm>_1_he.tif — 1 km2, GeoTIFF float32, 1 m,
 * EPSG:25832, Fehlwert -9999.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { BBox } from '../../shared/domain/types.ts';
import { Hoehenraster, KEIN_WERT } from '../../shared/geo/raster.ts';
import { tiffLesen } from './geotiff.ts';

/** Fehlwert der hessischen Lieferung. */
const FEHLWERT_STANDARD = -9999;

export interface DgmQuelle {
  art: 'zip' | 'ordner';
  pfad: string;
  beschreibung: string;
}

export interface RasterErgebnis {
  raster: Hoehenraster;
  quelle: DgmQuelle;
  /** Namen der tatsaechlich verwendeten Kacheln — gehoert in den Nachweis. */
  kacheln: string[];
  /** Zellen ohne Wert nach dem Zusammensetzen. */
  ohneWert: number;
  /** Zellen, die aus der Nachbarschaft ergaenzt wurden (Naeherung!). */
  gefuellt: number;
}

// ---------------------------------------------------------------------------
// ZIP: nur lesen, was gebraucht wird
// ---------------------------------------------------------------------------

interface ZipEintrag {
  name: string;
  komprimiert: number;
  csize: number;
  usize: number;
  lokalerKopf: number;
}

function zipVerzeichnis(datei: string): ZipEintrag[] {
  const fd = fs.openSync(datei, 'r');
  try {
    const groesse = fs.fstatSync(fd).size;
    // Das Ende-Zentralverzeichnis steht am Dateiende; der Kommentar davor darf
    // bis 64 KB lang sein.
    const schwanzLaenge = Math.min(groesse, 66_000);
    const schwanz = Buffer.allocUnsafe(schwanzLaenge);
    fs.readSync(fd, schwanz, 0, schwanzLaenge, groesse - schwanzLaenge);
    let p = schwanz.length - 22;
    while (p >= 0 && schwanz.readUInt32LE(p) !== 0x06054b50) p--;
    if (p < 0) throw new Error(`${path.basename(datei)}: kein ZIP-Zentralverzeichnis gefunden.`);
    const anzahl = schwanz.readUInt16LE(p + 10);
    const vzGroesse = schwanz.readUInt32LE(p + 12);
    const vzVersatz = schwanz.readUInt32LE(p + 16);

    const vz = Buffer.allocUnsafe(vzGroesse);
    fs.readSync(fd, vz, 0, vzGroesse, vzVersatz);

    const eintraege: ZipEintrag[] = [];
    let o = 0;
    for (let i = 0; i < anzahl && o + 46 <= vz.length; i++) {
      if (vz.readUInt32LE(o) !== 0x02014b50) break;
      const nlen = vz.readUInt16LE(o + 28);
      const elen = vz.readUInt16LE(o + 30);
      const klen = vz.readUInt16LE(o + 32);
      eintraege.push({
        name: vz.toString('latin1', o + 46, o + 46 + nlen),
        komprimiert: vz.readUInt16LE(o + 10),
        csize: vz.readUInt32LE(o + 20),
        usize: vz.readUInt32LE(o + 24),
        lokalerKopf: vz.readUInt32LE(o + 42),
      });
      o += 46 + nlen + elen + klen;
    }
    return eintraege;
  } finally {
    fs.closeSync(fd);
  }
}

function zipEintragLesen(datei: string, e: ZipEintrag): Buffer {
  const fd = fs.openSync(datei, 'r');
  try {
    const kopf = Buffer.allocUnsafe(30);
    fs.readSync(fd, kopf, 0, 30, e.lokalerKopf);
    if (kopf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${e.name}: lokaler ZIP-Kopf fehlt.`);
    const nlen = kopf.readUInt16LE(26);
    const elen = kopf.readUInt16LE(28);
    const daten = Buffer.allocUnsafe(e.csize);
    fs.readSync(fd, daten, 0, e.csize, e.lokalerKopf + 30 + nlen + elen);
    if (e.komprimiert === 0) return daten;
    if (e.komprimiert === 8) return zlib.inflateRawSync(daten, { maxOutputLength: 256 * 1024 * 1024 });
    throw new Error(`${e.name}: ZIP-Kompression ${e.komprimiert} wird nicht unterstuetzt.`);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Quelle finden
// ---------------------------------------------------------------------------

/**
 * Sucht eine DGM1-Quelle. Reihenfolge:
 *  1. HEINERFEST_DGM1 (Datei oder Ordner) — der ausdrueckliche Wille des Nutzers
 *  2. data/cache/dgm1/*.zip — was frueher schon geholt wurde
 *  3. data/cache/dgm1/ als Ordner mit .tif-Kacheln
 * Kein Treffer heisst NICHT „kein Gelaende": der Aufrufer faellt dann auf die
 * LoD2-Bodenhoehen zurueck und schreibt das in den Nachweis.
 */
export function quelleErmitteln(datenWurzel: string): DgmQuelle | null {
  const vorgabe = process.env.HEINERFEST_DGM1;
  if (vorgabe && fs.existsSync(vorgabe)) {
    const st = fs.statSync(vorgabe);
    return st.isDirectory()
      ? { art: 'ordner', pfad: vorgabe, beschreibung: `DGM1-Ordner (HEINERFEST_DGM1): ${vorgabe}` }
      : { art: 'zip', pfad: vorgabe, beschreibung: `DGM1-Archiv (HEINERFEST_DGM1): ${path.basename(vorgabe)}` };
  }
  const ordner = path.join(datenWurzel, 'cache', 'dgm1');
  if (!fs.existsSync(ordner)) return null;
  const dateien = fs.readdirSync(ordner);
  const zip = dateien.find((d) => d.toLowerCase().endsWith('.zip'));
  if (zip) {
    return { art: 'zip', pfad: path.join(ordner, zip), beschreibung: `DGM1-Archiv aus dem Zwischenspeicher: ${zip}` };
  }
  if (dateien.some((d) => d.toLowerCase().endsWith('.tif'))) {
    return { art: 'ordner', pfad: ordner, beschreibung: 'DGM1-Kacheln aus dem Zwischenspeicher' };
  }
  return null;
}

/**
 * Liest aus dem Kachelnamen die Lage: `dgm1_32_475_5524_1_he.tif` steht fuer
 * Zone 32, Ostwert 475 km, Nordwert 5524 km, Rasterweite 1 m.
 *
 * Der Name dient nur der VORAUSWAHL. Wo eine Kachel wirklich liegt, sagt ihre
 * eigene Georeferenz (ModelTiepoint) — ein Dateiname ist eine Behauptung, der
 * Bindepunkt eine Angabe des Datensatzes.
 */
function lageAusName(name: string): { minE: number; minN: number; kmE: number; kmN: number } | null {
  const m = /_(\d{2})_(\d{3,4})_(\d{4})_(\d+)_/.exec(path.basename(name));
  if (!m) return null;
  const kmE = Number(m[2]);
  const kmN = Number(m[3]);
  if (!Number.isFinite(kmE) || !Number.isFinite(kmN)) return null;
  return { minE: kmE * 1000, minN: kmN * 1000, kmE, kmN };
}

// ---------------------------------------------------------------------------
// Raster fuer ein Gebiet zusammensetzen
// ---------------------------------------------------------------------------

/**
 * Baut das Hoehenraster fuer ein Gebiet aus den DGM1-Kacheln.
 *
 * @param randM Zuschlag rundum. Die Stadtdetails reichen 50 m ueber das Gebiet
 *   hinaus (RAND_M in stadtdetails.ts); ohne denselben Zuschlag stuende ein
 *   Baum am Gebietsrand auf einem Ersatzwert.
 */
export function rasterFuerGebiet(
  quelle: DgmQuelle,
  bbox: BBox,
  opts: { zellM?: number; randM?: number; bericht?: (text: string) => void } = {},
): RasterErgebnis {
  const zellM = opts.zellM ?? 1;
  const rand = opts.randM ?? 60;
  const ziel: BBox = {
    minE: Math.floor((bbox.minE - rand) / zellM) * zellM,
    minN: Math.floor((bbox.minN - rand) / zellM) * zellM,
    maxE: Math.ceil((bbox.maxE + rand) / zellM) * zellM,
    maxN: Math.ceil((bbox.maxN + rand) / zellM) * zellM,
  };
  const raster = Hoehenraster.leer(ziel, zellM);
  const benutzt: string[] = [];

  // --- Kandidaten bestimmen ------------------------------------------------
  interface Kachel {
    name: string;
    lies: () => Buffer;
  }
  const alle: Kachel[] = [];
  if (quelle.art === 'zip') {
    for (const e of zipVerzeichnis(quelle.pfad)) {
      if (!e.name.toLowerCase().endsWith('.tif')) continue;
      alle.push({ name: e.name, lies: () => zipEintragLesen(quelle.pfad, e) });
    }
  } else {
    for (const d of fs.readdirSync(quelle.pfad)) {
      if (!d.toLowerCase().endsWith('.tif')) continue;
      const p = path.join(quelle.pfad, d);
      alle.push({ name: d, lies: () => fs.readFileSync(p) });
    }
  }
  if (!alle.length) throw new Error(`${quelle.beschreibung}: keine .tif-Kacheln gefunden.`);

  // Vorauswahl ueber den Namen. Kacheln ohne deutbaren Namen bleiben drin —
  // lieber langsamer als unvollstaendig.
  const kandidaten = alle.filter((k) => {
    const l = lageAusName(k.name);
    if (!l) return true;
    return !(l.minE + 1000 <= ziel.minE || l.minE >= ziel.maxE || l.minN + 1000 <= ziel.minN || l.minN >= ziel.maxN);
  });
  const unbenannt = kandidaten.filter((k) => !lageAusName(k.name)).length;
  if (unbenannt) {
    opts.bericht?.(`${unbenannt} DGM1-Kacheln ohne deutbaren Namen — sie werden alle gelesen (langsamer).`);
  }

  // --- Kacheln einsetzen ---------------------------------------------------
  for (const k of kandidaten) {
    let bild;
    try {
      bild = tiffLesen(k.lies());
    } catch (e) {
      opts.bericht?.(`Kachel ${k.name} nicht lesbar: ${(e as Error).message}`);
      continue;
    }
    const westen = bild.ursprungE - bild.pixelE / 2;
    const norden = bild.ursprungN + bild.pixelN / 2;
    const osten = westen + bild.breite * bild.pixelE;
    const sueden = norden - bild.hoehe * bild.pixelN;
    if (osten <= ziel.minE || westen >= ziel.maxE || norden <= ziel.minN || sueden >= ziel.maxN) continue;

    let gesetzt = 0;
    // Ueber die ZIELZELLEN laufen, nicht ueber die Kachelpunkte: so ist der
    // Einbau unabhaengig davon, ob Kachel- und Zielraster deckungsgleich sind
    // (bei zellM = 1 sind sie es, bei 0,5 m Ziel waeren sie es nicht).
    const sVon = Math.max(0, Math.floor((westen - ziel.minE) / zellM));
    const sBis = Math.min(raster.kopf.spalten - 1, Math.ceil((osten - ziel.minE) / zellM));
    const zVon = Math.max(0, Math.floor((sueden - ziel.minN) / zellM));
    const zBis = Math.min(raster.kopf.zeilen - 1, Math.ceil((norden - ziel.minN) / zellM));
    for (let z = zVon; z <= zBis; z++) {
      for (let s = sVon; s <= sBis; s++) {
        const [e, n] = raster.zellMitte(s, z);
        const bx = Math.floor((e - westen) / bild.pixelE);
        // Bildzeile 0 liegt im NORDEN — hier wird gespiegelt, damit im ganzen
        // Programm nur eine Leserichtung gilt (Zeile 0 = Sueden).
        const by = Math.floor((norden - n) / bild.pixelN);
        if (bx < 0 || by < 0 || bx >= bild.breite || by >= bild.hoehe) continue;
        const h = bild.werte[by * bild.breite + bx];
        if (!Number.isFinite(h)) continue;
        if (h === (bild.fehlwert ?? FEHLWERT_STANDARD)) continue;
        if (h < -200 || h > 3000) continue; // Deutschland: -3,5 bis 2962 m
        raster.setze(s, z, h);
        gesetzt++;
      }
    }
    if (gesetzt) {
      benutzt.push(k.name);
      opts.bericht?.(`Kachel ${k.name}: ${gesetzt.toLocaleString('de-DE')} Hoehenwerte uebernommen.`);
    }
  }

  if (!benutzt.length) throw new Error('Keine DGM1-Kachel deckt das Zielgebiet ab.');

  const vorher = raster.statistik().ohneWert;
  const gefuellt = vorher ? raster.luecken_fuellen() : 0;
  const nachher = raster.statistik().ohneWert;

  return { raster, quelle, kacheln: benutzt.sort(), ohneWert: nachher, gefuellt };
}

// ---------------------------------------------------------------------------
// Rueckfallweg und manueller Import
// ---------------------------------------------------------------------------

/**
 * Raster aus verstreuten Stuetzpunkten (LoD2-Bodenhoehen), wenn kein DGM
 * vorliegt.
 *
 * EHRLICHKEIT: Das Ergebnis hat die Zellgroesse eines DGM, aber nicht dessen
 * Aussagekraft — zwischen den Gebaeuden ist es geraten. Es traegt deshalb
 * `hoehenHerkunft = 'lod2_interpoliert'`, und die Oberflaeche muss das zeigen.
 * Die feine Zellgroesse ist trotzdem richtig: sie erlaubt, dass spaeter
 * Bauklassen und Bruchkanten echte Kanten hineinschreiben.
 */
export function rasterAusStuetzpunkten(
  bbox: BBox,
  punkte: { e: number; n: number; h: number }[],
  opts: { zellM?: number; randM?: number } = {},
): Hoehenraster {
  const zellM = opts.zellM ?? 1;
  const rand = opts.randM ?? 60;
  const ziel: BBox = {
    minE: Math.floor((bbox.minE - rand) / zellM) * zellM,
    minN: Math.floor((bbox.minN - rand) / zellM) * zellM,
    maxE: Math.ceil((bbox.maxE + rand) / zellM) * zellM,
    maxN: Math.ceil((bbox.maxN + rand) / zellM) * zellM,
  };
  const raster = Hoehenraster.leer(ziel, zellM);
  if (!punkte.length) return raster;

  // Gitterindex ueber die Stuetzpunkte — ohne ihn waeren es bei 1 Mio. Zellen
  // und 2.500 Stuetzpunkten 2,5 Mrd. Abstandsrechnungen.
  const ZELLE = 100;
  const index = new Map<string, { e: number; n: number; h: number }[]>();
  for (const p of punkte) {
    const s = `${Math.floor(p.e / ZELLE)}:${Math.floor(p.n / ZELLE)}`;
    const liste = index.get(s);
    if (liste) liste.push(p);
    else index.set(s, [p]);
  }

  for (let z = 0; z < raster.kopf.zeilen; z++) {
    for (let s = 0; s < raster.kopf.spalten; s++) {
      const [e, n] = raster.zellMitte(s, z);
      const ce = Math.floor(e / ZELLE);
      const cn = Math.floor(n / ZELLE);
      let nah: { e: number; n: number; h: number }[] = [];
      for (let ring = 0; ring <= 6 && nah.length < 6; ring++) {
        nah = [];
        for (let de = -ring; de <= ring; de++) {
          for (let dn = -ring; dn <= ring; dn++) {
            const liste = index.get(`${ce + de}:${cn + dn}`);
            if (liste) nah.push(...liste);
          }
        }
      }
      if (!nah.length) {
        raster.setze(s, z, KEIN_WERT);
        continue;
      }
      nah.sort((a, b) => (a.e - e) ** 2 + (a.n - n) ** 2 - ((b.e - e) ** 2 + (b.n - n) ** 2));
      let zaehler = 0;
      let nenner = 0;
      let treffer = KEIN_WERT;
      for (const p of nah.slice(0, 8)) {
        const d2 = (p.e - e) ** 2 + (p.n - n) ** 2;
        if (d2 < 1e-6) {
          treffer = p.h;
          break;
        }
        const w = 1 / d2;
        zaehler += w * p.h;
        nenner += w;
      }
      raster.setze(s, z, Number.isFinite(treffer) ? treffer : nenner > 0 ? zaehler / nenner : KEIN_WERT);
    }
  }
  return raster;
}

/**
 * Manueller Import eines Hoehenmodells als XYZ-Liste oder ESRI-ASCII-Raster.
 * Der Weg bleibt erhalten (Lastenheft-Rueckfallweg), liefert jetzt aber ein
 * echtes Raster statt geglaetteter Gitterpunkte.
 */
export function rasterAusText(inhalt: string, bbox: BBox, zellM = 1): { raster: Hoehenraster; punkte: number } {
  const punkte: { e: number; n: number; h: number }[] = [];

  if (/^\s*ncols/i.test(inhalt)) {
    const zeilen = inhalt.split(/\r?\n/);
    const kopf: Record<string, number> = {};
    let i = 0;
    for (; i < zeilen.length; i++) {
      const m = /^\s*(\w+)\s+(-?[\d.]+)/.exec(zeilen[i]);
      if (!m) break;
      kopf[m[1].toLowerCase()] = Number(m[2]);
    }
    const { ncols, nrows, xllcorner, yllcorner, cellsize } = kopf;
    const fehlwert = kopf.nodata_value ?? FEHLWERT_STANDARD;
    for (let z = 0; z < nrows; z++) {
      const werte = (zeilen[i + z] ?? '').trim().split(/\s+/).map(Number);
      for (let s = 0; s < ncols; s++) {
        const h = werte[s];
        if (!Number.isFinite(h) || h === fehlwert) continue;
        punkte.push({ e: xllcorner + (s + 0.5) * cellsize, n: yllcorner + (nrows - z - 0.5) * cellsize, h });
      }
    }
  } else {
    for (const zeile of inhalt.split(/\r?\n/)) {
      const t = zeile.trim();
      if (!t || t.startsWith('#')) continue;
      const [e, n, h] = t.split(/[\s;,]+/).map(Number);
      if (Number.isFinite(e) && Number.isFinite(n) && Number.isFinite(h) && h !== FEHLWERT_STANDARD) {
        punkte.push({ e, n, h });
      }
    }
  }
  if (punkte.length < 3) {
    throw new Error('Die Datei enthaelt keine auswertbaren Hoehenpunkte (erwartet XYZ oder ESRI-ASCII-Raster).');
  }

  // Liegt die Punktdichte bei der Zielzellgroesse, werden die Punkte direkt
  // eingesetzt — sonst wuerde eine Interpolation ein 1-m-Modell wieder
  // weichzeichnen, also genau den Fehler wiederholen, der hier behoben wird.
  const raster = rasterAusStuetzpunkten(bbox, punkte, { zellM });
  return { raster, punkte: punkte.length };
}
