/**
 * BAUKLASSEN UND KANTEN — Stufe 2 und 3 des Bauwerksmodells.
 *
 * Zwei Aufgaben, die zusammengehoeren:
 *
 * 1. KONSTRUKTIONSHOEHE: Jede Nutzungsflaeche bekommt eine Oberkante ueber der
 *    Bezugsflaeche des Strassenraums. Die Werte stehen NICHT hier, sondern in
 *    `config/bauklassen/*.json` — versioniert, mit Fundstelle und
 *    Verifikationsstatus, genau wie das Regelwerk. Ein Zahlenwert im
 *    Programmtext waere in einem halben Jahr nicht mehr nachvollziehbar und
 *    liesse sich von niemandem pruefen.
 *
 * 2. DIE KANTE IST EIN ERGEBNIS: Wo zwei Flaechen mit unterschiedlicher
 *    Konstruktionshoehe aneinanderstossen, entsteht ein Kantenkoerper —
 *    Bordstein, Boeschung oder Stuetzmauer, je nach Hoehenunterschied. Bisher
 *    gab es Bordsteine nur dort, wo OpenStreetMap zufaellig `barrier=kerb`
 *    fuehrt: 16 Stueck, 556 m im ganzen Pilotgebiet, bei rund 40 km
 *    Strassenkante.
 *
 * WARUM DAS SERVERSEITIG LAEUFT und nicht im Renderer: Die Kanten sind Teil
 * des Modells, nicht der Darstellung. Die Regelpruefung muss wissen, dass an
 * einem Rettungsweg eine 12-cm-Stufe liegt, und der Vadere-Export ebenso.
 * Wuerde der Browser sie zeichnen, waeren sie nur ein Bild.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Bruchkante, FlaechenArt, GelaendeFlaeche, KantenBauart, Punkt } from '../../shared/domain/types.ts';
import { bboxVonPunkten, punktInRing } from '../../shared/geo/geometry.ts';

// ---------------------------------------------------------------------------
// Bauklassen laden
// ---------------------------------------------------------------------------

interface BauklassenDatei {
  id: string;
  version: string;
  bezeichnung: string;
  bezugsflaeche: string;
  haftungshinweis: string;
  klassen: {
    id: string;
    bezeichnung: string;
    fuerFlaechenArt: string[];
    oberkanteM: number | null;
    stufe?: { hoeheM: number; auftrittM: number };
    wasser?: { spiegelUeberGelaendeM: number; sohleUnterSpiegelM: number };
    verifikation: { status: 'verifiziert' | 'zu_pruefen'; geprueftAm: string; beleg: string };
  }[];
  kantenregel: {
    stufen: { bisM: number | null; bauart: string; bezeichnung: string; anlaufM?: number; boeschungMaxNeigung?: number }[];
  };
}

let zwischenspeicher: BauklassenDatei | null = null;

/**
 * Laedt die Bauklassen und prueft sie beim Laden.
 *
 * Dieselbe Strenge wie beim Regelwerk (`kataloge.regelwerkeLaden`): Eine Datei
 * mit einer Klasse ohne Verifikationsstatus wird abgelehnt, statt still eine
 * unbelegte Zahl in die Geometrie zu tragen.
 */
export function bauklassenLaden(datei?: string): BauklassenDatei {
  if (zwischenspeicher && !datei) return zwischenspeicher;
  const pfad = datei ?? path.resolve(process.cwd(), 'config', 'bauklassen', 'de-strassenraum-2026.1.json');
  if (!fs.existsSync(pfad)) throw new Error(`Bauklassen fehlen: ${pfad}`);
  const d = JSON.parse(fs.readFileSync(pfad, 'utf8')) as BauklassenDatei;
  const fehler: string[] = [];
  if (!d.klassen?.length) fehler.push('keine Klassen enthalten');
  for (const k of d.klassen ?? []) {
    if (!k.id) fehler.push('eine Klasse ohne Bezeichner');
    if (!k.verifikation?.status) fehler.push(`Klasse ${k.id}: kein Verifikationsstatus`);
    if (k.oberkanteM === undefined) fehler.push(`Klasse ${k.id}: keine Oberkante (null ist erlaubt, fehlend nicht)`);
  }
  if (!d.kantenregel?.stufen?.length) fehler.push('keine Kantenregel enthalten');
  if (fehler.length) throw new Error(`Bauklassen ${path.basename(pfad)} unbrauchbar: ${fehler.join('; ')}`);
  if (!datei) zwischenspeicher = d;
  return d;
}

