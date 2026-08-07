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
 *       Fahrbahn L* 96,9 gegen Hauptkontur L* 48,0 = DL* 48,9 — noch mehr als der
 *       Abstand, den basemap.de Grau fuer seine Fahrbahn faehrt (100,0 -> 43,2 =
 *       56,8; KARTENDESIGN 2.6). Die Fahrbahn ist wieder das hellste Objekt der
 *       Szene und traegt zugleich die dunkelste Kontur.
 * 2. „die gruenflaechen sind etwas random"
 *    -> EINE Gruenfamilie mit Helligkeitsrampe statt mehrerer Gruens:
 *       landwirtschaft L* 88,6 -> gruen L* 85,5 -> wald L* 74,0, gleiche a* und b*-
 *       Richtung, nur zunehmend staerker. Vorbild basemap.de, das Wald/Gehoelz
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

// ===========================================================================
// 1  GRUNDTON UND HIMMEL
// ===========================================================================

/**
 * ENTSCHEIDUNG: HELLER GRUND. Bewusst gegen den bisherigen dunklen Stand.
 *
 * Begruendung (KARTENDESIGN 3.3, Figur-Grund):
 *
 * 1. Der freie Helligkeitsbereich fuer die Planobjekte ist bei einer hellen
 *    Basis mit engem Band am groessten. Gemessen an den Referenzsystemen:
 *      CARTO Positron (hell)     L* 85,3–100,0  Band 14,7  -> 85 L* frei
 *      basemap.de Grau (hell)    L* 82,0–100,0  Band 18,0  -> 82 L* frei
 *      CARTO Dark Matter (dunkel) L*  4,0– 36,8 Band 32,8  -> 63 L* frei
 *    Unsere Flaechen liegen bei L* 74,0–96,9, Band 22,9 — vergleichbar eng.
 *    Damit bleibt ALLES unterhalb L* ~65 fuer Planobjekte reserviert.
 * 2. Genau darauf kommt es hier an: rote Rettungswege, bunte Fahrgeschaefte,
 *    Zelte und Sperrungen liegen OBENAUF. Auf hellem Grund duerfen sie
 *    gleichzeitig DUNKLER und BUNTER sein als alles darunter — sie haben eine
 *    ganze Wahrnehmungsdimension fuer sich allein. Auf dunklem Grund muesste
 *    dieselbe Signalfarbe aufgehellt werden und verloere dabei Saettigung.
 *    Ein kraeftiges Rettungsweg-Magenta (L* ~45–55, Chroma > 50) hebt sich vom
 *    hellen Grund mit DL* ~40 ab; gegen Dark Matter waere es ein Kampf.
 * 3. Alle amtlichen und alle overlay-orientierten Referenzen sind hell:
 *    Positron 98,2 · basemap.de Farbe 99,1 · basemap.de Grau 100,0 ·
 *    OSM Carto 94,5 · Mapbox Light 94,1. Nur die reinen „Darstellungs"-Stile
 *    (Dark Matter 4,0; Google Night mode 19,0) gehen dunkel — und die sind
 *    nicht dafuer gebaut, dass Fachdaten darauf gelesen werden.
 * 4. Ein LEICHT WARMER Grund (b* +3 bis +7, wie OSM Carto #f2efe9 und
 *    basemap.de rgb(255,253,238)) laesst die kuehlen Verkehrs- und Wassertoene
 *    ohne jede Buntheit hervortreten — Farbtemperaturkontrast statt
 *    Saettigungskontrast. Genau das brauchen wir fuer „keine bunte Masse".
 *
 * ANMERKUNG ZUM ABENDSZENARIO: Fuer Nachtbetrieb beim Heinerfest waere nach
 * KARTENDESIGN 3.3 eine dunkle Fassung nach Dark-Matter-Muster moeglich (Band
 * eng bei L* 4–30, Strassen kuehl-blaugrau b* ~ -10, Planobjekte ausschliesslich
 * oberhalb L* 55). Sie waere aus DIESER Palette abzuleiten, nicht getrennt zu
 * pflegen. Hier bewusst nicht implementiert — erst wenn jemand sie anfordert.
 *
 * Wert: L* 92,95 / a* +0,65 / b* +4,59.
 * Angelehnt an den Grundton-Vorschlag KARTENDESIGN 5.4 (L* 92, a* +0,5,
 * b* +2,5), leicht waermer gefuehrt (b* +4,6), damit der Abstand zu den kuehlen
 * Verkehrsflaechen auch bei fast gleicher Helligkeit traegt.
 */
