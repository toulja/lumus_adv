/**
 * DAS HOEHENBAND — Rampen, Unterfuehrungen und Bruecken bekommen eine Tiefe.
 *
 * DER BEFUND (Auftraggeber, 09.08.2026): „Tiefgarageneinfahrten werden nicht
 * tief." Er hatte recht, und zwar aus drei zusammenwirkenden Gruenden:
 *
 *  1. Der Import verwarf Tunnel ausdruecklich (`if (tags.tunnel …) return null`
 *     in osm.ts). Eine Tiefgaragenrampe ist in OpenStreetMap ein
 *     `highway=service` mit `tunnel`/`covered`/`layer=-1` — sie fiel damit
 *     vollstaendig heraus, noch bevor irgendetwas gezeichnet wurde.
 *  2. Bruecken wurden auf Gelaendehoehe gemalt. Eine Bruecke, die dem Gelaende
 *     folgt, ist keine Bruecke, sondern ein Weg.
 *  3. Das Modell kannte ueberhaupt keine Unterkante — nur Konstruktionshoehen
 *     nach oben (0 bis 12 cm).
 *
 * DIESES MODUL BEHEBT ALLE DREI. Es laeuft beim Import, nachdem der Boden
 * aufgebaut ist, und tut drei Dinge:
 *
 *  A) RAMPEN UND UNTERFUEHRUNGEN: Es rechnet aus, wie tief sie fallen, und
 *     SENKT DAS HOEHENMODELL entlang ihrer Achse ab. Das ist der Punkt, an
 *     dem sich diese Loesung von einer Zeichenkorrektur unterscheidet:
 *     `hoehen.bei()` liefert danach am tiefsten Punkt einen messbar
 *     niedrigeren Wert, und zwar fuer JEDEN Verbraucher — Darstellung,
 *     Regelpruefung, Vadere-Export. Wuerde nur die Flaeche tiefer gezeichnet,
 *     stuenden Baeume und Laternen weiter auf dem alten Niveau.
 *  B) PORTALE: Am tiefen Ende entsteht eine Wand mit Oeffnung. Erst sie macht
 *     aus einer abfallenden Flaeche eine Einfahrt.
 *  C) BRUECKEN: Der Ueberbau liegt auf der Verbindung seiner beiden
 *     Widerlager statt auf dem Gelaende. Die lichte Hoehe darunter wird
 *     GEMESSEN und am Bauwerk vermerkt — damit kann die Regelpruefung spaeter
 *     fragen, ob eine Feuerwehrzufahrt darunter passt, statt die Zahl aus
 *     einem Eingabefeld zu nehmen.
 *
 * WAS BELEG IST UND WAS ANNAHME: `incline`, `level` und `maxheight` kommen aus
 * OpenStreetMap und sind Beleg — wo sie stehen, gelten sie. Fehlen sie, greift
 * die Rampenneigung aus den Bauklassen (`vertikal.rampe.annahmeNeigungProzent`),
 * und das Ergebnis traegt `herkunft: 'annahme'`. Geraten wird nichts still.
 */

import type {
  Bruchkante,
  GelaendeFlaeche,
  GelaendeLinienObjekt,
  Hoehenband,
  Punkt,
  Ring,
} from '../../shared/domain/types.ts';
import {
  abstandRingRing,
  aufPolylinie,
  bboxErweitern,
  bboxUeberschneidet,
  bboxVonPunkten,
  polylinieLaenge,
  punktInRing,
} from '../../shared/geo/geometry.ts';
import type { Hoehenraster } from '../../shared/geo/raster.ts';
import type { VertikalMasse } from './bauwerk.ts';

/** Ein `tunnel=building_passage` fuehrt auf Strassenniveau durch ein Haus. */
const KEINE_TIEFE = new Set(['building_passage']);

/** Kuerzer als das ist keine Rampe, sondern ein Erfassungsartefakt. */
const MIN_RAMPE_M = 4;

/**
 * AUFBAU DER RAMPENFAHRBAHN ueber dem ausgehobenen Boden.
 *
 * Der Einschnitt geht um diesen Betrag TIEFER als die Fahrbahn der Rampe. Das
 * ist kein Zeichentrick, sondern dieselbe Logik wie ueberall in diesem Modell:
 * Das Gelaende ist der ausgehobene Boden, darauf liegt der Aufbau. Ohne ihn
 * waeren die gezeichnete Rampenflaeche und das eingeschnittene Gelaende
 * KOPLANAR — und zwei koplanare Flaechen entscheidet der Tiefenpuffer
 * bildpunktweise. Im Bild vom 10.08.2026 war die ganze Rampe davon gefleckt.
 */
const RAMPEN_AUFBAU_M = 0.05;

/**
 * NAHTMASS DER STRANGBILDUNG.
 *
 * Zwei unterirdische Flaechenstuecke gehoeren zum selben Bauwerk, wenn sie sich
 * beruehren. „Beruehren" heisst hier: hoechstens 1,50 m Abstand — OSM-Wege
 * werden zu Korridoren gepuffert, und an einer Kreuzung klafft zwischen zwei
 * Korridorstuecken regelmaessig ein Spalt von einigen Dezimetern.
 */
const NAHT_M = 1.5;

/**
 * Der Trogschnitt greift je Seite so viel weiter als der Aushub. Er deckt die
 * Rasterzelle ab, die den Rand des Aushubs traegt (1 m) plus einen halben Meter
 * fuer die Rundung der Sweep-Line.
 */
const SCHNITT_ZUGABE_M = 1.5;