/** Zuordnung Flaechenart -> Konstruktionshoehe, aus der Datei aufgeloest. */
export function hoehenTabelle(d = bauklassenLaden()): Map<FlaechenArt, { hoeheM: number; klasse: string; belegt: boolean }> {
  const t = new Map<FlaechenArt, { hoeheM: number; klasse: string; belegt: boolean }>();
  for (const k of d.klassen) {
    if (k.oberkanteM === null) continue; // Treppe/Wasser haben keine EINE Hoehe
    for (const art of k.fuerFlaechenArt) {
      t.set(art as FlaechenArt, {
        hoeheM: k.oberkanteM,
        klasse: k.id,
        belegt: k.verifikation.status === 'verifiziert',
      });
    }
  }
  return t;
}

/**
 * Setzt `konstruktionM` auf allen Flaechen.
 * Flaechen ohne Bauklasse bleiben ohne Wert — sie liegen dann auf dem
 * Gelaende. „k. A." ist eine ehrlichere Aussage als eine geratene Hoehe.
 */
export function konstruktionshoehenSetzen(flaechen: GelaendeFlaeche[]): {
  gesetzt: number;
  ohneKlasse: FlaechenArt[];
  unbelegt: string[];
} {
  const tabelle = hoehenTabelle();
  let gesetzt = 0;
  const ohne = new Set<FlaechenArt>();
  const unbelegt = new Set<string>();
  for (const f of flaechen) {
    const e = tabelle.get(f.art);
    if (!e) {
      ohne.add(f.art);
      continue;
    }
    f.konstruktionM = e.hoeheM;
    if (!e.belegt && e.hoeheM !== 0) unbelegt.add(`${f.art} = ${e.hoeheM.toFixed(2)} m`);
    gesetzt++;
  }
  return { gesetzt, ohneKlasse: [...ohne], unbelegt: [...unbelegt] };
}

/** Welche Bauart gehoert zu welchem Hoehenunterschied? */
export function bauartFuer(dh: number, d = bauklassenLaden()): { bauart: KantenBauart; bezeichnung: string } {
  for (const s of d.kantenregel.stufen) {
    if (s.bisM === null || dh <= s.bisM) {
      return { bauart: s.bauart as KantenBauart, bezeichnung: s.bezeichnung };
    }
  }
  return { bauart: 'bauwerk', bezeichnung: 'Bauwerk' };
}

// ---------------------------------------------------------------------------
// Flaechenindex — „welche Flaeche liegt an dieser Stelle?"
// ---------------------------------------------------------------------------

class FlaechenIndex {
  private zellen = new Map<string, number[]>();
  private flaechen: GelaendeFlaeche[];
  private bboxen: { minE: number; minN: number; maxE: number; maxN: number }[];
  private zellM: number;

  constructor(flaechen: GelaendeFlaeche[], zellM = 25) {
    this.flaechen = flaechen;
    this.zellM = zellM;
    this.bboxen = flaechen.map((f) => bboxVonPunkten(f.polygon));
    for (let i = 0; i < flaechen.length; i++) {
      const b = this.bboxen[i];
      for (let e = Math.floor(b.minE / zellM); e <= Math.floor(b.maxE / zellM); e++) {
        for (let n = Math.floor(b.minN / zellM); n <= Math.floor(b.maxN / zellM); n++) {
          const s = `${e}:${n}`;
          const liste = this.zellen.get(s);
          if (liste) liste.push(i);
          else this.zellen.set(s, [i]);
        }
      }
    }
  }

