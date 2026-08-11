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
import type { BBox, Bruchkante, Datenluecke, Gelaende, GelaendeFlaeche, GelaendeLinienObjekt, GelaendePatch, Punkt, Quellennachweis, Ring } from '../../shared/domain/types.ts';
import { HoehenFeld, aufPolylinie, bboxFlaeche, bboxRing, bboxVonPunkten, flaeche, polylinieLaenge, punktInRing, ringNormalisieren, schwerpunkt } from '../../shared/geo/geometry.ts';
import type { Stuetzpunkt } from '../../shared/geo/geometry.ts';
import { Hoehenraster } from '../../shared/geo/raster.ts';
import { kachelHuelle, kachelnAmRaster } from '../../shared/geo/gelaendenetz.ts';
import { straengeBilden } from '../../shared/geo/netz.ts';
import { teileAnPodesten, treppenlauf } from '../../shared/bau/treppe.ts';
import { gelaende as gelaendeStore, id, jetzt, WURZEL as DATEN_WURZEL } from '../lib/store.ts';
import { bahnkoerperBreiteM, eindeckungBreiteM } from '../../shared/bau/oberbau.ts';
import { RANG } from './nutzung.ts';
import { geoKonfig } from './konfig.ts';

/** Zeichenrang der Gleiszone — aus der einen Rangtabelle, nicht neu erfunden. */
const RANG_GLEISZONE = RANG.gleiszone;
import * as lod2 from './lod2.ts';
import * as alkis from './alkis.ts';
import * as dgm from './dgm.ts';
import * as bauwerk from './bauwerk.ts';
import { orthophoto } from './wms.ts';

/**
 * GROESSTES GEBIET EINES EINZELNEN GELAENDES.
 *
 * Das Lastenheft F1.1 nannte 2 km2 — die Groesse EINER Veranstaltung. Fuer ein
 * Stadtabbild ist das die falsche Groesse: Darmstadt hat 122 km2 und braeuchte
 * 61 Laeufe mit 61 Nahtstellen.
 *
 * Die neue Zahl ist nicht gegriffen, sondern die gemessene Grenze der
 * ANZEIGE. Der Browser haelt fuer das Referenzgebiet 159 MB je 1,81 km2; im
 * Stadtmittel sind es rund 62 MB je km2, weil die Aussenbezirke duenner bebaut
 * sind. Bei einem Fenster-Budget von 2 GB liegt die Grenze damit bei etwa
 * 32 km2 — und ein Gelaende, das sich bauen, aber nicht anzeigen laesst, ist
 * kein Gelaende.
 *
 * 12 km2 laesst also reichlich Luft nach oben (rund ein Drittel des
 * Messwerts) und macht aus 61 Laeufen etwa 14. Wer mehr will, muss zuerst das
 * Nachladen nach Sichtbereich bauen; bis dahin ist diese Zahl die ehrliche.
 */
export const MAX_GEBIET_M2 = 12_000_000;

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
  bericht: { basis: number; verfeinert: number; verworfen: number; mitHoehenband: number; abzuegeGescheitert: number };
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

  /*
   * MILLIMETER AN JEDER EINGABE DER SWEEP-LINE, nicht nur an einer.
   *
   * BEFUND 11.08.2026, nachgestellt: `polygon-clipping` scheitert nicht an der
   * MENGE, sondern an einzelnen entarteten Punkten — bei acht gemischten
   * Stichproben je Groesse lag die Fehlerquote bei 0/0/13/38/38/0 % fuer
   * 200/400/800/1.600/2.400/3.200 Polygone; bei 3.200 gingen acht von acht
   * durch. Ausloeser war ein Punktpaar, das sich erst in der zwoelften
   * Nachkommastelle unterscheidet (171.04 gegen 171.0400000000001).
   *
   * Die Rundung gab es bisher NUR im Abzug der Bodenklassen (`ohneUeberlapp`).
   * Alle uebrigen siebzehn Aufrufe gingen ungerundet hinein. Sie liegt jetzt
   * in den vier Hilfen, durch die jeder Aufruf dieses Moduls laeuft.
   *
   * Der Verlust ist keiner: Die Daten sind zentimetergenau, die zusaetzlichen
   * Stellen stammen aus der Verschiebung um den lokalen Ursprung.
   */
  const mm = (mp: number[][][][]): number[][][][] =>
    mp.map((poly) => poly.map((ring) => ring.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])));

  const alsGeom = (f: GelaendeFlaeche): number[][][] =>
    [geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)].map((r) =>
      r.map((p) => [Math.round((p[0] - ox) * 1000) / 1000, Math.round((p[1] - oy) * 1000) / 1000]),
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
    const nn = mps.filter((m) => m.length).map(mm);
    if (!nn.length) return [];
    if (nn.length === 1) return nn[0];
    return polygonClipping.union(nn[0] as never, ...(nn.slice(1) as never[])) as never;
  };

  const schneide = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length || !b.length) return [];
    return polygonClipping.intersection(mm(a) as never, mm(b) as never) as never;
  };
  const ziehAb = (a: number[][][][], b: number[][][][]): number[][][][] => {
    if (!a.length) return [];
    if (!b.length) return a;
    return polygonClipping.difference(mm(a) as never, mm(b) as never) as never;
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

  // --- 0. WAS NICHT AUF DEM BODEN LIEGT, GEHOERT NICHT IN DIE AUFTEILUNG ----
  //
  // BEFUND 10.08.2026, beim ersten Lauf mit Hoehenband: „Keine Rampen,
  // Unterfuehrungen oder Bruecken im Gebiet gefunden" — obwohl OpenStreetMap
  // sie liefert. Ursache: Die Aufteilung vereinigt JE KLASSE. Eine Bruecke der
  // Klasse „fahrbahn" verschmolz dabei mit der Strasse, die unter ihr
  // hindurchfuehrt, und ihr Hoehenband ging verloren — die neue Sammelflaeche
  // erbt nur Quelle, Rang und Belag.
  //
  // Das ist nicht nur ein verlorenes Merkmal, sondern ein Denkfehler: Die
  // lueckenlose Aufteilung beantwortet die Frage „welche Klasse liegt an
  // dieser Stelle AUF DEM BODEN". Eine Bruecke liegt dort gar nicht — sie
  // liegt darueber, und die Strasse darunter behaelt ihren Platz. Objekte mit
  // Hoehenband werden darum aus der Aufteilung herausgenommen und unveraendert
  // wieder eingesetzt, mit Achse, Breite und Lage.
  const istEbenerBoden = (f: GelaendeFlaeche): boolean => {
    const l = f.lage;
    if (!l) return true;
    if (l.bruecke) return false;
    if (l.tunnel && l.tunnel !== 'building_passage') return false;
    if (l.ueberdeckt && l.ueberdeckt !== 'no') return false;
    if (typeof l.layer === 'number' && l.layer !== 0) return false;
    if (typeof l.osmLevel === 'number' && l.osmLevel !== 0) return false;
    return true; // nur `incline` oder `maxheight`: liegt weiterhin auf dem Boden
  };
  const eigeneLage = flaechen.filter((f) => !istEbenerBoden(f));
  flaechen = flaechen.filter(istEbenerBoden);

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
    return {
      flaechen: [...flaechenAufteilen(flaechen), ...eigeneLage],
      bericht: { basis: 0, verfeinert: 0, verworfen: 0, mitHoehenband: eigeneLage.length, abzuegeGescheitert: 0 },
    };
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
  //
  // BELEGT ALS LISTE, NICHT ALS EINE GEOMETRIE — und das ist die Behebung
  // eines gemessenen Fehlers, nicht Geschmack:
  //
  // BEFUND 10.08.2026: 87.194 m2 des OSM-Fahrbahndeckers lagen AUF der
  // ALKIS-Platte, also 59,7 % des Deckers doppelt. Zwei koplanare Flaechen an
  // derselben Stelle entscheidet der Tiefenpuffer bildpunktweise — das ergibt
  // genau den „Fleckenteppich", den der Auftraggeber beschrieben hat. Die
  // Zusage dieser Funktion („lueckenlos UND ueberschneidungsfrei") war damit
  // nicht eingehalten.
  //
  // URSACHE: `belegt` wurde als EINE vereinigte Geometrie mitgefuehrt. Schlug
  // die Vereinigung fuer eine Klasse fehl (polygon-clipping bricht bei
  // entarteten Ringen ab), landete diese Klasse trotzdem im Ergebnis, fehlte
  // aber in `belegt` — und Schritt 3 zeichnete die amtliche Basis
  // ungeschnitten darueber. EIN gescheiterter Aufruf hat so die ganze
  // Aufteilung entwertet.
  //
  // JETZT: eine Liste, ein Eintrag je Klasse. Der Abzug laeuft in einer
  // Schleife mit eigenem Fangzweig je Eintrag. Ein Fehler kostet dann eine
  // Ueberlappung, nicht alle.
  const ergebnis: GelaendeFlaeche[] = [];
  const belegtTeile: number[][][][][] = [];
  let abzuegeGescheitert = 0;
  /**
   * ABZUG IN BLOECKEN — damit ein Fehlschlag klein bleibt.
   *
   * BEFUND 10.08.2026: Zwei gescheiterte Abzuege haben 87.194 m2 doppelt
   * gezeichneter Flaeche hinterlassen (59,7 % des Fahrbahndeckers lagen auf der
   * ALKIS-Platte). Zwei koplanare Flaechen entscheidet der Tiefenpuffer
   * bildpunktweise — das IST der „Fleckenteppich".
   *
   * `polygon-clipping` bricht bei grossen, komplexen Eingaben ab („Unable to
   * find segment in SweepLine tree"; bekannter Praezisionsfehler der
   * Bibliothek, mfogel/polygon-clipping #60/#98/#115/#148). Zwei Massnahmen:
   *  1. Der Subtrahend wird in BLOECKEN abgezogen. Scheitert ein Block, bleibt
   *     nur dieser eine als Ueberlappung stehen statt der ganzen Klasse.
   *  2. Die Koordinaten werden vorher auf MILLIMETER gerundet. Die Daten sind
   *     ohnehin nur zentimetergenau; die zusaetzlichen Nachkommastellen aus der
   *     Verschiebung sind Rauschen, an dem sich die Sweep-Line verschluckt.
   */
  const aufMillimeter = (mp: number[][][][]): number[][][][] =>
    mp.map((poly) => poly.map((ring) => ring.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])));
  const ABZUG_BLOCK = 40;
  const ohneUeberlapp = (geom: number[][][][]): number[][][][] => {
    let rest = aufMillimeter(geom);
    for (const teil of belegtTeile) {
      if (!rest.length) break;
      const gerundet = aufMillimeter(teil);
      for (let i = 0; i < gerundet.length; i += ABZUG_BLOCK) {
        if (!rest.length) break;
        const block = gerundet.slice(i, i + ABZUG_BLOCK);
        try {
          rest = ziehAb(rest, block);
        } catch {
          // GEZAEHLT, nicht verschwiegen: Jeder gescheiterte Abzug ist eine
          // Doppelzeichnung im Bild. Die Zahl gehoert ins Auftragsprotokoll.
          abzuegeGescheitert++;
        }
      }
    }
    return rest;
  };
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
      const geom = ohneUeberlapp(schneide(vereinige(liste), wirtsraum));
      if (!geom.length) continue;

      const neue = zuFlaechen(geom, liste[0], art, `osm_${art}`);
      ergebnis.push(...neue);
      verfeinert += neue.length;
      // ERST NACH dem Einfuegen vormerken — und zwar unbedingt. Genau hier
      // ging es vorher verloren: Der Vormerk-Schritt konnte fehlschlagen,
      // nachdem die Flaechen schon im Ergebnis standen.
      belegtTeile.push(geom);
    } catch {
      // Diese OSM-Klasse laesst sich nicht sauber verschneiden -> verwerfen.
      // Der Boden bleibt vollstaendig: die amtliche Basis fuellt die Stelle in
      // Schritt 3. Lieber ein Detail weniger als eine Ueberlappung.
      verworfen += liste.length;
    }
  }

  // --- 3. Amtlicher Rest ---------------------------------------------------
  // Jede Verfeinerung wird EINZELN abgezogen (siehe `ohneUeberlapp`). Ein
  // gescheiterter Abzug kostet damit nur diese eine Ueberlappung — vorher
  // kostete er die ganze Aufteilung.
  let basis = 0;
  for (const [art, geom] of basisGeom) {
    const rest = ohneUeberlapp(geom);
    if (!rest.length) continue;
    const neue = zuFlaechen(rest, alkisNach.get(art)![0], art, `alkis_${art}`);
    ergebnis.push(...neue);
    basis += neue.length;
  }

  // --- 4. Was ein Hoehenband hat, kommt unveraendert zurueck ----------------
  ergebnis.push(...eigeneLage);

  return { flaechen: ergebnis, bericht: { basis, verfeinert, verworfen, mitHoehenband: eigeneLage.length, abzuegeGescheitert } };
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
function wasserEinebnen(
  raster: Hoehenraster,
  flaechen: GelaendeFlaeche[],
  sohle?: { sohleUnterSpiegelM: number; sohleUnterSpiegelWasserlaufM?: number },
): { gewaesser: number; zellen: number; verworfen: number; tiefsteM: number; mitSohle: number } {
  const k = raster.kopf;
  let gewaesser = 0;
  let zellen = 0;
  let verworfen = 0;
  let tiefsteM = 0;
  let mitSohle = 0;
  /**
   * DIE SOHLE LAEUFT ZUM UFER AUS. Ein senkrechter Absturz an der Uferlinie
   * waere geometrisch bequem und sachlich falsch — kein Gewaesser hat eine
   * Wand am Rand. Innerhalb dieser Breite waechst die Tiefe von 0 auf den
   * vollen Wert; dadurch entsteht eine Boeschung, die auch die Kantenregel
   * richtig einordnet.
   */
  const UFER_RAMPE_M = 2.5;
  const abstandZumUfer = (p: Punkt, ringe: Punkt[][]): number => {
    let best = Infinity;
    for (const r of ringe) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j];
        const b = r[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
        if (d < best) best = d;
        if (best < 0.05) return best;
      }
    }
    return best;
  };
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
    // SOHLE STATT PLATTE (10.08.2026): Bis dahin wurde das Raster innerhalb
    // der Wasserflaeche auf den SPIEGEL gelegt — das Gewaesser war eine ebene
    // Platte ohne Tiefe, ein Bach lag auf dem Ufer statt darin. Jetzt wird auf
    // die SOHLE abgesenkt; der Spiegel bleibt als eigene, durchscheinende
    // Ebene darueber (`wasserspiegelM`, gezeichnet in web/src/scene/stadt.ts).
    const tiefeVoll = sohle
      ? istWasserlauf
        ? (sohle.sohleUnterSpiegelWasserlaufM ?? sohle.sohleUnterSpiegelM)
        : sohle.sohleUnterSpiegelM
      : 0;
    const ringe = [f.polygon, ...(f.loecher ?? [])];
    let gesetzt = 0;
    let tiefste = 0;
    for (let z = z0; z <= z1; z++) {
      for (let s = s0; s <= s1; s++) {
        const [e, n] = raster.zellMitte(s, z);
        if (!punktInRing([e, n], f.polygon)) continue;
        if ((f.loecher ?? []).some((l) => punktInRing([e, n], l))) continue;
        const sp = spiegel(e, n);
        let tiefe = 0;
        if (tiefeVoll > 0) {
          const d = abstandZumUfer([e, n], ringe);
          tiefe = tiefeVoll * Math.min(1, d / UFER_RAMPE_M);
        }
        raster.setze(s, z, sp - tiefe);
        if (tiefe > tiefste) tiefste = tiefe;
        gesetzt++;
      }
    }
    if (gesetzt) {
      gewaesser++;
      zellen += gesetzt;
      if (tiefste > 0) {
        mitSohle++;
        f.wassersohleM = Math.round((f.wasserspiegelM ?? spiegel(mE, mN)) * 1000 - tiefste * 1000) / 1000;
        if (tiefste > tiefsteM) tiefsteM = tiefste;
      }
    }
  }
  return { gewaesser, zellen, verworfen, tiefsteM, mitSohle };
}

