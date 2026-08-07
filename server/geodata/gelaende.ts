/**
 * Gelaende-Import (F1): aus einem Gebietsrechteck einen digitalen Zwilling
 * bauen — Gelaendehoehen, Gebaeude, Luftbildtextur, Flurstuecke, Quellennachweis.
 *
 * Aufbau des Gelaendes als KACHELGITTER in UTM-Koordinaten: jede Kachel traegt
 * ein eigenes Hoehengitter und ein eigenes Orthophoto, das ueber den WMS in
 * genau derselben UTM-Bbox angefordert wird. Dadurch sitzt das Luftbild
 * pixelgenau auf dem Gelaende — ganz ohne Umprojizierung und ohne den
 * Versatz, den ein Warp nach WGS84 an den Kachelraendern erzeugen wuerde.
 */

import polygonClipping from 'polygon-clipping';
import type { BBox, Gelaende, GelaendeFlaeche, GelaendePatch, Quellennachweis, Ring } from '../../shared/domain/types.ts';
import { HoehenFeld, aufPolylinie, bboxFlaeche, bboxRing, bboxVonPunkten, polylinieLaenge, punktInRing, ringNormalisieren, schwerpunkt } from '../../shared/geo/geometry.ts';
import type { Stuetzpunkt } from '../../shared/geo/geometry.ts';
import { gelaende as gelaendeStore, id, jetzt } from '../lib/store.ts';
import { geoKonfig } from './konfig.ts';
import * as lod2 from './lod2.ts';
import * as alkis from './alkis.ts';
import { orthophoto } from './wms.ts';

export const MAX_GEBIET_M2 = 2_000_000; // Lastenheft F1.1: max. 2 km2

export interface ImportAuftrag {
  id: string;
  name: string;
  bbox: BBox;
  land: string;
  kreis?: string;
  nutzerId: string;
  status: 'wartet' | 'laeuft' | 'fertig' | 'fehler';
  schritt: string;
  fortschritt: number;
  begonnen: string;
  beendet?: string;
  gelaendeId?: string;
  fehler?: string;
  meldungen: string[];
}

const auftraege = new Map<string, ImportAuftrag>();

export function auftrag(aid: string): ImportAuftrag | undefined {
  return auftraege.get(aid);
}
export function alleAuftraege(): ImportAuftrag[] {
  return [...auftraege.values()];
}

function melde(a: ImportAuftrag, schritt: string, fortschritt: number, meldung?: string) {
  a.schritt = schritt;
  a.fortschritt = Math.max(0, Math.min(1, fortschritt));
  if (meldung) {
    a.meldungen.push(`${new Date().toLocaleTimeString('de-DE')} ${meldung}`);
    if (a.meldungen.length > 200) a.meldungen.shift();
  }
}

/** Zerlegt das Gebiet in moeglichst quadratische Kacheln von ca. 300 m. */
function kachelGitter(bbox: BBox, zielM = 300): BBox[] {
  const spalten = Math.max(1, Math.round((bbox.maxE - bbox.minE) / zielM));
  const zeilen = Math.max(1, Math.round((bbox.maxN - bbox.minN) / zielM));
  const dE = (bbox.maxE - bbox.minE) / spalten;
  const dN = (bbox.maxN - bbox.minN) / zeilen;
  const out: BBox[] = [];
  for (let z = 0; z < zeilen; z++) {
    for (let s = 0; s < spalten; s++) {
      out.push({
        minE: bbox.minE + s * dE,
        maxE: bbox.minE + (s + 1) * dE,
        minN: bbox.minN + z * dN,
        maxN: bbox.minN + (z + 1) * dN,
      });
    }
  }
  return out;
}

/**
 * Verwirft Bodenhoehen, die nicht zu ihrer Nachbarschaft passen.
 *
 * Warum das noetig ist: Einzelne LoD2-Objekte tragen eine Bodenhoehe, die
 * nicht die Gelaendeoberflaeche meint (z. B. Bauwerke in Einschnitten oder
 * fehlerhafte Erfassung). Ein einziger solcher Punkt zieht das interpolierte
 * Gelaende weit nach unten. Ein globaler Filter waere falsch — die Darmstaedter
 * Innenstadt steigt zur Mathildenhoehe real um mehr als 30 m. Darum wird
 * gegen den MEDIAN der naechsten Nachbarn geprueft, nicht gegen den Gesamtwert.
 */
function ausreisserEntfernen(punkte: Stuetzpunkt[], nachbarn = 12, grenzeM = 8): Stuetzpunkt[] {
  if (punkte.length < nachbarn * 2) return punkte;
  const ZELLE = 150;
  const gitter = new Map<string, Stuetzpunkt[]>();
  const schluessel = (e: number, n: number) => `${Math.floor(e / ZELLE)}:${Math.floor(n / ZELLE)}`;
  for (const p of punkte) {
    const k = schluessel(p.e, p.n);
    const liste = gitter.get(k);
    if (liste) liste.push(p);
    else gitter.set(k, [p]);
  }
  const behalten: Stuetzpunkt[] = [];
  for (const p of punkte) {
    const ce = Math.floor(p.e / ZELLE);
    const cn = Math.floor(p.n / ZELLE);
    const umfeld: Stuetzpunkt[] = [];
    for (let de = -1; de <= 1; de++) {
      for (let dn = -1; dn <= 1; dn++) {
        const liste = gitter.get(`${ce + de}:${cn + dn}`);
        if (liste) umfeld.push(...liste);
      }
    }
    if (umfeld.length < nachbarn) {
      behalten.push(p);
      continue;
    }
    umfeld.sort((a, b) => (a.e - p.e) ** 2 + (a.n - p.n) ** 2 - ((b.e - p.e) ** 2 + (b.n - p.n) ** 2));
    const nah = umfeld.slice(0, nachbarn).map((x) => x.h).sort((a, b) => a - b);
    const median = nah[Math.floor(nah.length / 2)];
    if (Math.abs(p.h - median) <= grenzeM) behalten.push(p);
  }
  // Nie alles verwerfen — im Zweifel lieber die Rohdaten behalten
  return behalten.length >= punkte.length * 0.5 ? behalten : punkte;
}

/**
 * Vereinigt die Nutzungsflaechen JE KLASSE zu zusammenhaengenden Geometrien.
 *
 * Kartografischer Hintergrund (docs/KARTENDESIGN.md, 5.3): Gepufferte Achsen
 * ergeben ohne Union kein Netz, sondern einen Stapel Einzelplatten. Jede
 * Segmentgrenze wird sichtbar, Ueberlappungen erzeugen Kanten, und eine Kontur
 * wuerde jede innere Naht nachzeichnen statt den Aussenrand.
 *
 * Die Vereinigung laeuft je Klasse in Bloecken — polygon-clipping wird bei
 * mehreren hundert Geometrien auf einen Schlag sehr langsam.
 */
