/**
 * Minimaler GeoTIFF-Leser fuer HOEHENRASTER.
 *
 * WARUM SELBST GESCHRIEBEN: Gebraucht wird genau ein Fall — das amtliche DGM1
 * als einkanaliges Gleitkommabild mit Georeferenz. Eine allgemeine
 * Bildbibliothek dafuer ins Projekt zu holen, hiesse mehrere Megabyte
 * Abhaengigkeit fuer ein Prozent ihres Umfangs; das Lastenheft verlangt
 * ausdruecklich die einfachste Loesung, die traegt (ARCHITEKTUR.md, 2.6 zieht
 * fuer die Luftbilder dieselbe Linie).
 *
 * NACHGEMESSEN am hessischen DGM1 (Kachel dgm1_32_475_5524_1_he.tif,
 * 09.08.2026): 1000 x 1000 Bildpunkte, BitsPerSample 32, SampleFormat 3
 * (Gleitkomma), Compression 5 (LZW), Predictor 2, RowsPerStrip 2, also 500
 * Streifen, PlanarConfig 1, PixelScale 1/1/0. Genau das kann dieser Leser —
 * und zusaetzlich Deflate, unkomprimiert, Kachelaufteilung sowie
 * Ganzzahlkanaele, weil andere Laender ihre Modelle anders schreiben.
 *
 * Was er NICHT kann und auch nicht koennen soll: JPEG-Kompression, mehrere
 * Kanaele, Farbtabellen, BigTIFF. Trifft er darauf, sagt er es mit einem
 * klaren Fehlertext, statt stillschweigend Unsinn zu liefern.
 */

import zlib from 'node:zlib';

export interface TiffBild {
  breite: number;
  hoehe: number;
  /** Zeile 0 liegt OBEN (Bildkonvention), Werte zeilenweise. */
  werte: Float32Array;
  /** Georeferenz: Weltkoordinate der MITTE des Bildpunkts (0,0). */
  ursprungE: number;
  ursprungN: number;
  /** Bildpunktgroesse in Metern. */
  pixelE: number;
  pixelN: number;
  /** Fehlwert aus dem GDAL-Tag, falls gesetzt. */
  fehlwert: number | null;
}

interface Eintrag {
  typ: number;
  anzahl: number;
  werte: number[];
  /** Nur bei Typ 2 (ASCII) — z. B. der Fehlwert im GDAL-Tag 42113. */
  text?: string;
}

const TYP_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function eintraegeLesen(b: Buffer): Map<number, Eintrag> {
  const kennung = b.toString('latin1', 0, 2);
  if (kennung !== 'II' && kennung !== 'MM') throw new Error('Keine TIFF-Datei (Kennung fehlt).');
  const le = kennung === 'II';
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  if (u16(2) === 43) throw new Error('BigTIFF wird nicht unterstuetzt.');
  if (u16(2) !== 42) throw new Error('Unbekannte TIFF-Version.');

  const eintraege = new Map<number, Eintrag>();
  const ifd = u32(4);
  const anzahl = u16(ifd);
  for (let i = 0; i < anzahl; i++) {
    const o = ifd + 2 + i * 12;
    const tag = u16(o);
    const typ = u16(o + 2);
    const n = u32(o + 4);
    const groesse = (TYP_BYTES[typ] ?? 1) * n;
    const quelle = groesse <= 4 ? o + 8 : u32(o + 8);
    const werte: number[] = [];
    let text: string | undefined;
    // Zeichenketten werden als solche gelesen (der Fehlwert steht in einer),
    // Zahlenlisten vollstaendig — Streifenlisten haben regelmaessig mehrere
    // hundert Eintraege, und jeder einzelne wird gebraucht.
    if (typ === 2) {
      text = b.toString('latin1', quelle, quelle + Math.max(0, n - 1));
    } else {
      for (let k = 0; k < n; k++) {
        const p = quelle + k * (TYP_BYTES[typ] ?? 1);
        switch (typ) {
          case 1:
          case 7:
            werte.push(b.readUInt8(p));
            break;
          case 3:
            werte.push(u16(p));
            break;
          case 4:
            werte.push(u32(p));
            break;
          case 5:
            werte.push(u32(p) / (u32(p + 4) || 1));
            break;
          case 11:
            werte.push(le ? b.readFloatLE(p) : b.readFloatBE(p));
            break;
          case 12:
            werte.push(le ? b.readDoubleLE(p) : b.readDoubleBE(p));
            break;
          default:
            werte.push(0);
        }
      }
    }
    eintraege.set(tag, { typ, anzahl: n, werte, text });
  }
  eintraege.set(-1, { typ: 0, anzahl: 0, werte: [le ? 1 : 0] });
  return eintraege;
}

