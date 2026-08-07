/**
 * Ableitungen aus Objekttyp + Instanz: tatsaechliche Masse, Grundriss,
 * Ein-/Ausstiege in Weltkoordinaten. Eine einzige Wahrheit fuer Editor,
 * Regelpruefung, Lageplan und Export.
 */

import type { Masse, ObjektInstanz, ObjektTyp, Punkt, Ring, Zugang } from './types.ts';
import { kreisRing, rechteckRing, richtungsVektor, rotiere, ringPuffern } from '../geo/geometry.ts';

export function masseVon(typ: ObjektTyp, inst: Pick<ObjektInstanz, 'masseOverride'>): Masse {
  const o = inst.masseOverride ?? {};
  return {
    laenge: o.laenge ?? typ.masse.laenge,
    breite: o.breite ?? typ.masse.breite,
    hoehe: o.hoehe ?? typ.masse.hoehe,
  };
}

/** Grundriss in EPSG:25832. Kreisfoermige Fahrgeschaefte bekommen ein 32-Eck. */
export function grundriss(typ: ObjektTyp, inst: ObjektInstanz): Ring {
  const m = masseVon(typ, inst);
  if (typ.form === 'kreis') return kreisRing(inst.position, Math.max(m.laenge, m.breite));
  return rechteckRing(inst.position, m.laenge, m.breite, inst.rotation);
}

/** Grundriss inklusive des freizuhaltenden Umlaufs (flaechenbedarfZusatz). */
export function grundrissMitUmlauf(typ: ObjektTyp, inst: ObjektInstanz): Ring {
  const g = grundriss(typ, inst);
  return typ.flaechenbedarfZusatz > 0 ? ringPuffern(g, typ.flaechenbedarfZusatz) : g;
}

export interface WeltZugang extends Zugang {
  /** Weltposition des Zugangs (EPSG:25832). */
  welt: Punkt;
  /** Kompassrichtung, in die der Zugang zeigt (0 = Nord, im Uhrzeigersinn). */
  weltRichtung: number;
  /** Punkt 1 m vor dem Zugang — hier muss ein Weg anliegen. */
  anschlussPunkt: Punkt;
  objektId: string;
  index: number;
}

export function zugaengeWelt(typ: ObjektTyp, inst: ObjektInstanz): WeltZugang[] {
  const m = masseVon(typ, inst);
  const sx = typ.parametrisierbar && typ.masse.laenge > 0 ? m.laenge / typ.masse.laenge : 1;
  const sy = typ.parametrisierbar && typ.masse.breite > 0 ? m.breite / typ.masse.breite : 1;
  return typ.einAusstiege.map((z, i) => {
    const lokal: Punkt = [z.pos[0] * sx, z.pos[1] * sy];
    const gedreht = rotiere(lokal, inst.rotation);
    const welt: Punkt = [inst.position[0] + gedreht[0], inst.position[1] + gedreht[1]];
    const weltRichtung = (inst.rotation + z.richtung) % 360;
    const rv = richtungsVektor(weltRichtung);
    return {
      ...z,
      welt,
      weltRichtung,
      anschlussPunkt: [welt[0] + rv[0] * 1.0, welt[1] + rv[1] * 1.0],
      objektId: inst.id,
      index: i,
    };
  });
}

/** Hoehe des Objekts in Metern (fuer 3D und lichte Hoehe). */
export function hoeheVon(typ: ObjektTyp, inst: ObjektInstanz): number {
  return masseVon(typ, inst).hoehe;
}

export function bezeichnung(typ: ObjektTyp | undefined, inst: ObjektInstanz): string {
  const nr = inst.standNummer ? `Stand ${inst.standNummer}` : null;
  const n = typ?.name ?? inst.typId;
  return nr ? `${nr} (${n})` : n;
}

/** Grundflaeche in m2 (fuer Kapazitaets- und Flaechenbilanz). */
export function grundflaeche(typ: ObjektTyp, inst: ObjektInstanz): number {
  const m = masseVon(typ, inst);
  if (typ.form === 'kreis') {
    const r = Math.max(m.laenge, m.breite) / 2;
    return Math.PI * r * r;
  }
  return m.laenge * m.breite;
}

/** Prueft, ob eine Massaenderung innerhalb der Typgrenzen liegt. */
export function masseGueltig(typ: ObjektTyp, m: Partial<Masse>): { ok: boolean; fehler: string[] } {
  const fehler: string[] = [];
  if (!typ.parametrisierbar) {
    if (m.laenge !== undefined || m.breite !== undefined || m.hoehe !== undefined) {
      fehler.push(`${typ.name} ist nicht parametrisierbar.`);
    }
    return { ok: fehler.length === 0, fehler };
  }
  const pruefe = (wert: number | undefined, grenzen: [number, number], label: string) => {
    if (wert === undefined) return;
    if (!Number.isFinite(wert)) fehler.push(`${label}: keine Zahl.`);
    else if (wert < grenzen[0] - 1e-9 || wert > grenzen[1] + 1e-9) {
      fehler.push(`${label} ${wert.toFixed(2)} m liegt ausserhalb von ${grenzen[0]}-${grenzen[1]} m.`);
    }
  };
  pruefe(m.laenge, typ.minMax.laenge, 'Laenge');
  pruefe(m.breite, typ.minMax.breite, 'Breite');
  pruefe(m.hoehe, typ.minMax.hoehe, 'Hoehe');
  return { ok: fehler.length === 0, fehler };
}
