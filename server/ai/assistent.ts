/**
 * KI-Assistent (Lastenheft F7, Kapitel 8).
 *
 * Drei Faehigkeiten, jede mit deterministischem Fallback ohne API-Key:
 *   a) erklaereBefund       — Pruefbefund in Klartext erlaeutern
 *   b) frageBeantworten     — Fachfragen zur Planung beantworten
 *   c) platzierenAufZuruf   — Planungsvorschlaege aus einem Befehl ableiten
 *
 * GRUNDSATZ AUS DEM LASTENHEFT: Die Rechenhoheit liegt bei der Regel-Engine
 * (shared/rules/engine.ts). Die KI formuliert, rechnet aber nicht. Und: Die KI
 * schreibt NIE selbst — platzierenAufZuruf liefert ausschliesslich Vorschlaege
 * zurueck, die ein Mensch bestaetigen muss.
 *
 * Faellt der API-Aufruf aus (kein Key, Netzfehler, Drosselung), antwortet
 * immer der lokale Weg mit quelle: 'lokal' — nie ein Absturz.
 */

import type {
  BBox,
  KiVorschlag,
  Masse,
  ObjektTyp,
  Pruefergebnis,
  Punkt,
} from '../../shared/domain/types.ts';
import { masseGueltig, masseVon } from '../../shared/domain/objekte.ts';
import { zahl } from '../../shared/geo/geometry.ts';
import { istVerfuegbar, nachricht } from './anthropic.ts';
import type { KiKontext } from './kontext.ts';
import { KEINE_ANGABE, kontextAlsText } from './kontext.ts';

export type KiQuelle = 'anthropic' | 'lokal';

/**
 * Wird auf JEDEM lokalen Weg angehaengt. Der lokale Weg greift in zwei Faellen:
 * kein API-Key gesetzt ODER der KI-Aufruf ist fehlgeschlagen (Netz, Drosselung,
 * leere Antwort). Der Text muss darum fuer beide Faelle stimmen — nie
 * spekulieren, welcher der beiden Gruende vorlag.
 */
const HINWEIS_LOKAL =
  'Es antwortet der lokale, regelbasierte Assistent (kein Anthropic-API-Key gesetzt oder KI-Dienst nicht erreichbar).';
const HINWEIS_BEHOERDE =
  'Diese Pruefung ist eine Planungshilfe und ersetzt nicht die behoerdliche Pruefung durch Ordnungsamt, Feuerwehr und Bauaufsicht.';

// ---------------------------------------------------------------------------
// Rate-Limit (Kostenkontrolle laut Lastenheft): 20 Anfragen je Nutzer / 10 min
// ---------------------------------------------------------------------------

const LIMIT_ANFRAGEN = 20;
const LIMIT_FENSTER_MS = 10 * 60 * 1000;
const anfrageLog = new Map<string, number[]>();

export function rateLimitPruefen(nutzerId: string): { erlaubt: boolean; wartenSek?: number } {
  const jetztMs = Date.now();
  const grenze = jetztMs - LIMIT_FENSTER_MS;

  // Gelegentlich aufraeumen, damit die Map nicht unbegrenzt waechst.
  if (anfrageLog.size > 500) {
    for (const [schluessel, liste] of anfrageLog) {
      const rest = liste.filter((t) => t > grenze);
      if (rest.length === 0) anfrageLog.delete(schluessel);
      else anfrageLog.set(schluessel, rest);
    }
  }

  const bisher = (anfrageLog.get(nutzerId) ?? []).filter((t) => t > grenze);
  if (bisher.length >= LIMIT_ANFRAGEN) {
    anfrageLog.set(nutzerId, bisher);
    const aeltester = bisher[0];
    const wartenSek = Math.max(1, Math.ceil((aeltester + LIMIT_FENSTER_MS - jetztMs) / 1000));
    return { erlaubt: false, wartenSek };
  }
  bisher.push(jetztMs);
  anfrageLog.set(nutzerId, bisher);
  return { erlaubt: true };
}

// ---------------------------------------------------------------------------
// Textwerkzeuge
// ---------------------------------------------------------------------------

