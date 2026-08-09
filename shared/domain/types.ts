/**
 * EventPlan3D — Domaenenmodell (Kap. 7 Lastenheft).
 *
 * EISERNE REGEL: Alle Geometrien werden intern in ETRS89 / UTM Zone 32N
 * (EPSG:25832) in METERN gefuehrt. WGS84 gibt es ausschliesslich fuer die
 * Anzeige und wird bei Bedarf umgerechnet (shared/geo/proj.ts).
 *
 * Diese Datei wird von Server (Node, Type-Stripping) UND Web (Vite) genutzt.
 * Darum: keine enums, keine Decorators, keine parameter properties.
 */

// ---------------------------------------------------------------------------
// Basisgeometrie (immer EPSG:25832, Einheit Meter)
// ---------------------------------------------------------------------------

/** [Rechtswert E, Hochwert N] in Metern (EPSG:25832). */
export type Punkt = [number, number];

/** Geschlossener Ring; erster Punkt wird NICHT wiederholt. */
export type Ring = Punkt[];

/** Polygon: [Aussenring, ...Loecher]. */
export type Polygon = Ring[];

export interface BBox {
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
}

/** [lon, lat] in Grad (WGS84) — nur fuer Anzeige/Austausch. */
export type LonLat = [number, number];

// ---------------------------------------------------------------------------
// Organisationen, Nutzer, Rollen (Kap. 4)
// ---------------------------------------------------------------------------

export type OrgTyp =
  | 'plattform'
  | 'veranstalter'
  | 'betreiber'
  | 'behoerde_ordnungsamt'
  | 'behoerde_feuerwehr'
  | 'polizei';

export const ORG_TYPEN: OrgTyp[] = [
  'plattform',
  'veranstalter',
  'betreiber',
  'behoerde_ordnungsamt',
  'behoerde_feuerwehr',
  'polizei',
];

export const ORG_TYP_LABEL: Record<OrgTyp, string> = {
  plattform: 'Plattform-Betreiber',
  veranstalter: 'Veranstalter',
  betreiber: 'Standbetreiber / Schaustellerbetrieb',
  behoerde_ordnungsamt: 'Behoerde: Ordnungsamt',
  behoerde_feuerwehr: 'Behoerde: Feuerwehr',
  polizei: 'Polizei',
};

export interface Organisation {
  id: string;
  name: string;
  typ: OrgTyp;
  adresse?: string;
  /** Nur fuer Polizei/Behoerden: Gebiet, fuer das automatischer Lesezugriff gilt. */
  zustaendigkeitsgebiet?: string;
  erstelltAm: string;
}

/** Projektrolle eines Nutzers. Leitet sich aus Org-Typ + Einladung ab. */
export type Rolle =
  | 'plattform_admin'
  | 'veranstalter'
  | 'standbetreiber'
  | 'ordnungsamt'
  | 'feuerwehr'
  | 'polizei'
  | 'gast';

export const ROLLE_LABEL: Record<Rolle, string> = {
  plattform_admin: 'Plattform-Admin',
  veranstalter: 'Veranstalter',
  standbetreiber: 'Standbetreiber',
  ordnungsamt: 'Ordnungsamt',
  feuerwehr: 'Feuerwehr',
  polizei: 'Polizei',
  gast: 'Gast / Beobachter',
};

export interface Nutzer {
  id: string;
  orgId: string;
  name: string;
  email: string;
  /** scrypt: <salt-hex>:<hash-hex> */
  passwortHash: string;
  rolleInOrg: 'admin' | 'mitglied';
  erstelltAm: string;
  letzterBesuch?: string;
}

/** Nutzer ohne Geheimnisse — das geht ans Frontend. */
export interface NutzerOeffentlich {
  id: string;
  orgId: string;
  orgName: string;
  orgTyp: OrgTyp;
  name: string;
  email: string;
  rolleInOrg: 'admin' | 'mitglied';
}

export interface Mitgliedschaft {
  projektId: string;
  orgId: string;
  rolle: Rolle;
  /** true = automatisch (Polizei/Behoerde), nicht per Einladung. */
  automatisch: boolean;
  eingeladenVon?: string;
  eingeladenAm: string;
}

// ---------------------------------------------------------------------------
// Gelaende (F1) — digitaler Zwilling des Platzes
// ---------------------------------------------------------------------------

export interface Quellennachweis {
  datensatz: string;
  dienst: string;
  url: string;
  abgerufenAm: string;
  lizenz: string;
  quellenvermerk: string;
  hinweis?: string;
}

/** Eine Flaeche des amtlichen LoD2-Modells: [E, N, H] je Stuetzpunkt. */
export type Flaeche3D = [number, number, number][];