export const GRUNDTON = '#f0eae2';

/**
 * Himmel: blasses, kuehles Duns.
 * L* 94,00 / a* -1,49 / b* -4,89.
 * Bewusst 2,9 L* DUNKLER als die Fahrbahn (96,9) und deutlich kuehler als der
 * Grundton (b* -4,9 gegen +4,6). Zwei Gruende:
 *  - Figur-Grund: die Stadt soll das hellste Element im Bild sein, nicht der
 *    Himmel. „Some features … will appear to be in the foreground … while other
 *    features (the pale, desaturated, and plain ones) will appear to be in the
 *    background." (Esri, zitiert in KARTENDESIGN 3.3)
 *  - Der Farbtemperatursprung zum warmen Boden erzeugt eine saubere
 *    Horizontkante ohne eine einzige gesaettigte Farbe.
 */
export const HIMMEL = '#e6eff7';

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
 * Hauptkontur — Fahrbahn, Platz, Fussgaengerzone.
 * L* 48,01 / a* +0,03 / b* -1,24. Neutral mit einem Hauch Kuehle.
 * Angelehnt an basemap.de Grau `Kontur aller Strassen` rgb(102,102,102) = L* 43,2,
 * um 4,8 L* aufgehellt, weil unser Grundton (92,95) heller ist als basemap.des
 * Reinweiss-Hintergrund und die Kontur sonst als schwarzer Strich ueberzeichnet.
 */
export const KONTUR_HAUPT = '#717274';

/**
 * Nebenkontur — Gehweg, Radweg, Weg, Treppe.
 * L* 51,93 / a* -0,14 / b* -1,89. Vier L* heller als die Hauptkontur.
 * Der Abstand ist absichtlich klein: er stuft die Hierarchie ab, ohne den
 * Mindestabstand von 30 L* zur eigenen Fuellung zu gefaehrden. Der Nebenkontur-
 * Vorschlag aus KARTENDESIGN 5.4 (L* 70) wurde VERWORFEN — er haette dem Gehweg
 * nur DL* 20 zur Kontur gelassen und damit die eigene Regel aus 5.1 („Fuellung
 * zur Kontur >= 30 L*") gerissen. Die strengere Regel gewinnt, denn genau der
 * Gehweg ist mit 736 Flaechen die haeufigste Klasse im Bestand.
 */
export const KONTUR_NEBEN = '#7a7c7f';

/** Vegetationskontur, gedaempftes Gruen. L* 61,97 / a* -7,04 / b* +8,24. */
export const KONTUR_GRUEN = '#8f9987';
/** Waldkontur, eine Stufe dunkler und satter — setzt die Gruenrampe fort. L* 57,98. */
export const KONTUR_WALD = '#80907a';
/** Uferlinie. L* 60,02 / a* -4,92 / b* -10,06 — kuehl, gleiche Richtung wie das Wasser. */
export const KONTUR_WASSER = '#7d94a2';
/**
 * Bahnkontur. L* 39,90, neutral. Angelehnt an basemap.de `Bahnstrecke_Eisenbahn`
 * rgb(102,102,102) = L* 43,2, hier etwas dunkler, weil unser Grund heller ist.
 * Die Bahn ist neben der Strassenkontur das dunkelste Basis-Element — so wie in
 * basemap.de Grau, wo die Bahn (21,2) unter der Strassenkontur (43,2) liegt.
 */
export const KONTUR_BAHN = '#5e5e5e';
/**
 * Blockkante — Bauflaechen und die ALKIS-Strassenraumplatte. L* 76,04.
 * BEWUSST SCHWACH: „Keine eigene starke Kontur, nur eine schwache Grenze gegen
 * Bauflaechen" (KARTENDESIGN 5.2). Sie soll die Blockstruktur der Stadt zeigen,
 * ohne mit dem Strassennetz um Aufmerksamkeit zu konkurrieren.
 */
export const KONTUR_BLOCK = '#bebbb8';
/** Ackerkante, blass gruen-gelb. L* 72,14. */
export const KONTUR_LANDW = '#b0b39c';

/** Die Kontur liegt 1 mm UNTER ihrer Fuellung. */
export const KONTUR_VERSATZ_M = -0.001;