/**
 * UEBERTRAEGT `step_count` UEBER DIE VEREINIGUNG HINWEG.
 *
 * DAS PROBLEM: Die Bodenflaechen werden je Klasse vereinigt (sonst liegen 736
 * Einzelplatten statt eines Netzes). Dabei gehen die Merkmale der einzelnen
 * OSM-Wege verloren — auch die gezaehlte Stufenzahl. Sie ist aber das einzige
 * BELEGTE Mass, das eine Treppe im Bestand hat; ohne sie bleibt nur die
 * Annahme aus den Bauklassen.
 *
 * DIE LOESUNG IST BEWUSST STRENG: Eine Zaehlung wird nur uebernommen, wenn sie
 * EINDEUTIG ist — wenn genau eine Rohtreppe mit `step_count` in der fertigen
 * Flaeche liegt. Verschmelzen zwei Treppen mit verschiedenen Zaehlungen, bleibt
 * das Feld leer. Eine der beiden Zahlen zu nehmen waere eine Behauptung.
 */
function stufenzahlenUebertragen(
  roh: GelaendeFlaeche[],
  fertig: GelaendeFlaeche[],
): { uebernommen: number; mehrdeutig: number } {
  const mitZaehlung = roh
    .filter((f) => f.art === 'treppe' && f.stufenzahl && f.polygon.length >= 3)
    .map((f) => ({ punkt: schwerpunkt(f.polygon), anzahl: f.stufenzahl as number }));
  if (!mitZaehlung.length) return { uebernommen: 0, mehrdeutig: 0 };
  let uebernommen = 0;
  let mehrdeutig = 0;
  for (const f of fertig) {
    if (f.art !== 'treppe' || f.polygon.length < 3) continue;
    const treffer = mitZaehlung.filter(
      (z) => punktInRing(z.punkt, f.polygon) && !(f.loecher ?? []).some((l) => punktInRing(z.punkt, l)),
    );
    if (!treffer.length) continue;
    const werte = new Set(treffer.map((t) => t.anzahl));
    if (werte.size === 1) {
      f.stufenzahl = treffer[0].anzahl;
      uebernommen++;
    } else {
      mehrdeutig++;
    }
  }
  return { uebernommen, mehrdeutig };
}

/**
 * GELAENDER AN TREPPEN — abgeleitet, nicht erfasst.
 *
 * DER BEFUND (Uebergabe 4.4): „Gelaender fehlen ganz, obwohl sie fuer die
 * Fluchtwegbeurteilung zaehlen." OpenStreetMap fuehrt `handrail` nur selten,
 * und ein Gelaender ist auch kein Objekt, das man einzeln erfasst — es gehoert
 * zur Treppe. DIN 18040-3 verlangt sie im oeffentlichen Verkehrsraum
 * BEIDSEITIG; genau das wird hier angesetzt.
 *
 * Sie entstehen aus den WANGEN des Laufs, also aus derselben Rechnung, die die
 * Stufen erzeugt (shared/bau/treppe.ts). Sie sind damit ausdruecklich eine
 * ABLEITUNG und keine Messung — jedes Gelaender traegt das im Datensatz
 * (`lage.herkunft = 'annahme'`).
 */