export interface GelaendeGebaeude {
  id: string;
  /** Grundriss in EPSG:25832. */
  grundriss: Ring;
  /** Gelaendehoehe am Gebaeudefuss (m ue. NHN). */
  bodenHoehe: number;
  /** Absolute Traufhoehe (m ue. NHN), falls bekannt. */
  traufHoehe?: number;
  /** Absolute Firsthoehe (m ue. NHN), falls bekannt. */
  firstHoehe?: number;
  dachform?: string;
  funktion?: string;
  quelle: 'lod2' | 'alkis' | 'manuell';
  /**
   * ECHTE Dachflaechen aus dem amtlichen LoD2-Modell. Ohne sie wird ein
   * Gebaeude als Quader mit flachem Deckel gezeichnet — mit ihnen bekommt es
   * seine wirkliche Dachform (Sattel, Walm, Pult, Zelt).
   */
  dachflaechen?: Flaeche3D[];
  /** Wandflaechen aus dem LoD2-Modell (Giebel sind dadurch korrekt geschlossen). */
  wandflaechen?: Flaeche3D[];
  /**
   * Farben aus OpenStreetMap, wo sie dort gepflegt sind (roof:colour,
   * building:colour). Sie machen den Unterschied zwischen einer Ansammlung
   * gleicher Kloetze und einer wiedererkennbaren Stadt — ein rotes Ziegeldach
   * neben einem grauen Schieferdach.
   */
  dachFarbe?: string;
  wandFarbe?: string;
  /** Dachform aus OSM (roof:shape), falls dort gepflegt. */
  dachformOsm?: string;
  /** Name des Gebaeudes aus OSM (Schloss, Museum …). */
  name?: string;
  /**
   * Geschosszahl aus OSM (`building:levels`), wo dort gepflegt — im
   * Pilotgebiet 636 Gebaeude. Grundlage der Fassadengliederung; wo sie fehlt,
   * wird aus der Trauf-Hoehe geschaetzt und das auch so gekennzeichnet.
   */
  geschosse?: number;
}

/**
 * Nutzungsflaeche des Gelaendes (ALKIS „tatsaechliche Nutzung" bzw. OSM).
 * Sie traegt die Bodenzeichnung: Fahrbahn, Gehweg, Radweg, Platz, Gruen, Wasser.
 * Damit entsteht ein massgetreues digitales Abbild statt eines Luftbildes.
 */
export type FlaechenArt =
  | 'fahrbahn'
  | 'gehweg'
  | 'radweg'
  | 'fussgaengerzone'
  | 'platz'
  | 'weg'
  | 'treppe'
  | 'gruen'
  | 'wald'
  | 'wasser'
  | 'bahn'
  | 'bebauung'
  | 'landwirtschaft'
  | 'sonstige';

export const FLAECHEN_ART_LABEL: Record<FlaechenArt, string> = {
  fahrbahn: 'Fahrbahn',
  gehweg: 'Gehweg',
  radweg: 'Radweg',
  fussgaengerzone: 'Fussgaengerzone',
  platz: 'Platz',
  weg: 'Weg',
  treppe: 'Treppe',
  gruen: 'Gruenflaeche',
  wald: 'Wald',
  wasser: 'Wasser',
  bahn: 'Bahnflaeche',
  bebauung: 'Bebaute Flaeche',
  landwirtschaft: 'Landwirtschaft',
  sonstige: 'Sonstige Flaeche',
};

export interface GelaendeFlaeche {
  id: string;
  art: FlaechenArt;
  polygon: Ring;
  /** Loecher im Polygon (z. B. Innenhoefe). */
  loecher?: Ring[];
  quelle: 'alkis' | 'osm';
  /** Amtliche bzw. OSM-Bezeichnung, unveraendert uebernommen. */
  bezeichnung?: string;
  /** Zeichenreihenfolge: hoehere Werte liegen oben. */
  rang: number;
  /**
   * Oberflaechenart (OSM `surface`): asphalt, paving_stones, cobblestone,
   * sett, gravel, grass … Sie steuert den Farbton innerhalb einer Klasse und
   * gibt Plaetzen ihre Textur — ein Kopfsteinpflaster-Platz sieht anders aus
   * als eine Asphaltflaeche.
   */
  belag?: string;
  /**
   * Wegachse(n) im Gebiet (nur OSM-Fahrbahnkorridore): die Linie, aus der der
   * Korridor gepuffert wurde. Grundlage fuer Fahrbahnmarkierungen
   * (Leitlinie, Spurtrennstriche) — ohne Achse keine Markierung.
   */
  achsen?: Ring[];
  /** Korridorbreite in Metern (Messung > lanes-Ableitung > Klassenannahme). */
  breiteM?: number;
  /** Spurenzahl aus OSM `lanes` — nur wenn getaggt, geraten wird nichts. */
  spuren?: number;
  /** true = Einbahnstrasse (`oneway`). */
  einbahn?: boolean;
  /** OSM-Strassenklasse (`highway`-Wert) — traegt u. a. die Leitlinien-Konvention. */
  strassenklasse?: string;
  /**
   * Nur ruhende Gewaesser: die Hoehe des Wasserspiegels in m ue. NHN, bestimmt
   * aus dem Ufer beim Import (wasserEinebnen). Damit wird die Wasserflaeche als
   * EBENE gezeichnet statt aus den Uferhoehen interpoliert — sonst sackt sie
   * zwischen zwei Ufern durch und das Gelaende sticht als heller Zacken hervor
   * (Befund am Grossen Woog, 09.08.2026).
   */
  wasserspiegelM?: number;
  /**
   * KONSTRUKTIONSHOEHE: Oberkante ueber der Bezugsflaeche des Strassenraums
   * (Fahrbahn = 0,00 m), in Metern. Beim Import aus der Bauklasse aufgeloest
   * (config/bauklassen/*.json) — NICHT im Programmtext festgelegt.
   *
   * Sie ersetzt den Millimeter-Stapel: bis zum 09.08.2026 lagen alle
   * Bodenflaechen praktisch auf derselben Hoehe und wurden nur in 2-mm-Stufen
   * je Rang auseinandergehalten, damit sie nicht flimmern. Ein Gehweg
   * unterschied sich von der Fahrbahn dadurch in der FARBE, nicht in der Hoehe.
   */
  konstruktionM?: number;
}