export interface HoehenbandBericht {
  /** Zusammenhaengende Bauwerke (nicht Polygonstuecke!). */
  straenge: number;
  /** Groesste Stueckzahl eines Strangs — das Mass der Zerstueckelung. */
  groessterStrang: number;
  rampen: number;
  rampenLaengeM: number;
  /** Flaeche des OFFENEN Trogs in m2, also der tatsaechlich ausgehobene Teil. */
  trogFlaecheM2: number;
  tiefsteM: number;
  mitIncline: number;
  /** Straenge ohne jeden Anschluss an die Oberflaeche — nicht ausgehoben. */
  ohneAnschluss: number;
  /** Als Tunnel erfasst, aber zu flach fuer eine Decke: Durchfahrt auf Strassenniveau. */
  alsDurchfahrt: number;
  portale: number;
  bruecken: number;
  brueckenMitLichterHoehe: number;
  /** Bruecken, unter denen das Hoehenmodell keine Senke zeigt — nicht messbar. */
  brueckenOhneMessung: number;
  kleinsteLichteHoeheM: number | null;
  rasterZellen: number;
  /** Meldungen fuer den Datenluecken-Nachweis. */
  luecken: string[];
}

/**
 * Liegt dieses Objekt unter der Oberflaeche?
 *
 * DREI ABGRENZUNGEN, jede aus einem falschen Ergebnis des ersten Laufs
 * (10.08.2026, 108 „Rampen" im Pilotgebiet — es sind keine 108):
 *
 *  1. `tunnel=building_passage` ist eine Durchfahrt DURCH ein Haus auf
 *     Strassenniveau. Sie bekommt NIE eine Tiefe, auch nicht mit `layer=-1` —
 *     das `layer` sagt dort nur, dass der Weg unter dem Gebaeudeumriss
 *     durchlaeuft. Im ersten Lauf wurden 18 solche Durchfahrten 8 m tief
 *     ausgehoben.
 *  2. `covered=*` heisst ueberdeckt, NICHT unterirdisch — das OSM-Wiki
 *     unterscheidet beides ausdruecklich („covered=yes … usually open at least
 *     on one side", waehrend `tunnel=yes` unterirdische Durchgaenge meint,
 *     abgerufen 10.08.2026). Eine Arkade (`covered=colonnade`) ist ein Dach
 *     ueber einem Gehweg. Sie allein senkt darum nichts ab.
 *  3. Ein `layer` ohne `tunnel` und ohne negatives `level` sagt nur, WAS UEBER
 *     WAS liegt („Layer provides absolutely no information about relative or
 *     absolute height difference", OSM-Wiki Key:layer). Es allein reicht
 *     nicht, um zu graben.
 */
function istUnterirdisch(l: Hoehenband | undefined): boolean {
  if (!l) return false;
  if (l.tunnel && KEINE_TIEFE.has(l.tunnel)) return false;
  if (l.tunnel) return true;
  // `covered` bleibt aussen vor, AUCH mit negativem `layer`: Eine Arkade
  // (`covered=colonnade`) mit `layer=-1` sagt nur, dass der Gehweg unter dem
  // Gebaeudeumriss durchlaeuft — er bleibt auf Strassenniveau. Im Lauf vom
  // 10.08.2026 wurden zwei solche Arkaden ausgehoben.
  return typeof l.osmLevel === 'number' && l.osmLevel < 0;
}

/**
 * WIE TIEF DARF ES HOECHSTENS WERDEN, wenn keine Quelle es sagt?
 *
 * Im ersten Lauf lag die Grenze bei pauschal 8 m, und 108 von 108 Rampen
 * landeten genau dort — die Zahl kam also nicht aus dem Bauwerk, sondern aus
 * der Grenze. Das ist keine Ableitung, sondern eine Behauptung.
 *
 * Jetzt bindet die Grenze an das, was die Daten hergeben:
 *   `level=-2`  ->  zwei Geschosse unter der Strasse
 *   `layer<=-2` ->  ebenso (zwei Lagen tiefer)
 *   sonst       ->  EIN Geschoss. Das ist die Regel und nicht das Aeusserste:
 *                   Eine Unterfuehrung braucht lichte Hoehe plus Deckenstaerke,
 *                   eine Tiefgarage ein Geschoss.
 */
function tiefenGrenze(l: Hoehenband | undefined, vertikal: VertikalMasse): number {
  const geschoss = vertikal.tiefgarage.geschosshoeheM;
  if (typeof l?.osmLevel === 'number' && l.osmLevel < 0) return Math.abs(l.osmLevel) * geschoss;
  if (typeof l?.layer === 'number' && l.layer <= -2) return 2 * geschoss;
  return Math.max(geschoss, vertikal.unterfuehrung.lichteHoeheStrasseM * 0.75);
}

/** Achse einer Flaeche; ohne gespeicherte Achse die laengste Diagonale. */
function achseVon(f: GelaendeFlaeche): Punkt[] | null {
  const a = f.achsen?.find((x) => x.length >= 2);
  if (a) return a;
  if (f.polygon.length < 3) return null;
  // Ersatz: die beiden am weitesten auseinanderliegenden Ringpunkte.
  let best: [Punkt, Punkt] | null = null;
  let bd = 0;
  for (let i = 0; i < f.polygon.length; i++) {
    for (let j = i + 1; j < f.polygon.length; j++) {
      const d = Math.hypot(f.polygon[i][0] - f.polygon[j][0], f.polygon[i][1] - f.polygon[j][1]);
      if (d > bd) {
        bd = d;
        best = [f.polygon[i], f.polygon[j]];
      }
    }
  }
  return best ? [best[0], best[1]] : null;
}

/**
 * SCHLIESST DIESES ENDE AN DIE OBERFLAECHE AN?
 *
 * Ein Bauwerk, das nach oben Anschluss hat, faellt von dort ab; eines ohne
 * Anschluss taucht nirgends auf und darf darum auch nichts ausheben. Geprueft
 * wird an der Sache selbst: Liegt in Reichweite eine Verkehrsflaeche OHNE
 * Hoehenband?
 */
