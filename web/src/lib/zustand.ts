/**
 * Anwendungszustand. Absichtlich EIN Speicher fuer das ganze Projekt:
 * 3D-Szene, 2D-Karte, Panels und Live-Kollaboration arbeiten auf denselben
 * Daten, sonst laufen die Ansichten auseinander.
 */

import { create } from 'zustand';
import type {
  AenderungsEvent,
  Bibliothek,
  Blockflaeche,
  Einsatzstation,
  ElementRef,
  Gelaende,
  Kommentar,
  NutzerOeffentlich,
  ObjektInstanz,
  ObjektTyp,
  Praesenz,
  Projekt,
  ProjektInhalt,
  Pruefbericht,
  Punkt,
  Rolle,
  Sperre,
  Weg,
  WsNachricht,
} from '@shared/domain/types';
import { api } from './api.ts';
import type { ProjektDetail } from './api.ts';

export type Werkzeug =
  | 'auswahl'
  | 'platzieren'
  | 'weg'
  | 'blockflaeche'
  | 'station'
  | 'messen_distanz'
  | 'messen_flaeche'
  | 'kommentar';

export interface Ebenen {
  gebaeude: boolean;
  /** Bodenzeichnung nach tatsaechlicher Nutzung (Fahrbahn, Gehweg, Radweg, Gruen). */
  nutzung: boolean;
  objekte: boolean;
  wege: boolean;
  blockflaechen: boolean;
  einsatzstationen: boolean;
  bemassung: boolean;
  luftbild: boolean;
  flurstuecke: boolean;
  gelaende: boolean;
}

export interface Messung {
  id: string;
  art: 'distanz' | 'flaeche';
  punkte: Punkt[];
  wert: number;
  text: string;
  dauerhaft: boolean;
}

export interface Zustand {
  // Anmeldung
  nutzer: NutzerOeffentlich | null;
  angemeldetGeprueft: boolean;

  // Kataloge
  bibliothek: Bibliothek | null;
  typen: Map<string, ObjektTyp>;

  // Projekt
  projektId: string | null;
  projekt: Projekt | null;
  inhalt: ProjektInhalt | null;
  gelaende: Gelaende | null;
  rolle: Rolle | null;
  darf: Record<string, boolean>;
  beteiligte: ProjektDetail['beteiligte'];
  laedt: boolean;
  fehler: string | null;

  // Pruefung
  bericht: Pruefbericht | null;
  editorStatus: Record<string, 'ok' | 'kollision' | 'zu_nah'>;
  pruefungLaeuft: boolean;

  // Bearbeitung
  werkzeug: Werkzeug;
  platzierTypId: string | null;
  auswahl: ElementRef[];
  hervorgehoben: ElementRef | null;
  ebenen: Ebenen;
  raster: 0 | 0.1 | 0.5 | 1;
  anKantenFangen: boolean;
  messungen: Messung[];
  ansicht: '3d' | '2d' | 'geteilt';

  // Kollaboration
  praesenz: Praesenz[];
  sperren: Sperre[];
  kommentare: Kommentar[];
  ereignisse: AenderungsEvent[];
  verbunden: boolean;

  // Aktionen
  anmeldungPruefen: () => Promise<void>;
  anmelden: (email: string, passwort: string) => Promise<void>;
  abmelden: () => Promise<void>;
  katalogeLaden: () => Promise<void>;
  projektLaden: (id: string) => Promise<void>;
  projektVerlassen: () => void;
  pruefen: () => Promise<void>;
  editorStatusLaden: () => Promise<void>;

  objektAnlegen: (daten: Partial<ObjektInstanz>) => Promise<ObjektInstanz | null>;
  objektAendern: (oid: string, daten: Partial<ObjektInstanz>, sofortLokal?: boolean) => Promise<void>;
  objektLoeschen: (oid: string) => Promise<void>;
  wegAnlegen: (daten: Partial<Weg>) => Promise<Weg | null>;
  wegAendern: (wid: string, daten: Partial<Weg>) => Promise<void>;
  wegLoeschen: (wid: string) => Promise<void>;
  blockflaecheAnlegen: (daten: Partial<Blockflaeche>) => Promise<Blockflaeche | null>;
  blockflaecheAendern: (bid: string, daten: Partial<Blockflaeche>) => Promise<void>;
  blockflaecheLoeschen: (bid: string) => Promise<void>;
  stationAnlegen: (daten: Partial<Einsatzstation>) => Promise<Einsatzstation | null>;
  stationAendern: (sid: string, daten: Partial<Einsatzstation>) => Promise<void>;
  stationLoeschen: (sid: string) => Promise<void>;

