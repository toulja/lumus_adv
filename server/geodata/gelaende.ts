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
import type { BBox, Bruchkante, Gelaende, GelaendeFlaeche, GelaendeLinienObjekt, GelaendePatch, Punkt, Quellennachweis, Ring } from '../../shared/domain/types.ts';
import { HoehenFeld, aufPolylinie, bboxFlaeche, bboxRing, bboxVonPunkten, flaeche, polylinieLaenge, punktInRing, ringNormalisieren, schwerpunkt } from '../../shared/geo/geometry.ts';
import type { Stuetzpunkt } from '../../shared/geo/geometry.ts';
import { Hoehenraster } from '../../shared/geo/raster.ts';
import { kachelHuelle, kachelnAmRaster } from '../../shared/geo/gelaendenetz.ts';
import { gelaende as gelaendeStore, id, jetzt, WURZEL as DATEN_WURZEL } from '../lib/store.ts';
import { geoKonfig } from './konfig.ts';
import * as lod2 from './lod2.ts';
import * as alkis from './alkis.ts';
import * as dgm from './dgm.ts';
import * as bauwerk from './bauwerk.ts';
import { orthophoto } from './wms.ts';

export const MAX_GEBIET_M2 = 2_000_000; // Lastenheft F1.1: max. 2 km2

/**
 * Zellgroesse des Hoehenrasters. 1 m ist die Aufloesung des amtlichen DGM1 —
 * feiner waere erfunden, groeber waere das Wegwerfen amtlicher Genauigkeit,
 * und genau das war der Fehler bis zum 08.08.2026.
 */
const RASTER_ZELL_M = 1;

/**
 * Zuschlag rundum. Die Stadtdetails reichen 50 m ueber das Gebiet hinaus
 * (RAND_M in stadtdetails.ts); ohne denselben Zuschlag stuende ein Baum am
 * Gebietsrand auf einem Ersatzwert.
 */
const RASTER_RAND_M = 60;

/** Kachelkante. 256 m = Zweierpotenz mal Rasterweite (siehe gelaendenetz.ts). */
const KACHEL_M = 256;

/**
 * Zulaessige Abweichung des gezeichneten Gelaendenetzes vom Raster.
 *
 * 2 cm (seit 09.08.2026, vorher 8 cm). Die Toleranz ist keine reine
 * Geschmacksfrage, sie hat eine harte Untergrenze: die Bodenflaechen liegen
 * gestaffelt 2,0 bis 9,2 cm ueber Grund. Ist die Netztoleranz GROESSER als der
 * Versatz einer Klasse, sticht das vereinfachte Gelaende durch genau diese
 * Flaechen — bei 8 cm sichtbar als heller Keil im Grossen Woog, dessen
 * Wasserflaeche 4 cm Versatz hat. 2 cm liegt unter dem kleinsten Versatz und
 * schliesst den ganzen Fehlerfall aus, statt ihn je Klasse nachzubessern.
 *
 * ACHTUNG: Dieser Wert ist beim Zusammenfuehren zweier Arbeitsstaende schon
 * einmal still auf 0,08 zurueckgefallen, waehrend diese Begruendung stehen
 * blieb. Wer ihn aendert, aendert auch den Text darueber — sonst widersprechen
 * sich Zahl und Grund.
 */
const NETZ_TOLERANZ_M = 0.02;