function endeOffen(p: Punkt, offene: GelaendeFlaeche[]): boolean {
  return offene.some((f) => {
    const bb = bboxVonPunkten(f.polygon);
    if (p[0] < bb.minE - 6 || p[0] > bb.maxE + 6 || p[1] < bb.minN - 6 || p[1] > bb.maxN + 6) return false;
    return punktInRing(p, f.polygon) || f.polygon.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 6);
  });
}

/**
 * STRAENGE STATT STUECKE — der Befund, der diese Funktion erzwungen hat.
 *
 * Am 10.08.2026 meldete der Import „61 Rampen/Unterfuehrungen" fuer die
 * Darmstaedter Innenstadt. Nachgezaehlt in den Daten: Der CITYTUNNEL allein
 * erschien als ACHT Flaechenstuecke, jedes mit eigener Achse, eigener Tiefe und
 * eigenem Portal — 1,05 m hier, 3,38 m dort, 2,80 m daneben. Der Grund ist
 * harmlos und die Folge nicht: OpenStreetMap zerlegt einen Weg an jeder
 * Kreuzung, jedem Attributwechsel und jeder Bruecke; der Import puffert jedes
 * Stueck einzeln zu einem Korridor. Eine Rampenneigung mal Stuecklaenge ergibt
 * dann pro Stueck eine andere Tiefe, und keine davon ist die des Bauwerks.
 *
 * Zusammengefasst wird, was sich beruehrt (`NAHT_M`). Das ist eine geometrische
 * Aussage, keine Namensgleichheit: Ein Tunnel wechselt unterwegs den Namen
 * (Citytunnel / Huegelstrasse), und zwei gleichnamige Rampen an
 * verschiedenen Haeusern sind nicht dasselbe Bauwerk.
 */
function straengeBilden(teile: GelaendeFlaeche[]): GelaendeFlaeche[][] {
  const eltern = teile.map((_, i) => i);
  const wurzel = (i: number): number => {
    while (eltern[i] !== i) {
      eltern[i] = eltern[eltern[i]];
      i = eltern[i];
    }
    return i;
  };
  const boxen = teile.map((f) => bboxErweitern(bboxVonPunkten(f.polygon), NAHT_M));
  for (let i = 0; i < teile.length; i++) {
    for (let j = i + 1; j < teile.length; j++) {
      if (wurzel(i) === wurzel(j)) continue;
      if (!bboxUeberschneidet(boxen[i], boxen[j])) continue;
      if (abstandRingRing(teile[i].polygon, teile[j].polygon) > NAHT_M) continue;
      eltern[wurzel(i)] = wurzel(j);
    }
  }
  const nach = new Map<number, GelaendeFlaeche[]>();
  for (let i = 0; i < teile.length; i++) {
    const w = wurzel(i);
    const liste = nach.get(w);
    if (liste) liste.push(teile[i]);
    else nach.set(w, [teile[i]]);
  }
  return [...nach.values()];
}

/** Eine Rasterzelle des Strangs mit ihrem Weg zur naechsten Muendung. */
interface Zelle {
  sp: number;
  z: number;
  e: number;
  n: number;
  /** Weg IM BAUWERK bis zur naechsten Muendung, in Metern. */
  weg: number;
  /** Gelaendehoehe ueber der Zelle, gemessen VOR dem Aushub. */
  oberkante: number;
}

/**
 * AUSGLEICHSEBENE durch gemessene Punkte (Methode der kleinsten Quadrate).
 *
 * Sie ist die einfachste Flaeche, die zu ALLEN gemessenen Sohlenpunkten eines
 * Stueckes passt. Zwei Punkte legen eine Gerade fest, drei eine Ebene; sind es
 * weniger oder liegen sie auf einer Linie, bleibt die waagerechte Ebene durch
 * ihren Mittelwert — eine ehrliche Antwort, keine erfundene Neigung.
 */
function ebeneAusgleichen(punkte: [number, number, number][]): { a: number; b: number; c: number; e0: number; n0: number } {
  const n = punkte.length;
  const e0 = punkte.reduce((s, p) => s + p[0], 0) / n;
  const n0 = punkte.reduce((s, p) => s + p[1], 0) / n;
  const h0 = punkte.reduce((s, p) => s + p[2], 0) / n;
  if (n < 3) return { a: 0, b: 0, c: h0, e0, n0 };
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxh = 0;
  let syh = 0;
  for (const p of punkte) {
    const dx = p[0] - e0;
    const dy = p[1] - n0;
    const dh = p[2] - h0;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxh += dx * dh;
    syh += dy * dh;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: h0, e0, n0 };
  return { a: (sxh * syy - syh * sxy) / det, b: (syh * sxx - sxh * sxy) / det, c: h0, e0, n0 };
}

/** Teilt Zellen in raeumlich getrennte Gruppen (einfache Nachbarschaftssuche). */
function randGruppieren(zellen: Zelle[], abstandM: number): Zelle[][] {
  const offen = [...zellen];
  const gruppen: Zelle[][] = [];
  while (offen.length) {
    const gruppe = [offen.pop() as Zelle];
    for (let i = 0; i < gruppe.length; i++) {
      for (let j = offen.length - 1; j >= 0; j--) {
        if (Math.hypot(offen[j].e - gruppe[i].e, offen[j].n - gruppe[i].n) <= abstandM) gruppe.push(...offen.splice(j, 1));
      }
    }
    gruppen.push(gruppe);
  }
  return gruppen;
}