/** Umlaute und Sonderzeichen vereinheitlichen — fuer Stichwortsuche. */
function normText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function kuerze(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// a) Befund erklaeren
// ---------------------------------------------------------------------------

function befundLokal(ergebnis: Pruefergebnis): string {
  const z: string[] = [];
  z.push(ergebnis.meldung);
  if (ergebnis.istWert !== null || ergebnis.sollWert !== null) {
    const ist = ergebnis.istWert === null ? KEINE_ANGABE : `${zahl(ergebnis.istWert)} ${ergebnis.einheit}`.trim();
    const soll = ergebnis.sollWert === null ? KEINE_ANGABE : `${zahl(ergebnis.sollWert)} ${ergebnis.einheit}`.trim();
    z.push(`Ist-Wert: ${ist}. Soll-Wert: ${soll}.`);
  }
  if (ergebnis.empfehlung?.text) z.push(`Empfehlung: ${ergebnis.empfehlung.text}`);
  z.push(`Regel: ${ergebnis.regelTitel} — Fundstelle ${ergebnis.fundstelle}`);
  z.push(HINWEIS_LOKAL);
  z.push(HINWEIS_BEHOERDE);
  return z.join('\n\n');
}

const SYSTEM_BEFUND =
  'Du bist ein deutschsprachiger Fachassistent fuer die Planung von Grossveranstaltungen (Volksfeste, ' +
  'Versammlungsstaetten im Freien).\n' +
  'DU HAST KEINE RECHENHOHEIT. Alle Zahlen, Ist-Werte, Soll-Werte und die Handlungsempfehlung wurden bereits ' +
  'von einer deterministischen Regel-Engine berechnet. UEBERNIMM DIE ZAHLEN UNVERAENDERT. Rechne nichts nach, ' +
  'leite keine neuen Werte ab, erfinde keine Masse, Abstaende oder Fristen.\n' +
  'Deine einzige Aufgabe: den vorgegebenen Befund und die vorgegebene Empfehlung verstaendlich umformulieren und ' +
  'erlaeutern — warum die Regel existiert, was praktisch zu tun ist.\n' +
  'Nenne immer die Regel-ID und die Fundstelle (Paragraf). Fehlt eine Angabe, schreibe ausdruecklich "k. A." ' +
  'und spekuliere nicht. Schreibe hoechstens 6 Saetze, sachlich, ohne Aufzaehlungszeichen-Wust.\n' +
  'Schliesse mit dem Hinweis, dass diese Pruefung die behoerdliche Pruefung nicht ersetzt.';

export async function erklaereBefund(opts: {
  ergebnis: Pruefergebnis;
  kontext: KiKontext;
}): Promise<{ text: string; quelle: KiQuelle }> {
  const e = opts.ergebnis;
  if (!istVerfuegbar()) return { text: befundLokal(e), quelle: 'lokal' };

  const befundText = [
    `Regel-ID: ${e.regelId}`,
    `Regeltitel: ${e.regelTitel}`,
    `Pruefart: ${e.pruefTyp}`,
    `Status: ${e.status}`,
    `Schweregrad: ${e.schweregrad}`,
    `Meldung (woertlich, nicht aendern): ${e.meldung}`,
    `Ist-Wert: ${e.istWert === null ? KEINE_ANGABE : `${zahl(e.istWert)} ${e.einheit}`.trim()}`,
    `Soll-Wert: ${e.sollWert === null ? KEINE_ANGABE : `${zahl(e.sollWert)} ${e.einheit}`.trim()}`,
    `Fundstelle: ${e.fundstelle}`,
    `Betroffene Elemente: ${e.elemente.map((r) => `${r.art} ${r.id}`).join(', ') || KEINE_ANGABE}`,
    `Berechnete Empfehlung (woertlich uebernehmen): ${e.empfehlung?.text ?? KEINE_ANGABE}`,
  ].join('\n');

  try {
    const antwort = await nachricht({
      system: SYSTEM_BEFUND,
      nachrichten: [
        {
          role: 'user',
          content:
            `Planungskontext (nur zur Einordnung, nicht nachrechnen):\n${kuerze(kontextAlsText(opts.kontext), 12000)}\n\n` +
            `Zu erlaeuternder Befund:\n${befundText}\n\n` +
            `Erlaeutere diesen Befund fuer den Veranstalter.`,
        },
      ],
      // Grosszuegig: deckt Denktokens (adaptives Denken ist per Vorgabe an) UND
      // die 6 Saetze Antworttext ab. Zu knapp = leere/abgeschnittene Antwort.
      maxTokens: 2000,
    });
    const text = antwort.text.trim();
    if (!text) return { text: befundLokal(e), quelle: 'lokal' };
    return { text, quelle: 'anthropic' };
  } catch {
    return { text: befundLokal(e), quelle: 'lokal' };
  }
}

// ---------------------------------------------------------------------------
// b) Frage beantworten
// ---------------------------------------------------------------------------

const SYSTEM_FRAGE =
  'Du bist ein deutschsprachiger Fachassistent fuer Veranstaltungsplanung (Versammlungsstaetten im Freien, ' +
  'Volksfeste, Rettungswege, Feuerwehrzufahrten).\n' +
  'Antworte knapp und sachlich — hoechstens 8 Saetze.\n' +
  'Beruht deine Antwort auf einer Regel, nenne IMMER den Regelbezug: Regel-ID und Paragraf aus dem Kontext.\n' +
  'Du rechnest nicht nach: alle Zahlen stammen aus dem Kontext und aus dem Pruefbericht der Regel-Engine und ' +
  'werden unveraendert uebernommen.\n' +
  'Fehlt eine Angabe im Kontext, schreibe ausdruecklich "k. A." — spekuliere niemals und erfinde keine Werte.\n' +
  'Weise am Ende darauf hin, dass diese Pruefung die behoerdliche Pruefung nicht ersetzt.';

function frageLokal(frage: string, k: KiKontext): string {
  const s = normText(frage);
  const z: string[] = [];
  const treffer: string[] = [];

  const rettungswege = k.wege.filter((w) => /rettungsweg/i.test(w.typ));
  const feuerwehrwege = k.wege.filter((w) => /feuerwehr/i.test(w.typ));
  const verstoesse = k.pruefung?.verstoesse ?? [];

  if (/rettungsweg|fluchtweg|notausgang|entfluchtung/.test(s)) {
    treffer.push('rettungsweg');
    if (rettungswege.length === 0) {
      z.push('Rettungswege: Es ist kein Weg vom Typ Rettungsweg geplant (k. A. zu Breiten und Laengen).');
    } else {
      z.push(
        `Rettungswege (${rettungswege.length}): ` +
          rettungswege
            .map((w) => `${w.name} ${zahl(w.breite)} m breit, ${zahl(w.laengeM, 1)} m lang`)
            .join('; ') +
          '.',
      );
    }
  }

  if (/breite|breit|meter|schmal|eng/.test(s)) {
    treffer.push('breite');
    if (k.wege.length === 0) z.push('Wegbreiten: Es sind keine Wege geplant (k. A.).');
    else {
      z.push(
        'Geplante Wegbreiten: ' +
          k.wege.map((w) => `${w.name} (${w.typ}) ${zahl(w.breite)} m`).join('; ') +
          '.',
      );
      const regeln = k.regelwerk.regeln.filter((r) => r.schwellwerte.minBreiteM !== undefined);
      if (regeln.length > 0) {
        z.push(
          'Massgebliche Mindestbreiten: ' +
            regeln.map((r) => `${r.id} ${r.titel} — ${r.quelle}: ${zahl(r.schwellwerte.minBreiteM)} m`).join('; ') +
            '.',
        );
      }
    }
  }

  if (/kapazitaet|besucher|personen|andrang/.test(s)) {
    treffer.push('kapazitaet');
    z.push(`Genehmigte maximale Besucherzahl laut Projekt: ${k.projekt.maxBesucher.toLocaleString('de-DE')}.`);
    const kap = verstoesse.filter((v) => /kapazit|besucher/i.test(`${v.regelTitel} ${v.meldung}`));
    if (kap.length > 0) {
      z.push('Dazu liegen Verstoesse vor: ' + kap.map((v) => `${v.regelId}: ${v.meldung}`).join(' ') + '');
    } else {
      const summe = rettungswege.reduce((a, w) => a + w.breite, 0);
      z.push(`Summe der geplanten Rettungswegbreiten: ${zahl(summe)} m.`);
    }
  }

  if (/feuerwehr|zufahrt|bewegungsflaeche|loeschwasser|hydrant/.test(s)) {
    treffer.push('feuerwehr');
    if (feuerwehrwege.length === 0) {
      z.push('Feuerwehr: Es ist keine Feuerwehrzufahrt und keine Bewegungsflaeche geplant (k. A.).');
    } else {
      z.push(
        `Feuerwehrflaechen (${feuerwehrwege.length}): ` +
          feuerwehrwege
            .map((w) => `${w.name} ${zahl(w.breite)} m breit, lichte Hoehe ${w.lichteHoehe}`)
            .join('; ') +
          '.',
      );
    }
    const fw = verstoesse.filter((v) => /feuerwehr/i.test(`${v.regelTitel} ${v.meldung}`));
    if (fw.length > 0) z.push('Verstoesse dazu: ' + fw.map((v) => `${v.regelId}: ${v.meldung}`).join(' '));
  }

  if (/abstand|abstaende|nachbar|kollision|ueberlapp/.test(s)) {
    treffer.push('abstand');
    const ab = verstoesse.filter((v) => /abstand|ueberlapp/i.test(`${v.regelTitel} ${v.meldung}`));
    if (ab.length === 0) z.push('Abstaende: Der aktuelle Pruefbericht meldet keine Abstandsverstoesse.');
    else z.push('Abstandsverstoesse: ' + ab.map((v) => `${v.regelId}: ${v.meldung} (${v.empfehlung})`).join(' '));
    const regeln = k.regelwerk.regeln.filter((r) => r.schwellwerte.minAbstandM !== undefined);
    if (regeln.length > 0) {
      z.push(
        'Massgebliche Mindestabstaende: ' +
          regeln.map((r) => `${r.id} ${r.titel} — ${r.quelle}: ${zahl(r.schwellwerte.minAbstandM)} m`).join('; ') +
          '.',
      );
    }
  }

  if (treffer.length === 0) {
    z.push(
      `Zur Frage liegt kein passendes Stichwort vor. Allgemeiner Stand von "${k.projekt.name}": ` +
        `${k.objekte.anzahl} Objekte, ${k.wege.length} Wege, ${k.einsatzstationen.length} Einsatzstationen, ` +
        `${k.projekt.maxBesucher.toLocaleString('de-DE')} Besucher maximal.`,
    );
    if (k.pruefung) {
      const zf = k.pruefung.zusammenfassung;
      z.push(`Pruefbilanz: ${zf.fehler} Fehler, ${zf.warnungen} Warnungen, ${zf.hinweise} Hinweise, ${zf.ok} in Ordnung.`);
      for (const v of k.pruefung.verstoesse.slice(0, 5)) z.push(`- ${v.regelId}: ${v.meldung}`);
    } else {
      z.push('Es liegt noch kein Pruefbericht vor (k. A.).');
    }
  }

  z.push(HINWEIS_LOKAL);
  z.push(HINWEIS_BEHOERDE);
  return z.join('\n');
}

export async function frageBeantworten(opts: {
  frage: string;
  kontext: KiKontext;
  verlauf?: { rolle: 'nutzer' | 'assistent'; text: string }[];
}): Promise<{ text: string; quelle: KiQuelle }> {
  const frage = (opts.frage ?? '').trim();
  if (!frage) {
    return { text: `Es wurde keine Frage uebergeben (${KEINE_ANGABE}).`, quelle: 'lokal' };
  }
  if (!istVerfuegbar()) return { text: frageLokal(frage, opts.kontext), quelle: 'lokal' };

  const verlauf = (opts.verlauf ?? []).slice(-8);
  const nachrichten: { role: 'user' | 'assistant'; content: any }[] = [];
  nachrichten.push({
    role: 'user',
    content: `Aktueller Planungsstand:\n${kuerze(kontextAlsText(opts.kontext), 24000)}`,
  });
  nachrichten.push({ role: 'assistant', content: 'Planungsstand gelesen. Stelle deine Frage.' });
  for (const v of verlauf) {
    nachrichten.push({ role: v.rolle === 'nutzer' ? 'user' : 'assistant', content: v.text });
  }
  nachrichten.push({ role: 'user', content: frage });

  try {
    const antwort = await nachricht({ system: SYSTEM_FRAGE, nachrichten, maxTokens: 2500 });
    const text = antwort.text.trim();
    if (!text) return { text: frageLokal(frage, opts.kontext), quelle: 'lokal' };
    return { text, quelle: 'anthropic' };
  } catch {
    return { text: frageLokal(frage, opts.kontext), quelle: 'lokal' };
  }
}

// ---------------------------------------------------------------------------
// c) Platzieren auf Zuruf
//
// WICHTIG (Lastenheft): Die KI darf NIE ohne Bestaetigung schreiben. Diese
// Funktion aendert nichts am Projekt — sie liefert ausschliesslich Vorschlaege
// zurueck, die der Nutzer im Editor einzeln bestaetigen oder verwerfen muss.
// ---------------------------------------------------------------------------

/** Relative Ortsangaben als Anteil der Gebiets-Bbox (x = Ost, y = Nord). */
const RELATIVE_ORTE: Record<string, [number, number]> = {
  mitte: [0.5, 0.5],
  nordseite: [0.5, 0.85],
  suedseite: [0.5, 0.15],
  ostseite: [0.85, 0.5],
  westseite: [0.15, 0.5],
  nordostecke: [0.85, 0.85],
  nordwestecke: [0.15, 0.85],
  suedostecke: [0.85, 0.15],
  suedwestecke: [0.15, 0.15],
};

/** Freitext-Synonyme -> kanonische Ortsangabe. Laengere Schluessel zuerst pruefen. */
const RELATIV_SYNONYME: Record<string, string> = {
  nordwestecke: 'nordwestecke',
  nordwesten: 'nordwestecke',
  nordwest: 'nordwestecke',
  nordostecke: 'nordostecke',
  nordosten: 'nordostecke',
  nordost: 'nordostecke',
  suedwestecke: 'suedwestecke',
  suedwesten: 'suedwestecke',
  suedwest: 'suedwestecke',
  suedostecke: 'suedostecke',
  suedosten: 'suedostecke',
  suedost: 'suedostecke',
  nordseite: 'nordseite',
  noerdlich: 'nordseite',
  norden: 'nordseite',
  nord: 'nordseite',
  suedseite: 'suedseite',
  suedlich: 'suedseite',
  sueden: 'suedseite',
  sued: 'suedseite',
  ostseite: 'ostseite',
  oestlich: 'ostseite',
  osten: 'ostseite',
  ost: 'ostseite',
  westseite: 'westseite',
  westlich: 'westseite',
  westen: 'westseite',
  west: 'westseite',
  zentrum: 'mitte',
  zentral: 'mitte',
  mittig: 'mitte',
  mitte: 'mitte',
};

const ZAHLWOERTER: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};