function flaechenVereinigen(flaechen: GelaendeFlaeche[]): GelaendeFlaeche[] {
  // Schluessel ist Art UND Quelle: ALKIS liefert den gesamten Strassenraum
  // (die "Platte"), OSM die befahrbare Fahrbahn (den "Decker"). Beide tragen
  // die Art "fahrbahn", meinen aber Verschiedenes und muessen darum getrennt
  // bleiben — sonst entsteht genau die Doppelbelegung, die die Strassen
  // unlesbar gemacht hat (docs/KARTENDESIGN.md, 5.2).
  const nachArt = new Map<string, GelaendeFlaeche[]>();
  for (const f of flaechen) {
    // VERSCHMELZUNGSGRUPPEN
    //
    // Ein Platz ist EINE Flaeche in der Wirklichkeit. ALKIS fuehrt ihn als
    // "Platz", OSM zusaetzlich als "Fussgaengerzone" mit eigenem Belag —
    // beide meinen dasselbe Pflaster. Werden sie getrennt gezeichnet, bekommt
    // der innere Teil einen anderen Ton als der Rand, und der Platz zerfaellt
    // optisch in Flecken (am Marktplatz Darmstadt nachgemessen: 9.316 m2 ALKIS
    // gegen 6.381 m2 OSM). Darum landen sie in EINER Gruppe, ohne Quelle und
    // ohne Belag im Schluessel.
    const platzartig = f.art === 'platz' || f.art === 'fussgaengerzone';
    const schluessel = platzartig
      ? 'platzartig'
      : f.art + "|" + f.quelle + "|" + (f.belag ?? "");
    const liste = nachArt.get(schluessel);
    if (liste) liste.push(f);
    else nachArt.set(schluessel, [f]);
  }

  const out: GelaendeFlaeche[] = [];
  for (const [schluessel, liste] of nachArt) {
    const art = schluessel.split("|")[0];
    if (liste.length === 1) {
      out.push(liste[0]);
      continue;
    }
    const rang = liste[0].rang;
    const quelle = liste[0].quelle;
    const belag = liste[0].belag;
    // In der Platzgruppe gewinnt die Fussgaengerzone: sie ist die genauere
    // Aussage (Fussgaengervorrang), waehrend "Platz" nur die Bauform nennt.
    const gruppenArt = schluessel === 'platzartig'
      ? (liste.some((x) => x.art === 'fussgaengerzone') ? 'fussgaengerzone' : 'platz')
      : art;
    // Geometrien im Format von polygon-clipping: [[aussenring, ...loecher]]
    const geoms = liste.map((f) => [
      geschlossenerRing(f.polygon),
      ...(f.loecher ?? []).map(geschlossenerRing),
    ]);
    const teile: (typeof geoms)[number][][] = [];
    const BLOCK = 120;
    for (let i = 0; i < geoms.length; i += BLOCK) teile.push(geoms.slice(i, i + BLOCK));

    let vereint: number[][][][] = [];
    for (const block of teile) {
      try {
        const b = polygonClipping.union(block[0] as never, ...(block.slice(1) as never[]));
        vereint = vereint.length ? (polygonClipping.union(vereint as never, b as never) as never) : (b as never);
      } catch {
        // Entartete Geometrie: den Block unveraendert uebernehmen, statt ihn zu verlieren
        for (const g of block) vereint.push(g as never);
      }
    }

    let nr = 0;
    for (const poly of vereint) {
      const ringe = (poly as unknown as Ring[]).map(ringNormalisieren).filter((r) => r.length >= 3);
      if (!ringe.length) continue;
      out.push({
        id: `${gruppenArt}_${nr++}`,
        art: gruppenArt as GelaendeFlaeche['art'],
        polygon: ringe[0],
        loecher: ringe.length > 1 ? ringe.slice(1) : undefined,
        quelle,
        rang,
        belag: schluessel === 'platzartig' ? undefined : belag,
      });
    }
  }

  // --- Wege aus Plaetzen herausschneiden -----------------------------------
  // Ein Platz ist eine durchgehende Flaeche. Die Fusswege, die OSM quer
  // darueber fuehrt, sind Routen, keine eigenen Belaege — als Streifen
  // gezeichnet zerlegen sie den Platz in Flecken. Fahrbahnen bleiben stehen:
  // eine Strasse ueber einen Platz ist real sichtbar.
  const plaetze = out.filter((f) => f.art === 'platz' || f.art === 'fussgaengerzone');
  if (plaetze.length) {
    const platzGeom = plaetze.map((f) => [
      geschlossenerRing(f.polygon),
      ...(f.loecher ?? []).map(geschlossenerRing),
    ]);
    const HERAUS = new Set(['gehweg', 'weg', 'radweg', 'treppe']);
    const bereinigt: GelaendeFlaeche[] = [];
    for (const f of out) {
      if (!HERAUS.has(f.art)) {
        bereinigt.push(f);
        continue;
      }
      try {
        const rest = polygonClipping.difference(
          [geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)] as never,
          ...(platzGeom as never[]),
        );
        let nr2 = 0;
        for (const poly of rest) {
          const ringe = (poly as unknown as Ring[]).map(ringNormalisieren).filter((r) => r.length >= 3);
          if (!ringe.length) continue;
          bereinigt.push({ ...f, id: `${f.id}_r${nr2++}`, polygon: ringe[0], loecher: ringe.length > 1 ? ringe.slice(1) : undefined });
        }
      } catch {
        bereinigt.push(f);
      }
    }
    return bereinigt;
  }
  return out;
}

/**
 * ============================================================================
 * DAS BODENMODELL
 * ============================================================================
 *
 * Grundsatz, gemessen und bundesweit tragfaehig:
 *
 *   ALKIS "tatsaechliche Nutzung" ist eine LUECKENLOSE und
 *   UEBERSCHNEIDUNGSFREIE Aufteilung der Landesflaeche.
 *
 * Nachgeprueft am Pilotgebiet: 3.000 von 3.000 Rasterpunkten liegen in genau
 * EINER Flaeche — keine Luecke, keine Ueberlappung. Das ist keine Eigenheit
 * Darmstadts, sondern die Definition des Datensatzes: jedem Quadratmeter
 * Deutschlands ist genau eine Nutzungsart zugeordnet.
 *
 * Daraus folgt die Regel, die diese Anwendung ueberall in Deutschland
 * anwendbar macht:
 *
 *   ALKIS ist der Boden. OSM darf ihn VERFEINERN, nie ihm widersprechen.
 *
 * ALKIS fuehrt den Strassenraum als EINE Verkehrsflaeche. Ob darin Fahrbahn,
 * Gehweg oder Radweg liegt, weiss nur OSM. OSM ist damit kein zweiter,
 * konkurrierender Bodendatensatz, sondern eine Untergliederung INNERHALB der
 * amtlichen Klasse.
 *
 * Praktisch heisst das: Jede OSM-Flaeche wird auf die Klassen beschnitten, die
 * sie ueberhaupt verfeinern DARF (Tabelle WIRT). Ein Gehweg, der nach den
 * OSM-Daten quer ueber eine Wiese laeuft, wird dort nicht zum Gehweg — die
 * Wiese bleibt Wiese. Was keine gueltige Verfeinerung erhaelt, behaelt seine
 * amtliche Klasse.
 *
 * Der Gewinn: Wo OSM duenn oder falsch ist — und das ist ausserhalb der
 * Grossstaedte die Regel — bleibt der Boden trotzdem vollstaendig und
 * widerspruchsfrei. Es gibt keine Loecher, keine doppelt eingefaerbten
 * Flaechen und keinen Ort, der eine Sonderbehandlung braucht.
 */

