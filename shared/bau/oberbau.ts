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
  rilleBreite: {
    wertM: 0.04,
    bezeichnung: 'Breite der Rille (Rillenweite)',
    quelle: 'Wikipedia „Rillenschiene", abgerufen 09.08.2026: „die Rillenweite der Schienen betraegt etwa 40 mm" (Strassenbahn; Eisenbahn-Rillenschienen etwa 60 mm)',
    status: 'verifiziert' as const,
  },
  /**
   * Breite der Gleiszone — des eingedeckten Bandes, in dem das Gleis liegt.
   * Sie ist das groesste sichtbare Merkmal eines Strassenbahngleises.
   */
  eindeckungBreite: m(2.1, 'Breite der eingedeckten Gleiszone je Gleis', 'Annahme aus Spurweite plus beidseitigem Randstreifen — nicht belegt'),
  fugenBreite: m(0.06, 'Breite der Laengsfuge am Rand der Gleiszone', 'Annahme — nicht belegt'),
  rilleTiefe: m(0.038, 'Tiefe der Rille unter der Fahrbahnoberkante', 'Regelmass Ph 37a — Annahme, nicht belegt'),
  fahrkanteBreite: m(0.056, 'Breite des Schienenkopfs an der Fahrflaeche', 'Regelmass Ph 37a — Annahme, nicht belegt'),
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
   * es liest sich noch aus 200 m, waehrend die 4-cm-Rille dort laengst unter
   * einem Bildpunkt liegt. Ohne das Band sieht eine Gleisstrasse aus wie eine
   * Strasse, und genau das war der Befund des Auftraggebers.
   */
  eindeckung: '#c6c4c1',
  /** Laengsfuge zwischen Gleiszone und Fahrbahnasphalt. */
  fuge: '#a5a29e',
  gleisbett: '#7c7975',
  schwelle: '#57534e',
};

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

  // WARUM DAS PROFIL AUFLIEGT UND NICHT EINSCHNEIDET (Befund 09.08.2026):
  // Die Rille ist eine VERTIEFUNG — 3,8 cm unter der Fahrbahnoberflaeche.
  // Die Fahrbahn ist im Modell aber ein geschlossenes Polygon ohne Loch und
  // verdeckt sie damit vollstaendig; sichtbar blieben 4 mm Schienenkopf, hell
  // auf hell. Nachgemessen an einem Gleis in der Rheinstrasse: Fahrbahn
  // 144,337 m, Schienenkopf 144,341 m, Rillensohle 144,299 m. Genau deshalb
  // sah eine Gleisstrasse aus wie eine Strasse.
  //
  // Bis die Fahrbahn beim Import um die Gleiszone ausgeschnitten wird, liegt
  // das Gleis als AUFLAGE auf ihr: die Eindeckung 4 mm ueber der Fahrbahn,
  // Rille und Fahrflaeche 4 mm darueber. Der Fehler betraegt damit einen
  // knappen Zentimeter nach oben — er ist hier benannt und geht in keine
  // Messung ein.
  const bandHalb = Math.max(OBERBAU_MASSE.eindeckungBreite.wertM, spurweiteM + 0.8) / 2;
  void OBERBAU_MASSE.fugenBreite;
  // WARUM 3 cm UND NICHT 4 mm (Befund 09.08.2026, am fertig gebauten Stand):
  // Fahrbahnflaeche und Gleisband sind ZWEI unabhaengig vernetzte Flaechen.
  // Beide bekommen ihre Hoehen nur an ihren eigenen Stuetzpunkten (alle 2 m)
  // und werden dazwischen linear gespannt — auf gewoelbtem Gelaende laufen sie
  // deshalb um mehrere Zentimeter auseinander. Ein Versatz von 4 mm ging darin
  // unter: das Band lag streckenweise UNTER der Fahrbahn und war unsichtbar.
  // 3 cm liegen sicher darueber und bleiben unter der Bordsteinhoehe (12 cm),
  // stossen also nirgends durch eine Kante.
  //
  // Das ist eine ZEICHENHOEHE, kein Bauteilmass: In Wirklichkeit liegt die
  // Eindeckung buendig in der Fahrbahn. Sobald die Fahrbahn beim Import um die
  // Gleiszone ausgeschnitten wird, gehoert dieser Versatz auf null.
  // ZEICHENHOEHE DER PLATTE: 4,5 cm ueber der Fahrbahn.
  //
  // Der Wert ergibt sich aus zwei Zwaengen, nicht aus dem Bauwerk:
  //  - Er muss ueber dem Interpolationsrauschen zwischen zwei getrennt
  //    vernetzten Flaechen liegen (bei 4 mm verschwand das Band streckenweise
  //    unter der Fahrbahn, nachgemessen 09.08.2026).
  //  - Er muss GROESSER sein als die Rillentiefe (3,8 cm), damit der
  //    Rillengrund noch UEBER der Fahrbahnflaeche liegt. Sonst sieht man beim
  //    Blick in die Rille nicht ihren dunklen Grund, sondern die Fahrbahn,
  //    die ungeschnitten darunter durchlaeuft.
  // Er bleibt unter der Bordsteinhoehe (12 cm), stoesst also durch keine Kante.
  const zPlatte = 0.045;
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
      // Der Rillengrund. Er liegt im Schatten der eigenen Wandungen — das
      // ist die dunkle Linie, an der man das Gleis erkennt.
      {
        bezeichnung: `Rillengrund ${seitenName}`,
        umriss: [
          [rVon, zPlatte - rilleT],
          [rBis, zPlatte - rilleT],
          [rBis, zPlatte - rilleT + 0.002],
          [rVon, zPlatte - rilleT + 0.002],
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
  const neigung = OBERBAU_MASSE.bettungNeigung.wertM;
  const schwelleH = OBERBAU_MASSE.schwelleHoehe.wertM;
  const schwelleUe = OBERBAU_MASSE.schwelleUeberstand.wertM;

  const obenHalb = halbSpur + schwelleUe + schulter;
  const untenHalb = obenHalb + bettH * neigung;

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
