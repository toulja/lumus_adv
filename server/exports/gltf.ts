/**
 * Export F10.4 — 3D-Szene als binaeres glTF (.glb).
 *
 * Selbst geschrieben, ohne zusaetzliche Abhaengigkeit. Aufbau nach der
 * glTF-2.0-Spezifikation:
 *   Header  12 Byte : magic "glTF" (0x46546C67), version 2, gesamtLaenge
 *   Chunk 0          : JSON  (Typ 0x4E4F534A), mit Leerzeichen auf 4 Byte gefuellt
 *   Chunk 1          : BIN   (Typ 0x004E4942), mit Nullen auf 4 Byte gefuellt
 *
 * Koordinaten:
 *   Der Ursprung der Szene ist der Schwerpunkt des Gebiets in EPSG:25832.
 *   Alle Eckpunkte stehen RELATIV dazu in Metern — absolute UTM-Werte
 *   (ca. 4,8 Mio. Hochwert) wuerden in float32 auf ~0,5 m genau werden und die
 *   Geometrie sichtbar zerlegen.
 *   Achsen (Y-up, rechtshaendig, wie in glTF ueblich):
 *     X = Ost      (E - E0)
 *     Y = Hoch     (Hoehe in Metern)
 *     Z = Sued     (-(N - N0))
 *
 * Es wird bewusst OHNE Indexpuffer geschrieben (Dreiecks-Suppe): so traegt
 * jedes Dreieck seine eigene, flache Normale, und Kanten bleiben scharf.
 */

import type {
  Gelaende,
  ObjektInstanz,
  ObjektTyp,
  ProjektInhalt,
  Punkt,
  Ring,
  Weg,
} from '../../shared/domain/types.ts';
import { WEGE_TYP_FARBE, WEGE_TYP_LABEL } from '../../shared/domain/types.ts';
import { bezeichnung, grundriss, masseVon } from '../../shared/domain/objekte.ts';
import {
  bboxMitte,
  bboxVonPunkten,
  gegenUhrzeiger,
  ringNormalisieren,
  signierteFlaeche,
  wegKorridor,
} from '../../shared/geo/geometry.ts';

export interface GltfOpts {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  /** true = nur die platzierten Objekte, ohne Bestand und Wegkorridore. */
  nurObjekte?: boolean;
}

/** Hoehe, die ein Bestandsgebaeude ohne Hoehenangabe bekommt. */
const GESCHAETZTE_GEBAEUDEHOEHE = 8;
/** Wegkorridore liegen knapp ueber Grund, sonst flimmern sie gegen den Boden. */
const KORRIDOR_HOEHE = 0.02;

// ---------------------------------------------------------------------------
// Ear-Clipping — Triangulierung einfacher Polygone ohne Loecher
// ---------------------------------------------------------------------------

function imDreieck(p: Punkt, a: Punkt, b: Punkt, c: Punkt): boolean {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  const eps = 1e-12;
  const negativ = d1 < -eps || d2 < -eps || d3 < -eps;
  const positiv = d1 > eps || d2 > eps || d3 > eps;
  return !(negativ && positiv);
}

/**
 * Zerlegt einen einfachen Ring in Dreiecke. Rueckgabe sind Indextripel, die
 * sich auf den UEBERGEBENEN Ring beziehen; die Reihenfolge ist gegen den
 * Uhrzeigersinn, also von oben gesehen vorderseitig.
 */
export function ohrenSchnitt(ring: Ring): [number, number, number][] {
  const n = ring.length;
  if (n < 3) return [];
  const rest: number[] = [];
  for (let i = 0; i < n; i++) rest.push(i);
  if (signierteFlaeche(ring) < 0) rest.reverse();

  const dreiecke: [number, number, number][] = [];
  let wache = 0;
  while (rest.length > 2 && wache < n * n + 16) {
    wache++;
    let gefunden = false;
    for (let i = 0; i < rest.length; i++) {
      const ip = rest[(i - 1 + rest.length) % rest.length];
      const ic = rest[i];
      const inx = rest[(i + 1) % rest.length];
      const a = ring[ip];
      const b = ring[ic];
      const c = ring[inx];
      const kreuz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (kreuz <= 1e-12) continue; // Reflexecke oder entartet — kein Ohr
      let frei = true;
      for (const j of rest) {
        if (j === ip || j === ic || j === inx) continue;
        if (imDreieck(ring[j], a, b, c)) {
          frei = false;
          break;
        }
      }
      if (!frei) continue;
      dreiecke.push([ip, ic, inx]);
      rest.splice(i, 1);
      gefunden = true;
      break;
    }
    if (!gefunden) {
      // Selbstueberschneidender oder entarteter Ring: als Faecher schliessen,
      // damit auf jeden Fall eine ladbare Datei entsteht.
      for (let i = 1; i + 1 < rest.length; i++) dreiecke.push([rest[0], rest[i], rest[i + 1]]);
      break;
    }
  }
  return dreiecke;
}

