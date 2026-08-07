/**
 * Betreiberliste (Lastenheft F10.3) als CSV und PDF.
 *
 * DSGVO: Kontaktdaten (Ansprechpartner, E-Mail, Telefon) sind nur fuer Rollen
 * mit dem Recht `kontaktdaten.sehen` sichtbar. Fehlt das Recht, stehen in der
 * Ausgabe nicht etwa leere Felder, sondern der Klartext „gesperrt (DSGVO)“ —
 * die Sperrung soll erkennbar sein, damit niemand sie fuer fehlende Daten haelt.
 */

import type {
  Nutzer,
  ObjektInstanz,
  ObjektStatus,
  ObjektTyp,
  Organisation,
  ProjektInhalt,
} from '../../shared/domain/types.ts';
import { KATEGORIE_LABEL } from '../../shared/domain/types.ts';
import { masseVon } from '../../shared/domain/objekte.ts';
import { zahl } from '../../shared/geo/geometry.ts';
import type { TabellenSpalte } from './pdf-basis.ts';
import { FARBEN, absatz, alsBuffer, fusszeile, kopfzeile, neuesDokument, tabelle } from './pdf-basis.ts';

export interface BetreiberZeile {
  standNummer: string;
  objekt: string;
  betreiberFirma: string;
  ansprechpartner: string;
  email: string;
  telefon: string;
  kategorie: string;
  masse: string;
  position: string;
  status: string;
}

export const GESPERRT = 'gesperrt (DSGVO)';

const STATUS_LABEL_OBJEKT: Record<ObjektStatus, string> = {
  geplant: 'Geplant',
  bestaetigt: 'Bestaetigt',
  aufgebaut: 'Aufgebaut',
};

/** "E 475123, N 5522456" — ganze Meter, EPSG:25832. */
export function positionsText(inst: ObjektInstanz): string {
  return `E ${Math.round(inst.position[0])}, N ${Math.round(inst.position[1])}`;
}

function masseText(typ: ObjektTyp | undefined, inst: ObjektInstanz): string {
  if (!typ) return 'k. A.';
  const m = masseVon(typ, inst);
  return `${zahl(m.laenge)} x ${zahl(m.breite)} x ${zahl(m.hoehe)} m`;
}

function ansprechpartnerVon(orgId: string | undefined, nutzerListe: Nutzer[]): Nutzer | undefined {
  if (!orgId) return undefined;
  const eigene = nutzerListe.filter((n) => n.orgId === orgId);
  return eigene.find((n) => n.rolleInOrg === 'admin') ?? eigene[0];
}

/** Sortierung: Standnummer natuerlich (2 vor 10), danach Objektname. */
function vergleiche(a: BetreiberZeile, b: BetreiberZeile): number {
  const za = Number.parseFloat(a.standNummer);
  const zb = Number.parseFloat(b.standNummer);
  const aZahl = Number.isFinite(za);
  const bZahl = Number.isFinite(zb);
  if (aZahl && bZahl && za !== zb) return za - zb;
  if (aZahl !== bZahl) return aZahl ? -1 : 1;
  const s = a.standNummer.localeCompare(b.standNummer, 'de');
  return s !== 0 ? s : a.objekt.localeCompare(b.objekt, 'de');
}

export function betreiberZeilen(
  inhalt: ProjektInhalt,
  typen: Map<string, ObjektTyp>,
  organisationen: Organisation[],
  nutzerListe: Nutzer[],
  kontaktSichtbar: boolean,
): BetreiberZeile[] {
  const orgs = new Map<string, Organisation>();
  for (const o of organisationen) orgs.set(o.id, o);

  const zeilen: BetreiberZeile[] = inhalt.objekte.map((inst) => {
    const typ = typen.get(inst.typId);
    const org = inst.betreiberOrgId ? orgs.get(inst.betreiberOrgId) : undefined;
    const person = ansprechpartnerVon(inst.betreiberOrgId, nutzerListe);
    const firma = org ? org.name : inst.betreiberOrgId ? `Organisation ${inst.betreiberOrgId} (unbekannt)` : 'nicht zugewiesen';
    return {
      standNummer: inst.standNummer ?? 'k. A.',
      objekt: typ ? typ.name : `${inst.typId} (Typ unbekannt)`,
      betreiberFirma: firma,
      ansprechpartner: kontaktSichtbar ? (person?.name ?? 'k. A.') : GESPERRT,
      email: kontaktSichtbar ? (person?.email ?? 'k. A.') : GESPERRT,
      // Im Datenmodell ist keine Telefonnummer gefuehrt — darum ehrlich "k. A.".
      telefon: kontaktSichtbar ? 'k. A.' : GESPERRT,
      kategorie: typ ? KATEGORIE_LABEL[typ.kategorie] : 'k. A.',
      masse: masseText(typ, inst),
      position: positionsText(inst),
      status: STATUS_LABEL_OBJEKT[inst.status] ?? String(inst.status),
    };
  });
  zeilen.sort(vergleiche);
  return zeilen;
}