  /** Index der Flaeche an dieser Stelle, oder -1. `ausser` wird uebersprungen. */
  bei(p: Punkt, ausser = -1): number {
    const liste = this.zellen.get(`${Math.floor(p[0] / this.zellM)}:${Math.floor(p[1] / this.zellM)}`);
    if (!liste) return -1;
    for (const i of liste) {
      if (i === ausser) continue;
      const b = this.bboxen[i];
      if (p[0] < b.minE || p[0] > b.maxE || p[1] < b.minN || p[1] > b.maxN) continue;
      const f = this.flaechen[i];
      if (!punktInRing(p, f.polygon)) continue;
      if ((f.loecher ?? []).some((h) => punktInRing(p, h))) continue;
      return i;
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Kanten ableiten
// ---------------------------------------------------------------------------

/** Abstand, in dem beiderseits einer Kante nach der Nachbarflaeche gesucht wird. */
const SEITE_M = 0.4;
/** Kuerzere Randstuecke werden uebersprungen (Rundungsartefakte der Vereinigung). */
const MIN_SEGMENT_M = 0.3;

export interface KantenErgebnis {
  kanten: Bruchkante[];
  laengeM: number;
  nachBauart: Record<string, { anzahl: number; laengeM: number }>;
  /**
   * Wie viel von der Stufe steht schon IM Gelaendemodell? Der Mittelwert der
   * gemessenen DGM-Differenz an allen gefundenen Kanten. Er entscheidet, ob
   * die Konstruktionshoehe zusaetzlich aufgeschlagen werden darf oder ob sie
   * doppelt zaehlen wuerde.
   */
  gemesseneStufeMittelM: number;
  gemesseneStufeMedianM: number;
}

/**
 * Leitet die Kanten aus den Konstruktionshoehen ab.
 *
 * ZUM DOPPELZAEHLEN (der Grund fuer die Messung in dieser Funktion):
 * Das DGM1 ist ein GELAENDEmodell — es misst die Erdoberflaeche einschliesslich
 * Fahrbahn und Gehweg. Die Bordsteinstufe steckt also bereits darin, nur
 * verschmiert: sie ist rund 15 cm breit, das Raster hat 1 m Maschenweite.
 * Wuerde man die Konstruktionshoehe blind daraufsetzen, waere die Kante um den
 * Anteil zu hoch, den das DGM schon zeigt.
 *
 * Deshalb wird die Stufe an jeder Kante GEMESSEN (DGM links gegen DGM rechts).
 *
 * ERGEBNIS DER MESSUNG (09.08.2026, Pilotgebiet, 2.254 Kanten): Mittel und
 * Median liegen bei -0,2 cm. Das DGM1 enthaelt von der Bordsteinstufe also
 * praktisch NICHTS — bei 1 m Maschenweite gegen rund 15 cm Kantenbreite ist
 * das auch nicht anders zu erwarten; der kleine negative Wert ist Rauschen.
 * Die Konstruktionshoehe wird deshalb voll auf das Gelaende gelegt, ohne
 * Abzug. Der Messwert wird trotzdem weiter mitgefuehrt und im Auftragsprotokoll
 * gemeldet: Kommt spaeter ein feineres Hoehenmodell (etwa ein DGM aus
 * Laserdaten mit 0,25 m), traegt es die Stufe womoeglich selbst, und dann muss
 * hier abgezogen werden, statt aufzudoppeln.
 */
export function bruchkantenBilden(
  flaechen: GelaendeFlaeche[],
  hoeheBei: (e: number, n: number) => number,
): KantenErgebnis {
  const index = new FlaechenIndex(flaechen);
  const kanten: Bruchkante[] = [];
  const gemessene: number[] = [];
  let nr = 0;

  for (let ai = 0; ai < flaechen.length; ai++) {
    const A = flaechen[ai];
    const hA = A.konstruktionM;
    if (hA === undefined || hA <= 0) continue; // nur die hoeher gebauten Flaechen

    for (const ring of [A.polygon, ...(A.loecher ?? [])]) {
      if (ring.length < 3) continue;
      // Kette gleichartiger Randstuecke — sonst entstuende je Segment eine
      // eigene Kante und aus einem Gehwegrand wuerden hunderte Bruchstuecke.
      let kette: { punkte: Punkt[]; oben: number[]; unten: number[]; bauart: KantenBauart; partner: FlaechenArt } | null = null;
      const kettenEnde = () => {
        if (kette && kette.punkte.length >= 2) {
          kanten.push({
            id: `bk_${ai}_${nr++}`,
            art: 'sprung',
            bauart: kette.bauart,
            linie: kette.punkte,
            hoehenOben: kette.oben,
            hoehenUnten: kette.unten,
            herkunft: 'bauklasse',
            bezeichnung: `${A.art} an ${kette.partner}`,
          });
        }
        kette = null;
      };

      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const laenge = Math.hypot(dx, dy);
        if (laenge < MIN_SEGMENT_M) continue;
        const ex = dx / laenge;
        const ey = dy / laenge;
        // Links der Laufrichtung: Richtung um +90 Grad gedreht.
        const lx = -ey;
        const ly = ex;
        const m: Punkt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const links: Punkt = [m[0] + lx * SEITE_M, m[1] + ly * SEITE_M];
        const rechts: Punkt = [m[0] - lx * SEITE_M, m[1] - ly * SEITE_M];

        // A liegt auf einer der beiden Seiten; die andere traegt den Nachbarn.
        const iLinks = index.bei(links);
        const aLinks = iLinks === ai;
        const nachbarIdx = aLinks ? index.bei(rechts, ai) : iLinks;
        if (nachbarIdx < 0) {
          kettenEnde();
          continue;
        }
        const B = flaechen[nachbarIdx];
        const hB = B.konstruktionM ?? 0;
        const dh = hA - hB;
        if (!(dh > 0.03)) {
          kettenEnde();
          continue;
        }

        // Was das Gelaendemodell selbst schon an Stufe zeigt.
        const hoehLinks = hoeheBei(links[0], links[1]);
        const hoehRechts = hoeheBei(rechts[0], rechts[1]);
        const gemessen = aLinks ? hoehLinks - hoehRechts : hoehRechts - hoehLinks;
        gemessene.push(gemessen);

        const { bauart } = bauartFuer(dh);
        if (bauart === 'fuge') {
          kettenEnde();
          continue;
        }

        // Laufrichtung so, dass die HOEHERE Flaeche links liegt.
        //
        // Die Kantenhoehen sind DIESELBE Rechnung, die auch die Flaechen
        // hebt: Gelaende + Konstruktionshoehe. Nur so stossen Bordsteinkrone
        // und Gehwegflaeche auf denselben Wert — jede eigene Formel hier
        // waere ein neuer Millimeter-Streit.
        const vonP: Punkt = aLinks ? p : q;
        const bisQ: Punkt = aLinks ? q : p;
        const gelaendeVon = hoeheBei(vonP[0], vonP[1]);
        const gelaendeBis = hoeheBei(bisQ[0], bisQ[1]);
        const obenVon = gelaendeVon + hA;
        const obenBis = gelaendeBis + hA;
        const untenVon = gelaendeVon + hB;
        const untenBis = gelaendeBis + hB;

        if (kette && kette.bauart === bauart && kette.partner === B.art) {
          const letzte = kette.punkte[kette.punkte.length - 1];
          if (Math.hypot(letzte[0] - vonP[0], letzte[1] - vonP[1]) < 0.05) {
            kette.punkte.push(bisQ);
            kette.oben.push(obenBis);
            kette.unten.push(untenBis);
            continue;
          }
          kettenEnde();
        }
        kette = {
          punkte: [vonP, bisQ],
          oben: [obenVon, obenBis],
          unten: [untenVon, untenBis],
          bauart,
          partner: B.art,
        };
      }
      kettenEnde();
    }
  }

  const nachBauart: KantenErgebnis['nachBauart'] = {};
  let laenge = 0;
  for (const k of kanten) {
    let l = 0;
    for (let i = 1; i < k.linie.length; i++) {
      l += Math.hypot(k.linie[i][0] - k.linie[i - 1][0], k.linie[i][1] - k.linie[i - 1][1]);
    }
    laenge += l;
    const e = (nachBauart[k.bauart] ??= { anzahl: 0, laengeM: 0 });
    e.anzahl++;
    e.laengeM += l;
  }
  for (const e of Object.values(nachBauart)) e.laengeM = Math.round(e.laengeM);

  const sortiert = [...gemessene].sort((a, b) => a - b);
  return {
    kanten,
    laengeM: Math.round(laenge),
    nachBauart,
    gemesseneStufeMittelM: gemessene.length ? gemessene.reduce((a, b) => a + b, 0) / gemessene.length : 0,
    gemesseneStufeMedianM: sortiert.length ? sortiert[Math.floor(sortiert.length / 2)] : 0,
  };
}