/**
 * LZW nach TIFF-Fassung.
 *
 * Der Unterschied zur GIF-Fassung, an dem Eigenbauten regelmaessig scheitern:
 * TIFF zaehlt die Codebreite EINEN Code FRUEHER hoch („early change"). Wer das
 * uebersieht, bekommt ab Code 511 Datenmuell — und zwar erst mitten im Bild,
 * also genau dann, wenn man es nicht mehr vermutet.
 */
function lzwEntpacken(daten: Buffer, erwartet: number): Buffer {
  const aus = Buffer.allocUnsafe(erwartet);
  let ausPos = 0;
  // Woerterbuch: 4096 Eintraege, jeder ein Byte-Feld. Vorbelegt mit 0..255.
  let woerter: (Buffer | null)[] = new Array(4096);
  const zuruecksetzen = () => {
    woerter = new Array(4096);
    for (let i = 0; i < 256; i++) woerter[i] = Buffer.from([i]);
    return 258;
  };
  let naechster = zuruecksetzen();
  let breite = 9;
  let vorheriger: Buffer | null = null;
  let bitPuffer = 0;
  let bitAnzahl = 0;
  let pos = 0;

  while (ausPos < erwartet) {
    while (bitAnzahl < breite) {
      if (pos >= daten.length) return aus.subarray(0, ausPos);
      bitPuffer = (bitPuffer << 8) | daten[pos++];
      bitAnzahl += 8;
    }
    const code = (bitPuffer >> (bitAnzahl - breite)) & ((1 << breite) - 1);
    bitAnzahl -= breite;

    if (code === 256) {
      naechster = zuruecksetzen();
      breite = 9;
      vorheriger = null;
      continue;
    }
    if (code === 257) break;

    let folge: Buffer;
    if (woerter[code]) {
      folge = woerter[code] as Buffer;
    } else if (vorheriger) {
      folge = Buffer.concat([vorheriger, vorheriger.subarray(0, 1)]);
    } else {
      throw new Error('LZW: ungueltiger Code vor dem ersten Wort.');
    }

    const zu = Math.min(folge.length, erwartet - ausPos);
    folge.copy(aus, ausPos, 0, zu);
    ausPos += zu;

    if (vorheriger && naechster < 4096) {
      woerter[naechster++] = Buffer.concat([vorheriger, folge.subarray(0, 1)]);
    }
    vorheriger = folge;

    // „early change": eine Stufe frueher als die reine Zaehlung nahelegt.
    if (naechster + 1 >= 1 << breite && breite < 12) breite++;
  }
  return aus.subarray(0, ausPos);
}

/**
 * Horizontale Differenzbildung rueckgaengig machen (Predictor 2).
 *
 * libtiff wendet sie auf die ROHEN Abtastwerte an — bei 32 Bit also auf
 * Ganzzahlen, auch wenn der Kanal Gleitkomma fuehrt. Genau so schreibt es der
 * hessische Datensatz. Deshalb wird hier ueber Uint32 summiert und erst danach
 * als Gleitkomma gedeutet; eine Summe ueber Float32 ergaebe Zahlenmuell.
 */
