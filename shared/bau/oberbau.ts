/**
 * OBERBAU — die Querschnitte des Gleises.
 *
 * ZWEI BAUARTEN, ZWEI QUERSCHNITTE. Das ist der fachliche Kern:
 *
 *  - RILLENSCHIENE im Strassenraum. Sie liegt buendig im Belag. Es gibt dort
 *    KEIN Schotterbett und KEINE Schwellen — was man sieht, sind zwei
 *    Stahlbaender und daneben je eine RILLE, die Vertiefung fuer den
 *    Spurkranz. Diese Rille ist das eigentliche Erkennungsmerkmal: Zwei
 *    parallele Striche gibt es im Stadtbild oefter, aber zwei parallele
 *    Striche mit einer schmalen dunklen Nut daneben nur beim Gleis.
 *
 *  - SCHOTTEROBERBAU auf eigenem Bahnkoerper: Bettungstrapez mit boeschten
 *    Flanken, Schwellen als KOERPER (bisher waren sie flache Vierecke, also
 *    Aufkleber) und darauf die Vignolschiene mit Fuss, Steg und Kopf.
 *
 * WARUM DIE MASSE HIER UND NICHT IM PROGRAMMTEXT: Sie sind pruefbare
 * Angaben und tragen darum — wie das Regelwerk und die Bauklassen — je einen
 * Verifikationsstatus. Sie stehen als TypeScript-Datei und nicht als JSON,
 * weil der Browser sie beim Aufbau der Szene SYNCHRON braucht; eine
 * JSON-Datei muesste er erst holen, und der Szenenaufbau haette einen
 * asynchronen Zweig mehr. Der Inhalt bleibt trotzdem, was er ist: Daten.
 *
 * EHRLICHKEIT: Alle Masse unten sind aus dem Gedaechtnis angesetzte
 * Regelmasse und mit `zu_pruefen` gekennzeichnet. Sie sind gegen die
 * einschlaegigen Regelwerke abzugleichen (Rillenschiene Ph 37a bzw. NP 4a,
 * Vignolschiene S 49 / 54 E1, BOStrab fuer die Strassenbahn, EBO und
 * Ril 800.0130 der DB fuer den Bahnkoerper), bevor irgendjemand aus dieser
 * Darstellung ein Mass ableitet.
 */

import type { Profil, QuerPunkt } from '../geo/profil.ts';

export interface Mass {
  wertM: number;
  bezeichnung: string;
  quelle: string;
  status: 'verifiziert' | 'zu_pruefen';
}

const m = (wertM: number, bezeichnung: string, quelle: string): Mass => ({
  wertM,
  bezeichnung,
  quelle,
  status: 'zu_pruefen',
});

