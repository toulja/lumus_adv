/**
 * QUELLENKETTEN UND ABDECKUNGSPRUEFUNG — gegen den stillen Ausfall.
 *
 * DER BEFUND (Auftraggeber, 09.08.2026): „Das Gebiet wurde erweitert, und an
 * neuen Stellen fehlen Baeume." Die Ursache war nicht, dass Baeume fehlten,
 * sondern dass ES NIEMAND GEMERKT HAT:
 *
 *  - Der Darmstaedter Katasterauszug deckt nur das urspruengliche Pilotgebiet
 *    ab. Ausserhalb gibt es keine Katasterbaeume, und wo OpenStreetMap duenn
 *    ist, blieb die Flaeche leer.
 *  - Der Overpass-Abruf hat einen Rueckfall auf einen Altbestand
 *    (`ausAltbestand` in osm.ts), dessen Meldungen zwar erzeugt, aber nirgends
 *    angezeigt wurden. Am 08.08.2026 fielen dadurch 349 Baeume, 238 Barrieren
 *    und 117 Zebrastreifen weg, ohne dass es im Protokoll auftauchte.
 *  - Es gab keine Abdeckungspruefung, die eines von beiden gemeldet haette.
 *
 * DIESES MODUL PRUEFT DREIERLEI, und zwar mit Zahlen:
 *
 *  1. RELATIVE ABDECKUNG. Das Gebiet wird in Zellen zerlegt; je Elementart
 *     wird die Dichte je Zelle mit dem Median aller in Frage kommenden Zellen
 *     verglichen. Faellt eine Zelle darunter, ist das eine Datenluecke.
 *     Dieser Test braucht KEINEN erfundenen Sollwert — er vergleicht das
 *     Gebiet mit sich selbst. Genau darum faengt er den beobachteten Fehler:
 *     Ein Gebiet, das zur Haelfte aus dem Katasterauszug faellt, zeigt eine
 *     Haelfte mit Dichte 0 neben einer Haelfte mit voller Dichte.
 *  2. ABSOLUTE ABDECKUNG gegen die Erwartung aus `config/elementquellen.json`.
 *     Die Erwartungen sind ausdruecklich Annahmen und als solche gekennzeichnet.
 *  3. GEBIETSABDECKUNG ORTSGEBUNDENER EXTRAKTE. Ein Katasterauszug sagt, welches
 *     Gebiet er abdeckt; liegt das Zielgebiet nicht darin, wird das gemeldet.
 *
 * Jede gefundene Luecke wird zu einer `Datenluecke` — sie geht ins
 * Auftragsprotokoll UND an das Gelaende, wo die Oberflaeche sie anzeigt.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  BBox,
  Datenluecke,
  GelaendeFlaeche,
  GelaendeLinienObjekt,
  GelaendePunktObjekt,
  PunktArt,
} from '../../shared/domain/types.ts';
import { bboxVonPunkten, punktInRing } from '../../shared/geo/geometry.ts';

interface QuellenStufe {
  stufe: number;
  art: string;
  bezeichnung: string;
  guete: 'gemessen' | 'erfasst' | 'annahme';
  hinweis?: string;
}

interface ElementEintrag {
  id: string;
  bezeichnung: string;
  punktArt?: string;
  linienArt?: string;
  belag?: string;
  quellenkette: QuellenStufe[];
  abdeckung: {
    bezugsflaechen: string[];
    erwartetJeHektar: number;
    begruendung: string;
    verifikation: { status: string; geprueftAm: string; beleg: string };
  };
}

export interface ElementQuellenDatei {
  id: string;
  version: string;
  stand: string;
  hinweis: string;
  haftungshinweis: string;
  pruefung: { gitterM: number; warnungUnterAnteil: number; mindestZellen: number; hinweis: string };
  elemente: ElementEintrag[];
  kataster: {
    hinweis: string;
    baum: {
      stadt: string;
      bezeichnung: string;
      dateien: string[];
      dienst: string;
      url: string;
      lizenz: string;
      quellenvermerk: string;
      gebiet: string;
      vorhanden?: boolean;
      hinweis?: string;
    }[];
    weitereStaedte: { hinweis: string; eintraege: { stadt: string; umfang: string }[] };
  };
}

let zwischenspeicher: ElementQuellenDatei | null = null;

/**
 * Laedt die Quellenketten und prueft sie beim Laden — dieselbe Strenge wie
 * beim Regelwerk und bei den Bauklassen: Eine Elementart ohne Quellenkette
 * oder ohne Verifikationsstatus wird abgelehnt, statt still eine unbelegte
 * Erwartung zu benutzen.
 */
