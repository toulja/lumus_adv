/**
 * Gemeinsame PDF-Bausteine fuer alle Berichte (Lastenheft F10).
 *
 * Grundsatz: Jede Zahl im PDF stammt aus dem Geometrie-Kern bzw. der
 * Regel-Engine — hier wird ausschliesslich gesetzt und gezeichnet, nie
 * gerechnet oder geschaetzt. Nicht vorhandene Angaben heissen "k. A.".
 *
 * Schriften: bewusst nur die eingebauten Standardschriften Helvetica und
 * Helvetica-Bold. Sie werden von pdfkit in WinAnsi kodiert und tragen damit
 * die deutschen Umlaute, das scharfe s und die Anfuehrungszeichen ohne
 * eingebettete Schriftdatei.
 */

import PDFDocument from 'pdfkit';

/** Kurzname fuer den pdfkit-Dokumenttyp. */
export type Dok = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Farben und Blattmasse
// ---------------------------------------------------------------------------

export const FARBEN = {
  dunkelblau: '#16324f',
  blau: '#2f6fd0',
  grau: '#6b7280',
  hellgrau: '#d8dde4',
  sehrhell: '#f1f3f6',
  rot: '#c0392b',
  orange: '#d97a10',
  gruen: '#2e7d4f',
  schwarz: '#1a1d21',
  weiss: '#ffffff',
};

/** 1 pt = 1/72 Zoll; 1 Zoll = 25,4 mm. */
export const PT_JE_MM = 72 / 25.4;

export const A4_BREITE = 210 * PT_JE_MM; // 595.28
export const A4_HOEHE = 297 * PT_JE_MM; // 841.89
export const A3_BREITE = 297 * PT_JE_MM; // 841.89
export const A3_HOEHE = 420 * PT_JE_MM; // 1190.55

export const RAND = 40;
/** Hoehe des Streifens, den die Fusszeile am unteren Blattrand belegt. */
export const FUSS_HOEHE = 22;

// ---------------------------------------------------------------------------
// Dokument
// ---------------------------------------------------------------------------

/** Freies Blattformat — Basis fuer neuesDokument() und den A3-Lageplan. */
export function neuesDokumentFormat(o: {
  titel: string;
  breite: number;
  hoehe: number;
  rand?: number;
}): Dok {
  const rand = o.rand ?? RAND;
  const doc = new PDFDocument({
    size: [o.breite, o.hoehe],
    margins: { top: rand, bottom: rand + FUSS_HOEHE, left: rand, right: rand },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: o.titel,
      Author: 'EventPlan3D',
      Creator: 'EventPlan3D',
      Producer: 'EventPlan3D / pdfkit',
      CreationDate: new Date(),
    },
  });
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
  return doc;
}

export function neuesDokument(opts: { titel: string; querformat?: boolean }): Dok {
  return neuesDokumentFormat({
    titel: opts.titel,
    breite: opts.querformat ? A4_HOEHE : A4_BREITE,
    hoehe: opts.querformat ? A4_BREITE : A4_HOEHE,
  });
}

/** Nutzbare Breite zwischen den Seitenraendern. */
export function satzBreite(doc: Dok): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Unterkante des Satzspiegels — ab hier beginnt der Fusszeilenstreifen. */
export function satzUnterkante(doc: Dok): number {
  return doc.page.height - doc.page.margins.bottom;
}

/**
 * Neue Seite im FORMAT DER AKTUELLEN SEITE.
 * doc.addPage() ohne Argumente wuerde die Dokumentvorgabe nehmen — eine
 * ueberlaufende Tabelle auf einer Querformatseite landete sonst im Hochformat.
 */
export function neueSeite(doc: Dok): void {
  doc.addPage({
    size: [doc.page.width, doc.page.height],
    margins: { ...doc.page.margins },
  });
}

/** Legt eine neue Seite an, wenn die geforderte Hoehe nicht mehr passt. */
export function platzSichern(doc: Dok, hoehe: number): void {
  if (doc.y + hoehe > satzUnterkante(doc)) neueSeite(doc);
}

// ---------------------------------------------------------------------------
// Kopf- und Fusszeile
// ---------------------------------------------------------------------------