/** Was an einer Hoehenstufe zwischen zwei Flaechen wirklich steht. */
export type KantenBauart = 'fuge' | 'bordstein' | 'boeschung' | 'stuetzmauer' | 'bauwerk';

/**
 * BRUCHKANTE — eine Linie, an der die Oberflaeche knickt oder springt.
 *
 * WARUM SIE EIN EIGENER TYP IST: Ein Hoehenraster fuehrt an einer Stelle genau
 * EINEN Wert. Eine Bordsteinkante hat dort aber zwei — oben 12 cm hoeher als
 * unten, auf null Abstand. Auch ein 10-cm-Raster bildete sie nur als steile
 * Rampe ab. Deshalb arbeitet die Vermessung mit Dreiecksnetzen samt
 * Zwangskanten, und deshalb gibt es diesen Typ.
 *
 * WOHER SIE KOMMT: Sie wird NICHT eingegeben, sondern aus den
 * Konstruktionshoehen zweier aneinandergrenzender Flaechen ABGELEITET. Genau
 * darum bekommt jede Strassenkante des Gebiets ihre Kante und nicht nur die
 * 556 m, die OpenStreetMap zufaellig als `barrier=kerb` fuehrt (nachgemessen
 * 09.08.2026).
 *
 * VEREINBARUNG: Die HOEHER liegende Flaeche liegt immer LINKS der
 * Laufrichtung. Damit braucht es kein zusaetzliches Merkmal fuer die Seite.
 */
export interface Bruchkante {
  id: string;
  art: 'knick' | 'sprung';
  bauart: KantenBauart;
  /** Achse in EPSG:25832. */
  linie: Punkt[];
  /** Absolute Oberkante je Stuetzpunkt (m ue. NHN). */
  hoehenOben: number[];
  /** Absolute Unterkante je Stuetzpunkt (m ue. NHN). */
  hoehenUnten: number[];
  /** Woher die Kante stammt — Nachweispflicht wie bei jeder anderen Angabe. */
  herkunft: 'bauklasse' | 'alkis' | 'osm' | 'gemessen';
  /** Welche Flaechenarten hier aneinanderstossen („Gehweg an Fahrbahn"). */
  bezeichnung?: string;
}

// ---------------------------------------------------------------------------
// Stadtdetails: Was einen Ort wiedererkennbar macht
// ---------------------------------------------------------------------------

/** Punktfoermige Elemente des Stadtraums. */
export type PunktArt =
  | 'baum'
  | 'strauch'
  | 'laterne'
  | 'bank'
  | 'brunnen'
  | 'trinkwasser'
  | 'poller'
  | 'haltestelle'
  | 'papierkorb'
  | 'fahrradstaender'
  | 'ampel'
  | 'verkehrszeichen';

export const PUNKT_ART_LABEL: Record<PunktArt, string> = {
  baum: 'Baum',
  strauch: 'Strauch',
  ampel: 'Lichtsignalanlage',
  verkehrszeichen: 'Verkehrszeichen',
  laterne: 'Strassenlaterne',
  bank: 'Sitzbank',
  brunnen: 'Brunnen',
  trinkwasser: 'Trinkwasser',
  poller: 'Poller',
  haltestelle: 'Haltestelle',
  papierkorb: 'Abfallbehaelter',
  fahrradstaender: 'Fahrradstaender',
};

export interface GelaendePunktObjekt {
  id: string;
  art: PunktArt;
  pos: Punkt;
  /** Hoehe in Metern — bei Baeumen gemessen, wo OSM sie fuehrt, sonst geschaetzt. */
  hoeheM?: number;
  /** Kronendurchmesser in Metern (nur Baeume). */
  kroneM?: number;
  laubart?: 'laubbaum' | 'nadelbaum' | 'immergruen';
  name?: string;
  /** Ausrichtung in Grad, wo sie bekannt ist (Baenke, Haltestellen). */
  drehungGrad?: number;
  /**
   * Amtliche Zeichennummer nach StVO, wie OSM sie fuehrt (`traffic_sign`),
   * z. B. „DE:206" fuer Halt. Vorfahrt gewaehren. Nur bei Verkehrszeichen;
   * fehlt sie, ist die Art aus dem Wegeknoten abgeleitet (stop/give_way).
   */
  zeichen?: string;
  /** true = Mass stammt aus OSM, false = Klassenannahme. Nachweispflicht. */
  gemessen?: boolean;
}