export const OBERBAU_MASSE = {
  // --- Rillenschiene ------------------------------------------------------
  //
  // BELEGT AM 10.08.2026 — zwei unabhaengige Herstellerangaben zum Profil
  // 60R2 (frueher Ri60N) nach EN 14811 stimmen in allen Werten ueberein:
  //   ArcelorMittal, Profilblatt 60R2 (Ri60N)
  //     https://rails.arcelormittal.com/profiles/tram-rails/tram-grooved-rails/rail-60r2-ri60n/
  //   Heinrich Krug GmbH & Co. KG, Masstabelle Rillenschienen
  //     https://www.heinrich-krug.de/schienen-krug/rillenschienen/
  //   Hoehe 180,00 mm · Kopf 113,00 mm · Fuss 180,00 mm ·
  //   Fahrflaeche 55,83 mm · Rillenbreite 36,35 mm · 59,75 kg/m
  // Das Schwesterprofil 59R2 ist bis auf die Rille gleich (42,35 mm).
  // Damit sind Fahrkante und Rillenweite KEINE Annahmen mehr.
  rilleBreite: {
    wertM: 0.03635,
    bezeichnung: 'Breite der Rille (Rillenweite), Profil 60R2 nach EN 14811',
    quelle:
      'ArcelorMittal Profilblatt 60R2 (Ri60N) und Masstabelle Heinrich Krug GmbH, beide abgerufen 10.08.2026: Rillenbreite 36,35 mm. ' +
      'Das Schwesterprofil 59R2 fuehrt 42,35 mm; Wikipedia „Rillenschiene" nennt fuer Strassenbahnen „etwa 40 mm" und liegt damit zwischen beiden. ' +
      'WELCHES Profil in Darmstadt liegt, ist nicht belegt — angesetzt ist das heute gebraeuchlichste.',
    status: 'verifiziert' as const,
  },
  fahrkanteBreite: {
    wertM: 0.05583,
    bezeichnung: 'Breite der Fahrflaeche des Schienenkopfs, Profil 60R2',
    quelle: 'ArcelorMittal Profilblatt 60R2 (Ri60N) und Masstabelle Heinrich Krug GmbH, abgerufen 10.08.2026: 55,83 mm.',
    status: 'verifiziert' as const,
  },
  /**
   * Breite der Gleiszone — des eingedeckten Bandes, in dem das Gleis liegt.
   * Sie ist das groesste sichtbare Merkmal eines Strassenbahngleises UND das
   * Mass, mit dem der Korridor beim Import aus den Bodenflaechen geschnitten
   * wird (server/geodata/gelaende.ts). Beides MUSS derselbe Wert sein, sonst
   * bleibt ein Streifen Fahrbahn stehen oder es klafft eine Fuge.
   */
  eindeckungBreite: m(2.1, 'Breite der eingedeckten Gleiszone je Gleis', 'Annahme aus Spurweite plus beidseitigem Randstreifen — nicht belegt'),
  fugenBreite: m(0.06, 'Breite der Laengsfuge am Rand der Gleiszone', 'Annahme — nicht belegt'),
  rilleTiefe: m(
    0.038,
    'Tiefe der Rille unter der Fahrbahnoberkante',
    'Annahme, nicht belegt. Die Profiltabellen der Hersteller fuehren keine Rillentiefe; die Technischen Regeln fuer die Spurfuehrung (TR Sp, BOStrab, Mai 2006) verlangen nur, dass Rillentiefe und Spurkranzhoehe aufeinander abgestimmt sind, und lagen nur als Bilddatei vor.',
  ),
  schienenUeberstand: m(0.004, 'Ueberstand des Schienenkopfs ueber den Belag', 'Bauausfuehrung, veraenderlich — Annahme'),

  // --- Schotteroberbau ----------------------------------------------------
  bettungHoehe: m(0.3, 'Dicke der Bettung unter Schwellenunterkante', 'Ril 800.0130 / EBO — Annahme, nicht belegt'),
  bettungSchulter: m(0.4, 'Schulterbreite der Bettung neben der Schwelle', 'Ril 800.0130 — Annahme, nicht belegt'),
  bettungNeigung: m(1.5, 'Boeschungsneigung der Bettung (1 : n)', 'Ril 800.0130 — Annahme, nicht belegt'),
  schwelleHoehe: m(0.16, 'Hoehe der Schwelle', 'Betonschwelle B 70 — Annahme, nicht belegt'),
  schwelleBreite: m(0.26, 'Breite der Schwelle in Gleisrichtung', 'Betonschwelle B 70 — Annahme, nicht belegt'),
  schwelleUeberstand: m(0.35, 'Ueberstand der Schwelle je Seite ueber die Spur', 'Regelmass — Annahme, nicht belegt'),
  schwelleTeilung: m(0.63, 'Abstand der Schwellen (Regelteilung)', 'rund 1600 Schwellen je km — Annahme, nicht belegt'),
  schieneHoehe: m(0.149, 'Hoehe der Vignolschiene', 'Profil S 49 — Annahme, nicht belegt'),
  schieneKopfBreite: m(0.067, 'Breite des Schienenkopfs', 'Profil S 49 — Annahme, nicht belegt'),
  schieneFussBreite: m(0.125, 'Breite des Schienenfusses', 'Profil S 49 — Annahme, nicht belegt'),
  schieneStegBreite: m(0.016, 'Dicke des Stegs', 'Profil S 49 — Annahme, nicht belegt'),
} as const;

/**
 * Farben. Sie spiegeln `VERKEHR_FARBEN` in web/src/scene/verkehr.ts — dort
 * steht die ausfuehrliche Begruendung der Helligkeitsabstaende (die Schiene
 * ist der hellste Koerper der Szene, weil ihr Kopf blank gefahren ist).
 * Hier stehen sie als Zeichenketten, damit diese Datei ohne Cesium auskommt
 * und auch im Server laeuft.
 */