function datenWurzel(): string {
  return DATEN_WURZEL;
}

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
  // 'bebauung' ist hier aus DEMSELBEN Grund enthalten wie bei den Gehwegen
  // (Messung unten): die ALKIS-Strassenparzelle ist vielerorts schmaler als
  // die asphaltierte Flaeche — ohne Bauflaechen-Wirt riss der Fahrbahn-Decker
  // mitten im Strassenzug ab und die Strasse wechselte scheinbar die Farbe
  // (Befund 08.08.2026). Die Achsenbindung der Korridore verhindert weiterhin,
  // dass eine falsch erfasste Strasse quer durch eine Gruenanlage laeuft.
  fahrbahn: ['fahrbahn', 'platz', 'fussgaengerzone', 'weg', 'bebauung', 'sonstige'],

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
  // LOKALER URSPRUNG — der Schluessel zur Robustheit.
  //
  // polygon-clipping arbeitet mit einer Sweep-Line auf Fliesskomma. Bei den
  // grossen UTM-Koordinaten (Rechtswert ~475.000, Hochwert ~5.524.000) bleibt
  // nach der Ganzzahl kaum Mantisse fuer die Schnittrechnung; die Bibliothek
  // bricht dann mit "Unable to find segment in SweepLine tree" ab. Nachgestellt:
  // 640 Fahrbahnen in einem Aufruf -> Absturz mit grossen Koordinaten, aber
  // fehlerfrei, sobald man alles um den Gebietsursprung nach ~0 verschiebt.
  //
  // Darum: ALLE Koordinaten vor jeder Clipping-Operation um O verschieben und
  // die Ergebnisse zurueckschieben. Das beseitigt die Abbrueche vollstaendig —
  // es braucht keine Bloecke und keine Rohgeometrie-Notwege mehr, die frueher
  // die 17 % Ueberlappung erzeugt haben. Der Ursprung ist die kleinste Ecke
  // aller Flaechen, gilt also fuer jede Stadt.
  let ox = Infinity;
  let oy = Infinity;
  for (const f of flaechen) {
    for (const p of f.polygon) {
      if (p[0] < ox) ox = p[0];
      if (p[1] < oy) oy = p[1];
    }
  }
  if (!Number.isFinite(ox)) {
    ox = 0;
    oy = 0;
  }

  const alsGeom = (f: GelaendeFlaeche): number[][][] =>
    [geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)].map((r) =>
      r.map((p) => [p[0] - ox, p[1] - oy]),
    );

  // Vereinigung einer Liste von POLYGONEN (je Flaeche ein Polygon mit Loechern)
  const vereinige = (liste: GelaendeFlaeche[]): number[][][][] => {
    const polys = liste.map(alsGeom);
    if (!polys.length) return [];
    if (polys.length === 1) return polys as never;
    return polygonClipping.union(polys[0] as never, ...(polys.slice(1) as never[])) as never;
  };
  // Vereinigung mehrerer MULTIPOLYGONE (Wirtsraum, belegte Flaeche)
  const vereinigeMP = (mps: number[][][][][]): number[][][][] => {
    const nn = mps.filter((m) => m.length);
    if (!nn.length) return [];
    if (nn.length === 1) return nn[0];
    return polygonClipping.union(nn[0] as never, ...(nn.slice(1) as never[])) as never;
  };

  const schneide = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length || !b.length) return [];
    return polygonClipping.intersection(a as never, b as never) as never;
  };
  const ziehAb = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length) return [];
    if (!b.length) return a;
    return polygonClipping.difference(a as never, b as never) as never;
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
      // Ringe zuruueck in Weltkoordinaten schieben
      const ringe = (poly as unknown as Ring[])
        .map((r) => ringNormalisieren(r.map((p) => [p[0] + ox, p[1] + oy] as [number, number])))
        .filter((r) => r.length >= 3);
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
  for (const [art, liste] of alkisNach) {
    try {
      basisGeom.set(art, vereinige(liste));
    } catch {
      // Verschiebung macht das praktisch unmoeglich; falls doch, die
      // Einzelgeometrien behalten (gleiche Klasse -> Selbstueberlapp harmlos).
      basisGeom.set(art, liste.map(alsGeom) as never);
    }
  }

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
    try {
      // Wirtsraum aus den zulaessigen amtlichen Klassen (bereits verschoben)
      const wirtsraum = vereinigeMP(wirtsTeile);
      // AUF den Wirtsraum beschneiden — hier greift die Regel
      let geom = schneide(vereinige(liste), wirtsraum);
      geom = ziehAb(geom, belegt);
      if (!geom.length) continue;

      const neue = zuFlaechen(geom, liste[0], art, `osm_${art}`);
      ergebnis.push(...neue);
      verfeinert += neue.length;
      belegt = belegt.length ? vereinigeMP([belegt, geom]) : geom;
    } catch {
      // Diese OSM-Klasse laesst sich nicht sauber verschneiden -> verwerfen.
      // Der Boden bleibt vollstaendig: die amtliche Basis fuellt die Stelle in
      // Schritt 3. Lieber ein Detail weniger als eine Ueberlappung.
      verworfen += liste.length;
    }
  }

  // --- 3. Amtlicher Rest ---------------------------------------------------
  let basis = 0;
  for (const [art, geom] of basisGeom) {
    let rest: number[][][][];
    try {
      rest = ziehAb(geom, belegt);
    } catch {
      // Abzug gescheitert: die volle amtliche Klasse zeichnen. Sie kann sich
      // dann mit einer Verfeinerung ueberlappen — aber die amtliche Basis ist
      // die Wahrheit, ein Loch waere schlimmer als eine Doppelzeichnung.
      rest = geom;
    }
    if (!rest.length) continue;
    const neue = zuFlaechen(rest, alkisNach.get(art)![0], art, `alkis_${art}`);
    ergebnis.push(...neue);
    basis += neue.length;
  }

  return { flaechen: ergebnis, bericht: { basis, verfeinert, verworfen } };
}

/**
 * Ebnet Gewaesser im Hoehenmodell ein (Hydro-Flattening).
 *
 * WARUM DAS SEIN MUSS: Ein Laserscanner bekommt von einer Wasseroberflaeche
 * kaum ein Echo zurueck. Was das DGM1 innerhalb eines Sees fuehrt, ist darum
 * nicht gemessen, sondern interpoliert — im Grossen Woog schwankt es um 1,83 m
 * und steigt stellenweise 1,1 m ueber das Ufer. Gezeichnet ergab das eine
 * weisse Erhebung mitten im See; das Luftbild zeigt dort offenes Wasser
 * (nachgeprueft 09.08.2026).
 *
 * Ein See hat EINEN Spiegel, ein Bach ein GEFAELLE. Beides liefert dieselbe
 * Rechnung: durch das untere Drittel der Uferpunkte wird eine Ebene
 * h = a*e + b*n + c ausgeglichen. Beim ruhenden Gewaesser wird ihre Neigung von
 * allein null, beim Wasserlauf folgt sie dem Gefaelle. Das untere Drittel,
 * weil die hohen Uferpunkte zu Mauern, Bruecken und Boeschungsoberkanten
 * gehoeren — nicht zum Wasser.
 *
 * Ueber 5 % Neigung wird NICHT eingeebnet: dann ist die Ausgleichung an einer
 * Boeschung haengengeblieben, und geraten wird hier nicht.
 *
 * Es ist bewusst das HOEHENMODELL, das korrigiert wird, und nicht die
 * Darstellung: Gebaeude, Baeume, Planobjekte und jede spaetere Simulation
 * fragen dieselbe Oberflaeche ab. Eine nur gezeichnete Wasserflaeche waere
 * wieder eine zweite Wahrheit.
 */