function gelaenderAnTreppen(
  flaechen: GelaendeFlaeche[],
  hoeheBei: (e: number, n: number) => number,
  stufenmass: { hoeheM: number; hoeheZulaessigMinM?: number; hoeheZulaessigMaxM?: number },
  hoeheM: number,
): { linien: GelaendeLinienObjekt[]; bericht: { flaechen: number; teile: number; laeufe: number; stufen: number; flach: number; mitBeleg: number; befunde: string[] } } {
  const linien: GelaendeLinienObjekt[] = [];
  const bericht = { flaechen: 0, teile: 0, laeufe: 0, stufen: 0, flach: 0, mitBeleg: 0, befunde: [] as string[] };
  for (const f of flaechen) {
    if (f.art !== 'treppe' || f.polygon.length < 3) continue;
    bericht.flaechen++;
    const teile = teileAnPodesten(f.polygon);
    bericht.teile += teile.length;
    let nr = 0;
    for (const teil of teile) {
      // Bei geteilten Laeufen ist die Zaehlung fuer den GANZEN Aufgang belegt,
      // nicht je Teillauf — sie darf dann nicht auf einen Teil angewandt werden.
      const beleg = teile.length === 1 ? f.stufenzahl : undefined;
      const lauf = treppenlauf(teil, hoeheBei, stufenmass, beleg);
      for (const b of lauf.befunde) bericht.befunde.push(`${f.id}: ${b}`);
      if (lauf.flach || !lauf.stufen.length) {
        bericht.flach++;
        continue;
      }
      bericht.laeufe++;
      bericht.stufen += lauf.anzahl;
      if (lauf.herkunft === 'step_count') bericht.mitBeleg++;
      for (const [i, wange] of lauf.wangen.entries()) {
        if (wange.length < 2) continue;
        linien.push({
          id: `gelaender_${f.id}_${nr}_${i}`,
          art: 'gelaender',
          achse: wange.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] as Punkt),
          hoeheM,
          breiteM: 0.06,
          lage: { herkunft: 'annahme' },
        });
      }
      nr++;
    }
  }
  return { linien, bericht };
}

/**
 * SCHNEIDET DIE GLEISZONE AUS DEN BODENFLAECHEN.
 *
 * WARUM DAS SEIN MUSS — und warum die Auflage-Loesung ausgeschieden ist:
 * Die Rille ist eine VERTIEFUNG von 3,8 cm unter der Fahrbahnoberkante. Die
 * Fahrbahn war im Modell ein geschlossenes Polygon ohne Loch und verdeckte sie
 * vollstaendig. Nachgemessen an der Rheinstrasse (475357/5524443):
 * `scene.drillPick` senkrecht auf die Gleisachse lieferte von vorn nach hinten
 * `boden:fahrbahn:osm_fahrbahn_118`, dann `gleis:0`, dann `gelaende:p8` — die
 * Fahrbahn lag ueber dem Gleis, obwohl das Gleisband 4,5 cm hoeher angesetzt
 * war. Bildpunktmessung quer ueber die Achse: Fahrflaeche 101 px, Eindeckung
 * 130 px, Rille 0 px.
 *
 * Die naheliegende Abhilfe — das Gleis hoeher legen — ist gerechnet und
 * verworfen: Bodenzeichnung und Gleisband sind zwei getrennt vernetzte
 * Flaechen, die dasselbe Gelaende an verschiedenen Stuetzpunkten abtasten. Ein
 * Versatz, der die Netztoleranz sicher ueberbietet, muesste groesser sein als
 * die Bordsteinhoehe von 12 cm — dann stuende das Gleis als Rampe auf der
 * Strasse.
 *
 * ALSO: Loch statt Auflage. Je Gleisachse entsteht ein Korridor in der Breite
 * der Eindeckung (Rillenschiene) bzw. des Bahnkoerpers (Schotteroberbau), alle
 * werden vereinigt, von den Bodenflaechen abgezogen und als eigene Flaechen der
 * Klasse `gleiszone` eingesetzt. Danach liegt das Gleisprofil buendig
 * (`zPlatte = 0`) und man sieht in die Rille hinein.
 *
 * ZWEI FALLEN, beide hier umgangen:
 *  1. `bandRing` in shared/geo/geometry.ts hat einen bekannten Selbstschnitt.
 *     Der Korridor wird darum aus SEGMENT-RECHTECKEN gebildet und vereinigt —
 *     an den Knicken ueberlappen sie sich, und genau das ist gewollt: die
 *     Vereinigung schliesst die Kerbe, die eine Gehrung offen liesse.
 *  2. `polygon-clipping` bricht bei UTM-Koordinaten mit „Unable to find
 *     segment in SweepLine tree" ab, weil nach dem Ganzzahlanteil (Rechtswert
 *     ~475.000) kaum Mantisse fuer die Schnittrechnung bleibt. Alle
 *     Koordinaten werden darum um einen lokalen Ursprung verschoben — dasselbe
 *     Vorgehen wie in `bodenAufbauen`.
 */
function gleiszoneAusschneiden(
  flaechen: GelaendeFlaeche[],
  linien: GelaendeLinienObjekt[],
): { flaechen: GelaendeFlaeche[]; bericht: { gleise: number; laengeM: number; zonen: number; flaecheM2: number; beschnitten: number } } {
  const gleise = linien.filter((l) => l.art === 'gleis' && l.achse.length >= 2);
  const leer = { gleise: 0, laengeM: 0, zonen: 0, flaecheM2: 0, beschnitten: 0 };
  if (!gleise.length) return { flaechen, bericht: leer };

  // Lokaler Ursprung — der Schluessel zur Robustheit (siehe bodenAufbauen).
  let ox = Infinity;
  let oy = Infinity;
  for (const f of flaechen) for (const p of f.polygon) {
    if (p[0] < ox) ox = p[0];
    if (p[1] < oy) oy = p[1];
  }
  for (const l of gleise) for (const p of l.achse) {
    if (p[0] < ox) ox = p[0];
    if (p[1] < oy) oy = p[1];
  }
  if (!Number.isFinite(ox)) return { flaechen, bericht: leer };

  // --- 1. Korridor je Gleis aus Segment-Rechtecken --------------------------
  const rechtecke: number[][][][] = [];
  let laenge = 0;
  for (const l of gleise) {
    const spur = l.spurweiteM && l.spurweiteM > 0 ? l.spurweiteM : 1.0;
    // Rillenschiene: die Eindeckung. Eigener Bahnkoerper: das Bettungstrapez.
    const breite = l.eigenerBahnkoerper === false ? eindeckungBreiteM(spur) : bahnkoerperBreiteM(spur);
    const h = breite / 2;
    for (let i = 1; i < l.achse.length; i++) {
      const a = l.achse[i - 1];
      const b = l.achse[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      laenge += len;
      // Quer zur Achse, auf beide Seiten. Die Rechtecke werden an den Enden um
      // die halbe Breite VERLAENGERT — dadurch ueberlappen sich benachbarte
      // Segmente im Knick, und die Vereinigung laesst dort keine Kerbe.
      const ex = dx / len;
      const ey = dy / len;
      const nx = (-ey * breite) / 2;
      const ny = (ex * breite) / 2;
      const a2: [number, number] = [a[0] - ex * h - ox, a[1] - ey * h - oy];
      const b2: [number, number] = [b[0] + ex * h - ox, b[1] + ey * h - oy];
      rechtecke.push([
        [
          [a2[0] + nx, a2[1] + ny],
          [b2[0] + nx, b2[1] + ny],
          [b2[0] - nx, b2[1] - ny],
          [a2[0] - nx, a2[1] - ny],
          [a2[0] + nx, a2[1] + ny],
        ],
      ]);
    }
  }
  if (!rechtecke.length) return { flaechen, bericht: leer };

  // --- 2. Vereinigen, in Bloecken (polygon-clipping wird sonst sehr langsam) -
  let zone: number[][][][] = [];
  const BLOCK = 200;
  for (let i = 0; i < rechtecke.length; i += BLOCK) {
    const teil = rechtecke.slice(i, i + BLOCK);
    try {
      const b = polygonClipping.union(teil[0] as never, ...(teil.slice(1) as never[])) as never as number[][][][];
      zone = zone.length ? ((polygonClipping.union(zone as never, b as never) as never) as number[][][][]) : b;
    } catch {
      // Einen Block zu verlieren waere schlimmer als eine Ueberlappung.
      for (const r of teil) zone.push(r as never);
    }
  }
  if (!zone.length) return { flaechen, bericht: leer };

  // --- 3. Von den Bodenflaechen abziehen ------------------------------------
  const alsGeom = (f: GelaendeFlaeche): number[][][] =>
    [geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)].map((r) => r.map((p) => [p[0] - ox, p[1] - oy]));
  const raus: GelaendeFlaeche[] = [];
  let beschnitten = 0;
  for (const f of flaechen) {
    // Wasser und Bahnflaechen bleiben unberuehrt: ein Gleis auf einer
    // Bahnflaeche ist dort zu Hause, und ueber Wasser fuehrt eine Bruecke.
    if (f.art === 'wasser' || f.art === 'bahn') {
      raus.push(f);
      continue;
    }
    let rest: number[][][][];
    try {
      rest = polygonClipping.difference([alsGeom(f)] as never, zone as never) as never;
    } catch {
      raus.push(f);
      continue;
    }
    if (rest.length === 1 && rest[0].length === (f.loecher?.length ?? 0) + 1) {
      // Nichts abgeschnitten (gleiche Ringzahl) — Originalgeometrie behalten,
      // damit die Rundung der Sweep-Line nicht jede Flaeche minimal veraendert.
      const gleich = Math.abs(rest[0][0].length - geschlossenerRing(f.polygon).length) === 0;
      if (gleich) {
        raus.push(f);
        continue;
      }
    }
    if (!rest.length) {
      beschnitten++;
      continue; // vollstaendig von der Gleiszone eingenommen
    }
    beschnitten++;
    let nr = 0;
    for (const poly of rest) {
      const ringe = (poly as unknown as Ring[])
        .map((r) => ringNormalisieren(r.map((p) => [p[0] + ox, p[1] + oy] as Punkt)))
        .filter((r) => r.length >= 3);
      if (!ringe.length) continue;
      raus.push({ ...f, id: nr === 0 ? f.id : `${f.id}#g${nr}`, polygon: ringe[0], loecher: ringe.length > 1 ? ringe.slice(1) : undefined });
      nr++;
    }
  }

  // --- 4. Die Gleiszone selbst als Flaeche einsetzen -------------------------
  let nr = 0;
  let flaecheM2 = 0;
  for (const poly of zone) {
    const ringe = (poly as unknown as Ring[])
      .map((r) => ringNormalisieren(r.map((p) => [p[0] + ox, p[1] + oy] as Punkt)))
      .filter((r) => r.length >= 3);
    if (!ringe.length) continue;
    flaecheM2 += Math.abs(flaeche(ringe[0]));
    raus.push({
      id: `gleiszone_${nr++}`,
      art: 'gleiszone',
      polygon: ringe[0],
      loecher: ringe.length > 1 ? ringe.slice(1) : undefined,
      quelle: 'osm',
      bezeichnung: 'Gleiszone',
      rang: RANG_GLEISZONE,
    });
  }

  return {
    flaechen: raus,
    bericht: { gleise: gleise.length, laengeM: Math.round(laenge), zonen: nr, flaecheM2: Math.round(flaecheM2), beschnitten },
  };
}