/**
 * SENKT RAMPEN UND UNTERFUEHRUNGEN IM HOEHENMODELL AB, setzt ihr Hoehenband und
 * liefert den OFFENEN TROG, der aus den Bodenflaechen auszuschneiden ist.
 *
 * WIE WEIT AUSGEHOBEN WIRD — die Frage, an der die erste Fassung scheiterte.
 *
 * Am 10.08.2026 hob der Import jede unterirdische Flaeche auf ihrer GANZEN
 * Laenge aus. Damit lag der Boden auch dort tiefer, wo der Tunnel unter einer
 * Strasse hindurchlaeuft — und weil die Strasse darueber ihre Hoehen aus
 * demselben Hoehenmodell holt, sackte sie mit in den Graben. Nachgemessen an
 * der Zufahrt beim Luisencenter (475303/5524750): Die Fahrbahn dort stand auf
 * 143,50 m, das Hoehenmodell unter ihr auf 140,60 m — ein 2,90 m tiefer
 * Schlitz mitten in der Strasse, und die Kanten des Schlitzes stachen als
 * Flecken durch die Fahrbahn. Nachgezaehlt ueber alle 71 Tunnelstuecke:
 * 6.925 von 6.925 ausgehobenen Rasterzellen lagen UNTER einer kartierten
 * Bodenflaeche.
 *
 * DIE UNTERSCHEIDUNG, die das Modell dafuer braucht, ist physisch und
 * messbar: Ein Bauwerk ist UEBERDECKT, sobald ueber ihm ein ganzes Geschoss
 * Platz hat (`vertikal.tiefgarage.geschosshoeheM` — lichte Hoehe plus Decke).
 * Solange weniger Platz da ist, KANN dort keine Decke liegen: Der Strang
 * laeuft im offenen Trog. Ausgehoben wird nur dieser Trog, und genau er wird
 * aus den Bodenflaechen ausgeschnitten. Das Portal steht an der Stelle, wo die
 * Ueberdeckung erstmals reicht — nicht am Ende eines Polygonstuecks.
 *
 * WARUM DAS OHNE ACHSE RECHNET (zweiter Anlauf, 10.08.2026): Eine Strangachse
 * aus den Stueckachsen war zweimal falsch — als Kette ueber die Stueckmitten
 * schnitt sie quer durch die Fahrbahn (der Aushub wurde 2 m breit statt 7),
 * und aneinandergehaengt lief sie bei Verzweigungen hin und zurueck (aus
 * 1.198 m Strang wurden 2.350 m). Ein Tunnel mit Ausfahrt HAT keine Achse.
 * Gerechnet wird darum auf den RASTERZELLEN des Strangs: Der Weg bis zur
 * naechsten Muendung wird IM BAUWERK gemessen (Dijkstra ueber die Zellen), und
 * die Tiefe folgt aus diesem Weg. Das kennt Kurven und Verzweigungen, ohne
 * dass irgendwo eine Linie geraten werden muesste.
 */
