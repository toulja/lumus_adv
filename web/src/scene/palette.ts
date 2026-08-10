/**
 * ZEICHENSYSTEM DER STADTDARSTELLUNG — Palette, Konturen, Licht.
 *
 * Diese Datei ist zugleich die Gestaltungsdokumentation. Jeder Farbwert ist aus
 * `docs/KARTENDESIGN.md` abgeleitet; die Belegstelle steht jeweils daneben.
 * Sie enthaelt KEINEN Cesium-Code — nur Daten und kleine Rechenhilfen. Der
 * Verbraucher ist `web/src/scene/stadt.ts`.
 *
 * ---------------------------------------------------------------------------
 * DIE VIER BESCHWERDEN DES AUFTRAGGEBERS UND IHRE ANTWORT HIER
 * ---------------------------------------------------------------------------
 * 1. „die strassen sind nicht zu erkennen"
 *    -> Jede Verkehrsflaeche bekommt eine KONTUR (Casing). Die Fuellung muss
 *       damit nicht mehr gegen den wechselnden Untergrund ankommen, sondern nur
 *       noch gegen ihren eigenen, ueberall gleichen Saum. Genau deshalb liest ein
 *       Strassennetz als NETZ. (KARTENDESIGN 1.1)
 *       Fahrbahn L* 92,7 gegen Hauptkontur L* 30,1 = DL* 62,6 — mehr als der
 *       Abstand, den basemap.de Grau fuer seine Fahrbahn faehrt (100,0 -> 43,2 =
 *       56,8; KARTENDESIGN 2.6). Die Fahrbahn ist das hellste Objekt der Szene
 *       und traegt zugleich die dunkelste Kontur.
 * 2. „die gruenflaechen sind etwas random"
 *    -> EINE Gruenfamilie mit Helligkeitsrampe statt mehrerer Gruens:
 *       landwirtschaft L* 92,7 -> gruen L* 83,3 -> wald L* 64,4, gleiche a*- und
 *       b*-Richtung, nur zunehmend staerker. Vorbild basemap.de, das Wald/Gehoelz
 *       zoomabhaengig von rgb(223,240,182) nach rgb(154,182,109) fuehrt, also
 *       L* 92,3 -> 70,5 INNERHALB eines Farbtons. (KARTENDESIGN 2.5, 5.5)
 * 3. „die wege sehen nicht nach wegen aus"
 *    -> Zwei Teile. Der geometrische Teil (endcap=flat, join=mitre, Union je
 *       Klasse) gehoert in die Datenaufbereitung, nicht hierher (KARTENDESIGN 5.3).
 *       Der zeichnerische Teil steht hier: eigener Rang je Klasse, gestaffelter
 *       Hoehenversatz und eine eigene Nebenkontur, damit Gehweg, Radweg, Weg und
 *       Treppe nicht mit der Fahrbahn zu einem Balken verschmelzen. (KARTENDESIGN 1.1(2))
 * 4. „alles in verschiedenen Kontrasten, keine bunte Masse"
 *    -> Nur VIER Farbtonfamilien, nicht fuenfzehn Farben: neutral-warm (Bau- und
 *       Restflaechen), kuehl-neutral (Verkehr), gedaempftes Gruen (Vegetation),
 *       kuehles Blau (Wasser). Innerhalb einer Familie trennt Helligkeit, zwischen
 *       eng benachbarten Klassen zusaetzlich eine minimale Farbtemperatur-Differenz
 *       (kuehl gegen warm) — nie Buntheit. (KARTENDESIGN 3.1, 3.2)
 *       Das Auge unterscheidet nur ~12 Farbtoene gleichzeitig und ein Kartenleser
 *       ordnet hoechstens ~7 Flaechenklassen zuverlaessig zu; deshalb Gruppen
 *       bilden und innerhalb der Gruppe ueber Helligkeit abstufen.
 *       (Penn State GEOG 486, zitiert in KARTENDESIGN 3.1)
 *
 * ---------------------------------------------------------------------------
 * NEUFASSUNG 10.08.2026 — DIE LEITER IST GERECHNET, NICHT GEWAEHLT
 * ---------------------------------------------------------------------------
 * BEFUND DES AUFTRAGGEBERS: „Die Flaeche wirkt wie ein Fleckenteppich aus
 * Weiss, Creme und Grau; Details verschwinden." Nachgemessen stimmte das:
 * Fahrbahn L* 96,9 · Gelaendeplatte 92 · Gehweg 89,1 · ALKIS-Platte 86,3 —
 * vier fast weisse Flaechen nebeneinander, Abstaende von 2,4 bis 3,3 L*.
 * Jedes Detail darauf (Gleis, Markierung, Bordstein) hatte keinen Grund mehr,
 * gegen den es lesen konnte.
 *
 * DIE NEUE REGEL (Vorgabe): zwischen BENACHBARTEN Flaechenklassen mindestens
 * DL* 9, kein Flaechenton heller als L* 93.
 *
 * „Benachbart" ist dabei keine Eigenschaft der Farbleiter, sondern eine des
 * Bestandes. Sie wurde deshalb GEMESSEN, nicht angenommen
 * (scripts/flaechen-nachbarschaft.ts, Gelaende gel_b0650d4a952b8e25):
 * 141.681 m Klassengrenze, 53 vorkommende Klassenpaare. Aus der Messung folgt
 * der Rest zwangslaeufig (scripts/palette-leiter.ts):
 *
 *   Liegen alle Stufen 9 L* auseinander, heisst „DL* >= 9" genau: benachbarte
 *   Klassen liegen auf VERSCHIEDENEN Stufen. Das ist eine Knotenfaerbung, und
 *   die noetige Stufenzahl ist die chromatische Zahl des Nachbarschaftsgraphen.
 *
 *   Schwelle*   Kanten   Stufen   Band L*
 *      2 %         9        4     93 … 66
 *      1 %        14        4     93 … 66
 *    0,5 %        25        5     93 … 57   <- gewaehlt
 *   0,25 %        30        6     93 … 48
 *      0 %        53        9     93 … 21
 *   (*Anteil an der gesamten Klassengrenze, ab dem ein Paar als „benachbart"
 *    gilt; 0,5 % sind rund 700 m gemeinsame Kante.)
 *
 * GEWAEHLT: 0,5 % -> FUENF Stufen, L* 92,7 / 83,2 / 73,7 / 64,2 / 54,7 (Sollabstand 9,5).
 * Damit tragen 98,30 % der gemessenen Klassengrenze einen Abstand von
 * mindestens 9 L*; die restlichen 1,7 % (2.409 m, lauter Paare unter 700 m)
 * werden ueber die Farbtemperatur getrennt (Dab >= 5). Beides prueft
 * `pruefePalette()` gegen die MESSUNG, nicht gegen eine Annahme.
 *
 * DER PREIS, offen benannt: Das Flaechenband wird von 22,9 auf 38 L* breit.
 * KARTENDESIGN 3.3 empfiehlt fuer eine Basiskarte ein ENGES Band (Positron
 * 14,7 · basemap.de Grau 18,0), damit die Planobjekte darueber Platz haben.
 * Diese Empfehlung und die Vorgabe „DL* >= 9 zwischen Nachbarn" widersprechen
 * einander — mit 15 Flaechenklassen passt beides nicht zusammen. Die Vorgabe
 * gewinnt, weil das enge Band genau der Befund war. 38 L* liegen immer noch
 * unter dem Band von CARTO Dark Matter (32,8 … 36 je nach Zaehlung), und
 * unterhalb L* 54,7 bleibt der gesamte bunte Bereich den Planobjekten.
 *
 * DIE KARTE WIRD DADURCH DUNKLER, und zwar am staerksten dort, wo sie am
 * wenigsten sagt: Die Bauflaeche (55 % des Gebiets) faellt von L* 90,7 auf 54,7
 * und wird zum ruhigen Grund, auf dem Strassen (92,7), Plaetze (83,2) und
 * Gehwege (73,7) als Figur liegen. Das ist dieselbe Rollenverteilung wie in
 * basemap.de Grau, nur mit groesseren Schritten: dort ist die Fahrbahn das
 * hellste Objekt der Karte und traegt zugleich die dunkelste Kontur.
 *
 * ---------------------------------------------------------------------------
 * WICHTIGE EINSCHRAENKUNG ZUR KONTURBREITE
 * ---------------------------------------------------------------------------
 * Die Recherche ist eindeutig: die Kontur ist in echten Kartenstilen eine
 * BILDSCHIRMGROESSE von konstant 0,75–1,0 px je Seite und skaliert beim Zoomen
 * NICHT mit (KARTENDESIGN 1.1, drei unabhaengige Systeme stimmen ueberein:
 * basemap.de, CARTO Positron, OSM Carto).
 *
 * Unser Renderer zeichnet die Kontur aber als nach aussen gepufferte Flaeche im
 * Dreiecksnetz, also in METERN. `konturBreiteM` ist deshalb ein Kompromiss, und
 * er ist bewusst so gewaehlt, dass er in ZWEI Hinsichten stimmt:
 *   (a) In der Arbeitsansicht (Bildausschnitt ~200–400 m auf ~1400 px, also
 *       0,14–0,29 m/px) ergeben 0,20–0,30 m genau die recherchierten
 *       0,75–1,0 px je Seite.
 *   (b) Die Werte entsprechen zugleich realen Bauteilen — ein Bordstein ist
 *       0,15–0,30 m breit. Die Kontur ist damit nicht nur Grafik, sondern eine
 *       ehrliche Kante der „aus echten Massen gebauten Welt".
 * Der Renderer SOLL die resultierende Bildschirmbreite dennoch auf 0,7–1,6 px
 * klemmen: in der Fernansicht verschwaende die Kontur sonst, in der Nahansicht
 * wuerde sie zum Betonrand. Diese Klemmung gehoert nach stadt.ts.
 */

import type { FlaechenArt } from '@shared/domain/types';
// RELATIVER Pfad, nicht der `@shared`-Alias: Der Alias existiert nur in Vite.
// Diese Datei soll aber AUCH ohne Browser laufen — `node scripts/palette-pruefen.ts`
// fuehrt dieselbe Selbstpruefung von der Kommandozeile aus, und der Abnahmelauf
// nimmt sie mit. Ein Typ-Import (oben) waere egal, weil er beim Ausfuehren
// verschwindet; `OBERBAU_FARBEN` ist ein Wert und muss aufloesbar bleiben.
import { OBERBAU_FARBEN } from '../../../shared/bau/oberbau.ts';

// ===========================================================================
// 1  GRUNDTON UND HIMMEL
// ===========================================================================

/**
 * DIE GELAENDEPLATTE — der Ton unter allem.
 *
 * Sie wird ueberall dort sichtbar, wo KEINE Nutzungsflaeche kartiert ist:
 * Hinterhoefe, Baulücken, Boeschungen, der Saum ausserhalb des bestellten
 * Gebiets. Sie ist damit keine eigene Aussage, sondern die Abwesenheit einer
 * Aussage — und traegt deshalb GENAU den Ton der Bauflaeche (Stufe 4, L* 54,7).
 * „Unbenannter Boden" und „Baufeld" sehen im Bild dasselbe: ruhiger Grund.
 *
 * WICHTIG — DAS WAR EINE ZWEITE WAHRHEIT: Bis zum 10.08.2026 stand dieser Wert
 * als eigene Konstante `GRUNDPLATTE` in web/src/scene/gelaende.ts, mit einem
 * eigenen Hexwert (#e7e4e0). Er war damit von jeder Palettenaenderung
 * abgekoppelt — genau die Bauart, die dieses Projekt an anderer Stelle schon
 * Tage gekostet hat. Jetzt gibt es den Wert einmal, hier.
 *
 * ENTSCHEIDUNG ZUM HELLEN GRUND — sie gilt weiter, nur mit groesseren
 * Schritten (Begruendung im Dateikopf): Die FAHRBAHN bleibt das hellste Objekt
 * der Karte (L* 93), und alles unterhalb L* 54,7 bleibt den Planobjekten
 * vorbehalten. Rote Rettungswege, Zelte und Sperrungen liegen OBENAUF und
 * duerfen dort gleichzeitig dunkler und bunter sein als jede Basisflaeche.
 *
 * ANMERKUNG ZUM ABENDSZENARIO: Fuer Nachtbetrieb waere nach KARTENDESIGN 3.3
 * eine dunkle Fassung nach Dark-Matter-Muster moeglich (Band eng bei L* 4–30,
 * Planobjekte ausschliesslich oberhalb L* 55). Sie waere aus DIESER Palette
 * abzuleiten, nicht getrennt zu pflegen. Hier bewusst nicht implementiert.
 */
