/**
 * LESER FUER `.osm.pbf` — das amtliche Austauschformat der OSM-Auszuege.
 *
 * WARUM DIESES MODUL EXISTIERT (Befund 11.08.2026):
 * Der Stadtlauf ueber Darmstadt stellt 26 Kacheln x 10 Abfragen = 260 Abfragen
 * an die oeffentliche Overpass-API. Beim ersten Versuch scheiterten 25 von 26
 * Kacheln, weil der Dienst nach der ersten Kachel mit einem Dispatcher-Fehler
 * ausfiel und danach gar nicht mehr antwortete. Am Folgetag war KEINE der drei
 * erreichbaren Planet-Instanzen benutzbar (overpass-api.de auf allen IPs ohne
 * Verbindung, kumi.systems und private.coffee — derselbe Rechner — HTTP 504).
 *
 * Das ist kein Ungluecksfall, sondern der bestimmungsgemaesse Zustand: Die
 * Nutzungsregeln der Overpass-API weisen Massenabrufe ausdruecklich ab und
 * verweisen dafuer auf AUSZUEGE. Ein Stadtmodell ist ein Massenabruf. Der
 * Auszug ist hier also nicht der Notweg, sondern der richtige Weg — er ist
 * zudem vollstaendig, wiederholbar (fester Stand statt „was der Server heute
 * hat") und hoeflich.
 *
 * WAS HIER IMPLEMENTIERT IST: genau so viel vom Format, wie dieses Projekt
 * braucht — Knoten (dense), Wege, Relationen mit ihren Kennzeichen. Nicht
 * implementiert und ausdruecklich ABGEWIESEN statt stillschweigend ignoriert:
 * andere Packverfahren als zlib, unbekannte Feldnummern in tragenden
 * Nachrichten. Ein Leser, der Unverstandenes ueberspringt, liefert ein
 * unvollstaendiges Ergebnis, das vollstaendig aussieht — dieselbe Fehlerart,
 * die der Schweiz-Auszug beinahe verursacht haette (siehe osm.ts).
 *
 * Format: https://wiki.openstreetmap.org/wiki/PBF_Format
 * Aufbau der Datei: Folge von (4 Byte Laenge des BlobHeader | BlobHeader |
 * Blob). BlobHeader nennt Typ („OSMHeader" / „OSMData") und Blob-Laenge; der
 * Blob enthaelt die Nutzdaten roh oder zlib-gepackt.
 */

import { unzlibSync } from 'fflate';

// ---------------------------------------------------------------------------
// Protobuf — nur die Drahtformate, die im PBF vorkommen
// ---------------------------------------------------------------------------

/**
 * Ein Lesezeiger auf einen Puffer.
 *
 * Bewusst eine Klasse mit offenem Stand (`p`): Die gepackten Felder des
 * Formats (Knotenkennungen, Koordinaten) sind Zahlenreihen ohne Trenner, die
 * nur ueber den fortlaufenden Stand gelesen werden koennen.
 */
class Leser {
  buf: Uint8Array;
  p: number;
  ende: number;

  constructor(buf: Uint8Array, von = 0, bis = buf.length) {
    this.buf = buf;
    this.p = von;
    this.ende = bis;
  }

  fertig(): boolean {
    return this.p >= this.ende;
  }

