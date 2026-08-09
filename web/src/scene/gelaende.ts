/**
 * Gelaendedarstellung.
 *
 * Der Cesium-Globus bleibt AUS. Stattdessen wird das Gelaende als eigenes
 * Dreiecksnetz gebaut: jede Kachel ist ein regelmaessiges Gitter in
 * EPSG:25832-Koordinaten mit den amtlichen Hoehen. Die Luftbildkachel wird vom
 * WMS in genau derselben UTM-Bbox geholt, also sitzt sie pixelgenau auf dem
 * Netz — es gibt keine Umprojizierung und damit auch keinen Versatz an den
 * Kachelraendern, wie er beim Warpen nach WGS84 entsteht.
 */

import * as Cesium from 'cesium';
import type { Gelaende, GelaendePatch, Punkt } from '@shared/domain/types';
import { nachUtm, nachWgs } from '@shared/geo/proj';
import { Hoehenraster } from '@shared/geo/raster';
import { Gelaendeoberflaeche, netzAusRaster } from '@shared/geo/gelaendenetz';
import { Bauhoehe } from '@shared/geo/bauhoehe';

/**
 * Grundton der Gelaendeplatte.
 *
 * Sie liegt unter allem und wird ueberall dort sichtbar, wo keine
 * Nutzungsflaeche kartiert ist — Hinterhoefe, Baulücken, Boeschungen. Ein
 * dunkler Ton reisst dort Loecher in die Karte; darum liegt sie auf dem
 * Grundton der Bebauungsflaechen, leicht abgesetzt.
 */
export const GRUNDPLATTE = '#e7e4e0';

/**
 * Schnelles Nachschlagen der Gelaendehoehe an beliebiger Stelle.
 *
 * SEIT 09.08.2026 fragt sie die GEZEICHNETE Flaeche, nicht mehr ein eigenes
 * Gitter. Vorher gab es zwei Wahrheiten: das Kachelgitter (4,7 m) beantwortete
 * die Frage „wie hoch ist der Boden", waehrend gezeichnet wurde, was das
 * Gelaendenetz hergab. Jede Abweichung zwischen beiden war ein Objekt, das
 * ueber oder unter dem sichtbaren Boden stand — die Wurzel der Farbflecken und
 * der schwebenden Koerper. Jetzt gibt es eine Flaeche, und beide benutzen sie.
 *
 * Ohne Hoehenraster (Gelaende aus einem Import vor dem 09.08.2026) faellt sie
 * auf das alte Kachelgitter zurueck; die Ergebnisse sind dann so grob wie
 * frueher, aber wenigstens nicht widerspruechlich.
 */
export class Hoehenlage {
  private patches: GelaendePatch[];
  private flaeche: Gelaendeoberflaeche | null;
  private bau: Bauhoehe;
  readonly mittel: number;
  /** true = echte Oberflaeche, false = grobes Rueckfallgitter. */
  readonly genau: boolean;

  constructor(gelaende: Gelaende | null, flaeche?: Gelaendeoberflaeche | null) {
    this.patches = gelaende?.patches ?? [];
    this.mittel = gelaende?.hoeheMittel ?? 0;
    this.flaeche = flaeche ?? null;
    this.genau = Boolean(flaeche);
    this.bau = new Bauhoehe(gelaende?.flaechen);
  }

  /**
   * Hoehe der GEBAUTEN Oberflaeche: Gelaende plus Aufbau der Bauklasse.
   *
   * Alles, was auf dem Boden STEHT, gehoert hierher — Laterne, Bank, Poller,
   * Bordstein, Gleis, Rettungsweg. `bei()` liefert dagegen das nackte
   * Gelaende und ist nur noch dort richtig, wo es um den gewachsenen Boden
   * geht (Boeschungen, Gruenflaechen, das Gelaendenetz selbst).
   *
   * Ohne Konstruktionshoehen (Gelaende aus einem Import vor dem 09.08.2026)
   * ist beides dasselbe — dann verhaelt sich alles wie bisher.
   */
  bauOben(e: number, n: number): number {
    return this.bei(e, n) + this.bau.ueberGrund(e, n);
  }