export const GRUNDTON = '#87827e';

/**
 * Himmel: blasses, kuehles Dunst.
 * L* 88,00 / a* -1,50 / b* -4,90.
 * Bewusst 4,7 L* DUNKLER als die Fahrbahn (92,7). Zwei Gruende:
 *  - Figur-Grund: die Stadt soll das hellste Element im Bild sein, nicht der
 *    Himmel. „Some features … will appear to be in the foreground … while other
 *    features (the pale, desaturated, and plain ones) will appear to be in the
 *    background." (Esri, zitiert in KARTENDESIGN 3.3)
 *  - Der Farbtemperatursprung zum warmen Boden erzeugt eine saubere
 *    Horizontkante ohne eine einzige gesaettigte Farbe.
 * (Vorher L* 94 — damit war der Himmel heller als jede Flaeche der Karte. Mit
 * dem neuen Deckel von L* 93 waere er das staerkste Weiss im Bild geworden.)
 */
export const HIMMEL = '#d5dee6';

// ===========================================================================
// 2  FLAECHENSTILE
// ===========================================================================

export interface FlaechenStil {
  /** Deckerfarbe (die eigentliche Flaeche), Hex. */
  fuellung: string;
  /**
   * Konturfarbe (Casing). Wird als nach aussen gepufferte, DUNKLERE Flaeche
   * UNTER der Fuellung gezeichnet. Fehlt sie, bekommt die Klasse keinen Saum.
   */
  kontur?: string;
  /** Saumbreite je Seite in Metern. Siehe Einschraenkung im Dateikopf. */
  konturBreiteM?: number;
  /**
   * Zeichenreihenfolge, hoeher = weiter oben.
   * ACHTUNG: Der Rang ordnet INNERHALB eines Durchgangs. Gezeichnet wird strikt
   * in zwei Durchgaengen — erst ALLE Konturen aller Klassen, dann ALLE
   * Fuellungen aller Klassen. Nur so ueberdeckt an einer Kreuzung die Fuellung
   * der einen Strasse die Kontur der anderen und die Strassen „fliessen"
   * durcheinander, statt sich gegenseitig zu zerschneiden. Wer je Strasse erst
   * Kontur und dann Fuellung zeichnet, bekommt an jeder Kreuzung einen
   * Querstrich. (KARTENDESIGN 1.4 d — so machen es Positron UND basemap.de)
   */
  rang: number;
  /**
   * Hoehenversatz ueber Gelaende in Metern, = rang * 0,002 (2 mm je Rangstufe).
   * Er verhindert Z-Fighting zwischen den gestapelten Bodenflaechen. Die Werte
   * liegen zwischen 2 und 9,2 cm — geometrisch bedeutungslos, aber ausreichend
   * gegen Flimmern. Die zugehoerige Kontur liegt KONTUR_VERSATZ_M tiefer.
   */
  hoehenversatzM: number;
}

// ---------------------------------------------------------------------------
// Konturtoene — bewusst sehr wenige
// ---------------------------------------------------------------------------
// basemap.de faehrt EINEN einzigen Konturton rgb(153,153,153) fuer das komplette
// Strassennetz und klassifiziert ausschliesslich ueber Deckerfarbe und Breite
// (KARTENDESIGN 2.5). Wir uebernehmen das Prinzip und erlauben uns nur zwei
// Stufen, weil unser Netz mehr Fussverkehrsklassen fuehrt als basemap.de.

/**
 * Hauptkontur — Fahrbahn, Platz, Fussgaengerzone, ALKIS-Platte.
 * L* 30,10 / a* +0,02 / b* -1,06. Neutral mit einem Hauch Kuehle.
 *
 * WARUM SIE VON L* 48 AUF 30 GEHT: Die Regel lautet „Verkehrsflaeche gegen
 * ihren eigenen Saum >= 30 L*, Fahrbahn >= 40" (KARTENDESIGN 5.1). Solange
 * alle Verkehrsflaechen zwischen L* 83 und 97 lagen, ging das mit EINEM
 * Konturton bei 48 auf. Jetzt reicht das Verkehrsband von 92,7 (Fahrbahn) bis
 * 54,7 (Bahn) — ein einziger Ton muss also unter 54,7-30 = 24,7 … bzw. mit der
 * getrennten Nebenkontur unter 36 bleiben. Der Wert 30 haelt den Abstand fuer
 * JEDE Klasse, die ihn traegt, und liegt zwischen basemap.de Grau
 * (Strassenkontur L* 43,2) und dessen Bahnkontur (L* 21,2) — beides belegte
 * Werte eines amtlichen Stils.
 *
 * Er erfuellt damit zusaetzlich WCAG 2.1 SC 1.4.11 („Non-text Contrast":
 * mindestens 3:1 gegen benachbarte Farben fuer grafische Objekte,
 * https://w3c.github.io/wcag21/understanding/21/non-text-contrast.html) —
 * gegen die Fahrbahn 7,8:1. Fuer eine Linie, die die Karte lesbar machen soll,
 * ist das der richtige Massstab; fuer grosse Flaechen ist er es NICHT (siehe
 * Kommentar bei KONTUR_BLOCK).
 */
export const KONTUR_HAUPT = '#464748';

/**
 * Nebenkontur — Gehweg, Radweg, Weg, Treppe.
 * L* 31,89 / a* -0,04 / b* -1,45. Vier L* heller als die Hauptkontur.
 * Der Abstand ist absichtlich klein: er stuft die Hierarchie ab, ohne den
 * Mindestabstand von 30 L* zur eigenen Fuellung zu gefaehrden. Kritisch ist
 * dabei nicht der Gehweg (L* 75 -> DL* 41), sondern der WEG (L* 66 -> DL* 32):
 * er bestimmt, wie dunkel die Nebenkontur hoechstens sein darf … bzw. wie hell.
 */
export const KONTUR_NEBEN = '#4a4b4e';

/** Vegetationskontur, gedaempftes Gruen. L* 62,15 / a* -7,9 / b* +9,0. */
export const KONTUR_GRUEN = '#8e9a86';
/** Waldkontur, dunkler und satter — setzt die Gruenrampe fort. L* 50,08. */
export const KONTUR_WALD = '#6c7c62';
/** Uferlinie. L* 49,92 / a* -5,0 / b* -10,0 — kuehl, gleiche Richtung wie das Wasser. */
export const KONTUR_WASSER = '#637a88';
/**
 * Bahnkontur. L* 22,10, neutral. Das dunkelste Basiselement der Karte — genau
 * die Rollenverteilung aus basemap.de Grau, wo die Bahn (rgb(51,51,51),
 * L* 21,2) noch unter der Strassenkontur (L* 43,2) liegt. Fuer eine
 * Veranstaltungsplanung ist die Bahn eine harte Grenze; dass sie als dunkelste
 * Linie liest, ist gewollt.
 */
export const KONTUR_BAHN = '#343536';
/**
 * Blockkante — Bauflaechen und ALKIS-Platte. L* 43,05.
 * BEWUSST SCHWACH gemeint („keine eigene starke Kontur, nur eine schwache
 * Grenze gegen Bauflaechen", KARTENDESIGN 5.2) — der Wert ist trotzdem
 * dunkler als frueher (L* 76), weil die Bauflaeche selbst von L* 90,7 auf 54,7
 * gefallen ist. Entscheidend ist der ABSTAND, und der betraegt jetzt 11,6 L*
 * gegen vorher 14,7. Die Kante bleibt also relativ genauso zurueckhaltend.
 *
 * Sie erfuellt WCAG 1.4.11 ausdruecklich NICHT (1,52:1) — und soll es nicht:
 * Das Kriterium gilt fuer grafische Objekte, die zum Verstaendnis noetig sind.
 * Die Blockkante ist eine Zugabe; die Aussage traegt die Flaeche selbst, und
 * die steht mit DL* 9 gegen jeden Nachbarn. Dasselbe gilt fuer die
 * Vegetations- und Uferkanten.
 */
export const KONTUR_BLOCK = '#696562';
/** Ackerkante, blass gruen-gelb. L* 78,06. */
export const KONTUR_LANDW = '#c1c3ab';

/** Die Kontur liegt 1 mm UNTER ihrer Fuellung. */
export const KONTUR_VERSATZ_M = -0.001;

/**
 * ---------------------------------------------------------------------------
 * DIE STUFENLEITER — fuenf Stufen, aus der Messung abgeleitet
 * ---------------------------------------------------------------------------
 * L* echt gerechnet: sRGB -> linear -> XYZ (D65) -> CIELAB. Alle Sollwerte
 * wurden mit scripts/palette-rechnen.ts aus (L*, a*, b*) nach sRGB gerechnet,
 * nicht von Hand gewaehlt; das Ist steht daneben und weicht nirgends um mehr
 * als 0,15 L* ab (kein Wert liegt ausserhalb des sRGB-Farbraums).
 *
 * REGELN, gegen die `pruefePalette()` prueft:
 *   (1) kein Flaechenton heller als L* 93                       (Vorgabe)
 *   (2) gemessene Nachbarn ueber der Schwelle:  DL* >= 9        (Vorgabe)
 *   (3) gemessene Nachbarn unter der Schwelle:  DL* >= 9 ODER Dab >= 5
 *   (4) Verkehrsflaeche gegen eigene Kontur >= 30 L*, Fahrbahn >= 40 L*,
 *       Flaechenklasse gegen eigene Kontur >= 10 L*   (KARTENDESIGN 5.1/3.2)
 *
 * Stufe | L*   | Klassen (a* und b* in Klammern)
 * ------|------|-------------------------------------------------------------
 *   0   | 92,7 | fahrbahn (0/-1) · landwirtschaft (-5/+12)
 *   1   | 83,2 | platz (+0,2/-0,5) · gruen (-9/+10)
 *   2   | 73,7 | gehweg (0/-2) · fussgaengerzone (-5/+1) · radweg (+8/+5)
 *       |      | · treppe (+1/+4)
 *   3   | 64,2 | platte (-0,5/-2) · weg (+2/+6) · wald (-13/+14) · wasser (-5/-9)
 *   4   | 54,7 | bebauung (+1/+3) = sonstige · bahn (0/-4)
 *
 * Der SOLLABSTAND betraegt 9,5 und nicht 9,0 — gefordert sind MINDESTENS 9,
 * und die Rueckrechnung aus dem 8-Bit-Hexwert verschiebt L* um bis zu 0,15.
 * Bei exakt 9,0 landeten acht gemessene Nachbarpaare bei 8,78 bis 8,99 und die
 * Vorgabe waere um Hundertstel gerissen gewesen; die Selbstpruefung hat genau
 * das gemeldet. Der Deckel liegt aus demselben Grund bei 92,8 statt 93,0.
 *
 * Flaechenband L* 54,7–92,7 = 38 Einheiten (vorher 22,9).
 *
 * Die Stufe ordnet, die Farbtemperatur unterscheidet — das ist die
 * Zwei-Ebenen-Regel aus KARTENDESIGN 3.1: wenige Farbton-FAMILIEN, innerhalb
 * der Familie Helligkeit. Vier Familien wie bisher: neutral-warm (Grund),
 * kuehl-neutral (Verkehr), gedaempftes Gruen (Vegetation), kuehles Blau
 * (Wasser). Innerhalb EINER Stufe liegen nur Klassen, die sich im Bestand
 * kaum beruehren; wo sie es doch tun, traegt die Farbtemperatur (Dab 5,8 bis
 * 24,4 — jede Paarung ist unten in `pruefePalette` nachgerechnet).
 *
 * Die VEGETATIONSRAMPE bleibt eine Rampe: landwirtschaft 92,7 -> gruen 83,3 ->
 * wald 64,2, a* und b* gleichgerichtet und zunehmend staerker (-5/+12 -> -9/+10 ->
 * -13/+14). Dass Ackerland der hellste Ton der Karte sein darf, ist keine
 * Erfindung: basemap.de Farbe faerbt `VegetationsF_Ackerland_und_Co` exakt im
 * Hintergrundton rgb(255,253,238) — also im hellsten Wert des ganzen Stils
 * (KARTENDESIGN 2.5).
 *
 * ---------------------------------------------------------------------------
 * KONTURABSTAENDE — Fuellung gegen ihren eigenen Saum
 * ---------------------------------------------------------------------------
 * Klasse            | Fuellung | Kontur       | DL*  | Ziel  | WCAG 1.4.11
 * ------------------|----------|--------------|------|-------|-------------
 * fahrbahn          |   92,7   | HAUPT  30,1  | 62,6 | >= 40 | 7,74:1  ok
 * platz             |   83,2   | HAUPT  30,1  | 53,1 | >= 30 | 5,98:1  ok
 * fussgaengerzone   |   73,7   | HAUPT  30,1  | 43,6 | >= 30 | 4,55:1  ok
 * gehweg            |   73,7   | NEBEN  31,9  | 41,8 | >= 30 | 4,26:1  ok
 * radweg            |   73,8   | NEBEN  31,9  | 41,9 | >= 30 | 4,27:1  ok
 * treppe            |   73,7   | NEBEN  31,9  | 41,8 | >= 30 | 4,26:1  ok
 * weg               |   64,2   | NEBEN  31,9  | 32,3 | >= 30 | 3,16:1  ok
 * bahn              |   54,7   | BAHN   22,1  | 32,6 | >= 30 | 3,24:1  ok
 * gruen             |   83,3   | GRUEN  62,2  | 21,2 | >= 10 | 1,90:1  (*)
 * wald              |   64,4   | WALD   50,1  | 14,3 | >= 10 | 1,63:1  (*)
 * wasser            |   64,2   | WASSER 49,9  | 14,3 | >= 10 | 1,63:1  (*)
 * bebauung          |   54,7   | BLOCK  43,1  | 11,6 | >= 10 | 1,52:1  (*)
 * landwirtschaft    |   92,7   | LANDW  78,1  | 14,6 | >= 10 | 1,50:1  (*)
 * PLATTE            |   64,2   | BLOCK  43,1  | 21,2 | >= 10 | 2,09:1  (*)
 * sonstige          |   54,7   | (keine)      |  —   |   —   |  —
 *
 * (*) WCAG 2.1 SC 1.4.11 verlangt 3:1 fuer grafische Objekte, „die zum
 * Verstaendnis noetig sind". Die Kanten der Flaechenklassen sind das
 * ausdruecklich NICHT — dort traegt die Flaeche selbst die Aussage, und die
 * steht mit DL* >= 9 gegen jeden gemessenen Nachbarn. Fuer die Linien des
 * Verkehrsnetzes, wo die Kontur die Aussage TRAEGT, ist das Kriterium
 * durchgehend erfuellt. Die Unterscheidung ist bewusst und wird geprueft.
 */
