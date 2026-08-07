/**
 * Anbindung an die Anthropic Messages API (Lastenheft F7, Kapitel 8).
 *
 * ACHTUNG — SICHERHEIT: Dieses Modul laeuft AUSSCHLIESSLICH serverseitig.
 * Der API-Key (ANTHROPIC_API_KEY) darf NIE im Frontend landen, weder im
 * Bundle noch in einer API-Antwort noch in einem Fehlertext. Das Frontend
 * spricht immer nur mit den eigenen /api/ki/*-Routen, nie direkt mit
 * api.anthropic.com.
 *
 * Bewusst ohne npm-SDK: es ist nicht installiert und darf laut Vorgabe nicht
 * nachinstalliert werden. Node 24 bringt globales fetch mit — das reicht.
 */

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Aktuelles Sonnet-Modell — gutes Verhaeltnis aus Qualitaet und Kosten. */
const STANDARD_MODELL = 'claude-sonnet-5';
const STANDARD_MAX_TOKENS = 4096;

/**
 * ACHTUNG max_tokens: Bei den aktuellen Modellen (sonnet-5, opus-5, …) ist
 * adaptives Denken standardmaessig AN, sobald kein `thinking`-Feld gesetzt ist.
 * `max_tokens` deckelt Denk- UND Antworttokens GEMEINSAM. Zu knapp bemessene
 * Budgets fuehren darum dazu, dass die Antwort abgeschnitten oder ganz leer
 * zurueckkommt — der Aufrufer faellt dann still auf den lokalen Weg zurueck.
 * Budgets deshalb grosszuegig setzen (Denkreserve), nicht auf die reine
 * Textlaenge. `thinking` wird bewusst NICHT gesetzt: `{type:'disabled'}` wuerde
 * bei fable-5 mit HTTP 400 abgelehnt und macht bei Werkzeugaufrufen zusaetzlich
 * Aerger (Aufrufe koennen dann als reiner Text statt als tool_use kommen).
 */

/** Zeitlimit je Anfrage (60 s laut Vorgabe). */
const ZEITLIMIT_MS = 60_000;
/** Einmalige Wiederholung bei Drosselung/Ueberlast. */
const WIEDERHOLUNG_MS = 1_500;

/**
 * Modelle, die Sampling-Parameter (temperature/top_p/top_k) NICHT mehr
 * annehmen und mit HTTP 400 antworten. Fuer diese wird `temperatur`
 * stillschweigend weggelassen, statt den Aufruf scheitern zu lassen.
 */
const OHNE_SAMPLING = [/opus-5/, /opus-4-8/, /opus-4-7/, /sonnet-5/, /fable-5/, /mythos-5/];

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface KiKonfig {
  apiKey: string | null;
  modell: string;
  maxTokens: number;
  verfuegbar: boolean;
}

/**
 * Liest die KI-Konfiguration aus der Umgebung. Wird bei JEDEM Aufruf neu
 * gelesen, damit ein nachtraeglich gesetzter Key ohne Serverneustart wirkt.
 */
export function kiKonfig(): KiKonfig {
  const rohKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const apiKey = rohKey.length > 0 ? rohKey : null;
  const rohModell = (process.env.HEINERFEST_KI_MODELL ?? '').trim();
  const modell = rohModell.length > 0 ? rohModell : STANDARD_MODELL;
  const rohMax = Number.parseInt((process.env.HEINERFEST_KI_MAXTOKENS ?? '').trim(), 10);
  const maxTokens = Number.isFinite(rohMax) && rohMax > 0 ? rohMax : STANDARD_MAX_TOKENS;
  return { apiKey, modell, maxTokens, verfuegbar: apiKey !== null };
}

/** true, wenn ein API-Key gesetzt ist. Nur dann darf die KI befragt werden. */
export function istVerfuegbar(): boolean {
  return kiKonfig().verfuegbar;
}

function unterstuetztTemperatur(modell: string): boolean {
  return !OHNE_SAMPLING.some((m) => m.test(modell));
}

function warte(ms: number): Promise<void> {
  return new Promise((auf) => setTimeout(auf, ms));
}

// ---------------------------------------------------------------------------
// Antwort-Typen
// ---------------------------------------------------------------------------

export interface WerkzeugAufruf {
  name: string;
  eingabe: any;
  id: string;
}

export interface KiAntwort {
  text: string;
  werkzeugAufrufe: WerkzeugAufruf[];
  verbrauch: { ein: number; aus: number };
}