function wasserEinebnen(raster: Hoehenraster, flaechen: GelaendeFlaeche[]): { gewaesser: number; zellen: number; verworfen: number } {
  const k = raster.kopf;
  let gewaesser = 0;
  let zellen = 0;
  let verworfen = 0;
  for (const f of flaechen) {
    if (f.art !== 'wasser' || f.polygon.length < 3) continue;
    const mE = f.polygon.reduce((s, p) => s + p[0], 0) / f.polygon.length;
    const mN = f.polygon.reduce((s, p) => s + p[1], 0) / f.polygon.length;
    const punkte = f.polygon
      .map((p) => ({ e: p[0] - mE, n: p[1] - mN, h: raster.hoeheBei(p[0], p[1]) }))
      .filter((p) => Number.isFinite(p.h));
    if (punkte.length < 3) continue;
    const ufer = [...punkte].sort((x, y) => x.h - y.h).slice(0, Math.max(3, Math.ceil(punkte.length / 3)));

    // STEHENDES GEWAESSER ODER WASSERLAUF? Die Antwort steht in der Form.
    // Gedrungenheit 4*pi*A/U^2: Kreis 1, langgestreckter Streifen gegen 0. Ein
    // See ist waagerecht — bekaeme er die ausgeglichene Ebene, wuerde deren
    // Restneigung ihn kippen (gemessen am Grossen Woog: 93 cm Unterschied ueber
    // 250 m Seebreite, also erneut Gelaende im Wasser). Nur ein Wasserlauf
    // bekommt Gefaelle.
    let umfang = 0;
    for (let i = 0; i < f.polygon.length; i++) {
      const p = f.polygon[i];
      const q = f.polygon[(i + 1) % f.polygon.length];
      umfang += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const gedrungen = umfang > 0 ? (4 * Math.PI * Math.abs(flaeche(f.polygon))) / (umfang * umfang) : 1;
    const istWasserlauf = gedrungen < 0.15;

    let see = 0;
    let snn = 0;
    let sen = 0;
    let se = 0;
    let sn = 0;
    let sh = 0;
    let seh = 0;
    let snh = 0;
    for (const p of ufer) {
      see += p.e * p.e;
      snn += p.n * p.n;
      sen += p.e * p.n;
      se += p.e;
      sn += p.n;
      sh += p.h;
      seh += p.e * p.h;
      snh += p.n * p.h;
    }
    const m = ufer.length;
    const det = see * (snn * m - sn * sn) - sen * (sen * m - sn * se) + se * (sen * sn - snn * se);
    let spiegel: (e: number, n: number) => number;
    if (!istWasserlauf) {
      // Waagerecht auf das untere Viertel des Ufers — die Wasserlinie. Sie wird
      // an der Flaeche vermerkt, damit die Zeichnung dieselbe Ebene benutzt und
      // die Wasseroberflaeche nicht aus schwankenden Uferhoehen interpoliert.
      const sortiert = punkte.map((p) => p.h).sort((x, y) => x - y);
      const wasserlinie = sortiert[Math.floor(sortiert.length * 0.25)];
      spiegel = () => wasserlinie;
      f.wasserspiegelM = Math.round(wasserlinie * 1000) / 1000;
    } else if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
      // Kollineare oder zu wenige Uferpunkte: waagerecht auf den Medianwert.
      const mitte = ufer[Math.floor(ufer.length / 2)].h;
      spiegel = () => mitte;
    } else {
      const a = (seh * (snn * m - sn * sn) - sen * (snh * m - sn * sh) + se * (snh * sn - snn * sh)) / det;
      const b = (see * (snh * m - sn * sh) - seh * (sen * m - sn * se) + se * (sen * sh - snh * se)) / det;
      const c = (see * (snn * sh - sn * snh) - sen * (sen * sh - se * snh) + seh * (sen * sn - snn * se)) / det;
      if (![a, b, c].every(Number.isFinite) || Math.hypot(a, b) > 0.05) {
        verworfen++;
        continue;
      }
      spiegel = (e, n) => a * (e - mE) + b * (n - mN) + c;
    }

    const es = f.polygon.map((p) => p[0]);
    const ns = f.polygon.map((p) => p[1]);
    const s0 = Math.max(0, Math.floor((Math.min(...es) - k.minE) / k.zellM));
    const s1 = Math.min(k.spalten - 1, Math.ceil((Math.max(...es) - k.minE) / k.zellM));
    const z0 = Math.max(0, Math.floor((Math.min(...ns) - k.minN) / k.zellM));
    const z1 = Math.min(k.zeilen - 1, Math.ceil((Math.max(...ns) - k.minN) / k.zellM));
    let gesetzt = 0;
    for (let z = z0; z <= z1; z++) {
      for (let s = s0; s <= s1; s++) {
        const [e, n] = raster.zellMitte(s, z);
        if (!punktInRing([e, n], f.polygon)) continue;
        if ((f.loecher ?? []).some((l) => punktInRing([e, n], l))) continue;
        raster.setze(s, z, spiegel(e, n));
        gesetzt++;
      }
    }
    if (gesetzt) {
      gewaesser++;
      zellen += gesetzt;
    }
  }
  return { gewaesser, zellen, verworfen };
}

/**
 * Schneidet die Bodenflaechen am bestellten Gebiet ab.
 *
 * WARUM (Befund 09.08.2026): ALKIS und OSM liefern GANZE Objekte, sobald sie das
 * Gebiet auch nur beruehren. Eine Bundesstrasse, die am Rand hereinragt, kam
 * dadurch in voller Laenge mit — gemessen bis 863 m ueber die Gebietskante
 * hinaus. Dort gibt es kein Gelaende mehr, also lagen diese Flaechen auf der
 * Ersatzhoehe und standen als schwebende helle Baender in der Luft.
 *
 * Flaechen werden geschnitten, GEBAEUDE NICHT: eine Strasse ist eine
 * Oberflaeche und darf an der Gebietskante enden, ein Gebaeude ist ein Objekt —
 * halbiert waere es eine Falschaussage. Ueberstehende Gebaeude bleiben darum
 * ganz und stehen auf dem Gelaendesaum, der jetzt echte Hoehen hat.
 */
