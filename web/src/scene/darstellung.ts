/**
 * Bauteile der 3D-Darstellung: Bestandsgebaeude, Aufbauten, Wege,
 * Blockflaechen, Einsatzstationen und Bemassung.
 *
 * Alle Primitives werden SYNCHRON gebaut (asynchronous: false). Der
 * Async-Pfad von Cesium haengt in gedrosselten Hintergrund-Tabs dauerhaft im
 * Zustand "nicht bereit" — das faellt erst auf, wenn jemand den Tab wechselt.
 */

import * as Cesium from 'cesium';
import type {
  Blockflaeche,
  Einsatzstation,
  Gelaende,
  ObjektInstanz,
  ObjektTyp,
  Punkt,
  Pruefergebnis,
  Ring,
  Weg,
} from '@shared/domain/types';
import { STATION_FARBE, WEGE_TYP_FARBE } from '@shared/domain/types';
import { grundriss, masseVon, zugaengeWelt, bezeichnung } from '@shared/domain/objekte';
import { aufPolylinie, kreisRing, polylinieLaenge, wegKorridor, schwerpunkt, norm, sub, lot } from '@shared/geo/geometry';
import { nachWgs } from '@shared/geo/proj';
import type { Hoehenlage } from './gelaende.ts';

export const FARBEN = {
  gebaeude: Cesium.Color.fromCssColorString('#c3cfda'),
  gebaeudeRand: Cesium.Color.fromCssColorString('#8fa0b0'),
  auswahl: Cesium.Color.fromCssColorString('#4a9eda'),
  kollision: Cesium.Color.fromCssColorString('#e8503a'),
  zuNah: Cesium.Color.fromCssColorString('#f0b400'),
  geist: Cesium.Color.fromCssColorString('#33c46b').withAlpha(0.55),
  geistFalsch: Cesium.Color.fromCssColorString('#e8503a').withAlpha(0.55),
  bemassung: Cesium.Color.fromCssColorString('#ffd479'),
  beanstandung: Cesium.Color.fromCssColorString('#e8503a'),
};

function ringNachDegrees(ring: Ring): number[] {
  const out: number[] = [];
  for (const p of ring) {
    const [lon, lat] = nachWgs(p);
    out.push(lon, lat);
  }
  return out;
}

/** Aufragender Koerper: Grundriss zwischen zwei absoluten Hoehen. */
function prisma(ring: Ring, basis: number, oben: number): Cesium.PolygonGeometry {
  return new Cesium.PolygonGeometry({
    polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringNachDegrees(ring))),
    height: basis,
    extrudedHeight: Math.max(basis + 0.01, oben),
    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
  });
}

/** Flaeche, die dem Gelaende folgt (Wege, Blockflaechen). */
function bodenFlaeche(ring: Ring, hoehen: Hoehenlage, ueberGrund: number): Cesium.PolygonGeometry {
  const punkte = ring.map((p) => {
    const [lon, lat] = nachWgs(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + ueberGrund);
  });
  return new Cesium.PolygonGeometry({
    polygonHierarchy: new Cesium.PolygonHierarchy(punkte),
    perPositionHeight: true,
    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
  });
}

function farbAttribut(farbe: Cesium.Color) {
  return { color: Cesium.ColorGeometryInstanceAttribute.fromColor(farbe) };
}

function sammelPrimitive(instanzen: Cesium.GeometryInstance[], durchsichtig: boolean): Cesium.Primitive | null {
  if (!instanzen.length) return null;
  return new Cesium.Primitive({
    geometryInstances: instanzen,
    appearance: new Cesium.PerInstanceColorAppearance({
      translucent: durchsichtig,
      closed: !durchsichtig,
      flat: false,
    }),
    asynchronous: false,
  });
}

// ---------------------------------------------------------------------------
// Bestandsgebaeude
// ---------------------------------------------------------------------------