export function rampenAbsenken(
  flaechen: GelaendeFlaeche[],
  raster: Hoehenraster,
  vertikal: VertikalMasse | null,
): { linien: GelaendeLinienObjekt[]; kanten: Bruchkante[]; troege: Ring[]; sohlen: Ring[]; bericht: HoehenbandBericht } {
  const bericht: HoehenbandBericht = {
    straenge: 0,
    groessterStrang: 0,
    rampen: 0,
    rampenLaengeM: 0,
    trogFlaecheM2: 0,
    tiefsteM: 0,
    mitIncline: 0,
    ohneAnschluss: 0,
    alsDurchfahrt: 0,
    portale: 0,
    bruecken: 0,
    brueckenMitLichterHoehe: 0,
    brueckenOhneMessung: 0,
    kleinsteLichteHoeheM: null,
    rasterZellen: 0,
    luecken: [],
  };
  const linien: GelaendeLinienObjekt[] = [];
  const kanten: Bruchkante[] = [];
  const troege: Ring[] = [];
  /** Der Aushub OHNE Zugabe — daran wird die Rampenfahrbahn zugeschnitten. */
  const sohlen: Ring[] = [];
  if (!vertikal) return { linien, kanten, troege, sohlen, bericht };

  const hoeheBei = (e: number, n: number) => raster.hoeheOder(e, n, raster.statistik().mittel);
  const offene = flaechen.filter((f) => !f.lage && (f.art === 'fahrbahn' || f.art === 'platz' || f.art === 'fussgaengerzone' || f.art === 'gehweg' || f.art === 'weg'));
  const k = raster.kopf;

  const unterirdisch = flaechen.filter((f) => istUnterirdisch(f.lage) && f.polygon.length >= 3);
  const straenge = straengeBilden(unterirdisch);
  bericht.straenge = straenge.length;
  for (const s of straenge) if (s.length > bericht.groessterStrang) bericht.groessterStrang = s.length;

  /** Ueberdeckung, ab der eine Decke Platz haette — die Grenze offen/geschlossen. */
  const deckung = vertikal.tiefgarage.geschosshoeheM;

  for (const teile of straenge) {
    const name = teile.map((f) => f.bezeichnung).find((b) => !!b) ?? 'unbenannt';

    // --- 1. Die Zellen des Strangs ------------------------------------------
    // Der Strang ist eine MENGE VON RASTERZELLEN, nicht eine Linie. Damit
    // braucht nichts an diesem Verfahren eine Achse, und eine Verzweigung
    // (Tunnel mit Ausfahrt) ist kein Sonderfall mehr.
    const zellen = new Map<number, Zelle>();
    for (const f of teile) {
      const bb = bboxVonPunkten(f.polygon);
      const s0 = Math.max(0, Math.floor((bb.minE - k.minE) / k.zellM));
      const s1 = Math.min(k.spalten - 1, Math.ceil((bb.maxE - k.minE) / k.zellM));
      const z0 = Math.max(0, Math.floor((bb.minN - k.minN) / k.zellM));
      const z1 = Math.min(k.zeilen - 1, Math.ceil((bb.maxN - k.minN) / k.zellM));
      for (let z = z0; z <= z1; z++) {
        for (let sp = s0; sp <= s1; sp++) {
          const schluessel = z * k.spalten + sp;
          if (zellen.has(schluessel)) continue;
          const [e, n] = raster.zellMitte(sp, z);
          if (!punktInRing([e, n], f.polygon)) continue;
          if ((f.loecher ?? []).some((h) => punktInRing([e, n], h))) continue;
          zellen.set(schluessel, { sp, z, e, n, weg: Infinity, oberkante: hoeheBei(e, n) });
        }
      }
    }
    if (zellen.size < 4) continue;

    // --- 2. Wo kommt der Strang an die Oberflaeche? --------------------------
    // An seinen FREIEN ENDEN: Endpunkte von Stueckachsen, an denen kein anderes
    // Stueck desselben Strangs anschliesst. Nicht an den Seiten — dort liegt
    // ueberall eine Verkehrsflaeche, weil ALKIS den Strassenraum flaechendeckend
    // fuehrt (nachgezaehlt: 6.925 von 6.925 Zellen ueberdeckt).
    const achsen = teile.map((f) => achseVon(f)).filter((a): a is Punkt[] => !!a);
    const endpunkte: { p: Punkt; stueck: number }[] = [];
    for (const [i, a] of achsen.entries()) {
      endpunkte.push({ p: a[0], stueck: i });
      endpunkte.push({ p: a[a.length - 1], stueck: i });
    }
    const frei = endpunkte.filter(
      (x) => !endpunkte.some((y) => y.stueck !== x.stueck && Math.hypot(y.p[0] - x.p[0], y.p[1] - x.p[1]) < NAHT_M * 2),
    );
    const muender = frei.filter((x) => endeOffen(x.p, offene)).map((x) => x.p);
    const strangLaenge = achsen.reduce((s, a) => s + polylinieLaenge(a), 0);
    if (strangLaenge < MIN_RAMPE_M) continue;
    if (!muender.length) {
      // KEIN ANSCHLUSS, KEIN AUSHUB. Ein Strang, der nirgends an die Oberflaeche
      // kommt, hat kein Portal — seine Tiefe waere frei erfunden.
      bericht.ohneAnschluss++;
      bericht.luecken.push(
        `Unterirdischer Strang »${name}« (${Math.round(strangLaenge)} m, ${teile.length} Stueck) hat an keinem Ende Anschluss an eine ` +
          `kartierte Verkehrsflaeche. Ohne Portal ist seine Tiefe nicht ableitbar; er bleibt auf Gelaendehoehe.`,
      );
      continue;
    }

    // --- 3. Wie steil, wie tief? --------------------------------------------
    // BELEG VOR ANNAHME: Fuehrt IRGENDEIN Stueck des Strangs ein `incline`,
    // gilt es fuer den Strang; sonst die Rampenneigung der Bauklassen.
    const inclines = teile
      .map((f) => f.lage?.inclineProzent)
      .filter((x): x is number => x != null && Math.abs(x) > 0.5)
      .map(Math.abs);
    const belegt = inclines.length > 0;
    const neigung = Math.min(belegt ? Math.max(...inclines) : vertikal.rampe.annahmeNeigungProzent, vertikal.rampe.maxNeigungProzent) / 100;
    if (neigung <= 0) continue;
    const grenze = Math.max(...teile.map((f) => tiefenGrenze(f.lage, vertikal)));
    const herkunft: Hoehenband['herkunft'] = belegt ? 'osm' : teile.some((f) => f.lage?.osmLevel != null) ? 'abgeleitet' : 'annahme';

    // --- 4. WEG BIS ZUR NAECHSTEN MUENDUNG, im Strang gemessen --------------
    // Dijkstra ueber die Zellen des Strangs. Der Weg laeuft IM Bauwerk und
    // folgt darum jeder Kurve und jeder Verzweigung; eine Luftlinie taete das
    // nicht. Aus dem Weg ergibt sich die Tiefe: Neigung mal Weg, gedeckelt
    // durch die Tiefengrenze.
    const liste: Zelle[] = [];
    for (const z of zellen.values()) {
      for (const m of muender) {
        const d = Math.hypot(z.e - m[0], z.n - m[1]);
        if (d < z.weg) z.weg = d;
      }
      if (z.weg <= 3) liste.push(z);
      else z.weg = Infinity;
    }
    if (!liste.length) continue;
    // Einfache Warteschlange mit Neusortierung — bei einigen tausend Zellen
    // schneller aufgeschrieben als ein Haldenbaum und schnell genug.
    liste.sort((a, b) => a.weg - b.weg);
    while (liste.length) {
      const z = liste.shift() as Zelle;
      for (let dz = -1; dz <= 1; dz++) {
        for (let ds = -1; ds <= 1; ds++) {
          if (!dz && !ds) continue;
          const nachbar = zellen.get((z.z + dz) * k.spalten + (z.sp + ds));
          if (!nachbar) continue;
          const neu = z.weg + Math.hypot(ds, dz) * k.zellM;
          if (neu < nachbar.weg - 1e-6) {
            nachbar.weg = neu;
            liste.push(nachbar);
          }
        }
      }
      if (liste.length > 1) liste.sort((a, b) => a.weg - b.weg);
    }

    const tiefeVon = (weg: number) => Math.min(grenze, neigung * weg);
    let tiefsteImStrang = 0;
    for (const z of zellen.values()) if (Number.isFinite(z.weg)) tiefsteImStrang = Math.max(tiefsteImStrang, tiefeVon(z.weg));

    // KANN DAS UEBERHAUPT UNTER DIE ERDE? Reicht der Strang nirgends tief genug,
    // dass ueber ihm eine Decke Platz haette, ist er keine Unterfuehrung,
    // sondern eine DURCHFAHRT AUF STRASSENNIVEAU — eine Hofdurchfahrt, eine
    // Arkade, ein Haustor. OpenStreetMap kennt dafuer `tunnel=building_passage`,
    // aber nicht jeder Erfasser benutzt es. Im Lauf vom 10.08.2026 waren 28 der
    // 33 Straenge von dieser Art: 5 bis 28 m lang, beide Enden an einer Strasse,
    // in der Mitte 30 bis 170 cm tief.
    if (tiefsteImStrang < deckung - 1e-6) {
      bericht.alsDurchfahrt++;
      bericht.luecken.push(
        `»${name}« (${Math.round(strangLaenge)} m, ${muender.length} Muendungen) ist in OpenStreetMap als Tunnel erfasst, kaeme aber ` +
          `nirgends tiefer als ${tiefsteImStrang.toFixed(2)} m unter das Gelaende — zu wenig fuer eine Decke ` +
          `(${deckung.toFixed(2)} m noetig). Das ist keine Unterfuehrung, sondern eine Durchfahrt auf Strassenniveau. ` +
          `Sie bleibt auf Gelaendehoehe.`,
      );
      continue;
    }

    if (belegt) bericht.mitIncline++;
    bericht.rampen++;
    bericht.rampenLaengeM += strangLaenge;
    if (tiefsteImStrang > bericht.tiefsteM) bericht.tiefsteM = tiefsteImStrang;

    // --- 5. Je Stueck eine Hoehenebene aus SEINEN Zellen ---------------------
    // Ausgleichsebene durch die Sohlenpunkte des Stuecks. Sie ist die
    // einfachste Flaeche, die zu allen gemessenen Werten passt — und sie kommt
    // jetzt aus dem STRANG, nicht mehr aus der Zufaelligkeit eines
    // Polygonstuecks (der Citytunnel hatte so acht verschiedene Tiefen).
    const sohleJeZelle = new Map<number, number>();
    for (const f of teile) {
      const eigene: Zelle[] = [];
      const bb = bboxVonPunkten(f.polygon);
      for (const z of zellen.values()) {
        if (!Number.isFinite(z.weg)) continue;
        if (z.e < bb.minE || z.e > bb.maxE || z.n < bb.minN || z.n > bb.maxN) continue;
        if (!punktInRing([z.e, z.n], f.polygon)) continue;
        eigene.push(z);
      }
      f.lage = { ...(f.lage ?? {}), herkunft };
      if (!eigene.length) continue;
      /*
       * DIE EBENE WIRD UEBER DIE OFFENEN ZELLEN GELEGT, nicht ueber alle.
       *
       * Ein Polygonstueck reicht regelmaessig vom offenen Trog bis unter die
       * Decke. Nimmt man alle seine Zellen in die Ausgleichung, zieht der tiefe,
       * ueberdeckte Teil die Ebene nach unten — und im offenen Teil, dem
       * einzigen, der spaeter gezeichnet wird, liegt sie dann UNTER dem
       * ausgehobenen Boden. Nachgemessen am Lauf vom 10.08.2026: 12,4 % der
       * zugeschnittenen Fahrbahn lagen so noch bis zu 2,80 m unter der Erde.
       *
       * Gezeichnet wird nur der offene Teil; also muss die Ebene zu ihm passen.
       * Hat ein Stueck gar keine offene Zelle, faellt es beim Zuschnitt ohnehin
       * heraus — dann darf die Ausgleichung ueber alles laufen.
       */
      const offen = eigene.filter((z) => tiefeVon(z.weg) < deckung - 1e-6);
      const traegt = offen.length >= 3 ? offen : eigene;
      const ebene = ebeneAusgleichen(traegt.map((z) => [z.e, z.n, z.oberkante - tiefeVon(z.weg)] as [number, number, number]));
      f.lage.hoehenEbene = ebene;
      f.lage.tiefeM = Math.round(Math.max(...eigene.map((z) => tiefeVon(z.weg))) * 100) / 100;
      // DIE GEZEICHNETE FAHRBAHN IST DIE VORLAGE FUER DEN AUSHUB, nicht der
      // gemessene Weg. Beides duerfte auseinandergehen — die Ausgleichsebene
      // glaettet, der Weg folgt jeder Kurve — und dann steht die Fahrbahn
      // stellenweise unter dem ausgehobenen Boden und blitzt in Fetzen durch
      // (Bild vom 10.08.2026). Ausgehoben wird darum bis unter DIE EBENE.
      for (const z of eigene) {
        const h = ebene.a * (z.e - ebene.e0) + ebene.b * (z.n - ebene.n0) + ebene.c;
        const bisher = sohleJeZelle.get(z.z * k.spalten + z.sp);
        if (bisher === undefined || h < bisher) sohleJeZelle.set(z.z * k.spalten + z.sp, h);
      }
    }

    // --- 6. Ausheben — aber nur, solange keine Decke Platz haette ------------
    const offeneZellen: Zelle[] = [];
    for (const z of zellen.values()) {
      if (!Number.isFinite(z.weg)) continue;
      if (tiefeVon(z.weg) >= deckung - 1e-6) continue;
      const sohle = sohleJeZelle.get(z.z * k.spalten + z.sp);
      if (sohle === undefined) continue;
      offeneZellen.push(z);
      const neu = sohle - RAMPEN_AUFBAU_M;
      // NIE ANHEBEN: Eine Rampe schneidet ein, sie schuettet nicht auf.
      if (neu < raster.hoeheOder(z.e, z.n, neu)) {
        raster.setze(z.sp, z.z, neu);
        bericht.rasterZellen++;
      }
    }
    bericht.trogFlaecheM2 += offeneZellen.length * k.zellM * k.zellM;

    // --- 7. Der Trog wird aus dem Boden geschnitten --------------------------
    // Umriss ist die AUSGEHOBENE ZELLE SELBST, um SCHNITT_ZUGABE_M vergroessert.
    // Bliebe auch nur ein Streifen Bodenflaeche ueber ausgehobenem Gelaende
    // stehen, holte er sich seine Hoehen aus dem Graben und haenge in Fetzen
    // hinein — im Bild vom 10.08.2026 genau so zu sehen.
    const r = k.zellM / 2 + SCHNITT_ZUGABE_M;
    const h = k.zellM / 2;
    /*
     * DIE SOHLE IST DAS INNERE DES AUSHUBS, nicht der Aushub selbst.
     *
     * Das Bodenloch darf GROESSER sein als der Aushub (sonst haengt ein Streifen
     * Bodenflaeche in den Graben) — die Rampenfahrbahn muss KLEINER sein. Der
     * Grund ist das Raster: Zwischen einer ausgehobenen und einer stehen
     * gebliebenen Zelle steigt das gezeichnete Gelaendenetz ueber EINEN Meter um
     * die volle Grabentiefe an. Die Fahrbahn ist dort eine Ebene und schneidet
     * durch diese Rampe hindurch. Nachgemessen am Lauf vom 10.08.2026: 42 % der
     * zugeschnittenen Fahrbahn lag noch unter dem Boden, bis zu 3,13 m tief —
     * fast alles davon in diesem einen Zellstreifen am Grabenrand.
     *
     * Darum zaehlt fuer die Fahrbahn nur eine Zelle, deren vier Nachbarn
     * EBENFALLS ausgehoben sind. Sie endet damit einen Meter vor der Trogwand —
     * und dort steht die Wand, nicht die Strasse.
     */
    const offenSchluessel = new Set(offeneZellen.map((z) => z.z * k.spalten + z.sp));
    for (const z of offeneZellen) {
      troege.push([
        [z.e - r, z.n - r],
        [z.e + r, z.n - r],
        [z.e + r, z.n + r],
        [z.e - r, z.n + r],
      ] as Ring);
      // ALLE ACHT Nachbarn, nicht nur die vier geraden: Ein Polygon reicht auch
      // ueber die Ecke einer Zelle hinaus, und dort steht dieselbe Trogwand.
      let innen = true;
      for (let dz = -1; dz <= 1 && innen; dz++) {
        for (let ds = -1; ds <= 1; ds++) {
          if (!dz && !ds) continue;
          if (!offenSchluessel.has((z.z + dz) * k.spalten + z.sp + ds)) {
            innen = false;
            break;
          }
        }
      }
      if (!innen) continue;
      sohlen.push([
        [z.e - h, z.n - h],
        [z.e + h, z.n - h],
        [z.e + h, z.n + h],
        [z.e - h, z.n + h],
      ] as Ring);
    }

    // --- 8. Portal an jeder Muendung, quer zur Rampe -------------------------
    // Es steht dort, wo die Ueberdeckung erstmals reicht: an der GRENZE des
    // Aushubs. Gemessen wird sie an den ausgehobenen Zellen, die dem Ende des
    // Trogs am naechsten liegen.
    const lichte = teile.map((f) => f.lage?.maxhoeheM).find((x) => x != null) ?? vertikal.tiefgarage.lichteHoeheM;
    const trogEndeM = deckung / neigung;
    const rand = offeneZellen.filter((z) => trogEndeM - z.weg < 1.5 * k.zellM);
    const gruppen = randGruppieren(rand, 6);
    for (const [i, gruppe] of gruppen.entries()) {
      if (gruppe.length < 2) continue;
      const mitte: Punkt = [
        gruppe.reduce((s, z) => s + z.e, 0) / gruppe.length,
        gruppe.reduce((s, z) => s + z.n, 0) / gruppe.length,
      ];
      // Hauptrichtung der Gruppe = die Portalbreite; sie liegt quer zur Rampe.
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (const z of gruppe) {
        const dx = z.e - mitte[0];
        const dy = z.n - mitte[1];
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
      }
      const winkel = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const richtung: Punkt = [Math.cos(winkel), Math.sin(winkel)];
      const halbe = Math.max(
        1.5,
        Math.max(...gruppe.map((z) => Math.abs((z.e - mitte[0]) * richtung[0] + (z.n - mitte[1]) * richtung[1]))),
      );
      linien.push({
        id: `portal_${teile[0].id}_${i}`,
        art: 'portal',
        achse: [
          [mitte[0] - richtung[0] * halbe, mitte[1] - richtung[1] * halbe],
          [mitte[0] + richtung[0] * halbe, mitte[1] + richtung[1] * halbe],
        ],
        hoeheM: Math.round(lichte * 100) / 100,
        breiteM: 0.35,
        name: teile[0].bezeichnung,
        lage: { herkunft: teile.some((f) => f.lage?.maxhoeheM != null) ? 'osm' : 'annahme', lichteHoeheM: lichte },
      });
      bericht.portale++;

      // TROGWAND als Bruchkante — die Wand ist ein Ergebnis (BAUWERKSMODELL,
      // Ebene 2), damit auch die Regelpruefung von ihr weiss.
      for (const seite of [1, -1]) {
        const quer: Punkt = [-richtung[1] * seite, richtung[0] * seite];
        const linie: Punkt[] = [];
        const oben: number[] = [];
        const unten: number[] = [];
        for (let s = 0; s <= trogEndeM; s += 2) {
          const p: Punkt = [mitte[0] + quer[0] * s, mitte[1] + quer[1] * s];
          const zelle = zellen.get(
            Math.round((p[1] - k.minN) / k.zellM - 0.5) * k.spalten + Math.round((p[0] - k.minE) / k.zellM - 0.5),
          );
          if (!zelle || !Number.isFinite(zelle.weg)) break;
          const sohle = zelle.oberkante - tiefeVon(zelle.weg);
          if (zelle.oberkante - sohle < 0.3) continue;
          linie.push(p);
          oben.push(zelle.oberkante);
          unten.push(sohle);
        }
        if (linie.length >= 2) {
          kanten.push({
            id: `bk_rampe_${teile[0].id}_${i}_${seite > 0 ? 'l' : 'r'}`,
            art: 'sprung',
            bauart: 'stuetzmauer',
            linie,
            hoehenOben: oben,
            hoehenUnten: unten,
            herkunft: 'bauklasse',
            bezeichnung: 'Trogwand einer Rampe',
          });
        }
      }
    }
  }

  return { linien, kanten, troege, sohlen, bericht };
}

