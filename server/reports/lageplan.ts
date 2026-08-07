/**
 * Massstaeblicher Lageplan als PDF-Vektorzeichnung (Lastenheft F10.2).
 *
 * Der Plan ist WIRKLICH massstaeblich: jede Strecke wird aus den amtlichen
 * UTM32-Metern in Punkte umgerechnet, nie aus Bildschirm- oder Bildpixeln.
 *
 *   1 pt      = 1/72 Zoll = 25,4/72 mm
 *   1 m real  = (1000 / massstab) mm auf dem Papier
 *             = (1000 / massstab) / 25,4 * 72 pt
 *
 * Bei 1:1000 ergibt das 2,8346 pt je Meter — die Zahl wird gerechnet, nicht
 * eingetragen.
 *
 * "Oben" ist Gitternord (UTM 32N). Der Nordpfeil wird um die
 * Meridiankonvergenz gedreht und zeigt damit auf geografisch Nord.
 */

import type {
  BBox,
  Blockflaeche,
  BlockflaechenTyp,
  Einsatzstation,
  Gelaende,
  ObjektInstanz,
  ObjektKategorie,
  ObjektTyp,
  ProjektInhalt,
  Punkt,
  Ring,
  StationsKategorie,
  Weg,
  WegeTyp,
} from '../../shared/domain/types.ts';
import {
  BLOCK_TYP_LABEL,
  KATEGORIE_LABEL,
  STATION_FARBE,
  STATION_LABEL,
  WEGE_TYP_FARBE,
  WEGE_TYP_LABEL,
} from '../../shared/domain/types.ts';
import { grundriss } from '../../shared/domain/objekte.ts';
import {
  bboxErweitern,
  bboxMitte,
  bboxVonPunkten,
  gegenUhrzeiger,
  polylinieLaenge,
  aufPolylinie,
  schwerpunkt,
  wegKorridor,
  zahl,
} from '../../shared/geo/geometry.ts';
import { meridiankonvergenz } from '../../shared/geo/proj.ts';
import polygonClipping from 'polygon-clipping';
import type { Dok } from './pdf-basis.ts';
import {
  A3_BREITE,
  A3_HOEHE,
  FARBEN,
  FUSS_HOEHE,
  alsBuffer,
  datumDeutsch,
  neuesDokumentFormat,
} from './pdf-basis.ts';

// ---------------------------------------------------------------------------
// Massstab
// ---------------------------------------------------------------------------

export type Massstab = 250 | 500 | 1000;
export const MASSSTAEBE: Massstab[] = [250, 500, 1000];

/** Punkte je Meter Realitaet — die eine Umrechnung, aus der alles folgt. */
export function ptJeMeter(massstab: number): number {
  const mmJeMeter = 1000 / massstab;
  return (mmJeMeter / 25.4) * 72;
}

/** Groesster (naechster) Massstab, in dem das Gebiet noch auf die Flaeche passt. */
export function passenderMassstab(gebiet: BBox, breitePt: number, hoehePt: number): Massstab {
  for (const m of MASSSTAEBE) {
    const s = ptJeMeter(m);
    if ((gebiet.maxE - gebiet.minE) * s <= breitePt && (gebiet.maxN - gebiet.minN) * s <= hoehePt) return m;
  }
  return 1000;
}

// ---------------------------------------------------------------------------
// Farben und Kuerzel
// ---------------------------------------------------------------------------

const GEBAEUDE_FUELLUNG = '#e3e6e9';
const GEBAEUDE_RAND = '#adb3ba';

const BLOCK_FARBE: Record<BlockflaechenTyp, string> = {
  gesperrt: '#b0392c',
  nicht_bebaubar: '#8a6d3b',
  nur_einsatzkraefte: '#2f6fd0',
};

const STATION_KUERZEL: Record<StationsKategorie, string> = {
  sanitaet: 'SAN',
  feuerwehr: 'FW',
  polizei: 'POL',
  ordnungsdienst: 'OD',
  einsatzleitung: 'EL',
  sammelplatz: 'SP',
  loeschwasser: 'LW',
  notausgangspunkt: 'NA',
};

// ---------------------------------------------------------------------------
// Schnittstelle
// ---------------------------------------------------------------------------

export interface LageplanOpts {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  massstab: Massstab;
  titel: string;
  untertitel?: string;
  hervorheben?: { ring: Ring; farbe: string; text?: string }[];
}

export interface PlanBereich {
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  /** Kartenausschnitt (EPSG:25832). Ohne Angabe wird der Projektinhalt zentriert. */
  ausschnitt?: BBox;
  zeigeLegende?: boolean;
  zeigeMassstab?: boolean;
  zeigeNordpfeil?: boolean;
  zeigeTitelblock?: boolean;
  zeigeRahmen?: boolean;
}

