/**
 * HOEHENRASTER — das Urgelaende in seiner echten Aufloesung.
 *
 * WARUM DIESE DATEI EXISTIERT (Befund 09.08.2026):
 * Bis hierher wurde das Gelaende als Kachelgitter mit 65 x 65 Stuetzpunkten je
 * 300-m-Kachel gefuehrt — 4,69 x 5,21 m Maschenweite. Das amtliche DGM1 liegt
 * in 1 m vor; beim Import wurde es auf diese Masche heruntergerechnet UND dabei
 * invers-distanzgewichtet ueber acht Nachbarn geglaettet. Damit war jede
 * Gelaendeform, die schmaler ist als rund fuenf Meter, im Modell nicht mehr
 * vorhanden: Bordstein, Stufe, Grabenkante, Bahnsteigkante, Boeschung, Rampe.
 *
 * Alles, was danach kam — Ringverdichtung, Sehnenfehler-Ausgleich, der
 * Millimeter-Hoehenstapel der Bodenzeichnung — war Verwaltung dieses einen
 * Fehlers. Hier liegt die Abhilfe: das Raster behaelt seine Aufloesung.
 *
 * SPEICHERFORM: binaer, nicht JSON. Eine Million Zellen sind als Float32
 * 4 MB; dieselben Zahlen als JSON-Text mit zwei Nachkommastellen sind rund
 * 7 MB und muessen beim Laden zeichenweise geparst werden. Der Browser bekommt
 * den Puffer, legt eine Float32Array darueber und ist fertig.
 *
 * Diese Datei laeuft in Node UND im Browser (keine Node-Module, keine DOM-API).
 */

import type { BBox, Punkt } from '../domain/types.ts';

/** Kennung am Dateianfang. Die Ziffern sind die Formatversion. */
export const RASTER_KENNUNG = 'EP3DHR01';

/** Groesse des Kopfsatzes in Bytes. Vielfaches von 8 — die Float32-Werte
 *  dahinter muessen ausgerichtet liegen, sonst verweigert der Browser die
 *  zeigerfreie Sicht (`new Float32Array(puffer, versatz, n)`). */
const KOPF_BYTES = 48;

/** Fehlwert. NaN und nicht -9999: jede Rechnung damit ist sofort erkennbar
 *  falsch, statt sich als plausible Tiefe zu tarnen. */
export const KEIN_WERT = NaN;

export interface RasterKopf {
  /** Westrand der ersten Spalte (EPSG:25832, Meter). */
  minE: number;
  /** Suedrand der ersten Zeile. */
  minN: number;
  /** Kantenlaenge einer Zelle in Metern (DGM1: 1,0). */
  zellM: number;
  spalten: number;
  zeilen: number;
  epsg: number;
}

const istKleinEndig = (() => {
  const puffer = new ArrayBuffer(4);
  new Uint32Array(puffer)[0] = 1;
  return new Uint8Array(puffer)[0] === 1;
})();

/**
 * Ein regelmaessiges Hoehenraster in EPSG:25832.
 *
 * ZEILENFOLGE: Zeile 0 liegt im SUEDEN, Spalte 0 im WESTEN — dieselbe
 * Vereinbarung wie beim bisherigen `GelaendePatch.hoehen`. GeoTIFF-Kacheln
 * kommen andersherum (Zeile 0 im Norden) und werden beim Einlesen gespiegelt,
 * damit es im ganzen Programm nur EINE Leserichtung gibt.
 *
 * BEZUGSPUNKT: Ein Wert gilt fuer die MITTE seiner Zelle. Das amtliche DGM1
 * sagt das ausdruecklich — der Weltdatei-Eintrag der Kachel
 * dgm1_32_475_5524_1_he nennt als Ursprung 475000,5 / 5524999,5, also die
 * Mitte der Eckzelle. Wer stattdessen die Ecke annimmt, verschiebt das ganze
 * Gelaende um einen halben Meter nach Suedwesten.
 */
export class Hoehenraster {
  readonly kopf: RasterKopf;
  readonly werte: Float32Array;

  constructor(kopf: RasterKopf, werte: Float32Array) {
    if (werte.length !== kopf.spalten * kopf.zeilen) {
      throw new Error(`Hoehenraster: ${werte.length} Werte passen nicht zu ${kopf.spalten} x ${kopf.zeilen}.`);
    }
    this.kopf = kopf;
    this.werte = werte;
  }

  /** Leeres Raster (alle Zellen ohne Wert) fuer eine Bbox. */
  static leer(bbox: BBox, zellM: number, epsg = 25832): Hoehenraster {
    const spalten = Math.max(1, Math.ceil((bbox.maxE - bbox.minE) / zellM));
    const zeilen = Math.max(1, Math.ceil((bbox.maxN - bbox.minN) / zellM));
    const werte = new Float32Array(spalten * zeilen);
    werte.fill(KEIN_WERT);
    return new Hoehenraster({ minE: bbox.minE, minN: bbox.minN, zellM, spalten, zeilen, epsg }, werte);
  }

