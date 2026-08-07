/**
 * Kontextaufbereitung fuer die KI (Lastenheft F7, Kapitel 8).
 *
 * KOSTENKONTROLLE ist ausdrueckliche Vorgabe. Darum gilt hier durchgehend:
 * KEINE Roh-Geometrie-Dumps. Es gehen nur verdichtete Kennzahlen an das
 * Modell — Masse als Text, Positionen als gerundete Rechts-/Hochwerte, Wege
 * nur mit Anfangs- und Endpunkt, Gebaeude nur als Anzahl plus Bbox,
 * Pruefergebnisse nur als Verstoesse (max. 30), Regeln ohne Zitate.
 *
 * Fehlende Angaben heissen "k. A." — nie spekulieren.
 */

import type {
  BBox,
  Gelaende,
  ObjektInstanz,
  ObjektTyp,
  ProjektInhalt,
  Pruefbericht,
  Punkt,
  Regelwerk,
  Ring,
} from '../../shared/domain/types.ts';
import { KATEGORIE_LABEL, STATION_LABEL, WEGE_TYP_LABEL, BLOCK_TYP_LABEL } from '../../shared/domain/types.ts';
import { bezeichnung, masseVon } from '../../shared/domain/objekte.ts';
import { bboxVonPunkten, flaeche, polylinieLaenge, schwerpunkt, zahl } from '../../shared/geo/geometry.ts';

export const KEINE_ANGABE = 'k. A.';

const MAX_VERSTOESSE = 30;
const MAX_BEISPIELE = 4;

// ---------------------------------------------------------------------------
// Kontext-Typen
// ---------------------------------------------------------------------------

export interface KiProjektKurz {
  id: string;
  name: string;
  zeitraum: string;
  maxBesucher: number;
  status: string;
  regelwerkId: string;
  beschreibung: string;
}

export interface KiGelaendeKurz {
  id: string;
  name: string;
  bbox: string;
  ausdehnung: string;
  hoeheMittel: string;
  hoehenHerkunft: string;
  gebaeudeAnzahl: number;
  gebaeudeBbox: string;
  flurstueckeAnzahl: number;
}

export interface KiObjektKurz {
  id: string;
  standNummer: string;
  typ: string;
  typId: string;
  kategorie: string;
  masseLxBxH: string;
  position: string;
  rotationGrad: number;
  betreiber: string;
  status: string;
}

export interface KiKategorieGruppe {
  kategorie: string;
  anzahl: number;
  beispiele: string[];
}

export interface KiObjekteKurz {
  anzahl: number;
  gekuerzt: boolean;
  hinweis: string | null;
  liste: KiObjektKurz[];
  gruppen: KiKategorieGruppe[];
}

export interface KiWegKurz {
  id: string;
  name: string;
  typ: string;
  breite: number;
  laengeM: number;
  richtung: string;
  stuetzpunkte: number;
  verlauf: { von: string; bis: string };
  lichteHoehe: string;
  entfluchtungFuerPersonen: string;
}

export interface KiBlockflaecheKurz {
  id: string;
  name: string;
  typ: string;
  flaecheM2: number;
  mitte: string;
  begruendung: string;
}

export interface KiStationKurz {
  id: string;
  name: string;
  kategorie: string;
  art: 'punkt' | 'flaeche';
  ort: string;
}

export interface KiVerstossKurz {
  regelId: string;
  regelTitel: string;
  schweregrad: string;
  meldung: string;
  ist: string;
  soll: string;
  empfehlung: string;
}

export interface KiPruefungKurz {
  zeit: string;
  regelwerkVersion: string;
  zusammenfassung: { fehler: number; warnungen: number; hinweise: number; ok: number; nichtPruefbar: number };
  verstoesse: KiVerstossKurz[];
  weitereVerstoesse: number;
}

export interface KiRegelKurz {
  id: string;
  titel: string;
  quelle: string;
  schwellwerte: Record<string, number>;
}

export interface KiRegelwerkKurz {
  id: string;
  version: string;
  bezeichnung: string;
  regeln: KiRegelKurz[];
}