/**
 * Welche amtliche Klasse darf eine OSM-Klasse verfeinern?
 * Leere Liste = die OSM-Klasse wird gar nicht uebernommen.
 */
const WIRT: Record<string, string[]> = {
  // --- Fahrbahn: streng -----------------------------------------------------
  // Eine Fahrbahn gehoert in den Verkehrsraum. Bliebe sie ungebunden, wuerde
  // eine falsch erfasste OSM-Strasse Asphalt quer durch eine Gruenanlage legen.
  fahrbahn: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'sonstige'],

  // --- Fusswege, Radwege, Treppen: weit ------------------------------------
  // GEMESSEN am Pilotgebiet (736 OSM-Gehwegflaechen, Schwerpunkt gegen die
  // amtliche Nutzung geprueft):
  //     54 %  liegen in der ALKIS-Verkehrsflaeche
  //     35 %  liegen auf ALKIS-BAUFLAECHE
  //     11 %  liegen in Gruen oder Wald
  // Das ist kein Erfassungsfehler, sondern Systematik: ALKIS fuehrt die
  // STRASSENPARZELLE. Sie ist vielerorts schmaler als die gepflasterte Flaeche,
  // und der Gehweg liegt katastermaessig auf dem angrenzenden Grundstueck.
  // Eine Bindung an die Verkehrsflaeche verwirft deshalb zwei Drittel aller
  // Gehwege — bundesweit, nicht nur hier.
  // Diese Klassen sind schmal und folgen echten Wegachsen; sie duerfen darum
  // ueberall verfeinern. Nur Wasser bleibt tabu (ein Weg ueber einen Teich ist
  // eine Bruecke und wird gesondert gefuehrt).
  gehweg: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'gruen', 'wald', 'landwirtschaft', 'bebauung', 'sonstige'],
  radweg: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'gruen', 'wald', 'landwirtschaft', 'bebauung', 'sonstige'],
  weg: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'gruen', 'wald', 'landwirtschaft', 'bebauung', 'sonstige'],
  treppe: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'gruen', 'wald', 'landwirtschaft', 'bebauung', 'sonstige'],

  // --- Plaetze und Fussgaengerzonen ----------------------------------------
  // Flaechenhafte Aussagen; sie duerfen den Verkehrsraum und unspezifische
  // Bauflaechen praezisieren, aber keine Gruenanlage zupflastern.
  fussgaengerzone: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'bebauung', 'sonstige'],
  platz: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'bebauung', 'sonstige'],

  bahn: ['fahrbahn', 'platz', 'gruen', 'landwirtschaft', 'bebauung', 'sonstige'],

  // --- Vegetation: nur wo das Kataster unspezifisch ist ---------------------
  // Wo ALKIS bereits Gruen oder Wald fuehrt, ist es die bessere Quelle.
  gruen: ['bebauung', 'sonstige', 'landwirtschaft'],
  wald: ['bebauung', 'sonstige', 'landwirtschaft', 'gruen'],

  // Wasser ist immer Wasser.
  wasser: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'gruen', 'wald', 'landwirtschaft', 'bebauung', 'sonstige'],
};

/**
 * Vorrang UNTER den OSM-Verfeinerungen — wer gewinnt, wo zwei davon
 * uebereinanderliegen. Fachliche Aussage, keine Geschmacksfrage: laeuft ein
 * Gehweg ueber einen Platz, ist der Boden dort Platz (ein Platz hat keinen
 * eigenen Buergersteig); laeuft er ueber die Fahrbahn, ist er Gehweg.
 */
const VERFEINERUNG_VORRANG: string[] = [
  'wasser',
  'treppe',
  'platz',
  'fussgaengerzone',
  'gehweg',
  'radweg',
  'weg',
  'bahn',
  'fahrbahn',
  'wald',
  'gruen',
];

/** Alte Vorrangliste — bleibt fuer den Notweg ohne ALKIS-Basis erhalten. */
const VORRANG: string[] = [
  'treppe',
  'platz',
  'fussgaengerzone',
  'gehweg',
  'radweg',
  'weg',
  'bahn',
  'wasser',
  'fahrbahn', // OSM-Decker: die befahrbare Fahrbahn
  'wald',
  'gruen',
  'bebauung',
  'landwirtschaft',
  'sonstige',
];

/**
 * Baut aus den ueberlappenden Klassenflaechen eine ueberschneidungsfreie
 * FLAECHENAUFTEILUNG: jeder Punkt des Bodens gehoert danach genau EINER Klasse.
 *
 * Warum das der Kern ist:
 * Bisher lagen Strassenraum, Fahrbahn, Gehweg und Platz als eigenstaendige
 * Schichten uebereinander, getrennt nur durch Hoehenversaetze von wenigen
 * Millimetern. An jeder Kreuzung stapelten sich dadurch zwei bis vier Flaechen,
 * die Kontur der einen lief quer durch die andere, und aus der Ferne flimmerte
 * der Tiefenpuffer. Genau das ist es, was ein Betrachter als "an Kreuzungen
 * funktioniert nichts" wahrnimmt.
 *
 * Nach der Aufteilung gibt es nichts mehr zu stapeln. Alle Flaechen liegen auf
 * derselben Hoehe, Kreuzungen sind konstruktionsbedingt sauber, und eine
 * Kontur zeichnet nur noch echte Klassengrenzen — nie mehr eine Naht mitten
 * durch eine Kreuzung.
 *
 * Verfahren: Klassen in Vorrangfolge abarbeiten; jede Klasse behaelt nur, was
 * die hoeherrangigen noch nicht beansprucht haben.
 */
