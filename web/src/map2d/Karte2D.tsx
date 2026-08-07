/**
 * Karte2D — die zweite, mit der 3D-Szene synchronisierte Ansicht auf dasselbe
 * Modell (Lastenheft F2.8), gebaut mit maplibre-gl.
 *
 * Grundsaetze:
 * - Es gibt KEINE externe Kachelquelle. Der Hintergrund kommt ausschliesslich
 *   vom eigenen Server (amtliche Karte + Luftbildtexturen des Gelaendes) und
 *   wird als "image"-Quelle mit vier Eckpunkten in WGS84 eingehaengt.
 * - Ohne Glyphs sind keine symbol-Layer mit text-field moeglich; Beschriftungen
 *   laufen darum ueber maplibregl.Marker mit eigenem DOM.
 * - Alle Geometrien liegen in EPSG:25832 vor und werden ausschliesslich fuer
 *   die Anzeige mit nachWgs() umgerechnet.
 * - Synchronisation in beide Richtungen ueber window-Ereignisse; ein Flag
 *   verhindert die Rueckkopplungsschleife.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MlKarte, StyleSpecification } from 'maplibre-gl';
import type { Feature as GjFeature, FeatureCollection as GjSammlung, Geometry as GjGeometrie, Position as GjPos } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { BBox, BlockflaechenTyp, ElementArt, Punkt, Ring } from '@shared/domain/types';
import { STATION_FARBE, WEGE_TYP_FARBE } from '@shared/domain/types';
import { bboxNachWgs, nachUtm, nachWgs } from '@shared/geo/proj';
import { schwerpunkt, wegKorridor } from '@shared/geo/geometry';
import { bezeichnung, grundriss } from '@shared/domain/objekte';
import { nutzeZustand } from '../lib/zustand.ts';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/** Leerer Stil — keine externe Ressource, kein glyphs-Endpunkt. */
const LEERER_STIL: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'hintergrund', type: 'background', paint: { 'background-color': '#0e1216' } }],
  glyphs: undefined,
};

/** Kameraruhelage, solange kein Gelaende geladen ist (nur Startpunkt, kein Datum). */
const START_MITTE: [number, number] = [8.6512, 49.8728];

const LEERE_SAMMLUNG: GjSammlung<GjGeometrie, Eigenschaften> = { type: 'FeatureCollection', features: [] };

const QUELLEN = ['flurstuecke', 'gebaeude', 'blockflaechen', 'wege', 'wegachsen', 'objekte', 'stationen', 'verstoesse'] as const;

const BLOCK_FARBE: Record<BlockflaechenTyp, string> = {
  gesperrt: '#e8503a',
  nicht_bebaubar: '#e87d3a',
  nur_einsatzkraefte: '#2f6fd0',
};

/** Klickbare Ebenen in Trefferreihenfolge (kleinste Ziele zuerst). */
const KLICKBAR: { ebene: string; art: ElementArt }[] = [
  { ebene: 'stationen', art: 'einsatzstation' },
  { ebene: 'objekte-flaeche', art: 'objekt' },
  { ebene: 'wege-flaeche', art: 'weg' },
  { ebene: 'block-flaeche', art: 'blockflaeche' },
];

/** Welche Zustands-Ebene schaltet welche Kartenebenen. */
const EBENEN_ZUORDNUNG: { schalter: 'gebaeude' | 'objekte' | 'wege' | 'blockflaechen' | 'einsatzstationen' | 'flurstuecke'; ebenen: string[] }[] = [
  { schalter: 'flurstuecke', ebenen: ['flurstuecke'] },
  { schalter: 'gebaeude', ebenen: ['gebaeude', 'gebaeude-rand'] },
  { schalter: 'blockflaechen', ebenen: ['block-flaeche', 'block-rand'] },
  { schalter: 'wege', ebenen: ['wege-flaeche', 'wege-rand', 'wege-achse'] },
  { schalter: 'objekte', ebenen: ['objekte-flaeche', 'objekte-rand', 'objekte-auswahl'] },
  { schalter: 'einsatzstationen', ebenen: ['stationen'] },
];