export const FLAECHEN_STIL: Record<FlaechenArt, FlaechenStil> = {
  // -------------------------------------------------------------------------
  // FAMILIE 1 — NEUTRAL WARM: das ruhige Gewebe, auf dem alles andere liegt.
  // Raenge 10–14, ganz unten. Diese Flaechen sind Grund, nicht Figur.
  // -------------------------------------------------------------------------

  /**
   * Auffangklasse. Stufe 4, L* 54,68 / a* +1,12 / b* +2,83.
   * Bewusst OHNE Kontur: was wir nicht benennen koennen, soll auch keine Kante
   * behaupten. Das ist die ehrliche Darstellung fehlender Information — und es
   * haelt die Zahl der gleichzeitig sichtbaren Flaechenklassen unter der
   * Wahrnehmungsgrenze von ~7 (KARTENDESIGN 3.1).
   *
   * SIE TRAEGT DEN TON DER BAUFLAECHE, und zwar denselben, nicht einen
   * aehnlichen: „unbenannter Boden" und „Baufeld" sagen im Bild dasselbe aus.
   * Zwei fast gleiche Toene waeren die schlechteste Loesung — der Betrachter
   * suchte dann einen Unterschied, den es nicht gibt (KARTENDESIGN 3.1). Fuer
   * die Lesbarkeitspruefung sind beide EINE Zeichenklasse.
   */
  sonstige: { fuellung: '#87827e', rang: 10, hoehenversatzM: 0.020 },

  /**
   * Ackerland / Gartenland. Stufe 0, L* 92,66 / a* -4,91 / b* +11,90.
   * Der HELLSTE und gelblichste Punkt der Gruenrampe — so wie in jeder Referenz:
   * OSM Carto `@farmland` #eef0d5, basemap.de fuehrt Ackerland sogar exakt im
   * Hintergrundton rgb(255,253,238) (KARTENDESIGN 2.4, 2.5). Nutzflaeche ist
   * heller als Bewuchs; erst der Bewuchs wird gruen und dunkel.
   *
   * Sie liegt auf DERSELBEN Stufe wie die Fahrbahn und wird allein ueber die
   * Farbtemperatur getrennt (Dab 13,9). Im Pilotgebiet gibt es keine
   * Ackerflaeche, die Messung kennt also kein Nachbarpaar dazu. Waechst das
   * Gebiet ins Umland, MUSS die Nachbarschaft neu gemessen werden — dann kann
   * sich die Stufe aendern. Das ist kein Mangel, sondern der Grund, warum die
   * Leiter aus der Messung kommt und nicht aus dem Gedaechtnis.
   */
  landwirtschaft: { fuellung: '#eaecd3', kontur: KONTUR_LANDW, konturBreiteM: 0.35, rang: 12, hoehenversatzM: 0.024 },

  /**
   * Bauflaechen — 55,1 % der Gebietsflaeche und damit die groesste Klasse
   * ueberhaupt (664.600 m2 im Pilotgebiet, gemessen).
   * Stufe 4, L* 54,68 / a* +1,12 / b* +2,83.
   *
   * DAS IST DIE GROESSTE AENDERUNG DER NEUFASSUNG: von L* 90,7 auf 54,7.
   * Begruendung in zwei Schritten:
   *  - Zwang: Die Bauflaeche grenzt an ALLES. Gemessen hat sie mit acht
   *    anderen Klassen eine gemeinsame Kante, darunter die vier laengsten des
   *    Gebiets (an die Platte 18.035 m, an die Fahrbahn 12.390 m, an den
   *    Gehweg 11.992 m, an die Fussgaengerzone 6.820 m). Zusammen mit
   *    Fahrbahn, Platz, Platte und Gehweg bildet sie eine Fuenfer-Clique —
   *    fuenf Klassen, von denen jede jede beruehrt. Sie MUESSEN auf fuenf
   *    verschiedenen Stufen liegen, und irgendeine davon ist die unterste.
   *  - Wahl: Dass es die Bauflaeche ist, ist kartografisch richtig. Sie ist
   *    Grund, nicht Figur — „low visual contrast works best for basemaps so
   *    that the overlaid thematic layers are more visually prominent" (Esri,
   *    KARTENDESIGN 3.3). Die Strassen liegen darauf und werden dadurch zum
   *    hellsten, ruhigsten Netz im Bild.
   *
   * NEBENWIRKUNG, gewollt: Die Gebaeude (Wand L* 80) stehen jetzt HELLER als
   * ihr Baufeld statt dunkler. Der Abstand betraegt 25 L* statt vorher 10,7 —
   * das Haus loest sich vom Grundstueck, ohne dass es dafuer eine Kante
   * braucht. Die Dachflaeche (L* 69,8) haelt 15 L* Abstand zum Baufeld.
   *
   * Sie traegt eine SCHWACHE Blockkante, damit die Blockstruktur lesbar wird,
   * ohne mit dem Strassennetz zu konkurrieren (KARTENDESIGN 5.2).
   */
  bebauung: { fuellung: '#87827e', kontur: KONTUR_BLOCK, konturBreiteM: 0.30, rang: 14, hoehenversatzM: 0.028 },

  // -------------------------------------------------------------------------
  // FAMILIE 2 — VEGETATION: EINE Gruenfamilie, EINE Helligkeitsrampe.
  // Das ist die direkte Antwort auf „die gruenflaechen sind etwas random".
  // Google loest dasselbe Problem so: Bestandsdichte wird in Helligkeitsstufen
  // DESSELBEN Gruens uebersetzt — „a densely covered forest can be classified as
  // dark green, while an area of patchy shrubs could appear as a lighter shade
  // of green" (KARTENDESIGN 2.7 c). Nicht die QUELLE (ALKIS/OSM) entscheidet
  // ueber den Ton, sondern die gemessene Bestandsdichte.
  // Rampe: landwirtschaft 88,61 -> gruen 85,46 -> wald 73,99, a* und b* gleichgerichtet
  // (immer negativ/positiv), nur zunehmend staerker: a* -6,2 -> -8,9 -> -12,8.
  // -------------------------------------------------------------------------

  /**
   * Wald / Baumgruppe. Stufe 3, L* 64,35 / a* -12,95 / b* +13,82 — das
   * dunkelste Ende der Gruenrampe.
   * Angelehnt an basemap.de `VegetationsF_Wald` in der Nahstufe rgb(154,182,109)
   * = L* 70,5, hier 4,6 L* dunkler und entsaettigt, damit es nicht bunt wird.
   * Er teilt die Stufe mit Platte, Weg und Wasser; getrennt wird ueber die
   * Farbtemperatur (Dab 17,0 bis 24,4 — der groesste Abstand der ganzen Karte).
   */
  wald: { fuellung: '#8ea283', kontur: KONTUR_WALD, konturBreiteM: 0.40, rang: 16, hoehenversatzM: 0.032 },

  /**
   * Gruenflaeche / Park / Rasen. Stufe 1, L* 83,32 / a* -8,89 / b* +9,77.
   * a* und b* aus KARTENDESIGN 5.4 unveraendert uebernommen, die Helligkeit folgt
   * der Stufenleiter. Deutlich entsaettigter als OSM Carto `@park` #c8facc —
   * dort ist Gruen ein Signal, hier ist es Untergrund.
   *
   * Dass Gruen HELLER liegt als Gehweg und Bauflaeche, ist kein Versehen: Der
   * Herrngarten grenzt auf 9.885 m an Gehwege und auf 5.208 m an Bauflaechen;
   * die Stufe ergibt sich aus dieser Nachbarschaft. In basemap.de Grau ist
   * Gruenland (L* 95,5) ebenfalls heller als Siedlung (90,9) und Wald (89,2).
   */
  gruen: { fuellung: '#c6d4bd', kontur: KONTUR_GRUEN, konturBreiteM: 0.35, rang: 18, hoehenversatzM: 0.036 },

  // -------------------------------------------------------------------------
  // FAMILIE 3 — WASSER: der einzige klar blaue Ton der Basiskarte.
  // -------------------------------------------------------------------------

  /**
   * Wasser. Stufe 3, L* 64,24 / a* -4,81 / b* -9,32.
   * a* und b* aus KARTENDESIGN 5.4 (a* -5 / b* -9) unveraendert; die Helligkeit
   * folgt der Stufenleiter. Deutlich blasser als OSM Carto `@water-color`
   * #aad3df — Wasser soll erkennbar, aber nicht laut sein. Gegen die
   * Gruenflaeche (Stufe 1) stehen 18 L*, gegen Wald und Weg auf derselben
   * Stufe die Farbtemperatur (Dab 24,4 bzw. 16,6).
   */
  wasser: { fuellung: '#899fac', kontur: KONTUR_WASSER, konturBreiteM: 0.30, rang: 20, hoehenversatzM: 0.040 },

  /**
   * Bahnverkehrsflaeche. Stufe 4, L* 54,72 / a* +0,33 / b* -4,15.
   * Kuehl gefuehrt, damit sie sich auf derselben Stufe von der warmen
   * Bauflaeche absetzt (Dab 7,07). Die KONTUR ist mit L* 22,10 das dunkelste
   * Basiselement der Karte — genau die Rollenverteilung aus basemap.de Grau,
   * wo die Bahn (rgb(51,51,51), L* 21,2) noch unter der Strassenkontur
   * (L* 43,2) liegt. Fuer eine Veranstaltungsplanung ist die Bahn eine harte
   * Grenze; dass sie als dunkelste Linie liest, ist gewollt.
   * Im Pilotgebiet kommt keine Bahnflaeche vor — der Wert ist damit nicht
   * gegen eine Messung geprueft, sondern nur gegen die Regeln.
   */
  bahn: { fuellung: '#80838a', kontur: KONTUR_BAHN, konturBreiteM: 0.30, rang: 22, hoehenversatzM: 0.044 },

  // -------------------------------------------------------------------------
  // FAMILIE 4 — VERKEHR: kuehl-neutral, hell, mit Kontur. Das ist die Figur.
  // Klassifikation ausschliesslich ueber Helligkeit + minimale Farbtemperatur,
  // NIE ueber Buntheit. OSM Carto macht das Gegenteil (Gehweg lachsrot #fa8072,
  // Radweg reinblau, Reitweg gruen) und ist damit fuer uns untauglich: die
  // Basiskarte verbraucht dort bereits Rot, Blau und Gruen — genau die Farben,
  // die wir fuer Rettungswege, Sperrungen und Stationen brauchen
  // (KARTENDESIGN 2.4, Schlussbemerkung).
  //
  // Raenge 30–46, ueber allen Flaechen. Innerhalb des Verkehrs:
  //   30 platz / 32 fussgaengerzone  grosse Flaechen = Buehne, ganz unten
  //   34 weg / 36 gehweg             begleitende Netze
  //   42 fahrbahn                    das Rueckgrat MUSS durchlaufen; es
  //                                  ueberdeckt Pufferueberstaende der Gehwege
  //   44 radweg                      Radstreifen liegt real AUF der Fahrbahn
  //                                  und ist Planungsinformation (Rettungswege)
  //   46 treppe                      Stufen sind Hindernisse und duerfen von
  //                                  nichts verdeckt werden
  // -------------------------------------------------------------------------

  /**
   * Platz. Stufe 1, L* 83,15 / a* +0,18 / b* -0,50.
   * basemap.de faerbt den Platz REINWEISS wie die Fahrbahn und unterscheidet
   * beide allein ueber Geometrie und Kontur (KARTENDESIGN 2.5). Das geht hier
   * nicht: Platz und Fahrbahn beruehren sich im Gebiet auf 1.313 m, sie
   * MUESSEN also eine Stufe auseinander. Er liegt genau eine darunter — damit
   * bleibt im Bild eindeutig, welches Objekt das Netz fuehrt, und die groessere
   * Flaeche dominiert nicht.
   */
  platz: { fuellung: '#cfcfd0', kontur: KONTUR_HAUPT, konturBreiteM: 0.30, rang: 30, hoehenversatzM: 0.060 },

  /**
   * Fussgaengerzone (7 ALKIS + 155 OSM Flaechen — EINE Klasse, nicht zwei!).
   * Stufe 2, L* 73,74 / a* -5,12 / b* +1,10.
   * Sie teilt die Stufe mit dem Gehweg (597 m gemeinsame Kante, unter der
   * Messschwelle) und wird von ihm ueber die Farbtemperatur getrennt
   * (Dab 5,83) — genau die Technik aus KARTENDESIGN 3.2.
   * Die einzige Verkehrsklasse mit eigenem Farbstich, und das mit Vorbild:
   * basemap.de gibt der Fussgaengerzone rgb(182,223,210) = L* 85,7 / a* -15,9 /
   * b* +1,9 — ein entsaettigtes Mintturkis. Wir uebernehmen die RICHTUNG
   * (a* negativ, b* leicht positiv), aber nur ein Drittel der Staerke
   * (a* -4,9 statt -15,9), weil unsere Planobjekte den Farbraum brauchen.
   * WICHTIG (KARTENDESIGN 1.3(3) und 5.2): Flaeche und Achse sind FARBIDENTISCH
   * — basemap.de verwendet denselben Wert fuer `Verkehrsflaeche_Fussgaengerzone`
   * und `Decker_Fussgaengerzone_...`. Das verhindert Doppelbilder aus zwei
   * Quellen. Deshalb hier genau EIN Eintrag fuer ALKIS und OSM zusammen.
   */
  fussgaengerzone: { fuellung: '#acb8b3', kontur: KONTUR_HAUPT, konturBreiteM: 0.25, rang: 32, hoehenversatzM: 0.064 },

  /**
   * Weg (16 ALKIS + 30 OSM). Stufe 3, L* 64,20 / a* +2,06 / b* +6,03.
   * Der waermste Ton im Verkehr. Begruendung: ein Weg ist baulich etwas
   * anderes als Asphalt — wassergebundene Decke, Kies, Schotter. Die Richtung
   * ist von OSM Carto `@track-fill` #996600 uebernommen, aber auf ein
   * Zwanzigstel der Saettigung heruntergefahren.
   * Nach KARTENDESIGN 5.2 ist der Weg eine Stufe DUNKLER als der Gehweg — hier
   * genau eine, also 9 L*. Er teilt die Stufe mit der Platte (600 m gemeinsame
   * Kante, unter der Messschwelle) und wird von ihr ueber die Farbtemperatur
   * getrennt (Dab 8,38).
   * ACHTUNG: Der Weg bestimmt, wie dunkel die Nebenkontur sein darf — er ist
   * die dunkelste Klasse, die sie traegt (DL* 32,3 gegen die geforderten 30).
   */
  weg: { fuellung: '#a49a91', kontur: KONTUR_NEBEN, konturBreiteM: 0.20, rang: 34, hoehenversatzM: 0.068 },

  /**
   * Gehweg (736 OSM-Flaechen — die haeufigste Verkehrsklasse).
   * Stufe 2, L* 73,71 / a* +0,41 / b* -2,15.
   * a* und b* aus KARTENDESIGN 5.4 (a* 0 / b* -1,5) uebernommen; die Helligkeit
   * folgt der Stufenleiter.
   *
   * DER ABSTAND ZUR FAHRBAHN BETRAEGT JETZT 19 L* — zwei Stufen, weil zwischen
   * beiden der Platz liegt. Zum Vergleich: basemap.de Grau trennt Fahrbahn
   * (100,0) vom Hauptwirtschaftsweg (94,1) mit 5,9. Die Forderung des
   * Auftraggebers „Buergersteige in einem anderen Grauton als Strassen"
   * (08.08.2026) ist damit dreifach erfuellt statt knapp.
   * Er ist die haeufigste Klasse und grenzt an sieben andere — mit 16.230 m an
   * die Platte, 11.992 m an die Bauflaeche, 9.885 m an Gruenflaechen.
   */
  gehweg: { fuellung: '#b4b5b9', kontur: KONTUR_NEBEN, konturBreiteM: 0.22, rang: 36, hoehenversatzM: 0.072 },

  /**
   * GLEISZONE — das eingedeckte Band, in dem die Rillenschiene liegt.
   * Stufe 4, L* 54,73 / a* -4,67 / b* -8,30 (kuehl, wie nasser Asphalt und Stahl).
   *
   * Sie ist die einzige Verkehrsklasse auf der untersten Stufe, und das mit
   * Absicht: Ein Strassenbahngleis IST im Stadtbild ein dunkles Band. Gegen die
   * Fahrbahn (92,7) stehen 37,9 L* — der groesste Abstand, den zwei
   * aneinandergrenzende Klassen dieser Karte haben. Genau das war die Aufgabe:
   * „Wenn eine Gleisstrasse wie eine Strasse aussieht, ist die Aufgabe nicht
   * erledigt."
   *
   * Sie teilt die Stufe mit Bauflaeche (Dab 12,5) und Bahnflaeche (Dab 6,5);
   * beide Beruehrungen sind selten und werden ueber die Farbtemperatur
   * getrennt. Zur Platte auf der Stufe darueber stehen 9,5 L*.
   *
   * KONTUR_BAHN statt NEBEN: Die Nebenkontur (L* 31,9) laege nur 22,8 L* unter
   * der Fuellung und riesse die Verkehrsregel (>= 30). Die Bahnkontur (22,1)
   * haelt 32,6 — und passt fachlich: die Gleiszone ist ein Bahnbauwerk.
   *
   * DER TON GILT AUCH FUER DEN OBERBAU. `OBERBAU_FARBEN.eindeckung` in
   * shared/bau/oberbau.ts traegt denselben Wert, und `pruefePalette` prueft
   * das: Flaeche und Koerper sind dasselbe Bauteil, sie duerfen nicht zwei
   * Farben haben.
   */
  gleiszone: { fuellung: '#728691', kontur: KONTUR_BAHN, konturBreiteM: 0.25, rang: 38, hoehenversatzM: 0.076 },

  /**
   * Fahrbahn (640 OSM-Flaechen — die gepufferte Achse, NICHT der ALKIS-Korridor).
   * Stufe 0, L* 92,67 / a* +0,02 / b* -1,09 — das HELLSTE Objekt der Szene.
   *
   * Angelehnt an basemap.de `Decker_Gemeindestr_Sonstige_Str` rgb(255,255,255)
   * = L* 100,0 und CARTO Positron `road_*_fill` #fff, abgedunkelt auf den vom
   * Auftrag gesetzten Deckel L* 93. Der Deckel hat einen Zweck: oberhalb
   * bleibt Platz fuer Figuren — eine hervorgehobene, gesperrte oder als
   * Rettungsweg gewidmete Fahrbahn muss sich noch abheben koennen, und dafuer
   * sind sieben L* nach oben reserviert.
   *
   * Dass die Fahrbahn das hellste Objekt ist und zugleich die dunkelste Kontur
   * traegt (DL* 62,6 — mehr als die 56,8 von basemap.de Grau), ist die
   * eigentliche Antwort auf „die strassen sind nicht zu erkennen"
   * (KARTENDESIGN 2.6, Punkt 3).
   *
   * ACHTUNG — DOPPELBELEGUNG: Diese Klasse gilt NUR fuer die OSM-Fahrbahn.
   * Der ALKIS-Korridor „Strassenverkehr" (113 Flaechen) meint den GESAMTEN
   * Strassenraum inklusive Gehweg, Parkstreifen und Bankett und darf NICHT
   * denselben Ton bekommen — sonst wird derselbe Raum zweimal als Fahrbahn
   * eingefaerbt. Dafuer gibt es PLATTE_STIL (siehe unten) und
   * `stilFuer(art, quelle)`.
   */
  fahrbahn: { fuellung: '#e9eaec', kontur: KONTUR_HAUPT, konturBreiteM: 0.30, rang: 42, hoehenversatzM: 0.084 },

  /**
   * Radweg (41 OSM-Flaechen). Entsaettigtes ZIEGELROT.
   *
   * REVISION 08.08.2026 (Auftraggeber-Vorgabe „Fahrradwege am besten leicht
   * rot"): Der fruehere kuehle Blaustich (#d2dbe6) war eine reine
   * Palettenlogik — in Deutschland sind Radwege und Radstreifen aber REAL
   * rot eingefaerbt (Rotmarkierung an Konfliktstellen, roter Belag). Die
   * Wirklichkeit liefert hier also selbst die Farbkonvention, und die Karte
   * wird durch die Uebernahme wahrer, nicht bunter: gewaehlt ist ein stark
   * entsaettigtes Ziegelrot im Basisband (a* deutlich positiv), das die
   * Signalfarben der Planobjekte (C* > 40) nicht beruehrt.
   * Gegen Gehweg und Fahrbahn traegt der a*- und b*-Abstand die Trennung
   * (Farbtemperatur statt Buntheit, KARTENDESIGN 3.2).
   * Liegt ueber der Fahrbahn (Rang 44), weil ein Radstreifen real AUF der
   * Fahrbahn markiert ist und fuer die Rettungswegplanung sichtbar bleiben muss.
   */
  radweg: { fuellung: '#c8b0ad', kontur: KONTUR_NEBEN, konturBreiteM: 0.20, rang: 44, hoehenversatzM: 0.088 },

  /**
   * Treppe. Stufe 2, L* 73,72 / a* +1,41 / b* +3,94 — Sichtbetonton, warm.
   * Sie liegt oben im Stapel (Rang 46): Stufen sind fuer Rettungsfahrzeuge,
   * Rollstuhl- und Anlieferverkehr eine Barriere und duerfen von keiner
   * anderen Verkehrsflaeche verdeckt werden.
   *
   * Sie teilt die Stufe mit Gehweg, Fussgaengerzone und Radweg; alle drei
   * Beruehrungen liegen unter der Messschwelle (299 / 352 / 5 m) und werden
   * ueber die Farbtemperatur getrennt (Dab 6,08 / 6,71 / 7,07). Die eigentliche
   * Aussage traegt ohnehin die GEOMETRIE: die Treppenflaechen werden als
   * Stufenkoerper gebaut und BELEUCHTET gezeichnet (web/src/scene/treppen.ts),
   * waehrend die Bodenzeichnung ungeschattet bleibt. Erst Licht und Schatten
   * machen aus einer Flaeche eine Treppe.
   */
  treppe: { fuellung: '#bbb4ae', kontur: KONTUR_NEBEN, konturBreiteM: 0.22, rang: 46, hoehenversatzM: 0.092 },
};