  /**
   * Variable Laenge, 7 Bit je Byte, kleinstwertig zuerst.
   *
   * ZAHLENBEREICH: Knotenkennungen liegen 2026 bei ueber 12 Milliarden und
   * passen damit nicht mehr in 32 Bit. Sie passen aber weiterhin in die 53
   * sicheren Bit einer JavaScript-Zahl (9.007.199.254.740.991), darum wird
   * bewusst mit `number` statt `BigInt` gerechnet: BigInt waere hier um ein
   * Vielfaches langsamer, und die Grenze ist noch drei Zehnerpotenzen weit.
   * Wird sie doch erreicht, faellt das auf — deshalb der Wachposten.
   */
  varint(): number {
    let ergebnis = 0;
    let schub = 1;
    for (let i = 0; i < 10; i++) {
      if (this.p >= this.ende) throw new Error('PBF: Varint laeuft ueber das Ende der Nachricht hinaus.');
      const b = this.buf[this.p++];
      ergebnis += (b & 0x7f) * schub;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(ergebnis)) {
          throw new Error(`PBF: Zahl ${ergebnis} liegt ausserhalb der sicher darstellbaren Ganzzahlen — der Leser muesste auf BigInt umgestellt werden.`);
        }
        return ergebnis;
      }
      schub *= 128;
    }
    throw new Error('PBF: Varint laenger als 10 Byte.');
  }

  /** Vorzeichenbehaftet, im Zickzack gefaltet (0,-1,1,-2,2 …). */
  sint(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  /** Feldkopf: Feldnummer und Drahtformat. */
  kopf(): { feld: number; art: number } {
    const v = this.varint();
    return { feld: v >>> 3, art: v & 7 };
  }

  /** Laengenbegrenztes Feld — gibt die Grenzen zurueck, ohne zu kopieren. */
  stueck(): { von: number; bis: number } {
    const laenge = this.varint();
    const von = this.p;
    const bis = von + laenge;
    if (bis > this.ende) throw new Error('PBF: Laengenangabe reicht ueber das Ende der Nachricht hinaus.');
    this.p = bis;
    return { von, bis };
  }

  /** Ueberspringt ein Feld, dessen Inhalt nicht gebraucht wird. */
  ueberspringe(art: number): void {
    if (art === 0) this.varint();
    else if (art === 2) this.stueck();
    else if (art === 5) this.p += 4;
    else if (art === 1) this.p += 8;
    else throw new Error(`PBF: unbekanntes Drahtformat ${art}.`);
  }
}