  get bbox(): BBox {
    const k = this.kopf;
    return {
      minE: k.minE,
      minN: k.minN,
      maxE: k.minE + k.spalten * k.zellM,
      maxN: k.minN + k.zeilen * k.zellM,
    };
  }

  /** Mitte der Zelle (spalte, zeile). */
  zellMitte(spalte: number, zeile: number): Punkt {
    const k = this.kopf;
    return [k.minE + (spalte + 0.5) * k.zellM, k.minN + (zeile + 0.5) * k.zellM];
  }

  wert(spalte: number, zeile: number): number {
    const k = this.kopf;
    if (spalte < 0 || zeile < 0 || spalte >= k.spalten || zeile >= k.zeilen) return KEIN_WERT;
    return this.werte[zeile * k.spalten + spalte];
  }

  setze(spalte: number, zeile: number, h: number): void {
    const k = this.kopf;
    if (spalte < 0 || zeile < 0 || spalte >= k.spalten || zeile >= k.zeilen) return;
    this.werte[zeile * k.spalten + spalte] = h;
    this.statCache = null; // die Zahlen von statistik() gelten jetzt nicht mehr
  }

  /**
   * Gemerktes Ergebnis von `statistik()`.
   *
   * BEFUND 11.08.2026: `statistik()` laeuft ueber JEDE Zelle. `netzAusRaster`
   * ruft es je Kachel einmal auf, um die Ersatzhoehe zu bekommen — bei 40
   * Kacheln und 2,6 Mio Zellen sind das 105 Mio unnoetige Durchlaeufe, und die
   * Netzbauzeit bestand zu 81 % daraus (1.397 -> 261 ms gemessen). Fuer die
   * Stadt waeren es 2.441 Kacheln auf 160 Mio Zellen.
   *
   * Die Zahlen haengen allein an den Daten; geaendert werden die nur ueber
   * `setze()`, und genau dort wird der Merker verworfen. Ein Zwischenspeicher
   * mit klarer Verfallsregel ist keine zweite Wahrheit.
   */
  private statCache: { min: number; max: number; mittel: number; zellen: number; ohneWert: number } | null = null;

  /**
   * Bilineare Hoehe an beliebiger Stelle.
   *
   * FEHLWERTE: Fehlt einer der vier Nachbarn, wird NICHT bilinear gerechnet —
   * ein fehlender Wert wuerde als 0 m ue. NHN in die Gewichtung eingehen und
   * ein Loch von 140 m Tiefe erzeugen. Stattdessen wird ueber die vorhandenen
   * Nachbarn gemittelt; fehlen alle vier, gibt die Funktion NaN zurueck, und
   * der Aufrufer entscheidet (siehe `hoeheOder`).
   */
  hoeheBei(e: number, n: number): number {
    const k = this.kopf;
    const fx = (e - k.minE) / k.zellM - 0.5;
    const fy = (n - k.minN) / k.zellM - 0.5;
    const s0 = Math.floor(fx);
    const z0 = Math.floor(fy);
    const tx = fx - s0;
    const ty = fy - z0;

    const h00 = this.wertGeklemmt(s0, z0);
    const h10 = this.wertGeklemmt(s0 + 1, z0);
    const h01 = this.wertGeklemmt(s0, z0 + 1);
    const h11 = this.wertGeklemmt(s0 + 1, z0 + 1);

    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;

    let summe = 0;
    let gewicht = 0;
    if (Number.isFinite(h00)) ((summe += h00 * w00), (gewicht += w00));
    if (Number.isFinite(h10)) ((summe += h10 * w10), (gewicht += w10));
    if (Number.isFinite(h01)) ((summe += h01 * w01), (gewicht += w01));
    if (Number.isFinite(h11)) ((summe += h11 * w11), (gewicht += w11));
    return gewicht > 1e-6 ? summe / gewicht : KEIN_WERT;
  }

  /** Wie `hoeheBei`, aber mit Ersatzwert statt NaN. */
  hoeheOder(e: number, n: number, ersatz: number): number {
    const h = this.hoeheBei(e, n);
    return Number.isFinite(h) ? h : ersatz;
  }

  /** Randzellen fortschreiben statt ins Leere zu greifen. */
  private wertGeklemmt(spalte: number, zeile: number): number {
    const k = this.kopf;
    const s = spalte < 0 ? 0 : spalte >= k.spalten ? k.spalten - 1 : spalte;
    const z = zeile < 0 ? 0 : zeile >= k.zeilen ? k.zeilen - 1 : zeile;
    return this.werte[z * k.spalten + s];
  }