interface Abbildung {
  /** pt je Meter. */
  s: number;
  /** Weltpunkt (E, N) -> Papierpunkt (x, y). N zeigt nach oben, PDF-y nach unten. */
  np: (p: Punkt) => [number, number];
}

// ---------------------------------------------------------------------------
// Ausdehnung des Inhalts
// ---------------------------------------------------------------------------

export function inhaltsBbox(o: Pick<LageplanOpts, 'inhalt' | 'typen' | 'gelaende' | 'hervorheben'>): BBox | null {
  const pts: Punkt[] = [];
  for (const obj of o.inhalt.objekte) {
    const typ = o.typen.get(obj.typId);
    if (typ) pts.push(...grundriss(typ, obj));
    else pts.push(obj.position);
  }
  for (const w of o.inhalt.wege) {
    const h = w.breite / 2;
    for (const p of w.polylinie) {
      pts.push([p[0] - h, p[1] - h]);
      pts.push([p[0] + h, p[1] + h]);
    }
  }
  for (const b of o.inhalt.blockflaechen) pts.push(...b.polygon);
  for (const st of o.inhalt.einsatzstationen) {
    if (st.punkt) pts.push(st.punkt);
    if (st.polygon) pts.push(...st.polygon);
  }
  for (const h of o.hervorheben ?? []) pts.push(...h.ring);
  if (!pts.length) return o.gelaende ? o.gelaende.bbox : null;
  return bboxErweitern(bboxVonPunkten(pts), 4);
}

// ---------------------------------------------------------------------------
// Zeichenprimitive
// ---------------------------------------------------------------------------

function pfadRing(doc: Dok, ring: Ring, ab: Abbildung): void {
  if (ring.length < 2) return;
  const p0 = ab.np(ring[0]);
  doc.moveTo(p0[0], p0[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = ab.np(ring[i]);
    doc.lineTo(p[0], p[1]);
  }
  doc.closePath();
}

function pfadLinie(doc: Dok, linie: Punkt[], ab: Abbildung): void {
  if (linie.length < 2) return;
  const p0 = ab.np(linie[0]);
  doc.moveTo(p0[0], p0[1]);
  for (let i = 1; i < linie.length; i++) {
    const p = ab.np(linie[i]);
    doc.lineTo(p[0], p[1]);
  }
}

function papierBbox(ring: Ring, ab: Abbildung): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    const q = ab.np(p);
    if (q[0] < x0) x0 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[0] > x1) x1 = q[0];
    if (q[1] > y1) y1 = q[1];
  }
  return { x0, y0, x1, y1 };
}

/** 45-Grad-Schraffur innerhalb eines Rings. */
function schraffur(doc: Dok, ring: Ring, ab: Abbildung, farbe: string, abstandPt = 5): void {
  const b = papierBbox(ring, ab);
  if (!Number.isFinite(b.x0)) return;
  doc.save();
  pfadRing(doc, ring, ab);
  doc.clip();
  doc.lineWidth(0.45).strokeColor(farbe).strokeOpacity(0.55);
  const schritt = abstandPt * Math.SQRT2;
  const von = b.x0 + b.y0;
  const bis = b.x1 + b.y1;
  for (let c = von; c <= bis; c += schritt) {
    doc.moveTo(c - b.y1, b.y1).lineTo(c - b.y0, b.y0);
  }
  doc.stroke();
  doc.restore();
}

function pfeilspitze(doc: Dok, x: number, y: number, dx: number, dy: number, groesse: number, farbe: string): void {
  const nx = -dy;
  const ny = dx;
  doc.save();
  doc
    .moveTo(x + dx * groesse, y + dy * groesse)
    .lineTo(x - dx * groesse * 0.5 + nx * groesse * 0.62, y - dy * groesse * 0.5 + ny * groesse * 0.62)
    .lineTo(x - dx * groesse * 0.5 - nx * groesse * 0.62, y - dy * groesse * 0.5 - ny * groesse * 0.62)
    .closePath()
    .fill(farbe);
  doc.restore();
}

// ---------------------------------------------------------------------------
// Karteninhalt
// ---------------------------------------------------------------------------