/** Linienfoermige Elemente mit Hoehe: Gleise, Mauern, Zaeune, Hecken, Bordsteine. */
export type LinienArt =
  | 'gleis'
  | 'mauer'
  | 'zaun'
  | 'hecke'
  | 'bordstein'
  | 'gelaender'
  | 'stadtmauer'
  /** Aufgemalte Fahrbahnmarkierung (Mittellinie, Leitlinie) — flach, kein Koerper. */
  | 'markierung';

export const LINIEN_ART_LABEL: Record<LinienArt, string> = {
  gleis: 'Gleis',
  mauer: 'Mauer',
  zaun: 'Zaun',
  hecke: 'Hecke',
  bordstein: 'Bordstein',
  gelaender: 'Gelaender',
  stadtmauer: 'Stadtmauer',
  markierung: 'Fahrbahnmarkierung',
};

export interface GelaendeLinienObjekt {
  id: string;
  art: LinienArt;
  achse: Punkt[];
  /** Bauhoehe ueber Grund in Metern. */
  hoeheM: number;
  /** Dicke quer zur Achse in Metern. */
  breiteM: number;
  /** Nur Gleise: Spurweite in Metern (Darmstadt: Meterspur 1,000 m). */
  spurweiteM?: number;
  name?: string;
  /** Gleise: liegt es im Strassenraum (Rillenschiene) oder auf eigenem Bahnkoerper? */
  eigenerBahnkoerper?: boolean;
}

/**
 * Verweis auf das binaere Hoehenraster eines Gelaendes (shared/geo/raster.ts).
 *
 * Das Raster ist ab 09.08.2026 die EINZIGE Hoehenwahrheit. Die Hoehengitter der
 * Kacheln (`GelaendePatch.hoehen`) bleiben nur noch als grober Rueckfallweg
 * fuer Altbestaende und die 2D-Karte bestehen — sie hatten 4,7 m Maschenweite
 * und konnten damit keine Kante fuehren (docs/BAUWERKSMODELL.md, 1).
 */
export interface Hoehenmodell {
  /** Dateiname unter /api/gelaende/:id/ — derzeit immer „hoehen.bin". */
  datei: string;
  zellM: number;
  spalten: number;
  zeilen: number;
  /** Westrand der ersten Spalte, Suedrand der ersten Zeile (EPSG:25832). */
  minE: number;
  minN: number;
  herkunft: 'dgm1' | 'lod2_interpoliert' | 'import';
  /** Klartext fuer den Nachweis („DGM1-Archiv: Darmstadt - DGM1.zip"). */
  quelle: string;
  /** Verwendete DGM-Kacheln — gehoert in den Quellennachweis. */
  kacheln?: string[];
  /** Aus der Nachbarschaft ergaenzte Zellen. Eine Naeherung, kein Messwert. */
  ergaenzteZellen?: number;
  /**
   * Zulaessige Abweichung des gezeichneten Dreiecksnetzes vom Raster in Metern.
   * Steht hier und nicht im Programmtext, damit gezeichnete und gerechnete
   * Oberflaeche nachweislich dieselbe sind.
   */
  netzToleranzM: number;
}

/** Ein Gelaende-Kachelstueck mit eigener Orthophoto-Textur. */
export interface GelaendePatch {
  id: string;
  /** Bbox der Kachel in EPSG:25832. */
  bbox: BBox;
  /** Hoehengitter (Zeilen von Sued nach Nord, Spalten West nach Ost), m ue. NHN. */
  hoehen: number[][];
  spalten: number;
  zeilen: number;
  /** Relativer Pfad der Textur unter /api/gelaende/:id/textur/... */
  texturDatei?: string;
}

