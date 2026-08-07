/**
 * Rollen- und Rechtemodell (Lastenheft Kap. 4) — eine einzige Stelle, an der
 * entschieden wird, wer was darf.
 *
 * Besonderheit Polizei: organisationsweiter Lesezugriff auf ALLE Projekte des
 * Zustaendigkeitsbereichs OHNE Einladung. Das ist ausdrueckliche Vorgabe und
 * darum hier hart verdrahtet, nicht ueber Mitgliedschaften.
 */

import type { Nutzer, ObjektInstanz, Projekt, Rolle } from '../../shared/domain/types.ts';
import { mitgliedschaften, organisationen } from './store.ts';

export type Recht =
  | 'projekt.lesen'
  | 'projekt.aendern'
  | 'projekt.loeschen'
  | 'element.anlegen'
  | 'element.aendern'
  | 'element.loeschen'
  | 'feuerwehrflaeche.aendern'
  | 'zuweisen'
  | 'einladen'
  | 'snapshot.anlegen'
  | 'einreichen'
  | 'freigabe.setzen'
  | 'kommentar.schreiben'
  | 'bericht.erzeugen'
  | 'betreiberliste.lesen'
  | 'kontaktdaten.sehen'
  | 'ki.nutzen'
  | 'gelaende.anlegen'
  | 'objekttyp.anlegen';

const MATRIX: Record<Rolle, Recht[]> = {
  plattform_admin: [
    'projekt.lesen', 'projekt.aendern', 'projekt.loeschen', 'element.anlegen', 'element.aendern', 'element.loeschen',
    'feuerwehrflaeche.aendern', 'zuweisen', 'einladen', 'snapshot.anlegen', 'einreichen', 'freigabe.setzen',
    'kommentar.schreiben', 'bericht.erzeugen', 'betreiberliste.lesen', 'kontaktdaten.sehen', 'ki.nutzen',
    'gelaende.anlegen', 'objekttyp.anlegen',
  ],
  veranstalter: [
    'projekt.lesen', 'projekt.aendern', 'projekt.loeschen', 'element.anlegen', 'element.aendern', 'element.loeschen',
    'feuerwehrflaeche.aendern', 'zuweisen', 'einladen', 'snapshot.anlegen', 'einreichen',
    'kommentar.schreiben', 'bericht.erzeugen', 'betreiberliste.lesen', 'kontaktdaten.sehen', 'ki.nutzen',
    'gelaende.anlegen', 'objekttyp.anlegen',
  ],
  // Standbetreiber: liest alles, aendert AUSSCHLIESSLICH die ihm zugewiesenen
  // Objekte. Die Objektbindung prueft `darfObjektAendern`.
  standbetreiber: ['projekt.lesen', 'element.aendern', 'kommentar.schreiben', 'ki.nutzen'],
  ordnungsamt: [
    'projekt.lesen', 'freigabe.setzen', 'kommentar.schreiben', 'bericht.erzeugen',
    'betreiberliste.lesen', 'kontaktdaten.sehen', 'ki.nutzen',
  ],
  feuerwehr: [
    'projekt.lesen', 'freigabe.setzen', 'kommentar.schreiben', 'bericht.erzeugen',
    'betreiberliste.lesen', 'kontaktdaten.sehen', 'ki.nutzen',
    // zusaetzlich: Pflege der Feuerwehrflaechen/-zufahrten
    'element.anlegen', 'element.aendern', 'element.loeschen', 'feuerwehrflaeche.aendern',
  ],
  polizei: [
    'projekt.lesen', 'kommentar.schreiben', 'bericht.erzeugen', 'betreiberliste.lesen', 'kontaktdaten.sehen',
  ],
  gast: ['projekt.lesen'],
};

/**
 * Ermittelt die Rolle eines Nutzers in einem Projekt.
 * Reihenfolge: Plattform-Admin > Veranstalter des Projekts > Polizei
 * (automatisch) > eingeladene Rolle > kein Zugriff.
 */
export function rolleFuer(n: Nutzer, p: Projekt): Rolle | null {
  const org = organisationen.finde(n.orgId);
  if (!org) return null;
  if (org.typ === 'plattform') return 'plattform_admin';
  if (p.veranstalterOrgId === n.orgId) return 'veranstalter';
  // Polizei sieht alles im Zustaendigkeitsbereich, ohne Einladung.
  if (org.typ === 'polizei') return 'polizei';
  const m = mitgliedschaften.finde(p.id, n.orgId);
  if (m) return m.rolle;
  return null;
}

export function darf(rolle: Rolle | null, recht: Recht): boolean {
  if (!rolle) return false;
  return MATRIX[rolle].includes(recht);
}

/**
 * Zusaetzliche Objektbindung fuer Standbetreiber: nur eigene Objekte.
 * Die Feuerwehr darf nur Feuerwehrflaechen/-zufahrten anfassen.
 */