export interface NachrichtEingabe {
  system: string;
  nachrichten: { role: 'user' | 'assistant'; content: any }[];
  werkzeuge?: any[];
  maxTokens?: number;
  temperatur?: number;
}

// ---------------------------------------------------------------------------
// Aufruf
// ---------------------------------------------------------------------------

function baueRumpf(opts: NachrichtEingabe, konfig: KiKonfig): Record<string, unknown> {
  const rumpf: Record<string, unknown> = {
    model: konfig.modell,
    max_tokens: opts.maxTokens && opts.maxTokens > 0 ? opts.maxTokens : konfig.maxTokens,
    system: opts.system,
    messages: opts.nachrichten,
  };
  if (opts.werkzeuge && opts.werkzeuge.length > 0) rumpf.tools = opts.werkzeuge;
  if (opts.temperatur !== undefined && Number.isFinite(opts.temperatur) && unterstuetztTemperatur(konfig.modell)) {
    rumpf.temperature = opts.temperatur;
  }
  return rumpf;
}

function werteAus(daten: any): KiAntwort {
  const bloecke: any[] = Array.isArray(daten?.content) ? daten.content : [];
  const textTeile: string[] = [];
  const werkzeugAufrufe: WerkzeugAufruf[] = [];
  for (const b of bloecke) {
    if (b?.type === 'text' && typeof b.text === 'string') textTeile.push(b.text);
    else if (b?.type === 'tool_use') {
      werkzeugAufrufe.push({ name: String(b.name ?? ''), eingabe: b.input, id: String(b.id ?? '') });
    }
  }
  const ein = Number(daten?.usage?.input_tokens ?? 0);
  const aus = Number(daten?.usage?.output_tokens ?? 0);
  return {
    text: textTeile.join('\n').trim(),
    werkzeugAufrufe,
    verbrauch: { ein: Number.isFinite(ein) ? ein : 0, aus: Number.isFinite(aus) ? aus : 0 },
  };
}

/**
 * Ein Aufruf der Messages API.
 *
 * Fehlerbehandlung:
 *  - HTTP-Fehler werden als Error mit Statuscode UND Antworttext geworfen.
 *  - 429 (Drosselung) und 529 (Ueberlast) werden EINMAL nach 1,5 s wiederholt.
 *  - Nach 60 s bricht der Aufruf ueber einen AbortController ab.
 */
export async function nachricht(opts: NachrichtEingabe): Promise<KiAntwort> {
  const konfig = kiKonfig();
  if (!konfig.apiKey) {
    throw new Error('Kein Anthropic-API-Key gesetzt (Umgebungsvariable ANTHROPIC_API_KEY). KI-Aufruf nicht moeglich.');
  }
  const rumpf = baueRumpf(opts, konfig);
  const koerper = JSON.stringify(rumpf);
  let letzterFehler: Error | null = null;

  for (let versuch = 0; versuch < 2; versuch++) {
    const steuerung = new AbortController();
    const uhr = setTimeout(() => steuerung.abort(), ZEITLIMIT_MS);
    let antwort: Response;
    try {
      antwort = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': konfig.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: koerper,
        signal: steuerung.signal,
      });
    } catch (e) {
      clearTimeout(uhr);
      const f = e as Error;
      if (f?.name === 'AbortError') {
        throw new Error(`Anthropic-API: Zeitlimit von ${ZEITLIMIT_MS / 1000} s ueberschritten.`);
      }
      throw new Error(`Anthropic-API nicht erreichbar: ${f?.message ?? String(e)}`);
    }
    clearTimeout(uhr);

    if (antwort.ok) {
      let daten: any;
      try {
        daten = await antwort.json();
      } catch (e) {
        throw new Error(`Anthropic-API lieferte kein gueltiges JSON: ${(e as Error).message}`);
      }
      return werteAus(daten);
    }

    let fehlertext = '';
    try {
      fehlertext = await antwort.text();
    } catch {
      fehlertext = '';
    }
    const fehler = new Error(
      `Anthropic-API antwortete mit HTTP ${antwort.status} ${antwort.statusText}: ${fehlertext || '(kein Antworttext)'}`,
    );
    if ((antwort.status === 429 || antwort.status === 529) && versuch === 0) {
      letzterFehler = fehler;
      await warte(WIEDERHOLUNG_MS);
      continue;
    }
    throw fehler;
  }

  throw letzterFehler ?? new Error('Anthropic-API: unbekannter Fehler.');
}