/**
 * DIE PLATTE — ALKIS-Strassenraum („Strassenverkehr", 113 Flaechen).
 *
 * Das ist die Aufloesung der Doppelbelegung ALKIS x OSM (KARTENDESIGN 5.2):
 *   ALKIS „Strassenverkehr" = der GESAMTE Strassenraum (Fahrbahn + Gehweg +
 *     Parkstreifen + Bankett) -> ruhige PLATTE, die Buehne
 *   OSM „fahrbahn"          = die befahrbare Fahrbahn -> heller DECKER darauf
 * Genau so trennt basemap.de `Verkehrsflaeche_*` (Flaeche) von `Kontur_*`/
 * `Decker_*` (Linie): beides gleichzeitig sichtbar, aber mit VERSCHIEDENER
 * ROLLE. Regel: kein Objekt bekommt in zwei Ebenen dieselbe Farbe.
 *
 * Stufe 3, L* 64,20 / a* -0,49 / b* -1,94.
 *
 * Sie ist mit 28.646 m die LAENGSTE Klassengrenze des Gebiets (an die
 * Fahrbahn), gefolgt von 18.035 m an die Bauflaeche und 16.230 m an den
 * Gehweg — die drei laengsten Grenzen ueberhaupt laufen alle an der Platte
 * entlang. Sie ist damit die Klasse, an der sich entscheidet, ob die Karte
 * funktioniert. Abstaende: 28,5 L* zur Fahrbahn, 9,5 zum Gehweg, 9,5 zur Bauflaeche.
 *
 * NUR DIE SCHWACHE BLOCKKANTE, keine Hauptkontur: Die Platte soll den
 * Strassenraum begrenzen, nicht selbst als Strasse lesen (KARTENDESIGN 5.2).
 * Bekaeme sie dieselbe Kontur wie die Fahrbahn, liefe entlang jeder Strasse
 * eine zweite dunkle Linie — die Strasse wuerde zum Liniengeflecht.
 * Rang 26: ueber allen Landschaftsflaechen, unter allen Verkehrs-Deckern.
 */
