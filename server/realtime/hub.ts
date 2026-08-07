/**
 * Echtzeit-Kollaboration (F6): ein WebSocket-Kanal je Projekt.
 *
 * Bewusst KEIN CRDT — das Lastenheft verlangt ausdruecklich nur
 * Objekt-Locking: wer ein Element greift, sperrt es; die Sperre verfaellt
 * nach 5 Minuten ohne Aktivitaet. Alle Aenderungen laufen als Events
 * (Kap. 5) und landen zugleich unveraenderlich im Aenderungsprotokoll.
 */

import type { WebSocket } from 'ws';
import type {
  AenderungsEvent,
  Benachrichtigung,
  ElementRef,
  Kommentar,
  Nutzer,
  Praesenz,
  Pruefbericht,
  Punkt,
  Sperre,
  WsNachricht,
} from '../../shared/domain/types.ts';

const SPERRE_MS = 5 * 60 * 1000;

interface Teilnehmer {
  ws: WebSocket;
  nutzer: Nutzer;
  projektId: string;
  praesenz: Praesenz;
}

const FARBEN = ['#4a90d9', '#33c46b', '#f0b400', '#e8503a', '#9b8bd0', '#3aa7a0', '#e87d3a', '#d05fa8'];

const raeume = new Map<string, Set<Teilnehmer>>();
const sperren = new Map<string, Map<string, Sperre>>(); // projektId -> refSchluessel -> Sperre

function refSchluessel(r: ElementRef): string {
  return `${r.art}:${r.id}`;
}

function raum(projektId: string): Set<Teilnehmer> {
  let r = raeume.get(projektId);
  if (!r) {
    r = new Set();
    raeume.set(projektId, r);
  }
  return r;
}

function projektSperren(projektId: string): Map<string, Sperre> {
  let s = sperren.get(projektId);
  if (!s) {
    s = new Map();
    sperren.set(projektId, s);
  }
  return s;
}

function abgelaufeneAufraeumen(projektId: string): ElementRef[] {
  const s = projektSperren(projektId);
  const jetzt = Date.now();
  const weg: ElementRef[] = [];
  for (const [k, sp] of s) {
    if (new Date(sp.laeuftAbUm).getTime() < jetzt) {
      s.delete(k);
      const [art, ...rest] = k.split(':');
      weg.push({ art: art as ElementRef['art'], id: rest.join(':') });
    }
  }
  return weg;
}

export function senden(ws: WebSocket, n: WsNachricht) {
  if (ws.readyState === 1) ws.send(JSON.stringify(n));
}

export function anAlle(projektId: string, n: WsNachricht, ausser?: WebSocket) {
  for (const t of raum(projektId)) {
    if (t.ws !== ausser) senden(t.ws, n);
  }
}

export function anNutzer(nutzerId: string, n: WsNachricht) {
  for (const r of raeume.values()) {
    for (const t of r) if (t.nutzer.id === nutzerId) senden(t.ws, n);
  }
}

export function beitreten(ws: WebSocket, nutzer: Nutzer, projektId: string, orgName: string): Teilnehmer {
  const bestehende = [...raum(projektId)];
  const farbe = FARBEN[bestehende.length % FARBEN.length];
  const t: Teilnehmer = {
    ws,
    nutzer,
    projektId,
    praesenz: {
      nutzerId: nutzer.id,
      nutzerName: nutzer.name,
      orgName,
      farbe,
      zuletzt: new Date().toISOString(),
    },
  };
  raum(projektId).add(t);
  abgelaufeneAufraeumen(projektId);
  senden(ws, {
    art: 'hallo',
    projektId,
    praesenz: bestehende.map((x) => x.praesenz),
    sperren: [...projektSperren(projektId).values()],
  });
  anAlle(projektId, { art: 'praesenz', praesenz: t.praesenz }, ws);
  return t;
}