function flaechenAufteilen(flaechen: GelaendeFlaeche[]): GelaendeFlaeche[] {
  const nachKlasse = new Map<string, GelaendeFlaeche[]>();
  for (const f of flaechen) {
    // Die ALKIS-Platte ist eine eigene Klasse: sie ist der Strassenraum als
    // Buehne und liegt UNTER dem OSM-Decker.
    const klasse = f.art === 'fahrbahn' && f.quelle === 'alkis' ? 'strassenraum' : f.art;
    const liste = nachKlasse.get(klasse);
    if (liste) liste.push(f);
    else nachKlasse.set(klasse, [f]);
  }

  // Vorrangfolge: bekannte Klassen zuerst, danach der Strassenraum, dann Reste
  const folge = [...VORRANG.filter((k) => nachKlasse.has(k))];
  if (nachKlasse.has('strassenraum')) {
    // Der Strassenraum liegt unter allen Verkehrsflaechen, aber ueber Bebauung
    const vorBebauung = folge.indexOf('bebauung');
    folge.splice(vorBebauung < 0 ? folge.length : vorBebauung, 0, 'strassenraum');
  }
  for (const k of nachKlasse.keys()) if (!folge.includes(k)) folge.push(k);

  const alsGeom = (f: GelaendeFlaeche) => [
    geschlossenerRing(f.polygon),
    ...(f.loecher ?? []).map(geschlossenerRing),
  ];

  const out: GelaendeFlaeche[] = [];
  let belegt: number[][][][] = [];

  for (const klasse of folge) {
    const liste = nachKlasse.get(klasse)!;
    const eigen = liste.map(alsGeom);
    let rest: number[][][][];
    try {
      rest = polygonClipping.union(eigen[0] as never, ...(eigen.slice(1) as never[])) as never;
      if (belegt.length) rest = polygonClipping.difference(rest as never, belegt as never) as never;
    } catch {
      // Entartete Geometrie: unveraendert uebernehmen, statt sie zu verlieren
      rest = eigen as never;
    }

    const vorlage = liste[0];
    let nr = 0;
    for (const poly of rest) {
      const ringe = (poly as unknown as Ring[]).map(ringNormalisieren).filter((r) => r.length >= 3);
      if (!ringe.length) continue;
      out.push({
        id: `${klasse}_${nr++}`,
        art: (klasse === 'strassenraum' ? 'fahrbahn' : klasse) as GelaendeFlaeche['art'],
        polygon: ringe[0],
        loecher: ringe.length > 1 ? ringe.slice(1) : undefined,
        quelle: klasse === 'strassenraum' ? 'alkis' : vorlage.quelle,
        rang: vorlage.rang,
        belag: vorlage.belag,
      });
    }

    try {
      belegt = belegt.length
        ? (polygonClipping.union(belegt as never, rest as never) as never)
        : (rest as never);
    } catch {
      /* Akkumulator behalten */
    }
  }
  return out;
}

/**
 * Baut den Boden nach dem Bodenmodell: amtliche Basis, OSM als Verfeinerung.
 *
 * Ablauf:
 *  1. ALKIS je Klasse vereinigen — das ist die vollstaendige Basis.
 *  2. Jede OSM-Klasse in Vorrangfolge: vereinigen, auf die zulaessigen
 *     Wirtsklassen BESCHNEIDEN, dann abziehen, was hoeherrangige
 *     Verfeinerungen schon beansprucht haben.
 *  3. Was von der Basis uebrig bleibt, behaelt seine amtliche Klasse.
 *
 * Ergebnis ist wieder eine lueckenlose, ueberschneidungsfreie Aufteilung —
 * nur feiner als die amtliche allein.
 */
function bodenAufbauen(flaechen: GelaendeFlaeche[]): {
  flaechen: GelaendeFlaeche[];
  bericht: { basis: number; verfeinert: number; verworfen: number };
} {
  const alsGeom = (f: GelaendeFlaeche) => [
    geschlossenerRing(f.polygon),
    ...(f.loecher ?? []).map(geschlossenerRing),
  ];
  /**
   * Vereinigt eine Klasse — BLOCKWEISE und ausfallsicher.
   *
   * polygon-clipping bricht bei mehreren hundert komplexen Geometrien in einem
   * Aufruf ab (nachgestellt: 736 Gehwegbaender -> Absturz). Der frueher hier
   * stehende Notweg reichte dann die ROHgeometrie weiter; die anschliessende
   * Verschneidung arbeitete auf einer nicht vereinigten Eingabe und loeschte
   * die Klasse praktisch aus — von 5,48 ha Gehweg blieben 0,30 ha uebrig.
   *
   * Darum: in kleinen Bloecken vereinigen, jeden Block einzeln absichern und
   * einen gescheiterten Block als Einzelgeometrien behalten, statt ihn zu
   * verlieren. Das gilt fuer jede Stadt — die Blockgroesse ist der einzige
   * Regler, nicht die Ortskenntnis.
   */
  const vereinige = (liste: GelaendeFlaeche[]): number[][][][] => {
    if (!liste.length) return [];
    const g = liste.map(alsGeom);
    if (g.length === 1) return g as never;
    const BLOCK = 60;
    let acc: number[][][][] = [];
    for (let i = 0; i < g.length; i += BLOCK) {
      const blk = g.slice(i, i + BLOCK);
      let teil: number[][][][];
      try {
        teil = polygonClipping.union(blk[0] as never, ...(blk.slice(1) as never[])) as never;
      } catch {
        // Block nicht vereinigbar: Einzelgeometrien behalten
        teil = blk as never;
      }
      if (!acc.length) {
        acc = teil;
        continue;
      }
      try {
        acc = polygonClipping.union(acc as never, teil as never) as never;
      } catch {
        // Zusammenfuehrung gescheitert: anhaengen statt verwerfen
        acc = [...acc, ...teil];
      }
    }
    return acc;
  };

  /** Verschneiden und Abziehen ebenfalls absichern — gleiche Ausfallursache. */
  const schneide = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length || !b.length) return [];
    try {
      return polygonClipping.intersection(a as never, b as never) as never;
    } catch {
      return a;
    }
  };
  const ziehAb = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length) return [];
    if (!b.length) return a;
    try {
      return polygonClipping.difference(a as never, b as never) as never;
    } catch {
      return a;
    }
  };
  const zuFlaechen = (
    geom: number[][][][],
    vorlage: GelaendeFlaeche,
    art: string,
    praefix: string,
  ): GelaendeFlaeche[] => {
    const out: GelaendeFlaeche[] = [];
    let nr = 0;
    for (const poly of geom) {
      const ringe = (poly as unknown as Ring[]).map(ringNormalisieren).filter((r) => r.length >= 3);
      if (!ringe.length) continue;
      out.push({
        id: `${praefix}_${nr++}`,
        art: art as GelaendeFlaeche['art'],
        polygon: ringe[0],
        loecher: ringe.length > 1 ? ringe.slice(1) : undefined,
        quelle: vorlage.quelle,
        rang: vorlage.rang,
        belag: vorlage.belag,
      });
    }
    return out;
  };

  // --- 1. Amtliche Basis ---------------------------------------------------
  const alkisNach = new Map<string, GelaendeFlaeche[]>();
  const osmNach = new Map<string, GelaendeFlaeche[]>();
  for (const f of flaechen) {
    const ziel = f.quelle === 'alkis' ? alkisNach : osmNach;
    const liste = ziel.get(f.art);
    if (liste) liste.push(f);
    else ziel.set(f.art, [f]);
  }

  // Ohne amtliche Basis (Bundesland ohne offenen ALKIS-Zugang) bleibt der
  // bisherige Weg: reine Vorrangaufteilung ueber alle Quellen.
  if (!alkisNach.size) {
    return { flaechen: flaechenAufteilen(flaechen), bericht: { basis: 0, verfeinert: 0, verworfen: 0 } };
  }

  const basisGeom = new Map<string, number[][][][]>();
  for (const [art, liste] of alkisNach) basisGeom.set(art, vereinige(liste));

  // --- 2. OSM-Verfeinerungen ----------------------------------------------
  const ergebnis: GelaendeFlaeche[] = [];
  let belegt: number[][][][] = [];
  let verfeinert = 0;
  let verworfen = 0;

  const folge = [
    ...VERFEINERUNG_VORRANG.filter((k) => osmNach.has(k)),
    ...[...osmNach.keys()].filter((k) => !VERFEINERUNG_VORRANG.includes(k)),
  ];

  for (const art of folge) {
    const liste = osmNach.get(art)!;
    const wirte = WIRT[art];
    if (!wirte || !wirte.length) {
      verworfen += liste.length;
      continue;
    }
    // Erlaubter Wirtsraum = Vereinigung der zulaessigen amtlichen Klassen
    const wirtsTeile = wirte.map((w) => basisGeom.get(w)).filter((g): g is number[][][][] => Boolean(g?.length));
    if (!wirtsTeile.length) {
      verworfen += liste.length;
      continue;
    }
    let wirtsraum: number[][][][] = wirtsTeile[0];
    for (let i = 1; i < wirtsTeile.length; i++) {
      try {
        wirtsraum = polygonClipping.union(wirtsraum as never, wirtsTeile[i] as never) as never;
      } catch {
        wirtsraum = [...wirtsraum, ...wirtsTeile[i]];
      }
    }

    // AUF den Wirtsraum beschneiden — hier greift die Regel
    let geom = schneide(vereinige(liste), wirtsraum);
    geom = ziehAb(geom, belegt);
    if (!geom.length) continue;

    const neue = zuFlaechen(geom, liste[0], art, `osm_${art}`);
    ergebnis.push(...neue);
    verfeinert += neue.length;
    try {
      belegt = belegt.length ? (polygonClipping.union(belegt as never, geom as never) as never) : geom;
    } catch {
      /* Akkumulator behalten */
    }
  }

  // --- 3. Amtlicher Rest ---------------------------------------------------
  let basis = 0;
  for (const [art, geom] of basisGeom) {
    const rest = ziehAb(geom, belegt);
    if (!rest.length) continue;
    const neue = zuFlaechen(rest, alkisNach.get(art)![0], art, `alkis_${art}`);
    ergebnis.push(...neue);
    basis += neue.length;
  }

  return { flaechen: ergebnis, bericht: { basis, verfeinert, verworfen } };
}