export const OBERBAU_FARBEN = {
  /** Blank gefahrene Fahrflaeche — der hellste Koerper der Szene. */
  schiene: '#eef0f1',
  /**
   * Die Rille. Sie ist eine 4 cm schmale Vertiefung und liegt im Schatten —
   * im Bild ist sie fast schwarz. Sie traegt die Erkennung: zwei parallele
   * dunkle Linien im festen Abstand der Spurweite gibt es sonst nirgends.
   */
  rille: '#3f3d3b',
  /**
   * EINDECKUNG DER GLEISZONE. Das ist der Befund aus der Wirklichkeit, der im
   * Modell bisher ganz fehlte: Ein Gleis in der Strasse liegt nicht einfach im
   * Asphalt, sondern in einem eigenen BAND aus Beton, Pflaster oder
   * vorgefertigten Gleisjochen (Wikipedia „Rillenschiene": Eindeckung als
   * Fahrbahnbelag, Beton, vorgefertigte Gleisjoche inklusive Strassenbelag).
   * Dieses Band ist rund 2 m breit und damit das GROESSTE Merkmal des Gleises —
   * es liest sich noch aus 200 m, waehrend die 3,6-cm-Rille dort laengst unter
   * einem Bildpunkt liegt. Ohne das Band sieht eine Gleisstrasse aus wie eine
   * Strasse, und genau das war der Befund des Auftraggebers.
   *
   * DERSELBE WERT WIE DIE FLAECHENKLASSE `gleiszone` (web/src/scene/palette.ts,
   * Stufe 4, L* 54,73). Flaeche und Koerper sind dasselbe Bauteil und duerfen
   * nicht zwei Farben haben; `pruefePalette()` prueft die Gleichheit und meldet
   * jede Abweichung beim Laden. Vorher stand hier ein eigener, deutlich
   * hellerer Ton (#c6c4c1, L* 79,2) — gegen die neue Fahrbahn (92,7) waeren das
   * nur 13,5 L* gewesen, und ein Gleis soll sich staerker abheben als ein
   * Gehweg. Jetzt sind es 37,9.
   */
  eindeckung: '#728691',
  /** Laengsfuge zwischen Gleiszone und Fahrbahnasphalt. */
  fuge: '#a5a29e',
  gleisbett: '#7c7975',
  schwelle: '#57534e',
};

/**
 * BREITE DER GLEISZONE je Gleis — EINE Wahrheit fuer zwei Verwender.
 *
 * Sie bestimmt zugleich:
 *  - wie breit das Profil die Eindeckung zeichnet (`rillenGleisProfil`), und
 *  - wie breit der Korridor ist, der beim Import aus den Bodenflaechen
 *    geschnitten wird (`gleiszoneAusschneiden` in server/geodata/gelaende.ts).
 * Zwei getrennte Zahlen waeren hier besonders teuer: eine zu schmale Zone
 * liesse einen Streifen Fahrbahn ueber der Platte stehen, eine zu breite eine
 * offene Fuge daneben.
 */
export function eindeckungBreiteM(spurweiteM: number): number {
  return Math.max(OBERBAU_MASSE.eindeckungBreite.wertM, spurweiteM + 0.8);
}

/**
 * BREITE DES BAHNKOERPERS je Gleis (Schotteroberbau) — Unterkante des
 * Bettungstrapezes. Dieselbe Doppelrolle wie `eindeckungBreiteM`.
 */
export function bahnkoerperBreiteM(spurweiteM: number): number {
  const halb =
    spurweiteM / 2 +
    OBERBAU_MASSE.schwelleUeberstand.wertM +
    OBERBAU_MASSE.bettungSchulter.wertM +
    OBERBAU_MASSE.bettungHoehe.wertM * OBERBAU_MASSE.bettungNeigung.wertM;
  return halb * 2;
}

/**
 * Querschnitt eines Gleises mit RILLENSCHIENE.
 *
 * Aufbau je Seite: Schienenkopf buendig im Belag, unmittelbar daneben (zur
 * Gleismitte hin) die Rille. Der Nullpunkt z = 0 liegt auf der GEBAUTEN
 * Oberflaeche, also auf dem Pflaster bzw. Asphalt.
 */
