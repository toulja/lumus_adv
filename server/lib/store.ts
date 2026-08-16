/**
 * Persistenz.
 *
 * Bewusste Entscheidung (siehe docs/ARCHITEKTUR.md): Dateibasierter Speicher
 * statt PostgreSQL/PostGIS. Begruendung:
 *  - Die Plattform muss laut Auftrag LOKAL ohne Docker startbar sein.
 *  - Saemtliche Geometrie-Operationen laufen ohnehin im gemeinsamen
 *    Geometrie-Kern (shared/geo), damit Editor und Bericht identisch rechnen —
 *    PostGIS wuerde dieselben Rechnungen ein zweites Mal, aber anders machen.
 *  - Die Versionierung verlangt ohnehin ein Append-Only-Event-Log; JSONL ist
 *    dafuer das direkte Abbild der geforderten Event-Log-Tabelle.
 * Das relationale Schema fuer den Produktivbetrieb liegt als
 * db/postgis/schema.sql bei; die Feldnamen sind identisch.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { bboxNachWgs } from '../../shared/geo/proj.ts';
import type {
  AenderungsEvent,
  Benachrichtigung,
  Freigabe,
  Gelaende,
  Kommentar,
  Mitgliedschaft,
  Nutzer,
  ObjektTyp,
  Organisation,
  Projekt,
  ProjektInhalt,
  Snapshot,
} from '../../shared/domain/types.ts';

export const WURZEL = process.env.HEINERFEST_DATA
  ? path.resolve(process.env.HEINERFEST_DATA)
  : path.resolve(process.cwd(), 'data');

function sicherstellen(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

let schreibZaehler = 0;

/**
 * Atomar schreiben: erst in eine eindeutige .tmp, dann umbenennen — so liegt
 * nie halbes JSON auf der Platte.
 *
 * Windows-Eigenheit: `rename` ueber eine BESTEHENDE Datei scheitert dort
 * gelegentlich mit EPERM/EBUSY, wenn ein Virenscanner oder der Indexdienst die
 * Zieldatei genau in diesem Moment offen haelt. Das ist voruebergehend, darum
 * wird kurz wiederholt; erst danach greift der (nicht mehr atomare) Notweg,
 * damit ein Datensatz niemals verloren geht.
 */
function schreibeAtomar(datei: string, inhalt: string) {
  sicherstellen(path.dirname(datei));
  const tmp = `${datei}.${process.pid}.${++schreibZaehler}.tmp`;
  fs.writeFileSync(tmp, inhalt, 'utf8');
  let letzterFehler: unknown = null;
  for (let versuch = 0; versuch < 12; versuch++) {
    try {
      fs.renameSync(tmp, datei);
      return;
    } catch (e) {
      letzterFehler = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
      // Kurz aktiv warten — der Vorgang laeuft synchron, ein Timer hilft hier nicht
      const bis = Date.now() + 15 * (versuch + 1);
      while (Date.now() < bis) {
        /* warten */
      }
    }
  }
  try {
    fs.writeFileSync(datei, inhalt, 'utf8');
    fs.rmSync(tmp, { force: true });
  } catch {
    fs.rmSync(tmp, { force: true });
    throw letzterFehler;
  }
}

function lies<T>(datei: string, standard: T): T {
  try {
    return JSON.parse(fs.readFileSync(datei, 'utf8')) as T;
  } catch {
    return standard;
  }
}

export function id(praefix = ''): string {
  return praefix + crypto.randomBytes(8).toString('hex');
}