function geschlossenerRing(r: Ring): Ring {
  if (r.length < 3) return r;
  const erster = r[0];
  const letzter = r[r.length - 1];
  return Math.abs(erster[0] - letzter[0]) < 1e-9 && Math.abs(erster[1] - letzter[1]) < 1e-9 ? r : [...r, erster];
}

/** Startet den Import als Hintergrundauftrag und liefert sofort die Auftrags-ID. */
export function importStarten(opts: {
  name: string;
  bbox: BBox;
  land?: string;
  kreis?: string;
  nutzerId: string;
  hoehenGitter?: number;
  texturPx?: number;
  ohneLuftbild?: boolean;
}): ImportAuftrag {
  const flaecheM2 = bboxFlaeche(opts.bbox);
  if (flaecheM2 > MAX_GEBIET_M2) {
    throw new Error(
      `Das Gebiet ist ${(flaecheM2 / 1_000_000).toFixed(2)} km2 gross. Zulaessig sind hoechstens ` +
        `${(MAX_GEBIET_M2 / 1_000_000).toFixed(0)} km2 (Lastenheft F1.1).`,
    );
  }
  const a: ImportAuftrag = {
    id: id('imp_'),
    name: opts.name,
    bbox: opts.bbox,
    land: opts.land ?? 'hessen',
    kreis: opts.kreis,
    nutzerId: opts.nutzerId,
    status: 'wartet',
    schritt: 'Vorbereitung',
    fortschritt: 0,
    begonnen: jetzt(),
    meldungen: [],
  };
  auftraege.set(a.id, a);
  void ausfuehren(a, opts).catch((e: Error) => {
    a.status = 'fehler';
    a.fehler = e.message;
    a.beendet = jetzt();
    melde(a, 'Fehler', a.fortschritt, `Abbruch: ${e.message}`);
  });
  return a;
}