function amGebietSchneiden(flaechen: GelaendeFlaeche[], gebiet: BBox): GelaendeFlaeche[] {
  const rechteck: [number, number][][] = [
    [
      [gebiet.minE, gebiet.minN],
      [gebiet.maxE, gebiet.minN],
      [gebiet.maxE, gebiet.maxN],
      [gebiet.minE, gebiet.maxN],
      [gebiet.minE, gebiet.minN],
    ],
  ];
  const drin = (r: Ring) => r.every((p) => p[0] >= gebiet.minE && p[0] <= gebiet.maxE && p[1] >= gebiet.minN && p[1] <= gebiet.maxN);
  const raus: GelaendeFlaeche[] = [];
  for (const f of flaechen) {
    if (drin(f.polygon) && (f.loecher ?? []).every(drin)) {
      raus.push(f);
      continue;
    }
    let teile: number[][][][];
    try {
      teile = polygonClipping.intersection(
        [[geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)] as [number, number][][]],
        rechteck,
      ) as unknown as number[][][][];
    } catch {
      // Die Sweep-Line scheitert an entarteten Ringen. Dann lieber das Objekt
      // ungeschnitten behalten als es verlieren — es steht im Saum, nicht im Gebiet.
      raus.push(f);
      continue;
    }
    let nr = 0;
    for (const teil of teile) {
      // OFFENE RINGE: polygon-clipping gibt Ringe GESCHLOSSEN zurueck (letzter
      // Punkt gleich erstem), der Rest der Kette erwartet sie offen. Bleibt der
      // Doppelpunkt stehen, baut Cesiums Ohrenschnitt daraus entartete Dreiecke
      // — sichtbar als helle Zacken, die in die Flaeche stechen (aufgetreten am
      // Grossen Woog, 09.08.2026). ringNormalisieren entfernt Doppelpunkte und
      // den Schluss.
      const aussen = ringNormalisieren(teil[0] as Ring);
      if (aussen.length < 3) continue;
      const loecher = teil.slice(1).map((l) => ringNormalisieren(l as Ring)).filter((l) => l.length >= 3);
      raus.push({
        ...f,
        id: nr === 0 ? f.id : `${f.id}#${nr}`,
        polygon: aussen,
        loecher: loecher.length ? loecher : undefined,
      });
      nr++;
    }
  }
  return raus;
}

/**
 * Schneidet Linienobjekte (Gleise, Markierungen, Mauern) am Gebiet ab.
 * Gleiche Begruendung wie bei den Flaechen — nur muss eine Linie dabei in
 * mehrere Stuecke zerfallen duerfen.
 */