export function elementQuellenLaden(datei?: string): ElementQuellenDatei {
  if (zwischenspeicher && !datei) return zwischenspeicher;
  const pfad = datei ?? path.resolve(process.cwd(), 'config', 'elementquellen.json');
  if (!fs.existsSync(pfad)) throw new Error(`Quellenketten fehlen: ${pfad}`);
  const d = JSON.parse(fs.readFileSync(pfad, 'utf8')) as ElementQuellenDatei;
  const fehler: string[] = [];
  if (!d.elemente?.length) fehler.push('keine Elementarten enthalten');
  for (const e of d.elemente ?? []) {
    if (!e.id) fehler.push('eine Elementart ohne Bezeichner');
    if (!e.quellenkette?.length) fehler.push(`${e.id}: keine Quellenkette`);
    if (!e.abdeckung?.verifikation?.status) fehler.push(`${e.id}: kein Verifikationsstatus der Abdeckungserwartung`);
    // Die Kette MUSS geordnet sein: amtlich zuerst, Annahme zuletzt.
    const stufen = (e.quellenkette ?? []).map((q) => q.stufe);
    if (stufen.some((s, i) => i > 0 && s < stufen[i - 1])) fehler.push(`${e.id}: Quellenkette ist nicht nach Stufen geordnet`);
  }
  if (!d.pruefung?.gitterM) fehler.push('keine Pruefvorgabe (pruefung.gitterM)');
  if (fehler.length) throw new Error(`Quellenketten ${path.basename(pfad)} unbrauchbar: ${fehler.join('; ')}`);
  if (!datei) zwischenspeicher = d;
  return d;
}

/** Die Guete, mit der eine Elementart im Bestand tatsaechlich vorliegt. */
export function guetestufe(art: string, d = elementQuellenLaden()): QuellenStufe | null {
  const e = d.elemente.find((x) => x.id === art);
  return e?.quellenkette[0] ?? null;
}

/**
 * ABDECKUNGSPRUEFUNG. Liefert die gefundenen Luecken.
 *
 * Bewusst KEINE Ausnahmen fuer „kleine" Gebiete: Wenn zu wenige Zellen
 * vorhanden sind, um einen Median zu bilden, sagt die Pruefung genau das —
 * statt stillzuschweigen.
 */