export interface Gelaende {
  id: string;
  name: string;
  /** Umgrenzung des importierten Gebiets (EPSG:25832). */
  polygon: Ring;
  bbox: BBox;
  epsg: 25832;
  /** Mittlere Gelaendehoehe (m ue. NHN) — Fallback + Kamerastart. */
  hoeheMittel: number;
  hoeheMin: number;
  hoeheMax: number;
  /** Wie die Hoehen entstanden sind — Nachweispflicht. */
  hoehenHerkunft: 'dgm1' | 'lod2_interpoliert' | 'flach';
  /**
   * Das echte Hoehenraster. Fehlt es, stammt das Gelaende aus einem Import vor
   * dem 09.08.2026 und traegt nur die groben Kachelgitter.
   */
  hoehenmodell?: Hoehenmodell;
  patches: GelaendePatch[];
  gebaeude: GelaendeGebaeude[];
  /** Bodenzeichnung nach tatsaechlicher Nutzung (ALKIS + OSM). */
  flaechen: GelaendeFlaeche[];
  /**
   * Kanten zwischen unterschiedlich hoch gebauten Flaechen (Bordsteine,
   * Boeschungen, Stuetzmauern). Sie sind ein ERGEBNIS der Konstruktionshoehen
   * und werden beim Import abgeleitet — nicht erfasst.
   */
  bruchkanten?: Bruchkante[];
  /** Baeume, Laternen, Baenke, Haltestellen … */
  punkte?: GelaendePunktObjekt[];
  /** Gleise, Mauern, Zaeune, Hecken, Bordsteine, Fahrbahnmarkierungen. */
  linien?: GelaendeLinienObjekt[];
  /**
   * Beschriftungspunkte der Karte (z. B. „P" auf Parkplaetzen). Sie werden
   * VOR der Flaechen-Vereinigung gewonnen — die Union verschmilzt
   * Einzelflaechen, deren Bezeichnungen fuer die Sammelgeometrie nicht mehr
   * gelten wuerden.
   */
  beschriftungen?: { pos: Punkt; text: string }[];
  /** Flurstuecke aus ALKIS (Anzeige + Flaechenbezug). */
  flurstuecke: { id: string; kennzeichen: string; polygon: Ring; flaeche: number }[];
  quellennachweis: Quellennachweis[];
  erstelltAm: string;
  erstelltVon: string;
}

// ---------------------------------------------------------------------------
// Objektbibliothek (F3)
// ---------------------------------------------------------------------------

export type ObjektKategorie =
  | 'gastronomie'
  | 'verkauf'
  | 'fahrgeschaeft'
  | 'buehne'
  | 'zelt'
  | 'sanitaer'
  | 'infrastruktur'
  | 'einsatz'
  | 'absperrung'
  | 'moeblierung';

export const OBJEKT_KATEGORIEN: ObjektKategorie[] = [
  'gastronomie',
  'verkauf',
  'fahrgeschaeft',
  'buehne',
  'zelt',
  'sanitaer',
  'infrastruktur',
  'einsatz',
  'absperrung',
  'moeblierung',
];

export const KATEGORIE_LABEL: Record<ObjektKategorie, string> = {
  gastronomie: 'Gastronomie',
  verkauf: 'Verkauf',
  fahrgeschaeft: 'Fahrgeschaeft',
  buehne: 'Buehne',
  zelt: 'Zelt',
  sanitaer: 'Sanitaer',
  infrastruktur: 'Infrastruktur',
  einsatz: 'Einsatz / BOS',
  absperrung: 'Absperrung',
  moeblierung: 'Moeblierung',
};

export type ZugangTyp = 'einstieg' | 'ausstieg' | 'notausgang';

export interface Zugang {
  /** Lage im lokalen Objektsystem (Meter), Ursprung = Objektmitte. */
  pos: [number, number];
  breite: number;
  /** Grad, 0 = +Y (Objektvorderseite), im Uhrzeigersinn. */
  richtung: number;
  typ: ZugangTyp;
}

export interface Masse {
  laenge: number;
  breite: number;
  hoehe: number;
}

export interface ObjektTyp {
  id: string;
  kategorie: ObjektKategorie;
  name: string;
  geometrieTyp: 'box' | 'gltf' | 'parametrisch';
  form: 'rechteck' | 'kreis';
  masse: Masse;
  parametrisierbar: boolean;
  minMax: { laenge: [number, number]; breite: [number, number]; hoehe: [number, number] };
  einAusstiege: Zugang[];
  /** Zusaetzlich freizuhaltender Umlauf in Metern. */
  flaechenbedarfZusatz: number;
  technik: { stromKW: number; wasser: boolean; gasflaschen: boolean };
  personenkapazitaet: number | null;
  quelleMasse: string;
  farbe: string;
  hinweis?: string;
  /** Nur bei geometrieTyp 'gltf'. */
  gltfDatei?: string;
  /** Vom Veranstalter selbst angelegt? */
  eigen?: boolean;
  eigentuemerOrgId?: string;
}

export interface Bibliothek {
  version: string;
  stand: string;
  typen: ObjektTyp[];
}

// ---------------------------------------------------------------------------
// Projekt und platzierte Elemente
// ---------------------------------------------------------------------------

export type ProjektStatus = 'entwurf' | 'eingereicht' | 'freigegeben' | 'abgeschlossen';

export interface Projekt {
  id: string;
  gelaendeId: string;
  veranstalterOrgId: string;
  name: string;
  zeitraumVon: string;
  zeitraumBis: string;
  maxBesucher: number;
  status: ProjektStatus;
  regelwerkId: string;
  beschreibung?: string;
  erstelltAm: string;
  erstelltVon: string;
  geaendertAm: string;
}

export type ObjektStatus = 'geplant' | 'bestaetigt' | 'aufgebaut';

export interface Auflage {
  id: string;
  text: string;
  von: string;
  vonOrg: string;
  am: string;
  erledigt: boolean;
}