export function rillenGleisProfil(spurweiteM: number, mindestZeichenbreiteM = 0): Profil {
  const halbSpur = spurweiteM / 2;
  // MINDESTZEICHENBREITE — eine bewusste Abweichung vom Mass, kein Fehler.
  //
  // Die wirkliche Fahrkante ist 5,6 cm breit, die Rille 4,2 cm. Aus 50 m
  // Entfernung ist beides schmaler als ein Bildpunkt: massstabstreu
  // gezeichnet verschwindet das Gleis. Karten loesen das seit jeher ueber eine
  // Mindestzeichenbreite — in jeder Strassenkarte ist die Strasse breiter
  // gezeichnet als massstaeblich.
  //
  // WAS DABEI UNANGETASTET BLEIBT: die FAHRKANTE. Sie liegt auf der
  // Spurweite, und das ist das Mass, aus dem sich alles ableiten laesst.
  // Verbreitert werden nur Kopf (nach aussen) und Rille (nach innen). Wer aus
  // dieser Darstellung eine Breite abgreift, misst also weiterhin die richtige
  // Spur — aber niemals die Breite eines Schienenkopfs.
  //
  // 0 = massstabstreu. Jeder andere Wert ist eine Zeichenhilfe und gehoert in
  // der Oberflaeche als solche gekennzeichnet.
  const kopf = Math.max(OBERBAU_MASSE.fahrkanteBreite.wertM, mindestZeichenbreiteM);
  const rilleB = Math.max(OBERBAU_MASSE.rilleBreite.wertM, mindestZeichenbreiteM * 0.75);
  const rilleT = OBERBAU_MASSE.rilleTiefe.wertM;
  const ueber = OBERBAU_MASSE.schienenUeberstand.wertM;

  // DAS GLEIS LIEGT JETZT BUENDIG — der Zeichenversatz ist weg.
  //
  // VORGESCHICHTE (Befund 09.08.2026): Die Rille ist eine VERTIEFUNG, 3,8 cm
  // unter der Fahrbahnoberflaeche. Die Fahrbahn war im Modell ein geschlossenes
  // Polygon ohne Loch und verdeckte sie vollstaendig; `scene.drillPick`
  // senkrecht auf die Gleisachse lieferte von vorn nach hinten Fahrbahn, dann
  // Gleis, dann Gelaende. Sichtbar blieben 4 mm Schienenkopf, hell auf hell —
  // eine Gleisstrasse sah aus wie eine Strasse.
  //
  // Als Notbehelf lag die Platte 4,5 cm ueber der Fahrbahn. Der Wert kam aus
  // zwei Zwaengen (ueber dem Interpolationsrauschen zweier getrennt vernetzter
  // Flaechen, ueber der Rillentiefe) und war ausdruecklich eine ZEICHENHOEHE,
  // kein Bauteilmass — das Gleis stand damit als flache Rampe auf der Strasse.
  //
  // SEIT 10.08.2026 wird die Gleiszone beim Import aus den Bodenflaechen
  // AUSGESCHNITTEN (server/geodata/gelaende.ts, `gleiszoneAusschneiden`). Die
  // Fahrbahn hat dort ein Loch, die Platte fuellt es, und der Blick in die
  // Rille trifft ihren dunklen Grund statt der Fahrbahn. Damit ist der Versatz
  // ueberfluessig: `zPlatte` ist 0, die Oberkante der Eindeckung liegt genau
  // auf der Bezugsflaeche des Strassenraums.
  const bandHalb = eindeckungBreiteM(spurweiteM) / 2;
  void OBERBAU_MASSE.fugenBreite;
  const zPlatte = 0;
  /**
   * Dicke der Eindeckungsplatte. Sie fuellt den Trog, den der Schnitt in der
   * Fahrbahn hinterlaesst; die Bauklasse `gleiszone` liegt mit -0,06 m genau
   * 1 cm unter ihrer Unterkante, damit beide nicht koplanar liegen.
   */
  const plattenDicke = 0.05;

  // DIE PLATTE MIT ZWEI ECHTEN VERTIEFUNGEN.
  //
  // Bisher war die Rille ein dunkler Streifen AUF dem Band — also ein Bild
  // einer Rille. Jetzt ist sie eine Vertiefung im Querschnitt: Der Umriss
  // laeuft an der Oberseite in die Rille hinunter, quer durch und wieder
  // hinauf. Das ist der Unterschied, den der Auftraggeber verlangt hat: eine
  // Rille IST eine Tiefe, keine Farbe. Fuer eine spaetere Simulation ist
  // damit auch die Frage beantwortet, wo ein Rad oder ein Rollstuhl
  // einsinken kann.
  //
  // Reihenfolge des Umrisses: unten von links nach rechts, dann oben von
  // rechts nach links (gegen den Uhrzeigersinn in der q-z-Ebene).
  const rilleRechtsAussen = -halbSpur;
  const rilleRechtsInnen = -halbSpur + rilleB;
  const rilleLinksInnen = halbSpur - rilleB;
  const rilleLinksAussen = halbSpur;

  const platte: QuerPunkt[] = [
    [-bandHalb, zPlatte - plattenDicke],
    [bandHalb, zPlatte - plattenDicke],
    [bandHalb, zPlatte],
    [rilleLinksAussen, zPlatte],
    [rilleLinksAussen, zPlatte - rilleT],
    [rilleLinksInnen, zPlatte - rilleT],
    [rilleLinksInnen, zPlatte],
    [rilleRechtsInnen, zPlatte],
    [rilleRechtsInnen, zPlatte - rilleT],
    [rilleRechtsAussen, zPlatte - rilleT],
    [rilleRechtsAussen, zPlatte],
    [-bandHalb, zPlatte],
  ];

  const teile = [{ bezeichnung: 'Eindeckung der Gleiszone', umriss: platte, farbe: OBERBAU_FARBEN.eindeckung }];

  for (const seite of [1, -1]) {
    const fahrkante = seite * halbSpur;
    const kopfAussen = fahrkante + seite * kopf;
    const rilleInnen = fahrkante - seite * rilleB;
    const seitenName = seite > 0 ? 'links' : 'rechts';
    const von = Math.min(fahrkante, kopfAussen);
    const bis = Math.max(fahrkante, kopfAussen);
    const rVon = Math.min(fahrkante, rilleInnen);
    const rBis = Math.max(fahrkante, rilleInnen);
    teile.push(
      // Die blank gefahrene Fahrflaeche liegt AUSSEN neben der Rille und
      // steht 4 mm ueber der Eindeckung — so weit, wie eine befahrene
      // Schiene aus dem Belag herausarbeitet.
      {
        bezeichnung: `Fahrflaeche ${seitenName}`,
        umriss: [
          [von, zPlatte],
          [bis, zPlatte],
          [bis, zPlatte + ueber],
          [von, zPlatte + ueber],
        ] as QuerPunkt[],
        farbe: OBERBAU_FARBEN.schiene,
      },
      // DIE RILLE. Sie ist das Merkmal, an dem man ein Gleis ueberhaupt
      // erkennt: zwei parallele helle Striche gibt es im Stadtbild oefter,
      // zwei helle Striche mit je einer schmalen dunklen Nut daneben nur beim
      // Gleis.
      //
      // SIE FUELLT DIE NUT, statt nur ihren Grund zu belegen. Der erste Ansatz
      // war ein 2 mm duennes Plaettchen auf dem Rillengrund — im Bild war es
      // nicht zu sehen (Bildpunktmessung vom 10.08.2026 quer ueber die Achse
      // bei 504 px/m: Fahrflaeche 5,6 cm, Rille 0). Zwei Flaechen, die 2 mm
      // auseinanderliegen, entscheidet der Tiefenpuffer bei streifendem Blick
      // nicht mehr zuverlaessig, und ohne den dunklen Grund ist die Nut nur
      // eine Fuge in derselben Farbe.
      //
      // Der Koerper reicht jetzt vom Rillengrund bis 1 cm unter die
      // Fahrbahnoberkante. Was man sieht, ist damit eine dunkle Nut in voller
      // Rillenbreite — genau das, was man in Wirklichkeit sieht, wenn man in
      // eine Rille schaut. Die MASSE der Rille (Breite 36,35 mm, Tiefe 3,8 cm)
      // bleiben unveraendert; es ist die Fuellung, die sichtbar wird, nicht
      // eine Verbreiterung.
      {
        bezeichnung: `Rille ${seitenName}`,
        umriss: [
          [rVon, zPlatte - rilleT],
          [rBis, zPlatte - rilleT],
          [rBis, zPlatte - 0.01],
          [rVon, zPlatte - 0.01],
        ] as QuerPunkt[],
        farbe: OBERBAU_FARBEN.rille,
      },
    );
  }
  return { id: 'rillenschiene', bezeichnung: 'Rillenschiene in eingedeckter Gleiszone', teile };
}