  /** Nur der Aufbau ueber dem Gelaende (0, wo nichts gebaut ist). */
  aufbau(e: number, n: number): number {
    return this.bau.ueberGrund(e, n);
  }

  /** true = dieses Gelaende kennt Konstruktionshoehen. */
  get mitBauhoehen(): boolean {
    return this.bau.vorhanden;
  }

  /** Bilineare Auswertung in EINEM Patch (Koordinaten werden geklemmt). */
  private beiPatch(p: Gelaende['patches'][number], e: number, n: number): number {
    const fx = ((e - p.bbox.minE) / (p.bbox.maxE - p.bbox.minE)) * (p.spalten - 1);
    const fy = ((n - p.bbox.minN) / (p.bbox.maxN - p.bbox.minN)) * (p.zeilen - 1);
    const x0 = Math.max(0, Math.min(p.spalten - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(p.zeilen - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const h00 = p.hoehen[y0][x0];
    const h10 = p.hoehen[y0][x0 + 1];
    const h01 = p.hoehen[y0 + 1][x0];
    const h11 = p.hoehen[y0 + 1][x0 + 1];
    return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
  }

  /**
   * Bilineare Auswertung im Kachelgitter. AUSSERHALB der Patches wird die
   * Kante des naechstgelegenen Patches FORTGESCHRIEBEN statt auf die mittlere
   * Gebietshoehe zu springen: die Stadtdetails reichen 50 m ueber die
   * Patch-Abdeckung hinaus, und ein Baum am Gebietsrand stand sonst auf
   * hoeheMittel — je nach Lage meterweise ueber oder unter dem Boden.
   */
  bei(e: number, n: number): number {
    if (this.flaeche) return this.flaeche.hoeheBei(e, n);
    let nächster: Gelaende['patches'][number] | null = null;
    let bestAbstand = Infinity;
    for (const p of this.patches) {
      const de = Math.max(p.bbox.minE - e, 0, e - p.bbox.maxE);
      const dn = Math.max(p.bbox.minN - n, 0, n - p.bbox.maxN);
      if (de === 0 && dn === 0) return this.beiPatch(p, e, n);
      const d = de * de + dn * dn;
      if (d < bestAbstand) {
        bestAbstand = d;
        nächster = p;
      }
    }
    if (nächster && bestAbstand < 200 * 200) {
      const e2 = Math.max(nächster.bbox.minE, Math.min(nächster.bbox.maxE, e));
      const n2 = Math.max(nächster.bbox.minN, Math.min(nächster.bbox.maxN, n));
      return this.beiPatch(nächster, e2, n2);
    }
    return this.mittel;
  }

  /** Punkt in Weltkoordinaten, wahlweise mit Aufschlag ueber Grund. */
  welt(p: Punkt, ueberGrund = 0): Cesium.Cartesian3 {
    const [lon, lat] = nachWgs(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat, this.bei(p[0], p[1]) + ueberGrund);
  }

  /** Ring in Weltkoordinaten (alle Punkte auf Gelaendehoehe + Aufschlag). */
  weltRing(ring: Punkt[], ueberGrund = 0): Cesium.Cartesian3[] {
    return ring.map((p) => this.welt(p, ueberGrund));
  }
}

/**
 * Fuegt Zwischenpunkte ein, bis kein Kantenstueck laenger als `maxAbstand` ist.
 *
 * WARUM DAS NOETIG IST — der Grund fuer „ein Gehweg hat mehrere Farben":
 * Eine Bodenflaeche bekommt ihre Hoehe NUR an ihren Eckpunkten; Cesium spannt
 * das Innere linear dazwischen (`perPositionHeight` verdichtet ausdruecklich
 * nicht). Das Gelaende selbst ist dagegen ein Netz mit rund 4,7 m Maschenweite.
 * Ueberspannt eine Flaechenkante 40 oder 80 m, laeuft sie als SEHNE unter der
 * Gelaendekuppe hindurch — und der Boden stoesst mitten im Weg durch die
 * Flaeche. Nachgemessen am Pilotgebiet (08.08.2026): von 4.394 Gehwegkanten
 * sind 1.758 laenger als die Maschenweite, bei 369 davon steht das Gelaende bis
 * zu 60 cm ueber dem Gehweg. Der Hoehenstapel der Palette arbeitet mit
 * 2-mm-Stufen — gegen einen Fehler im Dezimeterbereich ist er wirkungslos.
 *
 * Zwei Meter Maximalabstand druecken den Restfehler auf rund (2/4,7)^2 des
 * Werts, also unter einen Zentimeter.
 */
export function verdichteRing(ring: Punkt[], maxAbstand = 2): Punkt[] {
  if (ring.length < 2) return ring;
  const out: Punkt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const laenge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const teile = Math.ceil(laenge / maxAbstand);
    for (let t = 1; t < teile; t++) {
      out.push([a[0] + ((b[0] - a[0]) * t) / teile, a[1] + ((b[1] - a[1]) * t) / teile]);
    }
  }
  return out;
}

/** Rechnet einen Cesium-Weltpunkt zurueck nach EPSG:25832. */
export function weltNachUtm(c: Cesium.Cartesian3): Punkt | null {
  const carto = Cesium.Cartographic.fromCartesian(c);
  if (!carto) return null;
  return nachUtm([Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]);
}

// ---------------------------------------------------------------------------
// Hoehenraster laden und daraus die eine Oberflaeche bauen
// ---------------------------------------------------------------------------

/**
 * Holt das binaere Hoehenraster des Gelaendes.
 *
 * Es kommt als ArrayBuffer und wird ohne Umwandlung benutzt — kein JSON, kein
 * Zahlenparser. Fuer das Pilotgebiet sind das 8,2 MB fuer 2,16 Mio. Zellen;
 * dieselben Werte im Gelaende-JSON waeren rund 14 MB Text, die der Browser
 * zeichenweise zerlegen muesste.
 *
 * Gibt null zurueck, wenn das Gelaende noch kein Raster hat (Import vor dem
 * 09.08.2026) — der Aufrufer faellt dann auf das Kachelgitter zurueck.
 */
export async function ladeHoehenraster(gelaendeId: string): Promise<Hoehenraster | null> {
  // OHNE HTTP-ZWISCHENSPEICHER (09.08.2026): Das Raster ist zweistellig
  // megabytegross und aendert sich, wenn ein Gelaende neu importiert und unter
  // derselben Id eingesetzt wird — aus dem Zwischenspeicher kaeme dann das alte.
  // Ausserdem scheiterte der Browser beim Wegschreiben dieser Groesse
  // (ERR_CACHE_WRITE_FAILURE), und das Gelaende fiel danach STILL auf das grobe
  // Kachelgitter zurueck. Ein Fehlschlag wird jetzt gemeldet, nicht verschwiegen.
  try {
    const antwort = await fetch(`/api/gelaende/${encodeURIComponent(gelaendeId)}/hoehen.bin`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!antwort.ok) {
      console.warn(`[Gelaende] Hoehenraster nicht geladen (HTTP ${antwort.status}) — es wird das grobe Kachelgitter benutzt.`);
      return null;
    }
    return Hoehenraster.ausPuffer(await antwort.arrayBuffer());
  } catch (e) {
    console.warn(`[Gelaende] Hoehenraster nicht geladen (${(e as Error).message}) — es wird das grobe Kachelgitter benutzt.`);
    return null;
  }
}

export interface GelaendeAufbau {
  /** Je Kachel ein Netz, in derselben Reihenfolge wie `gelaende.patches`. */
  netze: { patch: GelaendePatch; netz: ReturnType<typeof netzAusRaster> }[];
  /** Abfragbare Oberflaeche — dieselbe, die gezeichnet wird. */
  flaeche: Gelaendeoberflaeche;
  dreiecke: number;
  restFehlerM: number;
}

/**
 * Baut aus dem Raster das Gelaendenetz je Kachel UND die abfragbare Flaeche.
 *
 * Beides in einem Zug, weil es dasselbe sein MUSS: Die Flaeche wird aus genau
 * den Dreiecken gebaut, die auch gezeichnet werden. Zwei getrennte Aufbauten
 * waeren zwei Wahrheiten, und die haben dieses Modell bisher gekostet.
 */
export function gelaendeAufbauen(gelaende: Gelaende, raster: Hoehenraster): GelaendeAufbau {
  const toleranz = gelaende.hoehenmodell?.netzToleranzM ?? 0.08;
  const netze: GelaendeAufbau['netze'] = [];
  let dreiecke = 0;
  let restFehler = 0;
  for (const patch of gelaende.patches) {
    const netz = netzAusRaster(raster, patch.bbox, { toleranzM: toleranz });
    netze.push({ patch, netz });
    dreiecke += netz.anzahlDreiecke;
    if (netz.restFehlerM > restFehler) restFehler = netz.restFehlerM;
  }
  const flaeche = new Gelaendeoberflaeche(
    netze.map((x) => x.netz),
    raster.bbox,
    gelaende.hoeheMittel,
  );
  return { netze, flaeche, dreiecke, restFehlerM: restFehler };
}

/**
 * Zeichnet das Gelaendenetz — je Kachel ein Primitive mit eigener Textur.
 *
 * Anders als frueher ist das Netz nicht mehr regelmaessig, sondern
 * fehlergesteuert verfeinert: fein an Boeschungen, Grabenkanten und Rampen,
 * grob in der Ebene. Die Texturkoordinaten kommen aus dem Netz und beziehen
 * sich auf die Kachel, das Luftbild sitzt also weiterhin pixelgenau.
 */
export function baueGelaendeAusNetz(gelaende: Gelaende, aufbau: GelaendeAufbau, mitLuftbild: boolean): Cesium.Primitive[] {
  const prims: Cesium.Primitive[] = [];
  for (const { patch, netz } of aufbau.netze) {
    if (!netz.anzahlDreiecke) continue;
    const anzahl = netz.anzahlPunkte;
    const positionen = new Float64Array(anzahl * 3);
    for (let i = 0; i < anzahl; i++) {
      const [lon, lat] = nachWgs([netz.punkte[i * 3], netz.punkte[i * 3 + 1]]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, netz.punkte[i * 3 + 2]);
      positionen[i * 3] = c.x;
      positionen[i * 3 + 1] = c.y;
      positionen[i * 3 + 2] = c.z;
    }
    const attribute = new Cesium.GeometryAttributes();
    attribute.position = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positionen,
    });
    attribute.st = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: netz.uv,
    });
    const geometrie = Cesium.GeometryPipeline.computeNormal(
      new Cesium.Geometry({
        attributes: attribute,
        indices: netz.indizes,
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
      }),
    );
    const material =
      mitLuftbild && patch.texturDatei
        ? new Cesium.Material({
            fabric: { type: 'Image', uniforms: { image: `/api/gelaende/${gelaende.id}/textur/${patch.texturDatei}` } },
          })
        : Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(GRUNDPLATTE) });
    prims.push(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry: geometrie, id: `gelaende:${patch.id}` }),
        appearance: new Cesium.MaterialAppearance({
          material,
          faceForward: true,
          closed: false,
          // UNBELEUCHTET — und das ist keine Bequemlichkeit, sondern Pflicht.
          //
          // Fehler vom 09.08.2026, vom Auftraggeber am Bild erkannt („warum
          // verschiedene Farben und Boeden"): Ich hatte das Gelaende hier auf
          // beleuchtet umgestellt, damit man Boeschungen sieht. Die
          // Bodenzeichnung (stadt.ts) wird aber unbeleuchtet gezeichnet, und
          // die ganze Palette ist auf unbeleuchtete Toene kalibriert (die L*-
          // Abstaende in palette.ts gelten nur dann). Ergebnis waren zwei
          // Helligkeitssysteme auf EINEM Boden: Nutzungsflaechen in ihrem
          // exakten Ton, die Gelaendeplatte daneben je nach Neigung heller
          // oder dunkler — also genau die Flecken aus Weiss, Creme und Grau.
          //
          // Die Gelaendeform wird nicht durch Schattierung lesbar gemacht,
          // sondern durch die Koerper, die auf ihr stehen: Bordsteine,
          // Treppen, Mauern und deren Schlagschatten. Dafuer gibt es sie.
          flat: true,
          translucent: false,
        }),
        // Synchron bauen: gedrosselte Hintergrund-Tabs liefern kein
        // requestAnimationFrame, der Async-Pfad von Cesium bleibt dort haengen.
        asynchronous: false,
      }),
    );
  }
  return prims;
}

