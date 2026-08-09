/**
 * NETZ — aus Einzelwegen wird ein zusammenhaengender Strang.
 *
 * DAS PROBLEM (nachgemessen 09.08.2026, Pilotgebiet):
 * Die 73 Gleisstuecke des Gebiets haben 146 Enden. 95 dieser Enden liegen
 * deckungsgleich auf dem Ende eines anderen Stuecks. Sie sind also gar keine
 * Enden, sondern kuenstliche Schnitte — OpenStreetMap teilt einen Weg bei
 * jedem Attributwechsel, und der Gebietszuschnitt teilt ihn ein zweites Mal.
 * Wer jedes Stueck fuer sich zeichnet, bekommt genau das, was der Auftraggeber
 * sieht: Schienen, die einfach abbrechen.
 *
 * DIE LOESUNG ist keine Zeichenkorrektur, sondern eine Topologie: Endpunkte,
 * die zusammenfallen, sind DERSELBE Knoten. Ueber jeden Knoten mit genau zwei
 * Anschluessen laeuft der Strang durch; erst ein Knoten mit drei oder mehr
 * Anschluessen ist eine Weiche und bleibt einer.
 *
 * WARUM GEOMETRISCH UND NICHT UEBER OSM-KNOTEN-IDs: Die IDs waeren exakter,
 * stehen aber nach dem Zuschnitt aufs Gebiet nicht mehr fuer jeden Punkt zur
 * Verfuegung (an der Gebietskante entstehen neue Punkte). Der geometrische
 * Abgleich mit 5 cm Toleranz trifft beide Faelle — bei Koordinaten, die aus
 * derselben Quelle stammen, liegen zusammengehoerige Enden exakt aufeinander.
 *
 * Diese Datei laeuft im Server UND im Browser.
 */

import type { Punkt } from '../domain/types.ts';

/** Zwei Enden gelten als derselbe Knoten, wenn sie naeher liegen als das. */
const KNOTEN_TOLERANZ_M = 0.05;

export interface NetzKante<T> {
  /** Stuetzpunkte in Laufrichtung. */
  punkte: Punkt[];
  /** Das Ursprungsobjekt, aus dem diese Kante stammt. */
  quelle: T;
}

export interface Strang<T> {
  id: string;
  /** Durchgehende Achse ueber alle zusammengefassten Kanten. */
  punkte: Punkt[];
  /** Die Ursprungsobjekte in Reihenfolge — ihre Merkmale bleiben abrufbar. */
  quellen: T[];
  /** true = geschlossener Ring (Wendeschleife). */
  geschlossen: boolean;
}

export interface NetzBericht {
  kanten: number;
  knoten: number;
  /** Knoten mit drei oder mehr Anschluessen — Weichen und Kreuzungen. */
  verzweigungen: number;
  /** Knoten mit genau einem Anschluss — echte Streckenenden. */
  enden: number;
  straenge: number;
  /** Wie viele kuenstliche Schnitte durch das Zusammenfassen verschwunden sind. */
  geheilteSchnitte: number;
}

interface Knoten {
  pos: Punkt;
  kanten: { kante: number; amAnfang: boolean }[];
}

/**
 * Fasst Einzelkanten zu durchgehenden Straengen zusammen.
 *
 * Der Rueckgabewert traegt die Ursprungsobjekte mit: eine Bauart kann
 * abschnittsweise wechseln (Rillenschiene im Strassenraum, Schotteroberbau
 * daneben), und dann muss der Strang das auch abschnittsweise wissen. Ein
 * Strang ist eine durchgehende ACHSE, keine Behauptung, dass alles daran
 * gleich gebaut ist.
 */