/**
 * Querschnitt eines Gleises auf eigenem BAHNKOERPER: Bettungstrapez und
 * beide Vignolschienen. Die Schwellen sind KEIN Teil des Querschnitts — sie
 * wiederholen sich in der Teilung und werden einzeln gesetzt.
 *
 * z = 0 liegt auf der gebauten Oberflaeche; die Bettung liegt darauf auf.
 */
export function schotterGleisProfil(spurweiteM: number): Profil {
  const halbSpur = spurweiteM / 2;
  const bettH = OBERBAU_MASSE.bettungHoehe.wertM;
  const schulter = OBERBAU_MASSE.bettungSchulter.wertM;
  const schwelleH = OBERBAU_MASSE.schwelleHoehe.wertM;
  const schwelleUe = OBERBAU_MASSE.schwelleUeberstand.wertM;

  const obenHalb = halbSpur + schwelleUe + schulter;
  const untenHalb = bahnkoerperBreiteM(spurweiteM) / 2;

  const bettung: QuerPunkt[] = [
    [-untenHalb, 0],
    [untenHalb, 0],
    [obenHalb, bettH],
    [-obenHalb, bettH],
  ];

  const teile = [{ bezeichnung: 'Bettung', umriss: bettung, farbe: OBERBAU_FARBEN.gleisbett }];

  // Vignolschiene: Fuss, Steg, Kopf — vereinfacht als ein Umriss in I-Form.
  const kopfB = OBERBAU_MASSE.schieneKopfBreite.wertM;
  const fussB = OBERBAU_MASSE.schieneFussBreite.wertM;
  const stegB = OBERBAU_MASSE.schieneStegBreite.wertM;
  const hoehe = OBERBAU_MASSE.schieneHoehe.wertM;
  const fussH = 0.025;
  const kopfH = 0.045;
  const basis = bettH + schwelleH;

  for (const seite of [1, -1]) {
    const q = seite * halbSpur;
    const umriss: QuerPunkt[] = [
      [q - fussB / 2, basis],
      [q + fussB / 2, basis],
      [q + fussB / 2, basis + fussH],
      [q + stegB / 2, basis + fussH + 0.012],
      [q + stegB / 2, basis + hoehe - kopfH - 0.012],
      [q + kopfB / 2, basis + hoehe - kopfH],
      [q + kopfB / 2, basis + hoehe],
      [q - kopfB / 2, basis + hoehe],
      [q - kopfB / 2, basis + hoehe - kopfH],
      [q - stegB / 2, basis + hoehe - kopfH - 0.012],
      [q - stegB / 2, basis + fussH + 0.012],
      [q - fussB / 2, basis + fussH],
    ];
    teile.push({ bezeichnung: `Vignolschiene ${seite > 0 ? 'links' : 'rechts'}`, umriss, farbe: OBERBAU_FARBEN.schiene });
  }
  return { id: 'schotteroberbau', bezeichnung: 'Schotteroberbau auf eigenem Bahnkoerper', teile };
}

/** Querschnitt EINER Schwelle (quer zur Fahrtrichtung gesehen). */
export function schwellenQuerschnitt(spurweiteM: number): { umriss: QuerPunkt[]; tiefeM: number; hoeheUeberBettung: number } {
  const halb = spurweiteM / 2 + OBERBAU_MASSE.schwelleUeberstand.wertM;
  const h = OBERBAU_MASSE.schwelleHoehe.wertM;
  return {
    umriss: [
      [-halb, 0],
      [halb, 0],
      [halb, h],
      [-halb, h],
    ],
    tiefeM: OBERBAU_MASSE.schwelleBreite.wertM,
    hoeheUeberBettung: OBERBAU_MASSE.bettungHoehe.wertM,
  };
}

/** Alle Masse mit ihrem Status — fuer den Nachweis in der Oberflaeche. */
export function oberbauNachweis(): Mass[] {
  return Object.values(OBERBAU_MASSE);
}