/**
 * Baut die Gelaende-Primitives: je Kachel ein texturiertes Dreiecksnetz.
 * Ohne Luftbild wird eine ruhige Graphitflaeche gezeichnet, damit das Gelaende
 * trotzdem als Koerper lesbar bleibt.
 *
 * RUECKFALLWEG fuer Gelaende ohne Hoehenraster (Import vor dem 09.08.2026).
 */
export function baueGelaende(gelaende: Gelaende, mitLuftbild: boolean): Cesium.Primitive[] {
  const prims: Cesium.Primitive[] = [];
  for (const patch of gelaende.patches) {
    const geo = kachelGeometrie(patch);
    if (!geo) continue;
    const instanz = new Cesium.GeometryInstance({
      geometry: geo,
      id: `gelaende:${patch.id}`,
    });
    const material =
      mitLuftbild && patch.texturDatei
        ? new Cesium.Material({
            fabric: {
              type: 'Image',
              uniforms: { image: `/api/gelaende/${gelaende.id}/textur/${patch.texturDatei}` },
            },
          })
        : Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(GRUNDPLATTE) });

    prims.push(
      new Cesium.Primitive({
        geometryInstances: instanz,
        appearance: new Cesium.MaterialAppearance({
          material,
          faceForward: false,
          closed: false,
          // Ungeschattet: das Luftbild bringt seine eigene Belichtung mit, und
          // die Ersatzflaeche soll ihren Farbwert unveraendert zeigen.
          flat: true,
          // Gelaende ist matt — kein Glanzlicht, sonst wirkt das Luftbild speckig
          translucent: false,
        }),
        // Synchron bauen: gedrosselte Hintergrund-Tabs liefern kein
        // requestAnimationFrame, der Async-Pfad von Cesium bleibt dort haengen.
        asynchronous: false,
      }),
    );
  }
  return prims;
}