export interface ObjektInstanz {
  id: string;
  projektId: string;
  typId: string;
  /** Mittelpunkt in EPSG:25832. */
  position: Punkt;
  /** Grad, im Uhrzeigersinn, 0 = Objekt-+Y zeigt nach Norden. */
  rotation: number;
  /** Ueberschriebene Masse (nur bei parametrisierbaren Typen). */
  masseOverride?: Partial<Masse>;
  /** Hoehe der Unterkante ueber Gelaende (fast immer 0). */
  hoeheUeberGelaende?: number;
  betreiberOrgId?: string;
  standNummer?: string;
  status: ObjektStatus;
  notizen?: string;
  auflagen: Auflage[];
  /** Von wem und wann angelegt — fuer das Aenderungsprotokoll. */
  erstelltVon: string;
  erstelltAm: string;
}

export type WegeTyp =
  | 'besucherweg'
  | 'rettungsweg'
  | 'feuerwehrzufahrt'
  | 'feuerwehrbewegungsflaeche'
  | 'versorgungsweg';

export const WEGE_TYPEN: WegeTyp[] = [
  'besucherweg',
  'rettungsweg',
  'feuerwehrzufahrt',
  'feuerwehrbewegungsflaeche',
  'versorgungsweg',
];

export const WEGE_TYP_LABEL: Record<WegeTyp, string> = {
  besucherweg: 'Besucherweg',
  rettungsweg: 'Rettungsweg',
  feuerwehrzufahrt: 'Feuerwehrzufahrt',
  feuerwehrbewegungsflaeche: 'Feuerwehr-Bewegungsflaeche',
  versorgungsweg: 'Versorgungsweg',
};

export const WEGE_TYP_FARBE: Record<WegeTyp, string> = {
  besucherweg: '#4a90d9',
  rettungsweg: '#33c46b',
  feuerwehrzufahrt: '#e8503a',
  feuerwehrbewegungsflaeche: '#e87d3a',
  versorgungsweg: '#9b8bd0',
};

/** Erlaubte Laufrichtung(en) entlang der Polylinie. */
export type Laufrichtung = 'vorwaerts' | 'rueckwaerts' | 'beide';

export interface Weg {
  id: string;
  projektId: string;
  typ: WegeTyp;
  /** Polylinie in EPSG:25832. */
  polylinie: Punkt[];
  /** Soll-Breite in Metern (Puffer beidseitig je breite/2). */
  breite: number;
  /** Lichte Hoehe, nur bei Feuerwehrzufahrten relevant. */
  lichteHoehe?: number;
  richtung: Laufrichtung;
  name?: string;
  /** Fuer die Kapazitaetsrechnung: dient dieser Weg der Entfluchtung? */
  entfluchtungFuerPersonen?: number;
  erstelltVon: string;
  erstelltAm: string;
}

export type BlockflaechenTyp = 'gesperrt' | 'nicht_bebaubar' | 'nur_einsatzkraefte';

export const BLOCK_TYP_LABEL: Record<BlockflaechenTyp, string> = {
  gesperrt: 'Gesperrt',
  nicht_bebaubar: 'Nicht bebaubar',
  nur_einsatzkraefte: 'Nur Einsatzkraefte',
};

export interface Blockflaeche {
  id: string;
  projektId: string;
  typ: BlockflaechenTyp;
  polygon: Ring;
  begruendung: string;
  name?: string;
  erstelltVon: string;
  erstelltAm: string;
}

export type StationsKategorie =
  | 'sanitaet'
  | 'feuerwehr'
  | 'polizei'
  | 'ordnungsdienst'
  | 'einsatzleitung'
  | 'sammelplatz'
  | 'loeschwasser'
  | 'notausgangspunkt';

export const STATIONS_KATEGORIEN: StationsKategorie[] = [
  'sanitaet',
  'feuerwehr',
  'polizei',
  'ordnungsdienst',
  'einsatzleitung',
  'sammelplatz',
  'loeschwasser',
  'notausgangspunkt',
];

export const STATION_LABEL: Record<StationsKategorie, string> = {
  sanitaet: 'Sanitaet',
  feuerwehr: 'Feuerwehr',
  polizei: 'Polizei',
  ordnungsdienst: 'Ordnungsdienst',
  einsatzleitung: 'Einsatzleitung',
  sammelplatz: 'Sammelplatz',
  loeschwasser: 'Loeschwasser',
  notausgangspunkt: 'Notausgangspunkt',
};

export const STATION_FARBE: Record<StationsKategorie, string> = {
  sanitaet: '#ff4d4d',
  feuerwehr: '#e8503a',
  polizei: '#2f6fd0',
  ordnungsdienst: '#3aa7a0',
  einsatzleitung: '#f0b400',
  sammelplatz: '#33c46b',
  loeschwasser: '#4fc3f7',
  notausgangspunkt: '#8bd033',
};

export interface Einsatzstation {
  id: string;
  projektId: string;
  kategorie: StationsKategorie;
  /** Punkt ODER Flaeche. */
  punkt?: Punkt;
  polygon?: Ring;
  name: string;
  besetztVonOrgId?: string;
  notizen?: string;
  erstelltVon: string;
  erstelltAm: string;
}