export function baueGebaeude(gelaende: Gelaende): Cesium.Primitive[] {
  const prims: Cesium.Primitive[] = [];
  const BLOCK = 350;
  for (let start = 0; start < gelaende.gebaeude.length; start += BLOCK) {
    const instanzen: Cesium.GeometryInstance[] = [];
    for (const g of gelaende.gebaeude.slice(start, start + BLOCK)) {
      if (g.grundriss.length < 3) continue;
      const oben = g.firstHoehe ?? g.traufHoehe ?? g.bodenHoehe + 8;
      if (oben - g.bodenHoehe < 0.3) continue;
      try {
        instanzen.push(
          new Cesium.GeometryInstance({
            geometry: prisma(g.grundriss, g.bodenHoehe, oben),
            id: `gebaeude:${g.id}`,
            attributes: farbAttribut(FARBEN.gebaeude),
          }),
        );
      } catch {
        // Einzelne fehlerhafte Grundrisse duerfen die Szene nicht kippen
      }
    }
    const p = sammelPrimitive(instanzen, false);
    if (p) prims.push(p);
  }
  return prims;
}

// ---------------------------------------------------------------------------
// Aufbauten
// ---------------------------------------------------------------------------

export interface ObjektDarstellung {
  koerper: Cesium.Primitive | null;
  umrisse: Cesium.Primitive | null;
}

export function baueObjekte(
  objekte: ObjektInstanz[],
  typen: Map<string, ObjektTyp>,
  hoehen: Hoehenlage,
  status: Record<string, 'ok' | 'kollision' | 'zu_nah'>,
  auswahl: Set<string>,
): ObjektDarstellung {
  const koerper: Cesium.GeometryInstance[] = [];
  const umriss: Cesium.GeometryInstance[] = [];

  for (const o of objekte) {
    const typ = typen.get(o.typId);
    if (!typ) continue;
    const ring = grundriss(typ, o);
    const m = masseVon(typ, o);
    const basis = hoehen.bei(o.position[0], o.position[1]) + (o.hoeheUeberGelaende ?? 0);

    let farbe = Cesium.Color.fromCssColorString(typ.farbe || '#8ea4b8');
    const s = status[o.id];
    if (s === 'kollision') farbe = Cesium.Color.lerp(farbe, FARBEN.kollision, 0.65, new Cesium.Color());
    else if (s === 'zu_nah') farbe = Cesium.Color.lerp(farbe, FARBEN.zuNah, 0.55, new Cesium.Color());
    if (auswahl.has(o.id)) farbe = Cesium.Color.lerp(farbe, FARBEN.auswahl, 0.45, new Cesium.Color());

    try {
      koerper.push(
        new Cesium.GeometryInstance({
          geometry: prisma(ring, basis, basis + m.hoehe),
          id: `objekt:${o.id}`,
          attributes: farbAttribut(farbe),
        }),
      );
      // Dachkante als eigener duenner Streifen — macht Kanten im Modell lesbar
      umriss.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [...ring, ring[0]].map((p) => {
              const [lon, lat] = nachWgs(p);
              return Cesium.Cartesian3.fromDegrees(lon, lat, basis + m.hoehe + 0.02);
            }),
            width: auswahl.has(o.id) ? 4 : 1.6,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: farbAttribut(auswahl.has(o.id) ? FARBEN.auswahl : Cesium.Color.WHITE.withAlpha(0.55)),
        }),
      );
    } catch {
      /* entarteter Grundriss */
    }
  }

  return {
    koerper: sammelPrimitive(koerper, false),
    umrisse: umriss.length
      ? new Cesium.Primitive({
          geometryInstances: umriss,
          appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
          asynchronous: false,
        })
      : null,
  };
}

// ---------------------------------------------------------------------------
// Wege
// ---------------------------------------------------------------------------