// ---------------------------------------------------------------------------
// Netzaufbau
// ---------------------------------------------------------------------------

interface Netz {
  name: string;
  farbe: string;
  /** Immer Vielfache von 9: drei Eckpunkte je Dreieck. */
  positionen: number[];
  normalen: number[];
  /** true = auch von hinten sichtbar (flache Flaechen). */
  beidseitig: boolean;
}

function neuesNetz(name: string, farbe: string, beidseitig = false): Netz {
  return { name, farbe, positionen: [], normalen: [], beidseitig };
}

function dreieckAnhaengen(netz: Netz, a: number[], b: number[], c: number[]) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const wx = c[0] - a[0];
  const wy = c[1] - a[1];
  const wz = c[2] - a[2];
  let nx = uy * wz - uz * wy;
  let ny = uz * wx - ux * wz;
  let nz = ux * wy - uy * wx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return; // entartetes Dreieck ueberspringen
  nx /= l;
  ny /= l;
  nz /= l;
  netz.positionen.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  netz.normalen.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

/** EPSG:25832 + Hoehe -> glTF-Koordinaten relativ zum Szenenursprung. */
function welt(p: Punkt, y: number, e0: number, n0: number): number[] {
  return [p[0] - e0, y, -(p[1] - n0)];
}

/** Extrudiert einen Grundriss zu einem geschlossenen Prisma. */
function prismaAnhaengen(netz: Netz, rohRing: Ring, unten: number, oben: number, e0: number, n0: number) {
  const ring = gegenUhrzeiger(ringNormalisieren(rohRing));
  if (ring.length < 3) return;
  const dreiecke = ohrenSchnitt(ring);

  // Deckel: CCW-Reihenfolge ergibt hier bereits die Normale nach +Y.
  for (const [a, b, c] of dreiecke) {
    dreieckAnhaengen(
      netz,
      welt(ring[a], oben, e0, n0),
      welt(ring[b], oben, e0, n0),
      welt(ring[c], oben, e0, n0),
    );
  }
  // Boden: umgekehrte Reihenfolge -> Normale nach -Y.
  for (const [a, b, c] of dreiecke) {
    dreieckAnhaengen(
      netz,
      welt(ring[a], unten, e0, n0),
      welt(ring[c], unten, e0, n0),
      welt(ring[b], unten, e0, n0),
    );
  }
  // Waende: bei CCW-Ring zeigt (A,B,C)/(A,C,D) nach aussen.
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % ring.length];
    const A = welt(p0, unten, e0, n0);
    const B = welt(p1, unten, e0, n0);
    const C = welt(p1, oben, e0, n0);
    const D = welt(p0, oben, e0, n0);
    dreieckAnhaengen(netz, A, B, C);
    dreieckAnhaengen(netz, A, C, D);
  }
}

/** Flaches Polygon in fester Hoehe (Wegkorridor). */
function flaecheAnhaengen(netz: Netz, rohRing: Ring, y: number, e0: number, n0: number) {
  const ring = gegenUhrzeiger(ringNormalisieren(rohRing));
  if (ring.length < 3) return;
  for (const [a, b, c] of ohrenSchnitt(ring)) {
    dreieckAnhaengen(netz, welt(ring[a], y, e0, n0), welt(ring[b], y, e0, n0), welt(ring[c], y, e0, n0));
  }
}

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

/** sRGB-Kanal -> linear. glTF erwartet baseColorFactor im linearen Raum. */
function linear(k: number): number {
  return k <= 0.04045 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4;
}

