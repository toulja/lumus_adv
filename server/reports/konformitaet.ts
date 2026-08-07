/**
 * Konformitaetsbericht (Lastenheft F10.1).
 *
 * Der Bericht ist das Behoerdendokument: er zeigt JEDE Regel mit Soll, Ist,
 * Status und Fundstelle, begruendet jede Beanstandung, zeigt sie im Lageplan
 * und weist am Ende das Regelwerk mit Quelle, Paragraf, Zitat, URL und
 * Verifikationsstatus nach. Alle Zahlen stammen unveraendert aus der
 * Regel-Engine (shared/rules/engine.ts) — hier wird nichts nachgerechnet.
 */

import type {
  BBox,
  ElementRef,
  Gelaende,
  ObjektTyp,
  ProjektInhalt,
  Pruefbericht,
  Pruefergebnis,
  Punkt,
  Regel,
  Regelwerk,
  Ring,
} from '../../shared/domain/types.ts';
import {
  BLOCK_TYP_LABEL,
  STATION_LABEL,
  WEGE_TYP_LABEL,
} from '../../shared/domain/types.ts';
import { bezeichnung, grundriss } from '../../shared/domain/objekte.ts';
import { bboxErweitern, bboxVonPunkten, kreisRing, zahl } from '../../shared/geo/geometry.ts';
import type { Dok } from './pdf-basis.ts';
import {
  FARBEN,
  STATUS_LABEL,
  absatz,
  alsBuffer,
  datumDeutsch,
  datumZeit,
  farbeFuerStatus,
  feldZeile,
  fusszeile,
  hinweisKasten,
  kopfzeile,
  neueSeite,
  neuesDokument,
  platzSichern,
  satzBreite,
  satzUnterkante,
  tabelle,
  ueberschrift,
} from './pdf-basis.ts';
import { passenderMassstab, zeichnePlan } from './lageplan.ts';

export interface KonformitaetOpts {
  bericht: Pruefbericht;
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  regelwerk: Regelwerk;
  projektName: string;
  snapshotName?: string;
  veranstalter: string;
}

const ABB_BREITE = 380;
const ABB_HOEHE = 240;

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function wert(x: number | null, einheit: string): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'k. A.';
  return einheit ? `${zahl(x)} ${einheit}` : zahl(x);
}

function regelVon(regelwerk: Regelwerk, regelId: string): Regel | undefined {
  return regelwerk.regeln.find((r) => r.id === regelId);
}

/** Kurze Fundstelle ohne Zitat — das Zitat steht im Detailblock und im Nachweis. */
function kurzeFundstelle(regelwerk: Regelwerk, regelId: string): string {
  const r = regelVon(regelwerk, regelId);
  if (!r) return regelId;
  const t = [r.quelle.kuerzel, r.quelle.paragraf].filter(Boolean).join(' ');
  return t || regelId;
}

function elementName(ref: ElementRef, o: KonformitaetOpts): string {
  if (ref.art === 'objekt') {
    const inst = o.inhalt.objekte.find((x) => x.id === ref.id);
    if (!inst) return `Objekt ${ref.id} (nicht mehr im Plan)`;
    return bezeichnung(o.typen.get(inst.typId), inst);
  }
  if (ref.art === 'weg') {
    const w = o.inhalt.wege.find((x) => x.id === ref.id);
    return w ? `${w.name ?? WEGE_TYP_LABEL[w.typ]} (${WEGE_TYP_LABEL[w.typ]}, ${zahl(w.breite)} m)` : `Weg ${ref.id}`;
  }
  if (ref.art === 'blockflaeche') {
    const b = o.inhalt.blockflaechen.find((x) => x.id === ref.id);
    return b ? `${b.name ?? 'Blockflaeche'} (${BLOCK_TYP_LABEL[b.typ]})` : `Blockflaeche ${ref.id}`;
  }
  if (ref.art === 'einsatzstation') {
    const s = o.inhalt.einsatzstationen.find((x) => x.id === ref.id);
    return s ? `${STATION_LABEL[s.kategorie]} „${s.name}“` : `Einsatzstation ${ref.id}`;
  }
  if (ref.art === 'projekt') return o.projektName;
  return `${ref.art} ${ref.id}`;
}