function zeichneGebaeude(doc: Dok, gelaende: Gelaende | null, ab: Abbildung, sicht: BBox): void {
  if (!gelaende) return;
  doc.save();
  doc.lineWidth(0.4).strokeColor(GEBAEUDE_RAND).fillColor(GEBAEUDE_FUELLUNG);
  for (const g of gelaende.gebaeude) {
    if (g.grundriss.length < 3) continue;
    const bb = bboxVonPunkten(g.grundriss);
    if (bb.maxE < sicht.minE || bb.minE > sicht.maxE || bb.maxN < sicht.minN || bb.minN > sicht.maxN) continue;
    pfadRing(doc, g.grundriss, ab);
    doc.fillAndStroke(GEBAEUDE_FUELLUNG, GEBAEUDE_RAND);
  }
  doc.restore();
}

function zeichneBlockflaeche(doc: Dok, b: Blockflaeche, ab: Abbildung): void {
  if (b.polygon.length < 3) return;
  const farbe = BLOCK_FARBE[b.typ] ?? FARBEN.grau;
  doc.save();
  doc.fillOpacity(0.1).fillColor(farbe);
  pfadRing(doc, b.polygon, ab);
  doc.fill();
  doc.restore();
  schraffur(doc, b.polygon, ab, farbe, 5);
  doc.save();
  doc.lineWidth(0.8).strokeColor(farbe).dash(3, { space: 2 });
  pfadRing(doc, b.polygon, ab);
  doc.stroke();
  doc.undash();
  doc.restore();
}

/**
 * Wegkorridor als EINE Flaeche. wegKorridor() liefert je Segment ein Rechteck
 * plus Kappen an den Knicken; erst die Vereinigung ergibt eine Randlinie, die
 * die tatsaechliche Wegbreite zeigt. Schlaegt die Vereinigung fehl, wird ohne
 * Randlinie gefuellt — gezeichnet wird immer.
 */
function korridorFlaechen(w: Weg): Ring[][] {
  const teile = wegKorridor(w.polylinie, w.breite).map(gegenUhrzeiger);
  if (!teile.length) return [];
  try {
    const geoms = teile.map((r) => [r.map((p) => [p[0], p[1]] as [number, number])]);
    const ersteGeom = geoms[0] as unknown as Parameters<typeof polygonClipping.union>[0];
    const weitere = geoms.slice(1) as unknown as Parameters<typeof polygonClipping.union>[0][];
    const erg = polygonClipping.union(ersteGeom, ...weitere);
    return erg as unknown as Ring[][];
  } catch {
    return teile.map((r) => [r]);
  }
}

function zeichneWeg(doc: Dok, w: Weg, ab: Abbildung): void {
  if (w.polylinie.length < 2) return;
  const farbe = WEGE_TYP_FARBE[w.typ] ?? FARBEN.blau;
  const flaechen = korridorFlaechen(w);

  if (flaechen.length) {
    // Ein einziger Fuellvorgang: Ueberlappungen dunkeln damit nicht nach.
    doc.save();
    doc.fillOpacity(0.2).fillColor(farbe);
    for (const poly of flaechen) for (const r of poly) pfadRing(doc, r, ab);
    doc.fill();
    doc.restore();
    doc.save();
    doc.lineWidth(0.6).strokeColor(farbe).strokeOpacity(0.85);
    for (const poly of flaechen) for (const r of poly) pfadRing(doc, r, ab);
    doc.stroke();
    doc.restore();
  }

  // Mittellinie gestrichelt
  doc.save();
  doc.lineWidth(0.9).strokeColor(farbe).dash(4, { space: 3 });
  pfadLinie(doc, w.polylinie, ab);
  doc.stroke();
  doc.undash();
  doc.restore();

  // Laufrichtungspfeile
  if (w.richtung !== 'beide') {
    const gesamt = polylinieLaenge(w.polylinie);
    if (gesamt > 1) {
      const anzahl = Math.max(1, Math.min(12, Math.floor(gesamt / 12)));
      for (let i = 1; i <= anzahl; i++) {
        const s = (gesamt * i) / (anzahl + 1);
        const a = aufPolylinie(w.polylinie, s);
        const vor = w.richtung === 'rueckwaerts' ? -1 : 1;
        const p = ab.np(a.p);
        // Weltrichtung in Papierrichtung: E nach rechts, N nach oben
        let dx = a.richtung[0] * vor;
        let dy = -a.richtung[1] * vor;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        pfeilspitze(doc, p[0], p[1], dx, dy, 4.2, farbe);
      }
    }
  }
}