function kanonischerOrt(roh: string | null | undefined): string | null {
  const s = normText(roh ?? '').replace(/\s+/g, '');
  if (!s) return null;
  if (RELATIVE_ORTE[s]) return s;
  const schluessel = Object.keys(RELATIV_SYNONYME).sort((a, b) => b.length - a.length);
  for (const k of schluessel) if (s.includes(k)) return RELATIV_SYNONYME[k];
  return null;
}

function ortAusBefehl(befehl: string): string | null {
  const s = normText(befehl).replace(/\s+/g, '');
  const schluessel = Object.keys(RELATIV_SYNONYME).sort((a, b) => b.length - a.length);
  for (const k of schluessel) if (s.includes(k)) return RELATIV_SYNONYME[k];
  return null;
}

/** Rechnet eine relative Ortsangabe deterministisch in EPSG:25832 um. */
export function relativerPunkt(gebiet: BBox, ortWort: string | null | undefined): Punkt | null {
  const ort = kanonischerOrt(ortWort);
  if (!ort) return null;
  const [fx, fy] = RELATIVE_ORTE[ort];
  return [gebiet.minE + (gebiet.maxE - gebiet.minE) * fx, gebiet.minN + (gebiet.maxN - gebiet.minN) * fy];
}

function inGebiet(p: Punkt, gebiet: BBox, rand: number): Punkt {
  const minE = Math.min(gebiet.minE + rand, gebiet.maxE);
  const maxE = Math.max(gebiet.maxE - rand, gebiet.minE);
  const minN = Math.min(gebiet.minN + rand, gebiet.maxN);
  const maxN = Math.max(gebiet.maxN - rand, gebiet.minN);
  return [Math.min(Math.max(p[0], minE), maxE), Math.min(Math.max(p[1], minN), maxN)];
}