  /**
   * Neigung an einer Stelle: Gefaelle in Prozent und Fallrichtung als
   * Kompasskurs (0 = Norden, im Uhrzeigersinn).
   *
   * WOFUER: Eine Rettungswegrechnung, die Steigungen ignoriert, ist falsch —
   * dieselbe Strecke ist auf 8 % Rampe etwas anderes als in der Ebene. Das
   * bisherige Modell konnte die Frage gar nicht beantworten, weil das Gelaende
   * ueber 4,7 m geglaettet war. Ausgewertet wird ueber eine ganze Zelle
   * (zentrale Differenz), nicht ueber zwei benachbarte Werte — sonst schlaegt
   * das Messrauschen des DGM voll durch.
   */
  neigungBei(e: number, n: number): { prozent: number; richtungGrad: number } {
    const d = this.kopf.zellM;
    const hOst = this.hoeheBei(e + d, n);
    const hWest = this.hoeheBei(e - d, n);
    const hNord = this.hoeheBei(e, n + d);
    const hSued = this.hoeheBei(e, n - d);
    if (!Number.isFinite(hOst) || !Number.isFinite(hWest) || !Number.isFinite(hNord) || !Number.isFinite(hSued)) {
      return { prozent: 0, richtungGrad: 0 };
    }
    const dE = (hOst - hWest) / (2 * d);
    const dN = (hNord - hSued) / (2 * d);
    const betrag = Math.hypot(dE, dN);
    // Fallrichtung zeigt bergAB, also entgegen dem Anstieg.
    const grad = (Math.atan2(-dE, -dN) * 180) / Math.PI;
    return { prozent: betrag * 100, richtungGrad: (grad + 360) % 360 };
  }

  /** Kennzahlen fuer Nachweis und Anzeige. Gemerkt bis zum naechsten `setze()`. */
  statistik(): { min: number; max: number; mittel: number; zellen: number; ohneWert: number } {
    if (this.statCache) return this.statCache;
    let min = Infinity;
    let max = -Infinity;
    let summe = 0;
    let anzahl = 0;
    let ohne = 0;
    for (let i = 0; i < this.werte.length; i++) {
      const h = this.werte[i];
      if (!Number.isFinite(h)) {
        ohne++;
        continue;
      }
      if (h < min) min = h;
      if (h > max) max = h;
      summe += h;
      anzahl++;
    }
    this.statCache = {
      min: anzahl ? min : 0,
      max: anzahl ? max : 0,
      mittel: anzahl ? summe / anzahl : 0,
      zellen: this.werte.length,
      ohneWert: ohne,
    };
    return this.statCache;
  }

  /**
   * Fuellt Fehlstellen aus der Nachbarschaft (mehrere Durchgaenge).
   *
   * Randfall aus der Praxis: Das Zielgebiet liegt nie genau auf dem
   * Kachelschnitt des DGM1, und einzelne Kacheln koennen fehlen. Ein Loch im
   * Gelaende ist im Modell schlimmer als ein genaeherter Wert — der Boden
   * verschwindet dort und man sieht durch die Welt hindurch. Gefuellte Zellen
   * sind eine NAEHERUNG; wie viele es waren, gehoert in den Quellennachweis.
   */
  luecken_fuellen(maxDurchgaenge = 8): number {
    const k = this.kopf;
    let gefuellt = 0;
    for (let durchgang = 0; durchgang < maxDurchgaenge; durchgang++) {
      const offen: { i: number; h: number }[] = [];
      for (let z = 0; z < k.zeilen; z++) {
        for (let s = 0; s < k.spalten; s++) {
          const i = z * k.spalten + s;
          if (Number.isFinite(this.werte[i])) continue;
          let summe = 0;
          let anzahl = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let ds = -1; ds <= 1; ds++) {
              if (dz === 0 && ds === 0) continue;
              const h = this.wert(s + ds, z + dz);
              if (Number.isFinite(h)) {
                summe += h;
                anzahl++;
              }
            }
          }
          if (anzahl >= 3) offen.push({ i, h: summe / anzahl });
        }
      }
      if (!offen.length) break;
      for (const o of offen) this.werte[o.i] = o.h;
      gefuellt += offen.length;
    }
    return gefuellt;
  }

  // -------------------------------------------------------------------------
  // Binaerform
  // -------------------------------------------------------------------------

  puffer(): ArrayBuffer {
    const k = this.kopf;
    const gesamt = new ArrayBuffer(KOPF_BYTES + this.werte.length * 4);
    const sicht = new DataView(gesamt);
    for (let i = 0; i < 8; i++) sicht.setUint8(i, RASTER_KENNUNG.charCodeAt(i));
    sicht.setFloat64(8, k.minE, true);
    sicht.setFloat64(16, k.minN, true);
    sicht.setFloat64(24, k.zellM, true);
    sicht.setUint32(32, k.spalten, true);
    sicht.setUint32(36, k.zeilen, true);
    sicht.setUint32(40, k.epsg, true);
    sicht.setUint32(44, 0, true);
    if (istKleinEndig) {
      new Float32Array(gesamt, KOPF_BYTES, this.werte.length).set(this.werte);
    } else {
      for (let i = 0; i < this.werte.length; i++) sicht.setFloat32(KOPF_BYTES + i * 4, this.werte[i], true);
    }
    return gesamt;
  }

  static ausPuffer(puffer: ArrayBuffer): Hoehenraster {
    if (puffer.byteLength < KOPF_BYTES) throw new Error('Hoehenraster: Datei zu kurz.');
    const sicht = new DataView(puffer);
    let kennung = '';
    for (let i = 0; i < 8; i++) kennung += String.fromCharCode(sicht.getUint8(i));
    if (kennung !== RASTER_KENNUNG) {
      throw new Error(`Hoehenraster: unbekannte Kennung „${kennung}" (erwartet ${RASTER_KENNUNG}).`);
    }
    const kopf: RasterKopf = {
      minE: sicht.getFloat64(8, true),
      minN: sicht.getFloat64(16, true),
      zellM: sicht.getFloat64(24, true),
      spalten: sicht.getUint32(32, true),
      zeilen: sicht.getUint32(36, true),
      epsg: sicht.getUint32(40, true),
    };
    const anzahl = kopf.spalten * kopf.zeilen;
    if (puffer.byteLength < KOPF_BYTES + anzahl * 4) throw new Error('Hoehenraster: Datei kuerzer als der Kopfsatz behauptet.');
    let werte: Float32Array;
    if (istKleinEndig) {
      werte = new Float32Array(puffer, KOPF_BYTES, anzahl);
    } else {
      werte = new Float32Array(anzahl);
      for (let i = 0; i < anzahl; i++) werte[i] = sicht.getFloat32(KOPF_BYTES + i * 4, true);
    }
    return new Hoehenraster(kopf, werte);
  }
}