export interface Kommentar {
  id: string;
  projektId: string;
  /** Verankerung: entweder an einem Element oder frei im Plan. */
  elementRef?: ElementRef;
  punkt?: Punkt;
  text: string;
  autorId: string;
  autorName: string;
  autorOrgId: string;
  erledigt: boolean;
  erwaehnungen: string[];
  am: string;
  antworten: { id: string; text: string; autorId: string; autorName: string; am: string }[];
}

export type ElementArt =
  | 'objekt'
  | 'weg'
  | 'blockflaeche'
  | 'einsatzstation'
  | 'projekt'
  | 'kommentar'
  | 'objekttyp';

export interface ElementRef {
  art: ElementArt;
  id: string;
}

// ---------------------------------------------------------------------------
// Versionierung, Snapshots, Freigaben (F6)
// ---------------------------------------------------------------------------

export type Aktion = 'anlegen' | 'aendern' | 'loeschen';

export interface FeldDiff {
  feld: string;
  vorher: unknown;
  nachher: unknown;
}

export interface AenderungsEvent {
  id: string;
  /** Fortlaufend je Projekt — dient als Snapshot-Cursor. */
  seq: number;
  projektId: string;
  nutzerId: string;
  nutzerName: string;
  orgId: string;
  zeit: string;
  aktion: Aktion;
  elementRef: ElementRef;
  bezeichnung: string;
  diff: FeldDiff[];
  /** Gesetzt, wenn die Aenderung aus einem bestaetigten KI-Vorschlag stammt. */
  kiVorschlag?: { prompt: string; bestaetigtVon: string };
}

export interface Snapshot {
  id: string;
  projektId: string;
  name: string;
  zeit: string;
  /** Letzte enthaltene Event-Sequenznummer. */
  eventCursor: number;
  erstelltVon: string;
  /** Vollstaendiger, eingefrorener Projektinhalt. */
  inhalt: ProjektInhalt;
  bemerkung?: string;
}

export type FreigabeStatus = 'freigegeben' | 'mit_auflagen' | 'abgelehnt' | 'offen';

export const FREIGABE_LABEL: Record<FreigabeStatus, string> = {
  offen: 'Offen',
  freigegeben: 'Freigegeben',
  mit_auflagen: 'Mit Auflagen',
  abgelehnt: 'Abgelehnt',
};

export interface Freigabe {
  id: string;
  snapshotId: string;
  projektId: string;
  behoerdenOrgId: string;
  behoerdenOrgName: string;
  status: FreigabeStatus;
  kommentar: string;
  auflagen: Auflage[];
  am: string;
  vonNutzerId: string;
}

/** Alles, was ein Projekt geometrisch ausmacht — Basis fuer Snapshots und Pruefung. */
export interface ProjektInhalt {
  projekt: Projekt;
  objekte: ObjektInstanz[];
  wege: Weg[];
  blockflaechen: Blockflaeche[];
  einsatzstationen: Einsatzstation[];
}

// ---------------------------------------------------------------------------
// Regelwerk und Pruefung (F8)
// ---------------------------------------------------------------------------

export type PruefTyp =
  | 'wegbreite_min'
  | 'wegbreite_staffelung'
  | 'rettungsweg_engstelle'
  | 'rettungsweglaenge_max'
  | 'abstand_objekt_objekt'
  | 'abstand_objekt_gebaeude'
  | 'feuerwehrzufahrt_breite'
  | 'feuerwehrzufahrt_hoehe'
  | 'feuerwehr_erreichbarkeit'
  | 'feuerwehr_bewegungsflaeche'
  | 'einausstieg_wegangebunden'
  | 'kapazitaet_vs_wegbreite'
  | 'einsatzstation_erreichbarkeit'
  | 'blockflaeche_frei';

export const PRUEF_TYPEN: PruefTyp[] = [
  'wegbreite_min',
  'wegbreite_staffelung',
  'rettungsweg_engstelle',
  'rettungsweglaenge_max',
  'abstand_objekt_objekt',
  'abstand_objekt_gebaeude',
  'feuerwehrzufahrt_breite',
  'feuerwehrzufahrt_hoehe',
  'feuerwehr_erreichbarkeit',
  'feuerwehr_bewegungsflaeche',
  'einausstieg_wegangebunden',
  'kapazitaet_vs_wegbreite',
  'einsatzstation_erreichbarkeit',
  'blockflaeche_frei',
];

export type Schweregrad = 'fehler' | 'warnung' | 'hinweis';

export interface RegelQuelle {
  kuerzel: string;
  paragraf: string;
  zitat?: string;
  url?: string;
}

export interface Regel {
  id: string;
  titel: string;
  quelle: RegelQuelle;
  geltungsbereich: { bundesland: string; umgebung: 'draussen' | 'drinnen' | '*' };
  pruefTyp: PruefTyp;
  parameter: Record<string, unknown>;
  schwellwerte: Record<string, number>;
  meldungstext: string;
  schweregrad: Schweregrad;
  verifikation: { status: 'verifiziert' | 'zu_pruefen'; geprueftAm: string; beleg: string };
  aktiv?: boolean;
}

