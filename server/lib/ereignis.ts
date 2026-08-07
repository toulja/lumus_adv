/**
 * Aenderungsprotokoll: jede Aenderung wird als Event mit Feld-Diff festgehalten
 * (Lastenheft Kap. 4 Grundsaetze) und sofort an alle Berechtigten verteilt.
 * Das Log ist append-only — es wird nie umgeschrieben.
 */

import type {
  AenderungsEvent,
  Aktion,
  Benachrichtigung,
  ElementRef,
  FeldDiff,
  Nutzer,
} from '../../shared/domain/types.ts';
import { benachrichtigungen, events, id, jetzt, projekte } from './store.ts';
import * as hub from '../realtime/hub.ts';

const IGNORIERTE_FELDER = new Set(['erstelltAm', 'erstelltVon', 'geaendertAm', 'projektId', 'id']);

export function diffBilden(vorher: unknown, nachher: unknown): FeldDiff[] {
  const out: FeldDiff[] = [];
  const a = (vorher ?? {}) as Record<string, unknown>;
  const b = (nachher ?? {}) as Record<string, unknown>;
  const felder = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const f of felder) {
    if (IGNORIERTE_FELDER.has(f)) continue;
    const va = a[f];
    const vb = b[f];
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    out.push({ feld: f, vorher: kuerzen(va), nachher: kuerzen(vb) });
  }
  return out;
}

/** Lange Geometrien im Protokoll zusammenfassen — sonst wird das Log unlesbar. */
function kuerzen(v: unknown): unknown {
  if (Array.isArray(v) && v.length > 6 && Array.isArray(v[0])) {
    return `[${v.length} Punkte]`;
  }
  return v;
}

export interface ProtokollOpts {
  projektId: string;
  nutzer: Nutzer;
  orgId: string;
  aktion: Aktion;
  elementRef: ElementRef;
  bezeichnung: string;
  vorher?: unknown;
  nachher?: unknown;
  diff?: FeldDiff[];
  kiVorschlag?: { prompt: string; bestaetigtVon: string };
  /** Wird mitgesendet, damit Clients ohne Nachladen aktualisieren koennen. */
  nutzlast?: Record<string, unknown>;
}

export function protokollieren(o: ProtokollOpts): AenderungsEvent {
  const e: AenderungsEvent = {
    id: id('ev_'),
    seq: projekte.naechsteSeq(o.projektId),
    projektId: o.projektId,
    nutzerId: o.nutzer.id,
    nutzerName: o.nutzer.name,
    orgId: o.orgId,
    zeit: jetzt(),
    aktion: o.aktion,
    elementRef: o.elementRef,
    bezeichnung: o.bezeichnung,
    diff: o.diff ?? diffBilden(o.vorher, o.nachher),
    kiVorschlag: o.kiVorschlag,
  };
  events.anhaengen(e);
  projekte.speichern(o.projektId);
  hub.anAlle(o.projektId, { art: 'event', event: e, inhalt: o.nutzlast as never });
  return e;
}

export function benachrichtigen(opts: {
  nutzerIds: string[];
  projektId?: string;
  art: Benachrichtigung['art'];
  titel: string;
  text: string;
  link?: string;
}): Benachrichtigung[] {
  const out: Benachrichtigung[] = [];
  for (const nid of new Set(opts.nutzerIds)) {
    const b: Benachrichtigung = {
      id: id('bn_'),
      nutzerId: nid,
      projektId: opts.projektId,
      art: opts.art,
      titel: opts.titel,
      text: opts.text,
      am: jetzt(),
      gelesen: false,
      link: opts.link,
    };
    benachrichtigungen.anlegen(b);
    hub.benachrichtigungVerteilen(b);
    // E-Mail-Versand: im lokalen Betrieb bewusst nur protokolliert. Der
    // Anschluss eines echten Mailversands haengt an genau dieser Stelle.
    console.log(`[Benachrichtigung] an ${nid}: ${opts.titel} — ${opts.text}`);
    out.push(b);
  }
  return out;
}

/** Diff zweier Snapshots: welche Elemente kamen dazu, aenderten sich, fielen weg. */
export interface SnapshotDiff {
  neu: { art: ElementRef['art']; id: string; bezeichnung: string }[];
  geaendert: { art: ElementRef['art']; id: string; bezeichnung: string; felder: FeldDiff[] }[];
  entfernt: { art: ElementRef['art']; id: string; bezeichnung: string }[];
}

export function snapshotDiff(
  a: { objekte: { id: string }[]; wege: { id: string }[]; blockflaechen: { id: string }[]; einsatzstationen: { id: string }[] },
  b: typeof a,
  bezeichner: (art: ElementRef['art'], el: unknown) => string,
): SnapshotDiff {
  const diff: SnapshotDiff = { neu: [], geaendert: [], entfernt: [] };
  const gruppen: [ElementRef['art'], { id: string }[], { id: string }[]][] = [
    ['objekt', a.objekte, b.objekte],
    ['weg', a.wege, b.wege],
    ['blockflaeche', a.blockflaechen, b.blockflaechen],
    ['einsatzstation', a.einsatzstationen, b.einsatzstationen],
  ];
  for (const [art, alt, neu] of gruppen) {
    const altMap = new Map(alt.map((x) => [x.id, x]));
    const neuMap = new Map(neu.map((x) => [x.id, x]));
    for (const [eid, el] of neuMap) {
      const vorher = altMap.get(eid);
      if (!vorher) diff.neu.push({ art, id: eid, bezeichnung: bezeichner(art, el) });
      else {
        const felder = diffBilden(vorher, el);
        if (felder.length) diff.geaendert.push({ art, id: eid, bezeichnung: bezeichner(art, el), felder });
      }
    }
    for (const [eid, el] of altMap) {
      if (!neuMap.has(eid)) diff.entfernt.push({ art, id: eid, bezeichnung: bezeichner(art, el) });
    }
  }
  return diff;
}