export const PLATTE_STIL: FlaechenStil = {
  fuellung: '#999c9f',
  kontur: KONTUR_BLOCK,
  konturBreiteM: 0.30,
  rang: 26,
  hoehenversatzM: 0.052,
};

// ===========================================================================
// 3  GEBAEUDE
// ===========================================================================

/**
 * Gebaeudematerialien.
 *
 * WARUM DAS DACH DUNKLER IST ALS DIE WAND — und warum das der Referenz
 * WIDERSPRICHT: Positron macht die Deckflaeche HELLER als die Seite
 * (`building-top` #ededed = L* 93,7 gegen `building` #dfdfdf = L* 88,8), Dark
 * Matter ebenso. Beides sind aber 2,5D-EXTRUSIONEN OHNE SONNE — dort muss das
 * Material die Beleuchtung ersetzen (KARTENDESIGN 4.1(1)).
 *
 * Wir haben eine echte Richtungsbeleuchtung. Sie erzeugt den Dach-/Wand-Kontrast
 * bereits. Wuerden wir das Dach zusaetzlich heller machen, brennen die besonnten
 * Dachflaechen aus und das Modell wird wieder „ein Haufen weisser Kloetze".
 * Das Material muss also GEGENLAEUFIG wirken: Dach dunkler und waermer.
 *
 * SPRUNGHOEHE: 10,51 L* (Wand 79,98 -> Dach 69,47). KARTENDESIGN 5.6 empfiehlt
 * „~10 L* dunkler und leicht waermer"; 10 L* ist zugleich die Regelgrenze fuer
 * „getrennt zu erkennende Flaechen" (>= 9). Mehr waere zu viel: bei 20 L*
 * Materialsprung plus Sonnenlicht kippen die schattenseitigen Daecher zu.
 * Die Waerme (b* +3,73 gegen +1,24) zitiert Ziegel, ohne Ziegelrot zu sein.
 */
export const GEBAEUDE_STIL = {
  /**
   * Wand. L* 79,98 / a* +0,33 / b* +1,24 (KARTENDESIGN 5.4: L* 80 / #c8c6c4).
   * 10,73 L* dunkler als die Bauflaeche darunter (90,71) — die Regel fuer
   * „getrennt zu erkennende Flaechen" (>= 9). Das Gebaeude steht damit ohne
   * jede Kante schon vom Ton her auf seinem Grundstueck.
   */
  wand: '#c8c6c4',

  /** Dach. L* 69,47 / a* +2,34 / b* +3,73 (KARTENDESIGN 5.4: L* 70 / #b2aaa4). */
  dach: '#b1a8a3',

  /**
   * First- und Gratlinie. L* 52,11 / a* +1,91 / b* +3,14.
   * Duenne, warme Linie auf First, Grat und Traufe. Sie ist die 3D-Entsprechung
   * des Casings (KARTENDESIGN 4.1(2), Cesium Silhouette/Edge-Stage): sie trennt
   * die Dachflaechen eines Sattel-, Walm-, Pult- oder Zeltdachs auch dann, wenn
   * beide Flaechen zufaellig gleich beleuchtet sind. Ohne sie geht die Dachform
   * — das einzige, was LoD2 gegenueber LoD1 voraushat — im Gegenlicht verloren.
   * 17,36 L* unter dem Dachton.
   */
  dachFirst: '#827b77',

  /**
   * Sockelband. L* 61,95 / a* +0,90 / b* +2,10, 18,03 L* unter der Wand.
   * Ein schmales dunkleres Band am Gebaeudefuss. Es ist der guenstige Ersatz
   * fuer Ambient Occlusion an genau der Stelle, an der AO am meisten leistet:
   * dort, wo Gebaeude auf Boden trifft. „AO ist die wirksamste Einzelmassnahme
   * gegen den Klotz-Eindruck" (KARTENDESIGN 4.1(3)). Ist die AO-Stage aktiv,
   * kann das Band schmaler ausfallen; ohne sie traegt es die Standfestigkeit
   * des Modells allein.
   */
  sockel: '#999592',

  /**
   * Silhouette / Gebaeudekante. L* 44,82, neutral.
   * 35,16 L* unter der Wand — dieselbe Groessenordnung wie eine Strassenkontur
   * zu ihrer Fuellung (>= 30). Das ist Absicht: die Kante IST das Casing des
   * Baukoerpers und trennt zwei aneinandergebaute Haeuser mit gleicher
   * Wandfarbe. (KARTENDESIGN 4.1(2))
   */
  kante: '#6a6a6a',
};

/**
 * DIE DACHLANDSCHAFT — die Toene, die WIRKLICH gezeichnet werden.
 *
 * Sie standen bis zum 10.08.2026 in web/src/scene/stadt.ts und waren damit fuer
 * `pruefePalette()` unsichtbar. Das ist genau einmal teuer geworden: Als die
 * Flaechenleiter neu gerechnet wurde, fiel die Bauflaeche von L* 90,71 auf
 * 54,68 — die Ziegeltoene (L* 54,09 bis 61,22) blieben stehen und lagen danach
 * mit DL* 0,59 bis 6,54 auf dem Untergrund, weit unter der eigenen Regel von 9.
 * Betroffen waren 1.144 von 4.053 Gebaeuden. Die Selbstpruefung schwieg, weil
 * sie `GEBAEUDE_STIL.dach` prueft — eine Farbe, die in keinem Zeichenaufruf
 * vorkommt.
 *
 * Die Lehre steht jetzt in der Anordnung: Was gezeichnet wird, wohnt bei der
 * Palette und wird geprueft. `GEBAEUDE_STIL.dach` bleibt als Bezugswert der
 * Dokumentation stehen, die Pruefung nimmt seit dem 10.08. DIESE Liste.
 *
 * DAS FENSTER, aus den Regeln der Datei abgeleitet:
 *   >= L* 63,68  (Bauflaeche 54,68 + MIN_DL_GETRENNT)
 *   >= L* 64,11  (Firstlinie 52,11 + 12, sonst traegt die Gratlinie nicht)
 *   <= L* 69,98  (Wand 79,98 - MIN_DL_WAND_DACH)
 *
 * Sechs Komma drei L* fuer drei Dacharten — die Helligkeit allein kann sie
 * nicht trennen. Sie trennt darum die WAERME (KARTENDESIGN 3.2): Ziegel warm
 * (b* rund +10), Pult halbwarm (+6), Flachdach neutral (0). Genau dafuer gibt
 * es `MIN_DAB_ERSATZ`, und die Pruefung unten wendet es an.
 */
export const DACH_TON = {
  /**
   * Ziegel, geneigt. Vier Alterungsstufen — Ziegel altern nie gleichmaessig.
   * L* 64,14 / 65,60 / 67,07 / 68,84, a* rund +9, b* rund +10.
   */
  ziegel: ['#bb9d91', '#b7998e', '#bfa296', '#b3958c'],
  /** Flachdach: Bitumen oder Kies, kuehl und neutral. L* 66,54 / 68,39 / 69,88. */
  flach: ['#a6a7a6', '#a1a2a2', '#aaabaa'],
  /**
   * Pultdach — zwischen beiden, meist Anbauten und Nebengebaeude.
   * L* 64,76 / 66,99. Am 10.08. waermer gestellt (b* +4,4 -> +6,3): gegen das
   * hellste Flachdach standen nur DL* 5,21 UND Dab 4,30 — beides unter der
   * Schranke, das Pultdach war vom Flachdach nicht zu unterscheiden.
   */
  pult: ['#aaa297', '#a49c92'],
};

/*
 * ENTFERNT AM 10.08.2026: `metall` (#b4bbbf) und `schiefer` (#8b9095).
 *
 * Beide waren fuer OSM `roof:material` gedacht und wurden nie gezeichnet —
 * `dachTonFuer()` in web/src/scene/stadt.ts kennt nur flach, pult und ziegel,
 * und der Importer traegt `roof:material` gar nicht ein. Aufgefallen sind sie
 * erst, als die Pruefung von einem Stellvertreter auf die echten Toene
 * umgestellt wurde: `metall` lag mit DL* 4,53 unter der Wand und haette den
 * Lauf rot gemacht — fuer eine Farbe, die niemand sieht.
 *
 * Zwei tote Zahlen zu behalten und stillzustellen waere der falsche Ausweg
 * gewesen. Wer die Unterscheidung will, traegt `roof:material` im Importer nach
 * (server/geodata/stadtdetails.ts, osmGebaeudeMerkmale) und rechnet die Toene
 * dann in DAS FENSTER dieser Datei — L* 63,68 bis 69,98.
 */

/**
 * Wandtoene fuer die Streuung ueber den Bestand — 5 sehr eng benachbarte Stufen.
 *
 * JA, VARIATION HILFT — ABER NUR IN DIESER GROESSENORDNUNG.
 * Die Recherche liefert keine Quelle, die Zufallsvariation von Gebaeudefarben
 * fordert; sie liefert aber zwei Zahlen, die den Rahmen genau festlegen:
 *  - Flaechenklassen unterscheiden sich in echten Kartenstilen um DL* 1,4 bis
 *    4,5 (basemap.de Grau, KARTENDESIGN 2.6/3.2). Eine Variation, die diesen
 *    Bereich erreicht, wuerde als KLASSENUNTERSCHIED gelesen — der Betrachter
 *    suchte dann nach einer Bedeutung, die es nicht gibt. Das ist exakt der
 *    Mechanismus, der die Gruenflaechen „random" wirken laesst (KARTENDESIGN 3.1).
 *  - Die Sichtbarkeitsschwelle liegt bei DL* ~0,4, „just objectionable" ab 0,8
 *    (Konica Minolta, KARTENDESIGN 3.2).
 * Daraus die Konstruktion: Schrittweite 1,0 L*, Gesamtspanne 3,98 L*.
 * Ueber der Sichtbarkeitsschwelle (0,4), UNTER dem kleinsten Klassenschritt
 * (1,4). Ergebnis: das Auge liest Materialkoernung, kein zweites Datenfeld.
 *
 * L*: 82,05 · 80,91 · 79,98 · 78,95 · 78,07 — GEBAEUDE_STIL.wand ist die Mitte.
 * a* und b* bleiben praktisch konstant (a* ~0, b* ~+1,0 bis +1,9): variiert wird
 * ausschliesslich die Helligkeit, nie der Farbton. „Helligkeit ordnet, Farbton
 * unterscheidet" (Brewer, KARTENDESIGN 3.1) — hier soll nichts unterschieden
 * werden, also nur Helligkeit.
 *
 * ZUTEILUNG: bitte NICHT per Math.random(). Zwei Gruende — es flackert bei
 * jedem Neuaufbau der Szene, und Google loest dasselbe Problem ausdruecklich
 * datengetrieben (Bestandsdichte -> Helligkeitsstufe, KARTENDESIGN 2.7 c).
 * Erste Wahl ist eine echte Eigenschaft (Gebaeudefunktion, Firsthoehe,
 * Baujahr); solange die fehlt, `gebaeudeVariante(id)` — stabil und
 * reproduzierbar aus der Gebaeude-ID.
 */