/** Zeichenkette aus einem laengenbegrenzten Feld. */
const dekoder = new TextDecoder('utf8');
function text(buf: Uint8Array, von: number, bis: number): string {
  return dekoder.decode(buf.subarray(von, bis));
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

export interface Blob {
  typ: string;
  daten: Uint8Array;
}

/**
 * Zerlegt die Datei in Bloecke und packt sie aus.
 *
 * Bewusst ein Generator: Die Hessen-Datei ist 343 MB gepackt und ergibt
 * ausgepackt ein Mehrfaches davon. Sie am Stueck auszupacken waere weder
 * noetig noch moeglich — je Block sind es rund 8 MB, und der Aufrufer ist mit
 * jedem Block fertig, bevor der naechste kommt.
 */
export function* bloecke(datei: Uint8Array): Generator<Blob> {
  let p = 0;
  while (p + 4 <= datei.length) {
    // Laenge des BlobHeader: 4 Byte, groesstwertig zuerst (die EINZIGE Stelle
    // im Format, die nicht Protobuf ist).
    const kopfLaenge = (datei[p] << 24) | (datei[p + 1] << 16) | (datei[p + 2] << 8) | datei[p + 3];
    p += 4;
    if (kopfLaenge <= 0 || p + kopfLaenge > datei.length) throw new Error(`PBF: unplausible BlobHeader-Laenge ${kopfLaenge} bei Byte ${p - 4}.`);

    let typ = '';
    let datenLaenge = 0;
    const kl = new Leser(datei, p, p + kopfLaenge);
    while (!kl.fertig()) {
      const { feld, art } = kl.kopf();
      if (feld === 1 && art === 2) {
        const s = kl.stueck();
        typ = text(datei, s.von, s.bis);
      } else if (feld === 3 && art === 0) {
        datenLaenge = kl.varint();
      } else {
        kl.ueberspringe(art); // indexdata/Datum — fuer uns ohne Belang
      }
    }
    p += kopfLaenge;
    if (p + datenLaenge > datei.length) throw new Error(`PBF: Blob ${typ} reicht ueber das Dateiende hinaus.`);

    // Blob: entweder roh (Feld 1) oder zlib-gepackt (Feld 3).
    let roh: Uint8Array | null = null;
    let gepackt: Uint8Array | null = null;
    let rohLaenge = 0;
    const bl = new Leser(datei, p, p + datenLaenge);
    while (!bl.fertig()) {
      const { feld, art } = bl.kopf();
      if (feld === 1 && art === 2) {
        const s = bl.stueck();
        roh = datei.subarray(s.von, s.bis);
      } else if (feld === 2 && art === 0) {
        rohLaenge = bl.varint();
      } else if (feld === 3 && art === 2) {
        const s = bl.stueck();
        gepackt = datei.subarray(s.von, s.bis);
      } else if (art === 2) {
        // lzma (4), bzip2 (5), lz4 (6), zstd (7): NICHT stillschweigend
        // ueberspringen — ein uebersprungener Blob ist ein Loch in den Daten,
        // das man dem Ergebnis nicht ansieht.
        throw new Error(`PBF: Blob mit nicht unterstuetztem Packverfahren (Feld ${feld}). Dieser Leser kann nur „raw" und „zlib".`);
      } else {
        bl.ueberspringe(art);
      }
    }
    p += datenLaenge;

    let daten: Uint8Array;
    if (roh) daten = roh;
    // `unzlibSync`, NICHT `inflateSync`: Das Format legt zlib-Stroeme ab (mit
    // Kopfbyte und Adler-Pruefsumme), nicht rohes Deflate. Der Unterschied
    // kostete den ersten Leseversuch mit „unexpected EOF" — und er ist der
    // Grund, warum die vorgegebene Auspacklaenge hier mitgegeben wird: sie ist
    // zugleich die Probe, dass wirklich alles ausgepackt wurde.
    else if (gepackt) daten = unzlibSync(gepackt, rohLaenge ? { out: new Uint8Array(rohLaenge) } : undefined);
    else throw new Error('PBF: Blob ohne Inhalt.');
    yield { typ, daten };
  }
}

// ---------------------------------------------------------------------------
// PrimitiveBlock
// ---------------------------------------------------------------------------

/** Was ein Aufrufer je Element erfaehrt. Kennzeichen erst auf Abruf. */
export interface PbfKnoten {
  id: number;
  lat: number;
  lon: number;
  tags: () => Record<string, string>;
  /** Hat das Element ueberhaupt Kennzeichen? Billiger als `tags()`. */
  hatTags: boolean;
}
export interface PbfWeg {
  id: number;
  refs: number[];
  tags: () => Record<string, string>;
}
export interface PbfMitglied {
  typ: 'node' | 'way' | 'relation';
  ref: number;
  rolle: string;
}
export interface PbfRelation {
  id: number;
  mitglieder: PbfMitglied[];
  tags: () => Record<string, string>;
}

export interface PbfBesucher {
  knoten?: (k: PbfKnoten) => void;
  weg?: (w: PbfWeg) => void;
  relation?: (r: PbfRelation) => void;
}

const MITGLIED_TYP: PbfMitglied['typ'][] = ['node', 'way', 'relation'];

/**
 * Liest einen OSMData-Block und meldet jedes Element an den Besucher.
 *
 * KENNZEICHEN WERDEN ERST AUF ABRUF GEBAUT. Beim ersten Entwurf entstand fuer
 * JEDES der rund 50 Millionen Elemente in Hessen ein Objekt mit seinen
 * Kennzeichen — der Lauf brauchte dadurch ein Vielfaches der Zeit, obwohl der
 * Aufrufer 99 % davon sofort verwirft. Jetzt bekommt er die Kennzeichen als
 * Funktion und ruft sie nur fuer die Elemente, die er behaelt.
 */
export function blockLesen(daten: Uint8Array, besuch: PbfBesucher): void {
  // --- Zeichenkettentabelle ------------------------------------------------
  // Alle Schluessel und Werte des Blocks stehen genau einmal darin; die
  // Elemente verweisen nur mit Nummern. Sie wird als GRENZEN gehalten und erst
  // bei Bedarf in Zeichenketten verwandelt (dieselbe Ueberlegung wie oben).
  const stVon: number[] = [];
  const stBis: number[] = [];
  const stText: (string | undefined)[] = [];
  const zeichen = (i: number): string => {
    const fertig = stText[i];
    if (fertig !== undefined) return fertig;
    const s = text(daten, stVon[i], stBis[i]);
    stText[i] = s;
    return s;
  };

  const gruppen: { von: number; bis: number }[] = [];
  let granularitaet = 100;
  let latVersatz = 0;
  let lonVersatz = 0;

  const l = new Leser(daten);
  while (!l.fertig()) {
    const { feld, art } = l.kopf();
    if (feld === 1 && art === 2) {
      const s = l.stueck();
      const tl = new Leser(daten, s.von, s.bis);
      while (!tl.fertig()) {
        const k = tl.kopf();
        if (k.feld === 1 && k.art === 2) {
          const e = tl.stueck();
          stVon.push(e.von);
          stBis.push(e.bis);
        } else tl.ueberspringe(k.art);
      }
    } else if (feld === 2 && art === 2) {
      gruppen.push(l.stueck());
    } else if (feld === 17 && art === 0) {
      granularitaet = l.varint();
    } else if (feld === 19 && art === 0) {
      latVersatz = l.varint();
    } else if (feld === 20 && art === 0) {
      lonVersatz = l.varint();
    } else {
      l.ueberspringe(art);
    }
  }

  // Koordinaten stehen als Vielfache der Granularitaet in Nanograd.
  const nachGrad = (roh: number, versatz: number): number => (versatz + granularitaet * roh) * 1e-9;

  for (const g of gruppen) {
    const gl = new Leser(daten, g.von, g.bis);
    while (!gl.fertig()) {
      const { feld, art } = gl.kopf();
      if (art !== 2) {
        gl.ueberspringe(art);
        continue;
      }
      const s = gl.stueck();
      if (feld === 1) einzelKnoten(daten, s, besuch, zeichen, nachGrad);
      else if (feld === 2) dichteKnoten(daten, s, besuch, zeichen, nachGrad);
      else if (feld === 3) weg(daten, s, besuch, zeichen);
      else if (feld === 4) relation(daten, s, besuch, zeichen);
      // Feld 5 = Aenderungssaetze; in Gebietsauszuegen nicht enthalten.
    }
  }
}

/** Kennzeichen aus zwei gleich langen Nummernreihen. */
function tagsAus(keys: number[], vals: number[], zeichen: (i: number) => string): Record<string, string> {
  const t: Record<string, string> = {};
  for (let i = 0; i < keys.length; i++) t[zeichen(keys[i])] = zeichen(vals[i]);
  return t;
}

function einzelKnoten(
  daten: Uint8Array,
  s: { von: number; bis: number },
  besuch: PbfBesucher,
  zeichen: (i: number) => string,
  nachGrad: (roh: number, versatz: number) => number,
): void {
  if (!besuch.knoten) return;
  let id = 0;
  let lat = 0;
  let lon = 0;
  const keys: number[] = [];
  const vals: number[] = [];
  const l = new Leser(daten, s.von, s.bis);
  while (!l.fertig()) {
    const { feld, art } = l.kopf();
    if (feld === 1 && art === 0) id = l.sint();
    else if (feld === 2 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) keys.push(pl.varint());
    } else if (feld === 3 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) vals.push(pl.varint());
    } else if (feld === 8 && art === 0) lat = l.sint();
    else if (feld === 9 && art === 0) lon = l.sint();
    else l.ueberspringe(art);
  }
  besuch.knoten({
    id,
    lat: nachGrad(lat, 0),
    lon: nachGrad(lon, 0),
    hatTags: keys.length > 0,
    tags: () => tagsAus(keys, vals, zeichen),
  });
}