function gebietPlausibel(p: Punkt, gebiet: BBox): boolean {
  const spanE = Math.max(1, gebiet.maxE - gebiet.minE);
  const spanN = Math.max(1, gebiet.maxN - gebiet.minN);
  return (
    p[0] > gebiet.minE - spanE &&
    p[0] < gebiet.maxE + spanE &&
    p[1] > gebiet.minN - spanN &&
    p[1] < gebiet.maxN + spanN
  );
}

/**
 * Suchbegriffe je Objekttyp: der ganze Name, jedes Namensstueck vor/in
 * Klammern und Schraegstrichen, sowie einzelne lange Woerter. So findet
 * "zwei Mobiltoiletten" auch den Typ "Mobiltoilette (Einzelkabine)".
 */
function typSchluessel(typ: ObjektTyp): string[] {
  const teile = new Set<string>();
  const uebernehmen = (text: string) => {
    const n = normText(text);
    if (!n) return;
    const ohneLeer = n.replace(/\s+/g, '');
    if (ohneLeer.length >= 4) teile.add(ohneLeer);
    for (const wort of n.split(' ')) if (wort.length >= 6) teile.add(wort);
  };
  for (const stueck of typ.name.split(/[()\/,+]/)) uebernehmen(stueck);
  uebernehmen(typ.name);
  uebernehmen(typ.id);
  return [...teile].sort((a, b) => b.length - a.length);
}