function zeichneObjekt(
  doc: Dok,
  inst: ObjektInstanz,
  typ: ObjektTyp | undefined,
  ab: Abbildung,
  mitNummer: boolean,
): void {
  const farbe = typ?.farbe ?? '#9aa0a6';
  const ring: Ring = typ ? grundriss(typ, inst) : [];
  if (ring.length < 3) {
    const p = ab.np(inst.position);
    doc.save();
    doc.circle(p[0], p[1], 2.5).fillAndStroke(farbe, '#33383d');
    doc.restore();
    return;
  }
  doc.save();
  doc.fillOpacity(0.9).lineWidth(0.5);
  pfadRing(doc, ring, ab);
  doc.fillAndStroke(farbe, '#33383d');
  doc.restore();

  if (mitNummer && inst.standNummer) {
    const b = papierBbox(ring, ab);
    const bb = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    if (bb >= 13 && bh >= 7) {
      const groesse = Math.max(4.5, Math.min(7.5, bh * 0.55));
      doc.save();
      doc.font('Helvetica-Bold').fontSize(groesse).fillColor('#1a1d21');
      doc.text(inst.standNummer, b.x0, (b.y0 + b.y1) / 2 - groesse * 0.62, {
        width: bb,
        align: 'center',
        lineBreak: false,
      });
      doc.restore();
    }
  }
}

function zeichneStation(doc: Dok, st: Einsatzstation, ab: Abbildung, mitName: boolean): void {
  const farbe = STATION_FARBE[st.kategorie] ?? FARBEN.blau;
  if (st.polygon && st.polygon.length >= 3) {
    doc.save();
    doc.fillOpacity(0.14).fillColor(farbe);
    pfadRing(doc, st.polygon, ab);
    doc.fill();
    doc.restore();
    doc.save();
    doc.lineWidth(0.8).strokeColor(farbe);
    pfadRing(doc, st.polygon, ab);
    doc.stroke();
    doc.restore();
  }
  const welt = st.punkt ?? (st.polygon && st.polygon.length >= 3 ? schwerpunkt(st.polygon) : null);
  if (!welt) return;
  const p = ab.np(welt);
  const r = 7;
  doc.save();
  doc.lineWidth(0.8);
  doc.circle(p[0], p[1], r).fillAndStroke(farbe, FARBEN.weiss);
  doc.font('Helvetica-Bold').fontSize(4.8).fillColor(FARBEN.weiss);
  doc.text(STATION_KUERZEL[st.kategorie] ?? '?', p[0] - r, p[1] - 2.4, {
    width: 2 * r,
    align: 'center',
    lineBreak: false,
  });
  doc.restore();
  if (mitName && st.name) {
    doc.save();
    doc.font('Helvetica').fontSize(5.5).fillColor('#33383d');
    doc.text(st.name, p[0] + r + 2, p[1] - 3, { width: 90, lineBreak: false, ellipsis: true });
    doc.restore();
  }
}

function zeichneHervorhebung(doc: Dok, h: { ring: Ring; farbe: string; text?: string }, ab: Abbildung): void {
  if (h.ring.length < 2) return;
  doc.save();
  doc.lineWidth(1.8).strokeColor(h.farbe).lineJoin('round');
  if (h.ring.length === 2) pfadLinie(doc, h.ring, ab);
  else pfadRing(doc, h.ring, ab);
  doc.stroke();
  doc.restore();
  if (h.text) {
    const b = papierBbox(h.ring, ab);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(6.5);
    const tb = Math.min(150, doc.widthOfString(h.text) + 6);
    const tx = (b.x0 + b.x1) / 2 - tb / 2;
    const ty = b.y0 - 12;
    doc.fillOpacity(0.92).lineWidth(0.6);
    doc.rect(tx, ty, tb, 10).fillAndStroke(FARBEN.weiss, h.farbe);
    doc.fillOpacity(1).fillColor(h.farbe);
    doc.text(h.text, tx + 3, ty + 2.4, { width: tb - 6, lineBreak: false, ellipsis: true });
    doc.restore();
  }
}

// ---------------------------------------------------------------------------
// Randelemente: Massstabsleiste, Nordpfeil
// ---------------------------------------------------------------------------