async function ausfuehren(
  a: ImportAuftrag,
  opts: { hoehenGitter?: number; texturPx?: number; ohneLuftbild?: boolean },
) {
  a.status = 'laeuft';
  const k = geoKonfig(a.land);
  const gid = id('gel_');
  const nachweise: Quellennachweis[] = [];
  const abgerufen = jetzt();

  // --- 1. Gebaeude aus LoD2 -------------------------------------------------
  melde(a, 'Amtliche 3D-Gebaeude (LoD2) werden gelesen', 0.05, 'Suche LoD2-Quelle.');
  const quelle = lod2.quelleErmitteln(a.land, a.kreis);
  if (!quelle) throw new Error('Keine LoD2-Quelle konfiguriert.');
  melde(a, 'Amtliche 3D-Gebaeude (LoD2) werden gelesen', 0.08, `Quelle: ${quelle.beschreibung}`);

  const { gebaeude } = await lod2.gebaeudeFuerGebiet(a.bbox, {
    land: a.land,
    kreis: a.kreis,
    quelle,
    bericht: (g, mb) => melde(a, 'Amtliche 3D-Gebaeude (LoD2) werden gelesen', 0.08 + Math.min(0.32, mb / 5000), `${g} Gebaeude gefunden, ${mb} MB gelesen.`),
  });
  melde(a, 'Gebaeude gelesen', 0.42, `${gebaeude.length} Gebaeude im Gebiet.`);
  nachweise.push({
    datensatz: '3D-Gebaeudemodell LoD2',
    dienst: quelle.art === 'datei' ? 'CityGML-Datei (lokal)' : 'HVBG-Downloadcenter',
    url: quelle.url ?? quelle.datei ?? '',
    abgerufenAm: abgerufen,
    lizenz: k.gebaeude3d.lizenz,
    quellenvermerk: k.gebaeude3d.quellenvermerk,
    hinweis: `${gebaeude.length} Gebaeude im Gebiet, CityGML ${k.gebaeude3d.crs}`,
  });

  // --- 2. Gelaendehoehen ----------------------------------------------------
  melde(a, 'Gelaendehoehen werden abgeleitet', 0.45);
  const roh: Stuetzpunkt[] = [];
  for (const g of gebaeude) {
    let e = 0;
    let n = 0;
    for (const p of g.grundriss) {
      e += p[0];
      n += p[1];
    }
    roh.push({ e: e / g.grundriss.length, n: n / g.grundriss.length, h: g.bodenHoehe });
  }
  const stuetz = ausreisserEntfernen(roh);
  if (stuetz.length < roh.length) {
    melde(a, 'Gelaendehoehen werden abgeleitet', 0.46, `${roh.length - stuetz.length} unplausible Bodenhoehen verworfen (Abgleich mit der Nachbarschaft).`);
  }
  const feld = new HoehenFeld(stuetz, 120);
  const hoehenHerkunft: Gelaende['hoehenHerkunft'] = stuetz.length >= 3 ? 'lod2_interpoliert' : 'flach';
  nachweise.push({
    datensatz: 'Gelaendehoehen',
    dienst: hoehenHerkunft === 'lod2_interpoliert' ? 'abgeleitet aus LoD2-Bodenhoehen (Attribut AbsoluteHoehe)' : 'flaches Ersatzgelaende',
    url: '',
    abgerufenAm: abgerufen,
    lizenz: k.gelaendehoehen.lizenz,
    quellenvermerk: k.gelaendehoehen.quellenvermerk,
    hinweis:
      hoehenHerkunft === 'lod2_interpoliert'
        ? `${stuetz.length} amtliche Bodenhoehen als Stuetzpunkte, dazwischen invers-distanzgewichtet interpoliert. Ein DGM1-Raster kann importiert werden und hat dann Vorrang.`
        : 'Zu wenige Stuetzpunkte — Gelaende ist eben angenommen (k. A. zur echten Hoehenlage).',
  });

  // --- 3. Kacheln mit Hoehengitter und Luftbild ----------------------------
  const gitter = opts.hoehenGitter ?? 33;
  const texturPx = Math.min(opts.texturPx ?? 1536, k.orthophoto.maxPixel);
  const kacheln = kachelGitter(a.bbox, 300);
  const patches: GelaendePatch[] = [];
  let hMin = Infinity;
  let hMax = -Infinity;
  let hSumme = 0;
  let hAnzahl = 0;
  let leere = 0;

  for (let i = 0; i < kacheln.length; i++) {
    const bb = kacheln[i];
    const hoehen: number[][] = [];
    for (let z = 0; z < gitter; z++) {
      const zeile: number[] = [];
      const n = bb.minN + ((bb.maxN - bb.minN) * z) / (gitter - 1);
      for (let s = 0; s < gitter; s++) {
        const e = bb.minE + ((bb.maxE - bb.minE) * s) / (gitter - 1);
        const h = Math.round(feld.hoeheBei(e, n) * 100) / 100;
        zeile.push(h);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
        hSumme += h;
        hAnzahl++;
      }
      hoehen.push(zeile);
    }

    let texturDatei: string | undefined;
    if (!opts.ohneLuftbild) {
      melde(a, 'Luftbild wird geladen', 0.5 + (0.45 * i) / kacheln.length, `Kachel ${i + 1} von ${kacheln.length}`);
      try {
        const schluessel = `dop_${Math.round(bb.minE)}_${Math.round(bb.minN)}_${Math.round(bb.maxE - bb.minE)}_${texturPx}.jpg`;
        const bild = await orthophoto(bb, texturPx, texturPx, a.land, schluessel);
        if (!bild.leer && bild.daten.length > 0) {
          texturDatei = `patch_${i}.jpg`;
          gelaendeStore.texturSchreiben(gid, texturDatei, bild.daten);
        } else {
          leere++;
        }
      } catch (e) {
        leere++;
        melde(a, 'Luftbild wird geladen', 0.5 + (0.45 * i) / kacheln.length, `Kachel ${i + 1}: ${(e as Error).message}`);
      }
    }

    patches.push({
      id: `p${i}`,
      bbox: bb,
      hoehen,
      spalten: gitter,
      zeilen: gitter,
      texturDatei,
    });
  }
  if (!opts.ohneLuftbild) {
    nachweise.push({
      datensatz: 'Digitale Orthophotos DOP20',
      dienst: `WMS ${k.orthophoto.layer} (${k.orthophoto.crs})`,
      url: k.orthophoto.url,
      abgerufenAm: abgerufen,
      lizenz: k.orthophoto.lizenz,
      quellenvermerk: k.orthophoto.quellenvermerk,
      hinweis: `${patches.length - leere} von ${patches.length} Kacheln mit Luftbild${leere ? `, ${leere} ohne (Dienst lieferte Leerbilder)` : ''}.`,
    });
  }

  // --- 4. Flurstuecke -------------------------------------------------------
  melde(a, 'Flurstuecke (ALKIS) werden geladen', 0.96);
  let flurstuecke: Gelaende['flurstuecke'] = [];
  try {
    const fs = await alkis.flurstuecke(a.bbox, a.land);
    flurstuecke = fs.map((f) => ({
      id: f.id,
      kennzeichen: f.kennzeichen || f.nummer,
      polygon: f.polygon,
      flaeche: f.flaecheAmtlich ?? f.flaecheGerechnet,
    }));
    nachweise.push({
      datensatz: 'ALKIS Liegenschaftskarte (vereinfachtes Modell)',
      dienst: `WFS ${k.flurstuecke.typenameFlurstueck}`,
      url: k.flurstuecke.url,
      abgerufenAm: abgerufen,
      lizenz: k.flurstuecke.lizenz,
      quellenvermerk: k.flurstuecke.quellenvermerk,
      hinweis: `${flurstuecke.length} Flurstuecke im Gebiet.`,
    });
    melde(a, 'Flurstuecke geladen', 0.98, `${flurstuecke.length} Flurstuecke.`);
  } catch (e) {
    melde(a, 'Flurstuecke', 0.98, `ALKIS nicht erreichbar: ${(e as Error).message} — Gelaende wird ohne Flurstuecke gespeichert.`);
  }

  // --- 4b. Bodenzeichnung: tatsaechliche Nutzung (ALKIS) + Wegenetz (OSM) ---
  // Das ist die Grundlage des massgetreuen digitalen Abbilds: Fahrbahn,
  // Gehweg, Radweg, Fussgaengerzone, Platz und Gruen als eigene Flaechen.
  let flaechen: GelaendeFlaeche[] = [];
  melde(a, 'Tatsaechliche Nutzung wird geladen', 0.985);
  try {
    const { nutzungsflaechen, NUTZUNG_QUELLE } = await import('./nutzung.ts');
    const alkisFlaechen = await nutzungsflaechen(a.bbox, a.land);
    flaechen.push(...alkisFlaechen);
    if (alkisFlaechen.length) {
      nachweise.push({ ...NUTZUNG_QUELLE, abgerufenAm: abgerufen, hinweis: `${alkisFlaechen.length} Nutzungsflaechen im Gebiet.` });
    }
    melde(a, 'Tatsaechliche Nutzung geladen', 0.99, `${alkisFlaechen.length} ALKIS-Nutzungsflaechen.`);
  } catch (e) {
    melde(a, 'Tatsaechliche Nutzung', 0.99, `ALKIS-Nutzung nicht verfuegbar: ${(e as Error).message}`);
  }
  try {
    const { osmBodenzeichnung, OSM_QUELLE } = await import('./osm.ts');
    const osmFlaechen = await osmBodenzeichnung(a.bbox, { userAgent: k.geokodierung.userAgent });
    flaechen.push(...osmFlaechen);
    if (osmFlaechen.length) {
      nachweise.push({ ...OSM_QUELLE, abgerufenAm: abgerufen, hinweis: `${osmFlaechen.length} Wege- und Flaechenobjekte (Geh-, Rad- und Fusswege).` });
    }
    melde(a, 'Wegenetz geladen', 0.995, `${osmFlaechen.length} OSM-Flaechen (Gehwege, Radwege).`);
  } catch (e) {
    melde(a, 'Wegenetz', 0.995, `OSM nicht verfuegbar: ${(e as Error).message}`);
  }

  // --- 4b2. Union je Klasse -------------------------------------------------
  // Ohne diesen Schritt liegen 640 einzelne Fahrbahnplatten nebeneinander statt
  // eines Netzes: an jeder Segmentgrenze eine Naht, an jedem Ueberlapp eine
  // Kante. Erst die Vereinigung je Klasse macht daraus eine zusammenhaengende
  // Flaeche — und erst dann ergibt eine Kontur ueberhaupt Sinn, weil sie sonst
  // jede innere Naht nachzeichnen wuerde.
  melde(a, 'Flaechen werden je Klasse vereinigt', 0.992);
  const vorher = flaechen.length;
  melde(a, 'Boden wird aufgebaut (ALKIS als Basis, OSM als Verfeinerung)', 0.992);
  const t0 = Date.now();
  const boden = bodenAufbauen(flaechen);
  flaechen = boden.flaechen;
  melde(
    a,
    'Boden aufgebaut',
    0.994,
    `${vorher} Rohflaechen -> ${flaechen.length} lueckenlose Flaechen: ` +
      `${boden.bericht.basis} amtlich, ${boden.bericht.verfeinert} durch OSM verfeinert` +
      `${boden.bericht.verworfen ? `, ${boden.bericht.verworfen} OSM-Flaechen ohne zulaessige Wirtsklasse verworfen` : ''}` +
      ` (${((Date.now() - t0) / 1000).toFixed(1)} s).`,
  );

  // --- 4c. Stadtdetails: Baeume, Gleise, Haltestellen, Mauern, Moebel -------
  // Ohne sie bleibt das Modell eine Ansammlung von Kloetzen. Erst Baeume,
  // Schienen und Haltestellen machen einen Ort wiedererkennbar.
  let punkte: NonNullable<Gelaende['punkte']> = [];
  let linien: NonNullable<Gelaende['linien']> = [];
  try {
    const { stadtdetails, DETAIL_QUELLE } = await import('./stadtdetails.ts');
    melde(a, 'Stadtdetails werden geladen', 0.996);
    const d = await stadtdetails(a.bbox, { userAgent: k.geokodierung.userAgent });
    punkte = d.punkte;
    linien = d.linien;
    if (d.zusatzflaechen?.length) flaechen.push(...d.zusatzflaechen);
    const baeume = punkte.filter((p) => p.art === 'baum').length;
    const gleise = linien.filter((l) => l.art === 'gleis').length;
    const halte = punkte.filter((p) => p.art === 'haltestelle').length;
    if (punkte.length || linien.length) {
      nachweise.push({
        ...DETAIL_QUELLE,
        abgerufenAm: abgerufen,
        hinweis: `${baeume} Baeume, ${gleise} Gleise, ${halte} Haltestellen, ${linien.length - gleise} Mauern/Zaeune/Hecken/Bordsteine, ${punkte.length - baeume - halte} Strassenmoebel.`,
      });
    }
    // --- Rillenschiene erkennen ------------------------------------------
    // OSM fuehrt fuer die Darmstaedter Strecke weder `embedded` noch `surface`.
    // Eine Tag-Heuristik meldete darum 73 von 73 Gleisen als eigenen
    // Bahnkoerper und setzte ueberall Schwellen — die Strecke sah aus wie eine
    // Eisenbahntrasse statt wie eine Strassenbahn. Die Frage laesst sich aber
    // GEOMETRISCH beantworten: liegt die Gleisachse im Strassenraum, ist es
    // eine Rillenschiene im Pflaster.
    const verkehrsflaechen = flaechen.filter(
      (f) => f.art === 'fahrbahn' || f.art === 'platz' || f.art === 'fussgaengerzone',
    );
    let imPflaster = 0;
    for (const l of linien) {
      if (l.art !== 'gleis' || l.achse.length < 2) continue;
      let drin = 0;
      let geprueft = 0;
      const gesamt = polylinieLaenge(l.achse);
      const schritt = Math.max(5, gesamt / 20);
      for (let s = 0; s <= gesamt; s += schritt) {
        const { p } = aufPolylinie(l.achse, s);
        geprueft++;
        if (verkehrsflaechen.some((f) => punktInRing(p, f.polygon) && !(f.loecher ?? []).some((h) => punktInRing(p, h)))) {
          drin++;
        }
      }
      const anteil = geprueft ? drin / geprueft : 0;
      l.eigenerBahnkoerper = anteil < 0.5;
      if (!l.eigenerBahnkoerper) imPflaster++;
    }

    // --- OSM-Gebaeudemerkmale den amtlichen Gebaeuden zuordnen ------------
    // Die Geometrie bleibt amtlich (LoD2). OSM liefert nur, was das Kataster
    // nicht fuehrt: Dach- und Fassadenfarbe sowie den Namen. Zugeordnet wird
    // ueber die LAGE — der Schwerpunkt des OSM-Grundrisses muss im amtlichen
    // Grundriss liegen. Das ist strenger als ein Abstandsvergleich und
    // vermeidet Fehlzuordnungen in dichter Blockrandbebauung.
    try {
      const { osmGebaeudeMerkmale } = await import('./stadtdetails.ts');
      const merkmale = await osmGebaeudeMerkmale(a.bbox, { userAgent: k.geokodierung.userAgent });
      let zugeordnet = 0;
      let mitFarbe = 0;
      // Gitterindex ueber die amtlichen Gebaeude, sonst waeren es 1.349 x 2.563 Tests
      const ZELLE = 50;
      const index = new Map<string, typeof gebaeude>();
      for (const g of gebaeude) {
        const b = bboxVonPunkten(g.grundriss);
        for (let e = Math.floor(b.minE / ZELLE); e <= Math.floor(b.maxE / ZELLE); e++) {
          for (let n = Math.floor(b.minN / ZELLE); n <= Math.floor(b.maxN / ZELLE); n++) {
            const s = `${e}:${n}`;
            const liste = index.get(s);
            if (liste) liste.push(g);
            else index.set(s, [g]);
          }
        }
      }
      for (const m of merkmale.values()) {
        if (!m.grundriss || m.grundriss.length < 3) continue;
        const mitte = schwerpunkt(m.grundriss);
        const kandidaten = index.get(`${Math.floor(mitte[0] / ZELLE)}:${Math.floor(mitte[1] / ZELLE)}`) ?? [];
        const treffer = kandidaten.find((g) => punktInRing(mitte, g.grundriss));
        if (!treffer) continue;
        zugeordnet++;
        if (m.dachFarbe) {
          treffer.dachFarbe = m.dachFarbe;
          mitFarbe++;
        }
        if (m.wandFarbe) treffer.wandFarbe = m.wandFarbe;
        if (m.dachformOsm) treffer.dachformOsm = m.dachformOsm;
        if (m.name) treffer.name = m.name;
        if (m.geschosse && m.geschosse > 0 && m.geschosse < 60) treffer.geschosse = m.geschosse;
      }
      melde(a, 'Gebaeudemerkmale', 0.999, `${zugeordnet} amtliche Gebaeude mit OSM-Merkmalen ergaenzt, davon ${mitFarbe} mit Dachfarbe.`);
    } catch (e) {
      melde(a, 'Gebaeudemerkmale', 0.999, `OSM-Gebaeudemerkmale nicht verfuegbar: ${(e as Error).message}`);
    }

    melde(
      a,
      'Stadtdetails geladen',
      0.998,
      `${baeume} Baeume, ${gleise} Gleise (${imPflaster} davon als Rillenschiene im Strassenraum erkannt), ${halte} Haltestellen.`,
    );
  } catch (e) {
    melde(a, 'Stadtdetails', 0.998, `Stadtdetails nicht verfuegbar: ${(e as Error).message}`);
  }

  // --- 5. Speichern ---------------------------------------------------------
  const g: Gelaende = {
    id: gid,
    name: a.name,
    polygon: bboxRing(a.bbox),
    bbox: a.bbox,
    epsg: 25832,
    hoeheMittel: hAnzahl ? Math.round((hSumme / hAnzahl) * 100) / 100 : 0,
    hoeheMin: Number.isFinite(hMin) ? hMin : 0,
    hoeheMax: Number.isFinite(hMax) ? hMax : 0,
    hoehenHerkunft,
    patches,
    gebaeude,
    flaechen,
    punkte,
    linien,
    flurstuecke,
    quellennachweis: nachweise,
    erstelltAm: jetzt(),
    erstelltVon: a.nutzerId,
  };
  gelaendeStore.speichern(g);
  a.gelaendeId = gid;
  a.status = 'fertig';
  a.beendet = jetzt();
  melde(a, 'Fertig', 1, `Gelaende „${a.name}“ gespeichert: ${gebaeude.length} Gebaeude (${gebaeude.filter((x) => x.dachflaechen?.length).length} mit echter Dachform), ${flaechen.length} Nutzungsflaechen, ${patches.length} Kacheln, Hoehe ${g.hoeheMin}-${g.hoeheMax} m ue. NHN.`);
}

