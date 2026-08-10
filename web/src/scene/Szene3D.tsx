/**
 * Die 3D-Buehne (Lastenheft F2).
 *
 * Grundsatzentscheidung: Der Cesium-Globus ist AUS. Gezeichnet wird
 * ausschliesslich das eigene Gelaendenetz aus amtlichen Hoehen — damit
 * braucht die Anwendung keinen Kartendienst-Zugang, laeuft offline und die
 * Masse stimmen exakt, weil alles aus EPSG:25832 kommt.
 */

import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { ElementRef, ObjektTyp, Punkt } from '@shared/domain/types';
import { STATIONS_KATEGORIEN } from '@shared/domain/types';
import { grundriss, masseVon } from '@shared/domain/objekte';
import { abstand, abstandPunktStrecke, flaeche, naechsterPunktAufStrecke, polylinieLaenge, punktInRing, schwerpunkt } from '@shared/geo/geometry';
import { nachWgs } from '@shared/geo/proj';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import { Hoehenlage, baueGelaende, baueGelaendeAusNetz, gelaendeAufbauen, ladeHoehenraster, weltNachUtm } from './gelaende.ts';
import type { Hoehenraster } from '@shared/geo/raster';
import {
  baueStadt,
  baueBodenzeichnung,
  baueFahrbahnmarkierungen,
  baueBeschriftungen,
  baueGebaeudeKanten,
  baueGeschossbaender,
  baueBrueckenkoerper,
  HIMMEL,
} from './stadt.ts';
import { LICHT } from './palette.ts';
import { baueBaeume, baueHecken } from './vegetation.ts';
import { baueKanten, kantenBilanz } from './kanten.ts';
import { baueTreppen } from './treppen.ts';
import { baueHaltestellen, baueBarrieren, bauePortale, baueStrassenmoebel, baueVerkehrszeichen } from './verkehr.ts';
// Gleise kommen seit 09.08.2026 aus einem eigenen Modul: sie werden nicht mehr
// als Baender je OSM-Weg gezeichnet, sondern als Querschnitt entlang eines
// vernetzten Strangs (docs/BAUWERKSMODELL.md, Stufe 4 und 5).
import { baueGleise } from './gleise.ts';
import {
  FARBEN,
  baueBeanstandungen,
  baueBlockflaechen,
  baueGeist,
  baueObjekte,
  baueStationen,
  baueWege,
  baueZugaenge,
  beschrifteObjekte,
} from './darstellung.ts';

interface Zeichenstand {
  punkte: Punkt[];
  art: 'weg' | 'blockflaeche' | 'messen_distanz' | 'messen_flaeche';
}