export function baueWege(wege: Weg[], hoehen: Hoehenlage, auswahl: Set<string>): Cesium.Primitive[] {
  const flaechen: Cesium.GeometryInstance[] = [];
  const linien: Cesium.GeometryInstance[] = [];

  for (const w of wege) {
    if (w.polylinie.length < 2) continue;
    const farbe = Cesium.Color.fromCssColorString(WEGE_TYP_FARBE[w.typ]);
    const gewaehlt = auswahl.has(w.id);
    for (const ring of wegKorridor(w.polylinie, w.breite)) {
      try {
        flaechen.push(
          new Cesium.GeometryInstance({
            geometry: bodenFlaeche(ring, hoehen, 0.06),
            id: `weg:${w.id}`,
            attributes: farbAttribut(farbe.withAlpha(gewaehlt ? 0.5 : 0.32)),
          }),
        );
      } catch {
        /* entartetes Segment */
      }
    }
    // Mittellinie
    linien.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: w.polylinie.map((p) => {
            const [lon, lat] = nachWgs(p);
            return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + 0.12);
          }),
          width: gewaehlt ? 4 : 2,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        id: `weg:${w.id}`,
        attributes: farbAttribut(farbe),
      }),
    );
    // Laufrichtungspfeile
    if (w.richtung !== 'beide') {
      const gesamt = polylinieLaenge(w.polylinie);
      const abstand = Math.max(12, Math.min(40, gesamt / 6));
      for (let s = abstand / 2; s < gesamt; s += abstand) {
        const { p, richtung } = aufPolylinie(w.polylinie, s);
        const r: Punkt = w.richtung === 'rueckwaerts' ? [-richtung[0], -richtung[1]] : richtung;
        linien.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: pfeil(p, r, Math.min(2.4, w.breite * 0.5)).map((q) => {
                const [lon, lat] = nachWgs(q);
                return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(q[0], q[1]) + 0.14);
              }),
              width: 3,
              vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            }),
            attributes: farbAttribut(Cesium.Color.WHITE.withAlpha(0.85)),
          }),
        );
      }
    }
  }

  const out: Cesium.Primitive[] = [];
  const f = sammelPrimitive(flaechen, true);
  if (f) out.push(f);
  if (linien.length) {
    out.push(
      new Cesium.Primitive({
        geometryInstances: linien,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
      }),
    );
  }
  return out;
}

function pfeil(p: Punkt, richtung: Punkt, groesse: number): Punkt[] {
  const r = norm(richtung);
  const q = lot(r);
  const spitze: Punkt = [p[0] + r[0] * groesse, p[1] + r[1] * groesse];
  const links: Punkt = [p[0] - r[0] * groesse * 0.4 + q[0] * groesse * 0.55, p[1] - r[1] * groesse * 0.4 + q[1] * groesse * 0.55];
  const rechts: Punkt = [p[0] - r[0] * groesse * 0.4 - q[0] * groesse * 0.55, p[1] - r[1] * groesse * 0.4 - q[1] * groesse * 0.55];
  return [links, spitze, rechts];
}

// ---------------------------------------------------------------------------
// Blockflaechen
// ---------------------------------------------------------------------------

const BLOCK_FARBE: Record<string, string> = {
  gesperrt: '#e8503a',
  nicht_bebaubar: '#e87d3a',
  nur_einsatzkraefte: '#2f6fd0',
};