function linienAmGebietSchneiden(linien: GelaendeLinienObjekt[], gebiet: BBox): GelaendeLinienObjekt[] {
  const drin = (p: Punkt) => p[0] >= gebiet.minE && p[0] <= gebiet.maxE && p[1] >= gebiet.minN && p[1] <= gebiet.maxN;
  // Schnittpunkt der Strecke a->b mit der Gebietskante (parametrisch, Liang-Barsky
  // auf einen einzelnen Ein- bzw. Austritt reduziert).
  const kante = (a: Punkt, b: Punkt): Punkt => {
    let t0 = 0;
    let t1 = 1;
    const dE = b[0] - a[0];
    const dN = b[1] - a[1];
    const pruefe = (p: number, q: number) => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    pruefe(-dE, a[0] - gebiet.minE);
    pruefe(dE, gebiet.maxE - a[0]);
    pruefe(-dN, a[1] - gebiet.minN);
    pruefe(dN, gebiet.maxN - a[1]);
    const t = drin(a) ? t1 : t0;
    return [a[0] + dE * t, a[1] + dN * t];
  };
  const raus: GelaendeLinienObjekt[] = [];
  for (const l of linien) {
    if (l.achse.every(drin)) {
      raus.push(l);
      continue;
    }
    let stueck: Punkt[] = [];
    let nr = 0;
    const schliessen = () => {
      if (stueck.length >= 2) raus.push({ ...l, id: nr === 0 ? l.id : `${l.id}#${nr}`, achse: stueck });
      if (stueck.length >= 2) nr++;
      stueck = [];
    };
    for (let i = 0; i < l.achse.length; i++) {
      const p = l.achse[i];
      const vorherDrin = i > 0 && drin(l.achse[i - 1]);
      if (drin(p)) {
        if (i > 0 && !vorherDrin) stueck.push(kante(l.achse[i - 1], p));
        stueck.push(p);
      } else if (vorherDrin) {
        stueck.push(kante(l.achse[i - 1], p));
        schliessen();
      }
    }
    schliessen();
  }
  return raus;
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
  // REIHENFOLGE (seit 09.08.2026): zuerst das amtliche DGM1 in seiner ECHTEN
  // Aufloesung von 1 m. Erst wenn keines vorliegt, wird aus den
  // LoD2-Bodenhoehen genaehert — und das steht dann auch so im Nachweis.
  // Vorher wurde selbst ein vorhandenes DGM1 auf 4,7 m heruntergerechnet und
  // geglaettet; damit war jede Gelaendekante weg (docs/BAUWERKSMODELL.md, 1).
  melde(a, 'Gelaendehoehen', 0.44, 'Suche amtliches Hoehenmodell (DGM1).');
  // GEBIET DER HOEHEN != BESTELLTES GEBIET: Die Kacheln sind quadratisch und am
  // globalen Raster ausgerichtet, ragen also ueber das Gebiet hinaus. Die Hoehen
  // werden fuer die ganze Kachelhuelle geholt, sonst faellt der Ueberhang auf die
  // Ersatzhoehe zurueck und wird zur erfundenen ebenen Platte (kachelHuelle).
  // Bestellt bleibt a.bbox — Flaechen, Gebaeude und Baeume kommen weiterhin nur
  // dafuer, und nur das zaehlt gegen MAX_GEBIET_M2.
  const hoehenGebiet = kachelHuelle(a.bbox, KACHEL_M, RASTER_RAND_M);
  let raster: Hoehenraster | null = null;
  let hoehenHerkunft: Gelaende['hoehenHerkunft'] = 'flach';
  let rasterQuelle = '';
  let rasterKacheln: string[] | undefined;
  let ergaenzteZellen = 0;

  const dgmQuelle = dgm.quelleErmitteln(datenWurzel());
  if (dgmQuelle) {
    try {
      const erg = dgm.rasterFuerGebiet(dgmQuelle, hoehenGebiet, {
        zellM: RASTER_ZELL_M,
        randM: 0,
        bericht: (t) => melde(a, 'Gelaendehoehen', 0.45, t),
      });
      raster = erg.raster;
      hoehenHerkunft = 'dgm1';
      rasterQuelle = erg.quelle.beschreibung;
      rasterKacheln = erg.kacheln;
      ergaenzteZellen = erg.gefuellt;
      const st = raster.statistik();
      melde(
        a,
        'Gelaendehoehen',
        0.47,
        `DGM1 uebernommen: ${st.zellen.toLocaleString('de-DE')} Zellen a ${RASTER_ZELL_M} m aus ${erg.kacheln.length} Kacheln, ${st.min.toFixed(1)}–${st.max.toFixed(1)} m ue. NHN${erg.gefuellt ? `, ${erg.gefuellt} Zellen aus der Nachbarschaft ergaenzt` : ''}.`,
      );
    } catch (e) {
      melde(a, 'Gelaendehoehen', 0.45, `DGM1 nicht verwendbar (${(e as Error).message}) — es wird aus den LoD2-Bodenhoehen genaehert.`);
    }
  } else {
    melde(a, 'Gelaendehoehen', 0.45, 'Kein DGM1 vorhanden — die Hoehen werden aus den LoD2-Bodenhoehen genaehert.');
  }

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

  if (!raster) {
    if (stuetz.length < roh.length) {
      melde(a, 'Gelaendehoehen', 0.46, `${roh.length - stuetz.length} unplausible Bodenhoehen verworfen (Abgleich mit der Nachbarschaft).`);
    }
    if (stuetz.length >= 3) {
      raster = dgm.rasterAusStuetzpunkten(hoehenGebiet, stuetz, { zellM: RASTER_ZELL_M, randM: 0 });
      hoehenHerkunft = 'lod2_interpoliert';
      rasterQuelle = `abgeleitet aus ${stuetz.length} LoD2-Bodenhoehen`;
    } else {
      raster = dgm.rasterAusStuetzpunkten(hoehenGebiet, [{ e: a.bbox.minE, n: a.bbox.minN, h: 0 }], { zellM: RASTER_ZELL_M, randM: 0 });
      hoehenHerkunft = 'flach';
      rasterQuelle = 'flaches Ersatzgelaende';
    }
  }

  nachweise.push({
    datensatz: 'Gelaendehoehen',
    dienst:
      hoehenHerkunft === 'dgm1'
        ? `Amtliches Digitales Gelaendemodell DGM1 (1 m), ${rasterQuelle}`
        : hoehenHerkunft === 'lod2_interpoliert'
          ? 'abgeleitet aus LoD2-Bodenhoehen (Attribut AbsoluteHoehe)'
          : 'flaches Ersatzgelaende',
    url: '',
    abgerufenAm: abgerufen,
    lizenz: k.gelaendehoehen.lizenz,
    quellenvermerk:
      hoehenHerkunft === 'dgm1'
        ? '(c) Hessische Verwaltung fuer Bodenmanagement und Geoinformation (HVBG), DGM1 — bearbeitet (auf das Zielgebiet zugeschnitten)'
        : k.gelaendehoehen.quellenvermerk,
    hinweis:
      hoehenHerkunft === 'dgm1'
        ? `Raster ${raster.kopf.spalten} x ${raster.kopf.zeilen} Zellen a ${raster.kopf.zellM} m aus den Kacheln ${(rasterKacheln ?? []).join(', ')}.${ergaenzteZellen ? ` ${ergaenzteZellen} Zellen ohne Messwert wurden aus der Nachbarschaft ergaenzt — das ist eine Naeherung.` : ''}`
        : hoehenHerkunft === 'lod2_interpoliert'
          ? `${stuetz.length} amtliche Bodenhoehen als Stuetzpunkte, dazwischen invers-distanzgewichtet interpoliert. Zwischen den Gebaeuden ist das GENAEHERT, nicht gemessen. Ein DGM1 kann jederzeit nachgereicht werden und hat dann Vorrang.`
          : 'Zu wenige Stuetzpunkte — Gelaende ist eben angenommen (k. A. zur echten Hoehenlage).',
  });

  // --- 3. Kacheln mit Luftbild ---------------------------------------------
  // KACHELSCHNITT AM RASTER (seit 09.08.2026): Die Kacheln sind jetzt
  // quadratisch, 256 m gross und am Hoehenraster ausgerichtet. Beides ist
  // noetig, damit das Gelaendenetz je Kachel mit 257 x 257 Stuetzstellen
  // gebaut werden kann, die EXAKT auf den Rasterwerten sitzen — bei den alten
  // 300 x 333 m haetten die Stuetzstellen zwischen den Zellen gelegen, und aus
  // jeder senkrechten Kante waere wieder eine Rampe geworden
  // (Begruendung: shared/geo/gelaendenetz.ts, kachelnAmRaster).
  //
  // Das Hoehengitter je Kachel bleibt als GROBER Rueckfallweg erhalten (2D-
  // Karte, Altbestaende ohne Raster). Es ist nicht mehr die Hoehenwahrheit,
  // darum genuegen 33 Stuetzstellen statt 65.
  const gitter = opts.hoehenGitter ?? 33;
  const texturPx = Math.min(opts.texturPx ?? 1536, k.orthophoto.maxPixel);
  const kacheln = kachelnAmRaster(hoehenGebiet, raster.kopf.minE, raster.kopf.minN, KACHEL_M);
  const patches: GelaendePatch[] = [];
  const rasterStat = raster.statistik();
  // Auf den Zentimeter runden: die Float32-Werte des DGM tragen mehr Stellen,
  // als die Messung hergibt („131,91400146484375 m" behauptet Zehntelmillimeter).
  let hMin = Math.round(rasterStat.min * 100) / 100;
  let hMax = Math.round(rasterStat.max * 100) / 100;
  let hSumme = Math.round(rasterStat.mittel * 100) / 100;
  let hAnzahl = 1;
  let leere = 0;

  for (let i = 0; i < kacheln.length; i++) {
    const bb = kacheln[i];
    const hoehen: number[][] = [];
    for (let z = 0; z < gitter; z++) {
      const zeile: number[] = [];
      const n = bb.minN + ((bb.maxN - bb.minN) * z) / (gitter - 1);
      for (let s = 0; s < gitter; s++) {
        const e = bb.minE + ((bb.maxE - bb.minE) * s) / (gitter - 1);
        zeile.push(Math.round(raster.hoeheOder(e, n, rasterStat.mittel) * 100) / 100);
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

  // --- 4b1b. Metadaten VOR der Vereinigung retten ---------------------------
  // Die Union je Klasse verschmilzt Einzelflaechen. Achse, Spurenzahl und
  // Bezeichnung EINER Flaeche waeren fuer die Sammelgeometrie falsch und
  // gehen darum bewusst nicht mit. Was die Darstellung davon braucht, wird
  // hier vorher in eigene Kanaele ueberfuehrt:
  //   Fahrbahnachsen  -> Markierungslinien (Leitlinie bei Hauptstrassen,
  //                      Spurtrennstriche wo OSM `lanes` kennt),
  //   Parkplaetze     -> Beschriftungspunkte ("P").
  const markierungen: GelaendeLinienObjekt[] = [];
  const beschriftungen: NonNullable<Gelaende['beschriftungen']> = [];
  {
    // Anliegerstrassen sind real meist unmarkiert — dort waere eine Linie
    // erfunden. Hauptklassen tragen innerorts praktisch immer eine Leitlinie.
    const LEITLINIEN_KLASSEN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
    const versetzt = (achse: Ring, abstand: number): Ring => {
      if (Math.abs(abstand) < 1e-9) return achse;
      const n = achse.length;
      const out: Ring = [];
      for (let i = 0; i < n; i++) {
        let nx = 0;
        let ny = 0;
        if (i > 0) {
          const dx = achse[i][0] - achse[i - 1][0];
          const dy = achse[i][1] - achse[i - 1][1];
          const l = Math.hypot(dx, dy) || 1;
          nx += -dy / l;
          ny += dx / l;
        }
        if (i < n - 1) {
          const dx = achse[i + 1][0] - achse[i][0];
          const dy = achse[i + 1][1] - achse[i][1];
          const l = Math.hypot(dx, dy) || 1;
          nx += -dy / l;
          ny += dx / l;
        }
        const l = Math.hypot(nx, ny) || 1;
        out.push([achse[i][0] + (nx / l) * abstand, achse[i][1] + (ny / l) * abstand]);
      }
      return out;
    };
    for (const f of flaechen) {
      if (f.bezeichnung && /parkplatz/i.test(f.bezeichnung) && f.polygon.length >= 3 && flaeche(f.polygon) >= 80) {
        beschriftungen.push({ pos: schwerpunkt(f.polygon), text: 'P' });
      }
      if (f.art !== 'fahrbahn' || !f.achsen?.length) continue;
      let linienZahl = 0;
      if (f.spuren && f.spuren >= 2) linienZahl = f.spuren - 1;
      else if (f.strassenklasse && LEITLINIEN_KLASSEN.has(f.strassenklasse)) linienZahl = 1;
      if (!linienZahl) continue;
      const breite = f.breiteM ?? 5;
      let lfd = 0;
      for (const achse of f.achsen) {
        if (achse.length < 2) continue;
        for (let s = 1; s <= linienZahl; s++) {
          markierungen.push({
            id: `${f.id}_marke${lfd++}`,
            art: 'markierung',
            achse: versetzt(achse, (s * breite) / (linienZahl + 1) - breite / 2),
            hoeheM: 0.02,
            breiteM: 0.12,
          });
        }
      }
    }
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
  flaechen = amGebietSchneiden(boden.flaechen, a.bbox);

  // Gewaesser einebnen — erst hier moeglich, weil vorher nicht bekannt ist, wo
  // Wasser liegt. Das Raster ist die eine Oberflaeche, also wird es korrigiert
  // und nicht die Zeichnung (Begruendung bei wasserEinebnen).
  const wasser = wasserEinebnen(raster, flaechen);
  if (wasser.gewaesser || wasser.verworfen) {
    // Die Kachel-Hoehengitter stammen aus dem Raster VOR dem Einebnen. Ohne
    // Nachziehen zeigt der grobe Rueckfallweg weiter den interpolierten
    // Seegrund — wieder zwei Wahrheiten.
    const ersatz = raster.statistik().mittel;
    for (const p of patches) {
      const g = p.spalten;
      const neu: number[][] = [];
      for (let z = 0; z < g; z++) {
        const zeile: number[] = [];
        const n = p.bbox.minN + ((p.bbox.maxN - p.bbox.minN) * z) / (g - 1);
        for (let s = 0; s < g; s++) {
          const e = p.bbox.minE + ((p.bbox.maxE - p.bbox.minE) * s) / (g - 1);
          zeile.push(Math.round(raster.hoeheOder(e, n, ersatz) * 100) / 100);
        }
        neu.push(zeile);
      }
      p.hoehen = neu;
    }
    const st = raster.statistik();
    hMin = Math.round(st.min * 100) / 100;
    hMax = Math.round(st.max * 100) / 100;
    hSumme = Math.round(st.mittel * 100) / 100;
    melde(
      a,
      'Gewaesser eingeebnet',
      0.993,
      `${wasser.gewaesser} Gewaesserflaechen auf ihren Wasserspiegel gelegt (${wasser.zellen.toLocaleString('de-DE')} Rasterzellen)` +
        `${wasser.verworfen ? `, ${wasser.verworfen} verworfen (Ufer zu steil fuer eine Spiegelebene)` : ''}.`,
    );
  }

  melde(
    a,
    'Boden aufgebaut',
    0.994,
    `${vorher} Rohflaechen -> ${flaechen.length} lueckenlose Flaechen: ` +
      `${boden.bericht.basis} amtlich, ${boden.bericht.verfeinert} durch OSM verfeinert` +
      `${boden.bericht.verworfen ? `, ${boden.bericht.verworfen} OSM-Flaechen ohne zulaessige Wirtsklasse verworfen` : ''}` +
      ` (${((Date.now() - t0) / 1000).toFixed(1)} s).`,
  );

  // --- 4b. Konstruktionshoehen und Kanten (Bauwerksmodell, Stufe 2 und 3) ---
  // Erst hier moeglich: die Kanten ergeben sich aus der NACHBARSCHAFT der
  // fertig aufgeteilten Flaechen. Vorher liegen sie noch uebereinander.
  let bruchkanten: Bruchkante[] = [];
  try {
    const hoehen = bauwerk.konstruktionshoehenSetzen(flaechen);
    melde(
      a,
      'Konstruktionshoehen',
      0.9945,
      `${hoehen.gesetzt} Flaechen mit Konstruktionshoehe${hoehen.ohneKlasse.length ? ` (ohne Bauklasse: ${hoehen.ohneKlasse.join(', ')})` : ''}` +
        `${hoehen.unbelegt.length ? `. ANNAHMEN (nicht belegt): ${hoehen.unbelegt.join(', ')}` : ''}.`,
    );
    const k = bauwerk.bruchkantenBilden(flaechen, (e, n) => raster.hoeheOder(e, n, rasterStat.mittel));
    bruchkanten = k.kanten;
    const teile = Object.entries(k.nachBauart).map(([b, e]) => `${e.anzahl} x ${b} (${e.laengeM.toLocaleString('de-DE')} m)`);
    melde(
      a,
      'Kanten abgeleitet',
      0.9948,
      `${k.kanten.length} Kanten, ${k.laengeM.toLocaleString('de-DE')} m: ${teile.join(', ')}. ` +
        `Vom Hoehenmodell selbst getragene Stufe: Median ${(k.gemesseneStufeMedianM * 100).toFixed(1)} cm ` +
        `(darum wird die Konstruktionshoehe voll aufgelegt, nicht abgezogen).`,
    );
  } catch (e) {
    // Ohne Bauklassen ist das Gelaende nicht falsch, nur flach — das gehoert
    // ins Protokoll, statt den ganzen Import scheitern zu lassen.
    melde(a, 'Konstruktionshoehen', 0.9948, `Bauklassen nicht anwendbar: ${(e as Error).message}`);
  }

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

    // --- Amtliches Baumkataster (falls im Cache vorhanden) ----------------
    // Gemessene Baeume der Stadt schlagen die OSM-Einzelpunkte; OSM ergaenzt
    // nur noch, was das Kataster nicht kennt (Privatgrund, Umland).
    try {
      const { katasterBaeume, mischeBaeume, KATASTER_QUELLE } = await import('./baumkataster.ts');
      const kataster = katasterBaeume(a.bbox);
      if (kataster.length) {
        const gemischt = mischeBaeume(kataster, punkte);
        punkte = gemischt.punkte;
        melde(
          a,
          `${kataster.length} Katasterbaeume (amtlich gemessen), ${gemischt.osmBehalten} OSM-Baeume ergaenzt, ${gemischt.osmDubletten} OSM-Dubletten entfernt`,
          0.997,
        );
        nachweise.push({
          ...KATASTER_QUELLE,
          abgerufenAm: abgerufen,
          hinweis: `${kataster.length} Baeume mit gemessener Hoehe und Krone im Gebiet.`,
        });
      }
    } catch (fehler) {
      console.warn('[gelaende] Baumkataster uebersprungen:', (fehler as Error).message);
    }

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
  // Das Raster wird als eigene Binaerdatei abgelegt, nicht in die
  // Gelaendedatei geschrieben: 2,16 Mio. Zellen waeren als JSON rund 14 MB,
  // die der Browser bei jedem Projektwechsel zeichenweise auseinandernehmen
  // muesste (die Gelaendedatei ist mit 11 MB ohnehin schon der langsamste
  // Schritt beim Projektoeffnen).
  // Konstruktionshoehen NACHZIEHEN: Die Stadtdetails haben nach Schritt 4b
  // weitere Flaechen beigesteuert (Bahnsteige, Zebrastreifen). Ohne diesen
  // zweiten Durchgang blieben genau die ohne Hoehe und fielen in der
  // Darstellung auf den alten Millimeter-Stapel zurueck — also zwei
  // verschiedene Hoehenlogiken in derselben Strasse. Die KANTEN bleiben
  // bewusst aus dem ersten Durchgang: sie gehoeren zur lueckenlosen
  // Grundaufteilung, nicht zu den Auflagen, die darauf liegen.
  try {
    const nach = bauwerk.konstruktionshoehenSetzen(flaechen);
    melde(a, 'Konstruktionshoehen', 0.9985, `${nach.gesetzt} von ${flaechen.length} Flaechen mit Konstruktionshoehe (nach den Stadtdetails nachgezogen).`);
  } catch {
    /* ohne Bauklassen bleibt es beim Rueckfallweg */
  }

  gelaendeStore.rasterSchreiben(gid, raster.puffer());
  melde(a, 'Hoehenmodell gespeichert', 0.999, `Raster ${raster.kopf.spalten} x ${raster.kopf.zeilen} a ${raster.kopf.zellM} m (${((raster.werte.length * 4) / 1048576).toFixed(1)} MB).`);

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
    hoehenmodell: {
      datei: 'hoehen.bin',
      zellM: raster.kopf.zellM,
      spalten: raster.kopf.spalten,
      zeilen: raster.kopf.zeilen,
      minE: raster.kopf.minE,
      minN: raster.kopf.minN,
      herkunft: hoehenHerkunft === 'flach' ? 'lod2_interpoliert' : hoehenHerkunft,
      quelle: rasterQuelle,
      kacheln: rasterKacheln,
      ergaenzteZellen: ergaenzteZellen || undefined,
      netzToleranzM: NETZ_TOLERANZ_M,
    },
    patches,
    gebaeude,
    flaechen,
    bruchkanten: bruchkanten.length ? bruchkanten : undefined,
    punkte,
    linien: linienAmGebietSchneiden([...linien, ...markierungen], a.bbox),
    beschriftungen: beschriftungen.length ? beschriftungen : undefined,
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

  // Das Ergebnis ist jetzt ein echtes Raster, kein umgerechnetes Kachelgitter.
  // Der alte Weg legte die importierten Hoehen auf das 4,7-m-Gitter der
  // Kacheln — ein 1-m-Modell wurde damit beim Einlesen wieder weichgezeichnet.
  const { raster, punkte } = dgm.rasterAusText(inhalt, g.bbox, RASTER_ZELL_M);
  const st = raster.statistik();
  if (!Number.isFinite(st.min) || st.zellen === st.ohneWert) {
    throw new Error('Die Datei deckt das Gebiet dieses Gelaendes nicht ab.');
  }
  raster.luecken_fuellen();
  gelaendeStore.rasterSchreiben(gid, raster.puffer());

  // Grobes Rueckfallgitter der Kacheln mitziehen, damit 2D-Karte und
  // Altbestandspfade dieselbe Hoehenlage zeigen wie das Raster.
  for (const p of g.patches) {
    for (let z = 0; z < p.zeilen; z++) {
      const n = p.bbox.minN + ((p.bbox.maxN - p.bbox.minN) * z) / (p.zeilen - 1);
      for (let s = 0; s < p.spalten; s++) {
        const e = p.bbox.minE + ((p.bbox.maxE - p.bbox.minE) * s) / (p.spalten - 1);
        p.hoehen[z][s] = Math.round(raster.hoeheOder(e, n, st.mittel) * 100) / 100;
      }
    }
  }

  g.hoeheMin = Math.round(st.min * 100) / 100;
  g.hoeheMax = Math.round(st.max * 100) / 100;
  g.hoeheMittel = Math.round(st.mittel * 100) / 100;
  g.hoehenHerkunft = 'dgm1';
  g.hoehenmodell = {
    datei: 'hoehen.bin',
    zellM: raster.kopf.zellM,
    spalten: raster.kopf.spalten,
    zeilen: raster.kopf.zeilen,
    minE: raster.kopf.minE,
    minN: raster.kopf.minN,
    herkunft: 'import',
    quelle: 'manueller Import (XYZ / ESRI-ASCII-Raster)',
    netzToleranzM: NETZ_TOLERANZ_M,
  };
  g.quellennachweis = g.quellennachweis.filter((q) => q.datensatz !== 'Gelaendehoehen');
  g.quellennachweis.push({
    datensatz: 'Gelaendehoehen DGM1',
    dienst: 'manueller Import (XYZ/ASCII-Raster)',
    url: '',
    abgerufenAm: jetzt(),
    lizenz: geoKonfig('hessen').gelaendehoehen.lizenz,
    quellenvermerk: '(c) HVBG, Digitales Gelaendemodell DGM1',
    hinweis: `${punkte} Hoehenpunkte importiert, Raster ${raster.kopf.spalten} x ${raster.kopf.zeilen} a ${raster.kopf.zellM} m.`,
  });
  gelaendeStore.speichern(g);
  return { punkte, hMin: g.hoeheMin, hMax: g.hoeheMax };
}