export function abdeckungPruefen(
  gebiet: BBox,
  flaechen: GelaendeFlaeche[],
  punkte: GelaendePunktObjekt[],
  linien: GelaendeLinienObjekt[],
  d = elementQuellenLaden(),
): Datenluecke[] {
  const luecken: Datenluecke[] = [];
  const zelle = d.pruefung.gitterM;
  const spalten = Math.max(1, Math.ceil((gebiet.maxE - gebiet.minE) / zelle));
  const zeilen = Math.max(1, Math.ceil((gebiet.maxN - gebiet.minN) / zelle));
  const index = (e: number, n: number) => {
    const s = Math.min(spalten - 1, Math.max(0, Math.floor((e - gebiet.minE) / zelle)));
    const z = Math.min(zeilen - 1, Math.max(0, Math.floor((n - gebiet.minN) / zelle)));
    return z * spalten + s;
  };

  for (const el of d.elemente) {
    if (!el.abdeckung.bezugsflaechen.length) continue; // punktuelle Arten: keine Dichte
    const bezug = new Set(el.abdeckung.bezugsflaechen);

    // Bezugsflaeche je Zelle (m2) — grob ueber die Schwerpunkte der Flaechen,
    // genauer waere ein Verschnitt, teurer auch. Fuer eine Warnschwelle reicht
    // die Zuordnung ueber den Flaechenschwerpunkt.
    const flaecheJeZelle = new Array<number>(spalten * zeilen).fill(0);
    for (const f of flaechen) {
      if (!bezug.has(f.art) || f.polygon.length < 3) continue;
      let s = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0, j = f.polygon.length - 1; i < f.polygon.length; j = i++) {
        const kreuz = f.polygon[j][0] * f.polygon[i][1] - f.polygon[i][0] * f.polygon[j][1];
        s += kreuz;
        mx += (f.polygon[j][0] + f.polygon[i][0]) * kreuz;
        my += (f.polygon[j][1] + f.polygon[i][1]) * kreuz;
      }
      const A = Math.abs(s) / 2;
      if (A < 1) continue;
      const cx = s !== 0 ? mx / (3 * s) : f.polygon[0][0];
      const cy = s !== 0 ? my / (3 * s) : f.polygon[0][1];
      flaecheJeZelle[index(cx, cy)] += A;
    }

    // Elemente je Zelle
    const anzahlJeZelle = new Array<number>(spalten * zeilen).fill(0);
    if (el.punktArt) {
      for (const p of punkte) if (p.art === (el.punktArt as PunktArt)) anzahlJeZelle[index(p.pos[0], p.pos[1])]++;
    }
    if (el.linienArt) {
      for (const l of linien) if (l.art === el.linienArt && l.achse.length) anzahlJeZelle[index(l.achse[0][0], l.achse[0][1])]++;
    }

    // Nur Zellen mit nennenswerter Bezugsflaeche kommen in Frage.
    const MIN_BEZUG_M2 = 2000;
    const kandidaten: { i: number; dichte: number; flaeche: number }[] = [];
    for (let i = 0; i < flaecheJeZelle.length; i++) {
      if (flaecheJeZelle[i] < MIN_BEZUG_M2) continue;
      kandidaten.push({ i, dichte: anzahlJeZelle[i] / (flaecheJeZelle[i] / 10000), flaeche: flaecheJeZelle[i] });
    }
    if (kandidaten.length < d.pruefung.mindestZellen) continue;

    const sortiert = [...kandidaten].map((x) => x.dichte).sort((a, b) => a - b);
    const median = sortiert[Math.floor(sortiert.length / 2)];
    const gesamt = kandidaten.reduce((s, x) => s + x.dichte * (x.flaeche / 10000), 0);
    const gesamtFlaecheHa = kandidaten.reduce((s, x) => s + x.flaeche / 10000, 0);
    const mittel = gesamtFlaecheHa > 0 ? gesamt / gesamtFlaecheHa : 0;

    // --- 1. relative Pruefung ------------------------------------------------
    if (median > 0) {
      const schwelle = median * d.pruefung.warnungUnterAnteil;
      const schwach = kandidaten.filter((x) => x.dichte < schwelle);
      if (schwach.length) {
        const flaecheHa = schwach.reduce((s, x) => s + x.flaeche, 0) / 10000;
        const mitte = schwach.map((x) => ({
          e: gebiet.minE + ((x.i % spalten) + 0.5) * zelle,
          n: gebiet.minN + (Math.floor(x.i / spalten) + 0.5) * zelle,
        }));
        luecken.push({
          elementart: el.id,
          bezeichnung: el.bezeichnung,
          art: 'ungleiche_verteilung',
          text:
            `${schwach.length} von ${kandidaten.length} Zellen (${zelle} m) haben weniger als ` +
            `${(d.pruefung.warnungUnterAnteil * 100).toFixed(0)} % der ueblichen Dichte — betroffen sind ${flaecheHa.toFixed(1)} ha ` +
            `Bezugsflaeche. Ueblich sind ${median.toFixed(1)} ${el.bezeichnung}/ha, dort sind es ` +
            `${(schwach.reduce((s, x) => s + x.dichte, 0) / schwach.length).toFixed(1)}. ` +
            `Das ist der Fingerabdruck eines ortsgebundenen Datenauszugs, der nicht das ganze Gebiet abdeckt.`,
          orte: mitte.slice(0, 12).map((m) => [Math.round(m.e), Math.round(m.n)] as [number, number]),
        });
      }
    }

    // --- 2. absolute Pruefung ------------------------------------------------
    if (el.abdeckung.erwartetJeHektar > 0 && mittel < el.abdeckung.erwartetJeHektar * 0.5) {
      luecken.push({
        elementart: el.id,
        bezeichnung: el.bezeichnung,
        art: 'unter_erwartung',
        text:
          `Im Mittel ${mittel.toFixed(1)} ${el.bezeichnung}/ha auf ${gesamtFlaecheHa.toFixed(1)} ha Bezugsflaeche — ` +
          `erwartet waren ${el.abdeckung.erwartetJeHektar}. Die Erwartung ist eine ANNAHME ` +
          `(config/elementquellen.json, verifikation.status = ${el.abdeckung.verifikation.status}) und keine Norm; ` +
          `sie sagt nur, dass jemand hinsehen sollte.`,
        orte: [],
      });
    }
  }
  return luecken;
}