const AUSGEWAEHLT: FilterSpecification = ['==', ['get', 'ausgewaehlt'], true];

const KARTEN_EBENEN: LayerSpecification[] = [
  { id: 'flurstuecke', type: 'line', source: 'flurstuecke', paint: { 'line-color': '#3d4a58', 'line-width': 0.8, 'line-opacity': 0.75 } },
  { id: 'gebaeude', type: 'fill', source: 'gebaeude', paint: { 'fill-color': '#39434d', 'fill-opacity': 0.72 } },
  { id: 'gebaeude-rand', type: 'line', source: 'gebaeude', paint: { 'line-color': '#4e5a67', 'line-width': 0.7 } },
  { id: 'block-flaeche', type: 'fill', source: 'blockflaechen', paint: { 'fill-color': ['get', 'farbe'], 'fill-opacity': 0.25 } },
  {
    id: 'block-rand',
    type: 'line',
    source: 'blockflaechen',
    paint: {
      'line-color': ['get', 'farbe'],
      'line-width': ['case', ['==', ['get', 'ausgewaehlt'], true], 3, 1.4],
      'line-dasharray': [2, 2],
    },
  },
  { id: 'wege-flaeche', type: 'fill', source: 'wege', paint: { 'fill-color': ['get', 'farbe'], 'fill-opacity': 0.28 } },
  {
    id: 'wege-rand',
    type: 'line',
    source: 'wege',
    paint: { 'line-color': ['get', 'farbe'], 'line-width': ['case', ['==', ['get', 'ausgewaehlt'], true], 3, 1.2] },
  },
  {
    id: 'wege-achse',
    type: 'line',
    source: 'wegachsen',
    paint: { 'line-color': ['get', 'farbe'], 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [1.6, 1.6] },
  },
  { id: 'objekte-flaeche', type: 'fill', source: 'objekte', paint: { 'fill-color': ['get', 'farbe'], 'fill-opacity': 0.85 } },
  { id: 'objekte-rand', type: 'line', source: 'objekte', paint: { 'line-color': ['get', 'randFarbe'], 'line-width': 1 } },
  { id: 'objekte-auswahl', type: 'line', source: 'objekte', filter: AUSGEWAEHLT, paint: { 'line-color': '#4a9eda', 'line-width': 3 } },
  {
    id: 'stationen',
    type: 'circle',
    source: 'stationen',
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'farbe'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['==', ['get', 'ausgewaehlt'], true], 3.5, 2],
    },
  },
  { id: 'verstoss-puls', type: 'circle', source: 'verstoesse', paint: { 'circle-radius': 10, 'circle-color': '#e8503a', 'circle-opacity': 0.3 } },
  {
    id: 'verstoss',
    type: 'circle',
    source: 'verstoesse',
    paint: { 'circle-radius': 5, 'circle-color': '#e8503a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
  },
];

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

type Eigenschaften = Record<string, string | number | boolean>;
type Ecken = [[number, number], [number, number], [number, number], [number, number]];

interface KameraDetail {
  lon: number;
  lat: number;
  hoeheM: number;
  richtungGrad: number;
}

/** Vier Eckpunkte einer Bbox in WGS84: oben-links, oben-rechts, unten-rechts, unten-links. */
function bboxEcken(b: BBox): Ecken {
  return [nachWgs([b.minE, b.maxN]), nachWgs([b.maxE, b.maxN]), nachWgs([b.maxE, b.minN]), nachWgs([b.minE, b.minN])];
}

/** Geschlossener GeoJSON-Ring (erster Punkt wird wiederholt). */
function ringNachGeoJson(ring: Ring): GjPos[] {
  const out: GjPos[] = ring.map((p) => nachWgs(p) as GjPos);
  if (out.length > 0) out.push(out[0]);
  return out;
}

function flaeche(ring: Ring, eig: Eigenschaften): GjFeature<GjGeometrie, Eigenschaften> {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ringNachGeoJson(ring)] }, properties: eig };
}

function mehrflaeche(ringe: Ring[], eig: Eigenschaften): GjFeature<GjGeometrie, Eigenschaften> {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: ringe.map((r) => [ringNachGeoJson(r)]) },
    properties: eig,
  };
}