function predictorZwei(zeile: Buffer, bits: number, kanaele: number, breite: number, le: boolean): void {
  if (bits === 8) {
    for (let i = kanaele; i < breite * kanaele; i++) zeile[i] = (zeile[i] + zeile[i - kanaele]) & 0xff;
    return;
  }
  if (bits === 16) {
    const lies = (o: number) => (le ? zeile.readUInt16LE(o) : zeile.readUInt16BE(o));
    const schreib = (o: number, v: number) => (le ? zeile.writeUInt16LE(v, o) : zeile.writeUInt16BE(v, o));
    for (let i = kanaele; i < breite * kanaele; i++) schreib(i * 2, (lies(i * 2) + lies((i - kanaele) * 2)) & 0xffff);
    return;
  }
  if (bits === 32) {
    const lies = (o: number) => (le ? zeile.readUInt32LE(o) : zeile.readUInt32BE(o));
    const schreib = (o: number, v: number) => (le ? zeile.writeUInt32LE(v >>> 0, o) : zeile.writeUInt32BE(v >>> 0, o));
    for (let i = kanaele; i < breite * kanaele; i++) schreib(i * 4, (lies(i * 4) + lies((i - kanaele) * 4)) >>> 0);
    return;
  }
  throw new Error(`Predictor 2 fuer ${bits} Bit nicht unterstuetzt.`);
}

/**
 * Gleitkomma-Predictor (Predictor 3): erst Differenzen ueber Bytes, dann
 * werden die Bytes eines Werts entflochten (alle hoechstwertigen zuerst).
 * GDAL schreibt ihn haeufig fuer Hoehenmodelle — Hessen nicht, andere Laender
 * womoeglich schon.
 */
function predictorDrei(zeile: Buffer, bits: number, kanaele: number, breite: number, le: boolean): void {
  const bytes = bits / 8;
  const anzahl = breite * kanaele;
  for (let i = kanaele; i < anzahl * bytes; i++) zeile[i] = (zeile[i] + zeile[i - kanaele]) & 0xff;
  const kopie = Buffer.from(zeile.subarray(0, anzahl * bytes));
  for (let i = 0; i < anzahl; i++) {
    for (let b = 0; b < bytes; b++) {
      const quelle = b * anzahl + i;
      const ziel = le ? i * bytes + (bytes - 1 - b) : i * bytes + b;
      zeile[ziel] = kopie[quelle];
    }
  }
}