/**
 * DenseNodes — die Bauform, in der praktisch alle Knoten stehen.
 *
 * Kennungen und Koordinaten sind DIFFERENZEN zum jeweiligen Vorgaenger; die
 * Kennzeichen stehen in EINER durchlaufenden Reihe, je Knoten Paare
 * (Schluessel, Wert), abgeschlossen durch eine 0. Ein Knoten ohne Kennzeichen
 * ist eine einzelne 0 — oder, wenn kein Knoten des Blocks Kennzeichen hat,
 * fehlt die Reihe ganz.
 */
function dichteKnoten(
  daten: Uint8Array,
  s: { von: number; bis: number },
  besuch: PbfBesucher,
  zeichen: (i: number) => string,
  nachGrad: (roh: number, versatz: number) => number,
): void {
  if (!besuch.knoten) return;
  let ids: { von: number; bis: number } | null = null;
  let lats: { von: number; bis: number } | null = null;
  let lons: { von: number; bis: number } | null = null;
  let kv: { von: number; bis: number } | null = null;

  const l = new Leser(daten, s.von, s.bis);
  while (!l.fertig()) {
    const { feld, art } = l.kopf();
    if (feld === 1 && art === 2) ids = l.stueck();
    else if (feld === 8 && art === 2) lats = l.stueck();
    else if (feld === 9 && art === 2) lons = l.stueck();
    else if (feld === 10 && art === 2) kv = l.stueck();
    else l.ueberspringe(art); // Feld 5: Bearbeitungsangaben (Zeit, Nutzer)
  }
  if (!ids || !lats || !lons) return;

  const il = new Leser(daten, ids.von, ids.bis);
  const al = new Leser(daten, lats.von, lats.bis);
  const ol = new Leser(daten, lons.von, lons.bis);
  const kl = kv ? new Leser(daten, kv.von, kv.bis) : null;

  let id = 0;
  let lat = 0;
  let lon = 0;
  while (!il.fertig()) {
    id += il.sint();
    lat += al.sint();
    lon += ol.sint();

    // Kennzeichen dieses Knotens abgrenzen, OHNE sie zu bauen.
    let kVon = 0;
    let kBis = 0;
    if (kl && !kl.fertig()) {
      kVon = kl.p;
      while (!kl.fertig()) {
        const k = kl.varint();
        if (k === 0) break;
        kl.varint();
      }
      kBis = kl.p;
    }
    const hatTags = kBis > kVon + 1;
    besuch.knoten({
      id,
      lat: nachGrad(lat, 0),
      lon: nachGrad(lon, 0),
      hatTags,
      tags: () => {
        const t: Record<string, string> = {};
        if (!hatTags) return t;
        const tl = new Leser(daten, kVon, kBis);
        while (!tl.fertig()) {
          const k = tl.varint();
          if (k === 0) break;
          t[zeichen(k)] = zeichen(tl.varint());
        }
        return t;
      },
    });
  }
}