  setzeWerkzeug: (w: Werkzeug, typId?: string) => void;
  setzeAuswahl: (a: ElementRef[]) => void;
  setzeEbene: (e: keyof Ebenen, an: boolean) => void;
  setzeAnsicht: (a: '3d' | '2d' | 'geteilt') => void;
  messungHinzu: (m: Messung) => void;
  messungEntfernen: (id: string) => void;
  zeigeFehler: (text: string | null) => void;
  cursorSenden: (p: Punkt | null) => void;
  sperreAnfordern: (ref: ElementRef) => void;
  sperreFreigeben: (ref: ElementRef) => void;
  kommentareLaden: () => Promise<void>;
  ereignisseLaden: () => Promise<void>;
}

let ws: WebSocket | null = null;
let cursorDrossel = 0;

export const nutzeZustand = create<Zustand>((set, get) => ({
  nutzer: null,
  angemeldetGeprueft: false,
  bibliothek: null,
  typen: new Map(),
  projektId: null,
  projekt: null,
  inhalt: null,
  gelaende: null,
  rolle: null,
  darf: {},
  beteiligte: [],
  laedt: false,
  fehler: null,
  bericht: null,
  editorStatus: {},
  pruefungLaeuft: false,
  werkzeug: 'auswahl',
  platzierTypId: null,
  auswahl: [],
  hervorgehoben: null,
  ebenen: {
    gebaeude: true,
    // Standard ist das massgetreue digitale Abbild, nicht das Luftbild.
    nutzung: true,
    objekte: true,
    wege: true,
    blockflaechen: true,
    einsatzstationen: true,
    bemassung: true,
    luftbild: false,
    flurstuecke: false,
    gelaende: true,
  },
  raster: 0.5,
  anKantenFangen: true,
  messungen: [],
  ansicht: '3d',
  praesenz: [],
  sperren: [],
  kommentare: [],
  ereignisse: [],
  verbunden: false,

  // -- Anmeldung ----------------------------------------------------------
  async anmeldungPruefen() {
    try {
      const n = await api.ich();
      set({ nutzer: n, angemeldetGeprueft: true });
      await get().katalogeLaden();
    } catch {
      set({ nutzer: null, angemeldetGeprueft: true });
    }
  },

  async anmelden(email, passwort) {
    const n = await api.anmelden(email, passwort);
    set({ nutzer: n, fehler: null });
    await get().katalogeLaden();
  },

  async abmelden() {
    await api.abmelden();
    get().projektVerlassen();
    set({ nutzer: null });
  },

  async katalogeLaden() {
    const b = await api.bibliothek();
    set({ bibliothek: b, typen: new Map(b.typen.map((t) => [t.id, t])) });
  },

  // -- Projekt ------------------------------------------------------------
  async projektLaden(id) {
    set({ laedt: true, fehler: null });
    try {
      const d = await api.projekt(id);
      const g = d.gelaende ? await api.gelaende(d.gelaende.id) : null;
      set({
        projektId: id,
        projekt: d.projekt,
        inhalt: { projekt: d.projekt, objekte: d.objekte, wege: d.wege, blockflaechen: d.blockflaechen, einsatzstationen: d.einsatzstationen },
        gelaende: g,
        rolle: d.rolle,
        darf: d.darf,
        beteiligte: d.beteiligte,
        laedt: false,
        auswahl: [],
      });
      verbinden(id, set, get);
      void get().pruefen();
      void get().kommentareLaden();
      void get().ereignisseLaden();
    } catch (e) {
      set({ laedt: false, fehler: (e as Error).message });
    }
  },

  projektVerlassen() {
    ws?.close();
    ws = null;
    set({ projektId: null, projekt: null, inhalt: null, gelaende: null, rolle: null, bericht: null, praesenz: [], sperren: [], verbunden: false, auswahl: [] });
  },

  async pruefen() {
    const pid = get().projektId;
    if (!pid) return;
    set({ pruefungLaeuft: true });
    try {
      const b = await api.pruefen(pid);
      set({ bericht: b, pruefungLaeuft: false });
      void get().editorStatusLaden();
    } catch (e) {
      set({ pruefungLaeuft: false, fehler: (e as Error).message });
    }
  },

  async editorStatusLaden() {
    const pid = get().projektId;
    if (!pid) return;
    try {
      set({ editorStatus: await api.editorStatus(pid) });
    } catch {
      /* Editor-Status ist Beiwerk */
    }
  },

  // -- Elemente -----------------------------------------------------------
  async objektAnlegen(daten) {
    const pid = get().projektId;
    if (!pid) return null;
    try {
      const o = await api.objektAnlegen(pid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, objekte: [...s.inhalt.objekte, o] } : s.inhalt }));
      planePruefung(get);
      return o;
    } catch (e) {
      set({ fehler: (e as Error).message });
      return null;
    }
  },

  async objektAendern(oid, daten, sofortLokal) {
    const pid = get().projektId;
    if (!pid) return;
    if (sofortLokal) {
      set((s) => ({
        inhalt: s.inhalt ? { ...s.inhalt, objekte: s.inhalt.objekte.map((o) => (o.id === oid ? { ...o, ...daten } : o)) } : s.inhalt,
      }));
    }
    try {
      const o = await api.objektAendern(pid, oid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, objekte: s.inhalt.objekte.map((x) => (x.id === oid ? o : x)) } : s.inhalt }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
      void get().projektLaden(pid);
    }
  },

  async objektLoeschen(oid) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      await api.objektLoeschen(pid, oid);
      set((s) => ({
        inhalt: s.inhalt ? { ...s.inhalt, objekte: s.inhalt.objekte.filter((o) => o.id !== oid) } : s.inhalt,
        auswahl: s.auswahl.filter((a) => a.id !== oid),
      }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async wegAnlegen(daten) {
    const pid = get().projektId;
    if (!pid) return null;
    try {
      const w = await api.wegAnlegen(pid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, wege: [...s.inhalt.wege, w] } : s.inhalt }));
      planePruefung(get);
      return w;
    } catch (e) {
      set({ fehler: (e as Error).message });
      return null;
    }
  },

  async wegAendern(wid, daten) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      const w = await api.wegAendern(pid, wid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, wege: s.inhalt.wege.map((x) => (x.id === wid ? w : x)) } : s.inhalt }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async wegLoeschen(wid) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      await api.wegLoeschen(pid, wid);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, wege: s.inhalt.wege.filter((w) => w.id !== wid) } : s.inhalt, auswahl: [] }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async blockflaecheAnlegen(daten) {
    const pid = get().projektId;
    if (!pid) return null;
    try {
      const b = await api.blockflaecheAnlegen(pid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, blockflaechen: [...s.inhalt.blockflaechen, b] } : s.inhalt }));
      planePruefung(get);
      return b;
    } catch (e) {
      set({ fehler: (e as Error).message });
      return null;
    }
  },

  async blockflaecheAendern(bid, daten) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      const b = await api.blockflaecheAendern(pid, bid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, blockflaechen: s.inhalt.blockflaechen.map((x) => (x.id === bid ? b : x)) } : s.inhalt }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async blockflaecheLoeschen(bid) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      await api.blockflaecheLoeschen(pid, bid);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, blockflaechen: s.inhalt.blockflaechen.filter((b) => b.id !== bid) } : s.inhalt, auswahl: [] }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async stationAnlegen(daten) {
    const pid = get().projektId;
    if (!pid) return null;
    try {
      const st = await api.stationAnlegen(pid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, einsatzstationen: [...s.inhalt.einsatzstationen, st] } : s.inhalt }));
      planePruefung(get);
      return st;
    } catch (e) {
      set({ fehler: (e as Error).message });
      return null;
    }
  },

  async stationAendern(sid, daten) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      const st = await api.stationAendern(pid, sid, daten);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, einsatzstationen: s.inhalt.einsatzstationen.map((x) => (x.id === sid ? st : x)) } : s.inhalt }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  async stationLoeschen(sid) {
    const pid = get().projektId;
    if (!pid) return;
    try {
      await api.stationLoeschen(pid, sid);
      set((s) => ({ inhalt: s.inhalt ? { ...s.inhalt, einsatzstationen: s.inhalt.einsatzstationen.filter((x) => x.id !== sid) } : s.inhalt, auswahl: [] }));
      planePruefung(get);
    } catch (e) {
      set({ fehler: (e as Error).message });
    }
  },

  // -- Oberflaeche --------------------------------------------------------
  setzeWerkzeug: (w, typId) => set({ werkzeug: w, platzierTypId: typId ?? null }),
  setzeAuswahl: (a) => {
    set({ auswahl: a });
    if (ws?.readyState === 1) ws.send(JSON.stringify({ art: 'auswahl', auswahl: a }));
  },
  setzeEbene: (e, an) => set((s) => ({ ebenen: { ...s.ebenen, [e]: an } })),
  setzeAnsicht: (a) => set({ ansicht: a }),
  messungHinzu: (m) => set((s) => ({ messungen: [...s.messungen, m] })),
  messungEntfernen: (id) => set((s) => ({ messungen: s.messungen.filter((m) => m.id !== id) })),
  zeigeFehler: (text) => set({ fehler: text }),

  cursorSenden: (p) => {
    if (ws?.readyState !== 1) return;
    const jetzt = Date.now();
    if (jetzt - cursorDrossel < 120) return;
    cursorDrossel = jetzt;
    ws.send(JSON.stringify({ art: 'cursor', cursor: p }));
  },
  sperreAnfordern: (ref) => ws?.readyState === 1 && ws.send(JSON.stringify({ art: 'sperren', elementRef: ref })),
  sperreFreigeben: (ref) => ws?.readyState === 1 && ws.send(JSON.stringify({ art: 'entsperren', elementRef: ref })),

  async kommentareLaden() {
    const pid = get().projektId;
    if (!pid) return;
    try {
      set({ kommentare: await api.kommentare(pid) });
    } catch {
      /* still */
    }
  },

  async ereignisseLaden() {
    const pid = get().projektId;
    if (!pid) return;
    try {
      set({ ereignisse: await api.events(pid) });
    } catch {
      /* still */
    }
  },
}));