export interface Regelwerk {
  id: string;
  bundesland: string;
  version: string;
  stand: string;
  bezeichnung: string;
  haftungshinweis: string;
  quellen: { kuerzel: string; titel: string; fassung?: string; url?: string }[];
  regeln: Regel[];
}

export type PruefStatus = 'ok' | 'verstoss' | 'nicht_pruefbar';

export interface Pruefergebnis {
  id: string;
  regelId: string;
  regelTitel: string;
  pruefTyp: PruefTyp;
  status: PruefStatus;
  schweregrad: Schweregrad;
  meldung: string;
  istWert: number | null;
  sollWert: number | null;
  einheit: string;
  /** Betroffene Elemente — Klick springt im 3D dorthin. */
  elemente: ElementRef[];
  /** Ort des Verstosses (EPSG:25832) fuer "Sprung zum Ort". */
  ort?: Punkt;
  /** Optionale Hilfsgeometrie zum Einblenden (z. B. Engstelle). */
  geometrie?: Ring;
  fundstelle: string;
  /** Deterministisch berechnete Handlungsempfehlung (Basis fuer die KI-Erklaerung). */
  empfehlung?: Empfehlung;
}

export interface Empfehlung {
  text: string;
  /** Konkreter Verschiebevorschlag, falls berechenbar. */
  verschiebung?: { elementId: string; art: ElementArt; dE: number; dN: number; meter: number; richtung: string };
}

export interface Pruefbericht {
  projektId: string;
  snapshotId?: string;
  regelwerkId: string;
  regelwerkVersion: string;
  zeit: string;
  ergebnisse: Pruefergebnis[];
  zusammenfassung: { fehler: number; warnungen: number; hinweise: number; ok: number; nichtPruefbar: number };
  haftungshinweis: string;
}

// ---------------------------------------------------------------------------
// Kollaboration / Realtime
// ---------------------------------------------------------------------------

export interface Sperre {
  elementRef: ElementRef;
  nutzerId: string;
  nutzerName: string;
  seit: string;
  /** ISO — Sperre verfaellt nach 5 min ohne Aktivitaet (Lastenheft Kap. 5). */
  laeuftAbUm: string;
}

export interface Praesenz {
  nutzerId: string;
  nutzerName: string;
  orgName: string;
  farbe: string;
  /** Cursor-Position auf dem Gelaende (EPSG:25832). */
  cursor?: Punkt;
  auswahl?: ElementRef[];
  zuletzt: string;
}

export type WsNachricht =
  | { art: 'hallo'; projektId: string; praesenz: Praesenz[]; sperren: Sperre[] }
  | { art: 'praesenz'; praesenz: Praesenz }
  | { art: 'praesenz_weg'; nutzerId: string }
  | { art: 'event'; event: AenderungsEvent; inhalt?: Partial<ProjektInhalt> }
  | { art: 'sperre'; sperre: Sperre }
  | { art: 'sperre_weg'; elementRef: ElementRef }
  | { art: 'kommentar'; kommentar: Kommentar }
  | { art: 'pruefung'; bericht: Pruefbericht }
  | { art: 'benachrichtigung'; benachrichtigung: Benachrichtigung }
  | { art: 'cursor'; nutzerId: string; cursor: Punkt | null }
  | { art: 'fehler'; text: string };

export interface Benachrichtigung {
  id: string;
  nutzerId: string;
  projektId?: string;
  art: 'einladung' | 'einreichung' | 'statuswechsel' | 'erwaehnung' | 'auflage';
  titel: string;
  text: string;
  am: string;
  gelesen: boolean;
  link?: string;
}

// ---------------------------------------------------------------------------
// KI (F7)
// ---------------------------------------------------------------------------

export interface KiNachricht {
  rolle: 'nutzer' | 'assistent';
  text: string;
  am: string;
  /** Vorschlaege, die der Nutzer bestaetigen muss. */
  vorschlaege?: KiVorschlag[];
  /** Woher die Antwort kam. */
  quelle?: 'anthropic' | 'lokal';
}

export type KiVorschlag =
  | {
      aktion: 'platzieren';
      typId: string;
      /** EPSG:25832 */
      position: Punkt;
      rotation: number;
      parameter?: Partial<Masse>;
      begruendung: string;
    }
  | {
      aktion: 'verschieben';
      objektId: string;
      position: Punkt;
      begruendung: string;
    }
  | {
      aktion: 'weg_aendern';
      wegId: string;
      breite: number;
      begruendung: string;
    };

// ---------------------------------------------------------------------------
// Hilfs-Typen fuer die API
// ---------------------------------------------------------------------------

export interface ProjektUebersicht {
  projekt: Projekt;
  gelaendeName: string;
  veranstalterName: string;
  rolle: Rolle;
  objekteAnzahl: number;
  letzterSnapshot?: { id: string; name: string; zeit: string; status: FreigabeStatus };
  offeneFehler: number;
  aenderungenSeitBesuch?: number;
}

export interface ApiFehler {
  fehler: string;
  detail?: string;
}