/** Geometrie eines betroffenen Elements — Basis fuer Ausschnitt und Hervorhebung. */
function elementRing(ref: ElementRef, o: KonformitaetOpts): Ring | null {
  if (ref.art === 'objekt') {
    const inst = o.inhalt.objekte.find((x) => x.id === ref.id);
    if (!inst) return null;
    const typ = o.typen.get(inst.typId);
    return typ ? grundriss(typ, inst) : [inst.position];
  }
  if (ref.art === 'weg') {
    const w = o.inhalt.wege.find((x) => x.id === ref.id);
    return w ? w.polylinie : null;
  }
  if (ref.art === 'blockflaeche') {
    const b = o.inhalt.blockflaechen.find((x) => x.id === ref.id);
    return b ? b.polygon : null;
  }
  if (ref.art === 'einsatzstation') {
    const s = o.inhalt.einsatzstationen.find((x) => x.id === ref.id);
    if (!s) return null;
    if (s.polygon) return s.polygon;
    return s.punkt ? [s.punkt] : null;
  }
  return null;
}

interface Abbildungsdaten {
  ausschnitt: BBox;
  hervorheben: { ring: Ring; farbe: string; text?: string }[];
}

function abbildungsdaten(e: Pruefergebnis, o: KonformitaetOpts): Abbildungsdaten | null {
  const punkte: Punkt[] = [];
  const hervorheben: { ring: Ring; farbe: string; text?: string }[] = [];

  if (e.geometrie && e.geometrie.length >= 2) {
    hervorheben.push({ ring: e.geometrie, farbe: FARBEN.rot, text: e.regelId });
    punkte.push(...e.geometrie);
  }
  for (const ref of e.elemente) {
    const ring = elementRing(ref, o);
    if (!ring || !ring.length) continue;
    punkte.push(...ring);
    if (ref.art === 'objekt' && ring.length >= 3) {
      hervorheben.push({ ring, farbe: FARBEN.rot });
    }
  }
  if (e.ort) {
    punkte.push(e.ort);
    if (!hervorheben.length) hervorheben.push({ ring: kreisRing(e.ort, 6, 24), farbe: FARBEN.rot, text: e.regelId });
  }
  if (!punkte.length) return null;

  let bbox = bboxErweitern(bboxVonPunkten(punkte), 8);
  // Mindestausdehnung, damit der Ausschnitt lesbar bleibt
  const mindest = 30;
  const bE = bbox.maxE - bbox.minE;
  const bN = bbox.maxN - bbox.minN;
  if (bE < mindest) {
    const f = (mindest - bE) / 2;
    bbox = { ...bbox, minE: bbox.minE - f, maxE: bbox.maxE + f };
  }
  if (bN < mindest) {
    const f = (mindest - bN) / 2;
    bbox = { ...bbox, minN: bbox.minN - f, maxN: bbox.maxN + f };
  }
  return { ausschnitt: bbox, hervorheben };
}

function zeichneAbbildung(doc: Dok, e: Pruefergebnis, o: KonformitaetOpts): void {
  const daten = abbildungsdaten(e, o);
  if (!daten) {
    absatz(doc, 'Lageplan-Abbildung: kein Ortsbezug hinterlegt (k. A.).', {
      groesse: 7.5,
      farbe: FARBEN.grau,
    });
    return;
  }
  platzSichern(doc, ABB_HOEHE + 34);
  const x = doc.page.margins.left;
  const y = doc.y;
  const massstab = passenderMassstab(daten.ausschnitt, ABB_BREITE, ABB_HOEHE);
  zeichnePlan(doc, {
    inhalt: o.inhalt,
    gelaende: o.gelaende,
    typen: o.typen,
    massstab,
    titel: o.projektName,
    hervorheben: daten.hervorheben,
    x,
    y,
    breite: ABB_BREITE,
    hoehe: ABB_HOEHE,
    ausschnitt: daten.ausschnitt,
    zeigeLegende: false,
    zeigeTitelblock: false,
    zeigeMassstab: true,
    zeigeNordpfeil: true,
    zeigeRahmen: true,
  });
  doc.y = y + ABB_HOEHE + 4;
  doc.x = x;
  doc.font('Helvetica').fontSize(6.5).fillColor(FARBEN.grau);
  doc.text(
    `Abbildung zu ${e.regelId}: Ausschnitt M 1:${massstab}, ETRS89 / UTM 32N (EPSG:25832). Beanstandung rot gekennzeichnet.`,
    x,
    doc.y,
    { width: satzBreite(doc) },
  );
  doc.y += 10;
  doc.font('Helvetica').fontSize(9).fillColor(FARBEN.schwarz);
}