function farbFaktor(hex: string): number[] {
  const h = hex.trim().replace('#', '');
  const voll = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const zahl = Number.parseInt(voll.slice(0, 6), 16);
  if (!Number.isFinite(zahl)) return [0.7, 0.7, 0.7, 1];
  const r = ((zahl >> 16) & 255) / 255;
  const g = ((zahl >> 8) & 255) / 255;
  const b = (zahl & 255) / 255;
  return [+linear(r).toFixed(6), +linear(g).toFixed(6), +linear(b).toFixed(6), 1];
}

// ---------------------------------------------------------------------------
// Elemente einsammeln
// ---------------------------------------------------------------------------

function gebaeudeHoehe(g: Gelaende['gebaeude'][number]): { hoehe: number; geschaetzt: boolean } {
  if (g.firstHoehe !== undefined && Number.isFinite(g.firstHoehe)) {
    const h = g.firstHoehe - g.bodenHoehe;
    if (h > 0.5) return { hoehe: h, geschaetzt: false };
  }
  if (g.traufHoehe !== undefined && Number.isFinite(g.traufHoehe)) {
    const h = g.traufHoehe - g.bodenHoehe;
    if (h > 0.5) return { hoehe: h, geschaetzt: false };
  }
  return { hoehe: GESCHAETZTE_GEBAEUDEHOEHE, geschaetzt: true };
}

function objektNetz(inst: ObjektInstanz, typ: ObjektTyp, e0: number, n0: number): Netz {
  const netz = neuesNetz(bezeichnung(typ, inst), typ.farbe);
  const m = masseVon(typ, inst);
  const unten = inst.hoeheUeberGelaende ?? 0;
  prismaAnhaengen(netz, grundriss(typ, inst), unten, unten + Math.max(0.05, m.hoehe), e0, n0);
  return netz;
}

function korridorNetz(w: Weg, e0: number, n0: number): Netz {
  const name = `${w.name ?? WEGE_TYP_LABEL[w.typ]} - Korridor`;
  const netz = neuesNetz(name, WEGE_TYP_FARBE[w.typ], true);
  for (const r of wegKorridor(w.polylinie, w.breite)) {
    flaecheAnhaengen(netz, r, KORRIDOR_HOEHE, e0, n0);
  }
  return netz;
}

// ---------------------------------------------------------------------------
// GLB-Schreiber
// ---------------------------------------------------------------------------

function auf4(x: number): number {
  return (x + 3) & ~3;
}

interface BauPuffer {
  teile: Buffer[];
  laenge: number;
}

function pufferAnhaengen(bp: BauPuffer, werte: number[]): { offset: number; laenge: number } {
  // Accessor-Offsets muessen ein Vielfaches der Komponentengroesse (4) sein.
  const luecke = auf4(bp.laenge) - bp.laenge;
  if (luecke > 0) {
    bp.teile.push(Buffer.alloc(luecke));
    bp.laenge += luecke;
  }
  const offset = bp.laenge;
  const f32 = new Float32Array(werte);
  const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  const kopie = Buffer.from(buf);
  bp.teile.push(kopie);
  bp.laenge += kopie.length;
  return { offset, laenge: kopie.length };
}