/**
 * SCHNEIDET DEN OFFENEN TROG EINER RAMPE AUS DEN BODENFLAECHEN.
 *
 * WARUM (Befund 10.08.2026, nachgemessen): Der Aushub einer Rampe senkt das
 * HOEHENMODELL. Jede Bodenflaeche darueber holt ihre Hoehen aus demselben
 * Modell — also sackt sie mit. An der Zufahrt beim Luisencenter stand die
 * Fahrbahn auf 143,50 m und das Modell unter ihr auf 140,60 m; die Kanten des
 * Grabens stachen als Flecken durch die Strasse. Ueber alle Tunnelstuecke
 * gezaehlt lagen 6.925 von 6.925 ausgehobenen Rasterzellen unter einer
 * kartierten Bodenflaeche.
 *
 * ES IST DIESELBE ANTWORT WIE BEI DER GLEISZONE: Wo ein Bauwerk den Boden
 * einnimmt, bekommt der Boden ein LOCH — keine Auflage, keine Verschiebung.
 * Ausgeschnitten wird nur der OFFENE Trog (server/geodata/hoehenband.ts
 * bestimmt ihn aus der Ueberdeckung); den ueberdeckten Teil des Tunnels traegt
 * die Strasse darueber, und die bleibt unversehrt.
 *
 * DIE RAMPENFAHRBAHN WIRD AM SELBEN UMRISS ZUGESCHNITTEN — Befund des
 * Auftraggebers, 10.08.2026: „die Strasse vom Tunnel soll nicht weitergefuehrt
 * werden, man soll nur die Tunneleinfahrt sehen; was unterirdisch ist, ist
 * unterirdisch."
 *
 * Er hat recht, und es ist keine Frage der Darstellung. Bis hierhin wurde die
 * Tunnelflaeche auf ihrer VOLLEN Laenge gefuehrt und auf ihrer Ausgleichsebene
 * gezeichnet. Hinter dem Portal liegt sie damit unter dem nicht ausgehobenen
 * Gelaende — unsichtbar, wo der Boden dichthaelt, und in Fetzen durchblitzend,
 * wo Gelaendenetz und Ebene sich schneiden. Nachgemessen am Datensatz
 * gel_ac266e9db45b09df: von 5.186 m2 Tunnelflaeche liegen 2.769 m2 mindestens
 * 2,90 m unter dem Gelaende, die tiefste Stelle 7,32 m; fuenf Stuecke sind zu
 * 100 % ueberdeckt.
 *
 * Also wird die Fahrbahn am Trog VERSCHNITTEN statt uebersprungen: Was im
 * offenen Trog liegt, bleibt; was darunter weiterlaeuft, faellt aus dem Modell.
 * Damit ist nicht die Zeichnung korrigiert, sondern das Modell ehrlich — es
 * behauptet nur noch, was man auch sehen kann.
 *
 * WELCHE FLAECHEN DAS TRIFFT, und welche ausdruecklich nicht:
 *  - NUR Flaechen mit `lage.tiefeM` — das setzt allein `rampenAbsenken`, und
 *    zwar erst, nachdem der Strang wirklich abgesenkt wurde.
 *  - NICHT Bruecken: `brueckenEinmessen` setzt ebenfalls eine `hoehenEbene`
 *    (10 der 39 im Bestand), aber kein `tiefeM`. Eine Bruecke liegt oben.
 *  - NICHT die 30 als Tunnel erfassten Wege, die zu flach fuer eine Decke sind
 *    und darum auf Strassenniveau bleiben — sie haben keinen Trog, und ein
 *    Verschnitt wuerde sie restlos loeschen.
 */