// ---------------------------------------------------------------------------
// Bruchkanten
// ---------------------------------------------------------------------------

/**
 * BRUCHKANTE — eine Linie, an der die Gelaendeoberflaeche knickt oder springt.
 *
 * WARUM EIN RASTER ALLEIN NICHT REICHT, egal wie fein es ist:
 * Ein Raster kann an einer Stelle genau EINEN Wert fuehren. Eine Bordsteinkante
 * hat dort aber zwei — oben 12 cm hoeher als unten, auf null Abstand. Auch ein
 * 10-cm-Raster bildet sie nur als steile Rampe ab. Deshalb arbeitet die
 * Vermessung mit Dreiecksnetzen samt Zwangskanten, und deshalb gibt es diesen
 * Typ: Er traegt die Information, die das Raster nicht tragen kann.
 *
 * Zwei Arten:
 *  - `knick`  — die Flaeche ist stetig, aber ihre Neigung springt
 *               (Boeschungsober-/-unterkante, Firstlinie eines Dachs).
 *  - `sprung` — die Flaeche ist UNSTETIG, es gibt zwei Hoehen an derselben
 *               Stelle (Bordstein, Mauerkrone, Stufe, Bahnsteigkante).
 *
 * Bei `sprung` gilt: `hoehenLinks` und `hoehenRechts` beziehen sich auf die
 * Laufrichtung der Linie. Fehlt eine der beiden, wird sie aus dem Raster
 * genommen — dann ist nur die Sprunghoehe bekannt, nicht die absolute Lage.
 */
export type BruchkantenArt = 'knick' | 'sprung';

export interface Bruchkante {
  id: string;
  art: BruchkantenArt;
  /** Achse in EPSG:25832. */
  linie: Punkt[];
  /** Absolute Hoehen je Stuetzpunkt, links der Laufrichtung (m ue. NHN). */
  hoehenLinks?: number[];
  /** Absolute Hoehen je Stuetzpunkt, rechts der Laufrichtung. */
  hoehenRechts?: number[];
  /** Woher die Kante stammt — Nachweispflicht wie bei jeder anderen Angabe. */
  herkunft: 'alkis' | 'osm' | 'bauklasse' | 'gemessen';
  /** Bezeichnung fuer die Oberflaeche („Bordstein", „Boeschungsoberkante"). */
  bezeichnung?: string;
}

/** Sprunghoehe einer Kante am Stuetzpunkt i, oder null wenn unbekannt. */
export function sprungHoehe(k: Bruchkante, i: number): number | null {
  const l = k.hoehenLinks?.[i];
  const r = k.hoehenRechts?.[i];
  if (!Number.isFinite(l as number) || !Number.isFinite(r as number)) return null;
  return (l as number) - (r as number);
}