function linie(punkte: Punkt[], eig: Eigenschaften): GjFeature<GjGeometrie, Eigenschaften> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: punkte.map((p) => nachWgs(p) as GjPos) }, properties: eig };
}

function punktFeature(p: Punkt, eig: Eigenschaften): GjFeature<GjGeometrie, Eigenschaften> {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: nachWgs(p) as GjPos }, properties: eig };
}

function sammlung(features: GjFeature<GjGeometrie, Eigenschaften>[]): GjSammlung<GjGeometrie, Eigenschaften> {
  return { type: 'FeatureCollection', features };
}

/** Hellere Variante einer Hex-Farbe fuer Umrisse. */
function aufhellen(hex: string, anteil = 0.35): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const z = parseInt(m[1], 16);
  const misch = (k: number) => Math.round(k + (255 - k) * anteil);
  const r = misch((z >> 16) & 255);
  const g = misch((z >> 8) & 255);
  const b = misch(z & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Zoomstufe aus der Kamerahoehe der 3D-Szene (Lastenheft-Formel). */
function zoomAusHoehe(lat: number, hoeheM: number): number {
  const z = Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (hoeheM * 1.4)) - 8;
  if (!Number.isFinite(z)) return 16;
  return Math.min(21, Math.max(10, Math.round(z)));
}

/**
 * Fuehrt eine Kamerabewegung aus, ohne dass sie als Nutzerbewegung an die
 * 3D-Szene zurueckgemeldet wird. Der Wachhund loest das Flag notfalls selbst.
 */
function ohneEcho(
  k: MlKarte,
  flagge: MutableRefObject<boolean>,
  wachhund: MutableRefObject<number | null>,
  aktion: () => void,
): void {
  flagge.current = true;
  if (wachhund.current !== null) window.clearTimeout(wachhund.current);
  k.once('moveend', () => {
    flagge.current = false;
  });
  wachhund.current = window.setTimeout(() => {
    flagge.current = false;
    wachhund.current = null;
  }, 4000);
  aktion();
}