export function baueBlockflaechen(flaechen: Blockflaeche[], hoehen: Hoehenlage, auswahl: Set<string>): Cesium.Primitive[] {
  const inst: Cesium.GeometryInstance[] = [];
  const rand: Cesium.GeometryInstance[] = [];
  for (const b of flaechen) {
    if (b.polygon.length < 3) continue;
    const farbe = Cesium.Color.fromCssColorString(BLOCK_FARBE[b.typ] ?? '#e8503a');
    try {
      inst.push(
        new Cesium.GeometryInstance({
          geometry: bodenFlaeche(b.polygon, hoehen, 0.04),
          id: `blockflaeche:${b.id}`,
          attributes: farbAttribut(farbe.withAlpha(auswahl.has(b.id) ? 0.42 : 0.26)),
        }),
      );
      rand.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [...b.polygon, b.polygon[0]].map((p) => {
              const [lon, lat] = nachWgs(p);
              return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + 0.1);
            }),
            width: 2.5,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          id: `blockflaeche:${b.id}`,
          attributes: farbAttribut(farbe),
        }),
      );
    } catch {
      /* entartetes Polygon */
    }
  }
  const out: Cesium.Primitive[] = [];
  const f = sammelPrimitive(inst, true);
  if (f) out.push(f);
  if (rand.length) {
    out.push(new Cesium.Primitive({ geometryInstances: rand, appearance: new Cesium.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Einsatzstationen
// ---------------------------------------------------------------------------

export function baueStationen(stationen: Einsatzstation[], hoehen: Hoehenlage, auswahl: Set<string>): Cesium.Primitive[] {
  const inst: Cesium.GeometryInstance[] = [];
  for (const s of stationen) {
    const punkt = s.punkt ?? (s.polygon ? schwerpunkt(s.polygon) : null);
    if (!punkt) continue;
    const farbe = Cesium.Color.fromCssColorString(STATION_FARBE[s.kategorie] ?? '#ffffff');
    const basis = hoehen.bei(punkt[0], punkt[1]);
    // Bodenscheibe
    try {
      inst.push(
        new Cesium.GeometryInstance({
          geometry: bodenFlaeche(kreisRing(punkt, s.polygon ? 6 : 4, 24), hoehen, 0.08),
          id: `einsatzstation:${s.id}`,
          attributes: farbAttribut(farbe.withAlpha(auswahl.has(s.id) ? 0.65 : 0.42)),
        }),
      );
      // Mast, damit die Station auch aus der Ferne sichtbar ist
      inst.push(
        new Cesium.GeometryInstance({
          geometry: prisma(kreisRing(punkt, 0.5, 8), basis, basis + 6),
          id: `einsatzstation:${s.id}`,
          attributes: farbAttribut(farbe),
        }),
      );
      inst.push(
        new Cesium.GeometryInstance({
          geometry: prisma(kreisRing(punkt, 2.4, 12), basis + 5.4, basis + 6.6),
          id: `einsatzstation:${s.id}`,
          attributes: farbAttribut(farbe),
        }),
      );
    } catch {
      /* still */
    }
    if (s.polygon && s.polygon.length >= 3) {
      try {
        inst.push(
          new Cesium.GeometryInstance({
            geometry: bodenFlaeche(s.polygon, hoehen, 0.05),
            id: `einsatzstation:${s.id}`,
            attributes: farbAttribut(farbe.withAlpha(0.22)),
          }),
        );
      } catch {
        /* still */
      }
    }
  }
  const p = sammelPrimitive(inst, true);
  return p ? [p] : [];
}

// ---------------------------------------------------------------------------
// Beschriftung und Bemassung
// ---------------------------------------------------------------------------

export function beschrifteObjekte(
  labels: Cesium.LabelCollection,
  objekte: ObjektInstanz[],
  typen: Map<string, ObjektTyp>,
  hoehen: Hoehenlage,
  auswahl: Set<string>,
) {
  labels.removeAll();
  for (const o of objekte) {
    const typ = typen.get(o.typId);
    if (!typ) continue;
    const m = masseVon(typ, o);
    const basis = hoehen.bei(o.position[0], o.position[1]);
    const [lon, lat] = nachWgs(o.position);
    const gewaehlt = auswahl.has(o.id);
    const text = gewaehlt
      ? `${bezeichnung(typ, o)}\n${m.laenge.toFixed(2)} x ${m.breite.toFixed(2)} x ${m.hoehe.toFixed(2)} m\n${o.rotation.toFixed(0)} Grad`
      : o.standNummer
        ? o.standNummer
        : '';
    if (!text) continue;
    labels.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, basis + m.hoehe + 1.2),
      text,
      font: gewaehlt ? '600 13px system-ui, sans-serif' : '12px system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#0e1216'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: gewaehlt ? Number.POSITIVE_INFINITY : 0,
      scaleByDistance: new Cesium.NearFarScalar(50, 1.0, 900, 0.45),
      translucencyByDistance: new Cesium.NearFarScalar(400, 1.0, 1400, 0.0),
    });
  }
}

/** Ein-/Ausstiege als kleine Pfeilmarken. */
export function baueZugaenge(objekte: ObjektInstanz[], typen: Map<string, ObjektTyp>, hoehen: Hoehenlage): Cesium.Primitive | null {
  const inst: Cesium.GeometryInstance[] = [];
  for (const o of objekte) {
    const typ = typen.get(o.typId);
    if (!typ || !typ.einAusstiege.length) continue;
    for (const z of zugaengeWelt(typ, o)) {
      const farbe =
        z.typ === 'einstieg'
          ? Cesium.Color.fromCssColorString('#33c46b')
          : z.typ === 'ausstieg'
            ? Cesium.Color.fromCssColorString('#4a9eda')
            : Cesium.Color.fromCssColorString('#f0b400');
      const richtung: Punkt = [z.anschlussPunkt[0] - z.welt[0], z.anschlussPunkt[1] - z.welt[1]];
      inst.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: pfeil(z.welt, richtung, Math.max(0.8, z.breite * 0.6)).map((q) => {
              const [lon, lat] = nachWgs(q);
              return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(q[0], q[1]) + 0.3);
            }),
            width: 4,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          id: `objekt:${o.id}`,
          attributes: farbAttribut(farbe),
        }),
      );
    }
  }
  if (!inst.length) return null;
  return new Cesium.Primitive({
    geometryInstances: inst,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
  });
}