// ---------------------------------------------------------------------------
// CSV (deutsches Excel: Semikolon, UTF-8 mit BOM, CRLF)
// ---------------------------------------------------------------------------

const CSV_KOPF = [
  'Stand-Nr.',
  'Objekt',
  'Kategorie',
  'Masse (L x B x H)',
  'Position (EPSG:25832)',
  'Betreiber',
  'Ansprechpartner',
  'E-Mail',
  'Telefon',
  'Status',
];

function csvWert(v: string): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ');
  if (/[";\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function betreiberlisteCsv(zeilen: BetreiberZeile[]): string {
  const aus: string[] = [CSV_KOPF.map(csvWert).join(';')];
  for (const z of zeilen) {
    aus.push(
      [
        z.standNummer,
        z.objekt,
        z.kategorie,
        z.masse,
        z.position,
        z.betreiberFirma,
        z.ansprechpartner,
        z.email,
        z.telefon,
        z.status,
      ]
        .map(csvWert)
        .join(';'),
    );
  }
  // UTF-8-BOM voran, sonst zeigt Excel die Umlaute falsch an.
  return `\uFEFF${aus.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// PDF (A4 quer)
// ---------------------------------------------------------------------------

/** Spaltenraster der Betreiberliste — passt auf A4 quer mit 40 pt Rand. */
export const BETREIBER_SPALTEN: TabellenSpalte[] = [
  { titel: 'Stand-Nr.', breite: 42 },
  { titel: 'Objekt', breite: 112 },
  { titel: 'Kategorie', breite: 62 },
  { titel: 'Masse (L x B x H)', breite: 84 },
  { titel: 'Position (EPSG:25832)', breite: 92 },
  { titel: 'Betreiber', breite: 100 },
  { titel: 'Ansprechpartner', breite: 72 },
  { titel: 'E-Mail', breite: 96 },
  { titel: 'Telefon', breite: 52 },
  { titel: 'Status', breite: 48 },
];

export function betreiberTabellenZeilen(zeilen: BetreiberZeile[]): string[][] {
  return zeilen.map((z) => [
    z.standNummer,
    z.objekt,
    z.kategorie,
    z.masse,
    z.position,
    z.betreiberFirma,
    z.ansprechpartner,
    z.email,
    z.telefon,
    z.status,
  ]);
}

export async function betreiberlistePdf(
  zeilen: BetreiberZeile[],
  titel: string,
  untertitel: string,
): Promise<Buffer> {
  const doc = neuesDokument({ titel, querformat: true });
  fusszeile(doc, `${titel} | ${zeilen.length} Objekte | Kontaktdaten unterliegen der DSGVO`);
  kopfzeile(doc, titel, untertitel);

  const gesperrt = zeilen.some((z) => z.ansprechpartner === GESPERRT);
  absatz(
    doc,
    gesperrt
      ? 'Hinweis: Die Kontaktdaten sind fuer Ihre Rolle gesperrt und darum als „gesperrt (DSGVO)“ ausgewiesen.'
      : 'Die Kontaktdaten sind personenbezogene Daten und ausschliesslich fuer die Veranstaltungsdurchfuehrung zu verwenden.',
    { groesse: 7.5, farbe: FARBEN.grau },
  );

  tabelle(doc, BETREIBER_SPALTEN, betreiberTabellenZeilen(zeilen), { groesse: 7 });
  return alsBuffer(doc);
}