/**
 * Import eines DGM1-Rasters (XYZ oder ESRI-ASCII). Ersetzt die abgeleiteten
 * Hoehen — Fallback-Weg des Lastenhefts, weil Hessen fuer DGM1 keine
 * skriptbaren Direktlinks anbietet.
 */
export function dgmImportieren(gid: string, inhalt: string): { punkte: number; hMin: number; hMax: number } {
  const g = gelaendeStore.laden(gid);
  if (!g) throw new Error('Gelaende nicht gefunden.');
  const punkte: Stuetzpunkt[] = [];

  if (/^\s*ncols/i.test(inhalt)) {
    // ESRI-ASCII-Grid
    const zeilen = inhalt.split(/\r?\n/);
    const kopf: Record<string, number> = {};
    let i = 0;
    for (; i < zeilen.length; i++) {
      const m = /^\s*(\w+)\s+(-?[\d.]+)/.exec(zeilen[i]);
      if (!m) break;
      kopf[m[1].toLowerCase()] = Number(m[2]);
    }
    const { ncols, nrows, xllcorner, yllcorner, cellsize } = kopf;
    const nodata = kopf.nodata_value ?? -9999;
    for (let z = 0; z < nrows; z++) {
      const werte = (zeilen[i + z] ?? '').trim().split(/\s+/).map(Number);
      for (let s = 0; s < ncols; s++) {
        const h = werte[s];
        if (!Number.isFinite(h) || h === nodata) continue;
        punkte.push({ e: xllcorner + (s + 0.5) * cellsize, n: yllcorner + (nrows - z - 0.5) * cellsize, h });
      }
    }
  } else {
    // XYZ: "E N H" je Zeile
    for (const zeile of inhalt.split(/\r?\n/)) {
      const t = zeile.trim();
      if (!t || t.startsWith('#')) continue;
      const [e, n, h] = t.split(/[\s;,]+/).map(Number);
      if (Number.isFinite(e) && Number.isFinite(n) && Number.isFinite(h)) punkte.push({ e, n, h });
    }
  }
  if (punkte.length < 3) throw new Error('Die Datei enthaelt keine auswertbaren Hoehenpunkte (erwartet XYZ oder ESRI-ASCII-Grid).');

  const feld = new HoehenFeld(punkte, 50);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const p of g.patches) {
    for (let z = 0; z < p.zeilen; z++) {
      const n = p.bbox.minN + ((p.bbox.maxN - p.bbox.minN) * z) / (p.zeilen - 1);
      for (let s = 0; s < p.spalten; s++) {
        const e = p.bbox.minE + ((p.bbox.maxE - p.bbox.minE) * s) / (p.spalten - 1);
        const h = Math.round(feld.hoeheBei(e, n) * 100) / 100;
        p.hoehen[z][s] = h;
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
  }
  g.hoeheMin = hMin;
  g.hoeheMax = hMax;
  g.hoeheMittel = Math.round(((hMin + hMax) / 2) * 100) / 100;
  g.hoehenHerkunft = 'dgm1';
  g.quellennachweis = g.quellennachweis.filter((q) => q.datensatz !== 'Gelaendehoehen');
  g.quellennachweis.push({
    datensatz: 'Gelaendehoehen DGM1',
    dienst: 'manueller Import (XYZ/ASCII-Grid)',
    url: '',
    abgerufenAm: jetzt(),
    lizenz: geoKonfig('hessen').gelaendehoehen.lizenz,
    quellenvermerk: '(c) HVBG, Digitales Gelaendemodell DGM1',
    hinweis: `${punkte.length} Hoehenpunkte importiert.`,
  });
  gelaendeStore.speichern(g);
  return { punkte: punkte.length, hMin, hMax };
}