/** Liest ein einkanaliges GeoTIFF-Hoehenbild vollstaendig ein. */
export function tiffLesen(b: Buffer): TiffBild {
  const e = eintraegeLesen(b);
  const le = (e.get(-1)?.werte[0] ?? 1) === 1;
  const eins = (tag: number, ersatz?: number): number => {
    const x = e.get(tag);
    if (!x || !x.werte.length) {
      if (ersatz === undefined) throw new Error(`GeoTIFF: Pflichtangabe ${tag} fehlt.`);
      return ersatz;
    }
    return x.werte[0];
  };

  const breite = eins(256);
  const hoehe = eins(257);
  const bits = eins(258, 8);
  const kompression = eins(259, 1);
  const kanaele = eins(277, 1);
  const planar = eins(284, 1);
  const predictor = eins(317, 1);
  const format = eins(339, 1); // 1 = uint, 2 = int, 3 = float
  if (kanaele !== 1) throw new Error(`GeoTIFF: ${kanaele} Kanaele — erwartet wird ein Hoehenmodell mit genau einem.`);
  if (planar !== 1) throw new Error('GeoTIFF: getrennte Kanalebenen werden nicht unterstuetzt.');
  if (kompression !== 1 && kompression !== 5 && kompression !== 8 && kompression !== 32946) {
    throw new Error(`GeoTIFF: Kompression ${kompression} wird nicht unterstuetzt (erwartet: keine, LZW oder Deflate).`);
  }

  const kachelBreite = e.get(322)?.werte[0];
  const kachelHoehe = e.get(323)?.werte[0];
  const gekachelt = Boolean(kachelBreite && kachelHoehe);
  const versaetze = (gekachelt ? e.get(324) : e.get(273))?.werte ?? [];
  const laengen = (gekachelt ? e.get(325) : e.get(279))?.werte ?? [];
  const zeilenJeStreifen = gekachelt ? (kachelHoehe as number) : eins(278, hoehe);
  if (!versaetze.length) throw new Error('GeoTIFF: keine Bilddaten gefunden.');

  const bytesJeWert = bits / 8;
  const werte = new Float32Array(breite * hoehe);
  werte.fill(NaN);

  const stueckBreite = gekachelt ? (kachelBreite as number) : breite;
  const spaltenStuecke = gekachelt ? Math.ceil(breite / stueckBreite) : 1;

  for (let index = 0; index < versaetze.length; index++) {
    const roh = b.subarray(versaetze[index], versaetze[index] + laengen[index]);
    const zeilen = zeilenJeStreifen;
    const erwartet = stueckBreite * zeilen * kanaele * bytesJeWert;
    let daten: Buffer;
    if (kompression === 1) daten = Buffer.from(roh);
    else if (kompression === 5) daten = lzwEntpacken(roh, erwartet);
    else daten = zlib.inflateSync(roh);

    const stueckSpalte = gekachelt ? index % spaltenStuecke : 0;
    const stueckZeile = gekachelt ? Math.floor(index / spaltenStuecke) : index;

    for (let z = 0; z < zeilen; z++) {
      const bildZeile = stueckZeile * zeilen + z;
      if (bildZeile >= hoehe) break;
      const von = z * stueckBreite * kanaele * bytesJeWert;
      const bis = von + stueckBreite * kanaele * bytesJeWert;
      if (bis > daten.length) break;
      const zeile = daten.subarray(von, bis);
      if (predictor === 2) predictorZwei(zeile, bits, kanaele, stueckBreite, le);
      else if (predictor === 3) predictorDrei(zeile, bits, kanaele, stueckBreite, le);

      for (let s = 0; s < stueckBreite; s++) {
        const bildSpalte = stueckSpalte * stueckBreite + s;
        if (bildSpalte >= breite) break;
        const o = s * bytesJeWert;
        let v: number;
        if (format === 3 && bits === 32) v = le ? zeile.readFloatLE(o) : zeile.readFloatBE(o);
        else if (format === 3 && bits === 64) v = le ? zeile.readDoubleLE(o) : zeile.readDoubleBE(o);
        else if (format === 2 && bits === 16) v = le ? zeile.readInt16LE(o) : zeile.readInt16BE(o);
        else if (format === 2 && bits === 32) v = le ? zeile.readInt32LE(o) : zeile.readInt32BE(o);
        else if (bits === 16) v = le ? zeile.readUInt16LE(o) : zeile.readUInt16BE(o);
        else if (bits === 32) v = le ? zeile.readUInt32LE(o) : zeile.readUInt32BE(o);
        else if (bits === 8) v = zeile[o];
        else throw new Error(`GeoTIFF: ${bits} Bit / Format ${format} wird nicht unterstuetzt.`);
        werte[bildZeile * breite + bildSpalte] = v;
      }
    }
  }

  // --- Georeferenz ---------------------------------------------------------
  const skala = e.get(33550)?.werte ?? [];
  const bindung = e.get(33922)?.werte ?? [];
  const pixelE = skala[0] ?? 1;
  const pixelN = skala[1] ?? 1;
  // ModelTiepoint: (i, j, k, E, N, H). Die Bindung gilt fuer die ECKE des
  // Bildpunkts (i, j) — GeoTIFF nennt das RasterPixelIsArea; die Mitte liegt
  // eine halbe Zelle weiter innen.
  const eckeE = bindung.length >= 6 ? bindung[3] - bindung[0] * pixelE : 0;
  const eckeN = bindung.length >= 6 ? bindung[4] + bindung[1] * pixelN : 0;

  // GDAL schreibt den Fehlwert als Zeichenkette („-9999"). Er wird hier nur
  // gemeldet, nicht angewandt — das Umsetzen auf NaN gehoert an die Stelle, die
  // das Raster zusammensetzt, weil dort auch die Herkunft protokolliert wird.
  const fehlwertRoh = Number.parseFloat((e.get(42113)?.text ?? '').trim());
  const fehlwert = Number.isFinite(fehlwertRoh) ? fehlwertRoh : null;

  return {
    breite,
    hoehe,
    werte,
    ursprungE: eckeE + pixelE / 2,
    ursprungN: eckeN - pixelN / 2,
    pixelE,
    pixelN,
    fehlwert,
  };
}