/**
 * ---------------------------------------------------------------------------
 * HELLIGKEITSTABELLE — nachgerechnet, nicht geschaetzt
 * ---------------------------------------------------------------------------
 * L* echt gerechnet: sRGB -> linear -> XYZ (D65) -> CIELAB. Sortiert von hell
 * nach dunkel. „Abstand" = DL* zum naechsten Eintrag darunter in DIESER Liste,
 * also zum unmittelbaren Helligkeits-Nachbarn.
 *
 * Regel (KARTENDESIGN 3.2, Arbeitsregel fuer EventPlan3D):
 *   Flaechen             DL* >= 1,4   (kleinster Schritt, den basemap.de Grau
 *                                      tatsaechlich faehrt: 95,5 -> 94,1)
 *   ODER ersatzweise     Dab >= 5,0   (Farbtemperatur statt Helligkeit; Positron
 *                                      trennt Wasser vom Grund mit nur 2,7 b*-
 *                                      Einheiten, wir fordern konservativ 5,0)
 *
 * Art               | Hex     |   L*  | Abstand | Ersatz-Dab | Familie
 * ------------------|---------|-------|---------|------------|------------------
 * fahrbahn          | #f5f6f8 | 96,86 |    2,39 |     —      | Verkehr kuehl
 * platz             | #efeff0 | 94,47 |    1,52 |     —      | Verkehr kuehl
 * GRUNDTON          | #f0eae2 | 92,95 |    0,90 |    6,58 ok | neutral warm
 * fussgaengerzone   | #dfebe6 | 92,05 |    1,34 |    5,35 ok | Verkehr, Mintstich
 * bebauung          | #e7e4e0 | 90,71 |    1,61 |     —      | neutral warm
 * gehweg            | #dee0e3 | 89,10 |    0,49 |   18,67 ok | Verkehr kuehl
 * landwirtschaft    | #dfe1c0 | 88,61 |    0,75 |   14,60 ok | Vegetation
 * sonstige          | #dfdcd7 | 87,86 |    0,83 |    9,31 ok | neutral warm
 * radweg            | #d2dbe6 | 87,03 |    1,57 |     —      | Verkehr, kalt b* -6,4
 * gruen             | #ccdac3 | 85,46 |    0,49 |   11,28 ok | Vegetation
 * weg               | #dbd3cb | 84,98 |    1,95 |     —      | Verkehr, warm b* +4,9
 * treppe            | #cdcfd1 | 83,02 |    1,55 |     —      | Verkehr kuehl
 * wasser            | #b7cedb | 81,47 |    2,49 |     —      | Wasser
 * bahn              | #c4c3c7 | 78,98 |    4,99 |     —      | neutral
 * wald              | #a8bc9c | 73,99 |    —    |     —      | Vegetation
 *
 * Flaechenband: L* 73,99 – 96,86 = 22,87 Einheiten.
 * Zum Vergleich: basemap.de Grau 18,0 · Positron 14,7 · Vorschlag KARTENDESIGN 5.4 21,0.
 * Alles unterhalb L* ~65 bleibt damit den Planobjekten vorbehalten.
 *
 * Ausserhalb der Leiter, weil sie nie als gleichrangige Nachbarflaeche auftreten:
 *   PLATTE (ALKIS-Strassenraum)  #d6d8db  L* 86,27  — liegt immer UNTER den Deckern
 *
 * ---------------------------------------------------------------------------
 * KONTURABSTAENDE — Fuellung gegen ihren eigenen Saum
 * ---------------------------------------------------------------------------
 * Regel: Verkehrsflaeche >= 30 L*, Fahrbahn >= 40 L*, Flaechenklasse >= 10 L*
 * (KARTENDESIGN 5.1 und 3.2)
 *
 * Klasse            | Fuellung L* | Kontur          L* | DL*   | Ziel  | ok
 * ------------------|-------------|--------------------|-------|-------|----
 * fahrbahn          |    96,86    | HAUPT       48,01  | 48,85 | >= 40 | ok
 * platz             |    94,47    | HAUPT       48,01  | 46,46 | >= 30 | ok
 * fussgaengerzone   |    92,05    | HAUPT       48,01  | 44,04 | >= 30 | ok
 * gehweg            |    89,10    | NEBEN       51,93  | 37,17 | >= 30 | ok
 * radweg            |    87,03    | NEBEN       51,93  | 35,10 | >= 30 | ok
 * weg               |    84,98    | NEBEN       51,93  | 33,04 | >= 30 | ok
 * treppe            |    83,02    | NEBEN       51,93  | 31,09 | >= 30 | ok
 * bahn              |    78,98    | BAHN        39,90  | 39,07 | >= 10 | ok
 * gruen             |    85,46    | GRUEN       61,97  | 23,49 | >= 10 | ok
 * wald              |    73,99    | WALD        57,98  | 16,01 | >= 10 | ok
 * wasser            |    81,47    | WASSER      60,02  | 21,45 | >= 10 | ok
 * bebauung          |    90,71    | BLOCK       76,04  | 14,68 | >= 10 | ok
 * landwirtschaft    |    88,61    | LANDW       72,14  | 16,47 | >= 10 | ok
 * PLATTE            |    86,27    | BLOCK       76,04  | 10,23 | >= 10 | ok
 * sonstige          |    87,86    | (keine)            |   —   |   —   | —
 */