export const GEBAEUDE_VARIANTEN: string[] = ['#cdccc9', '#c9c9c7', '#c8c6c4', '#c6c3c0', '#c2c1be'];

/** Stabile, flimmerfreie Zuordnung einer Wandvariante ueber die Gebaeude-ID. */
export function gebaeudeVariante(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return GEBAEUDE_VARIANTEN[(h >>> 0) % GEBAEUDE_VARIANTEN.length];
}

// ===========================================================================
// 4  LICHT
// ===========================================================================

/**
 * Lichtfuehrung nach den Konventionen der Architekturvisualisierung
 * (KARTENDESIGN 4.2 — Praxisliteratur, keine Norm; entsprechend als uebliche
 * Werkspraxis zu lesen, nicht als Vorschrift).
 */
export const LICHT = {
  /**
   * Kompasspeilung, AUS DER das Licht kommt: 135 Grad = Suedost.
   * Zwei Gruende:
   *  - In der Architekturvisualisierung ist eine Sonne von oben links bei ca.
   *    45 Grad Hoehe die verbreitete Ausgangseinstellung (typische
   *    Sonnenlampen-Einstellung Rotation X 45, Z 135).
   *  - KARTENDESIGN 5.6 fordert ausdruecklich einen Azimut, der die
   *    Hauptstrassenrichtung SCHRAEG beleuchtet, nicht parallel. Die Darmstaedter
   *    Innenstadtachsen laufen grob Ost-West (Rheinstrasse) und Nord-Sued
   *    (Ludwigstrasse/Wilhelminenstrasse); 135 Grad steht zu beiden im 45-Grad-
   *    Winkel. Bei achsparallelem Licht bekaeme eine der beiden Strassenrichtungen
   *    zwei gleich helle Fassadenseiten und die Tiefe der Strassenschlucht ginge
   *    verloren.
   */
  azimutGrad: 135,

  /** Sonnenhoehe. 45 Grad — Ausgangseinstellung der Architekturvisualisierung. */
  hoeheGrad: 45,

  /**
   * Fuehrungslicht (key), normiert auf 1,0.
   * staerke / umgebungslicht = 1,00 / 0,40 = 2,5 : 1.
   * Lichtverhaeltnisse werden als key:fill angegeben; fuer Architektur- und
   * Planungsdarstellung ist ein WEICHES Verhaeltnis von 2:1 bis 3:1 ueblich
   * („one soft key light and a gentle fill keep architectural reveals, frames,
   * and relief legible"). Ein haerteres Verhaeltnis (5:1 und mehr) laesst
   * Schattenfassaden zulaufen — in einer Planungskarte verschwindet dann die
   * Haelfte aller Fassaden, und ein Standplatz an einer Schattenfassade waere
   * nicht mehr beurteilbar. (KARTENDESIGN 4.2)
   */
  staerke: 1.0,

  /**
   * Aufhelllicht (fill) / Umgebungsterm.
   * WICHTIG: als HIMMELSLICHT anwenden, nicht als konstanter Ambient-Term.
   * Ein konstanter Ambient hebt alle Flaechen gleichmaessig an und ist damit die
   * Hauptursache fuer „flach" (KARTENDESIGN 4.1(5)). Richtig ist ein
   * Himmelsgradient — oben heller als unten —, damit horizontale Flaechen
   * (Daecher, Strasse) auch im Schatten heller sind als vertikale (Fassaden).
   *
   * ERGAENZEND, aus KARTENDESIGN 5.6 (gehoert in den Renderer, nicht in diese
   * Datei): Ambient Occlusion EINSCHALTEN (Cesium
   * `PostProcessStageLibrary.createAmbientOcclusionStage`, Radius in der
   * Groessenordnung 0,5 m, `intensity` moderat) — die wirksamste Einzelmassnahme
   * gegen den Klotz-Eindruck. Silhouette/Edge duenn und dunkel dazu.
   * Bodenflaechen dagegen UNGESCHATTET lassen und ausschliesslich ueber Palette
   * und Kontur differenzieren, sonst konkurriert die Beleuchtung mit der
   * Kartenlogik (Figur-Grund, KARTENDESIGN 3.3).
   */
  umgebungslicht: 0.4,
};

// ===========================================================================
// 5  HILFSFUNKTIONEN
// ===========================================================================

/**
 * Stil einer Flaechenart.
 *
 * Der zweite Parameter ist optional und loest die Doppelbelegung ALKIS x OSM:
 * ALKIS „Strassenverkehr" landet in der Klassifikation als `fahrbahn`, meint
 * aber den GESAMTEN Strassenraum. Mit `stilFuer('fahrbahn', 'alkis')` bekommt
 * diese Geometrie die ruhige PLATTE statt des hellen Deckers — und derselbe
 * Strassenraum wird nicht mehr zweimal als Fahrbahn eingefaerbt.
 * (KARTENDESIGN 5.2)
 */
export function stilFuer(art: FlaechenArt, quelle?: 'alkis' | 'osm'): FlaechenStil {
  if (art === 'fahrbahn' && quelle === 'alkis') return PLATTE_STIL;
  return FLAECHEN_STIL[art] ?? FLAECHEN_STIL.sonstige;
}

// --- CIELAB ----------------------------------------------------------------