export function straengeBilden<T>(kanten: NetzKante<T>[]): { straenge: Strang<T>[]; bericht: NetzBericht } {
  const knoten: Knoten[] = [];
  const raster = new Map<string, number[]>();
  const ZELLE = 1;
  const schluessel = (p: Punkt) => `${Math.floor(p[0] / ZELLE)}:${Math.floor(p[1] / ZELLE)}`;

  const knotenFuer = (p: Punkt): number => {
    // Nachbarzellen mitprüfen: ein Punkt dicht an der Zellgrenze haette sonst
    // seinen Partner in der Nachbarzelle und bekaeme einen eigenen Knoten.
    const cx = Math.floor(p[0] / ZELLE);
    const cy = Math.floor(p[1] / ZELLE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const liste = raster.get(`${cx + dx}:${cy + dy}`);
        if (!liste) continue;
        for (const i of liste) {
          const q = knoten[i].pos;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= KNOTEN_TOLERANZ_M) return i;
        }
      }
    }
    const neu = knoten.length;
    knoten.push({ pos: p, kanten: [] });
    const s = schluessel(p);
    const liste = raster.get(s);
    if (liste) liste.push(neu);
    else raster.set(s, [neu]);
    return neu;
  };

  const anfang: number[] = [];
  const ende: number[] = [];
  for (let i = 0; i < kanten.length; i++) {
    const k = kanten[i];
    if (k.punkte.length < 2) {
      anfang.push(-1);
      ende.push(-1);
      continue;
    }
    const a = knotenFuer(k.punkte[0]);
    const e = knotenFuer(k.punkte[k.punkte.length - 1]);
    anfang.push(a);
    ende.push(e);
    knoten[a].kanten.push({ kante: i, amAnfang: true });
    knoten[e].kanten.push({ kante: i, amAnfang: false });
  }

  const benutzt = new Array(kanten.length).fill(false);
  const straenge: Strang<T>[] = [];
  let nr = 0;

  /** Naechste Kante an diesem Knoten, die noch frei ist — nur bei Grad 2. */
  const weiter = (knotenIdx: number, vonKante: number): { kante: number; amAnfang: boolean } | null => {
    const kn = knoten[knotenIdx];
    if (kn.kanten.length !== 2) return null; // Weiche oder Ende: hier ist Schluss
    for (const a of kn.kanten) {
      if (a.kante !== vonKante && !benutzt[a.kante]) return a;
    }
    return null;
  };

  const anhaengen = (strang: { punkte: Punkt[]; quellen: T[] }, kante: number, umgekehrt: boolean) => {
    const p = umgekehrt ? [...kanten[kante].punkte].reverse() : kanten[kante].punkte;
    // Ersten Punkt weglassen, wenn er der letzte des bisherigen Strangs ist.
    const von = strang.punkte.length && naheBei(strang.punkte[strang.punkte.length - 1], p[0]) ? 1 : 0;
    for (let i = von; i < p.length; i++) strang.punkte.push(p[i]);
    strang.quellen.push(kanten[kante].quelle);
  };

  // Zuerst von den ECHTEN Enden aus laufen (Grad ungleich 2). Was danach noch
  // frei ist, ist ein Ring ohne Anfang und wird eigens behandelt.
  const startpunkte: number[] = [];
  for (let i = 0; i < kanten.length; i++) {
    if (anfang[i] < 0) continue;
    if (knoten[anfang[i]].kanten.length !== 2 || knoten[ende[i]].kanten.length !== 2) startpunkte.push(i);
  }

  const strangBauen = (startKante: number, startUmgekehrt: boolean, geschlossen: boolean) => {
    const strang = { punkte: [] as Punkt[], quellen: [] as T[] };
    let kante = startKante;
    let umgekehrt = startUmgekehrt;
    for (;;) {
      benutzt[kante] = true;
      anhaengen(strang, kante, umgekehrt);
      const endKnoten = umgekehrt ? anfang[kante] : ende[kante];
      const naechste = weiter(endKnoten, kante);
      if (!naechste) break;
      kante = naechste.kante;
      umgekehrt = !naechste.amAnfang;
    }
    if (strang.punkte.length >= 2) {
      straenge.push({ id: `strang_${nr++}`, punkte: strang.punkte, quellen: strang.quellen, geschlossen });
    }
  };

  for (const i of startpunkte) {
    if (benutzt[i]) continue;
    // In die Richtung laufen, die vom Ende WEG fuehrt.
    const vomAnfang = knoten[anfang[i]].kanten.length !== 2;
    strangBauen(i, !vomAnfang, false);
  }
  for (let i = 0; i < kanten.length; i++) {
    if (benutzt[i] || anfang[i] < 0) continue;
    strangBauen(i, false, true);
  }

  let verzweigungen = 0;
  let enden = 0;
  let doppelEnden = 0;
  for (const kn of knoten) {
    if (kn.kanten.length >= 3) verzweigungen++;
    else if (kn.kanten.length === 1) enden++;
    else if (kn.kanten.length === 2) doppelEnden++;
  }

  return {
    straenge,
    bericht: {
      kanten: kanten.length,
      knoten: knoten.length,
      verzweigungen,
      enden,
      straenge: straenge.length,
      geheilteSchnitte: doppelEnden,
    },
  };
}

function naheBei(a: Punkt, b: Punkt): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= KNOTEN_TOLERANZ_M;
}

/**
 * Glaettet eine Achse, ohne sie zu verfaelschen.
 *
 * WOFUER: Eine Strassenbahnkurve mit 25 m Radius hat in OpenStreetMap oft nur
 * drei Stuetzpunkte. Als Polygonzug gezeichnet knickt sie sichtbar; die
 * Schienen laufen dann in geraden Stuecken um die Ecke. Geglaettet wird mit
 * einem Chaikin-Schritt („corner cutting"): Er erzeugt KEINE neuen
 * Richtungen, sondern schneidet die Ecken zwischen vorhandenen Punkten ab —
 * die Achse bleibt damit innerhalb ihrer eigenen konvexen Huelle und wandert
 * nie neben die Trasse.
 *
 * Enden bleiben unangetastet, sonst wuerde ein Strang an der Anschlussstelle
 * eines Nachbarn abrutschen.
 */
export function achseGlaetten(punkte: Punkt[], durchgaenge = 2, minSegmentM = 1.5): Punkt[] {
  let p = punkte;
  for (let d = 0; d < durchgaenge; d++) {
    if (p.length < 3) return p;
    const out: Punkt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Kurze Segmente nicht weiter zerschneiden — sonst waechst die
      // Punktzahl in engen Kurven ohne Gewinn.
      if (l < minSegmentM) {
        if (i > 0) out.push(a);
        continue;
      }
      if (i > 0) out.push([a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25]);
      if (i < p.length - 2) out.push([a[0] + (b[0] - a[0]) * 0.75, a[1] + (b[1] - a[1]) * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