export const FLAECHEN_STIL: Record<FlaechenArt, FlaechenStil> = {
  // -------------------------------------------------------------------------
  // FAMILIE 1 — NEUTRAL WARM: das ruhige Gewebe, auf dem alles andere liegt.
  // Raenge 10–14, ganz unten. Diese Flaechen sind Grund, nicht Figur.
  // -------------------------------------------------------------------------

  /**
   * Auffangklasse. L* 87,86 / a* +0,14 / b* +2,81.
   * Bewusst OHNE Kontur: was wir nicht benennen koennen, soll auch keine Kante
   * behaupten. Das ist die ehrliche Darstellung fehlender Information — und es
   * haelt die Zahl der gleichzeitig sichtbaren Flaechenklassen unter der
   * Wahrnehmungsgrenze von ~7 (KARTENDESIGN 3.1).
   * Ton angelehnt an OSM Carto `@residential` #e0dfdf, leicht erwaermt.
   */
  sonstige: { fuellung: '#dfdcd7', rang: 10, hoehenversatzM: 0.020 },

  /**
   * Ackerland / Gartenland. L* 88,61 / a* -6,21 / b* +15,95.
   * Der HELLSTE und gelblichste Punkt der Gruenrampe — so wie in jeder Referenz:
   * OSM Carto `@farmland` #eef0d5, basemap.de fuehrt Ackerland sogar exakt im
   * Hintergrundton rgb(255,253,238) (KARTENDESIGN 2.4, 2.5). Nutzflaeche ist
   * heller als Bewuchs; erst der Bewuchs wird gruen und dunkel.
   */
  landwirtschaft: { fuellung: '#dfe1c0', kontur: KONTUR_LANDW, konturBreiteM: 0.35, rang: 12, hoehenversatzM: 0.024 },

  /**
   * Bauflaechen (264 ALKIS-Flaechen — die haeufigste Klasse ueberhaupt).
   * L* 90,71 / a* +0,31 / b* +2,30.
   * Sie ist die Buehne der Stadt und traegt eine SCHWACHE Blockkante, damit die
   * Blockstruktur lesbar wird, ohne mit dem Strassennetz zu konkurrieren
   * (KARTENDESIGN 5.2). Ton zwischen Positron `landuse_residential` #ededed
   * (L* 93,7) und OSM Carto `@residential` #e0dfdf (L* ~89), warm gefuehrt wie
   * der Grundton, damit Bauflaeche und Grund als EINE Familie lesen.
   * Absichtlich 2,24 L* dunkler als GRUNDTON: der unbekannte Untergrund darf
   * nicht heller wirken als eine benannte Flaeche.
   */
  bebauung: { fuellung: '#e7e4e0', kontur: KONTUR_BLOCK, konturBreiteM: 0.30, rang: 14, hoehenversatzM: 0.028 },

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
   * Wald / Baumgruppe. L* 73,99 / a* -12,79 / b* +13,92 — das dunkelste Ende
   * der Gruenrampe und zugleich die dunkelste Basisflaeche ueberhaupt.
   * Angelehnt an basemap.de `VegetationsF_Wald` in der Nahstufe rgb(154,182,109)
   * = L* 70,5, um 3,5 L* aufgehellt und entsaettigt, damit es nicht bunt wird.
   */
  wald: { fuellung: '#a8bc9c', kontur: KONTUR_WALD, konturBreiteM: 0.40, rang: 16, hoehenversatzM: 0.032 },

  /**
   * Gruenflaeche / Park / Rasen. L* 85,46 / a* -8,85 / b* +9,72.
   * Aus KARTENDESIGN 5.4 (L* 87 / a* -9 / b* +10) uebernommen, um 1,5 L*
   * abgesenkt, damit der Abstand zum Radweg (87,03) sauber traegt.
   * Deutlich entsaettigter als OSM Carto `@park` #c8facc — dort ist Gruen ein
   * Signal, hier ist es Untergrund.
   */
  gruen: { fuellung: '#ccdac3', kontur: KONTUR_GRUEN, konturBreiteM: 0.35, rang: 18, hoehenversatzM: 0.036 },

  // -------------------------------------------------------------------------
  // FAMILIE 3 — WASSER: der einzige klar blaue Ton der Basiskarte.
  // -------------------------------------------------------------------------

  /**
   * Wasser. L* 81,47 / a* -5,03 / b* -9,04.
   * Aus KARTENDESIGN 5.4 (L* 82 / a* -5 / b* -9). Deutlich blasser als
   * OSM Carto `@water-color` #aad3df und basemap.de rgb(210,232,250) — Wasser
   * soll erkennbar, aber nicht laut sein. Der b*-Abstand zum warmen Grundton
   * betraegt 13,5 Einheiten; Positron kommt fuer denselben Zweck mit 2,7 aus.
   */
  wasser: { fuellung: '#b7cedb', kontur: KONTUR_WASSER, konturBreiteM: 0.30, rang: 20, hoehenversatzM: 0.040 },

  /**
   * Bahnverkehrsflaeche. L* 78,98 / a* +1,09 / b* -1,88.
   * Ton angelehnt an basemap.de `Verkehrsflaeche_Bahnverkehr` rgb(214,210,219),
   * entsaettigt. Die Flaeche ist ruhig, die KONTUR ist mit L* 39,90 das
   * dunkelste Basiselement — genau die Rollenverteilung aus basemap.de Grau,
   * wo die Bahn (21,2) noch unter der Strassenkontur (43,2) liegt.
   * Fuer eine Veranstaltungsplanung ist die Bahn eine harte Grenze; dass sie
   * als dunkelste Linie liest, ist gewollt.
   */
  bahn: { fuellung: '#c4c3c7', kontur: KONTUR_BAHN, konturBreiteM: 0.30, rang: 22, hoehenversatzM: 0.044 },

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
   * Platz (22 ALKIS-Flaechen). L* 94,47 / a* +0,18 / b* -0,48.
   * basemap.de faerbt den Platz REINWEISS wie die Fahrbahn und unterscheidet
   * beide allein ueber Geometrie und Kontur (KARTENDESIGN 2.5). Wir setzen ihn
   * eine Stufe (2,39 L*) darunter, damit im Bild eindeutig bleibt, welches
   * Objekt das Netz fuehrt — und weil ein Platz die groessere Flaeche ist und
   * bei gleicher Helligkeit optisch dominieren wuerde.
   */
  platz: { fuellung: '#efeff0', kontur: KONTUR_HAUPT, konturBreiteM: 0.30, rang: 30, hoehenversatzM: 0.060 },

  /**
   * Fussgaengerzone (7 ALKIS + 155 OSM Flaechen — EINE Klasse, nicht zwei!).
   * L* 92,05 / a* -4,89 / b* +1,04.
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
  fussgaengerzone: { fuellung: '#dfebe6', kontur: KONTUR_HAUPT, konturBreiteM: 0.25, rang: 32, hoehenversatzM: 0.064 },

  /**
   * Weg (16 ALKIS + 30 OSM). L* 84,98 / a* +1,37 / b* +4,93.
   * Der EINZIGE warme Ton im Verkehr (b* +4,9). Begruendung: ein Weg ist
   * baulich etwas anderes als Asphalt — wassergebundene Decke, Kies, Schotter.
   * Die Richtung ist von OSM Carto `@track-fill` #996600 uebernommen, aber auf
   * ein Zwanzigstel der Saettigung heruntergefahren. Der Kontrast zum kuehlen
   * Gehweg (b* -1,70) betraegt 6,6 b*-Einheiten und traegt damit allein,
   * obwohl der Helligkeitsabstand nur 4,12 L* betraegt — Farbtemperatur statt
   * Buntheit, genau die Technik aus KARTENDESIGN 3.2.
   * Ausserdem, nach KARTENDESIGN 5.2: Weg ist eine Stufe DUNKLER als Gehweg.
   */
  weg: { fuellung: '#dbd3cb', kontur: KONTUR_NEBEN, konturBreiteM: 0.20, rang: 34, hoehenversatzM: 0.068 },

  /**
   * Gehweg (736 OSM-Flaechen — die haeufigste Verkehrsklasse).
   * L* 89,10 / a* -0,13 / b* -1,70.
   * Aus KARTENDESIGN 5.4 (L* 90 / a* 0 / b* -1,5), um 0,9 L* abgesenkt.
   * Der Abstand zur Fahrbahn betraegt 7,76 L* — mehr als die 5,9, mit denen
   * basemap.de Grau Fahrbahn (100,0) von Hauptwirtschaftsweg (94,1) trennt.
   * Der Gehweg ist damit „derselbe Bautyp, nur eine Stufe dunkler"
   * (KARTENDESIGN 1.3(2)) und traegt zusaetzlich die eigene Nebenkontur.
   * Weil er die haeufigste Klasse ist, war er der Grund, die Nebenkontur von
   * L* 70 (Vorschlag 5.4) auf L* 52 zu verschaerfen.
   */
  gehweg: { fuellung: '#dee0e3', kontur: KONTUR_NEBEN, konturBreiteM: 0.22, rang: 36, hoehenversatzM: 0.072 },

  /**
   * Fahrbahn (640 OSM-Flaechen — die gepufferte Achse, NICHT der ALKIS-Korridor).
   * L* 96,86 / a* +0,02 / b* -1,07 — das HELLSTE Objekt der Szene.
   *
   * Angelehnt an basemap.de `Decker_Gemeindestr_Sonstige_Str` rgb(255,255,255)
   * = L* 100,0 und CARTO Positron `road_*_fill` #fff, abgedunkelt auf L* 96,9,
   * weil Reinweiss keinen Spielraum nach oben laesst: eine hervorgehobene oder
   * gesperrte Fahrbahn muss sich noch abheben koennen.
   *
   * Dass die Fahrbahn das hellste Objekt ist und zugleich die dunkelste Kontur
   * traegt (DL* 48,85), ist die eigentliche Antwort auf „die strassen sind
   * nicht zu erkennen" (KARTENDESIGN 2.6, Punkt 3).
   *
   * ACHTUNG — DOPPELBELEGUNG: Diese Klasse gilt NUR fuer die OSM-Fahrbahn.
   * Der ALKIS-Korridor „Strassenverkehr" (113 Flaechen) meint den GESAMTEN
   * Strassenraum inklusive Gehweg, Parkstreifen und Bankett und darf NICHT
   * denselben Ton bekommen — sonst wird derselbe Raum zweimal als Fahrbahn
   * eingefaerbt. Dafuer gibt es PLATTE_STIL (siehe unten) und
   * `stilFuer(art, quelle)`.
   */
  fahrbahn: { fuellung: '#f5f6f8', kontur: KONTUR_HAUPT, konturBreiteM: 0.30, rang: 42, hoehenversatzM: 0.084 },

  /**
   * Radweg (41 OSM-Flaechen). L* 87,03 / a* -0,93 / b* -6,43.
   * Der KUEHLSTE Ton im Verkehr. KARTENDESIGN 5.2 fordert genau das: „Decker wie
   * Gehweg, aber mit kuehlem Stich (b* ~ -6)". Vorbild ist Dark Matter, das
   * Neben-/Anliegerstrassen mit b* -10,9 gegen die neutrale Autobahn (b* 0)
   * absetzt, und Google Night mode, das `road` kuehl (#38414e) gegen
   * `road.highway` warm (#746855) stellt — Klassenunterscheidung ueber
   * Farbtemperatur, nicht ueber Buntheit (KARTENDESIGN 2.2, 2.7).
   * Gegen den Gehweg: nur 2,07 L* Abstand, aber 4,73 b*-Einheiten.
   * Liegt ueber der Fahrbahn (Rang 44), weil ein Radstreifen real AUF der
   * Fahrbahn markiert ist und fuer die Rettungswegplanung sichtbar bleiben muss.
   */
  radweg: { fuellung: '#d2dbe6', kontur: KONTUR_NEBEN, konturBreiteM: 0.20, rang: 44, hoehenversatzM: 0.088 },

  /**
   * Treppe (154 OSM-Flaechen). L* 83,02 / a* -0,31 / b* -1,23.
   * Die DUNKELSTE Verkehrsflaeche und die oberste im Stapel (Rang 46).
   * Beides mit Absicht: Stufen sind fuer Rettungsfahrzeuge, Rollstuhl- und
   * Anlieferverkehr eine Barriere. Sie duerfen weder von einer anderen
   * Verkehrsflaeche verdeckt werden noch als „begehbar wie ein Gehweg" lesen.
   * Der Ton bleibt neutral-kuehl in der Verkehrsfamilie — der Sonderstatus
   * kommt aus Helligkeit und Rang, nicht aus einer Signalfarbe. Sobald der
   * Renderer Stufenkanten aus den echten Hoehen zieht, uebernimmt die Geometrie
   * die Aussage vollends.
   */
  treppe: { fuellung: '#cdcfd1', kontur: KONTUR_NEBEN, konturBreiteM: 0.22, rang: 46, hoehenversatzM: 0.092 },
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
 * L* 86,27 / a* -0,13 / b* -1,71 (KARTENDESIGN 5.4 nennt L* 88 / #dadddf).
 * Abstand zum Fahrbahn-Decker: 10,59 L* — ueber der Regel „getrennt zu
 * erkennende Flaechen >= 9 L*". Nur die schwache Blockkante, keine Hauptkontur:
 * die Platte soll den Strassenraum begrenzen, nicht selbst als Strasse lesen.
 * Rang 26: ueber allen Landschaftsflaechen, unter allen Verkehrs-Deckern.
 */
export const PLATTE_STIL: FlaechenStil = {
  fuellung: '#d6d8db',
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

// --- Schwellwerte aus der Recherche ----------------------------------------
// Jeder Wert hat eine Belegstelle. Wer hier etwas lockert, hebelt die Recherche
// aus — dann bitte KARTENDESIGN.md gegenlesen, nicht die Zahl anpassen.

/** Flaechen: kleinster Schritt, den basemap.de Grau real faehrt (95,5 -> 94,1). */
const MIN_DL_FLAECHE = 1.4;
/** Ersatz fuer zu kleinen Helligkeitsabstand: Farbtemperatur. Positron kommt mit 2,7 aus. */
const MIN_DAB_ERSATZ = 5.0;
/** Getrennt zu erkennende, NICHT aneinandergrenzende Flaechen (Wasser 82,0 -> Gebaeude 72,6). */
const MIN_DL_GETRENNT = 9.0;
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

/** Verkehrsklassen — sie unterliegen der strengen Konturregel. */
const VERKEHR: FlaechenArt[] = ['fahrbahn', 'platz', 'fussgaengerzone', 'gehweg', 'radweg', 'weg', 'treppe'];

/**
 * Prueft die Palette gegen die Regeln aus KARTENDESIGN 3.2 / 5.1.
 * Gedacht als Startprobe (in stadt.ts einmalig aufrufen und die Befunde in die
 * Konsole schreiben), damit eine spaetere Farbaenderung nicht unbemerkt eine
 * der Lesbarkeitsregeln reisst.
 */
export function pruefePalette(): { ok: boolean; befunde: string[] } {
  const befunde: string[] = [];
  const z2 = (v: number) => v.toFixed(2);

  // --- 1  Helligkeitsleiter der Flaechen ------------------------------------
  // Alle Flaechenfuellungen plus der Grundton, nach L* sortiert. Zwei
  // unmittelbare Helligkeitsnachbarn muessen sich entweder um MIN_DL_FLAECHE
  // unterscheiden ODER ersatzweise ueber die Farbtemperatur (MIN_DAB_ERSATZ).
  // Die PLATTE steht bewusst NICHT in dieser Leiter: sie liegt immer unter den
  // Deckern und tritt nie als gleichrangige Nachbarflaeche auf. Sie wird in
  // Schritt 3 getrennt geprueft.
  const leiter: { name: string; hex: string }[] = [
    { name: 'GRUNDTON', hex: GRUNDTON },
    ...(Object.keys(FLAECHEN_STIL) as FlaechenArt[]).map((a) => ({ name: a, hex: FLAECHEN_STIL[a].fuellung })),
  ].sort((a, b) => lStern(b.hex) - lStern(a.hex));

  for (let i = 0; i + 1 < leiter.length; i++) {
    const o = leiter[i];
    const u = leiter[i + 1];
    const dl = lStern(o.hex) - lStern(u.hex);
    if (dl >= MIN_DL_FLAECHE) continue;
    const dab = abstandAB(o.hex, u.hex);
    if (dab >= MIN_DAB_ERSATZ) continue;
    befunde.push(
      `Flaechen "${o.name}" (L* ${z2(lStern(o.hex))}) und "${u.name}" (L* ${z2(lStern(u.hex))}) ` +
        `sind nicht trennbar: DL* ${z2(dl)} < ${MIN_DL_FLAECHE} und Dab ${z2(dab)} < ${MIN_DAB_ERSATZ}. ` +
        `Entweder Helligkeit spreizen oder eine der beiden in der Farbtemperatur gegenlaeufig fuehren.`,
    );
  }

  // --- 2  Fuellung gegen ihre eigene Kontur ---------------------------------
  for (const art of Object.keys(FLAECHEN_STIL) as FlaechenArt[]) {
    const s = FLAECHEN_STIL[art];
    if (!s.kontur) continue;
    const dl = lStern(s.fuellung) - lStern(s.kontur);
    const ziel = art === 'fahrbahn' ? MIN_DL_FAHRBAHNKONTUR : VERKEHR.includes(art) ? MIN_DL_VERKEHRSKONTUR : MIN_DL_FLAECHENKONTUR;
    if (dl < ziel) {
      befunde.push(`Kontur "${art}": DL* ${z2(dl)} < ${ziel} — die Flaeche liest nicht gegen ihren eigenen Saum.`);
    }
    if (!s.konturBreiteM || s.konturBreiteM <= 0) {
      befunde.push(`Kontur "${art}": konturBreiteM fehlt oder ist <= 0.`);
    }
  }
  {
    const dl = lStern(PLATTE_STIL.fuellung) - lStern(PLATTE_STIL.kontur ?? PLATTE_STIL.fuellung);
    if (dl < MIN_DL_FLAECHENKONTUR) befunde.push(`Kontur "PLATTE": DL* ${z2(dl)} < ${MIN_DL_FLAECHENKONTUR}.`);
  }

  // --- 3  Platte gegen Decker (die aufgeloeste Doppelbelegung) --------------
  {
    const dl = lStern(FLAECHEN_STIL.fahrbahn.fuellung) - lStern(PLATTE_STIL.fuellung);
    if (dl < MIN_DL_GETRENNT) {
      befunde.push(
        `ALKIS-Platte und OSM-Fahrbahn-Decker liegen mit DL* ${z2(dl)} < ${MIN_DL_GETRENNT} zu nah beieinander — ` +
          `der Strassenraum wuerde wieder als eine einzige Flaeche lesen (KARTENDESIGN 5.2).`,
      );
    }
    if (PLATTE_STIL.rang >= Math.min(...VERKEHR.map((a) => FLAECHEN_STIL[a].rang))) {
      befunde.push('PLATTE_STIL.rang liegt nicht unter allen Verkehrs-Deckern — die Platte wuerde die Fahrbahn ueberdecken.');
    }
  }

  // --- 4  Gebaeude ----------------------------------------------------------
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
    const bau = lStern(FLAECHEN_STIL.bebauung.fuellung);
    if (bau - wand < MIN_DL_GETRENNT) {
      befunde.push(`Gebaeudewand ${z2(wand)} hebt sich nicht von der Bauflaeche ${z2(bau)} ab (DL* ${z2(bau - wand)} < ${MIN_DL_GETRENNT}).`);
    }
    const first = lStern(GEBAEUDE_STIL.dachFirst);
    if (dach - first < 12) befunde.push(`Gebaeude: Firstlinie zu hell (DL* ${z2(dach - first)} < 12) — Sattel- und Walmdach lesen gleich.`);
    const sockel = lStern(GEBAEUDE_STIL.sockel);
    if (wand - sockel < 12) befunde.push(`Gebaeude: Sockelband zu hell (DL* ${z2(wand - sockel)} < 12) — die Haeuser schweben.`);
  }

  // --- 5  Wandvarianten: sichtbar, aber unterhalb einer Klassenstufe --------
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

  // --- 6  Reservat der Planobjekte ------------------------------------------
  // „Kein Planobjekt darf einen der Basistoene wiederverwenden" heisst umgekehrt:
  // kein Basiston darf im Reservat liegen (dunkel UND bunt).
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

  // --- 7  Zeichenreihenfolge --------------------------------------------------
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

  // --- 8  Lichtverhaeltnis ---------------------------------------------------
  const verhaeltnis = LICHT.staerke / LICHT.umgebungslicht;
  if (verhaeltnis < 2 || verhaeltnis > 3) {
    befunde.push(
      `key:fill = ${z2(verhaeltnis)}:1 liegt ausserhalb von 2:1 bis 3:1 (KARTENDESIGN 4.2). ` +
        `Haerter laesst Schattenfassaden zulaufen, weicher nimmt dem Modell die Tiefe.`,
    );
  }

  return { ok: befunde.length === 0, befunde };
}