export function kopfzeile(doc: Dok, titel: string, untertitel?: string): void {
  const x = doc.page.margins.left;
  const b = satzBreite(doc);
  const y = doc.page.margins.top;
  const h = untertitel ? 36 : 26;

  doc.save();
  doc.rect(x, y, b, h).fill(FARBEN.dunkelblau);
  doc.fillColor(FARBEN.weiss).font('Helvetica-Bold').fontSize(13);
  doc.text(titel, x + 9, y + 7, { width: b - 18, lineBreak: false, ellipsis: true });
  if (untertitel) {
    doc.font('Helvetica').fontSize(8).fillColor('#c7d3e0');
    doc.text(untertitel, x + 9, y + 23, { width: b - 18, lineBreak: false, ellipsis: true });
  }
  doc.restore();

  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
  doc.x = x;
  doc.y = y + h + 12;
}

/** Merkt sich den Fusszeilentext; gestempelt wird beim Erzeugen des Buffers. */
const FUSSTEXTE = new WeakMap<object, string>();

/**
 * Setzt den Fusszeilentext des Dokuments. Die Fusszeile (Seitenzahl,
 * Erzeugungsdatum, Text) wird erst in alsBuffer() auf ALLE Seiten gestempelt —
 * anders liesse sich die Gesamtseitenzahl nicht angeben, weil Tabellen die
 * Seiten erst beim Setzen umbrechen.
 */
export function fusszeile(doc: Dok, text: string): void {
  FUSSTEXTE.set(doc as unknown as object, text);
}