// ---------------------------------------------------------------------------
// Deckblatt
// ---------------------------------------------------------------------------

function ampelKasten(doc: Dok, x: number, y: number, breite: number, farbe: string, anzahl: number, label: string): void {
  const h = 44;
  doc.save();
  doc.lineWidth(0.8);
  doc.rect(x, y, breite, h).fillAndStroke(FARBEN.weiss, FARBEN.hellgrau);
  doc.rect(x, y, breite, 4).fill(farbe);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(farbe);
  doc.text(String(anzahl), x, y + 11, { width: breite, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6.6).fillColor(FARBEN.grau);
  doc.text(label, x + 3, y + 31, { width: breite - 6, align: 'center', lineBreak: false, ellipsis: true });
  doc.restore();
}

function deckblatt(doc: Dok, o: KonformitaetOpts): void {
  const b = o.bericht;
  kopfzeile(doc, 'Konformitaetsbericht', `${o.projektName} — automatisierte Pruefung nach ${o.regelwerk.bezeichnung}`);

  feldZeile(doc, 'Projekt', o.projektName);
  feldZeile(doc, 'Veranstalter', o.veranstalter || 'k. A.');
  feldZeile(doc, 'Planstand (Snapshot)', o.snapshotName ?? 'Arbeitsstand (kein Snapshot)');
  feldZeile(doc, 'Regelwerk', `${o.regelwerk.bezeichnung} — ${o.regelwerk.id}, Version ${o.regelwerk.version}`);
  feldZeile(doc, 'Regelwerk-Stand', datumDeutsch(o.regelwerk.stand));
  feldZeile(doc, 'Geltungsbereich', `Bundesland ${o.regelwerk.bundesland}`);
  feldZeile(doc, 'Pruefung durchgefuehrt', datumZeit(b.zeit));
  feldZeile(doc, 'Geprueft', `${b.ergebnisse.length} Ergebnisse aus ${o.regelwerk.regeln.length} Regeln`);
  doc.y += 10;

  ueberschrift(doc, 'Zusammenfassung', 1);
  const breite = satzBreite(doc);
  const spalte = (breite - 4 * 8) / 5;
  const y = doc.y;
  const z = b.zusammenfassung;
  ampelKasten(doc, doc.page.margins.left + 0 * (spalte + 8), y, spalte, FARBEN.rot, z.fehler, 'Fehler');
  ampelKasten(doc, doc.page.margins.left + 1 * (spalte + 8), y, spalte, FARBEN.orange, z.warnungen, 'Warnungen');
  ampelKasten(doc, doc.page.margins.left + 2 * (spalte + 8), y, spalte, FARBEN.blau, z.hinweise, 'Hinweise');
  ampelKasten(doc, doc.page.margins.left + 3 * (spalte + 8), y, spalte, FARBEN.gruen, z.ok, 'ohne Beanstandung');
  ampelKasten(doc, doc.page.margins.left + 4 * (spalte + 8), y, spalte, FARBEN.grau, z.nichtPruefbar, 'nicht pruefbar');
  doc.y = y + 44 + 12;
  doc.x = doc.page.margins.left;

  const gesamt =
    z.fehler > 0
      ? 'ERGEBNIS: Es liegen Beanstandungen mit dem Schweregrad „Fehler“ vor. Der Plan ist in dieser Fassung nicht regelkonform.'
      : z.warnungen > 0
        ? 'ERGEBNIS: Keine Fehler, jedoch Warnungen. Die Beanstandungen sind vor der Einreichung zu klaeren.'
        : 'ERGEBNIS: Keine Beanstandungen mit Schweregrad Fehler oder Warnung. Die nicht pruefbaren Regeln bleiben gesondert zu bewerten.';
  absatz(doc, gesamt, { fett: true, groesse: 9.5, farbe: z.fehler > 0 ? FARBEN.rot : z.warnungen > 0 ? FARBEN.orange : FARBEN.gruen });
  doc.y += 4;

  ueberschrift(doc, 'Haftungshinweis', 2);
  hinweisKasten(doc, o.regelwerk.haftungshinweis || b.haftungshinweis || 'k. A.');
}

// ---------------------------------------------------------------------------
// Regeltabelle
// ---------------------------------------------------------------------------

function regeltabelle(doc: Dok, o: KonformitaetOpts): void {
  neueSeite(doc);
  kopfzeile(doc, 'Pruefergebnisse im Ueberblick', `${o.projektName} — alle geprueften Regeln`);
  absatz(
    doc,
    'Die Tabelle enthaelt jedes Pruefergebnis der Regel-Engine. „Soll“ ist der Grenzwert der Regel, „Ist“ der am Plan gemessene Wert. Fehlt ein Wert, weil er sich aus dem Plan nicht bestimmen laesst, steht dort „k. A.“.',
    { groesse: 8, farbe: FARBEN.grau },
  );

  const zeilen = o.bericht.ergebnisse.map((e) => [
    e.regelId,
    e.regelTitel,
    wert(e.sollWert, e.einheit),
    wert(e.istWert, e.einheit),
    `${STATUS_LABEL[e.status] ?? e.status}${e.status === 'verstoss' ? ` (${e.schweregrad})` : ''}`,
    kurzeFundstelle(o.regelwerk, e.regelId),
  ]);

  tabelle(
    doc,
    [
      { titel: 'Regel-ID', breite: 62 },
      { titel: 'Titel', breite: 148 },
      { titel: 'Soll', breite: 55, ausrichtung: 'rechts' },
      { titel: 'Ist', breite: 55, ausrichtung: 'rechts' },
      { titel: 'Status', breite: 78 },
      { titel: 'Fundstelle', breite: 117 },
    ],
    zeilen,
    {
      zeilenFarbe: (_z, i) => {
        const e = o.bericht.ergebnisse[i];
        return e ? farbeFuerStatus(e.status, e.schweregrad) : undefined;
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Beanstandungen im Detail
// ---------------------------------------------------------------------------

function detailBlock(doc: Dok, e: Pruefergebnis, nummer: number, gesamt: number, o: KonformitaetOpts): void {
  platzSichern(doc, 120);
  const x = doc.page.margins.left;
  const b = satzBreite(doc);
  const farbe = farbeFuerStatus(e.status, e.schweregrad);

  const kopfY = doc.y;
  doc.save();
  doc.rect(x, kopfY, b, 20).fill(FARBEN.sehrhell);
  doc.rect(x, kopfY, 4, 20).fill(farbe);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(farbe);
  doc.text(`Beanstandung ${nummer} von ${gesamt} — ${e.regelTitel}`, x + 10, kopfY + 5.5, {
    width: b - 100,
    lineBreak: false,
    ellipsis: true,
  });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(farbe);
  doc.text(`${e.regelId} / ${e.schweregrad.toUpperCase()}`, x + b - 96, kopfY + 6.5, {
    width: 90,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
  doc.y = kopfY + 26;
  doc.x = x;

  absatz(doc, e.meldung, { groesse: 9 });

  const istSoll = `Ist ${wert(e.istWert, e.einheit)}   |   Soll ${wert(e.sollWert, e.einheit)}   |   Prueftyp ${e.pruefTyp}`;
  absatz(doc, istSoll, { groesse: 8, fett: true, farbe: FARBEN.dunkelblau, abstandDanach: 4 });

  const namen = e.elemente.map((ref) => elementName(ref, o));
  absatz(doc, `Betroffene Elemente: ${namen.length ? namen.join('; ') : 'k. A.'}`, {
    groesse: 8,
    abstandDanach: 4,
  });

  const regel = regelVon(o.regelwerk, e.regelId);
  const zitat = regel?.quelle.zitat ? `„${regel.quelle.zitat}“` : 'Zitat: k. A.';
  absatz(doc, `Fundstelle: ${e.fundstelle}`, { groesse: 8, abstandDanach: 2 });
  absatz(doc, zitat, { groesse: 7.5, farbe: FARBEN.grau, abstandDanach: 4 });
  if (regel?.quelle.url) {
    absatz(doc, `Quelle: ${regel.quelle.url}`, { groesse: 7, farbe: FARBEN.grau, abstandDanach: 6 });
  }

  const empfehlung = e.empfehlung?.text ?? 'Keine automatische Handlungsempfehlung berechenbar (k. A.).';
  const eh = (() => {
    doc.font('Helvetica').fontSize(8);
    return doc.heightOfString(empfehlung, { width: b - 20 }) + 22;
  })();
  platzSichern(doc, eh);
  const ey = doc.y;
  doc.save();
  doc.lineWidth(0.6);
  doc.rect(x, ey, b, eh).fillAndStroke('#f3f8f4', FARBEN.gruen);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(FARBEN.gruen);
  doc.text('HANDLUNGSEMPFEHLUNG', x + 10, ey + 5, { width: b - 20, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(FARBEN.schwarz);
  doc.text(empfehlung, x + 10, ey + 14, { width: b - 20 });
  doc.restore();
  doc.y = ey + eh + 8;
  doc.x = x;

  const v = e.empfehlung?.verschiebung;
  if (v) {
    absatz(
      doc,
      `Rechnerischer Verschiebevorschlag: ${zahl(v.meter)} m nach ${v.richtung} (dE ${zahl(v.dE)} m, dN ${zahl(v.dN)} m).`,
      { groesse: 7.5, farbe: FARBEN.grau, abstandDanach: 6 },
    );
  }

  zeichneAbbildung(doc, e, o);
  doc.y += 6;
}

function beanstandungen(doc: Dok, o: KonformitaetOpts): void {
  const liste = o.bericht.ergebnisse.filter((e) => e.status === 'verstoss');
  neueSeite(doc);
  kopfzeile(doc, 'Beanstandungen im Einzelnen', `${o.projektName} — ${liste.length} Beanstandung(en)`);
  if (!liste.length) {
    absatz(doc, 'Es liegen keine Beanstandungen vor.', { fett: true, farbe: FARBEN.gruen });
    return;
  }
  let n = 1;
  for (const e of liste) {
    detailBlock(doc, e, n, liste.length, o);
    n += 1;
  }
}

// ---------------------------------------------------------------------------
// Nicht pruefbare Regeln
// ---------------------------------------------------------------------------

function nichtPruefbar(doc: Dok, o: KonformitaetOpts): void {
  const liste = o.bericht.ergebnisse.filter((e) => e.status === 'nicht_pruefbar');
  neueSeite(doc);
  kopfzeile(doc, 'Nicht pruefbare Regeln', `${o.projektName} — ${liste.length} Regel(n) ohne abschliessendes Ergebnis`);
  absatz(
    doc,
    'Diese Regeln konnten nicht abschliessend geprueft werden, weil die dafuer noetigen Angaben im Plan fehlen. Sie sind KEIN Nachweis der Regelkonformitaet und muessen fachlich bewertet werden.',
    { groesse: 8, farbe: FARBEN.grau },
  );
  tabelle(
    doc,
    [
      { titel: 'Regel-ID', breite: 62 },
      { titel: 'Titel', breite: 150 },
      { titel: 'Begruendung', breite: 195 },
      { titel: 'Fundstelle', breite: 108 },
    ],
    liste.map((e) => [e.regelId, e.regelTitel, e.meldung, kurzeFundstelle(o.regelwerk, e.regelId)]),
    { kopfFarbe: FARBEN.grau },
  );
}

// ---------------------------------------------------------------------------
// Regelwerk-Nachweis
// ---------------------------------------------------------------------------

function regelwerkNachweis(doc: Dok, o: KonformitaetOpts): void {
  neueSeite(doc);
  kopfzeile(
    doc,
    'Regelwerk-Nachweis',
    `${o.regelwerk.bezeichnung} — Version ${o.regelwerk.version}, Stand ${datumDeutsch(o.regelwerk.stand)}`,
  );
  absatz(
    doc,
    'Jede angewandte Regel mit ihrer Rechtsquelle. Regeln mit dem Verifikationsstatus „zu pruefen“ sind noch nicht am amtlichen Text belegt und duerfen nicht ungeprueft in ein Behoerdendokument uebernommen werden.',
    { groesse: 8, farbe: FARBEN.grau },
  );

  ueberschrift(doc, 'Herangezogene Quellen', 2);
  tabelle(
    doc,
    [
      { titel: 'Kuerzel', breite: 65 },
      { titel: 'Titel / Fassung', breite: 290 },
      { titel: 'URL', breite: 160 },
    ],
    o.regelwerk.quellen.map((q) => [
      q.kuerzel,
      `${q.titel}${q.fassung ? `\n${q.fassung}` : ''}`,
      q.url ?? 'k. A.',
    ]),
    { groesse: 6.8, kopfFarbe: FARBEN.grau },
  );

  ueberschrift(doc, 'Regeln im Einzelnen', 2);
  tabelle(
    doc,
    [
      { titel: 'Regel-ID', breite: 55 },
      { titel: 'Titel', breite: 92 },
      { titel: 'Paragraf', breite: 72 },
      { titel: 'Zitat / URL', breite: 176 },
      { titel: 'Verifikation', breite: 120 },
    ],
    o.regelwerk.regeln.map((r) => [
      r.id,
      r.titel,
      `${r.quelle.kuerzel} ${r.quelle.paragraf}`.trim(),
      `${r.quelle.zitat ? `„${r.quelle.zitat}“` : 'Zitat: k. A.'}\n${r.quelle.url ?? 'URL: k. A.'}`,
      `${r.verifikation.status === 'verifiziert' ? 'verifiziert' : 'ZU PRUEFEN'} (${datumDeutsch(r.verifikation.geprueftAm)})\n${r.verifikation.beleg || 'Beleg: k. A.'}`,
    ]),
    {
      groesse: 6.4,
      zeilenFarbe: (_z, i) =>
        o.regelwerk.regeln[i]?.verifikation.status === 'verifiziert' ? undefined : FARBEN.orange,
    },
  );

  platzSichern(doc, 60);
  ueberschrift(doc, 'Haftungshinweis', 2);
  hinweisKasten(doc, o.regelwerk.haftungshinweis || 'k. A.');
}

// ---------------------------------------------------------------------------
// Oeffentliche Schnittstelle
// ---------------------------------------------------------------------------

export async function konformitaetsberichtPdf(o: KonformitaetOpts): Promise<Buffer> {
  const doc = neuesDokument({ titel: `Konformitaetsbericht — ${o.projektName}` });
  fusszeile(
    doc,
    `Konformitaetsbericht ${o.projektName} | Regelwerk ${o.regelwerk.id} ${o.regelwerk.version} (Stand ${datumDeutsch(o.regelwerk.stand)}) | Planungsunterstuetzung, keine behoerdliche Genehmigung`,
  );

  deckblatt(doc, o);
  regeltabelle(doc, o);
  beanstandungen(doc, o);
  nichtPruefbar(doc, o);
  regelwerkNachweis(doc, o);

  // Die Unterkante darf nach dem letzten Abschnitt nicht ueberschritten sein.
  if (doc.y > satzUnterkante(doc)) doc.y = satzUnterkante(doc);
  return alsBuffer(doc);
}