export interface KiKontext {
  projekt: KiProjektKurz;
  gelaende: KiGelaendeKurz | null;
  objekte: KiObjekteKurz;
  wege: KiWegKurz[];
  blockflaechen: KiBlockflaecheKurz[];
  einsatzstationen: KiStationKurz[];
  pruefung: KiPruefungKurz | null;
  regelwerk: KiRegelwerkKurz;
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

function oderKA(wert: string | null | undefined): string {
  const s = (wert ?? '').trim();
  return s.length > 0 ? s : KEINE_ANGABE;
}

/** "E 475123 / N 5522456" — bewusst ganzzahlig, Zentimeter helfen der KI nicht. */
export function punktText(p: Punkt | null | undefined): string {
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return KEINE_ANGABE;
  return `E ${Math.round(p[0])} / N ${Math.round(p[1])}`;
}

export function bboxText(b: BBox | null | undefined): string {
  if (!b || !Number.isFinite(b.minE) || !Number.isFinite(b.minN)) return KEINE_ANGABE;
  return `E ${Math.round(b.minE)}-${Math.round(b.maxE)} / N ${Math.round(b.minN)}-${Math.round(b.maxN)}`;
}

function ausdehnungText(b: BBox): string {
  return `${zahl(Math.max(0, b.maxE - b.minE), 0)} m x ${zahl(Math.max(0, b.maxN - b.minN), 0)} m`;
}

function masseText(typ: ObjektTyp | undefined, inst: ObjektInstanz): string {
  if (!typ) return KEINE_ANGABE;
  const m = masseVon(typ, inst);
  return `${zahl(m.laenge)} x ${zahl(m.breite)} x ${zahl(m.hoehe)} m`;
}

function wertText(wert: number | null | undefined, einheit: string): string {
  if (wert === null || wert === undefined || !Number.isFinite(wert)) return KEINE_ANGABE;
  return einheit ? `${zahl(wert)} ${einheit}` : zahl(wert);
}

function ringMitte(ring: Ring | undefined): Punkt | null {
  if (!ring || ring.length < 3) return null;
  return schwerpunkt(ring);
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

export interface KontextEingabe {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  bericht: Pruefbericht | null;
  regelwerk: Regelwerk;
  maxObjekte?: number;
}

function objektKurz(inst: ObjektInstanz, typen: Map<string, ObjektTyp>): KiObjektKurz {
  const typ = typen.get(inst.typId);
  return {
    id: inst.id,
    standNummer: oderKA(inst.standNummer),
    typ: typ ? typ.name : inst.typId,
    typId: inst.typId,
    kategorie: typ ? KATEGORIE_LABEL[typ.kategorie] : KEINE_ANGABE,
    masseLxBxH: masseText(typ, inst),
    position: punktText(inst.position),
    rotationGrad: Math.round(((inst.rotation % 360) + 360) % 360),
    betreiber: oderKA(inst.betreiberOrgId),
    status: inst.status,
  };
}

function gruppiere(objekte: ObjektInstanz[], typen: Map<string, ObjektTyp>): KiKategorieGruppe[] {
  const karte = new Map<string, { anzahl: number; beispiele: string[] }>();
  for (const o of objekte) {
    const typ = typen.get(o.typId);
    const kat = typ ? KATEGORIE_LABEL[typ.kategorie] : KEINE_ANGABE;
    let eintrag = karte.get(kat);
    if (!eintrag) {
      eintrag = { anzahl: 0, beispiele: [] };
      karte.set(kat, eintrag);
    }
    eintrag.anzahl += 1;
    if (eintrag.beispiele.length < MAX_BEISPIELE) {
      eintrag.beispiele.push(`${bezeichnung(typ, o)} bei ${punktText(o.position)}`);
    }
  }
  return [...karte.entries()]
    .map(([kategorie, e]) => ({ kategorie, anzahl: e.anzahl, beispiele: e.beispiele }))
    .sort((a, b) => b.anzahl - a.anzahl);
}

export function baueKontext(opts: KontextEingabe): KiKontext {
  const maxObjekte = opts.maxObjekte !== undefined && opts.maxObjekte > 0 ? opts.maxObjekte : 120;
  const inhalt = opts.inhalt;
  const p = inhalt.projekt;

  // -- Projekt --------------------------------------------------------------
  const projekt: KiProjektKurz = {
    id: p.id,
    name: p.name,
    zeitraum: `${oderKA(p.zeitraumVon)} bis ${oderKA(p.zeitraumBis)}`,
    maxBesucher: Number.isFinite(p.maxBesucher) ? p.maxBesucher : 0,
    status: p.status,
    regelwerkId: p.regelwerkId,
    beschreibung: oderKA(p.beschreibung),
  };

  // -- Gelaende (Gebaeude NUR als Anzahl + Bbox) ----------------------------
  let gelaende: KiGelaendeKurz | null = null;
  if (opts.gelaende) {
    const g = opts.gelaende;
    const gebaeudePunkte: Punkt[] = [];
    for (const geb of g.gebaeude) for (const pt of geb.grundriss) gebaeudePunkte.push(pt);
    gelaende = {
      id: g.id,
      name: g.name,
      bbox: bboxText(g.bbox),
      ausdehnung: ausdehnungText(g.bbox),
      hoeheMittel: Number.isFinite(g.hoeheMittel) ? `${zahl(g.hoeheMittel, 1)} m ue. NHN` : KEINE_ANGABE,
      hoehenHerkunft: g.hoehenHerkunft,
      gebaeudeAnzahl: g.gebaeude.length,
      gebaeudeBbox: gebaeudePunkte.length > 0 ? bboxText(bboxVonPunkten(gebaeudePunkte)) : KEINE_ANGABE,
      flurstueckeAnzahl: g.flurstuecke.length,
    };
  }

  // -- Objekte (bei Ueberlaenge gruppiert statt einzeln) --------------------
  const alleObjekte = inhalt.objekte;
  const gekuerzt = alleObjekte.length > maxObjekte;
  const objekte: KiObjekteKurz = {
    anzahl: alleObjekte.length,
    gekuerzt,
    hinweis: gekuerzt
      ? `Das Projekt enthaelt ${alleObjekte.length} Objekte und damit mehr als die Kontextgrenze von ${maxObjekte}. ` +
        `Es werden nur Anzahlen je Kategorie und einzelne Beispiele genannt — die vollstaendige Objektliste liegt NICHT vor. ` +
        `Aussagen ueber einzelne, hier nicht genannte Objekte sind nicht moeglich (k. A.).`
      : null,
    liste: gekuerzt ? [] : alleObjekte.map((o) => objektKurz(o, opts.typen)),
    gruppen: gruppiere(alleObjekte, opts.typen),
  };

  // -- Wege (nur Anfang und Ende, keine Stuetzpunktliste) -------------------
  const wege: KiWegKurz[] = inhalt.wege.map((w) => {
    const erster = w.polylinie[0];
    const letzter = w.polylinie[w.polylinie.length - 1];
    return {
      id: w.id,
      name: oderKA(w.name) === KEINE_ANGABE ? WEGE_TYP_LABEL[w.typ] : (w.name as string),
      typ: WEGE_TYP_LABEL[w.typ],
      breite: +w.breite.toFixed(2),
      laengeM: +polylinieLaenge(w.polylinie).toFixed(1),
      richtung: w.richtung,
      stuetzpunkte: w.polylinie.length,
      verlauf: { von: punktText(erster), bis: punktText(letzter) },
      lichteHoehe: w.lichteHoehe === undefined || w.lichteHoehe === null ? KEINE_ANGABE : `${zahl(w.lichteHoehe)} m`,
      entfluchtungFuerPersonen:
        w.entfluchtungFuerPersonen === undefined || w.entfluchtungFuerPersonen === null
          ? KEINE_ANGABE
          : String(w.entfluchtungFuerPersonen),
    };
  });

  // -- Blockflaechen --------------------------------------------------------
  const blockflaechen: KiBlockflaecheKurz[] = inhalt.blockflaechen.map((b) => ({
    id: b.id,
    name: oderKA(b.name),
    typ: BLOCK_TYP_LABEL[b.typ],
    flaecheM2: +flaeche(b.polygon).toFixed(1),
    mitte: punktText(ringMitte(b.polygon)),
    begruendung: oderKA(b.begruendung),
  }));

  // -- Einsatzstationen -----------------------------------------------------
  const einsatzstationen: KiStationKurz[] = inhalt.einsatzstationen.map((s) => {
    const ort = s.punkt ?? ringMitte(s.polygon);
    return {
      id: s.id,
      name: oderKA(s.name),
      kategorie: STATION_LABEL[s.kategorie],
      art: s.punkt ? 'punkt' : 'flaeche',
      ort: punktText(ort),
    };
  });

  // -- Pruefung: NUR die Verstoesse, hoechstens 30 --------------------------
  let pruefung: KiPruefungKurz | null = null;
  if (opts.bericht) {
    const alleVerstoesse = opts.bericht.ergebnisse.filter((e) => e.status === 'verstoss');
    pruefung = {
      zeit: opts.bericht.zeit,
      regelwerkVersion: opts.bericht.regelwerkVersion,
      zusammenfassung: opts.bericht.zusammenfassung,
      verstoesse: alleVerstoesse.slice(0, MAX_VERSTOESSE).map((e) => ({
        regelId: e.regelId,
        regelTitel: e.regelTitel,
        schweregrad: e.schweregrad,
        meldung: e.meldung,
        ist: wertText(e.istWert, e.einheit),
        soll: wertText(e.sollWert, e.einheit),
        empfehlung: oderKA(e.empfehlung?.text),
      })),
      weitereVerstoesse: Math.max(0, alleVerstoesse.length - MAX_VERSTOESSE),
    };
  }

  // -- Regelwerk: ohne Zitate -----------------------------------------------
  const regelwerk: KiRegelwerkKurz = {
    id: opts.regelwerk.id,
    version: opts.regelwerk.version,
    bezeichnung: opts.regelwerk.bezeichnung,
    regeln: opts.regelwerk.regeln
      .filter((r) => r.aktiv !== false)
      .map((r) => ({
        id: r.id,
        titel: r.titel,
        quelle: [r.quelle.kuerzel, r.quelle.paragraf].filter((t) => t && t.length > 0).join(' ') || KEINE_ANGABE,
        schwellwerte: r.schwellwerte ?? {},
      })),
  };

  return { projekt, gelaende, objekte, wege, blockflaechen, einsatzstationen, pruefung, regelwerk };
}

// ---------------------------------------------------------------------------
// Textdarstellung fuer den Prompt
// ---------------------------------------------------------------------------

function schwellwerteText(s: Record<string, number>): string {
  const teile = Object.entries(s).map(([k, v]) => `${k}=${zahl(v)}`);
  return teile.length > 0 ? teile.join(', ') : KEINE_ANGABE;
}

/**
 * Kompakte, gut lesbare Darstellung des Kontexts — bewusst strukturierter
 * Text mit Ueberschriften statt eines JSON-Dumps: das spart Tokens und ist
 * fuer das Modell klarer zu lesen.
 */
export function kontextAlsText(k: KiKontext): string {
  const z: string[] = [];

  z.push('## PROJEKT');
  z.push(`Name: ${k.projekt.name}`);
  z.push(`Zeitraum: ${k.projekt.zeitraum}`);
  z.push(`Maximale Besucherzahl: ${k.projekt.maxBesucher.toLocaleString('de-DE')}`);
  z.push(`Status: ${k.projekt.status}`);
  z.push(`Regelwerk: ${k.regelwerk.bezeichnung} (${k.regelwerk.id}, Version ${k.regelwerk.version})`);
  if (k.projekt.beschreibung !== KEINE_ANGABE) z.push(`Beschreibung: ${k.projekt.beschreibung}`);

  z.push('');
  z.push('## GELAENDE');
  if (!k.gelaende) {
    z.push(`Kein Gelaende geladen (${KEINE_ANGABE}).`);
  } else {
    const g = k.gelaende;
    z.push(`Name: ${g.name}`);
    z.push(`Ausdehnung: ${g.ausdehnung}, Bbox (EPSG:25832): ${g.bbox}`);
    z.push(`Mittlere Hoehe: ${g.hoeheMittel} (Herkunft: ${g.hoehenHerkunft})`);
    z.push(`Bestandsgebaeude: ${g.gebaeudeAnzahl} Stueck, Bbox ${g.gebaeudeBbox} (Einzelgeometrien nicht im Kontext)`);
    z.push(`Flurstuecke: ${g.flurstueckeAnzahl}`);
  }

  z.push('');
  z.push(`## OBJEKTE (${k.objekte.anzahl})`);
  if (k.objekte.hinweis) z.push(`HINWEIS: ${k.objekte.hinweis}`);
  if (k.objekte.gekuerzt || k.objekte.liste.length === 0) {
    if (k.objekte.gruppen.length === 0) z.push(`Keine Objekte geplant (${KEINE_ANGABE}).`);
    for (const gr of k.objekte.gruppen) {
      z.push(`- ${gr.kategorie}: ${gr.anzahl} Stueck. Beispiele: ${gr.beispiele.join('; ') || KEINE_ANGABE}`);
    }
  } else {
    for (const o of k.objekte.liste) {
      z.push(
        `- [${o.id}] ${o.typ} (${o.kategorie}), Stand ${o.standNummer}, ` +
          `${o.masseLxBxH}, Pos ${o.position}, Drehung ${o.rotationGrad} Grad, ` +
          `Betreiber ${o.betreiber}, Status ${o.status}`,
      );
    }
  }

  z.push('');
  z.push(`## WEGE (${k.wege.length})`);
  if (k.wege.length === 0) z.push(`Keine Wege geplant (${KEINE_ANGABE}).`);
  for (const w of k.wege) {
    z.push(
      `- [${w.id}] ${w.name} — Typ ${w.typ}, Breite ${zahl(w.breite)} m, Laenge ${zahl(w.laengeM, 1)} m, ` +
        `Richtung ${w.richtung}, ${w.stuetzpunkte} Stuetzpunkte, Verlauf ${w.verlauf.von} -> ${w.verlauf.bis}, ` +
        `lichte Hoehe ${w.lichteHoehe}, Entfluchtung fuer ${w.entfluchtungFuerPersonen} Personen`,
    );
  }

  z.push('');
  z.push(`## BLOCKFLAECHEN (${k.blockflaechen.length})`);
  if (k.blockflaechen.length === 0) z.push(`Keine Blockflaechen (${KEINE_ANGABE}).`);
  for (const b of k.blockflaechen) {
    z.push(`- [${b.id}] ${b.name} — ${b.typ}, ${zahl(b.flaecheM2, 1)} m2, Mitte ${b.mitte}, Grund: ${b.begruendung}`);
  }

  z.push('');
  z.push(`## EINSATZSTATIONEN (${k.einsatzstationen.length})`);
  if (k.einsatzstationen.length === 0) z.push(`Keine Einsatzstationen (${KEINE_ANGABE}).`);
  for (const s of k.einsatzstationen) {
    z.push(`- [${s.id}] ${s.name} — ${s.kategorie} (${s.art}), Ort ${s.ort}`);
  }

  z.push('');
  z.push('## PRUEFBERICHT');
  if (!k.pruefung) {
    z.push(`Noch keine Pruefung gelaufen (${KEINE_ANGABE}).`);
  } else {
    const zf = k.pruefung.zusammenfassung;
    z.push(`Stand: ${k.pruefung.zeit}, Regelwerk-Version ${k.pruefung.regelwerkVersion}`);
    z.push(
      `Bilanz: ${zf.fehler} Fehler, ${zf.warnungen} Warnungen, ${zf.hinweise} Hinweise, ` +
        `${zf.ok} in Ordnung, ${zf.nichtPruefbar} nicht pruefbar`,
    );
    if (k.pruefung.verstoesse.length === 0) z.push('Keine Verstoesse.');
    for (const v of k.pruefung.verstoesse) {
      z.push(
        `- ${v.regelId} (${v.schweregrad}) ${v.regelTitel}: ${v.meldung} ` +
          `[Ist ${v.ist} / Soll ${v.soll}] Empfehlung: ${v.empfehlung}`,
      );
    }
    if (k.pruefung.weitereVerstoesse > 0) {
      z.push(`... sowie ${k.pruefung.weitereVerstoesse} weitere Verstoesse, die hier nicht aufgefuehrt sind.`);
    }
  }

  z.push('');
  z.push(`## REGELWERK ${k.regelwerk.id} (Version ${k.regelwerk.version})`);
  for (const r of k.regelwerk.regeln) {
    z.push(`- ${r.id} ${r.titel} — ${r.quelle}; Schwellwerte: ${schwellwerteText(r.schwellwerte)}`);
  }

  return z.join('\n');
}

/** Grobe Groessenabschaetzung des Kontexts in Zeichen — fuer die Kostenkontrolle. */
export function schaetzeZeichen(k: KiKontext): number {
  return kontextAlsText(k).length;
}