function minMax3(werte: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < werte.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = werte[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

function glbSchreiben(gltf: unknown, bin: Buffer): Buffer {
  const jsonRoh = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonLaenge = auf4(jsonRoh.length);
  const jsonChunk = Buffer.alloc(jsonLaenge, 0x20); // mit Leerzeichen fuellen
  jsonRoh.copy(jsonChunk);

  const hatBin = bin.length > 0;
  const binLaenge = hatBin ? auf4(bin.length) : 0;
  const binChunk = Buffer.alloc(binLaenge, 0); // mit Nullen fuellen
  bin.copy(binChunk);

  const gesamt = 12 + 8 + jsonLaenge + (hatBin ? 8 + binLaenge : 0);
  const out = Buffer.alloc(gesamt);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); // "glTF"
  o += 4;
  out.writeUInt32LE(2, o); // Version
  o += 4;
  out.writeUInt32LE(gesamt, o);
  o += 4;
  out.writeUInt32LE(jsonLaenge, o);
  o += 4;
  out.writeUInt32LE(0x4e4f534a, o); // "JSON"
  o += 4;
  jsonChunk.copy(out, o);
  o += jsonLaenge;
  if (hatBin) {
    out.writeUInt32LE(binLaenge, o);
    o += 4;
    out.writeUInt32LE(0x004e4942, o); // "BIN\0"
    o += 4;
    binChunk.copy(out, o);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function szeneAlsGltf(opts: GltfOpts): Buffer {
  const { inhalt, gelaende, typen } = opts;
  const nurObjekte = opts.nurObjekte === true;

  // 1) Ursprung bestimmen: Schwerpunkt des Gebiets aus allen beteiligten Punkten.
  const punkte: Punkt[] = [];
  for (const o of inhalt.objekte) {
    const typ = typen.get(o.typId);
    if (typ) for (const p of grundriss(typ, o)) punkte.push(p);
  }
  if (!nurObjekte) {
    for (const w of inhalt.wege) for (const p of w.polylinie) punkte.push(p);
    if (gelaende) {
      for (const g of gelaende.gebaeude) for (const p of g.grundriss) punkte.push(p);
      for (const p of gelaende.polygon) punkte.push(p);
    }
  }
  const mitte: Punkt = punkte.length ? bboxMitte(bboxVonPunkten(punkte)) : [0, 0];
  const e0 = mitte[0];
  const n0 = mitte[1];

  // Bezugshoehe: Bestandsgebaeude stehen auf ihrer echten Gelaendehoehe
  // relativ zum Mittelwert des Gelaendes; ohne Gelaende liegt alles auf 0.
  const hoeheBezug = gelaende && Number.isFinite(gelaende.hoeheMittel) ? gelaende.hoeheMittel : 0;

  // 2) Netze bauen.
  const netze: Netz[] = [];
  for (const o of inhalt.objekte) {
    const typ = typen.get(o.typId);
    if (!typ) continue;
    const netz = objektNetz(o, typ, e0, n0);
    if (netz.positionen.length) netze.push(netz);
  }

  if (!nurObjekte) {
    if (gelaende) {
      for (const g of gelaende.gebaeude) {
        const { hoehe, geschaetzt } = gebaeudeHoehe(g);
        const basis = Number.isFinite(g.bodenHoehe) ? g.bodenHoehe - hoeheBezug : 0;
        const name =
          (g.funktion ? `Bestandsgebaeude ${g.funktion}` : `Bestandsgebaeude ${g.id}`) +
          (geschaetzt ? ' (Hoehe geschaetzt)' : '');
        const netz = neuesNetz(name, '#8d949c');
        prismaAnhaengen(netz, g.grundriss, basis, basis + hoehe, e0, n0);
        if (netz.positionen.length) netze.push(netz);
      }
    }
    for (const w of inhalt.wege) {
      const netz = korridorNetz(w, e0, n0);
      if (netz.positionen.length) netze.push(netz);
    }
  }

  // 3) Puffer, Accessoren, Materialien.
  const bp: BauPuffer = { teile: [], laenge: 0 };
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const materialIndex = new Map<string, number>();

  const materialFuer = (farbe: string, beidseitig: boolean): number => {
    const schluessel = `${farbe}|${beidseitig ? 'd' : 's'}`;
    const vorhanden = materialIndex.get(schluessel);
    if (vorhanden !== undefined) return vorhanden;
    const i = materials.length;
    materials.push({
      name: `Material ${farbe}${beidseitig ? ' (beidseitig)' : ''}`,
      doubleSided: beidseitig,
      pbrMetallicRoughness: {
        baseColorFactor: farbFaktor(farbe),
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
    });
    materialIndex.set(schluessel, i);
    return i;
  };

  for (const netz of netze) {
    const anzahl = netz.positionen.length / 3;
    const pos = pufferAnhaengen(bp, netz.positionen);
    const posView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: pos.offset, byteLength: pos.laenge, target: 34962 });
    const nor = pufferAnhaengen(bp, netz.normalen);
    const norView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: nor.offset, byteLength: nor.laenge, target: 34962 });

    const grenzen = minMax3(netz.positionen);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      byteOffset: 0,
      componentType: 5126,
      count: anzahl,
      type: 'VEC3',
      min: grenzen.min,
      max: grenzen.max,
    });
    const norAcc = accessors.length;
    accessors.push({
      bufferView: norView,
      byteOffset: 0,
      componentType: 5126,
      count: anzahl,
      type: 'VEC3',
    });

    const meshIndex = meshes.length;
    meshes.push({
      name: netz.name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: norAcc },
          material: materialFuer(netz.farbe, netz.beidseitig),
          mode: 4,
        },
      ],
    });
    nodes.push({ name: netz.name, mesh: meshIndex });
  }

  const bin = Buffer.concat(bp.teile, bp.laenge);

  const gltf: Record<string, unknown> = {
    asset: {
      version: '2.0',
      generator: 'EventPlan3D Export F10.4',
      copyright:
        `Projekt ${inhalt.projekt.name}. Ursprung EPSG:25832 E=${e0.toFixed(3)} N=${n0.toFixed(3)}; ` +
        `X=Ost, Y=Hoch, Z=Sued, Einheit Meter.`,
    },
    scene: 0,
    scenes: [
      nodes.length
        ? { name: inhalt.projekt.name, nodes: nodes.map((_n, i) => i) }
        : { name: inhalt.projekt.name },
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: auf4(bin.length) }],
  };
  // Das glTF-2.0-Schema verlangt fuer JEDE dieser Listen mindestens einen
  // Eintrag (minItems 1) — ein leeres Array laesst den Khronos-Validator und
  // strenge Betrachter die Datei ablehnen. Bei einem Projekt ohne Geometrie
  // muessen die Felder darum ganz entfallen, nicht leer dastehen.
  if (!nodes.length) {
    delete gltf.nodes;
    delete gltf.meshes;
  }
  if (!materials.length) delete gltf.materials;
  if (!accessors.length) {
    delete gltf.accessors;
    delete gltf.bufferViews;
    delete gltf.buffers;
  }

  return glbSchreiben(gltf, bin);
}