function cursorElement(name: string, farbe: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fremdcursor';
  el.style.setProperty('--nutzerfarbe', farbe);
  const punkt = document.createElement('span');
  punkt.className = 'fremdcursor__punkt';
  punkt.style.backgroundColor = farbe;
  const schild = document.createElement('span');
  schild.className = 'fremdcursor__name';
  schild.style.backgroundColor = farbe;
  schild.textContent = name;
  el.append(punkt, schild);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function schildElement(text: string, titel: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'standschild';
  el.textContent = text;
  el.title = titel;
  return el;
}

function setzeDaten(k: MlKarte, quelle: string, daten: GjSammlung<GjGeometrie, Eigenschaften>): void {
  const q = k.getSource(quelle) as GeoJSONSource | undefined;
  if (q) q.setData(daten);
}

function schalte(k: MlKarte, ebene: string, an: boolean): void {
  if (k.getLayer(ebene)) k.setLayoutProperty(ebene, 'visibility', an ? 'visible' : 'none');
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export function Karte2D({ sichtbar }: { sichtbar: boolean }) {
  const behaelterRef = useRef<HTMLDivElement | null>(null);
  const karteRef = useRef<MlKarte | null>(null);
  const echoRef = useRef(false);
  const wachhundRef = useRef<number | null>(null);
  const gefittetRef = useRef<string | null>(null);
  const cursorMarkerRef = useRef(new Map<string, maplibregl.Marker>());
  const schildMarkerRef = useRef(new Map<string, { marker: maplibregl.Marker; text: string }>());
  const [bereit, setBereit] = useState(false);

  const gelaende = nutzeZustand((s) => s.gelaende);
  const inhalt = nutzeZustand((s) => s.inhalt);
  const typen = nutzeZustand((s) => s.typen);
  const bericht = nutzeZustand((s) => s.bericht);
  const auswahl = nutzeZustand((s) => s.auswahl);
  const ebenen = nutzeZustand((s) => s.ebenen);
  const praesenz = nutzeZustand((s) => s.praesenz);
  const nutzer = nutzeZustand((s) => s.nutzer);

  const verstoesse = useMemo(
    () => (bericht?.ergebnisse ?? []).filter((e) => e.status === 'verstoss' && Array.isArray(e.ort)),
    [bericht],
  );

  // -- 1. Karte erzeugen (genau einmal) -------------------------------------
  useEffect(() => {
    const behaelter = behaelterRef.current;
    if (!behaelter) return;

    const k = new maplibregl.Map({
      container: behaelter,
      style: LEERER_STIL,
      center: START_MITTE,
      zoom: 16,
      maxZoom: 22,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: false,
    });
    karteRef.current = k;

    k.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
    k.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-left');

    // Leere Kartenkacheln (HTTP 204) und fehlende Texturen sind zulaessig —
    // sie duerfen die Konsole nicht fluten.
    k.on('error', () => {
      /* bewusst still */
    });

    k.on('load', () => {
      for (const q of QUELLEN) k.addSource(q, { type: 'geojson', data: LEERE_SAMMLUNG });
      for (const e of KARTEN_EBENEN) k.addLayer(e);
      setBereit(true);
    });

    k.on('move', () => {
      if (echoRef.current) return;
      const m = k.getCenter();
      window.dispatchEvent(
        new CustomEvent('ep3d:karte-bewegt', { detail: { lon: m.lng, lat: m.lat, zoom: k.getZoom(), bearing: k.getBearing() } }),
      );
    });

    k.on('mousemove', (e) => {
      nutzeZustand.getState().cursorSenden(nachUtm([e.lngLat.lng, e.lngLat.lat]));
    });
    k.on('mouseout', () => nutzeZustand.getState().cursorSenden(null));

    k.on('click', (e) => {
      for (const { ebene, art } of KLICKBAR) {
        if (!k.getLayer(ebene)) continue;
        const treffer = k.queryRenderedFeatures(e.point, { layers: [ebene] });
        const id = treffer[0]?.properties?.id;
        if (typeof id === 'string') {
          nutzeZustand.getState().setzeAuswahl([{ art, id }]);
          return;
        }
      }
      nutzeZustand.getState().setzeAuswahl([]);
    });

    for (const { ebene } of KLICKBAR) {
      k.on('mouseenter', ebene, () => {
        k.getCanvas().style.cursor = 'pointer';
      });
      k.on('mouseleave', ebene, () => {
        k.getCanvas().style.cursor = '';
      });
    }

    const cursorMarker = cursorMarkerRef.current;
    const schildMarker = schildMarkerRef.current;
    return () => {
      if (wachhundRef.current !== null) window.clearTimeout(wachhundRef.current);
      wachhundRef.current = null;
      for (const m of cursorMarker.values()) m.remove();
      cursorMarker.clear();
      for (const s of schildMarker.values()) s.marker.remove();
      schildMarker.clear();
      setBereit(false);
      karteRef.current = null;
      gefittetRef.current = null;
      k.remove();
    };
  }, []);

  // -- 2. Sichtbarkeit: der Canvas muss nach dem Einblenden neu vermessen werden
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !sichtbar) return;
    const id = requestAnimationFrame(() => k.resize());
    return () => cancelAnimationFrame(id);
  }, [sichtbar, bereit]);

  // -- 3. Amtliche Karte als 3x3-Bildraster ---------------------------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit || !gelaende) return;
    const b = gelaende.bbox;
    const ids: string[] = [];
    const sichtbarStart = nutzeZustand.getState().ebenen.gelaende;
    const teile = 3;
    for (let i = 0; i < teile; i++) {
      for (let j = 0; j < teile; j++) {
        const minE = Math.round(b.minE + ((b.maxE - b.minE) * i) / teile);
        const maxE = Math.round(b.minE + ((b.maxE - b.minE) * (i + 1)) / teile);
        const minN = Math.round(b.minN + ((b.maxN - b.minN) * j) / teile);
        const maxN = Math.round(b.minN + ((b.maxN - b.minN) * (j + 1)) / teile);
        if (maxE <= minE || maxN <= minN) continue;
        const id = `karte-${i}-${j}`;
        const abfrage = new URLSearchParams({ minE: String(minE), minN: String(minN), maxE: String(maxE), maxN: String(maxN), px: '512' });
        k.addSource(id, { type: 'image', url: `/api/gelaende/karte/kachel?${abfrage.toString()}`, coordinates: bboxEcken({ minE, minN, maxE, maxN }) });
        k.addLayer(
          {
            id,
            type: 'raster',
            source: id,
            layout: { visibility: sichtbarStart ? 'visible' : 'none' },
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
          },
          k.getLayer('flurstuecke') ? 'flurstuecke' : undefined,
        );
        ids.push(id);
      }
    }
    return () => {
      for (const id of ids) {
        if (k.getLayer(id)) k.removeLayer(id);
        if (k.getSource(id)) k.removeSource(id);
      }
    };
  }, [bereit, gelaende]);

  // -- 4. Luftbildtexturen der Gelaendekacheln --------------------------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit || !gelaende) return;
    const ids: string[] = [];
    const sichtbarStart = nutzeZustand.getState().ebenen.luftbild;
    for (const p of gelaende.patches) {
      if (!p.texturDatei) continue;
      const id = `luft-${p.id}`;
      k.addSource(id, {
        type: 'image',
        url: `/api/gelaende/${encodeURIComponent(gelaende.id)}/textur/${encodeURIComponent(p.texturDatei)}`,
        coordinates: bboxEcken(p.bbox),
      });
      k.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          layout: { visibility: sichtbarStart ? 'visible' : 'none' },
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
        },
        k.getLayer('flurstuecke') ? 'flurstuecke' : undefined,
      );
      ids.push(id);
    }
    return () => {
      for (const id of ids) {
        if (k.getLayer(id)) k.removeLayer(id);
        if (k.getSource(id)) k.removeSource(id);
      }
    };
  }, [bereit, gelaende]);

  // -- 5. Bestand: Gebaeude und Flurstuecke; Kamera auf neues Gelaende --------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit) return;
    if (!gelaende) {
      setzeDaten(k, 'gebaeude', LEERE_SAMMLUNG);
      setzeDaten(k, 'flurstuecke', LEERE_SAMMLUNG);
      gefittetRef.current = null;
      return;
    }
    setzeDaten(
      k,
      'gebaeude',
      sammlung(gelaende.gebaeude.filter((g) => g.grundriss.length >= 3).map((g) => flaeche(g.grundriss, { id: g.id, quelle: g.quelle }))),
    );
    setzeDaten(
      k,
      'flurstuecke',
      sammlung(gelaende.flurstuecke.filter((f) => f.polygon.length >= 3).map((f) => flaeche(f.polygon, { id: f.id, kennzeichen: f.kennzeichen }))),
    );
    if (gefittetRef.current !== gelaende.id) {
      gefittetRef.current = gelaende.id;
      const w = bboxNachWgs(gelaende.bbox);
      ohneEcho(k, echoRef, wachhundRef, () =>
        k.fitBounds(
          [
            [w.minLon, w.minLat],
            [w.maxLon, w.maxLat],
          ],
          { padding: 40, duration: 0 },
        ),
      );
    }
  }, [bereit, gelaende]);

  // -- 6. Planungsinhalt: Wege, Objekte, Blockflaechen, Stationen -------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit) return;
    const gewaehlt = new Set(auswahl.map((a) => `${a.art}:${a.id}`));

    const wegFlaechen: GjFeature<GjGeometrie, Eigenschaften>[] = [];
    const wegAchsen: GjFeature<GjGeometrie, Eigenschaften>[] = [];
    for (const w of inhalt?.wege ?? []) {
      if (w.polylinie.length < 2) continue;
      const farbe = WEGE_TYP_FARBE[w.typ];
      const eig: Eigenschaften = { id: w.id, art: 'weg', farbe, ausgewaehlt: gewaehlt.has(`weg:${w.id}`) };
      const ringe = wegKorridor(w.polylinie, w.breite);
      if (ringe.length > 0) wegFlaechen.push(mehrflaeche(ringe, eig));
      wegAchsen.push(linie(w.polylinie, eig));
    }
    setzeDaten(k, 'wege', sammlung(wegFlaechen));
    setzeDaten(k, 'wegachsen', sammlung(wegAchsen));

    const objekte: GjFeature<GjGeometrie, Eigenschaften>[] = [];
    for (const o of inhalt?.objekte ?? []) {
      const typ = typen.get(o.typId);
      if (!typ) continue; // ohne Typ ist der Grundriss unbekannt — nichts erfinden
      objekte.push(
        flaeche(grundriss(typ, o), {
          id: o.id,
          art: 'objekt',
          farbe: typ.farbe,
          randFarbe: aufhellen(typ.farbe),
          ausgewaehlt: gewaehlt.has(`objekt:${o.id}`),
        }),
      );
    }
    setzeDaten(k, 'objekte', sammlung(objekte));

    setzeDaten(
      k,
      'blockflaechen',
      sammlung(
        (inhalt?.blockflaechen ?? [])
          .filter((b) => b.polygon.length >= 3)
          .map((b) =>
            flaeche(b.polygon, {
              id: b.id,
              art: 'blockflaeche',
              farbe: BLOCK_FARBE[b.typ],
              ausgewaehlt: gewaehlt.has(`blockflaeche:${b.id}`),
            }),
          ),
      ),
    );

    const stationen: GjFeature<GjGeometrie, Eigenschaften>[] = [];
    for (const s of inhalt?.einsatzstationen ?? []) {
      const p = s.punkt ?? (s.polygon && s.polygon.length >= 3 ? schwerpunkt(s.polygon) : null);
      if (!p) continue;
      stationen.push(
        punktFeature(p, {
          id: s.id,
          art: 'einsatzstation',
          farbe: STATION_FARBE[s.kategorie],
          ausgewaehlt: gewaehlt.has(`einsatzstation:${s.id}`),
        }),
      );
    }
    setzeDaten(k, 'stationen', sammlung(stationen));
  }, [bereit, inhalt, typen, auswahl]);

  // -- 7. Beanstandungen (Engstellen und andere Verstoesse) -------------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit) return;
    setzeDaten(
      k,
      'verstoesse',
      sammlung(
        verstoesse
          .filter((e) => e.ort)
          .map((e) => punktFeature(e.ort as Punkt, { id: e.id, regel: e.regelId, meldung: e.meldung })),
      ),
    );
  }, [bereit, verstoesse]);

  // -- 8. Puls der Beanstandungen -------------------------------------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit || verstoesse.length === 0) return;
    let laeuft = true;
    let id = 0;
    const takt = () => {
      if (!laeuft) return;
      const t = (Date.now() % 1600) / 1600;
      if (k.getLayer('verstoss-puls')) {
        k.setPaintProperty('verstoss-puls', 'circle-radius', 8 + 16 * t);
        k.setPaintProperty('verstoss-puls', 'circle-opacity', 0.35 * (1 - t));
      }
      id = requestAnimationFrame(takt);
    };
    id = requestAnimationFrame(takt);
    return () => {
      laeuft = false;
      cancelAnimationFrame(id);
    };
  }, [bereit, verstoesse]);

  // -- 9. Ebenen-Sichtbarkeit ------------------------------------------------
  useEffect(() => {
    const k = karteRef.current;
    if (!k || !bereit) return;
    for (const z of EBENEN_ZUORDNUNG) for (const e of z.ebenen) schalte(k, e, ebenen[z.schalter]);
    for (const l of k.getStyle().layers) {
      if (l.id.startsWith('karte-')) schalte(k, l.id, ebenen.gelaende);
      else if (l.id.startsWith('luft-')) schalte(k, l.id, ebenen.luftbild);
    }
  }, [bereit, ebenen, gelaende]);

  // -- 10. Fremde Cursor ----------------------------------------------------
  useEffect(() => {
    const k = karteRef.current;
    const marker = cursorMarkerRef.current;
    if (!k || !bereit) return;
    const gesehen = new Set<string>();
    for (const p of praesenz) {
      if (!p.cursor || p.nutzerId === nutzer?.id) continue;
      gesehen.add(p.nutzerId);
      const ll = nachWgs(p.cursor);
      const vorhanden = marker.get(p.nutzerId);
      if (vorhanden) {
        vorhanden.setLngLat(ll);
      } else {
        const m = new maplibregl.Marker({ element: cursorElement(p.nutzerName, p.farbe), anchor: 'top-left' }).setLngLat(ll).addTo(k);
        marker.set(p.nutzerId, m);
      }
    }
    for (const [id, m] of marker) {
      if (!gesehen.has(id)) {
        m.remove();
        marker.delete(id);
      }
    }
  }, [bereit, praesenz, nutzer]);

  // -- 11. Standnummern als Marker (ohne Glyphs sind keine symbol-Layer moeglich)
  useEffect(() => {
    const k = karteRef.current;
    const marker = schildMarkerRef.current;
    if (!k || !bereit) return;
    const gesehen = new Set<string>();
    if (ebenen.objekte) {
      for (const o of inhalt?.objekte ?? []) {
        if (!o.standNummer) continue;
        gesehen.add(o.id);
        const ll = nachWgs(o.position);
        const titel = bezeichnung(typen.get(o.typId), o);
        const vorhanden = marker.get(o.id);
        if (vorhanden) {
          vorhanden.marker.setLngLat(ll);
          if (vorhanden.text !== o.standNummer) {
            vorhanden.marker.getElement().textContent = o.standNummer;
            vorhanden.marker.getElement().title = titel;
            vorhanden.text = o.standNummer;
          }
        } else {
          const m = new maplibregl.Marker({ element: schildElement(o.standNummer, titel), anchor: 'center' }).setLngLat(ll).addTo(k);
          marker.set(o.id, { marker: m, text: o.standNummer });
        }
      }
    }
    for (const [id, s] of marker) {
      if (!gesehen.has(id)) {
        s.marker.remove();
        marker.delete(id);
      }
    }
  }, [bereit, inhalt, typen, ebenen.objekte]);

  // -- 12. Synchronisation mit der 3D-Szene ----------------------------------
  useEffect(() => {
    function aufKamera(ev: Event) {
      const k = karteRef.current;
      const d = (ev as CustomEvent<KameraDetail>).detail;
      if (!k || !d || !Number.isFinite(d.lon) || !Number.isFinite(d.lat) || !(d.hoeheM > 0)) return;
      const zoom = zoomAusHoehe(d.lat, d.hoeheM);
      const richtung = Number.isFinite(d.richtungGrad) ? d.richtungGrad : 0;
      ohneEcho(k, echoRef, wachhundRef, () => k.jumpTo({ center: [d.lon, d.lat], zoom, bearing: richtung }));
    }
    function aufSprung(ev: Event) {
      const k = karteRef.current;
      const ort = (ev as CustomEvent<{ ort?: Punkt }>).detail?.ort;
      if (!k || !Array.isArray(ort) || ort.length < 2 || !Number.isFinite(ort[0]) || !Number.isFinite(ort[1])) return;
      const ll = nachWgs([ort[0], ort[1]]);
      ohneEcho(k, echoRef, wachhundRef, () => k.flyTo({ center: ll, zoom: Math.max(k.getZoom(), 18), duration: 900 }));
    }
    window.addEventListener('ep3d:kamera', aufKamera);
    window.addEventListener('ep3d:springe', aufSprung);
    return () => {
      window.removeEventListener('ep3d:kamera', aufKamera);
      window.removeEventListener('ep3d:springe', aufSprung);
    };
  }, []);

  return (
    <div className="karte2d" role="region" aria-label="Lageplan in 2D" hidden={!sichtbar}>
      <div className="karte2d__flaeche" ref={behaelterRef} />
      {!gelaende && (
        <div className="karte2d__platzhalter leer">
          <p>Kein Gelände geladen.</p>
          <p>Die 2D-Ansicht zeigt den Lageplan, sobald ein Projekt mit Gelände geöffnet ist.</p>
        </div>
      )}
    </div>
  );
}
