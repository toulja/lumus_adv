/**
 * Messzeug fuer den Szenenaufbau (Stufe A aus docs/PLAN-DARMSTADT.md).
 *
 * WARUM ES DAS GIBT: Ohne wiederholbare Messung ist jede Aussage ueber
 * Leistung eine Meinung. Alle Stufen des Plans berufen sich auf dieselben
 * Zahlen — also muessen sie an EINER Stelle entstehen, im selben Format, mit
 * Rechnername, damit zwei Maschinen vergleichbar sind.
 *
 * WARUM NICHT NUR DIE BAUZEIT GEMESSEN WIRD: Ein Cesium-Primitive mit
 * `asynchronous: false` uebersetzt seine Geometrie NICHT im Erzeuger, sondern
 * beim ersten `update()` — also waehrend des ersten Bildes, in dem es sichtbar
 * ist. Wer nur die Zeit im Erzeuger misst, misst den kleineren Teil und wundert
 * sich, warum das Fenster trotzdem steht. Deshalb misst dieses Modul beides:
 *
 *   1. `bauMs` je Gruppe  — die Zeit im Erzeuger (Ohrenschnitt, Normalen,
 *      Kantenableitung; das, was eine Kachel-Backerei spaeter auf den Server
 *      verlegen wuerde).
 *   2. `bereitMs`         — die Zeit vom Beginn des Aufbaus bis zur ersten
 *      RUHIGEN Szene: drei aufeinanderfolgende Bilder unter 20 ms. Das ist die
 *      Groesse, die der Nutzer als "endlich da" erlebt.
 *   3. `laengsterFrameMs` — das laengste Einzelbild in dieser Zeit. Das ist die
 *      Groesse, die "die Seite reagiert nicht" erzeugt. Zielwert < 50 ms.
 *
 * Die Bildzeiten kommen aus `scene.postRender`, nicht aus
 * `requestAnimationFrame`: in einem gedrosselten Hintergrund-Tab gibt es kein
 * rAF, und genau dort ist frueher schon gemessen worden, was gar nicht lief.
 */

import type * as Cesium from 'cesium';

export interface GruppenMessung {
  name: string;
  bauMs: number;
  primitives: number;
}

export interface Aufbaubericht {
  art: 'aufbau';
  zeitpunkt: string;
  gelaendeId: string;
  gelaendeName: string;
  /** Was in diesem Gelaende steckt — ohne das sind die Zeiten nicht deutbar. */
  mengen: Record<string, number>;
  gruppen: GruppenMessung[];
  bauSummeMs: number;
  /** Zeit bis zur ruhigen Szene; null, wenn sie in 30 s nicht eintrat. */
  bereitMs: number | null;
  /**
   * Warum `bereitMs` fehlt. Wichtig, weil ein GEDROSSELTES Fenster (Hintergrund-
   * Tab, verborgene Vorschau) fast keine Bilder zeichnet — dann ist die fehlende
   * Bereitzeit kein Leistungsbefund, sondern ein Messfehler. Die Zahl der
   * Bilder in `bilder` ist die Probe darauf.
   */
  bereitGrund: string | null;
  laengsterFrameMs: number | null;
  /** Wie viele Bilder ueber 50 ms brauchten — jedes davon ist ein Ruckler. */
  frames50: number | null;
  bilder: number | null;
  speicherMb: number | null;
  browser: string;
  bildschirm: string;
}

let laufend: {
  bericht: Aufbaubericht;
  t0: number;
} | null = null;

let letzter: Aufbaubericht | null = null;

/** Der zuletzt fertig gemessene Aufbau (auch ueber window.EP3D erreichbar). */
export function letzterBericht(): Aufbaubericht | null {
  return letzter;
}

/** Beginnt eine Messung. Ein zweiter Aufruf verwirft eine noch laufende. */
export function aufbauStarten(gelaendeId: string, gelaendeName: string, mengen: Record<string, number>) {
  laufend = {
    t0: performance.now(),
    bericht: {
      art: 'aufbau',
      zeitpunkt: new Date().toISOString(),
      gelaendeId,
      gelaendeName,
      mengen,
      gruppen: [],
      bauSummeMs: 0,
      bereitMs: null,
      bereitGrund: null,
      laengsterFrameMs: null,
      frames50: null,
      bilder: null,
      speicherMb: null,
      browser: navigator.userAgent,
      bildschirm: `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`,
    },
  };
}