// ---------------------------------------------------------------------------

let pruefTimer: ReturnType<typeof setTimeout> | null = null;
/** Pruefung laeuft automatisch bei jeder relevanten Aenderung (F8.4, entprellt). */
function planePruefung(get: () => Zustand) {
  if (pruefTimer) clearTimeout(pruefTimer);
  pruefTimer = setTimeout(() => {
    pruefTimer = null;
    void get().pruefen();
  }, 900);
}

function verbinden(projektId: string, set: (p: Partial<Zustand> | ((s: Zustand) => Partial<Zustand>)) => void, get: () => Zustand) {
  ws?.close();
  const protokoll = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protokoll}://${location.host}/ws?projekt=${encodeURIComponent(projektId)}`);
  ws.onopen = () => set({ verbunden: true });
  ws.onclose = () => {
    set({ verbunden: false });
    // Wiederverbinden, solange dasselbe Projekt offen ist
    setTimeout(() => {
      if (get().projektId === projektId) verbinden(projektId, set, get);
    }, 2500);
  };
  ws.onmessage = (ev) => {
    let n: WsNachricht;
    try {
      n = JSON.parse(ev.data as string) as WsNachricht;
    } catch {
      return;
    }
    switch (n.art) {
      case 'hallo':
        set({ praesenz: n.praesenz, sperren: n.sperren });
        break;
      case 'praesenz':
        set((s) => ({ praesenz: [...s.praesenz.filter((p) => p.nutzerId !== n.praesenz.nutzerId), n.praesenz] }));
        break;
      case 'praesenz_weg':
        set((s) => ({ praesenz: s.praesenz.filter((p) => p.nutzerId !== n.nutzerId) }));
        break;
      case 'cursor':
        set((s) => ({
          praesenz: s.praesenz.map((p) => (p.nutzerId === n.nutzerId ? { ...p, cursor: n.cursor ?? undefined } : p)),
        }));
        break;
      case 'sperre':
        set((s) => ({
          sperren: [...s.sperren.filter((x) => !(x.elementRef.art === n.sperre.elementRef.art && x.elementRef.id === n.sperre.elementRef.id)), n.sperre],
        }));
        break;
      case 'sperre_weg':
        set((s) => ({ sperren: s.sperren.filter((x) => !(x.elementRef.art === n.elementRef.art && x.elementRef.id === n.elementRef.id)) }));
        break;
      case 'kommentar':
        set((s) => ({ kommentare: [...s.kommentare.filter((k) => k.id !== n.kommentar.id), n.kommentar] }));
        break;
      case 'pruefung':
        set({ bericht: n.bericht });
        break;
      case 'event': {
        const eigenes = n.event.nutzerId === get().nutzer?.id;
        set((s) => ({ ereignisse: [n.event, ...s.ereignisse].slice(0, 500) }));
        // Fremde Aenderungen einspielen — eigene sind schon lokal drin
        if (!eigenes) {
          const pid = get().projektId;
          if (pid) void get().projektLaden(pid);
        }
        break;
      }
      case 'fehler':
        set({ fehler: n.text });
        break;
      default:
        break;
    }
  };
}