export function jetzt(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Einfache Tabellen (kleine Mengen, komplett im Speicher)
// ---------------------------------------------------------------------------

class Tabelle<T extends { id: string }> {
  private datei: string;
  private daten: T[];

  constructor(name: string) {
    this.datei = path.join(WURZEL, `${name}.json`);
    this.daten = lies<T[]>(this.datei, []);
  }

  alle(): T[] {
    return this.daten;
  }
  finde(id: string): T | undefined {
    return this.daten.find((d) => d.id === id);
  }
  suche(f: (t: T) => boolean): T[] {
    return this.daten.filter(f);
  }
  eines(f: (t: T) => boolean): T | undefined {
    return this.daten.find(f);
  }
  einfuegen(t: T): T {
    this.daten.push(t);
    this.speichern();
    return t;
  }
  aendern(id: string, patch: Partial<T>): T | undefined {
    const i = this.daten.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    this.daten[i] = { ...this.daten[i], ...patch };
    this.speichern();
    return this.daten[i];
  }
  loeschen(id: string): boolean {
    const i = this.daten.findIndex((d) => d.id === id);
    if (i < 0) return false;
    this.daten.splice(i, 1);
    this.speichern();
    return true;
  }
  speichern() {
    schreibeAtomar(this.datei, JSON.stringify(this.daten, null, 1));
  }
}

export const organisationen = new Tabelle<Organisation>('organisationen');
export const nutzer = new Tabelle<Nutzer>('nutzer');
export const objekttypenEigen = new Tabelle<ObjektTyp>('objekttypen-eigen');

// Mitgliedschaften haben keinen eigenen id — eigener Speicher
const MITGLIED_DATEI = path.join(WURZEL, 'mitgliedschaften.json');
let mitgliedschaftenCache: Mitgliedschaft[] = lies<Mitgliedschaft[]>(MITGLIED_DATEI, []);

export const mitgliedschaften = {
  alle: () => mitgliedschaftenCache,
  fuerProjekt: (projektId: string) => mitgliedschaftenCache.filter((m) => m.projektId === projektId),
  fuerOrg: (orgId: string) => mitgliedschaftenCache.filter((m) => m.orgId === orgId),
  finde: (projektId: string, orgId: string) => mitgliedschaftenCache.find((m) => m.projektId === projektId && m.orgId === orgId),
  setzen(m: Mitgliedschaft) {
    const i = mitgliedschaftenCache.findIndex((x) => x.projektId === m.projektId && x.orgId === m.orgId);
    if (i >= 0) mitgliedschaftenCache[i] = m;
    else mitgliedschaftenCache.push(m);
    schreibeAtomar(MITGLIED_DATEI, JSON.stringify(mitgliedschaftenCache, null, 1));
  },
  entfernen(projektId: string, orgId: string) {
    mitgliedschaftenCache = mitgliedschaftenCache.filter((m) => !(m.projektId === projektId && m.orgId === orgId));
    schreibeAtomar(MITGLIED_DATEI, JSON.stringify(mitgliedschaftenCache, null, 1));
  },
};

const BENACHR_DATEI = path.join(WURZEL, 'benachrichtigungen.json');
let benachrCache: Benachrichtigung[] = lies<Benachrichtigung[]>(BENACHR_DATEI, []);
export const benachrichtigungen = {
  fuerNutzer: (nutzerId: string) => benachrCache.filter((b) => b.nutzerId === nutzerId).slice(-200).reverse(),
  anlegen(b: Benachrichtigung) {
    benachrCache.push(b);
    if (benachrCache.length > 5000) benachrCache = benachrCache.slice(-4000);
    schreibeAtomar(BENACHR_DATEI, JSON.stringify(benachrCache, null, 1));
    return b;
  },
  gelesen(nutzerId: string, ids: string[]) {
    let ge = false;
    for (const b of benachrCache) {
      if (b.nutzerId === nutzerId && ids.includes(b.id) && !b.gelesen) {
        b.gelesen = true;
        ge = true;
      }
    }
    if (ge) schreibeAtomar(BENACHR_DATEI, JSON.stringify(benachrCache, null, 1));
  },
};

// ---------------------------------------------------------------------------
// Gelaende — je Gelaende eine Datei plus ein Texturordner
// ---------------------------------------------------------------------------

const GELAENDE_DIR = path.join(WURZEL, 'gelaende');

/**
 * Der KOPF eines Gelaendes: alles, was eine Liste braucht, und nichts, was sie
 * teuer macht.
 *
 * WARUM (gemessen 16.08.2026): `liste()` hat jede der 29 Gelaendedateien
 * vollstaendig geparst — 0,3 GB, groesste Datei 58 MB — um daraus drei Felder
 * zu lesen. Die Projektuebersicht tat dasselbe je Zeile. Ergebnis: 4,1 s bzw.
 * 3,8 s fuer zwei blosse Namenslisten, waehrend derer der einthreadige Server
 * fuer alle stillsteht.
 *
 * Der Kopf liegt als eigene kleine Datei neben dem Gelaende und wird bei jedem
 * Speichern mitgeschrieben. Fehlt er (Gelaende von vor dem 16.08.2026), wird er
 * beim ersten Zugriff aus der grossen Datei erzeugt — einmal teuer, danach nie
 * wieder.
 */
export interface GelaendeKopf {
  id: string;
  name: string;
  erstelltAm: string;
  erstelltVon: string;
  bbox: Gelaende['bbox'];
  epsg: number;
  hoeheMittel: number;
  mengen: { gebaeude: number; flaechen: number; punkte: number; linien: number; bruchkanten: number };
  /** Traegt die grosse Datei bereits `bbox4326`? Dann darf sie roh gestreamt werden. */
  hatBbox4326: boolean;
}

function kopfAus(g: Gelaende): GelaendeKopf {
  return {
    id: g.id,
    name: g.name,
    erstelltAm: g.erstelltAm,
    erstelltVon: g.erstelltVon,
    bbox: g.bbox,
    epsg: g.epsg,
    hoeheMittel: g.hoeheMittel,
    mengen: {
      gebaeude: g.gebaeude?.length ?? 0,
      flaechen: g.flaechen?.length ?? 0,
      punkte: g.punkte?.length ?? 0,
      linien: g.linien?.length ?? 0,
      bruchkanten: g.bruchkanten?.length ?? 0,
    },
    hatBbox4326: !!g.bbox4326,
  };
}

/**
 * Zwischenspeicher fuer geladene Gelaende — BEWUSST NUR ZWEI.
 *
 * Ein geparstes Gelaende belegt ein Vielfaches seiner Dateigroesse im
 * Arbeitsspeicher (das Pilotgebiet: 14 MB Datei). Alle 29 zu halten waere ein
 * Speicherleck mit Ansage. Zwei genuegen: der uebliche Fall ist "dasselbe
 * Gelaende mehrfach hintereinander" (Bericht, Lageplan, KI-Anfrage), nicht
 * "alle Gelaende reihum".
 */
const GELAENDE_CACHE_MAX = 2;
const gelaendeCache = new Map<string, { mtimeMs: number; daten: Gelaende }>();

export const gelaende = {
  verzeichnis: (gid: string) => path.join(GELAENDE_DIR, gid),
  datei: (gid: string) => path.join(GELAENDE_DIR, gid, 'gelaende.json'),
  kopfDatei: (gid: string) => path.join(GELAENDE_DIR, gid, 'kopf.json'),
  gzDatei: (gid: string) => path.join(GELAENDE_DIR, gid, 'gelaende.json.gz'),

  liste(): { id: string; name: string; erstelltAm: string; erstelltVon: string }[] {
    sicherstellen(GELAENDE_DIR);
    return fs
      .readdirSync(GELAENDE_DIR)
      .filter((d) => fs.existsSync(path.join(GELAENDE_DIR, d, 'gelaende.json')))
      .map((d) => {
        const k = gelaende.kopf(d);
        return k ? { id: k.id, name: k.name, erstelltAm: k.erstelltAm, erstelltVon: k.erstelltVon } : null;
      })
      .filter(Boolean) as { id: string; name: string; erstelltAm: string; erstelltVon: string }[];
  },

  /**
   * Kopfdaten eines Gelaendes. Fehlt die Kopfdatei, wird sie aus der grossen
   * Datei erzeugt und abgelegt (Selbstheilung) — so braucht kein Bestand ein
   * Wanderungsskript, er wird beim ersten Zugriff nachgezogen.
   */
  kopf(gid: string): GelaendeKopf | null {
    const k = lies<GelaendeKopf | null>(gelaende.kopfDatei(gid), null);
    if (k && k.mengen) return k;
    const g = gelaende.laden(gid);
    if (!g) return null;
    const neu = kopfAus(g);
    try {
      schreibeAtomar(gelaende.kopfDatei(gid), JSON.stringify(neu, null, 1));
    } catch {
      /* Kopf ist ein Beschleuniger, kein Muss */
    }
    return neu;
  },

  laden(gid: string): Gelaende | null {
    const datei = gelaende.datei(gid);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(datei).mtimeMs;
    } catch {
      return null;
    }
    const gemerkt = gelaendeCache.get(gid);
    if (gemerkt && gemerkt.mtimeMs === mtimeMs) {
      // Neu einsortieren, damit der Aelteste weicht und nicht der Meistgenutzte
      gelaendeCache.delete(gid);
      gelaendeCache.set(gid, gemerkt);
      return gemerkt.daten;
    }
    const daten = lies<Gelaende | null>(datei, null);
    if (!daten) return null;
    gelaendeCache.set(gid, { mtimeMs, daten });
    while (gelaendeCache.size > GELAENDE_CACHE_MAX) {
      const aeltester = gelaendeCache.keys().next().value as string;
      gelaendeCache.delete(aeltester);
    }
    return daten;
  },

  speichern(g: Gelaende) {
    // `bbox4326` gehoert IN die Datei, nicht in die Antwort: nur dann darf die
    // Route die Datei roh streamen, statt 14 MB zu parsen und sofort wieder zu
    // serialisieren (gemessen 16.08.2026: 459 ms je Aufruf).
    if (!g.bbox4326) g.bbox4326 = bboxNachWgs(g.bbox);
    const text = JSON.stringify(g);
    schreibeAtomar(gelaende.datei(g.id), text);
    schreibeAtomar(gelaende.kopfDatei(g.id), JSON.stringify(kopfAus(g), null, 1));
    // Vorkomprimiert ablegen statt je Anfrage zu komprimieren: das Gelaende
    // aendert sich fast nie, wird aber bei jedem Projektwechsel geholt. Kostet
    // einmal beim Import und spart jedes Mal Rechenzeit UND Leitung.
    try {
      fs.writeFileSync(gelaende.gzDatei(g.id), zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 6 }));
    } catch {
      /* ohne .gz wird eben unkomprimiert ausgeliefert */
    }
    gelaendeCache.delete(g.id);
  },
  /**
   * Pfad einer Texturkachel.
   *
   * SICHERHEIT: BEIDE Bestandteile werden auf den blossen Dateinamen reduziert
   * UND das Ergebnis muss nachweislich unter GELAENDE_DIR liegen. Frueher war
   * nur `datei` mit basename() abgesichert — ueber ein kodiertes `gid`
   * (".."+%2f bzw. %5c) liess sich der Gelaendeordner verlassen und eine Datei
   * ausserhalb von data/ ausliefern (Befund 07.08.2026). basename() allein
   * genuegt nicht: basename('..') ist wieder '..'.
   */
  texturPfad(gid: string, datei: string): string {
    const p = path.resolve(GELAENDE_DIR, path.basename(gid), 'textur', path.basename(datei));
    const wurzel = path.resolve(GELAENDE_DIR) + path.sep;
    if (!p.startsWith(wurzel)) {
      throw new Error('Ungueltiger Texturpfad.');
    }
    return p;
  },
  texturSchreiben(gid: string, datei: string, daten: Buffer) {
    const p = this.texturPfad(gid, datei);
    sicherstellen(path.dirname(p));
    fs.writeFileSync(p, daten);
  },

  /**
   * Pfad des binaeren Hoehenrasters.
   *
   * Es liegt bewusst NEBEN der Gelaendedatei, nicht darin: das Raster des
   * Pilotgebiets hat 2,16 Mio. Zellen. Als Zahlen im JSON waeren das rund
   * 14 MB, die der Browser bei jedem Projektwechsel zeichenweise auseinander-
   * nehmen muesste. Als Binaerdatei sind es 8 MB, die er in einem Stueck holt
   * und ohne Umwandlung als Float32Array benutzt.
   *
   * Dieselbe Pfadabsicherung wie bei den Texturen (Befund 07.08.2026).
   */
  rasterPfad(gid: string): string {
    const p = path.resolve(GELAENDE_DIR, path.basename(gid), 'hoehen.bin');
    const wurzel = path.resolve(GELAENDE_DIR) + path.sep;
    if (!p.startsWith(wurzel)) throw new Error('Ungueltiger Rasterpfad.');
    return p;
  },
  rasterSchreiben(gid: string, puffer: ArrayBuffer) {
    const p = this.rasterPfad(gid);
    sicherstellen(path.dirname(p));
    fs.writeFileSync(p, Buffer.from(puffer));
  },
  rasterVorhanden(gid: string): boolean {
    try {
      return fs.existsSync(this.rasterPfad(gid));
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Projekte — Inhalt, Event-Log, Snapshots, Freigaben, Kommentare
// ---------------------------------------------------------------------------

const PROJEKT_DIR = path.join(WURZEL, 'projekte');

interface ProjektDatei {
  inhalt: ProjektInhalt;
  kommentare: Kommentar[];
  freigaben: Freigabe[];
  letzteSeq: number;
}

const projektCache = new Map<string, ProjektDatei>();

function projektDatei(pid: string): string {
  return path.join(PROJEKT_DIR, pid, 'projekt.json');
}

function ladeProjektDatei(pid: string): ProjektDatei | null {
  if (projektCache.has(pid)) return projektCache.get(pid)!;
  const d = lies<ProjektDatei | null>(projektDatei(pid), null);
  if (!d) return null;
  d.kommentare ??= [];
  d.freigaben ??= [];
  d.inhalt.objekte ??= [];
  d.inhalt.wege ??= [];
  d.inhalt.blockflaechen ??= [];
  d.inhalt.einsatzstationen ??= [];
  projektCache.set(pid, d);
  return d;
}

let schreibTimer = new Map<string, NodeJS.Timeout>();
function projektSpeichern(pid: string, sofort = false) {
  const d = projektCache.get(pid);
  if (!d) return;
  const tun = () => {
    schreibeAtomar(projektDatei(pid), JSON.stringify(d));
    schreibTimer.delete(pid);
  };
  if (sofort) {
    clearTimeout(schreibTimer.get(pid));
    tun();
    return;
  }
  if (schreibTimer.has(pid)) return;
  schreibTimer.set(pid, setTimeout(tun, 400));
}

export const projekte = {
  liste(): Projekt[] {
    sicherstellen(PROJEKT_DIR);
    return fs
      .readdirSync(PROJEKT_DIR)
      .map((d) => ladeProjektDatei(d)?.inhalt.projekt)
      .filter(Boolean) as Projekt[];
  },
  finde(pid: string): Projekt | null {
    return ladeProjektDatei(pid)?.inhalt.projekt ?? null;
  },
  inhalt(pid: string): ProjektInhalt | null {
    return ladeProjektDatei(pid)?.inhalt ?? null;
  },
  anlegen(inhalt: ProjektInhalt) {
    const d: ProjektDatei = { inhalt, kommentare: [], freigaben: [], letzteSeq: 0 };
    projektCache.set(inhalt.projekt.id, d);
    projektSpeichern(inhalt.projekt.id, true);
    return inhalt.projekt;
  },
  speichern(pid: string, sofort = false) {
    const d = projektCache.get(pid);
    if (d) d.inhalt.projekt.geaendertAm = jetzt();
    projektSpeichern(pid, sofort);
  },
  loeschen(pid: string) {
    projektCache.delete(pid);
    fs.rmSync(path.join(PROJEKT_DIR, pid), { recursive: true, force: true });
  },
  kommentare(pid: string): Kommentar[] {
    return ladeProjektDatei(pid)?.kommentare ?? [];
  },
  kommentarAnlegen(pid: string, k: Kommentar) {
    const d = ladeProjektDatei(pid);
    if (!d) return null;
    d.kommentare.push(k);
    projektSpeichern(pid);
    return k;
  },
  kommentarAendern(pid: string, kid: string, patch: Partial<Kommentar>) {
    const d = ladeProjektDatei(pid);
    if (!d) return null;
    const i = d.kommentare.findIndex((k) => k.id === kid);
    if (i < 0) return null;
    d.kommentare[i] = { ...d.kommentare[i], ...patch };
    projektSpeichern(pid);
    return d.kommentare[i];
  },
  freigaben(pid: string): Freigabe[] {
    return ladeProjektDatei(pid)?.freigaben ?? [];
  },
  freigabeSetzen(pid: string, f: Freigabe) {
    const d = ladeProjektDatei(pid);
    if (!d) return null;
    const i = d.freigaben.findIndex((x) => x.snapshotId === f.snapshotId && x.behoerdenOrgId === f.behoerdenOrgId);
    if (i >= 0) d.freigaben[i] = f;
    else d.freigaben.push(f);
    projektSpeichern(pid, true);
    return f;
  },
  naechsteSeq(pid: string): number {
    const d = ladeProjektDatei(pid);
    if (!d) return 0;
    d.letzteSeq += 1;
    return d.letzteSeq;
  },
  letzteSeq(pid: string): number {
    return ladeProjektDatei(pid)?.letzteSeq ?? 0;
  },
};

// -- Event-Log (append only, JSONL) -----------------------------------------

function eventDatei(pid: string): string {
  return path.join(PROJEKT_DIR, pid, 'events.jsonl');
}

export const events = {
  anhaengen(e: AenderungsEvent) {
    sicherstellen(path.dirname(eventDatei(e.projektId)));
    fs.appendFileSync(eventDatei(e.projektId), `${JSON.stringify(e)}\n`, 'utf8');
  },
  lesen(pid: string, abSeq = 0, limit = 5000): AenderungsEvent[] {
    try {
      const roh = fs.readFileSync(eventDatei(pid), 'utf8');
      const out: AenderungsEvent[] = [];
      for (const zeile of roh.split('\n')) {
        if (!zeile.trim()) continue;
        try {
          const e = JSON.parse(zeile) as AenderungsEvent;
          if (e.seq > abSeq) out.push(e);
        } catch {
          /* defekte Zeile ueberspringen */
        }
      }
      return out.slice(-limit);
    } catch {
      return [];
    }
  },
  anzahlSeit(pid: string, zeit: string): number {
    return events.lesen(pid).filter((e) => e.zeit > zeit).length;
  },
};

// -- Snapshots ---------------------------------------------------------------

function snapshotDir(pid: string): string {
  return path.join(PROJEKT_DIR, pid, 'snapshots');
}

export const snapshots = {
  liste(pid: string): Snapshot[] {
    const d = snapshotDir(pid);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => lies<Snapshot | null>(path.join(d, f), null))
      .filter(Boolean)
      .sort((a, b) => (a!.zeit < b!.zeit ? 1 : -1)) as Snapshot[];
  },
  finde(pid: string, sid: string): Snapshot | null {
    return lies<Snapshot | null>(path.join(snapshotDir(pid), `${sid}.json`), null);
  },
  anlegen(s: Snapshot) {
    schreibeAtomar(path.join(snapshotDir(s.projektId), `${s.id}.json`), JSON.stringify(s));
    return s;
  },
};

// ---------------------------------------------------------------------------
// Cache (Kacheln, Geokodierung, LoD2-Zwischenstaende)
// ---------------------------------------------------------------------------

export const cache = {
  pfad(...teile: string[]): string {
    return path.join(WURZEL, 'cache', ...teile);
  },
  lesen(...teile: string[]): Buffer | null {
    try {
      return fs.readFileSync(cache.pfad(...teile));
    } catch {
      return null;
    }
  },
  schreiben(daten: Buffer, ...teile: string[]) {
    const p = cache.pfad(...teile);
    sicherstellen(path.dirname(p));
    fs.writeFileSync(p, daten);
  },
  jsonLesen<T>(standard: T, ...teile: string[]): T {
    return lies<T>(cache.pfad(...teile), standard);
  },
  jsonSchreiben(daten: unknown, ...teile: string[]) {
    schreibeAtomar(cache.pfad(...teile), JSON.stringify(daten));
  },
};

export function initStore() {
  sicherstellen(WURZEL);
  sicherstellen(PROJEKT_DIR);
  sicherstellen(GELAENDE_DIR);
  sicherstellen(path.join(WURZEL, 'cache'));
}