/**
 * Misst einen Bauabschnitt. `anzahl` liefert die Zahl der entstandenen
 * Primitives — sie wird NACH dem Bau abgefragt, weil die Gruppen ihre
 * Primitives erst dort einhaengen.
 */
export function messeGruppe<T>(name: string, bauen: () => T, anzahl?: (ergebnis: T) => number): T {
  if (!laufend) return bauen();
  const t = performance.now();
  const ergebnis = bauen();
  const bauMs = performance.now() - t;
  const primitives = anzahl ? anzahl(ergebnis) : Array.isArray(ergebnis) ? ergebnis.length : 0;
  laufend.bericht.gruppen.push({ name, bauMs: Math.round(bauMs * 10) / 10, primitives });
  return ergebnis;
}

/**
 * Schliesst den Bauteil der Messung ab und beobachtet die Bilder, bis die
 * Szene ruhig ist. Danach steht der Bericht in `letzterBericht()`.
 */
export function aufbauEnde(scene: Cesium.Scene, fertig?: (b: Aufbaubericht) => void) {
  if (!laufend) return;
  const lauf = laufend;
  laufend = null;
  lauf.bericht.bauSummeMs = Math.round(lauf.bericht.gruppen.reduce((s, g) => s + g.bauMs, 0) * 10) / 10;

  let vorheriges = performance.now();
  let ruhige = 0;
  let laengster = 0;
  let ueber50 = 0;
  let bilder = 0;

  const abschluss = (bereit: boolean) => {
    scene.postRender.removeEventListener(beobachter);
    const b = lauf.bericht;
    b.bereitMs = bereit ? Math.round(performance.now() - lauf.t0) : null;
    b.bereitGrund = bereit
      ? null
      : bilder < 10
        ? `Nur ${bilder} Bilder in 30 s — Fenster gedrosselt oder verborgen. Messung der Bereitzeit ungueltig.`
        : 'Szene wurde in 30 s nicht ruhig (drei Bilder unter 20 ms).';
    b.laengsterFrameMs = Math.round(laengster);
    b.frames50 = ueber50;
    b.bilder = bilder;
    const sp = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    b.speicherMb = sp ? Math.round(sp.usedJSHeapSize / 1048576) : null;
    letzter = b;
    console.info(
      `[Messung] Aufbau ${b.gelaendeName}: Bau ${b.bauSummeMs} ms, ` +
        `bereit nach ${b.bereitMs ?? '—'} ms, laengstes Bild ${b.laengsterFrameMs} ms, ` +
        `${b.frames50} von ${b.bilder} Bildern ueber 50 ms${b.speicherMb !== null ? `, Speicher ${b.speicherMb} MB` : ''}.` +
        (b.bereitGrund ? ` ${b.bereitGrund}` : ''),
    );
    console.table(b.gruppen);
    fertig?.(b);
  };

  const beobachter = () => {
    const jetzt = performance.now();
    const dauer = jetzt - vorheriges;
    vorheriges = jetzt;
    bilder++;
    if (dauer > laengster) laengster = dauer;
    if (dauer > 50) ueber50++;
    // Drei ruhige Bilder hintereinander = die Szene steht. Ein einzelnes
    // schnelles Bild sagt nichts: zwischen zwei Brocken Bauarbeit liegt oft
    // eines.
    ruhige = dauer < 20 ? ruhige + 1 : 0;
    if (ruhige >= 3) abschluss(true);
    else if (jetzt - lauf.t0 > 30_000) abschluss(false);
  };

  scene.postRender.addEventListener(beobachter);
}

/**
 * Schickt einen Bericht an den Server, der ihn unter
 * `data/cache/leistung/` ablegt. Ohne Server-Ablage waere die Messung nach
 * dem naechsten Neuladen weg — und damit unvergleichbar.
 */
export async function berichtSenden(bericht: Aufbaubericht | null = letzter, kennung?: string) {
  if (!bericht) return { ok: false, fehler: 'Noch kein Bericht vorhanden.' };
  const res = await fetch('/api/debug/leistung', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ bericht, kennung }),
  });
  return res.json() as Promise<{ ok: boolean; datei?: string; fehler?: string }>;
}