/** Beanstandungen der Regelpruefung als rote Markierungen im Modell. */
export function baueBeanstandungen(ergebnisse: Pruefergebnis[], hoehen: Hoehenlage): Cesium.Primitive[] {
  const linien: Cesium.GeometryInstance[] = [];
  const flaechen: Cesium.GeometryInstance[] = [];
  for (const e of ergebnisse) {
    if (e.status !== 'verstoss') continue;
    const farbe = e.schweregrad === 'fehler' ? FARBEN.beanstandung : FARBEN.zuNah;
    if (e.geometrie && e.geometrie.length === 2) {
      // Engstellen-Querschnitt
      linien.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: e.geometrie.map((p) => {
              const [lon, lat] = nachWgs(p);
              return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(p[0], p[1]) + 0.5);
            }),
            width: 6,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: farbAttribut(farbe),
        }),
      );
    } else if (e.geometrie && e.geometrie.length > 2) {
      try {
        flaechen.push(
          new Cesium.GeometryInstance({
            geometry: bodenFlaeche(e.geometrie, hoehen, 0.15),
            attributes: farbAttribut(farbe.withAlpha(0.3)),
          }),
        );
      } catch {
        /* still */
      }
    }
    if (e.ort) {
      linien.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [
              (() => {
                const [lon, lat] = nachWgs(e.ort);
                return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(e.ort[0], e.ort[1]) + 0.2);
              })(),
              (() => {
                const [lon, lat] = nachWgs(e.ort);
                return Cesium.Cartesian3.fromDegrees(lon, lat, hoehen.bei(e.ort[0], e.ort[1]) + 9);
              })(),
            ],
            width: 3,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: farbAttribut(farbe.withAlpha(0.8)),
        }),
      );
    }
  }
  const out: Cesium.Primitive[] = [];
  const f = sammelPrimitive(flaechen, true);
  if (f) out.push(f);
  if (linien.length) {
    out.push(new Cesium.Primitive({ geometryInstances: linien, appearance: new Cesium.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
  }
  return out;
}

/** Platzier-Geist: durchscheinender Koerper unter dem Mauszeiger. */
export function baueGeist(typ: ObjektTyp, position: Punkt, rotation: number, hoehen: Hoehenlage, gueltig: boolean): Cesium.Primitive | null {
  const scheinObjekt: ObjektInstanz = {
    id: 'geist',
    projektId: '',
    typId: typ.id,
    position,
    rotation,
    status: 'geplant',
    auflagen: [],
    erstelltVon: '',
    erstelltAm: '',
  };
  const ring = grundriss(typ, scheinObjekt);
  const basis = hoehen.bei(position[0], position[1]);
  try {
    return new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: prisma(ring, basis, basis + typ.masse.hoehe),
        id: 'geist',
        attributes: farbAttribut(gueltig ? FARBEN.geist : FARBEN.geistFalsch),
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: false }),
      asynchronous: false,
    });
  } catch {
    return null;
  }
}

export { prisma, bodenFlaeche, ringNachDegrees, farbAttribut, sammelPrimitive };