export function darfObjektAendern(n: Nutzer, rolle: Rolle | null, objekt: ObjektInstanz): { ok: boolean; grund?: string } {
  if (!darf(rolle, 'element.aendern')) return { ok: false, grund: 'Diese Rolle darf keine Objekte aendern.' };
  if (rolle === 'standbetreiber') {
    if (objekt.betreiberOrgId !== n.orgId) {
      return { ok: false, grund: 'Als Standbetreiber koennen Sie nur die Ihnen zugewiesenen Objekte bearbeiten.' };
    }
  }
  if (rolle === 'feuerwehr') {
    return { ok: false, grund: 'Die Feuerwehr pflegt ausschliesslich Feuerwehrzufahrten und Bewegungsflaechen.' };
  }
  return { ok: true };
}

/** Welche Felder darf ein Standbetreiber an seinem Objekt aendern? */
export const BETREIBER_FELDER = ['masseOverride', 'notizen', 'status', 'standNummer'] as const;

export function felderFiltern(rolle: Rolle | null, patch: Record<string, unknown>): Record<string, unknown> {
  if (rolle !== 'standbetreiber') return patch;
  const out: Record<string, unknown> = {};
  for (const f of BETREIBER_FELDER) if (f in patch) out[f] = patch[f];
  return out;
}

export function darfWegAendern(rolle: Rolle | null, wegTyp: string): { ok: boolean; grund?: string } {
  if (rolle === 'feuerwehr') {
    const erlaubt = wegTyp === 'feuerwehrzufahrt' || wegTyp === 'feuerwehrbewegungsflaeche';
    return erlaubt ? { ok: true } : { ok: false, grund: 'Die Feuerwehr darf nur Feuerwehrzufahrten und Bewegungsflaechen bearbeiten.' };
  }
  if (!darf(rolle, 'element.aendern')) return { ok: false, grund: 'Diese Rolle darf keine Wege aendern.' };
  if (rolle === 'standbetreiber') return { ok: false, grund: 'Standbetreiber duerfen keine Wege aendern.' };
  return { ok: true };
}

/**
 * Alle Projekte, die ein Nutzer sehen darf. Polizei bekommt automatisch
 * alle Projekte, sonst gilt Veranstalter-Eigentum oder Einladung.
 */
export function sichtbareProjekte(n: Nutzer, alle: Projekt[]): { projekt: Projekt; rolle: Rolle }[] {
  const out: { projekt: Projekt; rolle: Rolle }[] = [];
  for (const p of alle) {
    const r = rolleFuer(n, p);
    if (r) out.push({ projekt: p, rolle: r });
  }
  return out;
}

/** DSGVO: Kontaktdaten der Betreiber nur fuer berechtigte Rollen. */
export function kontaktSichtbar(rolle: Rolle | null): boolean {
  return darf(rolle, 'kontaktdaten.sehen');
}

/**
 * Auflagen sind die Forderungen der Behoerde. Abhaken darf sie deshalb nur,
 * wer die Planung verantwortet (Veranstalter) oder wer sie erteilt hat
 * (Behoerdenrollen). Standbetreiber, Gaeste und die Polizei duerfen es NICHT.
 *
 * Ohne diese Pruefung konnte bis 07.08.2026 jeder Projektbeteiligte — auch ein
 * reiner Gast — eine amtliche Auflage als erledigt markieren.
 */
export function darfAuflageAendern(rolle: Rolle | null): boolean {
  return darf(rolle, 'projekt.aendern') || darf(rolle, 'freigabe.setzen');
}

/**
 * Kommentare aendern (Antwort anhaengen, erledigt setzen).
 * Voraussetzung ist das Kommentarrecht; das Abhaken bleibt zusaetzlich dem
 * Verfasser oder der planungs-/freigabeberechtigten Rolle vorbehalten.
 *
 * Ohne diese Pruefung war PATCH ein Schleichweg an POST vorbei: eine Rolle
 * ohne `kommentar.schreiben` (Gast) konnte ueber das Antwortfeld trotzdem in
 * den Kommentarfaden schreiben.
 */
export function darfKommentarAendern(
  rolle: Rolle | null,
  nutzerId: string,
  autorId: string,
  was: { antwort: boolean; erledigt: boolean },
): { ok: boolean; grund?: string } {
  if (!darf(rolle, 'kommentar.schreiben')) {
    return { ok: false, grund: 'Diese Rolle darf nicht kommentieren.' };
  }
  if (was.erledigt && nutzerId !== autorId && !darfAuflageAendern(rolle)) {
    return { ok: false, grund: 'Nur der Verfasser oder der Veranstalter kann einen Kommentar als erledigt markieren.' };
  }
  return { ok: true };
}