function massstabsleiste(doc: Dok, x: number, y: number, s: number, massstab: number): void {
  const kandidaten = [5, 10, 20, 50, 100, 200, 500];
  let laengeM = kandidaten[0];
  for (const k of kandidaten) if (k * s <= 150) laengeM = k;
  const laengePt = laengeM * s;
  const hoehe = 5;
  const abschnitte = 4;
  const teil = laengePt / abschnitte;

  doc.save();
  doc.fillOpacity(0.85);
  doc.rect(x - 6, y - 16, laengePt + 36, hoehe + 32).fill(FARBEN.weiss);
  doc.restore();

  doc.save();
  doc.lineWidth(0.5).strokeColor(FARBEN.schwarz);
  for (let i = 0; i < abschnitte; i++) {
    doc.rect(x + i * teil, y, teil, hoehe);
    doc.fillAndStroke(i % 2 === 0 ? FARBEN.schwarz : FARBEN.weiss, FARBEN.schwarz);
  }
  doc.font('Helvetica').fontSize(5.8).fillColor(FARBEN.schwarz);
  doc.text('0', x - 4, y - 9, { width: 8, align: 'center', lineBreak: false });
  doc.text(`${zahl(laengeM / 2, 0)}`, x + laengePt / 2 - 10, y - 9, { width: 20, align: 'center', lineBreak: false });
  doc.text(`${zahl(laengeM, 0)} m`, x + laengePt - 12, y - 9, { width: 26, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(FARBEN.schwarz);
  doc.text(`M 1:${massstab}`, x, y + hoehe + 3, { width: laengePt + 24, lineBreak: false });
  doc.restore();
}

function nordpfeil(doc: Dok, cx: number, cy: number, konvergenzGrad: number): void {
  doc.save();
  doc.fillOpacity(0.85);
  doc.rect(cx - 55, cy - 34, 110, 70).fill(FARBEN.weiss);
  doc.restore();

  doc.save();
  // "Oben" ist Gitternord. Geografisch Nord liegt im Gitter bei -konvergenz
  // (im Uhrzeigersinn von oben gemessen) — der Pfeil wird also um -konvergenz
  // gedreht und zeigt danach auf geografisch Nord. Numerisch gegen proj4
  // geprueft: oestlich des Hauptmeridians 9° dreht er nach links.
  doc.rotate(-konvergenzGrad, { origin: [cx, cy] });
  doc.lineWidth(1).strokeColor(FARBEN.schwarz);
  doc.moveTo(cx, cy + 17).lineTo(cx, cy - 6).stroke();
  doc
    .moveTo(cx, cy - 18)
    .lineTo(cx - 4.5, cy - 5)
    .lineTo(cx + 4.5, cy - 5)
    .closePath()
    .fill(FARBEN.schwarz);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(FARBEN.schwarz);
  doc.text('N', cx - 8, cy - 31, { width: 16, align: 'center', lineBreak: false });
  doc.restore();

  doc.save();
  doc.font('Helvetica').fontSize(4.4).fillColor(FARBEN.grau);
  doc.text('Gitternord UTM32', cx - 54, cy + 22, { width: 108, align: 'center', lineBreak: false });
  doc.text(`Meridiankonvergenz ${zahl(konvergenzGrad, 2)}°`, cx - 54, cy + 28, {
    width: 108,
    align: 'center',
    lineBreak: false,
  });
  doc.restore();
}

// ---------------------------------------------------------------------------
// Legende
// ---------------------------------------------------------------------------

interface LegendenEintrag {
  art: 'flaeche' | 'linie' | 'kreis';
  farbe: string;
  text: string;
  detail?: string;
}

function legendenEintraege(o: LageplanOpts): { titel: string; eintraege: LegendenEintrag[] }[] {
  const gruppen: { titel: string; eintraege: LegendenEintrag[] }[] = [];

  // Wege
  const wegeTypen = new Map<WegeTyp, Weg[]>();
  for (const w of o.inhalt.wege) {
    const liste = wegeTypen.get(w.typ) ?? [];
    liste.push(w);
    wegeTypen.set(w.typ, liste);
  }
  if (wegeTypen.size) {
    const eintraege: LegendenEintrag[] = [];
    for (const [typ, liste] of wegeTypen) {
      const breiten = liste.map((w) => w.breite);
      const min = Math.min(...breiten);
      const max = Math.max(...breiten);
      eintraege.push({
        art: 'flaeche',
        farbe: WEGE_TYP_FARBE[typ],
        text: WEGE_TYP_LABEL[typ],
        detail: `${liste.length} St., Breite ${min === max ? `${zahl(min)} m` : `${zahl(min)}-${zahl(max)} m`}`,
      });
    }
    gruppen.push({ titel: 'Wege und Flaechen', eintraege });
  }

  // Objekte nach Kategorie, darin nach Typ
  const nachKategorie = new Map<ObjektKategorie, Map<string, { typ: ObjektTyp; anzahl: number }>>();
  let ohneTyp = 0;
  for (const inst of o.inhalt.objekte) {
    const typ = o.typen.get(inst.typId);
    if (!typ) {
      ohneTyp += 1;
      continue;
    }
    const m = nachKategorie.get(typ.kategorie) ?? new Map<string, { typ: ObjektTyp; anzahl: number }>();
    const e = m.get(typ.id) ?? { typ, anzahl: 0 };
    e.anzahl += 1;
    m.set(typ.id, e);
    nachKategorie.set(typ.kategorie, m);
  }
  for (const [kat, m] of nachKategorie) {
    const eintraege: LegendenEintrag[] = [];
    for (const e of m.values()) {
      eintraege.push({ art: 'flaeche', farbe: e.typ.farbe, text: e.typ.name, detail: `${e.anzahl} St.` });
    }
    eintraege.sort((a, b) => a.text.localeCompare(b.text, 'de'));
    gruppen.push({ titel: KATEGORIE_LABEL[kat], eintraege });
  }
  if (ohneTyp > 0) {
    gruppen.push({
      titel: 'Ohne Typzuordnung',
      eintraege: [{ art: 'kreis', farbe: '#9aa0a6', text: 'Objekttyp unbekannt', detail: `${ohneTyp} St. — k. A.` }],
    });
  }

  // Einsatzstationen
  const stationen = new Map<StationsKategorie, number>();
  for (const st of o.inhalt.einsatzstationen) stationen.set(st.kategorie, (stationen.get(st.kategorie) ?? 0) + 1);
  if (stationen.size) {
    const eintraege: LegendenEintrag[] = [];
    for (const [kat, n] of stationen) {
      eintraege.push({
        art: 'kreis',
        farbe: STATION_FARBE[kat],
        text: `${STATION_LABEL[kat]} (${STATION_KUERZEL[kat]})`,
        detail: `${n} St.`,
      });
    }
    gruppen.push({ titel: 'Einsatzstationen', eintraege });
  }

  // Blockflaechen
  const bloecke = new Map<BlockflaechenTyp, number>();
  for (const b of o.inhalt.blockflaechen) bloecke.set(b.typ, (bloecke.get(b.typ) ?? 0) + 1);
  if (bloecke.size) {
    const eintraege: LegendenEintrag[] = [];
    for (const [typ, n] of bloecke) {
      eintraege.push({ art: 'flaeche', farbe: BLOCK_FARBE[typ], text: BLOCK_TYP_LABEL[typ], detail: `${n} St.` });
    }
    gruppen.push({ titel: 'Blockflaechen', eintraege });
  }

  if (o.gelaende && o.gelaende.gebaeude.length) {
    gruppen.push({
      titel: 'Bestand',
      eintraege: [
        {
          art: 'flaeche',
          farbe: GEBAEUDE_FUELLUNG,
          text: 'Bestandsgebaeude',
          detail: `${o.gelaende.gebaeude.length} St.`,
        },
      ],
    });
  }

  if (o.hervorheben && o.hervorheben.length) {
    gruppen.push({
      titel: 'Kennzeichnung',
      eintraege: o.hervorheben.slice(0, 6).map((h) => ({
        art: 'linie' as const,
        farbe: h.farbe,
        text: h.text ?? 'Beanstandung',
      })),
    });
  }

  return gruppen;
}

function zeichneLegende(doc: Dok, x: number, y: number, breite: number, maxY: number, o: LageplanOpts): void {
  const gruppen = legendenEintraege(o);
  let cy = y;
  doc.save();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(FARBEN.dunkelblau);
  doc.text('Legende', x, cy, { width: breite, lineBreak: false });
  cy += 12;

  for (const g of gruppen) {
    if (cy + 22 > maxY) break;
    doc.font('Helvetica-Bold').fontSize(6.6).fillColor(FARBEN.grau);
    doc.text(g.titel.toUpperCase(), x, cy, { width: breite, lineBreak: false, ellipsis: true });
    cy += 9;
    for (const e of g.eintraege) {
      if (cy + 11 > maxY) {
        doc.font('Helvetica-Oblique').fontSize(6).fillColor(FARBEN.grau);
        doc.text('... weitere Eintraege siehe Bericht', x, cy, { width: breite, lineBreak: false });
        doc.restore();
        return;
      }
      if (e.art === 'flaeche') {
        doc.save();
        doc.lineWidth(0.4).fillOpacity(0.75);
        doc.rect(x, cy + 1, 11, 7).fillAndStroke(e.farbe, '#5a6068');
        doc.restore();
      } else if (e.art === 'kreis') {
        doc.save();
        doc.lineWidth(0.5);
        doc.circle(x + 5.5, cy + 4.5, 4).fillAndStroke(e.farbe, FARBEN.weiss);
        doc.restore();
      } else {
        doc.save();
        doc.lineWidth(1.8).strokeColor(e.farbe);
        doc.moveTo(x, cy + 4.5).lineTo(x + 11, cy + 4.5).stroke();
        doc.restore();
      }
      doc.font('Helvetica').fontSize(6.6).fillColor(FARBEN.schwarz);
      doc.text(e.text, x + 15, cy + 1.4, { width: breite - 15 - 58, lineBreak: false, ellipsis: true });
      if (e.detail) {
        doc.font('Helvetica').fontSize(6).fillColor(FARBEN.grau);
        doc.text(e.detail, x + breite - 58, cy + 1.6, { width: 58, align: 'right', lineBreak: false });
      }
      cy += 10;
    }
    cy += 4;
  }
  doc.restore();
}

// ---------------------------------------------------------------------------
// Titelblock
// ---------------------------------------------------------------------------

function quellenZeilen(gelaende: Gelaende | null): string[] {
  if (!gelaende || !gelaende.quellennachweis.length) return ['Quellen: k. A.'];
  const gesehen = new Set<string>();
  const out: string[] = [];
  for (const q of gelaende.quellennachweis) {
    const t = `${q.quellenvermerk} (${q.datensatz}, abgerufen ${datumDeutsch(q.abgerufenAm)})`;
    if (gesehen.has(t)) continue;
    gesehen.add(t);
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

function titelblockHoehe(doc: Dok, breite: number, o: LageplanOpts, gelaende: Gelaende | null, warnung: string | null): number {
  doc.font('Helvetica').fontSize(5.2);
  let h = 84;
  if (o.untertitel) h += 10;
  if (warnung) h += 14;
  for (const z of quellenZeilen(gelaende)) h += doc.heightOfString(z, { width: breite - 12 }) + 1.5;
  return h + 10;
}

function zeichneTitelblock(
  doc: Dok,
  x: number,
  y: number,
  breite: number,
  hoehe: number,
  o: LageplanOpts,
  warnung: string | null,
): void {
  doc.save();
  doc.lineWidth(0.8);
  doc.rect(x, y, breite, hoehe).fillAndStroke(FARBEN.weiss, FARBEN.dunkelblau);
  let cy = y + 7;
  const ix = x + 6;
  const ib = breite - 12;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(FARBEN.dunkelblau);
  doc.text(o.titel, ix, cy, { width: ib, ellipsis: true, lineBreak: false });
  cy += 12;
  if (o.untertitel) {
    doc.font('Helvetica').fontSize(7).fillColor(FARBEN.grau);
    doc.text(o.untertitel, ix, cy, { width: ib, ellipsis: true, lineBreak: false });
    cy += 10;
  }
  doc.moveTo(ix, cy).lineTo(ix + ib, cy).lineWidth(0.4).strokeColor(FARBEN.hellgrau).stroke();
  cy += 5;

  const zeile = (feld: string, wert: string) => {
    doc.font('Helvetica').fontSize(6).fillColor(FARBEN.grau);
    doc.text(feld, ix, cy, { width: 62, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(6.4).fillColor(FARBEN.schwarz);
    doc.text(wert, ix + 62, cy, { width: ib - 62, lineBreak: false, ellipsis: true });
    cy += 9;
  };
  zeile('Massstab', `M 1:${o.massstab}`);
  zeile('Datum', datumDeutsch(new Date().toISOString()));
  zeile('Koordinaten', 'ETRS89 / UTM 32N (EPSG:25832)');
  zeile('Einheit', 'Meter — alle Masse aus amtlicher Geometrie');

  if (warnung) {
    doc.font('Helvetica-Bold').fontSize(6.2).fillColor(FARBEN.orange);
    doc.text(warnung, ix, cy, { width: ib });
    cy = doc.y + 3;
  }

  cy += 2;
  doc.font('Helvetica-Bold').fontSize(5.6).fillColor(FARBEN.grau);
  doc.text('QUELLENVERMERKE', ix, cy, { width: ib, lineBreak: false });
  cy += 7;
  doc.font('Helvetica').fontSize(5.2).fillColor(FARBEN.grau);
  for (const z of quellenZeilen(o.gelaende)) {
    doc.text(z, ix, cy, { width: ib });
    cy = doc.y + 1.5;
  }
  doc.restore();
}

// ---------------------------------------------------------------------------
// Hauptzeichenroutine
// ---------------------------------------------------------------------------

export function zeichnePlan(doc: Dok, o: LageplanOpts & PlanBereich): void {
  // Absolute Platzierung: der untere Seitenrand darf hier keinen Umbruch
  // ausloesen, weil unterhalb des Satzspiegels gezeichnet wird.
  const randMerk = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const merkX = doc.x;
  const merkY = doc.y;

  const zeigeLegende = o.zeigeLegende ?? false;
  const zeigeTitelblock = o.zeigeTitelblock ?? zeigeLegende;
  const streifen = zeigeLegende || zeigeTitelblock ? Math.min(210, o.breite * 0.4) : 0;
  const luecke = streifen > 0 ? 10 : 0;

  const zx = o.x;
  const zy = o.y;
  const zb = o.breite - streifen - luecke;
  const zh = o.hoehe;

  const s = ptJeMeter(o.massstab);
  const gebiet = o.ausschnitt ?? inhaltsBbox(o);
  const mitte: Punkt = gebiet ? bboxMitte(gebiet) : [0, 0];
  const ab: Abbildung = {
    s,
    np: (p: Punkt) => [zx + zb / 2 + (p[0] - mitte[0]) * s, zy + zh / 2 - (p[1] - mitte[1]) * s],
  };

  const passt = gebiet ? (gebiet.maxE - gebiet.minE) * s <= zb && (gebiet.maxN - gebiet.minN) * s <= zh : true;
  const warnung = passt ? null : 'Ausschnitt — Gebiet groesser als Blatt';

  // Sichtfenster in Weltkoordinaten (fuer den Vorfilter der Bestandsgebaeude)
  const halbE = zb / 2 / s;
  const halbN = zh / 2 / s;
  const sicht: BBox = {
    minE: mitte[0] - halbE,
    maxE: mitte[0] + halbE,
    minN: mitte[1] - halbN,
    maxN: mitte[1] + halbN,
  };

  // Blatt- bzw. Zeichenflaechenrahmen
  if (o.zeigeRahmen !== false) {
    doc.save();
    doc.lineWidth(0.7);
    doc.rect(zx, zy, zb, zh).fillAndStroke('#fbfcfd', FARBEN.hellgrau);
    doc.restore();
  }

  // --- Karteninhalt, hart auf die Zeichenflaeche beschnitten ---------------
  doc.save();
  doc.rect(zx, zy, zb, zh).clip();

  zeichneGebaeude(doc, o.gelaende, ab, sicht);
  for (const b of o.inhalt.blockflaechen) zeichneBlockflaeche(doc, b, ab);
  for (const w of o.inhalt.wege) zeichneWeg(doc, w, ab);
  for (const inst of o.inhalt.objekte) zeichneObjekt(doc, inst, o.typen.get(inst.typId), ab, true);
  for (const st of o.inhalt.einsatzstationen) zeichneStation(doc, st, ab, zeigeLegende);
  for (const h of o.hervorheben ?? []) zeichneHervorhebung(doc, h, ab);

  doc.restore();

  // --- Randelemente --------------------------------------------------------
  if (o.zeigeMassstab !== false) {
    massstabsleiste(doc, zx + 12, zy + zh - 24, s, o.massstab);
  }
  if (o.zeigeNordpfeil !== false) {
    nordpfeil(doc, zx + zb - 60, zy + 40, meridiankonvergenz(mitte));
  }

  if (streifen > 0) {
    const sx = zx + zb + luecke;
    const tbHoehe = zeigeTitelblock ? titelblockHoehe(doc, streifen, o, o.gelaende, warnung) : 0;
    if (zeigeLegende) {
      zeichneLegende(doc, sx, zy, streifen, zy + zh - tbHoehe - 12, o);
    }
    if (zeigeTitelblock) {
      zeichneTitelblock(doc, sx, zy + zh - tbHoehe, streifen, tbHoehe, o, warnung);
    }
  } else if (warnung) {
    doc.save();
    doc.font('Helvetica-Bold').fontSize(6).fillColor(FARBEN.orange);
    doc.text(warnung, zx + 6, zy + 6, { width: zb - 12, lineBreak: false });
    doc.restore();
  }

  doc.page.margins.bottom = randMerk;
  doc.x = merkX;
  doc.y = merkY;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

// ---------------------------------------------------------------------------
// A3-Planblatt
// ---------------------------------------------------------------------------

export async function lageplanPdf(o: LageplanOpts): Promise<Buffer> {
  const rand = 40;
  const doc = neuesDokumentFormat({ titel: o.titel, breite: A3_HOEHE, hoehe: A3_BREITE, rand });
  zeichnePlan(doc, {
    ...o,
    x: rand,
    y: rand,
    breite: A3_HOEHE - 2 * rand,
    // Unterer Rand ist rand + FUSS_HOEHE: die Fusszeile wird in alsBuffer()
    // ZULETZT gestempelt und laege sonst mitten im Titelblock des Plans.
    hoehe: A3_BREITE - 2 * rand - FUSS_HOEHE,
    zeigeLegende: true,
    zeigeMassstab: true,
    zeigeNordpfeil: true,
    zeigeTitelblock: true,
    zeigeRahmen: true,
  });
  return alsBuffer(doc);
}