function weg(
  daten: Uint8Array,
  s: { von: number; bis: number },
  besuch: PbfBesucher,
  zeichen: (i: number) => string,
): void {
  if (!besuch.weg) return;
  let id = 0;
  const keys: number[] = [];
  const vals: number[] = [];
  const refs: number[] = [];
  const l = new Leser(daten, s.von, s.bis);
  while (!l.fertig()) {
    const { feld, art } = l.kopf();
    if (feld === 1 && art === 0) id = l.varint();
    else if (feld === 2 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) keys.push(pl.varint());
    } else if (feld === 3 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) vals.push(pl.varint());
    } else if (feld === 8 && art === 2) {
      // Knotenverweise, ebenfalls als Differenzen.
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      let r = 0;
      while (!pl.fertig()) {
        r += pl.sint();
        refs.push(r);
      }
    } else l.ueberspringe(art);
  }
  besuch.weg({ id, refs, tags: () => tagsAus(keys, vals, zeichen) });
}

function relation(
  daten: Uint8Array,
  s: { von: number; bis: number },
  besuch: PbfBesucher,
  zeichen: (i: number) => string,
): void {
  if (!besuch.relation) return;
  let id = 0;
  const keys: number[] = [];
  const vals: number[] = [];
  const rollen: number[] = [];
  const refs: number[] = [];
  const typen: number[] = [];
  const l = new Leser(daten, s.von, s.bis);
  while (!l.fertig()) {
    const { feld, art } = l.kopf();
    if (feld === 1 && art === 0) id = l.varint();
    else if (feld === 2 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) keys.push(pl.varint());
    } else if (feld === 3 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) vals.push(pl.varint());
    } else if (feld === 8 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) rollen.push(pl.varint());
    } else if (feld === 9 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      let r = 0;
      while (!pl.fertig()) {
        r += pl.sint();
        refs.push(r);
      }
    } else if (feld === 10 && art === 2) {
      const p = l.stueck();
      const pl = new Leser(daten, p.von, p.bis);
      while (!pl.fertig()) typen.push(pl.varint());
    } else l.ueberspringe(art);
  }
  const mitglieder: PbfMitglied[] = [];
  for (let i = 0; i < refs.length; i++) {
    mitglieder.push({ typ: MITGLIED_TYP[typen[i]] ?? 'node', ref: refs[i], rolle: zeichen(rollen[i] ?? 0) });
  }
  besuch.relation({ id, mitglieder, tags: () => tagsAus(keys, vals, zeichen) });
}

/**
 * Laeuft die ganze Datei durch und meldet jedes Element.
 *
 * `nurTyp` spart Arbeit: Wer nur Knoten braucht, bekommt Wege und Relationen
 * gar nicht erst zerlegt.
 */
export function pbfLesen(datei: Uint8Array, besuch: PbfBesucher): void {
  for (const b of bloecke(datei)) {
    if (b.typ !== 'OSMData') continue;
    blockLesen(b.daten, besuch);
  }
}