/**
 * Liest den Kopf einer .glb-Datei zurueck — fuer Selbstpruefung und Tests.
 * Wirft, wenn magic, Version oder die Chunk-Laengen nicht stimmen.
 */
export function glbKopfPruefen(daten: Buffer): {
  version: number;
  gesamtLaenge: number;
  jsonLaenge: number;
  binLaenge: number;
  json: Record<string, unknown>;
} {
  if (daten.length < 20) throw new Error('glb: Datei zu kurz.');
  const magic = daten.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`glb: falsches magic 0x${magic.toString(16)}, erwartet "glTF".`);
  const version = daten.readUInt32LE(4);
  if (version !== 2) throw new Error(`glb: Version ${version}, erwartet 2.`);
  const gesamtLaenge = daten.readUInt32LE(8);
  if (gesamtLaenge !== daten.length) {
    throw new Error(`glb: Laengenangabe ${gesamtLaenge} passt nicht zu ${daten.length} Byte.`);
  }
  const jsonLaenge = daten.readUInt32LE(12);
  const jsonTyp = daten.readUInt32LE(16);
  if (jsonTyp !== 0x4e4f534a) throw new Error('glb: erster Chunk ist kein JSON-Chunk.');
  if (jsonLaenge % 4 !== 0) throw new Error('glb: JSON-Chunk nicht auf 4 Byte ausgerichtet.');
  const jsonText = daten.subarray(20, 20 + jsonLaenge).toString('utf8');
  const json = JSON.parse(jsonText) as Record<string, unknown>;
  let binLaenge = 0;
  const binStart = 20 + jsonLaenge;
  if (binStart < daten.length) {
    binLaenge = daten.readUInt32LE(binStart);
    const binTyp = daten.readUInt32LE(binStart + 4);
    if (binTyp !== 0x004e4942) throw new Error('glb: zweiter Chunk ist kein BIN-Chunk.');
    if (binLaenge % 4 !== 0) throw new Error('glb: BIN-Chunk nicht auf 4 Byte ausgerichtet.');
    if (binStart + 8 + binLaenge !== daten.length) throw new Error('glb: BIN-Chunk-Laenge passt nicht.');
  }
  return { version, gesamtLaenge, jsonLaenge, binLaenge, json };
}
