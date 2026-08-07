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
import { abstand, abstandPunktStrecke, flaeche, naechsterPunktAufStrecke, polylinieLaenge, schwerpunkt } from '@shared/geo/geometry';
import { nachWgs } from '@shared/geo/proj';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import { Hoehenlage, baueGelaende, weltNachUtm } from './gelaende.ts';
import { baueStadt, baueBodenzeichnung, baueGebaeudeKanten, baueGeschossbaender, HIMMEL } from './stadt.ts';
import { baueBaeume, baueHecken } from './vegetation.ts';
import { baueGleise, baueHaltestellen, baueBarrieren, baueStrassenmoebel } from './verkehr.ts';
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
  const gruppen = useRef<Record<string, Cesium.Primitive[]>>({});
  const labelsRef = useRef<Cesium.LabelCollection | null>(null);
  const haltLabelsRef = useRef<Cesium.LabelCollection | null>(null);
  const geistRef = useRef<Cesium.Primitive | null>(null);
  const zeichenRef = useRef<Zeichenstand | null>(null);
  const dragRef = useRef<{ art: 'verschieben' | 'drehen'; objektId: string; start: Punkt; startRot: number; versatz: Punkt } | null>(null);
  const [hinweis, setHinweis] = useState<string>('');
  const [zeichnet, setZeichnet] = useState<Zeichenstand | null>(null);

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
      sm.maximumDistance = 4000;
      sm.normalOffset = true;
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
    szene.screenSpaceCameraController.zoomEventTypes = [
      Cesium.CameraEventType.WHEEL,
      Cesium.CameraEventType.PINCH,
    ];
    szene.screenSpaceCameraController.tiltEventTypes = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.PINCH,
    ];

    labelsRef.current = szene.primitives.add(new Cesium.LabelCollection());
    haltLabelsRef.current = szene.primitives.add(new Cesium.LabelCollection());

    return () => {
      // React fuehrt Effekte im Entwicklungsbetrieb (StrictMode) doppelt aus:
      // aufbauen, abraeumen, wieder aufbauen. Ein sofortiges destroy() wuerde
      // den Viewer zerstoeren, den der zweite Durchlauf dann weiterverwendet.
      // Darum wird das Abraeumen verzoegert und beim Wiederaufbau abbestellt.
      abbauTimer.current = window.setTimeout(() => {
        abbauTimer.current = null;
        if (!viewer.isDestroyed()) viewer.destroy();
        if (viewerRef.current === viewer) viewerRef.current = null;
      }, 0);
    };
  }, []);

  // Bei Ansichtswechsel muss Cesium die Canvasgroesse neu bestimmen
  useEffect(() => {
    if (sichtbar) setTimeout(() => viewerRef.current?.resize(), 60);
  }, [sichtbar]);

  // ------------------------------------------------------------- Gelaende
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !gelaende) return;
    hoehenRef.current = new Hoehenlage(gelaende);
    const h = hoehenRef.current;

    // Modellsonne: fest aus Suedosten, 48 Grad ueber dem Horizont — im
    // oertlichen Ost-Nord-Oben-System des Gebiets aufgestellt und erst dann in
    // Erdkoordinaten gedreht.
    {
      const mitteU: Punkt = [(gelaende.bbox.minE + gelaende.bbox.maxE) / 2, (gelaende.bbox.minN + gelaende.bbox.maxN) / 2];
      const [mlon, mlat] = nachWgs(mitteU);
      const rahmen = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(mlon, mlat, gelaende.hoeheMittel),
      );
      const azimut = Cesium.Math.toRadians(150); // Sued-Suedost, schraeg zur Hauptstrassenrichtung
      const hoehe = Cesium.Math.toRadians(45); // Architekturmodell-Konvention
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
          ao.uniforms.intensity = 2.2;
          ao.uniforms.bias = 0.1;
          ao.uniforms.lengthCap = 0.5;
          ao.uniforms.stepSize = 1.0;
          ao.uniforms.blurStepSize = 0.9;
        }
      } catch {
        /* ohne Umgebungsverdeckung sieht es flacher aus, laeuft aber */
      }
    }

    // Grundplatte: mit Luftbild texturiert, ohne Luftbild als ruhige Flaeche,
    // auf der die Nutzungsflaechen ihre Kontraste entfalten koennen.
    ersetze(viewer, gruppen.current, 'gelaende', ebenen.gelaende ? baueGelaende(gelaende, ebenen.luftbild) : []);

    // Bodenzeichnung nach tatsaechlicher Nutzung — das massgetreue Abbild.
    ersetze(
      viewer,
      gruppen.current,
      'nutzung',
      ebenen.nutzung && !ebenen.luftbild && gelaende.flaechen?.length
        ? baueBodenzeichnung(gelaende.flaechen, h)
        : [],
    );

    // Gebaeude aus den ECHTEN LoD2-Dach- und Wandflaechen
    if (ebenen.gebaeude) {
      const stadt = baueStadt(gelaende);
      const kanten = baueGebaeudeKanten(gelaende);
      const baender = baueGeschossbaender(gelaende);
      const gebPrims = [...stadt.prims];
      if (kanten) gebPrims.push(kanten);
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
    const barrieren = linien.filter((l) => l.art !== 'hecke' && l.art !== 'gleis');

    ersetze(viewer, gruppen.current, 'gleise', ebenen.nutzung ? baueGleise(gleise, h) : []);
    ersetze(viewer, gruppen.current, 'barrieren', ebenen.nutzung ? baueBarrieren(barrieren, h) : []);
    ersetze(viewer, gruppen.current, 'vegetation', ebenen.gebaeude ? [...baueBaeume(punkte, h), ...baueHecken(hecken, h)] : []);
    ersetze(viewer, gruppen.current, 'moebel', ebenen.nutzung ? baueStrassenmoebel(punkte, h) : []);

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

    // Kamera auf das Gebiet
    const mitte = [(gelaende.bbox.minE + gelaende.bbox.maxE) / 2, (gelaende.bbox.minN + gelaende.bbox.maxN) / 2] as Punkt;
    const spann = Math.max(gelaende.bbox.maxE - gelaende.bbox.minE, gelaende.bbox.maxN - gelaende.bbox.minN);
    const [lon, lat] = nachWgs(mitte);
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - spann / 220000, gelaende.hoeheMittel + spann * 0.75),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-42), roll: 0 },
    });
  }, [gelaende, ebenen.gelaende, ebenen.luftbild, ebenen.gebaeude, ebenen.nutzung]);

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
  }, [inhalt, typen, auswahl, ebenen, editorStatus, bericht]);

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
  }, [messungen]);

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
const WIRFT_SCHATTEN = new Set(['gebaeude', 'vegetation', 'objekte', 'barrieren', 'haltestellen', 'stationen']);
const EMPFAENGT_SCHATTEN = new Set(['gelaende', 'nutzung', 'gleise']);

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
    const griff: Punkt = [o.position[0] + Math.sin(rad + Math.PI / 2) * r, o.position[1] + Math.cos(rad + Math.PI / 2) * r];
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
  // Gueltig heisst hier: nicht in einer gesperrten Blockflaeche
  let gueltig = true;
  const ring = grundriss(typ, { id: 'g', projektId: '', typId: typ.id, position, rotation: 0, status: 'geplant', auflagen: [], erstelltVon: '', erstelltAm: '' });
  const mitte = schwerpunkt(ring);
  for (const b of zs.inhalt?.blockflaechen ?? []) {
    if (b.typ === 'nicht_bebaubar' || b.typ === 'gesperrt') {
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