export function Szene3D({ sichtbar }: { sichtbar: boolean }) {
  const behaelter = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const abbauTimer = useRef<number | null>(null);
  const hoehenRef = useRef<Hoehenlage>(new Hoehenlage(null));
  /** Fuer welches Gelaende die Startkamera schon gesetzt wurde. */
  const kameraGelaendeRef = useRef<string | null>(null);
  /** Abmelder des eigenen Rad-Zooms (siehe radZoomAnmelden). */
  const zoomAbmelden = useRef<(() => void) | null>(null);
  const gruppen = useRef<Record<string, Cesium.Primitive[]>>({});
  const labelsRef = useRef<Cesium.LabelCollection | null>(null);
  const haltLabelsRef = useRef<Cesium.LabelCollection | null>(null);
  const geistRef = useRef<Cesium.Primitive | null>(null);
  const zeichenRef = useRef<Zeichenstand | null>(null);
  const dragRef = useRef<{ art: 'verschieben' | 'drehen'; objektId: string; start: Punkt; startRot: number; versatz: Punkt } | null>(null);
  const [hinweis, setHinweis] = useState<string>('');
  const [zeichnet, setZeichnet] = useState<Zeichenstand | null>(null);
  /**
   * Das amtliche Hoehenraster des offenen Gelaendes (1 m), sobald geladen.
   * Bewusst NICHT `raster` genannt: so heisst weiter unten das Fangraster des
   * Editors (0,1 / 0,5 / 1 m) — zwei sehr verschiedene Dinge.
   */
  const [hoehenDaten, setHoehenDaten] = useState<{ gelaendeId: string; raster: Hoehenraster | null } | null>(null);

  const gelaende = nutzeZustand((s) => s.gelaende);
  const inhalt = nutzeZustand((s) => s.inhalt);
  const typen = nutzeZustand((s) => s.typen);
  const auswahl = nutzeZustand((s) => s.auswahl);
  const ebenen = nutzeZustand((s) => s.ebenen);
  const editorStatus = nutzeZustand((s) => s.editorStatus);
  const bericht = nutzeZustand((s) => s.bericht);
  const werkzeug = nutzeZustand((s) => s.werkzeug);
  const platzierTypId = nutzeZustand((s) => s.platzierTypId);
  const raster = nutzeZustand((s) => s.raster);
  const anKantenFangen = nutzeZustand((s) => s.anKantenFangen);
  const praesenz = nutzeZustand((s) => s.praesenz);
  const messungen = nutzeZustand((s) => s.messungen);
  const darf = nutzeZustand((s) => s.darf);

  // ---------------------------------------------------------------- Aufbau
  useEffect(() => {
    if (abbauTimer.current !== null) {
      // Der zweite StrictMode-Durchlauf: den geplanten Abbau abbestellen
      clearTimeout(abbauTimer.current);
      abbauTimer.current = null;
    }
    if (!behaelter.current || viewerRef.current) return;
    const viewer = new Cesium.Viewer(behaelter.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      // Nur mit ?debug=1: das Zeichenpuffer-Erhalten kostet Leistung, ist aber
      // die Voraussetzung dafuer, dass canvas.toDataURL() ein Bild liefert.
      contextOptions: new URLSearchParams(location.search).has('debug')
        ? { webgl: { preserveDrawingBuffer: true } }
        : undefined,
    });
    viewerRef.current = viewer;
    // Fuer Testautomatisierung und Fehlersuche von aussen erreichbar
    (window as unknown as Record<string, unknown>).EP3D = {
      viewer,
      Cesium,
      hoehen: () => hoehenRef.current,
      zustand: nutzeZustand,
      abzug: async (name = 'szene') => {
        viewer.render();
        const bild = viewer.canvas.toDataURL('image/png');
        const res = await fetch('/api/debug/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bild, name }),
        });
        return res.json();
      },
    };

    const szene = viewer.scene;
    szene.globe.show = false;

    // SCHLAGSCHATTEN — die groesste verbliebene Tiefenmassnahme.
    // Cesiums Schattensystem folgt automatisch scene.light (dem Modellsonnen-
    // stand, der beim Gelaende gesetzt wird). Ohne Schatten steht die Stadt
    // flach im Nichts; mit Schatten bekommt jedes Haus einen Fuss auf dem Boden
    // und die Hoehenstaffelung wird ablesbar (KARTENDESIGN 4.1, 4).
    try {
      viewer.shadows = true;
      const sm = viewer.shadowMap;
      sm.softShadows = true;
      sm.size = 4096; // scharfe Kanten auch bei 1 km2 Ausdehnung
      sm.darkness = 0.55; // nicht schwarz — ein Planungsmodell, kein Nachtbild
      // 1500 statt 4000: die Tiefenaufloesung der Schattenkarte verteilt sich
      // auf diese Distanz — 4 km erzeugten auf grossen Flachdaechern ein
      // Gitterraster aus Selbstverschattung (Shadow-Acne).
      sm.maximumDistance = 1500;
      sm.normalOffset = true;
      // SHADOW-ACNE-KALIBRIERUNG (Befund 08.08.2026, im Live-Viewer
      // abgestimmt): Cesiums Standard-Bias (depthBias 0.00002,
      // normalOffsetScale 0.1) reicht fuer unsere grossen, exakt ebenen
      // LoD2-Daecher nicht — sie zeigten ein feines Schraffur-Gitter
      // ("Gebaeude sehen schmutzig aus"). Die Bias-Felder sind PRIVATE
      // Cesium-API (_primitiveBias), darum im try/catch: faellt die API weg,
      // bleibt nur die harmlose Acne, kein Absturz.
      const bias = (sm as unknown as { _primitiveBias?: Record<string, number | boolean> })._primitiveBias;
      if (bias) {
        bias.depthBias = 0.0004;
        bias.normalOffsetScale = 3.0;
        bias.polygonOffsetFactor = 1.5;
        bias.polygonOffsetUnits = 8.0;
        (sm as unknown as { dirty?: boolean }).dirty = true;
      }
    } catch {
      /* aeltere Hardware: ohne Schatten flacher, aber lauffaehig */
    }

    // Himmelskoerper sind in Cesium optional — nur abschalten, wenn vorhanden.
    if (szene.skyBox) szene.skyBox.show = false;
    if (szene.sun) szene.sun.show = false;
    if (szene.moon) szene.moon.show = false;
    if (szene.skyAtmosphere) szene.skyAtmosphere.show = false;
    szene.backgroundColor = Cesium.Color.fromCssColorString(HIMMEL);
    szene.fog.enabled = false;
    // Die Lichtrichtung wird beim Laden des Gelaendes gesetzt — sie muss im
    // OERTLICHEN System des Gebiets gerechnet werden. Ein fester Vektor in
    // Erdkoordinaten trifft den Boden je nach Lage auf der Erde fast gar nicht;
    // die Flaechen blieben dann schwarz.
    szene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0, 0, -1),
      intensity: 2.4,
    });
    szene.screenSpaceCameraController.enableCollisionDetection = false;
    // Rechtsziehen soll die Szene umkreisen statt zu zoomen
    szene.screenSpaceCameraController.zoomEventTypes = [Cesium.CameraEventType.PINCH];
    szene.screenSpaceCameraController.tiltEventTypes = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.PINCH,
    ];
    /*
     * EIGENER RAD-ZOOM — der eingebaute taugt fuer diese Szene nicht.
     *
     * Cesium bemisst den Zoomschritt am Abstand zur Bezugsflaeche. Die ist
     * normalerweise der Globus; der ist hier abgeschaltet (szene.globe.show =
     * false), weil wir unser eigenes Gelaendenetz zeichnen. Cesium faellt dann
     * auf das ERDELLIPSOID zurueck — und das liegt in Darmstadt rund 143 m
     * UNTER dem Boden. Der Zoom laeuft damit gegen eine unterirdische Flaeche
     * und stirbt vorher ab: nachgemessen 08.08.2026 kam die Kamera mit
     * 40 Radrastungen nur von 257 m auf 27 m ueber Grund, mit immer kleineren
     * Schritten (145 m -> 54 -> 20 -> 7 -> 3 m). Naeher heran ging gar nicht.
     *
     * Darum: WHEEL aus der eingebauten Zoomsteuerung nehmen und selbst
     * rechnen — gegen den Punkt, der wirklich unter dem Mauszeiger liegt.
     * Das ist zugleich das Verhalten, das man von einer Karte erwartet
     * (Zoom auf den Zeiger statt auf die Bildmitte).
     */
    zoomAbmelden.current?.();
    zoomAbmelden.current = radZoomAnmelden(viewer, () => hoehenRef.current);

    labelsRef.current = szene.primitives.add(new Cesium.LabelCollection());
    haltLabelsRef.current = szene.primitives.add(new Cesium.LabelCollection());

    return () => {
      // React fuehrt Effekte im Entwicklungsbetrieb (StrictMode) doppelt aus:
      // aufbauen, abraeumen, wieder aufbauen. Ein sofortiges destroy() wuerde
      // den Viewer zerstoeren, den der zweite Durchlauf dann weiterverwendet.
      // Darum wird das Abraeumen verzoegert und beim Wiederaufbau abbestellt.
      abbauTimer.current = window.setTimeout(() => {
        abbauTimer.current = null;
        zoomAbmelden.current?.();
        zoomAbmelden.current = null;
        if (!viewer.isDestroyed()) viewer.destroy();
        if (viewerRef.current === viewer) viewerRef.current = null;
      }, 0);
    };
  }, []);

  // Bei Ansichtswechsel muss Cesium die Canvasgroesse neu bestimmen
  useEffect(() => {
    if (sichtbar) setTimeout(() => viewerRef.current?.resize(), 60);
  }, [sichtbar]);

  // Schlagschatten schaltbar: eigener Effekt, damit das Umschalten NICHT den
  // ganzen Gelaende-Aufbau (und damit mehrere Sekunden Rechenzeit) ausloest.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.shadows = ebenen.schatten;
    viewer.scene.requestRender?.();
  }, [ebenen.schatten]);

  // Hoehenraster laden, sobald ein anderes Gelaende offen ist. Es ist die
  // Grundlage von allem, was danach gebaut wird — darum wartet der
  // Gelaende-Aufbau unten ausdruecklich darauf, statt erst grob zu bauen und
  // gleich darauf noch einmal fein (das kostete mehrere Sekunden doppelt).
  useEffect(() => {
    let abgebrochen = false;
    if (!gelaende) {
      setHoehenDaten(null);
      return;
    }
    if (!gelaende.hoehenmodell) {
      // Altbestand ohne Raster: sofort mit dem Kachelgitter weiterarbeiten.
      setHoehenDaten({ gelaendeId: gelaende.id, raster: null });
      return;
    }
    setHinweis('Hoehenmodell wird geladen …');
    void ladeHoehenraster(gelaende.id)
      .then((r) => {
        if (abgebrochen) return;
        setHoehenDaten({ gelaendeId: gelaende.id, raster: r });
        setHinweis('');
      })
      .catch((e: Error) => {
        if (abgebrochen) return;
        // Ohne Raster ist die Szene nicht falsch, nur grob — das gehoert
        // gesagt, statt still auf den alten Weg zurueckzufallen.
        setHinweis(`Hoehenmodell nicht ladbar (${e.message}) — grobes Ersatzgelaende.`);
        setHoehenDaten({ gelaendeId: gelaende.id, raster: null });
      });
    return () => {
      abgebrochen = true;
    };
  }, [gelaende?.id, gelaende?.hoehenmodell?.datei]);

  // ------------------------------------------------------------- Gelaende
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!gelaende) {
      // Gelaende weg (Projekt geschlossen): ALLE Bestandsgruppen raeumen.
      // Frueher kehrte der Effekt hier einfach um — die alte Stadt blieb als
      // Geisterkulisse stehen, wenn das naechste Projekt ein anderes Gebiet
      // hat.
      for (const name of Object.keys(gruppen.current)) ersetze(viewer, gruppen.current, name, []);
      haltLabelsRef.current?.removeAll();
      labelsRef.current?.removeAll();
      hoehenRef.current = new Hoehenlage(null);
      kameraGelaendeRef.current = null;
      return;
    }
    // Auf das Hoehenraster warten (Effekt darueber). Ohne diese Sperre wuerde
    // die ganze Stadt einmal auf dem groben Ersatzgelaende gebaut und Sekunden
    // spaeter noch einmal auf dem echten.
    if (hoehenDaten?.gelaendeId !== gelaende.id) return;
    const aufbau = hoehenDaten.raster ? gelaendeAufbauen(gelaende, hoehenDaten.raster) : null;
    hoehenRef.current = new Hoehenlage(gelaende, aufbau?.flaeche);
    const h = hoehenRef.current;
    if (aufbau) {
      const k = hoehenDaten.raster!.kopf;
      console.info(
        `[Gelaende] ${aufbau.dreiecke.toLocaleString('de-DE')} Dreiecke aus ${k.spalten}x${k.zeilen} Zellen a ${k.zellM} m, groesste Restabweichung ${(aufbau.restFehlerM * 100).toFixed(1)} cm.`,
      );
    }
    if (gelaende.bruchkanten?.length) {
      console.info(
        `[Kanten] ${kantenBilanz(gelaende.bruchkanten).map((b) => `${b.anzahl} x ${b.bauart} (${b.laengeM.toLocaleString('de-DE')} m)`).join(', ')}`,
      );
    }

    // Modellsonne nach palette.LICHT: Suedost (135 Grad), 45 Grad ueber dem
    // Horizont — im oertlichen Ost-Nord-Oben-System des Gebiets aufgestellt
    // und erst dann in Erdkoordinaten gedreht. 135 Grad steht zu beiden
    // Darmstaedter Hauptachsen (Ost-West Rheinstrasse, Nord-Sued Ludwigstrasse)
    // im 45-Grad-Winkel — achsparalleles Licht nimmt einer der beiden
    // Strassenrichtungen die Tiefe.
    {
      const mitteU: Punkt = [(gelaende.bbox.minE + gelaende.bbox.maxE) / 2, (gelaende.bbox.minN + gelaende.bbox.maxN) / 2];
      const [mlon, mlat] = nachWgs(mitteU);
      const rahmen = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(mlon, mlat, gelaende.hoeheMittel),
      );
      const azimut = Cesium.Math.toRadians(LICHT.azimutGrad);
      const hoehe = Cesium.Math.toRadians(LICHT.hoeheGrad);
      const lokal = new Cesium.Cartesian3(
        -Math.sin(azimut) * Math.cos(hoehe),
        -Math.cos(azimut) * Math.cos(hoehe),
        -Math.sin(hoehe),
      );
      const welt = Cesium.Matrix4.multiplyByPointAsVector(rahmen, lokal, new Cesium.Cartesian3());
      viewer.scene.light = new Cesium.DirectionalLight({
        direction: Cesium.Cartesian3.normalize(welt, welt),
        // Verhaeltnis Sonne zu Umgebungslicht etwa 2,5:1 — haerter laufen die
        // abgewandten Fassaden zu und das Modell wirkt wieder wie ein Klotz.
        intensity: 2.0,
      });
      // Umgebungsverdeckung: laut Recherche die wirksamste Einzelmassnahme
      // gegen den Klotz-Eindruck. Nur einschalten, wenn die Hardware sie traegt.
      try {
        const ao = viewer.scene.postProcessStages?.ambientOcclusion;
        if (ao && Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(viewer.scene)) {
          ao.enabled = true;
          // Abgestimmt 08.08.2026: intensity 2.2 / blur 0.9 erzeugte auf
          // grossen ebenen Flaechen sichtbares AO-Korn ("schmutzige"
          // Fassaden). Weniger Intensitaet, kuerzerer Radius, mehr Weichzeichnung.
          ao.uniforms.intensity = 1.3;
          ao.uniforms.bias = 0.1;
          ao.uniforms.lengthCap = 0.35;
          ao.uniforms.stepSize = 1.0;
          ao.uniforms.blurStepSize = 1.45;
        }
      } catch {
        /* ohne Umgebungsverdeckung sieht es flacher aus, laeuft aber */
      }
    }

    // Grundplatte: mit Luftbild texturiert, ohne Luftbild als ruhige Flaeche,
    // auf der die Nutzungsflaechen ihre Kontraste entfalten koennen.
    ersetze(
      viewer,
      gruppen.current,
      'gelaende',
      ebenen.gelaende
        ? aufbau
          ? baueGelaendeAusNetz(gelaende, aufbau, ebenen.luftbild)
          : baueGelaende(gelaende, ebenen.luftbild)
        : [],
    );

    // Bodenzeichnung nach tatsaechlicher Nutzung — das massgetreue Abbild.
    // Dazu Fahrbahnmarkierungen (Leitlinien, Spurstriche) und die
    // Parkplatz-Beschriftung — beide lesen dieselben Flaechendaten.
    if (ebenen.nutzung && !ebenen.luftbild && gelaende.flaechen?.length) {
      const nutzungPrims: (Cesium.Primitive | Cesium.LabelCollection)[] = [
        ...baueBodenzeichnung(gelaende.flaechen, h),
        // Kantenkoerper (Bordstein, Boeschung, Stuetzmauer) gehoeren zur
        // Bodenzeichnung: sie sind das, was aus zwei Farbfeldern eine Strasse
        // mit Rand macht. Sie stammen aus dem Modell, nicht aus dem Renderer
        // (Gelaende.bruchkanten, abgeleitet beim Import).
        ...baueKanten(gelaende.bruchkanten, h),
        ...baueFahrbahnmarkierungen(gelaende.linien ?? [], h),
      ];
      // Bruecken: Ueberbau und Widerlager. Die Fahrbahn darauf zeichnet
      // baueBodenzeichnung bereits auf ihrer Hoehenebene; hier kommt der
      // Koerper darunter dazu — und damit die lichte Hoehe als BILD.
      const bruecken = baueBrueckenkoerper(gelaende.flaechen, h);
      nutzungPrims.push(...bruecken.prims);
      if (bruecken.bericht.bruecken) {
        console.info(
          `[Bruecken] ${bruecken.bericht.bruecken} Ueberbauten gezeichnet` +
            `${bruecken.bericht.kleinsteLichteHoeheM !== null ? `, kleinste lichte Hoehe ${bruecken.bericht.kleinsteLichteHoeheM.toFixed(2)} m` : ''}.`,
        );
      }
      // Treppen als Koerper: Ihre Stufenzahl folgt der GEMESSENEN
      // Hoehendifferenz aus dem Gelaendemodell, das Stufenmass ist eine
      // Annahme der Bauklassen. Ohne sie laeuft jede Fluchtwegrechnung ueber
      // 137 ebene Flaechen hinweg, als waeren es Gehwege.
      // Das Stufenmass kommt aus den BAUKLASSEN und reist mit dem Gelaende mit
      // (`gelaende.stufenmass`). Damit rechnet der Browser mit genau denselben
      // Eingaben wie der Import, der daraus die Gelaender abgeleitet hat.
      const treppen = baueTreppen(gelaende.flaechen, h, gelaende.stufenmass);
      nutzungPrims.push(...treppen.prims);
      if (treppen.bericht.flaechen) {
        const t = treppen.bericht;
        console.info(
          `[Treppen] ${t.flaechen} Flaechen -> ${t.teile} Laufteile -> ${t.laeufe} Laeufe mit ${t.stufen} Stufen ` +
            `(hoechster Lauf ${t.hoechsterLaufM} m, Stufenhoehe ${t.stufenHoeheMinM !== null ? (t.stufenHoeheMinM * 100).toFixed(1) : '–'}–${t.stufenHoeheMaxM !== null ? (t.stufenHoeheMaxM * 100).toFixed(1) : '–'} cm, ` +
            `${t.mitBeleg} mit gezaehlter Stufenzahl aus OSM); ${t.flach} als Podest/Rampe erkannt (unter 30 cm Steigung).`,
        );
        for (const b of t.befunde.slice(0, 10)) console.warn(`[Treppen] ${b}`);
        if (t.befunde.length > 10) console.warn(`[Treppen] … und ${t.befunde.length - 10} weitere Befunde.`);
      }
      const parkLabels = baueBeschriftungen(gelaende.beschriftungen ?? [], h);
      if (parkLabels) nutzungPrims.push(parkLabels);
      ersetze(viewer, gruppen.current, 'nutzung', nutzungPrims as Cesium.Primitive[]);
    } else {
      ersetze(viewer, gruppen.current, 'nutzung', []);
    }

    // Gebaeude aus den ECHTEN LoD2-Dach- und Wandflaechen
    if (ebenen.gebaeude) {
      const stadt = baueStadt(gelaende);
      const kanten = baueGebaeudeKanten(gelaende);
      const baender = baueGeschossbaender(gelaende);
      const gebPrims = [...stadt.prims, ...kanten];
      if (baender) gebPrims.push(baender);
      ersetze(viewer, gruppen.current, 'gebaeude', gebPrims);
      console.log(`[Stadt] ${stadt.mitDach} Gebaeude mit echter Dachform, ${stadt.ersatz} als Ersatzkoerper`);
    } else {
      ersetze(viewer, gruppen.current, 'gebaeude', []);
    }

    // --- Stadtdetails: Baeume, Gleise, Haltestellen, Mauern, Moebel -------
    // Sie sind es, die einen Ort wiedererkennbar machen. Ohne sie bleibt jedes
    // Stadtmodell austauschbar.
    const punkte = gelaende.punkte ?? [];
    const linien = gelaende.linien ?? [];
    const hecken = linien.filter((l) => l.art === 'hecke');
    const gleise = linien.filter((l) => l.art === 'gleis');
    const barrieren = linien.filter((l) => l.art !== 'hecke' && l.art !== 'gleis' && l.art !== 'markierung');

    if (ebenen.nutzung) {
      const gleisBau = baueGleise(gleise, h);
      ersetze(viewer, gruppen.current, 'gleise', gleisBau.prims);
      const b = gleisBau.bericht;
      console.info(
        `[Gleise] ${b.stuecke} Stuecke -> ${b.straenge} durchgehende Straenge (${b.geheilteSchnitte} kuenstliche Schnitte geheilt, ${b.verzweigungen} Weichen/Kreuzungen), ` +
          `${b.laengeM.toLocaleString('de-DE')} m: ${b.rillenschieneM.toLocaleString('de-DE')} m Rillenschiene, ${b.schotterM.toLocaleString('de-DE')} m Schotteroberbau mit ${b.schwellen.toLocaleString('de-DE')} Schwellen. ${b.dreiecke.toLocaleString('de-DE')} Dreiecke.`,
      );
    } else {
      ersetze(viewer, gruppen.current, 'gleise', []);
    }
    ersetze(viewer, gruppen.current, 'barrieren', ebenen.nutzung ? baueBarrieren(barrieren, h) : []);
    // Portale: die Waende, in denen Rampen und Unterfuehrungen verschwinden.
    // Sie stammen aus dem Hoehenband (server/geodata/hoehenband.ts) und tragen
    // ihre lichte Hoehe als Angabe des Modells, nicht als Zierrat.
    ersetze(viewer, gruppen.current, 'portale', ebenen.nutzung ? bauePortale(linien, h) : []);
    ersetze(viewer, gruppen.current, 'vegetation', ebenen.gebaeude ? [...baueBaeume(punkte, h), ...baueHecken(hecken, h)] : []);
    ersetze(viewer, gruppen.current, 'moebel', ebenen.nutzung ? baueStrassenmoebel(punkte, h) : []);
    ersetze(viewer, gruppen.current, 'verkehrszeichen', ebenen.nutzung ? baueVerkehrszeichen(punkte, h) : []);

    const halte = ebenen.nutzung ? baueHaltestellen(punkte, h) : { prims: [], labels: [] };
    ersetze(viewer, gruppen.current, 'haltestellen', halte.prims);
    if (labelsRef.current) {
      // Haltestellennamen dauerhaft in einer eigenen Sammlung fuehren
      haltLabelsRef.current?.removeAll();
      for (const l of halte.labels) {
        haltLabelsRef.current?.add({
          position: l.pos,
          text: l.text,
          font: '600 12px system-ui, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#2c3238'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(60, 1.0, 800, 0.5),
          translucencyByDistance: new Cesium.NearFarScalar(350, 1.0, 900, 0.0),
        });
      }
    }

    // Kamera auf das Gebiet — aber NUR beim ersten Laden dieses Gelaendes.
    // Der Effekt laeuft auch bei jedem Ebenen-Umschalter (Luftbild, Gebaeude,
    // Nutzung); frueher setzte jeder Umschalter die Kamera auf die Uebersicht
    // zurueck und warf einen mitten aus der Detailarbeit.
    if (kameraGelaendeRef.current !== gelaende.id) {
      kameraGelaendeRef.current = gelaende.id;
      const mitte = [(gelaende.bbox.minE + gelaende.bbox.maxE) / 2, (gelaende.bbox.minN + gelaende.bbox.maxN) / 2] as Punkt;
      const spann = Math.max(gelaende.bbox.maxE - gelaende.bbox.minE, gelaende.bbox.maxN - gelaende.bbox.minN);
      const [lon, lat] = nachWgs(mitte);
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat - spann / 220000, gelaende.hoeheMittel + spann * 0.75),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-42), roll: 0 },
      });
    }
    // `hoehenDaten` gehoert in die Abhaengigkeiten: der Aufbau wartet oben
    // darauf und muss laufen, sobald das Raster da ist.
  }, [gelaende, hoehenDaten, ebenen.gelaende, ebenen.luftbild, ebenen.gebaeude, ebenen.nutzung]);

  // ------------------------------------------------------------- Inhalte
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !inhalt) return;
    const h = hoehenRef.current;
    const gewaehlt = new Set(auswahl.map((a) => a.id));

    const objekte = ebenen.objekte ? baueObjekte(inhalt.objekte, typen, h, editorStatus, gewaehlt) : { koerper: null, umrisse: null };
    ersetze(viewer, gruppen.current, 'objekte', [objekte.koerper, objekte.umrisse].filter(Boolean) as Cesium.Primitive[]);
    ersetze(viewer, gruppen.current, 'zugaenge', ebenen.objekte ? ([baueZugaenge(inhalt.objekte, typen, h)].filter(Boolean) as Cesium.Primitive[]) : []);
    ersetze(viewer, gruppen.current, 'wege', ebenen.wege ? baueWege(inhalt.wege, h, gewaehlt) : []);
    ersetze(viewer, gruppen.current, 'blockflaechen', ebenen.blockflaechen ? baueBlockflaechen(inhalt.blockflaechen, h, gewaehlt) : []);
    ersetze(viewer, gruppen.current, 'stationen', ebenen.einsatzstationen ? baueStationen(inhalt.einsatzstationen, h, gewaehlt) : []);
    ersetze(viewer, gruppen.current, 'beanstandungen', bericht ? baueBeanstandungen(bericht.ergebnisse, h) : []);
    ersetze(viewer, gruppen.current, 'griffe', gewaehlt.size ? baueGriffe(inhalt, typen, h, gewaehlt) : []);

    if (labelsRef.current && ebenen.bemassung) beschrifteObjekte(labelsRef.current, inhalt.objekte, typen, h, gewaehlt);
    else labelsRef.current?.removeAll();
    // `gelaende` gehoert in die Abhaengigkeiten, obwohl es hier nicht direkt
    // gelesen wird: die Hoehenlage kommt ueber hoehenRef aus dem
    // Gelaende-Effekt. Trifft `inhalt` VOR `gelaende` ein (beide asynchron),
    // wuerden die Objekte sonst auf der leeren Hoehenlage (0 m) gebaut und nie
    // wieder aufgebaut — sie laegen unter dem Boden.
    // `hoehenDaten` ebenfalls: damit wechselt die Hoehenlage von grob auf genau.
  }, [gelaende, hoehenDaten, inhalt, typen, auswahl, ebenen, editorStatus, bericht]);

  // --------------------------------------------------------- Interaktion
  useEffect(() => {
    if (!viewerRef.current) return;
    // Bewusst mit Typangabe: die Handler unten sind hochgezogene
    // Funktionsdeklarationen, die die Einengung aus dem Wachtposten nicht
    // uebernehmen. So bleibt `viewer` in allen Handlern nicht-null.
    const viewer: Cesium.Viewer = viewerRef.current;
    const szene = viewer.scene;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    const z = nutzeZustand.getState;

    /** Mauszeiger -> Gelaendepunkt in EPSG:25832 (mit Fangen). */
    function bodenPunkt(pos: Cesium.Cartesian2, fangen = true): Punkt | null {
      let welt: Cesium.Cartesian3 | undefined;
      if (szene.pickPositionSupported) welt = szene.pickPosition(pos);
      if (!welt || !Number.isFinite(welt.x)) {
        // Ersatz: Strahl gegen die mittlere Gelaendehoehe schneiden
        const strahl = viewer.camera.getPickRay(pos);
        if (!strahl) return null;
        const ebene = Cesium.Plane.fromPointNormal(
          Cesium.Cartesian3.fromDegrees(...(nachWgs(mitteVonGelaende()) as [number, number]), hoehenRef.current.mittel),
          Cesium.Cartesian3.normalize(Cesium.Cartesian3.fromDegrees(...(nachWgs(mitteVonGelaende()) as [number, number]), 0), new Cesium.Cartesian3()),
        );
        const treffer = Cesium.IntersectionTests.rayPlane(strahl, ebene);
        if (!treffer) return null;
        welt = treffer;
      }
      const p = weltNachUtm(welt);
      return p && fangen ? fange(p) : p;
    }

    function mitteVonGelaende(): Punkt {
      const g = z().gelaende;
      if (!g) return [0, 0];
      return [(g.bbox.minE + g.bbox.maxE) / 2, (g.bbox.minN + g.bbox.maxN) / 2];
    }

    /** Raster, Objektkanten und Wegachsen fangen (F2.4). */
    function fange(p: Punkt): Punkt {
      const zs = z();
      let out: Punkt = [p[0], p[1]];
      if (zs.anKantenFangen && zs.inhalt) {
        let bestD = 1.2;
        let bestP: Punkt | null = null;
        for (const o of zs.inhalt.objekte) {
          const typ = zs.typen.get(o.typId);
          if (!typ) continue;
          const ring = grundriss(typ, o);
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const e = abstand(p, ring[i]);
            if (e < bestD) {
              bestD = e;
              bestP = ring[i];
            }
            const q = naechsterPunktAufStrecke(p, ring[j], ring[i]);
            const d = abstand(p, q);
            if (d < bestD) {
              bestD = d;
              bestP = q;
            }
          }
        }
        for (const w of zs.inhalt.wege) {
          for (let i = 1; i < w.polylinie.length; i++) {
            const q = naechsterPunktAufStrecke(p, w.polylinie[i - 1], w.polylinie[i]);
            const d = abstand(p, q);
            if (d < bestD) {
              bestD = d;
              bestP = q;
            }
          }
        }
        if (bestP) return bestP;
      }
      if (zs.raster > 0) {
        out = [Math.round(p[0] / zs.raster) * zs.raster, Math.round(p[1] / zs.raster) * zs.raster];
      }
      return out;
    }

    function refAus(id: unknown): ElementRef | null {
      if (typeof id !== 'string') return null;
      const [art, ...rest] = id.split(':');
      const wid = rest.join(':');
      if (['objekt', 'weg', 'blockflaeche', 'einsatzstation'].includes(art)) return { art: art as ElementRef['art'], id: wid };
      return null;
    }

    // -- Klick ------------------------------------------------------------
    handler.setInputAction((klick: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const zs = z();
      const treffer = szene.pick(klick.position);
      const p = bodenPunkt(klick.position);

      // Zeichenwerkzeuge sammeln Punkte
      if (['weg', 'blockflaeche', 'messen_distanz', 'messen_flaeche'].includes(zs.werkzeug)) {
        if (!p) return;
        const stand = zeichenRef.current ?? { punkte: [], art: zs.werkzeug as Zeichenstand['art'] };
        stand.punkte = [...stand.punkte, p];
        zeichenRef.current = stand;
        setZeichnet({ ...stand });
        zeichneVorschau(viewer, gruppen.current, stand, hoehenRef.current);
        return;
      }

      // Platzieren — das Werkzeug bleibt aktiv, damit mehrere Objekte
      // desselben Typs hintereinander gesetzt werden koennen (Esc beendet).
      if (zs.werkzeug === 'platzieren' && zs.platzierTypId && p) {
        const typ = zs.typen.get(zs.platzierTypId);
        if (typ) void zs.objektAnlegen({ typId: typ.id, position: p, rotation: 0 });
        return;
      }

      // Einsatzstation setzen
      if (zs.werkzeug === 'station' && p) {
        const name = window.prompt('Bezeichnung der Einsatzstation:', 'Sanitaetsstation');
        if (name?.trim()) {
          // Freitext gegen den Katalog pruefen — kein Blindcast, sonst laeuft
          // eine unbekannte Kategorie bis in die Datenhaltung durch.
          const eingabe = (window.prompt(`Kategorie (${STATIONS_KATEGORIEN.join(', ')}):`, 'sanitaet') ?? '').trim().toLowerCase();
          const kategorie = STATIONS_KATEGORIEN.find((k) => k === eingabe) ?? 'sanitaet';
          void zs.stationAnlegen({ kategorie, punkt: p, name: name.trim() });
        }
        zs.setzeWerkzeug('auswahl');
        return;
      }

      // Kommentar setzen
      if (zs.werkzeug === 'kommentar' && p) {
        const text = window.prompt('Kommentar an dieser Stelle:');
        if (text?.trim()) {
          const pid = zs.projektId;
          if (pid) void api.kommentarAnlegen(pid, { text: text.trim(), punkt: p }).then(() => zs.kommentareLaden());
        }
        zs.setzeWerkzeug('auswahl');
        return;
      }

      // Auswahl
      const ref = refAus(treffer?.id);
      zs.setzeAuswahl(ref ? [ref] : []);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // -- Doppelklick beendet das Zeichnen ---------------------------------
    handler.setInputAction(() => {
      abschliessen();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // -- Ziehen -----------------------------------------------------------
    handler.setInputAction((ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const zs = z();
      if (zs.werkzeug !== 'auswahl' || !zs.darf.elementAendern) return;
      const treffer = szene.pick(ev.position);
      const id = typeof treffer?.id === 'string' ? treffer.id : '';
      const p = bodenPunkt(ev.position, false);
      if (!p || !zs.inhalt) return;

      if (id.startsWith('griff:drehen:')) {
        const oid = id.slice('griff:drehen:'.length);
        const o = zs.inhalt.objekte.find((x) => x.id === oid);
        if (!o) return;
        dragRef.current = { art: 'drehen', objektId: oid, start: p, startRot: o.rotation, versatz: [0, 0] };
        szene.screenSpaceCameraController.enableInputs = false;
        zs.sperreAnfordern({ art: 'objekt', id: oid });
        return;
      }
      if (id.startsWith('objekt:')) {
        const oid = id.slice('objekt:'.length);
        const o = zs.inhalt.objekte.find((x) => x.id === oid);
        if (!o) return;
        dragRef.current = { art: 'verschieben', objektId: oid, start: p, startRot: o.rotation, versatz: [o.position[0] - p[0], o.position[1] - p[1]] };
        szene.screenSpaceCameraController.enableInputs = false;
        zs.sperreAnfordern({ art: 'objekt', id: oid });
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((bewegung: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const zs = z();
      const drag = dragRef.current;

      if (drag) {
        const roh = bodenPunkt(bewegung.endPosition, false);
        if (!roh) return;
        if (drag.art === 'verschieben') {
          const ziel = fange([roh[0] + drag.versatz[0], roh[1] + drag.versatz[1]]);
          void zs.objektAendern(drag.objektId, { position: ziel }, true);
        } else {
          const o = zs.inhalt?.objekte.find((x) => x.id === drag.objektId);
          if (!o) return;
          const winkel = (Math.atan2(roh[0] - o.position[0], roh[1] - o.position[1]) * 180) / Math.PI;
          let neu = (winkel + 360) % 360;
          // Fluchten fangen: alle 45 Grad, mit Toleranz 4 Grad
          const rest = neu % 45;
          if (rest < 4 || rest > 41) neu = Math.round(neu / 45) * 45;
          void zs.objektAendern(drag.objektId, { rotation: Math.round(neu * 10) / 10 }, true);
        }
        return;
      }

      // Cursor an die Mitplaner senden
      const p = bodenPunkt(bewegung.endPosition, false);
      if (p) zs.cursorSenden(p);

      // Platzier-Vorschau
      if (zs.werkzeug === 'platzieren' && zs.platzierTypId && p) {
        const typ = zs.typen.get(zs.platzierTypId);
        if (typ) zeigeGeist(viewer, geistRef, typ, fange(p), hoehenRef.current, zs);
      } else if (geistRef.current) {
        viewer.scene.primitives.remove(geistRef.current);
        geistRef.current = null;
      }

      // Vorschaulinie beim Zeichnen
      if (zeichenRef.current && p) {
        zeichneVorschau(viewer, gruppen.current, { ...zeichenRef.current, punkte: [...zeichenRef.current.punkte, fange(p)] }, hoehenRef.current);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    function beendeDrag() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      szene.screenSpaceCameraController.enableInputs = true;
      const zs = z();
      const o = zs.inhalt?.objekte.find((x) => x.id === drag.objektId);
      if (o) {
        void zs.objektAendern(drag.objektId, drag.art === 'verschieben' ? { position: o.position } : { rotation: o.rotation });
      }
      zs.sperreFreigeben({ art: 'objekt', id: drag.objektId });
    }
    handler.setInputAction(beendeDrag, Cesium.ScreenSpaceEventType.LEFT_UP);
    // Loslassen ausserhalb des Canvas darf die Kamera nicht dauerhaft sperren
    window.addEventListener('pointerup', beendeDrag);

    // -- Zeichnen abschliessen -------------------------------------------
    function abschliessen() {
      const stand = zeichenRef.current;
      const zs = z();
      if (!stand || stand.punkte.length < 2) return;
      zeichenRef.current = null;
      setZeichnet(null);
      ersetze(viewer, gruppen.current, 'vorschau', []);

      if (stand.art === 'weg') {
        const breite = Number(window.prompt('Breite des Weges in Metern:', '3.00')?.replace(',', '.'));
        if (!Number.isFinite(breite) || breite <= 0) return;
        void zs.wegAnlegen({ typ: 'rettungsweg', polylinie: stand.punkte, breite, richtung: 'beide' });
      } else if (stand.art === 'blockflaeche') {
        if (stand.punkte.length < 3) return;
        const begruendung = window.prompt('Begruendung der Sperrung:', 'Nur Einsatzkraefte') ?? '';
        void zs.blockflaecheAnlegen({ typ: 'nur_einsatzkraefte', polygon: stand.punkte, begruendung, name: 'Blockflaeche' });
      } else if (stand.art === 'messen_distanz') {
        const l = polylinieLaenge(stand.punkte);
        const h = hoehenRef.current;
        const l3d = stand.punkte.slice(1).reduce((a, p, i) => {
          const q = stand.punkte[i];
          const dh = h.bei(p[0], p[1]) - h.bei(q[0], q[1]);
          return a + Math.hypot(abstand(p, q), dh);
        }, 0);
        zs.messungHinzu({
          id: `m_${Date.now()}`,
          art: 'distanz',
          punkte: stand.punkte,
          wert: l,
          text: `${l.toFixed(2)} m (raeumlich ${l3d.toFixed(2)} m)`,
          dauerhaft: true,
        });
      } else if (stand.art === 'messen_flaeche' && stand.punkte.length >= 3) {
        const a = flaeche(stand.punkte);
        zs.messungHinzu({ id: `m_${Date.now()}`, art: 'flaeche', punkte: stand.punkte, wert: a, text: `${a.toFixed(1)} m2`, dauerhaft: true });
      }
      zs.setzeWerkzeug('auswahl');
    }

    // -- Tastatur ---------------------------------------------------------
    function taste(ev: KeyboardEvent) {
      const zs = z();
      if ((ev.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (ev.key === 'Escape') {
        zeichenRef.current = null;
        setZeichnet(null);
        ersetze(viewer, gruppen.current, 'vorschau', []);
        zs.setzeWerkzeug('auswahl');
        zs.setzeAuswahl([]);
      } else if (ev.key === 'Enter') {
        abschliessen();
      } else if (ev.key === 'Delete' || ev.key === 'Entf') {
        const a = zs.auswahl[0];
        if (!a || !zs.darf.elementLoeschen) return;
        if (!window.confirm('Ausgewaehltes Element loeschen?')) return;
        if (a.art === 'objekt') void zs.objektLoeschen(a.id);
        if (a.art === 'weg') void zs.wegLoeschen(a.id);
        if (a.art === 'blockflaeche') void zs.blockflaecheLoeschen(a.id);
        if (a.art === 'einsatzstation') void zs.stationLoeschen(a.id);
      } else if (ev.key === '[' || ev.key === ']') {
        const a = zs.auswahl[0];
        if (a?.art !== 'objekt') return;
        const o = zs.inhalt?.objekte.find((x) => x.id === a.id);
        if (!o) return;
        const schritt = ev.shiftKey ? 45 : 5;
        void zs.objektAendern(o.id, { rotation: (o.rotation + (ev.key === ']' ? schritt : -schritt) + 360) % 360 });
      }
    }
    window.addEventListener('keydown', taste);

    // -- Kamera an die 2D-Karte melden -----------------------------------
    function meldeKamera() {
      const carto = viewer.camera.positionCartographic;
      window.dispatchEvent(
        new CustomEvent('ep3d:kamera', {
          detail: {
            lon: Cesium.Math.toDegrees(carto.longitude),
            lat: Cesium.Math.toDegrees(carto.latitude),
            hoeheM: Math.max(20, carto.height - hoehenRef.current.mittel),
            richtungGrad: Cesium.Math.toDegrees(viewer.camera.heading),
          },
        }),
      );
    }
    viewer.camera.changed.addEventListener(meldeKamera);
    viewer.camera.percentageChanged = 0.15;

    // -- Sprung zu einem Ort ---------------------------------------------
    function springe(ev: Event) {
      const detail = (ev as CustomEvent<{ ort?: Punkt }>).detail;
      if (!detail?.ort) return;
      const [lon, lat] = nachWgs(detail.ort);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.0009, hoehenRef.current.bei(detail.ort[0], detail.ort[1]) + 130),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
        duration: 1.1,
      });
    }
    window.addEventListener('ep3d:springe', springe);

    return () => {
      handler.destroy();
      window.removeEventListener('keydown', taste);
      window.removeEventListener('pointerup', beendeDrag);
      window.removeEventListener('ep3d:springe', springe);
      viewer.camera.changed.removeEventListener(meldeKamera);
    };
  }, []);

  // ------------------------------------------------------- Messungen malen
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const inst: Cesium.GeometryInstance[] = [];
    for (const m of messungen) {
      const punkte = m.art === 'flaeche' ? [...m.punkte, m.punkte[0]] : m.punkte;
      inst.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: punkte.map((p) => {
              const [lon, lat] = nachWgs(p);
              return Cesium.Cartesian3.fromDegrees(lon, lat, hoehenRef.current.bei(p[0], p[1]) + 0.4);
            }),
            width: 3,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(FARBEN.bemassung) },
        }),
      );
    }
    ersetze(
      viewer,
      gruppen.current,
      'messungen',
      inst.length ? [new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PolylineColorAppearance({ translucent: true }), asynchronous: false })] : [],
    );
    // `gelaende` mitfuehren — dieselbe Begruendung wie beim Inhalte-Effekt:
    // die Messlinien haengen ueber hoehenRef an der Hoehenlage.
  }, [gelaende, messungen]);

  // --------------------------------------------------------- Hinweistexte
  useEffect(() => {
    const texte: Record<string, string> = {
      platzieren: 'Klicken Sie auf das Gelaende, um das Bauteil zu setzen. Esc bricht ab.',
      weg: 'Wegverlauf klicken, Doppelklick oder Enter beendet die Linie.',
      blockflaeche: 'Umriss klicken, Doppelklick oder Enter schliesst die Flaeche.',
      station: 'Klicken Sie die Position der Einsatzstation.',
      messen_distanz: 'Punkte klicken — die Strecke wird auch raeumlich (mit Hoehenunterschied) gemessen.',
      messen_flaeche: 'Umriss klicken, Doppelklick beendet die Flaechenmessung.',
      kommentar: 'Klicken Sie die Stelle, an der der Kommentar haengen soll.',
      auswahl: '',
    };
    setHinweis(texte[werkzeug] ?? '');
  }, [werkzeug, platzierTypId]);

  // Werkzeugwechsel raeumt Zeichenstand und Geist auf
  useEffect(() => {
    if (werkzeug === 'auswahl' || werkzeug === 'platzieren') {
      zeichenRef.current = null;
      setZeichnet(null);
      const v = viewerRef.current;
      if (v) ersetze(v, gruppen.current, 'vorschau', []);
    }
    if (werkzeug !== 'platzieren' && geistRef.current && viewerRef.current) {
      viewerRef.current.scene.primitives.remove(geistRef.current);
      geistRef.current = null;
    }
  }, [werkzeug]);

  const fremde = praesenz.filter((p) => p.cursor);

  return (
    <div className="szene3d">
      <div ref={behaelter} className="szene3d-canvas" />
      {hinweis && <div className="buehne-hud buehne-hud--hinweis">{hinweis}</div>}
      {zeichnet && zeichnet.punkte.length > 0 && (
        <div className="buehne-hud buehne-hud--messung">
          {zeichnet.art === 'messen_flaeche' && zeichnet.punkte.length >= 3
            ? `Flaeche ${flaeche(zeichnet.punkte).toFixed(1)} m2`
            : `Laenge ${polylinieLaenge(zeichnet.punkte).toFixed(2)} m · ${zeichnet.punkte.length} Punkte`}
        </div>
      )}
      <Ampel />
      <Kamerawerkzeuge viewer={viewerRef} hoehen={hoehenRef} />
      {fremde.map((p) => (
        <FremderCursor key={p.nutzerId} praesenz={p} viewer={viewerRef} hoehen={hoehenRef} />
      ))}
      {!gelaende && <div className="leer szene3d-leer">Kein Gelaende geladen.</div>}
      {!darf.elementAendern && gelaende && <div className="buehne-hud buehne-hud--lesend">Lesender Zugriff</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hilfsteile
// ---------------------------------------------------------------------------

/**
 * Welche Gruppen werfen und empfangen Schatten?
 * Aufragende Koerper (Gebaeude, Baeume, Aufbauten, Barrieren) werfen Schatten;
 * der Boden EMPFAENGT sie nur. Flache Auflagen (Wege, Bodenzeichnung) werfen
 * keinen — ein 3 cm hoher Gehweg wuerde sonst flimmernde Schattenraender
 * erzeugen.
 */
const WIRFT_SCHATTEN = new Set(['gebaeude', 'vegetation', 'objekte', 'barrieren', 'haltestellen', 'stationen', 'verkehrszeichen']);
// 'gleise' bewusst NICHT dabei: die Gleise sind als unbeleuchtete Koerper
// konzipiert (verkehr.ts) — der Schattenempfang patcht den Shader trotzdem
// und brachte Schattenflecken auf das eigentlich ungeschattete Band.
const EMPFAENGT_SCHATTEN = new Set(['gelaende', 'nutzung']);

function ersetze(viewer: Cesium.Viewer, speicher: Record<string, Cesium.Primitive[]>, name: string, neue: Cesium.Primitive[]) {
  for (const p of speicher[name] ?? []) {
    if (!p.isDestroyed()) viewer.scene.primitives.remove(p);
  }
  speicher[name] = [];
  const modus = WIRFT_SCHATTEN.has(name)
    ? Cesium.ShadowMode.ENABLED
    : EMPFAENGT_SCHATTEN.has(name)
      ? Cesium.ShadowMode.RECEIVE_ONLY
      : Cesium.ShadowMode.DISABLED;
  for (const p of neue) {
    try {
      p.shadows = modus;
    } catch {
      /* manche Primitive-Arten kennen kein shadows-Feld */
    }
    viewer.scene.primitives.add(p);
    speicher[name].push(p);
  }
}

/**
 * Rad-Zoom auf den Punkt unter dem Mauszeiger.
 *
 * Warum eigenhaendig statt Cesiums Zoom: siehe die ausfuehrliche Begruendung
 * beim Aufruf (abgeschalteter Globus -> Bezugsflaeche ist das Erdellipsoid
 * 143 m unter dem Boden -> der Zoom stirbt ab, bevor man unten ankommt).
 *
 * Rechenweg: Zielpunkt = echte Geometrie unter dem Zeiger (`pickPosition`),
 * ersatzweise der Schnitt des Sehstrahls mit der mittleren Gelaendehoehe.
 * Die Kamera legt je Rastung einen festen ANTEIL der Reststrecke zurueck —
 * damit ist der Schritt in jeder Hoehe gleich stark spuerbar, nah wie fern.
 * Rein und wieder raus fuehrt exakt zurueck (0,8 x 1,25 = 1).
 */
function radZoomAnmelden(viewer: Cesium.Viewer, hoehen: () => Hoehenlage): () => void {
  const szene = viewer.scene;
  const leinwand = viewer.canvas;
  /** Anteil der Reststrecke je Rastung. */
  const HINEIN = 0.2;
  const HERAUS = 0.25;
  /** Naeher als das darf die Kamera an den Zielpunkt nicht heran. */
  const MIN_ABSTAND_M = 3;
  /** Weiter als das nicht hinaus — sonst verliert man die Stadt aus dem Blick. */
  const MAX_HOEHE_M = 20000;

  function zielPunkt(x: number, y: number): Cesium.Cartesian3 | null {
    const bild = new Cesium.Cartesian2(x, y);
    if (szene.pickPositionSupported) {
      const treffer = szene.pickPosition(bild);
      if (treffer && Number.isFinite(treffer.x)) return treffer;
    }
    // Nichts getroffen (Himmel am Bildrand): Strahl gegen die waagerechte
    // Ebene auf mittlerer Gelaendehoehe schneiden.
    const strahl = viewer.camera.getPickRay(bild);
    if (!strahl) return null;
    const mitte = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    const aufBoden = Cesium.Cartesian3.fromRadians(mitte.longitude, mitte.latitude, hoehen().mittel);
    const normale = Cesium.Cartesian3.normalize(aufBoden, new Cesium.Cartesian3());
    const ebene = Cesium.Plane.fromPointNormal(aufBoden, normale);
    return Cesium.IntersectionTests.rayPlane(strahl, ebene) ?? null;
  }

  function beiRad(ereignis: WheelEvent) {
    ereignis.preventDefault();
    const kasten = leinwand.getBoundingClientRect();
    const ziel = zielPunkt(ereignis.clientX - kasten.left, ereignis.clientY - kasten.top);
    if (!ziel) return;

    const kamera = viewer.camera;
    const abstand = Cesium.Cartesian3.distance(kamera.position, ziel);
    if (!Number.isFinite(abstand) || abstand < 1e-3) return;

    const hinein = ereignis.deltaY < 0;
    let strecke = abstand * (hinein ? HINEIN : -HERAUS);
    // Nie durch den Zielpunkt hindurchfahren.
    if (hinein) strecke = Math.min(strecke, abstand - MIN_ABSTAND_M);
    if (strecke === 0) return;

    const vorher = Cesium.Cartesian3.clone(kamera.position, new Cesium.Cartesian3());
    const richtung = Cesium.Cartesian3.subtract(ziel, kamera.position, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(richtung, richtung);
    kamera.move(richtung, strecke);

    const danach = Cesium.Cartographic.fromCartesian(kamera.position);

    // UNTERGRENZE: nie unter das Gelaende. Ohne sie faehrt der Zoom in die
    // Geometrie hinein — beim Zielen auf eine Baumkrone landete die Kamera
    // IM Laub und unter Grund (nachgestellt 08.08.2026). Die Augenhoehe
    // 1,70 m bleibt ueber den Kameraknopf erreichbar, per Rad ist bei 2 m
    // ueber Boden Schluss.
    const auf = weltNachUtm(kamera.position);
    const bodenHier = auf ? hoehen().bei(auf[0], auf[1]) : hoehen().mittel;
    if (danach.height < bodenHier + 2) {
      kamera.position = Cesium.Cartesian3.fromRadians(danach.longitude, danach.latitude, bodenHier + 2);
      // Bringt die Korrektur nichts (Kamera stand schon am Boden), lieber
      // gar nicht bewegen als seitlich wegdriften.
      if (Cesium.Cartesian3.distance(kamera.position, vorher) < 0.05) {
        kamera.position = vorher;
      }
      return;
    }

    // Beim Herauszoomen eine Obergrenze halten.
    if (danach.height > MAX_HOEHE_M) {
      kamera.position = Cesium.Cartesian3.fromRadians(danach.longitude, danach.latitude, MAX_HOEHE_M);
    }
  }

  leinwand.addEventListener('wheel', beiRad, { passive: false });
  return () => leinwand.removeEventListener('wheel', beiRad);
}

/** Dreh-Griff am ausgewaehlten Objekt. */
function baueGriffe(
  inhalt: NonNullable<ReturnType<typeof nutzeZustand.getState>['inhalt']>,
  typen: Map<string, ObjektTyp>,
  hoehen: Hoehenlage,
  gewaehlt: Set<string>,
): Cesium.Primitive[] {
  const inst: Cesium.GeometryInstance[] = [];
  for (const o of inhalt.objekte) {
    if (!gewaehlt.has(o.id)) continue;
    const typ = typen.get(o.typId);
    if (!typ) continue;
    const m = masseVon(typ, o);
    const r = Math.max(m.laenge, m.breite) / 2 + 2.5;
    const rad = (o.rotation * Math.PI) / 180;
    // Griff-Peilung == Objekt-Rotation. Der Drag-Handler setzt die Rotation
    // auf die ABSOLUTE Mauspeilung zum Objekt — stand der Griff (wie frueher)
    // um +90 Grad versetzt, sprang das Objekt beim ersten Anfassen sofort um
    // 90 Grad (Befund der systematischen Pruefung 08.08.2026).
    const griff: Punkt = [o.position[0] + Math.sin(rad) * r, o.position[1] + Math.cos(rad) * r];
    const basis = hoehen.bei(griff[0], griff[1]);
    const [lon, lat] = nachWgs(griff);
    inst.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.EllipsoidGeometry({
          radii: new Cesium.Cartesian3(0.9, 0.9, 0.9),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat, basis + m.hoehe + 1)),
        id: `griff:drehen:${o.id}`,
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE) },
      }),
    );
  }
  if (!inst.length) return [];
  return [
    new Cesium.Primitive({
      geometryInstances: inst,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: false,
    }),
  ];
}