function troegeAusschneiden(
  flaechen: GelaendeFlaeche[],
  troege: Ring[],
  sohlen: Ring[],
): { flaechen: GelaendeFlaeche[]; beschnitten: number; flaecheM2: number; rampenGekuerzt: number; rampenGanzUnterTage: number } {
  const leer = { flaechen, beschnitten: 0, flaecheM2: 0, rampenGekuerzt: 0, rampenGanzUnterTage: 0 };
  if (!troege.length) return leer;
  let ox = Infinity;
  let oy = Infinity;
  for (const f of flaechen) for (const p of f.polygon) {
    if (p[0] < ox) ox = p[0];
    if (p[1] < oy) oy = p[1];
  }
  for (const t of troege) for (const p of t) {
    if (p[0] < ox) ox = p[0];
    if (p[1] < oy) oy = p[1];
  }
  if (!Number.isFinite(ox)) return leer;

  const stuecke = troege
    .filter((t) => t.length >= 3)
    .map((t) => [geschlossenerRing(t).map((p) => [p[0] - ox, p[1] - oy])] as number[][][]);
  if (!stuecke.length) return leer;
  let zone: number[][][][] = [];
  let zoneVereint = true;
  try {
    zone = polygonClipping.union(stuecke[0] as never, ...(stuecke.slice(1) as never[])) as never as number[][][][];
  } catch {
    zone = stuecke as never as number[][][][];
    zoneVereint = false;
  }
  if (!zone.length) return leer;

  // DER ENGERE UMRISS fuer die Rampenfahrbahn: nur die wirklich ausgehobenen
  // Zellen, ohne die Zugabe des Bodenlochs (Begruendung im Kopf und bei
  // SCHNITT_ZUGABE_M in server/geodata/hoehenband.ts).
  //
  // JE STUECK NUR SEINE EIGENEN ZELLEN. Eine Vereinigung aller 1.519
  // Zellquadrate in einem Zug ueberfordert die Sweep-Line: im Lauf vom
  // 10.08.2026 scheiterten 6 der 29 Verschnitte, und weil der Fehlerzweig die
  // Flaeche GANZ behielt, lagen genau diese sechs Stuecke anschliessend zu
  // 100 % unter der Erde — das Gegenteil dessen, was der Schnitt bezweckt.
  // Darum wird je Flaeche nur ueber die Zellen vereinigt, die sie beruehrt
  // (Dutzende statt Tausende), und ein Fehlschlag LOESCHT das Stueck, statt es
  // zu behalten: ein fehlendes Stueck Rampe faellt weniger ins Gewicht als eine
  // Fahrbahn drei Meter unter dem Pflaster.
  const sohlenFelder = sohlen
    .filter((t) => t.length >= 3)
    .map((t) => ({
      minE: Math.min(...t.map((p) => p[0])),
      minN: Math.min(...t.map((p) => p[1])),
      maxE: Math.max(...t.map((p) => p[0])),
      maxN: Math.max(...t.map((p) => p[1])),
      geom: [geschlossenerRing(t).map((p) => [p[0] - ox, p[1] - oy])] as number[][][],
    }));
  const sohleFuer = (f: GelaendeFlaeche): number[][][][] | null => {
    const bb = bboxVonPunkten(f.polygon);
    const teile = sohlenFelder
      .filter((z) => z.maxE >= bb.minE && z.minE <= bb.maxE && z.maxN >= bb.minN && z.minN <= bb.maxN)
      .map((z) => z.geom);
    if (!teile.length) return null;
    try {
      return polygonClipping.union(teile[0] as never, ...(teile.slice(1) as never[])) as never as number[][][][];
    } catch {
      return null;
    }
  };

  const alsGeom = (f: GelaendeFlaeche): number[][][] =>
    [geschlossenerRing(f.polygon), ...(f.loecher ?? []).map(geschlossenerRing)].map((r) => r.map((p) => [p[0] - ox, p[1] - oy]));
  const raus: GelaendeFlaeche[] = [];
  let beschnitten = 0;
  let rampenGekuerzt = 0;
  let rampenGanzUnterTage = 0;
  for (const f of flaechen) {
    if (f.art === 'wasser') {
      raus.push(f);
      continue;
    }
    // DIE ABGESENKTE RAMPE WIRD VERSCHNITTEN — nur ihr offener Teil bleibt.
    // Erkennungsmerkmal ist `tiefeM`; es setzt allein rampenAbsenken, und zwar
    // erst nach dem Aushub (Bruecken und die Durchfahrten auf Strassenniveau
    // haben es nicht — Begruendung im Kopf dieser Funktion).
    if (f.lage?.tiefeM != null) {
      const sohle = sohleFuer(f);
      let drin: number[][][][] | null = null;
      if (sohle) {
        try {
          drin = polygonClipping.intersection([alsGeom(f)] as never, sohle as never) as never as number[][][][];
        } catch {
          drin = null;
        }
      }
      if (!drin || !drin.length) {
        // Kein offener Trog unter diesem Stueck (oder der Verschnitt scheiterte):
        // oberirdisch existiert es nicht.
        rampenGanzUnterTage++;
        continue;
      }
      rampenGekuerzt++;
      let nr = 0;
      for (const poly of drin) {
        const ringe = (poly as unknown as Ring[])
          .map((r) => ringNormalisieren(r.map((p) => [p[0] + ox, p[1] + oy] as Punkt)))
          .filter((r) => r.length >= 3);
        if (!ringe.length) continue;
        raus.push({ ...f, id: nr === 0 ? f.id : `${f.id}#r${nr}`, polygon: ringe[0], loecher: ringe.length > 1 ? ringe.slice(1) : undefined });
        nr++;
      }
      continue;
    }
    // Alles andere mit eigenem Hoehenband (Bruecken, Durchfahrten) bleibt ganz.
    if (f.lage) {
      raus.push(f);
      continue;
    }
    let rest: number[][][][];
    try {
      rest = polygonClipping.difference([alsGeom(f)] as never, zone as never) as never;
    } catch {
      raus.push(f);
      continue;
    }
    if (rest.length === 1 && rest[0].length === (f.loecher?.length ?? 0) + 1 && rest[0][0].length === geschlossenerRing(f.polygon).length) {
      raus.push(f);
      continue;
    }
    beschnitten++;
    let nr = 0;
    for (const poly of rest) {
      const ringe = (poly as unknown as Ring[])
        .map((r) => ringNormalisieren(r.map((p) => [p[0] + ox, p[1] + oy] as Punkt)))
        .filter((r) => r.length >= 3);
      if (!ringe.length) continue;
      raus.push({ ...f, id: nr === 0 ? f.id : `${f.id}#t${nr}`, polygon: ringe[0], loecher: ringe.length > 1 ? ringe.slice(1) : undefined });
      nr++;
    }
  }
  let flaecheM2 = 0;
  for (const poly of zone) {
    const r = (poly as unknown as Ring[])[0];
    if (r && r.length >= 3) flaecheM2 += Math.abs(flaeche(r.map((p) => [p[0] + ox, p[1] + oy] as Punkt)));
  }
  return { flaechen: raus, beschnitten, flaecheM2: Math.round(flaecheM2), rampenGekuerzt, rampenGanzUnterTage };
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
  /** Strassenmoebel weglassen (Stadtmodell) — Begruendung in DetailOpts.ohneMoebel. */
  ohneMoebel?: boolean;
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
  opts: { hoehenGitter?: number; texturPx?: number; ohneLuftbild?: boolean; ohneMoebel?: boolean },
) {
  a.status = 'laeuft';
  const k = geoKonfig(a.land);
  const gid = id('gel_');
  const nachweise: Quellennachweis[] = [];
  const abgerufen = jetzt();
  /**
   * DATENLUECKEN — wo das Modell weniger weiss, als es soll. Sie werden ueber
   * den ganzen Lauf gesammelt (Hoehenband, Baumkataster, Abdeckungspruefung,
   * Altbestand) und landen am Ende am Gelaende, wo die Oberflaeche sie zeigt.
   * Die Liste steht bewusst GANZ OBEN: Sie wird an fuenf Stellen gefuellt, und
   * eine spaetere Deklaration hat beim Lauf vom 10.08.2026 dazu gefuehrt, dass
   * das ganze Hoehenband still ausfiel.
   */
  const datenluecken: Datenluecke[] = [];

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
      /*
       * ERGAENZTE ZELLEN SIND KEINE MESSUNG — und ab einer gewissen Menge sind
       * sie eine Falschaussage ueber die Landschaft.
       *
       * BEFUND 11.08.2026 beim Stadtlauf: Das DGM1-Archiv eines Landkreises
       * endet an der Kreisgrenze, das Kachelraster des Stadtlaufs nicht. Fuer
       * eine 3x3-km-Kachel mit nur 1 km2 Hoehendaten haette `luecken_fuellen()`
       * acht Millionen Zellen aus dem Rand extrapoliert — eine erfundene
       * Landschaft, die aussieht wie eine gemessene.
       *
       * Ein Prozent ist die Schwelle: Randzellen und einzelne Fehlstellen im
       * amtlichen Raster liegen darunter, fehlende KACHELN darueber.
       */
      const anteil = st.zellen ? erg.gefuellt / st.zellen : 0;
      if (anteil > 0.01) {
        const text =
          `${(anteil * 100).toFixed(1)} % des Hoehenrasters (${erg.gefuellt.toLocaleString('de-DE')} von ` +
          `${st.zellen.toLocaleString('de-DE')} Zellen) sind NICHT gemessen, sondern aus der Nachbarschaft ergaenzt. ` +
          `Das amtliche DGM1 deckt dieses Gebiet nur teilweise ab (${erg.kacheln.length} Kacheln geliefert). ` +
          `Jede Hoehenaussage dort — Gelaende, Gebaeudefuss, Rampentiefe, Sichtachse — ist eine Naeherung aus dem Rand, ` +
          `keine Messung. Belastbar waere nur eine Bestellung der fehlenden DGM1-Kacheln beim Land.`;
        datenluecken.push({ elementart: 'gelaendehoehe', bezeichnung: 'Gelaendehoehen (DGM1)', art: 'unter_erwartung', text, orte: [] });
        melde(a, 'Gelaendehoehen', 0.47, `ACHTUNG: ${text}`);
      }
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
    const abruf = await alkis.flurstueckeMitNachweis(a.bbox, a.land);
    flurstuecke = abruf.liste.map((f) => ({
      id: f.id,
      kennzeichen: f.kennzeichen || f.nummer,
      polygon: f.polygon,
      flaeche: f.flaecheAmtlich ?? f.flaecheGerechnet,
    }));
    // SOLL GEGEN IST — nicht behaupten, sondern nachweisen. Bis zum 11.08.2026
    // stand hier nur die gelieferte Zahl, und die war gekappt: Der Dienst hielt
    // 1.863 Flurstuecke bereit, der Import nahm 800 und schrieb sie als
    // Tatsache hin. 57 % fehlten, ohne ein Wort.
    const vollstaendig = abruf.soll !== null && abruf.geliefert >= abruf.soll;
    const nachweisText =
      abruf.soll === null
        ? `${flurstuecke.length} Flurstuecke aus ${abruf.kacheln} Kacheln. Der Dienst nannte keine Sollzahl — Vollstaendigkeit nicht nachweisbar.`
        : `${flurstuecke.length} von ${abruf.soll} Flurstuecken (${abruf.kacheln} Kacheln)` +
          `${vollstaendig ? ' — vollstaendig, vom Dienst gegengezaehlt.' : `. ES FEHLEN ${abruf.soll - abruf.geliefert}.`}`;
    nachweise.push({
      datensatz: 'ALKIS Liegenschaftskarte (vereinfachtes Modell)',
      dienst: `WFS ${k.flurstuecke.typenameFlurstueck}`,
      url: k.flurstuecke.url,
      abgerufenAm: abgerufen,
      lizenz: k.flurstuecke.lizenz,
      quellenvermerk: k.flurstuecke.quellenvermerk,
      hinweis: nachweisText,
    });
    if (!vollstaendig || abruf.uebersprungen) {
      const text =
        (abruf.soll === null
          ? `Die Flurstuecksebene laesst sich nicht gegenzaehlen: Der Dienst lieferte auf RESULTTYPE=hits keine Zahl. `
          : `Die Flurstuecksebene ist unvollstaendig: ${abruf.geliefert} von ${abruf.soll} Objekten (${abruf.soll - abruf.geliefert} fehlen). `) +
        (abruf.uebersprungen ? `${abruf.uebersprungen} von ${abruf.kacheln} Kacheln gaben nach allen Versuchen keine Antwort. ` : '') +
        `Jede Aussage der Form »liegt auf Flurstueck X« ist damit fuer den fehlenden Teil stumm. ` +
        `Ein erneuter Lauf holt in der Regel nach, was der Dienst beim ersten Mal nicht hergab.`;
      datenluecken.push({ elementart: 'flurstueck', bezeichnung: 'Flurstuecke (ALKIS)', art: 'unter_erwartung', text, orte: [] });
    }
    melde(a, 'Flurstuecke geladen', 0.98, nachweisText);
  } catch (e) {
    melde(a, 'Flurstuecke', 0.98, `ALKIS nicht erreichbar: ${(e as Error).message} — Gelaende wird ohne Flurstuecke gespeichert.`);
  }

  // --- 4b. Bodenzeichnung: tatsaechliche Nutzung (ALKIS) + Wegenetz (OSM) ---
  // Das ist die Grundlage des massgetreuen digitalen Abbilds: Fahrbahn,
  // Gehweg, Radweg, Fussgaengerzone, Platz und Gruen als eigene Flaechen.
  let flaechen: GelaendeFlaeche[] = [];
  melde(a, 'Tatsaechliche Nutzung wird geladen', 0.985);
  try {
    const { nutzungsflaechen, NUTZUNG_QUELLE, nutzungLuecken } = await import('./nutzung.ts');
    const alkisFlaechen = await nutzungsflaechen(a.bbox, a.land);
    /*
     * AUSGEFALLENE TEILGEBIETE DER BODENZEICHNUNG GEHOEREN INS ERGEBNIS.
     *
     * Der Abruf holt die tatsaechliche Nutzung in Teilkacheln. Faellt eine
     * davon aus, fehlt ein Stueck Bodenzeichnung — beim Stadtlauf am
     * 11.08.2026 waren es drei Teilkacheln in Kachel 14. Bisher stand das nur
     * in der Serverkonsole: Wer die fertige Kachel oeffnet, sieht dort eine
     * Flaeche ohne Nutzungsangabe und haelt sie fuer unbebautes Land.
     *
     * Mit Ortsangabe, damit man im Plan hinspringen kann statt zu suchen.
     */
    if (nutzungLuecken.length) {
      const orte = nutzungLuecken.map((b) => [(b.minE + b.maxE) / 2, (b.minN + b.maxN) / 2] as Punkt);
      const m2 = nutzungLuecken.reduce((s, b) => s + (b.maxE - b.minE) * (b.maxN - b.minN), 0);
      datenluecken.push({
        elementart: 'nutzungsflaeche',
        bezeichnung: 'ALKIS Tatsaechliche Nutzung',
        art: 'kataster_deckt_nicht',
        text:
          `${nutzungLuecken.length} Teilgebiet(e) mit zusammen ${(m2 / 10_000).toFixed(1)} ha konnten beim ` +
          `Landesdienst nicht abgerufen werden. Dort fehlt die amtliche Bodenzeichnung vollstaendig — die Flaeche ` +
          `ist NICHT unbebaut, sondern unbekannt. Erneuter Import holt sie nach, sobald der Dienst antwortet.`,
        orte,
      });
      melde(a, 'Bodenzeichnung unvollstaendig', 0.985, `${nutzungLuecken.length} Teilgebiet(e) ohne ALKIS-Nutzung (${(m2 / 10_000).toFixed(1)} ha).`);
    }
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
  const rohFlaechen = flaechen;
  const boden = bodenAufbauen(flaechen);
  flaechen = amGebietSchneiden(boden.flaechen, a.bbox);
  const stufen = stufenzahlenUebertragen(rohFlaechen, flaechen);
  if (stufen.uebernommen || stufen.mehrdeutig) {
    melde(
      a,
      'Treppen',
      0.9935,
      `${stufen.uebernommen} Treppenflaechen mit gezaehlter Stufenzahl aus OpenStreetMap (step_count) — sie geht jeder Ableitung vor` +
        `${stufen.mehrdeutig ? `; ${stufen.mehrdeutig} Flaechen mit widerspruechlichen Zaehlungen bleiben ohne Beleg` : ''}.`,
    );
  }

  // Gewaesser einebnen — erst hier moeglich, weil vorher nicht bekannt ist, wo
  // Wasser liegt. Das Raster ist die eine Oberflaeche, also wird es korrigiert
  // und nicht die Zeichnung (Begruendung bei wasserEinebnen).
  const wasser = wasserEinebnen(raster, flaechen, bauwerk.wasserMasse()?.wasser);
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
        `${wasser.mitSohle ? `, davon ${wasser.mitSohle} mit einer SOHLE (tiefste Stelle ${wasser.tiefsteM.toFixed(2)} m unter dem Spiegel; die Tiefe ist eine ANNAHME der Bauklassen, keine Messung)` : ''}` +
        `${wasser.verworfen ? `, ${wasser.verworfen} verworfen (Ufer zu steil fuer eine Spiegelebene)` : ''}.`,
    );
  }

  melde(
    a,
    'Boden aufgebaut',
    0.994,
    `${vorher} Rohflaechen -> ${flaechen.length} lueckenlose Flaechen: ` +
      `${boden.bericht.basis} amtlich, ${boden.bericht.verfeinert} durch OSM verfeinert` +
      `${boden.bericht.mitHoehenband ? `, ${boden.bericht.mitHoehenband} mit eigenem Hoehenband (Bruecke/Tunnel/Rampe) aus der Aufteilung herausgehalten` : ''}` +
      `${boden.bericht.verworfen ? `, ${boden.bericht.verworfen} OSM-Flaechen ohne zulaessige Wirtsklasse verworfen` : ''}` +
      `${boden.bericht.abzuegeGescheitert ? `. ACHTUNG: ${boden.bericht.abzuegeGescheitert} Abzuege sind gescheitert — dort zeichnen zwei Klassen uebereinander` : ''}` +
      ` (${((Date.now() - t0) / 1000).toFixed(1)} s).`,
  );

  // --- 4a2. HOEHENBAND: Rampen, Unterfuehrungen, Bruecken -------------------
  // Muss VOR den Kanten laufen: die Trogwaende einer Rampe sind Bruchkanten,
  // und das abgesenkte Raster ist die Grundlage jeder weiteren Hoehenfrage.
  let hoehenbandLinien: GelaendeLinienObjekt[] = [];
  let hoehenbandKanten: Bruchkante[] = [];
  try {
    const { rampenAbsenken, brueckenEinmessen } = await import('./hoehenband.ts');
    const vertikal = bauwerk.vertikalMasse();
    const r = rampenAbsenken(flaechen, raster, vertikal);
    hoehenbandLinien = r.linien;
    hoehenbandKanten = r.kanten;
    brueckenEinmessen(flaechen, (e, n) => raster.hoeheOder(e, n, rasterStat.mittel), vertikal, r.bericht);
    const b = r.bericht;
    // DER TROG BEKOMMT SEIN LOCH. Ohne diesen Schnitt saecken die Flaechen
    // ueber dem Aushub mit hinein (Begruendung bei troegeAusschneiden).
    let trogSchnitt = { beschnitten: 0, flaecheM2: 0, rampenGekuerzt: 0, rampenGanzUnterTage: 0 };
    if (r.troege.length) {
      const t = troegeAusschneiden(flaechen, r.troege, r.sohlen);
      flaechen = t.flaechen;
      trogSchnitt = t;
    }
    for (const text of b.luecken) {
      datenluecken.push({ elementart: 'tunnel', bezeichnung: 'Unterirdischer Strang', art: 'unter_erwartung', text, orte: [] });
    }
    if (b.rampen || b.bruecken) {
      melde(
        a,
        'Hoehenband',
        0.9942,
        `${b.straenge} unterirdische Straenge aus ${b.groessterStrang > 1 ? `bis zu ${b.groessterStrang} Polygonstuecken ` : ''}gebildet; ` +
          `${b.rampen} davon abgesenkt (${Math.round(b.rampenLaengeM)} m Strang, davon ${Math.round(b.trogFlaecheM2).toLocaleString('de-DE')} m² OFFENER TROG ausgehoben, ` +
          `tiefste ${b.tiefsteM.toFixed(2)} m, ${b.mitIncline} mit gemessener Neigung aus OSM, ` +
          `${b.rasterZellen.toLocaleString('de-DE')} Rasterzellen eingeschnitten), ${b.portale} Portale` +
          `${trogSchnitt.beschnitten ? `; ${trogSchnitt.flaecheM2.toLocaleString('de-DE')} m² Trog aus ${trogSchnitt.beschnitten} Bodenflaechen ausgeschnitten` : ''}` +
          `${trogSchnitt.rampenGekuerzt || trogSchnitt.rampenGanzUnterTage ? `; die Rampenfahrbahn endet am Portal (${trogSchnitt.rampenGekuerzt} Stuecke auf den offenen Trog gekuerzt, ${trogSchnitt.rampenGanzUnterTage} lagen ganz unter der Decke und sind nicht mehr im Modell)` : ''}` +
          `${b.ohneAnschluss ? `; ${b.ohneAnschluss} Straenge ohne Anschluss an die Oberflaeche blieben unberuehrt` : ''}` +
          `${b.alsDurchfahrt ? `; ${b.alsDurchfahrt} als Tunnel erfasste Wege sind zu flach fuer eine Decke und wurden als Durchfahrt auf Strassenniveau belassen` : ''}. ` +
          `${b.bruecken} Bruecken eingemessen, ${b.brueckenMitLichterHoehe} davon mit lichter Hoehe` +
          `${b.kleinsteLichteHoeheM !== null ? ` (kleinste ${b.kleinsteLichteHoeheM.toFixed(2)} m)` : ''}.` +
          `${b.rampen && !b.mitIncline ? ' ACHTUNG: keine einzige Neigung war belegt — alle Tiefen sind Annahmen.' : ''}`,
      );
      if (b.brueckenOhneMessung) {
        const text =
          `Unter ${b.brueckenOhneMessung} von ${b.bruecken} Bruecken laesst sich keine lichte Hoehe messen: Das Hoehenmodell ` +
          `zeigt dort keine Senke. DGM1 ist ein GELAENDEmodell — Brueckenbauwerke sind darin nicht durchgaengig entfernt, und ` +
          `ein Bauwerk, das im Hoehenmodell als Boden steht, kann nichts ueberspannen. Belastbar waere hier nur eine Angabe ` +
          `aus der Quelle (OpenStreetMap maxheight) oder ein Hoehenmodell mit Bauwerksfreistellung.`;
        datenluecken.push({ elementart: 'bruecke', bezeichnung: 'Bruecke', art: 'unter_erwartung', text, orte: [] });
        melde(a, 'Hoehenband', 0.9943, text);
      }
    } else {
      melde(a, 'Hoehenband', 0.9942, 'Keine Rampen, Unterfuehrungen oder Bruecken im Gebiet gefunden.');
    }
  } catch (e) {
    melde(a, 'Hoehenband', 0.9942, `Hoehenband nicht gebildet: ${(e as Error).message} — Rampen und Bruecken bleiben auf Gelaendehoehe.`);
  }

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
    bruchkanten = [...k.kanten, ...hoehenbandKanten];
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
    const d = await stadtdetails(a.bbox, { userAgent: k.geokodierung.userAgent, ohneMoebel: opts.ohneMoebel });
    punkte = d.punkte;
    linien = d.linien;
    if (d.zusatzflaechen?.length) flaechen.push(...d.zusatzflaechen);

    // --- Amtliches Baumkataster (falls im Cache vorhanden) ----------------
    // Gemessene Baeume der Stadt schlagen die OSM-Einzelpunkte; OSM ergaenzt
    // nur noch, was das Kataster nicht kennt (Privatgrund, Umland).
    try {
      const { katasterBaeume, katasterGebiet, mischeBaeume, KATASTER_QUELLE } = await import('./baumkataster.ts');
      const { katasterAbdeckung } = await import('./elementquellen.ts');
      // GEBIETSANGABE DES EXTRAKTS: Ein Katasterauszug ist ein Ausschnitt.
      // Deckt er das bestellte Gebiet nicht, wird das GEMELDET — genau das
      // fehlte, als das Gebiet auf den Grossen Woog erweitert wurde.
      const gebiet = katasterGebiet();
      const luecke = katasterAbdeckung(a.bbox, gebiet, KATASTER_QUELLE.datensatz);
      if (luecke) {
        datenluecken.push(luecke);
        melde(a, 'Baumkataster', 0.9965, luecke.text);
      }
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
        hinweis:
          `${baeume} Baeume, ${gleise} Gleise, ${halte} Haltestellen, ${linien.length - gleise} Mauern/Zaeune/Hecken/Bordsteine, ` +
          // NICHT VERSCHWEIGEN, WAS NICHT ERHOBEN WURDE: Ohne diesen Satz saehe
          // ein Stadtmodell ohne Baenke aus wie eine Stadt ohne Baenke, statt
          // wie ein Modell, in dem sie bewusst nicht erhoben wurden.
          (opts.ohneMoebel
            ? 'Strassenmoebel (Baenke, Laternen, Papierkoerbe, Brunnen, Fahrradstaender) auf Anweisung NICHT erhoben.'
            : `${punkte.length - baeume - halte} Strassenmoebel.`),
      });
    }
    // --- Rillenschiene erkennen ------------------------------------------
    // OSM fuehrt fuer die Darmstaedter Strecke weder `embedded` noch `surface`.
    // Eine Tag-Heuristik meldete darum 73 von 73 Gleisen als eigenen
    // Bahnkoerper und setzte ueberall Schwellen — die Strecke sah aus wie eine
    // Eisenbahntrasse statt wie eine Strassenbahn. Die Frage laesst sich aber
    // GEOMETRISCH beantworten: liegt die Gleisachse im Strassenraum, ist es
    // eine Rillenschiene im Pflaster.
    // STABIL SEIT 10.08.2026 — vorher schwankte der Wert von Import zu Import
    // (73/73, dann 68/73, dann 68/72). Zwei Ursachen, beide behoben:
    //
    //  1. Die Abtastung haing an der Laenge des OSM-Stuecks (`gesamt / 20`).
    //     Ein 3,6-m-Stueck bekam denselben Stimmzettel wie ein 400-m-Strang,
    //     und ein einziger Punkt entschied. Jetzt wird in FESTEN 2-m-Schritten
    //     abgetastet: jeder Meter Gleis zaehlt gleich viel.
    //  2. Entschieden wurde je OSM-STUECK. OpenStreetMap teilt einen Weg bei
    //     jedem Attributwechsel, und der Gebietszuschnitt teilt ihn noch
    //     einmal — dieselbe Strecke zerfiel in verschieden viele Stuecke, und
    //     die Mehrheit kippte. Jetzt wird je STRANG entschieden (Topologie
    //     ueber gemeinsame Knoten, shared/geo/netz.ts) und das Ergebnis auf
    //     alle seine Stuecke geschrieben. Ein Strang ist die Einheit, die es
    //     in der Wirklichkeit gibt; ein OSM-Stueck ist es nicht.
    const verkehrsflaechen = flaechen.filter(
      (f) => f.art === 'fahrbahn' || f.art === 'platz' || f.art === 'fussgaengerzone',
    );
    const imStrassenraum = (p: Punkt) =>
      verkehrsflaechen.some((f) => punktInRing(p, f.polygon) && !(f.loecher ?? []).some((h) => punktInRing(p, h)));
    const gleisLinien = linien.filter((l) => l.art === 'gleis' && l.achse.length >= 2);
    let imPflaster = 0;
    {
      const { straenge } = straengeBilden(gleisLinien.map((l) => ({ punkte: l.achse, quelle: l })));
      const SCHRITT_M = 2;
      for (const strang of straenge) {
        const gesamt = polylinieLaenge(strang.punkte);
        let drin = 0;
        let geprueft = 0;
        for (let s = 0; s <= gesamt; s += SCHRITT_M) {
          geprueft++;
          if (imStrassenraum(aufPolylinie(strang.punkte, s).p)) drin++;
        }
        const anteil = geprueft ? drin / geprueft : 0;
        const eigen = anteil < 0.5;
        for (const q of strang.quellen) q.eigenerBahnkoerper = eigen;
      }
      // Ein Stueck, das in keinen Strang kam (entartete Achse), bleibt bei
      // seiner Tag-Heuristik — aber es wird gezaehlt, damit es auffaellt.
      for (const l of gleisLinien) if (l.eigenerBahnkoerper === false) imPflaster++;
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

      /*
       * KENNT OSM HAEUSER, WO DAS AMTLICHE MODELL KEINE HAT?
       *
       * BEFUND 11.08.2026, Stadtkachel 24 (E474–477 / N5532–5534): 2.923
       * Flurstuecke, 1.675 Nutzungsflaechen, 697 Wege — und 36 Gebaeude.
       * Der Verdacht lag auf einer Luecke in der LoD2-Lieferung; nachgemessen
       * war es das Gegenteil: Die Stadtgrenze endet bei N 5533530, die Kachel
       * reicht 470 m darueber hinaus. Die 2.238 Haeuser, die OSM dort kennt,
       * stehen in Erzhausen und Egelsbach — und das amtliche LoD2 der
       * KREISFREIEN STADT Darmstadt fuehrt sie zu Recht nicht.
       *
       * Richtig ist das trotzdem nur fuer den, der es weiss. Wer die Kachel
       * oeffnet, sieht Strassen und Grundstuecke einer Nachbargemeinde OHNE
       * HAEUSER und haelt das Modell fuer kaputt. Die Kachelgrenzen liegen auf
       * dem Kilometerraster, nicht auf der Gemarkung — dieser Ueberstand ist
       * also Bauart, kein Unfall.
       *
       * Der Vergleich braucht keine Grenzkunde: OSM kennt hier deutlich mehr
       * Haeuser als das amtliche Modell — das ist der Befund, und er wird
       * genannt statt verschwiegen. Umgekehrt ist der Normalfall (LoD2 zerlegt
       * ein Haus in mehrere Baukoerper und hat darum MEHR).
       */
      const osmGebaeude = merkmale.size;
      if (osmGebaeude > 100 && osmGebaeude > gebaeude.length * 1.5) {
        datenluecken.push({
          elementart: 'gebaeude',
          bezeichnung: '3D-Gebaeudemodell LoD2',
          art: 'kataster_deckt_nicht',
          text:
            `OpenStreetMap kennt in diesem Gebiet ${osmGebaeude.toLocaleString('de-DE')} Gebaeude, das amtliche LoD2 liefert ` +
            `${gebaeude.length.toLocaleString('de-DE')} Baukoerper. Die amtliche Lieferung endet an der Kreisgrenze; ` +
            `ragt das Gebiet darueber hinaus, erscheinen dort Strassen und Grundstuecke OHNE Haeuser. ` +
            `Das ist keine Stoerung, sondern die Reichweite der Lieferung — Haeuser der Nachbargemeinde braeuchten deren LoD2-Datei.`,
          orte: [[(a.bbox.minE + a.bbox.maxE) / 2, (a.bbox.minN + a.bbox.maxN) / 2]],
        });
        melde(a, 'Gebaeude ausserhalb der Lieferung', 0.999, `OSM kennt ${osmGebaeude}, LoD2 liefert ${gebaeude.length} — Gebiet ragt ueber die Kreisgrenze hinaus.`);
      }
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

  // --- 4c2. Gelaender an Treppen -------------------------------------------
  // Sie gehoeren ins MODELL, nicht in die Zeichnung: DIN 18040-3 verlangt sie
  // im oeffentlichen Verkehrsraum beidseitig, und die Fluchtwegbeurteilung
  // fragt danach. Gerechnet wird mit derselben Funktion, die im Browser die
  // Stufen baut — gleiche Eingaben, gleiches Ergebnis.
  let gelaenderLinien: GelaendeLinienObjekt[] = [];
  try {
    const tm = bauwerk.treppenMasse();
    if (tm) {
      const g = gelaenderAnTreppen(
        flaechen,
        (e, n) => raster.hoeheOder(e, n, rasterStat.mittel),
        tm.stufe,
        tm.gelaender ? (tm.gelaender.hoeheMinM + tm.gelaender.hoeheMaxM) / 2 : 0.9,
      );
      gelaenderLinien = g.linien;
      const b = g.bericht;
      melde(
        a,
        'Treppen und Gelaender',
        0.9975,
        `${b.flaechen} Treppenflaechen -> ${b.teile} Laufteile (an Podesten geteilt) -> ${b.laeufe} Laeufe mit ${b.stufen} Stufen, ` +
          `${b.mitBeleg} davon mit gezaehlter Stufenzahl. ${b.flach} als Podest/Rampe eingestuft (unter 30 cm Steigung). ` +
          `${g.linien.length} Gelaender abgeleitet (beidseitig, DIN 18040-3 — ANNAHME, nicht erfasst).` +
          `${b.befunde.length ? ` ${b.befunde.length} Befunde: ${b.befunde.slice(0, 3).join(' | ')}${b.befunde.length > 3 ? ' …' : ''}` : ''}`,
      );
    }
  } catch (e) {
    melde(a, 'Gelaender', 0.9975, `Gelaender nicht abgeleitet: ${(e as Error).message}`);
  }

  // --- 4d. Gleiszone aus den Bodenflaechen ausschneiden ---------------------
  // Erst hier moeglich: es braucht die Gleisachsen aus den Stadtdetails UND
  // die Entscheidung, welche Bauart vorliegt (die Breite haengt daran).
  // Begruendung ausfuehrlich bei `gleiszoneAusschneiden`.
  try {
    const vorher = flaechen.length;
    const g = gleiszoneAusschneiden(flaechen, linien);
    flaechen = g.flaechen;
    if (g.bericht.zonen) {
      melde(
        a,
        'Gleiszone ausgeschnitten',
        0.9985,
        `${g.bericht.gleise} Gleisstuecke (${g.bericht.laengeM.toLocaleString('de-DE')} m) -> ${g.bericht.zonen} Gleiszonen ` +
          `mit ${g.bericht.flaecheM2.toLocaleString('de-DE')} m2; ${g.bericht.beschnitten} Bodenflaechen beschnitten ` +
          `(${vorher} -> ${flaechen.length} Flaechen). Das Gleis liegt damit IN der Fahrbahn, nicht darauf.`,
      );
    }
  } catch (e) {
    melde(a, 'Gleiszone', 0.9985, `Gleiszone nicht ausgeschnitten: ${(e as Error).message} — das Gleis liegt weiter als Auflage auf der Fahrbahn.`);
  }

  // --- 4e. ABDECKUNGSPRUEFUNG und ALTBESTAND-MELDUNGEN ---------------------
  // Der Kern der Standardisierung: Es reicht nicht, Daten zu holen — es muss
  // auffallen, WO sie fehlen. Beides landet im Protokoll UND am Gelaende, wo
  // die Oberflaeche es anzeigt.
  try {
    const { abdeckungPruefen, elementQuellenLaden } = await import('./elementquellen.ts');
    const q = elementQuellenLaden();
    const gefunden = abdeckungPruefen(a.bbox, flaechen, punkte, linien, q);
    datenluecken.push(...gefunden);
    for (const l of gefunden) melde(a, 'Datenluecke', 0.9988, `${l.bezeichnung}: ${l.text}`);
    if (!gefunden.length) {
      melde(a, 'Abdeckung geprueft', 0.9988, `Abdeckung aller ${q.elemente.length} Elementarten geprueft — keine Luecke gefunden.`);
    }
  } catch (e) {
    melde(a, 'Abdeckung', 0.9988, `Abdeckung NICHT geprueft: ${(e as Error).message} — ein stiller Ausfall ist damit wieder moeglich.`);
  }
  {
    // ALTBESTAND: `ausAltbestand()` in osm.ts faengt einen gescheiterten
    // Overpass-Abruf mit einem zwischengespeicherten Stand ab. Die Meldungen
    // dazu wurden bisher erzeugt und NIRGENDS angezeigt — am 08.08.2026fielen
    // dadurch 349 Baeume, 238 Barrieren und 117 Zebrastreifen weg, ohne dass
    // es im Protokoll auftauchte. Jetzt stehen sie hier und im Nachweis.
    const { altbestandMeldungen, abrufFehler } = await import('./osm.ts');
    // AUSGEFALLENE ABFRAGEN: Sie liefern gar nichts. Ohne diese Meldung sieht
    // das Ergebnis aus wie ein Gebiet OHNE Strassenmoebel statt wie ein Gebiet
    // OHNE DATEN — der teuerste aller stillen Ausfaelle.
    for (const m of abrufFehler) {
      melde(a, 'Abruf ausgefallen', 0.9989, m);
      datenluecken.push({
        elementart: 'osm',
        bezeichnung: 'OpenStreetMap-Abruf ausgefallen',
        art: 'altbestand',
        text: m,
        orte: [],
      });
    }
    if (abrufFehler.length) {
      nachweise.push({
        datensatz: 'OpenStreetMap — TEILABFRAGEN AUSGEFALLEN',
        dienst: 'Overpass API',
        url: 'https://overpass-api.de/api/interpreter',
        abgerufenAm: abgerufen,
        lizenz: 'Open Database License (ODbL) 1.0',
        quellenvermerk: '(c) OpenStreetMap-Mitwirkende',
        hinweis: `Diese Objektarten fehlen im Gelaende: ${abrufFehler.join(' | ')}`,
      });
      /*
       * TRAGENDE EBENEN: BEI AUSFALL WIRD NICHT FERTIGGEBAUT.
       *
       * BEFUND 11.08.2026, im Kontrolllauf der Stadtkachel 2: Overpass war auf
       * TCP-Ebene nicht erreichbar (beide oeffentlichen Instanzen; der
       * Landesdienst antwortete gleichzeitig in 0,27 s). Alle sechs
       * OSM-Ebenen fielen aus — und der Import LIEF WEITER. Er haette ein
       * Gelaende fertiggestellt, das aussieht wie fertig und in Wahrheit nur
       * ALKIS und LoD2 enthaelt: keine Gehwege, keine Radwege, keine
       * Fussgaengerzonen, keine Baeume. Bei einem Stadtlauf ueber 26 Kacheln
       * waeren einzelne Kacheln stumm aermer als ihre Nachbarn — und man saehe
       * es erst im fertigen Bild.
       *
       * Ein Hinweis im Nachweis reicht dafuer nicht. Wer ein Gelaende oeffnet,
       * liest keinen Quellennachweis; er sieht eine Stadt.
       *
       * UNTERSCHIEDEN WIRD SORGFAELTIG: Es geht um AUSGEFALLENE Abfragen, nicht
       * um leere Antworten. Ein Gebiet ohne Baeume ist ein Befund; ein Gebiet,
       * dessen Baumabfrage nie ankam, ist keiner. Und es geht nur um die
       * Ebenen, die das Abbild TRAGEN — Wege und Flaechen. Faellt die
       * Haltestellenabfrage aus, bleibt das eine Datenluecke.
       */
      const tragend = abrufFehler.filter((m) => /^(wege|flaechen)\b/i.test(m));
      abrufFehler.length = 0;
      if (tragend.length) {
        throw new Error(
          `Tragende Ebenen fehlen vollstaendig: ${tragend.map((m) => m.split(':')[0]).join(', ')}. ` +
            `Das Gelaende wird NICHT gespeichert — ein Abbild ohne Wegenetz saehe fertig aus und waere es nicht. ` +
            `Ursache laut Abruf: ${tragend[0].slice(0, 160)} ` +
            `Wenn Overpass wieder erreichbar ist, denselben Auftrag erneut starten; die bereits geholten Ebenen liegen im Zwischenspeicher.`,
        );
      }
    }

    /*
     * EINE ANTWORT OHNE WEGE IST KEINE ANTWORT.
     *
     * Der Wachposten darueber faengt nur AUSGEFALLENE Abfragen. Am 11.08.2026
     * kam die andere Haelfte ans Licht: overpass.osm.ch antwortete mit HTTP 200
     * in 0,2 s — und lieferte fuer einen Quadratkilometer Darmstadt NULL
     * Gebaeude, weil die Instanz nur einen Schweiz-Auszug fuehrt. Fuer Bern
     * lieferte dieselbe Abfrage 1.675. Technisch einwandfrei, inhaltlich leer:
     * der Import haette das als Befund genommen und eine Stadt ohne Strassen
     * gespeichert.
     *
     * Die Probe braucht keine Quellenkunde, nur eine Tatsache ueber Darmstadt:
     * Jeder Quadratkilometer im Stadtgebiet hat Wege — auch der Wald hat
     * Forstwege. Ein Gebiet dieser Groesse mit NULL Wegflaechen gibt es nicht;
     * wer das liefert, hat die Gegend nicht.
     *
     * BEWUSST NUR BEI NULL: Ein niedriger Wert kann echt sein (ein Kachelrand,
     * der fast nur Feld ist). Null ueber Hunderte Hektar kann es nicht. Die
     * Schwelle ist damit die einzige, die keine Annahme ueber die Gegend
     * enthaelt.
     */
    const gebietKm2 = bboxFlaeche(a.bbox) / 1_000_000;
    const wegflaechen = flaechen.filter((f) => f.quelle === 'osm').length;
    if (gebietKm2 >= 0.25 && wegflaechen === 0) {
      throw new Error(
        `Das Wegenetz kam LEER zurueck: 0 OSM-Wegflaechen auf ${gebietKm2.toFixed(2)} km2. ` +
          `Die Abfrage ist nicht gescheitert, sie hat nichts gefunden — das gibt es in einem Stadtgebiet nicht. ` +
          `Wahrscheinlichste Ursache: Die befragte Quelle deckt dieses Gebiet gar nicht ab (so geschehen mit einer ` +
          `Overpass-Instanz, die nur einen Schweiz-Auszug fuehrt). Das Gelaende wird NICHT gespeichert.`,
      );
    }
    for (const m of altbestandMeldungen) {
      melde(a, 'Altbestand benutzt', 0.9989, m);
      datenluecken.push({
        elementart: 'osm',
        bezeichnung: 'OpenStreetMap-Abruf',
        art: 'altbestand',
        text: m,
        orte: [],
      });
    }
    if (altbestandMeldungen.length) {
      nachweise.push({
        datensatz: 'OpenStreetMap — ZWISCHENGESPEICHERTER STAND benutzt',
        dienst: 'Overpass API (Abruf gescheitert)',
        url: 'https://overpass-api.de/api/interpreter',
        abgerufenAm: abgerufen,
        lizenz: 'Open Database License (ODbL) 1.0',
        quellenvermerk: '(c) OpenStreetMap-Mitwirkende',
        hinweis: altbestandMeldungen.join(' | '),
      });
      altbestandMeldungen.length = 0; // fuer den naechsten Auftrag zuruecksetzen
    }
  }

  /*
   * WELCHE OVERPASS-INSTANZ HAT GELIEFERT?
   *
   * Alle OSM-Nachweise tragen die Adresse aus OSM_QUELLE — overpass-api.de.
   * Seit dem Ausfall vom 11.08.2026 fragt der Import aber der Reihe nach
   * mehrere Instanzen, und die Antwort kann von einer anderen kommen. Bliebe
   * die Adresse stehen, stuende im Nachweis ein Dienst, der bei diesem Abruf
   * gar nicht geantwortet hat.
   *
   * Die DATEN sind dieselben (ODbL, dieselbe OSM-Datenbank), der STAND kann
   * sich zwischen den Instanzen aber um Stunden unterscheiden — genau darum
   * gehoert die benutzte Adresse ins Ergebnis und nicht in eine Fussnote.
   */
  const { overpassBenutzt } = await import('./osm.ts');
  const { auszugStand } = await import('./osm-auszug.ts');
  const overpassImNachweis = (liste: Quellennachweis[]): Quellennachweis[] => {
    /*
     * KAM ES AUS DEM ORTSAUSZUG, MUSS DAS DA STEHEN — mit dem STAND.
     *
     * Das ist der ehrlichere Nachweis von beiden: Ein Auszug hat ein Datum,
     * das man nachschlagen und wiederherstellen kann. „Overpass API, abgerufen
     * am …" sagt dagegen nur, wann gefragt wurde, nicht welchen Stand die
     * Antwort hatte — dieselbe Abfrage liefert morgen etwas anderes.
     */
    const auszug = auszugStand();
    if (auszug) {
      return liste.map((q) =>
        q.dienst === 'Overpass API'
          ? {
              ...q,
              dienst: 'Geofabrik-Ortsauszug (OSM)',
              url: 'https://download.geofabrik.de/europe/germany/hessen.html',
              hinweis: `${q.hinweis ?? ''} Aus dem Ortsauszug ${auszug.datei.replace(/\\/g, '/')}, Datenstand ${auszug.stand.toLocaleString('de-DE')}.`.trim(),
            }
          : q,
      );
    }
    const benutzt = [...overpassBenutzt];
    // ZURUECKSETZEN: Der Stadtlauf fuehrt 26 Importe im SELBEN Prozess aus.
    // Ohne dies truege Kachel 26 die Instanzen aus Kachel 1 im Nachweis — eine
    // Behauptung ueber einen Abruf, den es dort nie gab.
    overpassBenutzt.clear();
    if (!benutzt.length) return liste;
    const hinweis = benutzt.length === 1 ? '' : ` Abgerufen ueber ${benutzt.length} Instanzen: ${benutzt.join(', ')}.`;
    return liste.map((q) =>
      q.dienst === 'Overpass API' ? { ...q, url: benutzt[0], hinweis: `${q.hinweis ?? ''}${hinweis}`.trim() || undefined } : q,
    );
  };

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
    linien: linienAmGebietSchneiden([...linien, ...markierungen, ...hoehenbandLinien, ...gelaenderLinien], a.bbox),
    stufenmass: bauwerk.treppenMasse()?.stufe,
    datenluecken: datenluecken.length ? datenluecken : undefined,
    beschriftungen: beschriftungen.length ? beschriftungen : undefined,
    flurstuecke,
    quellennachweis: overpassImNachweis(nachweise),
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