function typAusBefehl(befehl: string, typen: ObjektTyp[]): ObjektTyp | null {
  const s = normText(befehl).replace(/\s+/g, '');
  let bester: ObjektTyp | null = null;
  let besteLaenge = 0;
  for (const t of typen) {
    for (const k of typSchluessel(t)) {
      if (k.length > besteLaenge && s.includes(k)) {
        bester = t;
        besteLaenge = k.length;
      }
    }
  }
  return bester;
}

function typFinden(kennung: string | null | undefined, typen: ObjektTyp[]): ObjektTyp | null {
  const roh = (kennung ?? '').trim();
  if (!roh) return null;
  const direkt = typen.find((t) => t.id === roh);
  if (direkt) return direkt;
  const n = normText(roh).replace(/\s+/g, '');
  return (
    typen.find((t) => normText(t.id).replace(/\s+/g, '') === n) ??
    typen.find((t) => normText(t.name).replace(/\s+/g, '') === n) ??
    null
  );
}

function anzahlAusBefehl(befehl: string): number {
  const s = normText(befehl);
  const ziffer = s.match(/(^|\s)(\d{1,2})(\s|$)/);
  if (ziffer) {
    const n = Number.parseInt(ziffer[2], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
  }
  for (const [wort, n] of Object.entries(ZAHLWOERTER)) {
    if (new RegExp(`(^|\\s)${wort}(\\s|$)`).test(s)) return n;
  }
  return 1;
}

function objektGrundmass(typ: ObjektTyp): { laenge: number; breite: number } {
  const m = masseVon(typ, {});
  if (typ.form === 'kreis') {
    const d = Math.max(m.laenge, m.breite);
    return { laenge: d, breite: d };
  }
  return { laenge: m.laenge, breite: m.breite };
}

/** Verteilt n Objekte in einer Reihe (Ost-West) um einen Basispunkt. */
function reihePunkte(basis: Punkt, anzahl: number, typ: ObjektTyp, gebiet: BBox): Punkt[] {
  const g = objektGrundmass(typ);
  const schritt = Math.max(2, g.laenge + typ.flaechenbedarfZusatz * 2 + 1);
  const rand = Math.max(g.laenge, g.breite) / 2 + typ.flaechenbedarfZusatz;
  const start = basis[0] - ((anzahl - 1) / 2) * schritt;
  const out: Punkt[] = [];
  for (let i = 0; i < anzahl; i++) out.push(inGebiet([start + i * schritt, basis[1]], gebiet, rand));
  return out;
}

function parameterAus(
  typ: ObjektTyp,
  roh: { laengeM?: unknown; breiteM?: unknown; hoeheM?: unknown },
): Partial<Masse> | undefined {
  if (!typ.parametrisierbar) return undefined;
  const m: Partial<Masse> = {};
  if (typeof roh.laengeM === 'number' && Number.isFinite(roh.laengeM)) m.laenge = roh.laengeM;
  if (typeof roh.breiteM === 'number' && Number.isFinite(roh.breiteM)) m.breite = roh.breiteM;
  if (typeof roh.hoeheM === 'number' && Number.isFinite(roh.hoeheM)) m.hoehe = roh.hoeheM;
  if (Object.keys(m).length === 0) return undefined;
  return masseGueltig(typ, m).ok ? m : undefined;
}

// -- Werkzeugdefinition (striktes JSON-Schema) -------------------------------
//
// `strict: true` wird bewusst NICHT gesetzt: die drei Aktionen brauchen
// unterschiedliche Felder, und der strikte Modus verlangt, dass jedes
// Property auch in `required` steht. Stattdessen ist das Schema hier eng
// beschrieben UND jede Rueckgabe wird unten deterministisch nachvalidiert;
// alles, was nicht passt, wird verworfen.

const WERKZEUG_PLANUNGSVORSCHLAG = {
  name: 'planungsvorschlag',
  description:
    'Liefert Planungsvorschlaege fuer die Veranstaltungsflaeche. Jeder Vorschlag ist ein UNVERBINDLICHER ' +
    'Vorschlag, der vom Menschen bestaetigt werden muss — es wird nichts direkt geaendert.',
  input_schema: {
    type: 'object',
    properties: {
      erlaeuterung: {
        type: 'string',
        description: 'Kurze Erlaeuterung auf Deutsch, was vorgeschlagen wird und warum.',
      },
      vorschlaege: {
        type: 'array',
        description: 'Liste der Vorschlaege, hoechstens 20.',
        items: {
          type: 'object',
          properties: {
            aktion: {
              type: 'string',
              enum: ['platzieren', 'verschieben', 'weg_aendern'],
              description: 'Art des Vorschlags.',
            },
            typId: {
              type: 'string',
              description: 'Nur bei aktion=platzieren: ID eines Objekttyps aus der Bibliothek.',
            },
            objektId: {
              type: 'string',
              description: 'Nur bei aktion=verschieben: ID eines vorhandenen Objekts aus dem Kontext.',
            },
            wegId: {
              type: 'string',
              description: 'Nur bei aktion=weg_aendern: ID eines vorhandenen Weges aus dem Kontext.',
            },
            ostwert: {
              type: 'number',
              description: 'Rechtswert E in EPSG:25832 (Meter). Nur bei platzieren/verschieben.',
            },
            nordwert: {
              type: 'number',
              description: 'Hochwert N in EPSG:25832 (Meter). Nur bei platzieren/verschieben.',
            },
            relativePosition: {
              type: 'string',
              enum: [
                'mitte',
                'nordseite',
                'suedseite',
                'ostseite',
                'westseite',
                'nordostecke',
                'nordwestecke',
                'suedostecke',
                'suedwestecke',
              ],
              description:
                'Alternative zu ostwert/nordwert, wenn keine genauen Koordinaten bekannt sind. Der Server ' +
                'rechnet die Angabe deterministisch aus der Gebiets-Bbox in EPSG:25832 um.',
            },
            rotationGrad: {
              type: 'number',
              description: 'Drehung in Grad im Uhrzeigersinn, 0 = Objektvorderseite zeigt nach Norden.',
            },
            breite: {
              type: 'number',
              description: 'Nur bei aktion=weg_aendern: neue Wegbreite in Metern.',
            },
            laengeM: { type: 'number', description: 'Optionale Laenge in Metern (nur parametrisierbare Typen).' },
            breiteM: { type: 'number', description: 'Optionale Breite in Metern (nur parametrisierbare Typen).' },
            hoeheM: { type: 'number', description: 'Optionale Hoehe in Metern (nur parametrisierbare Typen).' },
            begruendung: { type: 'string', description: 'Kurze fachliche Begruendung auf Deutsch.' },
          },
          required: ['aktion', 'begruendung'],
          additionalProperties: false,
        },
      },
    },
    required: ['erlaeuterung', 'vorschlaege'],
    additionalProperties: false,
  },
};

function systemPlatzieren(gebiet: BBox, typen: ObjektTyp[], kontext: KiKontext): string {
  const mitteE = Math.round((gebiet.minE + gebiet.maxE) / 2);
  const mitteN = Math.round((gebiet.minN + gebiet.maxN) / 2);
  const liste = typen
    .map((t) => {
      const m = t.masse;
      return `${t.id} | ${t.name} | ${t.kategorie} | ${zahl(m.laenge)}x${zahl(m.breite)}x${zahl(m.hoehe)} m | Umlauf ${zahl(t.flaechenbedarfZusatz)} m`;
    })
    .join('\n');

  return (
    'Du bist ein deutschsprachiger Planungsassistent fuer Grossveranstaltungen.\n' +
    'Du AENDERST NICHTS. Du lieferst ausschliesslich Vorschlaege, die ein Mensch bestaetigen muss.\n' +
    'Rufe fuer deine Antwort IMMER das Werkzeug "planungsvorschlag" auf — auch wenn du nur einen einzigen ' +
    'Vorschlag hast. Antworte nicht nur mit Fliesstext.\n\n' +
    'KOORDINATEN: Alle Positionen sind Rechts-/Hochwerte in EPSG:25832 (ETRS89 / UTM Zone 32N) in METERN.\n' +
    `Das Planungsgebiet reicht von E ${Math.round(gebiet.minE)} bis E ${Math.round(gebiet.maxE)} und ` +
    `von N ${Math.round(gebiet.minN)} bis N ${Math.round(gebiet.maxN)}.\n` +
    `Beispiel Gebietsmitte: ostwert=${mitteE}, nordwert=${mitteN}. ` +
    `Beispiel Suedwestecke: ostwert=${Math.round(gebiet.minE + (gebiet.maxE - gebiet.minE) * 0.15)}, ` +
    `nordwert=${Math.round(gebiet.minN + (gebiet.maxN - gebiet.minN) * 0.15)}.\n` +
    'Positionen MUESSEN innerhalb dieses Gebiets liegen. Wenn du keine genauen Koordinaten nennen kannst, ' +
    'lasse ostwert/nordwert weg und setze stattdessen relativePosition (z. B. "nordseite", "mitte", ' +
    '"suedwestecke") — der Server rechnet das deterministisch um.\n\n' +
    'REGELN: Halte Rettungswege, Feuerwehrzufahrten und Blockflaechen frei. Beachte den Umlauf ' +
    '(flaechenbedarfZusatz) je Objekttyp. Erfinde keine Objekttypen und keine Objekt-/Weg-IDs — verwende nur ' +
    'die unten bzw. im Kontext genannten. Fehlt eine Angabe, schreibe "k. A." in die Begruendung.\n\n' +
    `VERFUEGBARE OBJEKTTYPEN (id | Name | Kategorie | LxBxH | Umlauf):\n${liste}\n\n` +
    `Regelwerk: ${kontext.regelwerk.bezeichnung} (${kontext.regelwerk.id}, Version ${kontext.regelwerk.version}).`
  );
}

interface RohVorschlag {
  aktion?: unknown;
  typId?: unknown;
  objektId?: unknown;
  wegId?: unknown;
  ostwert?: unknown;
  nordwert?: unknown;
  relativePosition?: unknown;
  rotationGrad?: unknown;
  breite?: unknown;
  laengeM?: unknown;
  breiteM?: unknown;
  hoeheM?: unknown;
  begruendung?: unknown;
}

function positionAus(roh: RohVorschlag, gebiet: BBox, rand: number): Punkt | null {
  const e = roh.ostwert;
  const n = roh.nordwert;
  if (typeof e === 'number' && typeof n === 'number' && Number.isFinite(e) && Number.isFinite(n)) {
    const p: Punkt = [e, n];
    if (gebietPlausibel(p, gebiet)) return inGebiet(p, gebiet, rand);
  }
  const rel = relativerPunkt(gebiet, typeof roh.relativePosition === 'string' ? roh.relativePosition : null);
  return rel ? inGebiet(rel, gebiet, rand) : null;
}

/** Prueft einen Rohvorschlag der KI und wandelt ihn in einen gueltigen KiVorschlag. */
function normalisiereVorschlag(
  roh: RohVorschlag,
  typen: ObjektTyp[],
  kontext: KiKontext,
  gebiet: BBox,
): { vorschlag: KiVorschlag | null; fehler: string | null } {
  const aktion = typeof roh.aktion === 'string' ? roh.aktion : '';
  const begruendung = typeof roh.begruendung === 'string' && roh.begruendung.trim() ? roh.begruendung.trim() : KEINE_ANGABE;

  if (aktion === 'platzieren') {
    const typ = typFinden(typeof roh.typId === 'string' ? roh.typId : null, typen);
    if (!typ) return { vorschlag: null, fehler: `Unbekannter Objekttyp "${String(roh.typId ?? '')}" verworfen.` };
    const g = objektGrundmass(typ);
    const rand = Math.max(g.laenge, g.breite) / 2 + typ.flaechenbedarfZusatz;
    const position = positionAus(roh, gebiet, rand);
    if (!position) {
      return { vorschlag: null, fehler: `Vorschlag fuer ${typ.name} ohne verwertbare Position verworfen.` };
    }
    const rotation =
      typeof roh.rotationGrad === 'number' && Number.isFinite(roh.rotationGrad)
        ? ((roh.rotationGrad % 360) + 360) % 360
        : 0;
    const parameter = parameterAus(typ, roh);
    const v: KiVorschlag = parameter
      ? { aktion: 'platzieren', typId: typ.id, position, rotation, parameter, begruendung }
      : { aktion: 'platzieren', typId: typ.id, position, rotation, begruendung };
    return { vorschlag: v, fehler: null };
  }

  if (aktion === 'verschieben') {
    const objektId = typeof roh.objektId === 'string' ? roh.objektId.trim() : '';
    const bekannt = kontext.objekte.liste.some((o) => o.id === objektId);
    if (!objektId || !bekannt) {
      const grund = kontext.objekte.gekuerzt
        ? `Verschiebe-Vorschlag fuer "${objektId || KEINE_ANGABE}" verworfen: die Objektliste ist gekuerzt, die ID ist nicht pruefbar.`
        : `Verschiebe-Vorschlag fuer unbekannte Objekt-ID "${objektId || KEINE_ANGABE}" verworfen.`;
      return { vorschlag: null, fehler: grund };
    }
    const position = positionAus(roh, gebiet, 0);
    if (!position) {
      return { vorschlag: null, fehler: `Verschiebe-Vorschlag fuer ${objektId} ohne verwertbare Position verworfen.` };
    }
    return { vorschlag: { aktion: 'verschieben', objektId, position, begruendung }, fehler: null };
  }

  if (aktion === 'weg_aendern') {
    const wegId = typeof roh.wegId === 'string' ? roh.wegId.trim() : '';
    if (!wegId || !kontext.wege.some((w) => w.id === wegId)) {
      return { vorschlag: null, fehler: `Weg-Vorschlag fuer unbekannte Weg-ID "${wegId || KEINE_ANGABE}" verworfen.` };
    }
    const breite = typeof roh.breite === 'number' && Number.isFinite(roh.breite) ? +roh.breite.toFixed(2) : NaN;
    if (!Number.isFinite(breite) || breite <= 0 || breite > 100) {
      return { vorschlag: null, fehler: `Weg-Vorschlag fuer ${wegId} ohne plausible Breite verworfen.` };
    }
    return { vorschlag: { aktion: 'weg_aendern', wegId, breite, begruendung }, fehler: null };
  }

  return { vorschlag: null, fehler: `Unbekannte Aktion "${aktion || KEINE_ANGABE}" verworfen.` };
}

/** Deterministischer Fallback: Kommandoerkennung per regulaerem Ausdruck. */
function platzierenLokal(
  befehl: string,
  typen: ObjektTyp[],
  gebiet: BBox,
): { vorschlaege: KiVorschlag[]; text: string } {
  const typ = typAusBefehl(befehl, typen);
  const ortWort = ortAusBefehl(befehl);
  if (!typ) {
    return {
      vorschlaege: [],
      text:
        `${HINWEIS_LOKAL}\n` +
        `Aus dem Befehl "${kuerze(befehl, 120)}" konnte kein Objekttyp aus der Bibliothek erkannt werden (k. A.). ` +
        `Bitte den Typnamen ausschreiben, z. B. "3 Toilettenwagen an die Nordseite".`,
    };
  }
  const anzahl = anzahlAusBefehl(befehl);
  const basis = relativerPunkt(gebiet, ortWort ?? 'mitte') ?? [
    (gebiet.minE + gebiet.maxE) / 2,
    (gebiet.minN + gebiet.maxN) / 2,
  ];
  const ortName = ortWort ?? 'mitte';
  const punkte = reihePunkte(basis, anzahl, typ, gebiet);
  const vorschlaege: KiVorschlag[] = punkte.map((p, i) => ({
    aktion: 'platzieren',
    typId: typ.id,
    position: [+p[0].toFixed(2), +p[1].toFixed(2)],
    rotation: 0,
    begruendung:
      `Lokal abgeleitet aus dem Befehl: ${typ.name} Nr. ${i + 1} von ${anzahl}, Zielbereich "${ortName}". ` +
      `Abstand ${zahl(Math.max(2, objektGrundmass(typ).laenge + typ.flaechenbedarfZusatz * 2 + 1))} m zwischen den Objekten. ` +
      `Fachliche Pruefung steht aus (k. A.).`,
  }));
  return {
    vorschlaege,
    text:
      `${HINWEIS_LOKAL}\n` +
      `Erkannt: ${anzahl} x ${typ.name} (${typ.id}) im Bereich "${ortName}". ` +
      `Die Positionen wurden deterministisch aus der Gebiets-Bbox berechnet und sind unverbindliche Vorschlaege — ` +
      `sie werden erst nach Bestaetigung uebernommen. ${HINWEIS_BEHOERDE}`,
  };
}

export async function platzierenAufZuruf(opts: {
  befehl: string;
  kontext: KiKontext;
  typen: ObjektTyp[];
  gebiet: BBox;
}): Promise<{ vorschlaege: KiVorschlag[]; text: string; quelle: KiQuelle }> {
  const befehl = (opts.befehl ?? '').trim();
  const typen = opts.typen ?? [];
  if (!befehl) {
    return { vorschlaege: [], text: `Es wurde kein Befehl uebergeben (${KEINE_ANGABE}).`, quelle: 'lokal' };
  }
  if (!istVerfuegbar() || typen.length === 0) {
    const lokal = platzierenLokal(befehl, typen, opts.gebiet);
    return { ...lokal, quelle: 'lokal' };
  }

  try {
    const antwort = await nachricht({
      system: systemPlatzieren(opts.gebiet, typen, opts.kontext),
      nachrichten: [
        {
          role: 'user',
          content:
            `Aktueller Planungsstand:\n${kuerze(kontextAlsText(opts.kontext), 20000)}\n\n` +
            `Befehl des Veranstalters:\n${befehl}\n\n` +
            `Erzeuge dazu Planungsvorschlaege ueber das Werkzeug "planungsvorschlag".`,
        },
      ],
      werkzeuge: [WERKZEUG_PLANUNGSVORSCHLAG],
      // Bis zu 20 Vorschlaege als Werkzeug-JSON plus Denktokens — hier ist das
      // Budget am knappsten, darum die groesste Reserve.
      maxTokens: 4000,
    });

    const aufruf = antwort.werkzeugAufrufe.find((w) => w.name === 'planungsvorschlag');
    if (!aufruf) {
      const lokal = platzierenLokal(befehl, typen, opts.gebiet);
      return {
        vorschlaege: lokal.vorschlaege,
        text: `${antwort.text ? `${antwort.text}\n\n` : ''}${lokal.text}`,
        quelle: 'lokal',
      };
    }

    const eingabe = aufruf.eingabe ?? {};
    const roh: RohVorschlag[] = Array.isArray(eingabe.vorschlaege) ? eingabe.vorschlaege.slice(0, 20) : [];
    const vorschlaege: KiVorschlag[] = [];
    const verworfen: string[] = [];
    for (const r of roh) {
      const { vorschlag, fehler } = normalisiereVorschlag(r, typen, opts.kontext, opts.gebiet);
      if (vorschlag) vorschlaege.push(vorschlag);
      else if (fehler) verworfen.push(fehler);
    }

    if (vorschlaege.length === 0) {
      const lokal = platzierenLokal(befehl, typen, opts.gebiet);
      const grund = verworfen.length > 0 ? `\nVerworfen: ${verworfen.join(' ')}` : '';
      return { vorschlaege: lokal.vorschlaege, text: `${lokal.text}${grund}`, quelle: 'lokal' };
    }

    const erlaeuterung =
      typeof eingabe.erlaeuterung === 'string' && eingabe.erlaeuterung.trim()
        ? eingabe.erlaeuterung.trim()
        : antwort.text.trim();
    const teile = [erlaeuterung || `${vorschlaege.length} Vorschlaege erzeugt.`];
    if (verworfen.length > 0) teile.push(`Nicht uebernommen: ${verworfen.join(' ')}`);
    teile.push(
      `${vorschlaege.length} Vorschlaege — sie aendern noch nichts und muessen einzeln bestaetigt werden. ${HINWEIS_BEHOERDE}`,
    );

    return { vorschlaege, text: teile.join('\n\n'), quelle: 'anthropic' };
  } catch {
    const lokal = platzierenLokal(befehl, typen, opts.gebiet);
    return { ...lokal, quelle: 'lokal' };
  }
}