/**
 * BRUECKEN EINMESSEN.
 *
 * Der Ueberbau liegt auf der Verbindung seiner beiden Widerlager, nicht auf
 * dem Gelaende. Das ist keine Annahme, sondern die Definition einer Bruecke:
 * Sie ueberspannt etwas. Die Widerlagerhoehen sind gemessen (Gelaende an den
 * beiden Enden der Achse), die Gerade dazwischen ist die einfachste Flaeche,
 * die beide verbindet — bei einer Stadtbruecke ist sie richtig, bei einem
 * Talviadukt mit Ueberhoehung zu einfach. Das steht so im Hoehenband.
 *
 * Die LICHTE HOEHE wird danach gemessen: kleinster Abstand zwischen Ueberbau-
 * UNTERKANTE und Gelaende darunter. Sie ist der Wert, mit dem die
 * Regelpruefung spaeter arbeiten kann.
 */
export function brueckenEinmessen(
  flaechen: GelaendeFlaeche[],
  hoeheBei: (e: number, n: number) => number,
  vertikal: VertikalMasse | null,
  bericht: HoehenbandBericht,
): void {
  if (!vertikal) return;
  /**
   * DICKE DES UEBERBAUS AUS DER STUETZWEITE.
   *
   * Im ersten Lauf bekam jede Bruecke pauschal 1,20 m — der Wert einer
   * Strassenbruecke. Auf eine 6 m lange Fussgaengerbruecke ueber einen Bach
   * angewandt ergab das eine LICHTE HOEHE VON -1,74 m: Der Ueberbau reichte
   * tiefer als der Bach. Alle 8 Bruecken kamen so auf negative Werte, und
   * „0 Bruecken mit lichter Hoehe" war kein Befund ueber die Stadt, sondern
   * ueber die Annahme.
   *
   * Die Bauteildicke haengt an der Stuetzweite. Als Faustzahl des
   * Brueckenbaus liegt die Schlankheit eines Balkenueberbaus bei etwa 1/20 der
   * Stuetzweite; darunter 0,25 m (duenner baut niemand), darueber der Wert der
   * Bauklassen. Das bleibt eine ANNAHME — aber eine, die mit dem Bauwerk
   * skaliert statt gegen es zu arbeiten.
   */
  const dickeFuer = (spannweiteM: number) => Math.min(vertikal.bruecke.ueberbauDickeM, Math.max(0.25, spannweiteM / 20));
  for (const f of flaechen) {
    if (!f.lage?.bruecke || f.polygon.length < 3) continue;
    const achse = achseVon(f);
    if (!achse) continue;
    const laenge = polylinieLaenge(achse);
    if (laenge < 3) continue;
    bericht.bruecken++;
    const dicke = dickeFuer(laenge);

    const a = achse[0];
    const b = achse[achse.length - 1];
    const hA = hoeheBei(a[0], a[1]);
    const hB = hoeheBei(b[0], b[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-6) continue;
    // Ebene durch beide Widerlager, quer zur Achse waagerecht.
    const ebene = { a: ((hB - hA) * dx) / l2, b: ((hB - hA) * dy) / l2, c: hA, e0: a[0], n0: a[1] };
    const deck = (e: number, n: number) => ebene.a * (e - ebene.e0) + ebene.b * (n - ebene.n0) + ebene.c;

    // Lichte Hoehe messen — entlang der Achse in Metern abgetastet.
    let kleinste = Infinity;
    const schritte = Math.max(4, Math.round(laenge));
    for (let i = 0; i <= schritte; i++) {
      const { p } = aufPolylinie(achse, (laenge * i) / schritte);
      const frei = deck(p[0], p[1]) - dicke - hoeheBei(p[0], p[1]);
      if (frei < kleinste) kleinste = frei;
    }
    const gemessen = Number.isFinite(kleinste) ? Math.round(kleinste * 100) / 100 : undefined;

    // WOHER DIE LICHTE HOEHE KOMMT — und wann sie NICHT zu haben ist.
    //
    // 1. `maxheight` aus OpenStreetMap ist eine Angabe vor Ort und gilt.
    // 2. Sonst wird sie aus dem Hoehenmodell GEMESSEN: Ueberbau-Unterkante
    //    gegen das Gelaende darunter.
    // 3. Kommt dabei ein Wert <= 0 heraus, heisst das NICHT „die Bruecke ist
    //    zu niedrig", sondern: DAS HOEHENMODELL ZEIGT UNTER IHR KEINE SENKE.
    //    DGM1 ist ein GELAENDEmodell; Brueckenbauwerke sind darin nicht
    //    durchgaengig entfernt, und ein Bauwerk, das im DGM als Boden steht,
    //    kann nichts ueberspannen. Nachgemessen am Pilotgebiet (10.08.2026):
    //    bei allen 8 Bruecken lag die Gelaendehoehe unter der Bruecke exakt
    //    auf der Verbindungslinie ihrer Widerlager — die Differenz betrug
    //    ausnahmslos genau die Ueberbaudicke. Ein solcher Wert wird NICHT als
    //    lichte Hoehe ausgegeben; er wird als Datenluecke gemeldet.
    const beleg = f.lage.maxhoeheM;
    const lichte = beleg ?? (gemessen !== undefined && gemessen > 0.5 ? gemessen : undefined);
    f.lage = {
      ...f.lage,
      herkunft: beleg !== undefined ? 'osm' : 'abgeleitet',
      hoehenEbene: ebene,
      ueberbauDickeM: dicke,
      ...(lichte !== undefined ? { lichteHoeheM: lichte } : {}),
    };
    if (lichte !== undefined) {
      bericht.brueckenMitLichterHoehe++;
      if (bericht.kleinsteLichteHoeheM === null || lichte < bericht.kleinsteLichteHoeheM) {
        bericht.kleinsteLichteHoeheM = lichte;
      }
    } else {
      bericht.brueckenOhneMessung++;
    }
  }
}