export function verlassen(t: Teilnehmer) {
  raum(t.projektId).delete(t);
  // Sperren dieses Nutzers sofort freigeben
  const s = projektSperren(t.projektId);
  for (const [k, sp] of s) {
    if (sp.nutzerId === t.nutzer.id) {
      s.delete(k);
      const [art, ...rest] = k.split(':');
      anAlle(t.projektId, { art: 'sperre_weg', elementRef: { art: art as ElementRef['art'], id: rest.join(':') } });
    }
  }
  anAlle(t.projektId, { art: 'praesenz_weg', nutzerId: t.nutzer.id });
}

/** Sperre setzen oder erneuern. Liefert null, wenn ein anderer sie haelt. */
export function sperren_setzen(projektId: string, ref: ElementRef, nutzer: Nutzer): Sperre | null {
  abgelaufeneAufraeumen(projektId);
  const s = projektSperren(projektId);
  const k = refSchluessel(ref);
  const vorhanden = s.get(k);
  if (vorhanden && vorhanden.nutzerId !== nutzer.id) return null;
  const sp: Sperre = {
    elementRef: ref,
    nutzerId: nutzer.id,
    nutzerName: nutzer.name,
    seit: vorhanden?.seit ?? new Date().toISOString(),
    laeuftAbUm: new Date(Date.now() + SPERRE_MS).toISOString(),
  };
  s.set(k, sp);
  anAlle(projektId, { art: 'sperre', sperre: sp });
  return sp;
}

export function sperreLoesen(projektId: string, ref: ElementRef, nutzerId: string): boolean {
  const s = projektSperren(projektId);
  const k = refSchluessel(ref);
  const sp = s.get(k);
  if (!sp || sp.nutzerId !== nutzerId) return false;
  s.delete(k);
  anAlle(projektId, { art: 'sperre_weg', elementRef: ref });
  return true;
}

export function sperreHalter(projektId: string, ref: ElementRef): Sperre | null {
  abgelaufeneAufraeumen(projektId);
  return projektSperren(projektId).get(refSchluessel(ref)) ?? null;
}

/** Prueft vor einer Aenderung, ob ein anderer das Element gerade haelt. */
export function darfSchreiben(projektId: string, ref: ElementRef, nutzerId: string): { ok: boolean; grund?: string } {
  const sp = sperreHalter(projektId, ref);
  if (sp && sp.nutzerId !== nutzerId) {
    return { ok: false, grund: `${sp.nutzerName} bearbeitet dieses Element gerade (Sperre laeuft ${new Date(sp.laeuftAbUm).toLocaleTimeString('de-DE')} ab).` };
  }
  return { ok: true };
}

export function cursorSetzen(t: Teilnehmer, cursor: Punkt | null) {
  t.praesenz.cursor = cursor ?? undefined;
  t.praesenz.zuletzt = new Date().toISOString();
  anAlle(t.projektId, { art: 'cursor', nutzerId: t.nutzer.id, cursor }, t.ws);
}

export function auswahlSetzen(t: Teilnehmer, auswahl: ElementRef[]) {
  t.praesenz.auswahl = auswahl;
  t.praesenz.zuletzt = new Date().toISOString();
  anAlle(t.projektId, { art: 'praesenz', praesenz: t.praesenz }, t.ws);
}

export function ereignisVerteilen(e: AenderungsEvent, inhalt?: WsNachricht extends { inhalt?: infer I } ? I : never) {
  anAlle(e.projektId, { art: 'event', event: e, inhalt });
}

export function kommentarVerteilen(k: Kommentar) {
  anAlle(k.projektId, { art: 'kommentar', kommentar: k });
}

export function pruefungVerteilen(b: Pruefbericht) {
  anAlle(b.projektId, { art: 'pruefung', bericht: b });
}

export function benachrichtigungVerteilen(b: Benachrichtigung) {
  anNutzer(b.nutzerId, { art: 'benachrichtigung', benachrichtigung: b });
}

export function teilnehmerZahl(projektId: string): number {
  return raum(projektId).size;
}

export type { Teilnehmer };

// Abgelaufene Sperren regelmaessig einsammeln, auch ohne Aktivitaet
setInterval(() => {
  for (const projektId of sperren.keys()) {
    for (const ref of abgelaufeneAufraeumen(projektId)) {
      anAlle(projektId, { art: 'sperre_weg', elementRef: ref });
    }
  }
}, 30_000).unref();