export function datumZeitDeutsch(d: Date = new Date()): string {
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function datumDeutsch(iso?: string | null): string {
  if (!iso) return 'k. A.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'k. A.';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function datumZeit(iso?: string | null): string {
  if (!iso) return 'k. A.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'k. A.';
  return datumZeitDeutsch(d);
}

function fusszeilenStempeln(doc: Dok): void {
  const text = FUSSTEXTE.get(doc as unknown as object);
  if (text === undefined) return;
  const bereich = doc.bufferedPageRange();
  const erzeugt = `Erzeugt am ${datumZeitDeutsch()}`;
  for (let i = bereich.start; i < bereich.start + bereich.count; i++) {
    doc.switchToPage(i);
    // Der untere Rand wird kurzzeitig aufgehoben, sonst loest das Setzen der
    // Fusszeile selbst einen Seitenumbruch aus.
    const merk = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const x = doc.page.margins.left;
    const b = satzBreite(doc);
    const y = doc.page.height - merk + 4;
    doc.save();
    doc
      .moveTo(x, y)
      .lineTo(x + b, y)
      .lineWidth(0.5)
      .strokeColor(FARBEN.hellgrau)
      .stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(FARBEN.grau);
    doc.text(text, x, y + 5, { width: b * 0.62, lineBreak: false, ellipsis: true });
    doc.text(`${erzeugt}   |   Seite ${i - bereich.start + 1} von ${bereich.count}`, x + b * 0.62, y + 5, {
      width: b * 0.38,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
    doc.page.margins.bottom = merk;
  }
  if (bereich.count > 0) doc.switchToPage(bereich.start + bereich.count - 1);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface AbsatzOpts {
  groesse?: number;
  farbe?: string;
  fett?: boolean;
  breite?: number;
  ausrichtung?: 'left' | 'center' | 'right' | 'justify';
  abstandDanach?: number;
  zeilenabstand?: number;
}

export function absatz(doc: Dok, text: string, opts?: AbsatzOpts): void {
  const o = opts ?? {};
  const groesse = o.groesse ?? 9;
  const breite = o.breite ?? satzBreite(doc);
  doc.font(o.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(groesse).fillColor(o.farbe ?? FARBEN.schwarz);
  const hoehe = doc.heightOfString(text, { width: breite, lineGap: o.zeilenabstand ?? 1 });
  platzSichern(doc, Math.min(hoehe, satzUnterkante(doc) - doc.page.margins.top));
  doc.text(text, doc.page.margins.left, doc.y, {
    width: breite,
    align: o.ausrichtung ?? 'left',
    lineGap: o.zeilenabstand ?? 1,
  });
  doc.y += o.abstandDanach ?? 6;
  doc.x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

/** Abschnittsueberschrift mit farbiger Grundlinie. */
export function ueberschrift(doc: Dok, text: string, stufe: 1 | 2 = 1): void {
  const groesse = stufe === 1 ? 12 : 10;
  platzSichern(doc, groesse + 22);
  const x = doc.page.margins.left;
  const b = satzBreite(doc);
  doc.font('Helvetica-Bold').fontSize(groesse).fillColor(FARBEN.dunkelblau);
  doc.text(text, x, doc.y, { width: b });
  doc.y += 3;
  if (stufe === 1) {
    doc
      .moveTo(x, doc.y)
      .lineTo(x + b, doc.y)
      .lineWidth(0.8)
      .strokeColor(FARBEN.dunkelblau)
      .stroke();
    doc.y += 8;
  } else {
    doc.y += 4;
  }
  doc.x = x;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

/** Beschriftetes Wertepaar in zwei Spalten (Deckblaetter). */
export function feldZeile(doc: Dok, feld: string, wert: string, labelBreite = 150): void {
  const x = doc.page.margins.left;
  const b = satzBreite(doc);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(FARBEN.grau);
  const h1 = doc.heightOfString(feld, { width: labelBreite - 6 });
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
  const h2 = doc.heightOfString(wert, { width: b - labelBreite });
  const h = Math.max(h1, h2) + 3;
  platzSichern(doc, h);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(FARBEN.grau);
  doc.text(feld, x, y, { width: labelBreite - 6 });
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
  doc.text(wert, x + labelBreite, y, { width: b - labelBreite });
  doc.y = y + h;
  doc.x = x;
}

/** Grau hinterlegter Kasten — traegt den Haftungshinweis. */
export function hinweisKasten(doc: Dok, text: string): void {
  const x = doc.page.margins.left;
  const b = satzBreite(doc);
  const innen = 8;
  doc.font('Helvetica').fontSize(7.5);
  const th = doc.heightOfString(text, { width: b - 2 * innen, lineGap: 1.2 });
  const h = th + 2 * innen;
  const verfuegbar = satzUnterkante(doc) - doc.page.margins.top;

  if (h > verfuegbar) {
    // Laenger als eine ganze Seite: ohne Kasten setzen, damit der Text
    // ueber den Seitenumbruch hinweg vollstaendig lesbar bleibt.
    doc.save();
    doc.rect(x, doc.y, 3, Math.min(h, satzUnterkante(doc) - doc.y)).fill(FARBEN.orange);
    doc.restore();
    doc.font('Helvetica').fontSize(7.5).fillColor('#3a3f45');
    doc.text(text, x + innen, doc.y, { width: b - 2 * innen, lineGap: 1.2, align: 'justify' });
    doc.y += 10;
    doc.x = x;
    doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
    return;
  }

  platzSichern(doc, h + 4);
  const y = doc.y;
  doc.save();
  doc.rect(x, y, b, h).fillAndStroke(FARBEN.sehrhell, FARBEN.hellgrau);
  doc.rect(x, y, 3, h).fill(FARBEN.orange);
  doc.restore();
  doc.font('Helvetica').fontSize(7.5).fillColor('#3a3f45');
  doc.text(text, x + innen, y + innen, { width: b - 2 * innen, lineGap: 1.2, align: 'justify' });
  doc.y = y + h + 10;
  doc.x = x;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

// ---------------------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------------------

export interface TabellenSpalte {
  titel: string;
  breite: number;
  ausrichtung?: 'links' | 'rechts';
}

export interface TabellenOpts {
  kopfFarbe?: string;
  groesse?: number;
  /** Zeilenweise Einfaerbung des Textes, z. B. rot fuer Verstoesse. */
  zeilenFarbe?: (zeile: string[], index: number) => string | undefined;
  /** Wechselnde Zeilenhintergruende. */
  zebra?: boolean;
  /** Startpunkt x; standardmaessig der linke Seitenrand. */
  x?: number;
}

export function tabelle(
  doc: Dok,
  spalten: TabellenSpalte[],
  zeilen: string[][],
  opts?: TabellenOpts,
): void {
  const o = opts ?? {};
  const groesse = o.groesse ?? 7.5;
  const innen = 3.5;
  const x0 = o.x ?? doc.page.margins.left;
  const gesamt = spalten.reduce((a, s) => a + s.breite, 0);

  const kopfHoehe = (): number => {
    doc.font('Helvetica-Bold').fontSize(groesse);
    let h = 0;
    for (const s of spalten) h = Math.max(h, doc.heightOfString(s.titel, { width: s.breite - 2 * innen }));
    return h + 2 * innen;
  };

  const kopfZeichnen = (): void => {
    const h = kopfHoehe();
    const y = doc.y;
    doc.save();
    doc.rect(x0, y, gesamt, h).fill(o.kopfFarbe ?? FARBEN.dunkelblau);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(groesse).fillColor(FARBEN.weiss);
    let x = x0;
    for (const s of spalten) {
      doc.text(s.titel, x + innen, y + innen, {
        width: s.breite - 2 * innen,
        align: s.ausrichtung === 'rechts' ? 'right' : 'left',
      });
      x += s.breite;
    }
    doc.y = y + h;
    doc.x = x0;
  };

  kopfZeichnen();

  let index = 0;
  for (const zeile of zeilen) {
    doc.font('Helvetica').fontSize(groesse);
    let h = 0;
    for (let i = 0; i < spalten.length; i++) {
      const zelle = zeile[i] ?? '';
      h = Math.max(h, doc.heightOfString(zelle, { width: spalten[i].breite - 2 * innen }));
    }
    h = Math.max(h + 2 * innen, 12);

    if (doc.y + h > satzUnterkante(doc)) {
      neueSeite(doc);
      kopfZeichnen();
    }

    const y = doc.y;
    if (o.zebra !== false && index % 2 === 1) {
      doc.save();
      doc.rect(x0, y, gesamt, h).fill(FARBEN.sehrhell);
      doc.restore();
    }
    const farbe = o.zeilenFarbe ? o.zeilenFarbe(zeile, index) : undefined;
    doc.font('Helvetica').fontSize(groesse).fillColor(farbe ?? FARBEN.schwarz);
    let x = x0;
    for (let i = 0; i < spalten.length; i++) {
      const s = spalten[i];
      doc.text(zeile[i] ?? '', x + innen, y + innen, {
        width: s.breite - 2 * innen,
        align: s.ausrichtung === 'rechts' ? 'right' : 'left',
      });
      x += s.breite;
    }
    doc.save();
    doc
      .moveTo(x0, y + h)
      .lineTo(x0 + gesamt, y + h)
      .lineWidth(0.3)
      .strokeColor(FARBEN.hellgrau)
      .stroke();
    doc.restore();
    doc.y = y + h;
    doc.x = x0;
    index += 1;
  }

  if (!zeilen.length) {
    doc.font('Helvetica-Oblique').fontSize(groesse).fillColor(FARBEN.grau);
    doc.text('Keine Eintraege.', x0 + innen, doc.y + innen, { width: gesamt - 2 * innen });
    doc.y += 14;
  }

  doc.y += 8;
  doc.x = x0;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

// ---------------------------------------------------------------------------
// Kleine Zeichenhelfer, die mehrere Berichte brauchen
// ---------------------------------------------------------------------------

/** Farbige Kennzeichnung (Ampel) mit Text — z. B. "3 Fehler". */
export function ampelPunkt(doc: Dok, x: number, y: number, farbe: string, text: string, groesse = 9): void {
  doc.save();
  doc.circle(x + 4, y + groesse / 2 + 1, 4).fill(farbe);
  doc.restore();
  doc.font('Helvetica').fontSize(groesse).fillColor(FARBEN.schwarz);
  doc.text(text, x + 13, y, { lineBreak: false });
}

export function farbeFuerStatus(status: string, schweregrad?: string): string {
  if (status === 'ok') return FARBEN.gruen;
  if (status === 'nicht_pruefbar') return FARBEN.grau;
  if (schweregrad === 'warnung') return FARBEN.orange;
  if (schweregrad === 'hinweis') return FARBEN.blau;
  return FARBEN.rot;
}

export const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  verstoss: 'Beanstandung',
  nicht_pruefbar: 'nicht pruefbar',
};

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

export async function alsBuffer(doc: Dok): Promise<Buffer> {
  fusszeilenStempeln(doc);
  const teile: Buffer[] = [];
  const fertig = new Promise<Buffer>((aufloesen, ablehnen) => {
    doc.on('data', (b: Buffer) => teile.push(Buffer.from(b)));
    doc.on('end', () => aufloesen(Buffer.concat(teile)));
    doc.on('error', ablehnen);
  });
  doc.end();
  return fertig;
}
