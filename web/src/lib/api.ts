/**
 * API-Client. Eine Stelle fuer alle Serveraufrufe — Fehlermeldungen kommen
 * vom Server auf Deutsch und werden unveraendert durchgereicht.
 */

import type {
  AenderungsEvent,
  Benachrichtigung,
  Bibliothek,
  Blockflaeche,
  Einsatzstation,
  Freigabe,
  Gelaende,
  KiVorschlag,
  Kommentar,
  NutzerOeffentlich,
  ObjektInstanz,
  ObjektTyp,
  Organisation,
  Projekt,
  ProjektInhalt,
  ProjektUebersicht,
  Pruefbericht,
  Pruefergebnis,
  Regelwerk,
  Rolle,
  Snapshot,
  Weg,
} from '@shared/domain/types';

export class ApiFehler extends Error {
  status: number;
  constructor(status: number, nachricht: string) {
    super(nachricht);
    this.status = status;
  }
}

async function ruf<T>(pfad: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${pfad}`, {
    credentials: 'same-origin',
    headers: opts.body && typeof opts.body === 'string' && !opts.headers ? { 'Content-Type': 'application/json' } : (opts.headers as HeadersInit),
    ...opts,
  });
  if (!res.ok) {
    let text = `Serverfehler ${res.status}`;
    try {
      const j = (await res.json()) as { fehler?: string };
      if (j.fehler) text = j.fehler;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiFehler(res.status, text);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const j = (daten: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(daten),
});
const patch = (daten: unknown): RequestInit => ({ ...j(daten), method: 'PATCH' });

// ---------------------------------------------------------------------------

export interface ProjektDetail extends ProjektInhalt {
  rolle: Rolle;
  darf: Record<string, boolean>;
  gelaende: Pick<Gelaende, 'id' | 'name' | 'bbox' | 'hoeheMittel' | 'hoehenHerkunft' | 'quellennachweis'> | null;
  veranstalter: Organisation | null;
  beteiligte: { projektId: string; orgId: string; rolle: Rolle; automatisch: boolean; orgName: string; orgTyp: string | null; eingeladenAm: string }[];
  letzteSeq: number;
}

export interface Fundstelle {
  label: string;
  lon: number;
  lat: number;
  e: number;
  n: number;
  typ: string;
  bbox4326?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

export interface ImportAuftrag {
  id: string;
  name: string;
  status: 'wartet' | 'laeuft' | 'fertig' | 'fehler';
  schritt: string;
  fortschritt: number;
  gelaendeId?: string;
  fehler?: string;
  meldungen: string[];
}

export const api = {
  // -- Anmeldung ----------------------------------------------------------
  anmelden: (email: string, passwort: string) => ruf<NutzerOeffentlich>('/auth/anmelden', j({ email, passwort })),
  abmelden: () => ruf<{ ok: boolean }>('/auth/abmelden', { method: 'POST' }),
  ich: () => ruf<NutzerOeffentlich>('/auth/ich'),
  registrieren: (daten: { name: string; email: string; passwort: string; orgId: string }) =>
    ruf<NutzerOeffentlich>('/auth/registrieren', j(daten)),
  organisationen: () => ruf<(Organisation & { nutzer: number })[]>('/auth/organisationen'),
  benachrichtigungen: () => ruf<Benachrichtigung[]>('/auth/benachrichtigungen'),
  benachrichtigungenGelesen: (ids: string[]) => ruf<{ ok: boolean }>('/auth/benachrichtigungen/gelesen', j({ ids })),

  // -- Kataloge -----------------------------------------------------------
  bibliothek: () => ruf<Bibliothek>('/bibliothek'),
  regelwerke: () => ruf<{ id: string; version: string; bezeichnung: string; bundesland: string; stand: string; haftungshinweis: string; regeln: number; zuPruefen: number }[]>('/regelwerke'),
  regelwerk: (id: string) => ruf<Regelwerk>(`/regelwerke/${id}`),
  status: () => ruf<{ dienst: string; version: string; projekte: number; kiVerfuegbar: boolean }>('/status'),

  // -- Gelaende -----------------------------------------------------------
  adressSuche: (q: string) => ruf<Fundstelle[]>(`/gelaende/suche?q=${encodeURIComponent(q)}`),
  gelaendeListe: () => ruf<{ id: string; name: string; erstelltAm: string }[]>('/gelaende'),
  gelaende: (id: string) => ruf<Gelaende & { bbox4326: { minLon: number; minLat: number; maxLon: number; maxLat: number } }>(`/gelaende/${id}`),
  gebietPruefen: (bbox25832: unknown) =>
    ruf<{ flaecheKm2: number; zulaessig: boolean; grenzeKm2: number; bbox4326: unknown }>('/gelaende/import/pruefen', j({ bbox25832 })),
  gelaendeImport: (daten: { name: string; bbox25832: unknown; kreis?: string; ohneLuftbild?: boolean }) =>
    ruf<ImportAuftrag>('/gelaende/import', j(daten)),
  importAuftrag: (id: string) => ruf<ImportAuftrag>(`/gelaende/import/auftrag/${id}`),
  dgmImport: (gelaendeId: string, inhalt: string) =>
    ruf<{ punkte: number; hMin: number; hMax: number }>(`/gelaende/${gelaendeId}/dgm`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: inhalt,
    }),

  // -- Projekte -----------------------------------------------------------
  projekte: () => ruf<ProjektUebersicht[]>('/projekte'),
  projekt: (id: string) => ruf<ProjektDetail>(`/projekte/${id}`),
  projektAnlegen: (daten: Partial<Projekt>) => ruf<Projekt>('/projekte', j(daten)),
  projektAendern: (id: string, daten: Partial<Projekt>) => ruf<Projekt>(`/projekte/${id}`, patch(daten)),
  projektLoeschen: (id: string) => ruf<{ ok: boolean }>(`/projekte/${id}`, { method: 'DELETE' }),
  einladen: (id: string, orgId: string, rolle: Rolle) => ruf<{ ok: boolean }>(`/projekte/${id}/einladen`, j({ orgId, rolle })),
  beteiligtenEntfernen: (id: string, orgId: string) => ruf<{ ok: boolean }>(`/projekte/${id}/beteiligte/${orgId}`, { method: 'DELETE' }),

  // -- Elemente -----------------------------------------------------------
  objektAnlegen: (pid: string, daten: Partial<ObjektInstanz> & { kiVorschlag?: unknown }) => ruf<ObjektInstanz>(`/projekte/${pid}/objekte`, j(daten)),
  objektAendern: (pid: string, oid: string, daten: Partial<ObjektInstanz> & { kiVorschlag?: unknown }) =>
    ruf<ObjektInstanz>(`/projekte/${pid}/objekte/${oid}`, patch(daten)),
  objektLoeschen: (pid: string, oid: string) => ruf<{ ok: boolean }>(`/projekte/${pid}/objekte/${oid}`, { method: 'DELETE' }),
  objektZuweisen: (pid: string, oid: string, betreiberOrgId: string | null, standNummer?: string) =>
    ruf<ObjektInstanz>(`/projekte/${pid}/objekte/${oid}/zuweisen`, j({ betreiberOrgId, standNummer })),
  objekttypAnlegen: (pid: string, daten: Partial<ObjektTyp>) => ruf<ObjektTyp>(`/projekte/${pid}/objekttypen`, j(daten)),

  wegAnlegen: (pid: string, daten: Partial<Weg>) => ruf<Weg>(`/projekte/${pid}/wege`, j(daten)),
  wegAendern: (pid: string, wid: string, daten: Partial<Weg>) => ruf<Weg>(`/projekte/${pid}/wege/${wid}`, patch(daten)),
  wegLoeschen: (pid: string, wid: string) => ruf<{ ok: boolean }>(`/projekte/${pid}/wege/${wid}`, { method: 'DELETE' }),

  blockflaecheAnlegen: (pid: string, daten: Partial<Blockflaeche>) => ruf<Blockflaeche>(`/projekte/${pid}/blockflaechen`, j(daten)),
  blockflaecheAendern: (pid: string, bid: string, daten: Partial<Blockflaeche>) => ruf<Blockflaeche>(`/projekte/${pid}/blockflaechen/${bid}`, patch(daten)),
  blockflaecheLoeschen: (pid: string, bid: string) => ruf<{ ok: boolean }>(`/projekte/${pid}/blockflaechen/${bid}`, { method: 'DELETE' }),

  stationAnlegen: (pid: string, daten: Partial<Einsatzstation>) => ruf<Einsatzstation>(`/projekte/${pid}/einsatzstationen`, j(daten)),
  stationAendern: (pid: string, sid: string, daten: Partial<Einsatzstation>) => ruf<Einsatzstation>(`/projekte/${pid}/einsatzstationen/${sid}`, patch(daten)),
  stationLoeschen: (pid: string, sid: string) => ruf<{ ok: boolean }>(`/projekte/${pid}/einsatzstationen/${sid}`, { method: 'DELETE' }),

  // -- Pruefung -----------------------------------------------------------
  pruefen: (pid: string) => ruf<Pruefbericht>(`/projekte/${pid}/pruefung`, { method: 'POST' }),
  pruefungLesen: (pid: string) => ruf<Pruefbericht>(`/projekte/${pid}/pruefung`),
  editorStatus: (pid: string) => ruf<Record<string, 'ok' | 'kollision' | 'zu_nah'>>(`/projekte/${pid}/editorstatus`),
  engstellen: (pid: string, wid: string) =>
    ruf<{ wegId: string; planbreite: number; minFreieBreite: number; stellen: { station: number; freieBreite: number; ort: [number, number]; schnitt: [[number, number], [number, number]] }[] }>(
      `/projekte/${pid}/wege/${wid}/engstellen`,
    ),

  // -- Kollaboration ------------------------------------------------------
  events: (pid: string, filter?: { nutzer?: string; art?: string }) => {
    const p = new URLSearchParams();
    if (filter?.nutzer) p.set('nutzer', filter.nutzer);
    if (filter?.art) p.set('art', filter.art);
    return ruf<AenderungsEvent[]>(`/projekte/${pid}/events?${p}`);
  },
  kommentare: (pid: string) => ruf<Kommentar[]>(`/projekte/${pid}/kommentare`),
  kommentarAnlegen: (pid: string, daten: Partial<Kommentar>) => ruf<Kommentar>(`/projekte/${pid}/kommentare`, j(daten)),
  kommentarAendern: (pid: string, kid: string, daten: { erledigt?: boolean; antwort?: string }) =>
    ruf<Kommentar>(`/projekte/${pid}/kommentare/${kid}`, patch(daten)),

  snapshots: (pid: string) =>
    ruf<(Pick<Snapshot, 'id' | 'name' | 'zeit' | 'eventCursor' | 'erstelltVon' | 'bemerkung'> & { objekte: number; wege: number; freigaben: Freigabe[] })[]>(`/projekte/${pid}/snapshots`),
  snapshotAnlegen: (pid: string, name: string, bemerkung?: string, einreichen?: boolean) =>
    ruf<Snapshot>(`/projekte/${pid}/snapshots`, j({ name, bemerkung, einreichen })),
  snapshotDiff: (pid: string, a: string, b: string) =>
    ruf<{ von: { name: string }; nach: { name: string }; neu: unknown[]; geaendert: unknown[]; entfernt: unknown[] }>(`/projekte/${pid}/snapshots/${a}/diff/${b}`),
  freigabeSetzen: (pid: string, sid: string, daten: { status: string; kommentar?: string; auflagen?: string[] }) =>
    ruf<Freigabe>(`/projekte/${pid}/snapshots/${sid}/freigabe`, j(daten)),
  auflagen: (pid: string) => ruf<{ id: string; text: string; von: string; vonOrg: string; am: string; erledigt: boolean; quelle: string }[]>(`/projekte/${pid}/auflagen`),
  auflageErledigt: (pid: string, aid: string, erledigt: boolean) => ruf<{ ok: boolean }>(`/projekte/${pid}/auflagen/${aid}`, patch({ erledigt })),
  objektAuflage: (pid: string, oid: string, text: string) => ruf<unknown>(`/projekte/${pid}/objekte/${oid}/auflagen`, j({ text })),

  // -- KI -----------------------------------------------------------------
  kiStatus: (pid: string) => ruf<{ verfuegbar: boolean; modell: string | null; hinweis: string; darfNutzen: boolean }>(`/projekte/${pid}/ki/status`),
  kiErklaeren: (pid: string, ergebnisId: string) =>
    ruf<{ text: string; quelle: 'anthropic' | 'lokal'; verschiebung: { elementId: string; dE: number; dN: number; meter: number; richtung: string } | null }>(
      `/projekte/${pid}/ki/erklaeren`,
      j({ ergebnisId }),
    ),
  kiFrage: (pid: string, frage: string, verlauf?: { rolle: 'nutzer' | 'assistent'; text: string }[]) =>
    ruf<{ text: string; quelle: 'anthropic' | 'lokal' }>(`/projekte/${pid}/ki/frage`, j({ frage, verlauf })),
  kiPlatzieren: (pid: string, befehl: string) =>
    ruf<{ vorschlaege: KiVorschlag[]; text: string; quelle: 'anthropic' | 'lokal'; hinweis: string }>(`/projekte/${pid}/ki/platzieren`, j({ befehl })),

  // -- Polizei / Behoerden ------------------------------------------------
  polizeiUebersicht: () => ruf<{ organisation: Organisation | null; letzterBesuch: string; projekte: PolizeiProjekt[] }>('/polizei/uebersicht'),
  lagebild: (pid: string) => ruf<Lagebild>(`/polizei/projekte/${pid}/lagebild`),

  // -- Berichte -----------------------------------------------------------
  berichtUrl: (pid: string, art: 'konformitaet' | 'lageplan' | 'betreiberliste' | 'einsatzmappe', opts: { massstab?: number; format?: 'pdf' | 'csv'; snapshot?: string } = {}) => {
    const format = opts.format ?? 'pdf';
    const p = new URLSearchParams();
    if (opts.massstab) p.set('massstab', String(opts.massstab));
    if (opts.snapshot) p.set('snapshot', opts.snapshot);
    return `/api/projekte/${pid}/berichte/${art}.${format}?${p}`;
  },
  exportUrl: (pid: string, art: 'geojson' | 'szene.glb' | 'vadere', opts: { szenario?: string; weg?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.szenario) p.set('szenario', opts.szenario);
    if (opts.weg) p.set('weg', opts.weg);
    return `/api/projekte/${pid}/export/${art}?${p}`;
  },
  vaderePruefen: (pid: string, szenario: string) =>
    ruf<{ pruefung: { gueltig: boolean; fehler: string[]; warnungen: string[] }; szenario: unknown }>(`/projekte/${pid}/export/vadere?pruefen=1&szenario=${szenario}`),
  betreiberliste: (pid: string) => ruf<BetreiberZeile[]>(`/projekte/${pid}/berichte/betreiberliste.json`),
};

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

export interface PolizeiProjekt {
  projekt: { id: string; name: string; zeitraumVon: string; zeitraumBis: string; maxBesucher: number; status: string };
  rolle: Rolle;
  veranstalter: string;
  gelaende: { id: string; name: string; bbox: unknown } | null;
  objekte: number;
  wege: number;
  einsatzstationen: number;
  betreiberAnzahl: number;
  letzterSnapshot: { id: string; name: string; zeit: string } | null;
  freigabeStatus: string;
  pruefung: { fehler: number; warnungen: number; hinweise: number; ok: number; nichtPruefbar: number } | null;
  aenderungenSeitBesuch: number;
}

export interface Lagebild {
  projekt: { id: string; name: string; zeitraumVon: string; zeitraumBis: string; maxBesucher: number };
  veranstalter: Organisation | null;
  veranstalterKontakt: { name: string; email: string }[];
  stationen: {
    id: string;
    kategorie: string;
    kategorieLabel: string;
    name: string;
    besetztVon: string;
    position: string;
    punkt: [number, number] | null;
    distanzZuFeuerwehrzufahrtM: number | null;
    distanzText: string;
  }[];
  wege: { id: string; name?: string; typ: string; breite: number; richtung: string }[];
  blockflaechen: { id: string; name?: string; typ: string; begruendung: string }[];
  objekteNachKategorie: { kategorie: string; anzahl: number }[];
  pruefung: { fehler: number; warnungen: number; hinweise: number; ok: number; nichtPruefbar: number };
  beanstandungen: { regelId: string; meldung: string; schweregrad: string; fundstelle: string }[];
}

export type { Pruefergebnis };