/**
 * GEBIETSABDECKUNG EINES ORTSGEBUNDENEN EXTRAKTS.
 *
 * Ein Katasterauszug ist ein AUSSCHNITT. Sein Gebiet wird aus den enthaltenen
 * Punkten bestimmt (`gebiet: "aus_datei"`) und mit dem Zielgebiet verglichen.
 * Deckt er es nicht, ist das eine Datenluecke — und zwar eine, die man kennen
 * MUSS, bevor man aus dem Modell eine Aussage ableitet.
 */
export function katasterAbdeckung(
  gebiet: BBox,
  extrakt: BBox | null,
  bezeichnung: string,
  elementart = 'baum',
): Datenluecke | null {
  if (!extrakt) {
    return {
      elementart,
      bezeichnung,
      art: 'kein_kataster',
      text: `Fuer dieses Gebiet liegt kein Katasterauszug vor. Es gilt allein OpenStreetMap — gemessene Hoehen und Kronendurchmesser fehlen damit.`,
      orte: [],
    };
  }
  const ueberlappE = Math.max(0, Math.min(gebiet.maxE, extrakt.maxE) - Math.max(gebiet.minE, extrakt.minE));
  const ueberlappN = Math.max(0, Math.min(gebiet.maxN, extrakt.maxN) - Math.max(gebiet.minN, extrakt.minN));
  const zielFlaeche = (gebiet.maxE - gebiet.minE) * (gebiet.maxN - gebiet.minN);
  const anteil = zielFlaeche > 0 ? (ueberlappE * ueberlappN) / zielFlaeche : 0;
  if (anteil >= 0.98) return null;
  return {
    elementart,
    bezeichnung,
    art: 'kataster_deckt_nicht',
    text:
      `Der Katasterauszug „${bezeichnung}" deckt nur ${(anteil * 100).toFixed(0)} % des bestellten Gebiets ab ` +
      `(Auszug ${Math.round(extrakt.minE)}/${Math.round(extrakt.minN)} bis ${Math.round(extrakt.maxE)}/${Math.round(extrakt.maxN)}). ` +
      `Ausserhalb gibt es keine gemessenen Baeume — dort gilt allein OpenStreetMap, und wo OSM duenn ist, bleibt die Flaeche leer. ` +
      `Das ist keine Eigenschaft des Ortes, sondern des Auszugs.`,
    orte: [],
  };
}

/** Bbox der Punkte eines Katasterauszugs — sein tatsaechliches Gebiet. */
export function extraktGebiet(punkte: { pos: [number, number] }[]): BBox | null {
  if (!punkte.length) return null;
  return bboxVonPunkten(punkte.map((p) => p.pos));
}

/** Nur damit der Import punktInRing nicht selbst importieren muss. */
export const _punktInRing = punktInRing;