function zeichneVorschau(viewer: Cesium.Viewer, speicher: Record<string, Cesium.Primitive[]>, stand: Zeichenstand, hoehen: Hoehenlage) {
  if (stand.punkte.length < 2) {
    ersetze(viewer, speicher, 'vorschau', []);
    return;
  }
  const punkte = stand.art === 'blockflaeche' || stand.art === 'messen_flaeche' ? [...stand.punkte, stand.punkte[0]] : stand.punkte;
  const linie = new Cesium.GeometryInstance({
    geometry: new Cesium.PolylineGeometry({
      positions: punkte.map((p) => {
        const [lon, lat] = nachWgs(p);
        return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + 0.3);
      }),
      width: 3,
      vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(FARBEN.auswahl) },
  });
  ersetze(viewer, speicher, 'vorschau', [
    new Cesium.Primitive({ geometryInstances: [linie], appearance: new Cesium.PolylineColorAppearance({ translucent: true }), asynchronous: false }),
  ]);
}

function zeigeGeist(
  viewer: Cesium.Viewer,
  ref: { current: Cesium.Primitive | null },
  typ: ObjektTyp,
  position: Punkt,
  hoehen: Hoehenlage,
  zs: ReturnType<typeof nutzeZustand.getState>,
) {
  if (ref.current) viewer.scene.primitives.remove(ref.current);
  // Gueltig heisst hier: nicht in einer gesperrten Blockflaeche.
  // ENTHALTENSEIN zaehlt, nicht nur Kantennaehe — der alte Test pruefte nur
  // den Abstand zur Kante, mitten in einer grossen Sperrflaeche war der Geist
  // faelschlich gruen.
  let gueltig = true;
  const ring = grundriss(typ, { id: 'g', projektId: '', typId: typ.id, position, rotation: 0, status: 'geplant', auflagen: [], erstelltVon: '', erstelltAm: '' });
  const mitte = schwerpunkt(ring);
  for (const b of zs.inhalt?.blockflaechen ?? []) {
    if (b.typ === 'nicht_bebaubar' || b.typ === 'gesperrt') {
      if (punktInRing(mitte, b.polygon)) gueltig = false;
      for (let i = 0, j = b.polygon.length - 1; i < b.polygon.length; j = i++) {
        if (abstandPunktStrecke(mitte, b.polygon[j], b.polygon[i]) < 0.5) gueltig = false;
      }
    }
  }
  const p = baueGeist(typ, position, 0, hoehen, gueltig);
  ref.current = p;
  if (p) viewer.scene.primitives.add(p);
}