/** '#rgb' oder '#rrggbb' -> [r,g,b] in 0..255. */
function hexNachRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Kein Hexwert: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB-Kanal (0..255) -> linear (0..1), IEC 61966-2-1. */
function linear(kanal: number): number {
  const c = kanal / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Referenzweiss D65, 2-Grad-Beobachter. */
const WEISS: [number, number, number] = [95.047, 100.0, 108.883];

function labKurve(t: number): number {
  // delta = 6/29; Schwelle delta^3, linearer Ast mit Steigung 1/(3*delta^2)
  return t > 216 / 24389 ? Math.cbrt(t) : (t * 841) / 108 + 4 / 29;
}

/** Voller CIELAB-Wert eines Hexfarbwerts: [L*, a*, b*]. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = hexNachRgb(hex).map(linear) as [number, number, number];
  // sRGB -> XYZ (D65), Matrix nach IEC 61966-2-1
  const X = ((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100) / WEISS[0];
  const Y = ((0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100) / WEISS[1];
  const Z = ((0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100) / WEISS[2];
  const fx = labKurve(X);
  const fy = labKurve(Y);
  const fz = labKurve(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIELAB-Helligkeit L* eines Hexfarbwerts, echt gerechnet:
 * sRGB -> linear -> XYZ (D65) -> L*. 0 = Schwarz, 100 = Weiss.
 * Das ist die Groesse, in der die gesamte Recherche argumentiert — NICHT die
 * naive Kanalmittelung und nicht die Luminanz Y.
 */
export function lStern(hex: string): number {
  return lab(hex)[0];
}

/** Abstand in der a*b*-Ebene — das Mass fuer „Farbtemperatur-Unterschied". */
function abstandAB(x: string, y: string): number {
  const a = lab(x);
  const b = lab(y);
  return Math.hypot(a[1] - b[1], a[2] - b[2]);
}

/** Buntheit (Chroma) C* = hypot(a*, b*). */
function chroma(hex: string): number {
  const c = lab(hex);
  return Math.hypot(c[1], c[2]);
}

/** Relative Leuchtdichte nach WCAG 2.x. */
function leuchtdichte(hex: string): number {
  const [r, g, b] = hexNachRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Kontrastverhaeltnis nach WCAG 2.x, (L1+0,05)/(L2+0,05).
 * Massstab fuer die LINIEN der Karte — SC 1.4.11 „Non-text Contrast" verlangt
 * mindestens 3:1 gegen benachbarte Farben fuer grafische Objekte, die zum
 * Verstaendnis noetig sind.
 * (https://w3c.github.io/wcag21/understanding/21/non-text-contrast.html)
 */
function kontrast(a: string, b: string): number {
  const la = leuchtdichte(a);
  const lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// DIE GEMESSENE NACHBARSCHAFT
// ---------------------------------------------------------------------------

/**
 * Gemeinsame Klassengrenze in Metern, gemessen am Gelaende gel_b0650d4a952b8e25
 * („Heinerfest Darmstadt", 2.225 Flaechen) mit
 * `node scripts/flaechen-nachbarschaft.ts`.
 *
 * DAS IST DER GRUND, WARUM DIE LEITER SO AUSSIEHT, WIE SIE AUSSIEHT. Wer die
 * Palette aendert, prueft sie gegen DIESE Zahlen — nicht gegen eine Vorstellung
 * davon, was neben was liegt. Waechst das Gebiet oder kommt eine andere Stadt
 * hinzu, wird neu gemessen und die Tabelle hier ersetzt; das Skript schreibt
 * sie nach data/abnahme/flaechen-nachbarschaft.json.
 *
 * Schluessel: die beiden ZEICHENKLASSEN alphabetisch, mit „|" getrennt.
 * „platte" ist der ALKIS-Strassenraum (die Buehne), „fahrbahn" der OSM-Decker.
 */
export const NACHBARSCHAFT_M: Record<string, number> = {
  'fahrbahn|platte': 28646,
  'bebauung|platte': 18035,
  'gehweg|platte': 16230,
  'bebauung|fahrbahn': 12390,
  'bebauung|gehweg': 11992,
  'gehweg|gruen': 9885,
  'bebauung|fussgaengerzone': 6820,
  'bebauung|gruen': 5208,
  'fahrbahn|gehweg': 4774,
  'bebauung|weg': 2546,
  'fussgaengerzone|platte': 2486,
  'platte|radweg': 2197,
  'fussgaengerzone|platz': 1829,
  'gruen|platte': 1566,
  'fahrbahn|platz': 1313,
  'gehweg|platz': 1174,
  'gehweg|weg': 1133,
  'platte|platz': 976,
  'gruen|wald': 944,
  'fahrbahn|weg': 930,
  'fahrbahn|fussgaengerzone': 928,
  'gehweg|wald': 904,
  'gruen|radweg': 903,
  'bebauung|platz': 862,
  'bebauung|treppe': 738,
  'gruen|weg': 617,
  'fahrbahn|radweg': 607,
  'platte|weg': 600,
  'fussgaengerzone|gehweg': 597,
  'gruen|treppe': 456,
  'fussgaengerzone|treppe': 352,
  'platz|treppe': 303,
  'gehweg|treppe': 299,
  'fahrbahn|gruen': 265,
  'platte|wald': 225,
  'gehweg|radweg': 213,
  'radweg|weg': 202,
  'fussgaengerzone|gruen': 193,
  'fahrbahn|treppe': 176,
  'fussgaengerzone|weg': 171,
  'platte|treppe': 163,
  'gruen|wasser': 153,
  'bebauung|wald': 139,
  'platz|radweg': 135,
  'gruen|platz': 114,
  'treppe|weg': 72,
  'platz|wasser': 68,
  'bebauung|radweg': 62,
  'bebauung|wasser': 31,
  'fussgaengerzone|wasser': 28,
  'platz|weg': 21,
  'radweg|treppe': 5,
  'platte|wasser': 4,
};

/** Gesamte gemessene Klassengrenze im Pilotgebiet. */
export const NACHBARSCHAFT_GESAMT_M = 141681;

/**
 * Ab diesem Anteil an der Gesamtgrenze gilt ein Klassenpaar als „benachbart"
 * und muss den vollen Abstand von 9 L* tragen. 0,5 % sind rund 700 m
 * gemeinsame Kante.
 *
 * WARUM ES EINE SCHWELLE GIBT: Ohne sie beruehren sich 53 Klassenpaare, und
 * der Graph braeuchte NEUN Helligkeitsstufen (Band L* 93 … 21). Damit waere
 * die Basiskarte dunkler als CARTO Dark Matter und als Untergrund fuer
 * farbige Planobjekte unbrauchbar. Die Schwelle ist also kein Schoenreden,
 * sondern die Stelle, an der die beiden Anforderungen „grosse Abstaende" und
 * „enges Band" verhandelt werden — und sie ist offengelegt und messbar.
 * Paare unterhalb der Schwelle muessen ersatzweise die Farbtemperatur tragen.
 */
const NACHBAR_SCHWELLE_ANTEIL = 0.005;

// --- Schwellwerte aus der Recherche ----------------------------------------
// Jeder Wert hat eine Belegstelle. Wer hier etwas lockert, hebelt die Recherche
// aus — dann bitte KARTENDESIGN.md gegenlesen, nicht die Zahl anpassen.

/** Benachbarte Flaechenklassen (Vorgabe des Auftrags, 09.08.2026). */
const MIN_DL_NACHBAR = 9.0;
/** Kein Flaechenton heller (Vorgabe des Auftrags) — oben bleibt Platz fuer Figuren. */
const L_MAX_FLAECHE = 93.0;
/**
 * Ersatz fuer zu kleinen Helligkeitsabstand: Farbtemperatur. Positron kommt mit
 * 2,7 aus, wir fordern konservativ 5,0.
 * (Der frueher hier stehende Wert MIN_DL_FLAECHE = 1,4 — der kleinste Schritt,
 * den basemap.de Grau real faehrt — ist entfallen: Er hat die Helligkeitsleiter
 * geprueft, also welche Klassen zufaellig aehnlich hell sind. Geprueft wird
 * jetzt die gemessene Nachbarschaft, und dort gilt die Vorgabe 9,0.)
 */
const MIN_DAB_ERSATZ = 5.0;
/** Getrennt zu erkennende, NICHT aneinandergrenzende Flaechen (Wasser 82,0 -> Gebaeude 72,6). */
const MIN_DL_GETRENNT = 9.0;
/** Linien, die die Aussage tragen: WCAG 2.1 SC 1.4.11. */
const MIN_KONTRAST_LINIE = 3.0;
/** Verkehrsflaeche gegen ihre eigene Kontur (KARTENDESIGN 5.1). */
const MIN_DL_VERKEHRSKONTUR = 30.0;
/** Fahrbahn gegen ihre Kontur — der Sprung, der das Netz sichtbar macht (basemap.de: 56,8). */
const MIN_DL_FAHRBAHNKONTUR = 40.0;
/** Flaechenklasse gegen ihre Kontur = Objektgrenze. */
const MIN_DL_FLAECHENKONTUR = 10.0;
/** Wand gegen Dach (KARTENDESIGN 5.6: „~10 L* dunkler"). */
const MIN_DL_WAND_DACH = 10.0;
/** Gebaeudekante = Casing des Baukoerpers, gleiche Groessenordnung wie eine Strassenkontur. */
const MIN_DL_KANTE = 30.0;
/** Wandvarianten duerfen KEINE Klassenstufe vortaeuschen (oberes Ende des Flaechenbandes). */
const MAX_DL_VARIANTEN = 4.5;
/** Reservat der Planobjekte: dunkel UND bunt. Kein Basiston darf hier hinein. */
const PLAN_L_MAX = 65.0;
const PLAN_CHROMA_MIN = 40.0;

/**
 * Verkehrsklassen — sie unterliegen der strengen Konturregel (>= 30 L*), weil
 * ihre Kontur die Aussage TRAEGT: ohne sie muesste die Fuellung gegen jeden
 * wechselnden Untergrund ankommen (KARTENDESIGN 1.1).
 */
const VERKEHR: FlaechenArt[] = ['fahrbahn', 'platz', 'fussgaengerzone', 'gehweg', 'radweg', 'weg', 'treppe', 'bahn'];

/**
 * Die DECKER — Verkehrsflaechen, die auf der ALKIS-Platte liegen. Nur sie
 * muessen im Rang ueber ihr stehen. Die Bahnflaeche gehoert NICHT dazu: sie
 * ist eine eigene Verkehrsflaeche neben dem Strassenraum, kein Belag darauf,
 * und liegt darum im Rang unter der Platte.
 */
const VERKEHR_DECKER: FlaechenArt[] = ['fahrbahn', 'platz', 'fussgaengerzone', 'gehweg', 'radweg', 'weg', 'treppe'];

/**
 * ZEICHENKLASSE -> Ton. Der Nachbarschaftsgraph ist ueber Zeichenklassen
 * gemessen, nicht ueber Flaechenarten: „platte" (ALKIS-Strassenraum) und
 * „fahrbahn" (OSM-Decker) tragen dieselbe Flaechenart, sind aber zwei Toene.
 */
function tonDerZeichenklasse(klasse: string): string | null {
  if (klasse === 'platte') return PLATTE_STIL.fuellung;
  const s = FLAECHEN_STIL[klasse as FlaechenArt];
  return s ? s.fuellung : null;
}

/** Alle gezeichneten Flaechentoene mit Namen — Grundlage der Deckelpruefung. */
function alleFlaechentoene(): [string, string][] {
  return [
    ...(Object.keys(FLAECHEN_STIL) as FlaechenArt[]).map((a) => [a, FLAECHEN_STIL[a].fuellung] as [string, string]),
    ['PLATTE', PLATTE_STIL.fuellung] as [string, string],
    ['GELAENDEPLATTE', GRUNDTON] as [string, string],
  ];
}

/**
 * Prueft die Palette gegen die Vorgaben des Auftrags und die Regeln aus
 * KARTENDESIGN 3.2 / 5.1. Laeuft einmal beim Laden (stadt.ts) und meldet
 * jeden Befund in die Konsole — eine spaetere Farbaenderung darf keine der
 * Lesbarkeitsregeln unbemerkt reissen.
 */
export function pruefePalette(): { ok: boolean; befunde: string[] } {
  const befunde: string[] = [];
  const z2 = (v: number) => v.toFixed(2);

  // --- 1  Deckel: kein Flaechenton heller als L* 93 -------------------------
  // Oben muss Platz fuer Figuren bleiben — eine hervorgehobene, gesperrte oder
  // als Rettungsweg gewidmete Flaeche muss sich noch abheben koennen.
  for (const [name, hex] of alleFlaechentoene()) {
    const l = lStern(hex);
    if (l > L_MAX_FLAECHE) {
      befunde.push(
        `Flaechenton "${name}" (${hex}) ist mit L* ${z2(l)} heller als der Deckel ${L_MAX_FLAECHE} — ` +
          `oberhalb bleibt sonst kein Spielraum fuer hervorgehobene Flaechen.`,
      );
    }
  }

  // --- 2  GEMESSENE Nachbarschaft: DL* >= 9 ---------------------------------
  // Das ist die Kernpruefung der Neufassung. Sie laeuft NICHT ueber die
  // Helligkeitsleiter (welche Klassen zufaellig aehnlich hell sind), sondern
  // ueber den gemessenen Nachbarschaftsgraphen: welche Klassen im Bestand
  // wirklich aneinanderstossen und auf wie viel Laenge.
  //
  //   ueber der Schwelle: DL* >= 9, ohne Ausnahme
  //   darunter:           DL* >= 9 ODER Dab >= 5 (Farbtemperatur traegt)
  //
  // Gemeldet wird zusaetzlich, WIE VIEL Grenze ein Verstoss betrifft — eine
  // Zahl, mit der sich entscheiden laesst, ob er zaehlt.
  const schwelleM = NACHBAR_SCHWELLE_ANTEIL * NACHBARSCHAFT_GESAMT_M;
  let verletzteGrenzeM = 0;
  for (const [paar, laengeM] of Object.entries(NACHBARSCHAFT_M)) {
    const [a, b] = paar.split('|');
    const hexA = tonDerZeichenklasse(a);
    const hexB = tonDerZeichenklasse(b);
    if (!hexA || !hexB) {
      befunde.push(`Nachbarschaft "${paar}": unbekannte Zeichenklasse — die Messung passt nicht mehr zur Palette.`);
      continue;
    }
    const dl = Math.abs(lStern(hexA) - lStern(hexB));
    if (dl >= MIN_DL_NACHBAR) continue;
    const dab = abstandAB(hexA, hexB);
    if (laengeM >= schwelleM) {
      verletzteGrenzeM += laengeM;
      befunde.push(
        `Nachbarn "${a}" und "${b}" beruehren sich auf ${laengeM} m (${z2((100 * laengeM) / NACHBARSCHAFT_GESAMT_M)} % ` +
          `der Klassengrenze) und liegen nur DL* ${z2(dl)} auseinander — gefordert sind ${MIN_DL_NACHBAR}.`,
      );
      continue;
    }
    if (dab < MIN_DAB_ERSATZ) {
      verletzteGrenzeM += laengeM;
      befunde.push(
        `Nachbarn "${a}" und "${b}" (${laengeM} m, unter der Messschwelle) sind nicht trennbar: ` +
          `DL* ${z2(dl)} < ${MIN_DL_NACHBAR} UND Dab ${z2(dab)} < ${MIN_DAB_ERSATZ}. ` +
          `Eine der beiden Klassen in der Farbtemperatur gegenlaeufig fuehren.`,
      );
    }
  }
  if (verletzteGrenzeM > 0.02 * NACHBARSCHAFT_GESAMT_M) {
    befunde.push(
      `Insgesamt ${Math.round(verletzteGrenzeM)} m Klassengrenze ohne ausreichenden Abstand ` +
        `(${z2((100 * verletzteGrenzeM) / NACHBARSCHAFT_GESAMT_M)} % — mehr als die zugestandenen 2 %).`,
    );
  }

  // --- 3  Fuellung gegen ihre eigene Kontur ---------------------------------
  // Zwei Massstaebe, und der Unterschied ist inhaltlich:
  //  - VERKEHRSKLASSEN: die Kontur traegt die Aussage. Sie muss den vollen
  //    Helligkeitssprung halten UND das WCAG-Kriterium 1.4.11 (>= 3:1)
  //    erfuellen — es gilt genau fuer „grafische Objekte, die zum Verstaendnis
  //    noetig sind", und das ist ein Strassennetz.
  //  - FLAECHENKLASSEN (Gruen, Wald, Wasser, Bauflaeche): die Kontur ist eine
  //    Zugabe, die Aussage traegt die Flaeche. Dort genuegen 10 L*, und 3:1
  //    wird bewusst NICHT gefordert.
  for (const art of Object.keys(FLAECHEN_STIL) as FlaechenArt[]) {
    const s = FLAECHEN_STIL[art];
    if (!s.kontur) continue;
    const dl = lStern(s.fuellung) - lStern(s.kontur);
    const istVerkehr = VERKEHR.includes(art);
    const ziel = art === 'fahrbahn' ? MIN_DL_FAHRBAHNKONTUR : istVerkehr ? MIN_DL_VERKEHRSKONTUR : MIN_DL_FLAECHENKONTUR;
    if (dl < ziel) {
      befunde.push(`Kontur "${art}": DL* ${z2(dl)} < ${ziel} — die Flaeche liest nicht gegen ihren eigenen Saum.`);
    }
    if (istVerkehr) {
      const k = kontrast(s.fuellung, s.kontur);
      if (k < MIN_KONTRAST_LINIE) {
        befunde.push(
          `Kontur "${art}": Kontrast ${z2(k)}:1 < ${MIN_KONTRAST_LINIE}:1 — WCAG 2.1 SC 1.4.11 nicht erfuellt. ` +
            `Bei einer Linie, die das Netz sichtbar macht, ist das der massgebliche Wert.`,
        );
      }
    }
    if (!s.konturBreiteM || s.konturBreiteM <= 0) {
      befunde.push(`Kontur "${art}": konturBreiteM fehlt oder ist <= 0.`);
    }
  }
  {
    const dl = lStern(PLATTE_STIL.fuellung) - lStern(PLATTE_STIL.kontur ?? PLATTE_STIL.fuellung);
    if (dl < MIN_DL_FLAECHENKONTUR) befunde.push(`Kontur "PLATTE": DL* ${z2(dl)} < ${MIN_DL_FLAECHENKONTUR}.`);
  }

  // --- 4  Platte gegen Decker (die aufgeloeste Doppelbelegung) --------------
  {
    const dl = lStern(FLAECHEN_STIL.fahrbahn.fuellung) - lStern(PLATTE_STIL.fuellung);
    if (dl < MIN_DL_GETRENNT) {
      befunde.push(
        `ALKIS-Platte und OSM-Fahrbahn-Decker liegen mit DL* ${z2(dl)} < ${MIN_DL_GETRENNT} zu nah beieinander — ` +
          `der Strassenraum wuerde wieder als eine einzige Flaeche lesen (KARTENDESIGN 5.2).`,
      );
    }
    if (PLATTE_STIL.rang >= Math.min(...VERKEHR_DECKER.map((a) => FLAECHEN_STIL[a].rang))) {
      befunde.push('PLATTE_STIL.rang liegt nicht unter allen Verkehrs-Deckern — die Platte wuerde die Fahrbahn ueberdecken.');
    }
  }

  // --- 4b  Gleiszone: Flaeche und Koerper sind dasselbe Bauteil -------------
  // Die Gleiszone kommt zweimal vor: als Flaechenklasse (dieser Palette) und
  // als Eindeckung im Oberbau-Profil (shared/bau/oberbau.ts). Zwei Farben fuer
  // dasselbe Bauteil waeren genau die Bauart, die dieses Projekt schon Tage
  // gekostet hat — darum wird die Gleichheit geprueft und nicht nur behauptet.
  {
    const flaeche = FLAECHEN_STIL.gleiszone.fuellung.toLowerCase();
    const koerper = OBERBAU_FARBEN.eindeckung.toLowerCase();
    if (flaeche !== koerper) {
      befunde.push(
        `Gleiszone: die Flaechenklasse (${flaeche}) und die Eindeckung des Oberbaus (${koerper}) haben verschiedene Farben. ` +
          `Es ist dasselbe Bauteil — der Wert gehoert an EINE Stelle.`,
      );
    }
    // Die Schiene muss sich von ihrer Eindeckung abheben, sonst ist das Gleis
    // wieder nur ein Band. Sie ist der hellste Koerper der Szene.
    const dlSchiene = lStern(OBERBAU_FARBEN.schiene) - lStern(OBERBAU_FARBEN.eindeckung);
    if (dlSchiene < MIN_DL_VERKEHRSKONTUR) {
      befunde.push(`Oberbau: Schiene (L* ${z2(lStern(OBERBAU_FARBEN.schiene))}) hebt sich mit DL* ${z2(dlSchiene)} zu wenig von der Eindeckung ab.`);
    }
    // Und die Rille muss die dunkelste Stelle des Gleises sein — sie traegt
    // die Erkennung („zwei helle Striche mit je einer dunklen Nut daneben").
    const dlRille = lStern(OBERBAU_FARBEN.eindeckung) - lStern(OBERBAU_FARBEN.rille);
    if (dlRille < 20) {
      befunde.push(`Oberbau: Rille (L* ${z2(lStern(OBERBAU_FARBEN.rille))}) liegt nur DL* ${z2(dlRille)} unter der Eindeckung — die Nut verschwindet.`);
    }
  }

  // --- 5  Gebaeude ----------------------------------------------------------
  {
    const wand = lStern(GEBAEUDE_STIL.wand);
    const dach = lStern(GEBAEUDE_STIL.dach);
    if (wand - dach < MIN_DL_WAND_DACH) {
      befunde.push(`Gebaeude: Wand ${z2(wand)} - Dach ${z2(dach)} = DL* ${z2(wand - dach)} < ${MIN_DL_WAND_DACH} — die Dachform wird flau.`);
    }
    const kante = lStern(GEBAEUDE_STIL.kante);
    if (wand - kante < MIN_DL_KANTE) {
      befunde.push(`Gebaeude: Kante zu hell (DL* ${z2(wand - kante)} < ${MIN_DL_KANTE}) — aneinandergebaute Haeuser verschmelzen.`);
    }
    // BETRAG, nicht Differenz: Seit die Bauflaeche auf Stufe 4 (L* 54,7) liegt,
    // ist die Gebaeudewand HELLER als ihr Grundstueck statt dunkler. Die Regel
    // meint den ABSTAND — welche Seite heller ist, entscheidet die Karte.
    // Ebenso muss die DACHflaeche vom Baufeld abgesetzt sein: aus der Vogel-
    // perspektive stossen genau diese beiden aneinander, nicht Wand und Feld.
    const bau = lStern(FLAECHEN_STIL.bebauung.fuellung);
    if (Math.abs(bau - wand) < MIN_DL_GETRENNT) {
      befunde.push(`Gebaeudewand ${z2(wand)} hebt sich nicht von der Bauflaeche ${z2(bau)} ab (DL* ${z2(Math.abs(bau - wand))} < ${MIN_DL_GETRENNT}).`);
    }
    if (Math.abs(bau - dach) < MIN_DL_GETRENNT) {
      befunde.push(
        `Dachflaeche ${z2(dach)} hebt sich nicht von der Bauflaeche ${z2(bau)} ab (DL* ${z2(Math.abs(bau - dach))} < ${MIN_DL_GETRENNT}) — ` +
          `aus der Vogelperspektive verschmelzen Flachdach und Baufeld.`,
      );
    }

    /*
     * DIE DACHTOENE, DIE WIRKLICH GEZEICHNET WERDEN.
     *
     * Bis zum 10.08.2026 prueften die zwei Zeilen darueber `GEBAEUDE_STIL.dach`
     * — eine Farbe, die in keinem Zeichenaufruf vorkommt. Die Pruefung bestand
     * damit, waehrend 1.144 Gebaeude mit DL* 0,59 auf dem Untergrund lagen.
     * Geprueft wird darum jetzt JEDER Ton aus DACH_TON, einzeln, und nicht ein
     * Stellvertreter.
     */
    const dachToene: [string, string][] = [
      ...DACH_TON.ziegel.map((h) => ['Ziegeldach', h] as [string, string]),
      ...DACH_TON.flach.map((h) => ['Flachdach', h] as [string, string]),
      ...DACH_TON.pult.map((h) => ['Pultdach', h] as [string, string]),
    ];
    for (const [name, hex] of dachToene) {
      const l = lStern(hex);
      if (Math.abs(bau - l) < MIN_DL_GETRENNT) {
        befunde.push(
          `${name} ${hex} (L* ${z2(l)}) hebt sich nicht von der Bauflaeche ${z2(bau)} ab ` +
            `(DL* ${z2(Math.abs(bau - l))} < ${MIN_DL_GETRENNT}) — aus der Vogelperspektive verschmelzen Dach und Baufeld.`,
        );
      }
      if (wand - l < MIN_DL_WAND_DACH) {
        befunde.push(`${name} ${hex} (L* ${z2(l)}) liegt nur DL* ${z2(wand - l)} < ${MIN_DL_WAND_DACH} unter der Wand — die Dachform wird flau.`);
      }
    }
    /*
     * UND DIE DACHARTEN GEGENEINANDER. Das Fenster zwischen Bauflaeche und Wand
     * ist nur 6,3 L* breit; drei Dacharten passen dort nicht mit Helligkeit
     * hinein. Sie duerfen sich darum ueber die WAERME trennen — aber sie
     * muessen sich trennen, sonst sieht jede Stadt gleich aus.
     */
    for (const [aName, aListe] of [
      ['Ziegeldach', DACH_TON.ziegel],
      ['Pultdach', DACH_TON.pult],
    ] as [string, string[]][]) {
      for (const [bName, bListe] of [
        ['Flachdach', DACH_TON.flach],
        ['Pultdach', DACH_TON.pult],
      ] as [string, string[]][]) {
        if (aName === bName) continue;
        for (const a of aListe) {
          for (const b of bListe) {
            const dl = Math.abs(lStern(a) - lStern(b));
            const dab = abstandAB(a, b);
            if (dl < MIN_DL_GETRENNT && dab < MIN_DAB_ERSATZ) {
              befunde.push(
                `${aName} ${a} und ${bName} ${b} sind nicht zu unterscheiden: DL* ${z2(dl)} < ${MIN_DL_GETRENNT} UND ` +
                  `Dab ${z2(dab)} < ${MIN_DAB_ERSATZ}.`,
              );
            }
          }
        }
      }
    }
    const first = lStern(GEBAEUDE_STIL.dachFirst);
    if (dach - first < 12) befunde.push(`Gebaeude: Firstlinie zu hell (DL* ${z2(dach - first)} < 12) — Sattel- und Walmdach lesen gleich.`);
    const sockel = lStern(GEBAEUDE_STIL.sockel);
    if (wand - sockel < 12) befunde.push(`Gebaeude: Sockelband zu hell (DL* ${z2(wand - sockel)} < 12) — die Haeuser schweben.`);
  }

  // --- 6  Wandvarianten: sichtbar, aber unterhalb einer Klassenstufe --------
  if (GEBAEUDE_VARIANTEN.length) {
    const werte = GEBAEUDE_VARIANTEN.map(lStern);
    const spanne = Math.max(...werte) - Math.min(...werte);
    if (spanne > MAX_DL_VARIANTEN) {
      befunde.push(
        `Gebaeude-Wandvarianten spannen DL* ${z2(spanne)} > ${MAX_DL_VARIANTEN} — das liest der Betrachter als ` +
          `Klassenunterschied und sucht eine Bedeutung, die es nicht gibt (KARTENDESIGN 3.1).`,
      );
    }
    for (const [i, hex] of GEBAEUDE_VARIANTEN.entries()) {
      if (Math.abs(lStern(hex) - lStern(GEBAEUDE_STIL.wand)) > 3.0) {
        befunde.push(`Wandvariante ${i} (${hex}) weicht mehr als 3 L* vom Grundton der Wand ab.`);
      }
    }
  }

  // --- 7  Reservat der Planobjekte ------------------------------------------
  // „Kein Planobjekt darf einen der Basistoene wiederverwenden" heisst umgekehrt:
  // kein Basiston darf im Reservat liegen (dunkel UND BUNT).
  //
  // Seit der Neufassung reicht das Flaechenband bis L* 54,7 und damit IN den
  // dunklen Bereich hinein. Das ist zulaessig, weil das Reservat ueber ZWEI
  // Bedingungen definiert ist: dunkel UND bunt. Die dunkelsten Basistoene sind
  // fast neutral (Bauflaeche C* 3,0 · Bahn C* 4,2 · Platte C* 2,0), waehrend
  // ein Rettungsweg-Magenta bei C* > 50 liegt. Die Buntheit bleibt damit
  // vollstaendig den Planobjekten vorbehalten — nur die Helligkeit teilen sie
  // sich jetzt mit dem Grund.
  const alleBasistoene: [string, string][] = [
    ['GRUNDTON', GRUNDTON],
    ['HIMMEL', HIMMEL],
    ['PLATTE', PLATTE_STIL.fuellung],
    ...(Object.keys(FLAECHEN_STIL) as FlaechenArt[]).flatMap<[string, string]>((a) => {
      const s = FLAECHEN_STIL[a];
      return s.kontur ? [[a, s.fuellung], [`${a}/kontur`, s.kontur]] : [[a, s.fuellung]];
    }),
    ...Object.entries(GEBAEUDE_STIL),
  ];
  for (const [name, hex] of alleBasistoene) {
    if (lStern(hex) < PLAN_L_MAX && chroma(hex) > PLAN_CHROMA_MIN) {
      befunde.push(
        `Basiston "${name}" (${hex}, L* ${z2(lStern(hex))}, C* ${z2(chroma(hex))}) liegt im Reservat der Planobjekte ` +
          `(L* < ${PLAN_L_MAX} und C* > ${PLAN_CHROMA_MIN}) — Rettungswege und Sperrungen verloeren dort ihre Wirkung.`,
      );
    }
  }

  // --- 8  Zeichenreihenfolge --------------------------------------------------
  const raenge = new Map<number, string>();
  for (const art of Object.keys(FLAECHEN_STIL) as FlaechenArt[]) {
    const s = FLAECHEN_STIL[art];
    const belegt = raenge.get(s.rang);
    if (belegt) befunde.push(`Rang ${s.rang} doppelt belegt: "${belegt}" und "${art}" — die Zeichenreihenfolge ist nicht bestimmt.`);
    raenge.set(s.rang, art);
    const erwartet = s.rang * 0.002;
    if (Math.abs(s.hoehenversatzM - erwartet) > 1e-9) {
      befunde.push(`"${art}": hoehenversatzM ${s.hoehenversatzM} passt nicht zu rang ${s.rang} (erwartet ${erwartet.toFixed(3)} m) — Flimmergefahr.`);
    }
  }
  if (Math.abs(PLATTE_STIL.hoehenversatzM - PLATTE_STIL.rang * 0.002) > 1e-9) {
    befunde.push('PLATTE_STIL: hoehenversatzM passt nicht zum Rang.');
  }
  if (KONTUR_VERSATZ_M >= 0) befunde.push('KONTUR_VERSATZ_M muss negativ sein — die Kontur liegt UNTER ihrer Fuellung.');

  // --- 9  Lichtverhaeltnis ---------------------------------------------------
  const verhaeltnis = LICHT.staerke / LICHT.umgebungslicht;
  if (verhaeltnis < 2 || verhaeltnis > 3) {
    befunde.push(
      `key:fill = ${z2(verhaeltnis)}:1 liegt ausserhalb von 2:1 bis 3:1 (KARTENDESIGN 4.2). ` +
        `Haerter laesst Schattenfassaden zulaufen, weicher nimmt dem Modell die Tiefe.`,
    );
  }

  return { ok: befunde.length === 0, befunde };
}