function kachelGeometrie(patch: GelaendePatch): Cesium.Geometry | null {
  const { spalten, zeilen, bbox, hoehen } = patch;
  if (spalten < 2 || zeilen < 2) return null;
  const anzahl = spalten * zeilen;
  const positionen = new Float64Array(anzahl * 3);
  const st = new Float32Array(anzahl * 2);

  let i = 0;
  for (let z = 0; z < zeilen; z++) {
    const n = bbox.minN + ((bbox.maxN - bbox.minN) * z) / (zeilen - 1);
    for (let s = 0; s < spalten; s++) {
      const e = bbox.minE + ((bbox.maxE - bbox.minE) * s) / (spalten - 1);
      const [lon, lat] = nachWgs([e, n]);
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, hoehen[z][s]);
      positionen[i * 3] = c.x;
      positionen[i * 3 + 1] = c.y;
      positionen[i * 3 + 2] = c.z;
      // s waechst nach Osten, z nach Norden. Cesium legt Bilder mit
      // umgedrehter Y-Achse an, darum entspricht t=0 dem Suedrand.
      st[i * 2] = s / (spalten - 1);
      st[i * 2 + 1] = z / (zeilen - 1);
      i++;
    }
  }

  const indizes = new Uint32Array((spalten - 1) * (zeilen - 1) * 6);
  let k = 0;
  for (let z = 0; z < zeilen - 1; z++) {
    for (let s = 0; s < spalten - 1; s++) {
      const a = z * spalten + s;
      const b = a + 1;
      const c = a + spalten;
      const d = c + 1;
      indizes[k++] = a;
      indizes[k++] = c;
      indizes[k++] = b;
      indizes[k++] = b;
      indizes[k++] = c;
      indizes[k++] = d;
    }
  }

  // GeometryAttributes nimmt keine Optionen entgegen — Felder einzeln setzen.
  const attribute = new Cesium.GeometryAttributes();
  attribute.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionen,
  });
  attribute.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: st,
  });

  const geometrie = new Cesium.Geometry({
    attributes: attribute,
    indices: indizes,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionen)),
  });

  return Cesium.GeometryPipeline.computeNormal(geometrie);
}