/** Zulaessigkeits-Ampel oben rechts auf der Buehne. */
function Ampel() {
  const bericht = nutzeZustand((s) => s.bericht);
  const laeuft = nutzeZustand((s) => s.pruefungLaeuft);
  if (!bericht) return null;
  const z = bericht.zusammenfassung;
  const stufe = z.fehler > 0 ? 'fehler' : z.warnungen > 0 ? 'warn' : 'ok';
  const text = z.fehler > 0 ? `${z.fehler} Fehler` : z.warnungen > 0 ? `${z.warnungen} Warnungen` : 'Keine Beanstandung';
  return (
    <div className={`ampel ampel--${stufe}`} title="Ergebnis der Regelpruefung">
      <span className="ampel-punkt" />
      <span>{laeuft ? 'Pruefung laeuft …' : text}</span>
      {z.nichtPruefbar > 0 && <span className="ampel-zusatz">{z.nichtPruefbar} nicht pruefbar</span>}
    </div>
  );
}

/** Kompass, Draufsicht, Fussgaengerperspektive. */
function Kamerawerkzeuge({ viewer, hoehen }: { viewer: React.RefObject<Cesium.Viewer | null>; hoehen: React.RefObject<Hoehenlage> }) {
  const gelaende = nutzeZustand((s) => s.gelaende);

  function draufsicht() {
    const v = viewer.current;
    if (!v || !gelaende) return;
    const mitte: Punkt = [(gelaende.bbox.minE + gelaende.bbox.maxE) / 2, (gelaende.bbox.minN + gelaende.bbox.maxN) / 2];
    const spann = Math.max(gelaende.bbox.maxE - gelaende.bbox.minE, gelaende.bbox.maxN - gelaende.bbox.minN);
    const [lon, lat] = nachWgs(mitte);
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, gelaende.hoeheMittel + spann * 1.15),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 0.9,
    });
  }

  function norden() {
    const v = viewer.current;
    if (!v) return;
    v.camera.flyTo({
      destination: v.camera.position,
      orientation: { heading: 0, pitch: v.camera.pitch, roll: 0 },
      duration: 0.6,
    });
  }

  /** Fussgaengerperspektive: Augenhoehe 1,70 m (Lastenheft F2.1). */
  function fussgaenger() {
    const v = viewer.current;
    if (!v) return;
    const carto = v.camera.positionCartographic;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const utm = weltNachUtm(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
    const grund = utm ? hoehen.current!.bei(utm[0], utm[1]) : hoehen.current!.mittel;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, grund + 1.7),
      orientation: { heading: v.camera.heading, pitch: 0, roll: 0 },
      duration: 1.0,
    });
  }

  return (
    <div className="kamerawerkzeuge">
      <button type="button" className="knopf knopf--leise" onClick={norden} title="Nach Norden ausrichten">
        N
      </button>
      <button type="button" className="knopf knopf--leise" onClick={draufsicht} title="Draufsicht (Lageplan)">
        ⬒
      </button>
      <button type="button" className="knopf knopf--leise" onClick={fussgaenger} title="Fussgaengerperspektive (Augenhoehe 1,70 m)">
        ⇩1,70
      </button>
    </div>
  );
}

/** Live-Cursor der Mitplaner. */
function FremderCursor({
  praesenz,
  viewer,
  hoehen,
}: {
  praesenz: { nutzerId: string; nutzerName: string; orgName: string; farbe: string; cursor?: Punkt };
  viewer: React.RefObject<Cesium.Viewer | null>;
  hoehen: React.RefObject<Hoehenlage>;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !praesenz.cursor) return;
    const welt = hoehen.current!.welt(praesenz.cursor, 0.5);
    const bildschirm = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, welt);
    setPos(bildschirm ? { x: bildschirm.x, y: bildschirm.y } : null);
  }, [praesenz.cursor, viewer, hoehen]);
  if (!pos) return null;
  return (
    <div className="fremdcursor" style={{ left: pos.x, top: pos.y, ['--nutzerfarbe' as string]: praesenz.farbe }}>
      <span className="fremdcursor-pfeil" />
      <span className="fremdcursor-name">{praesenz.nutzerName}</span>
    </div>
  );
}
