/**
 * Reiter "Assistent" (F7).
 *
 * Zwei Bereiche: freie Frage im Projektkontext und "Platzieren auf Zuruf".
 * EISERN: kein Vorschlag wird gespeichert, bevor ein Mensch ihn bestaetigt.
 * Das Panel meldet sich nie von selbst — es antwortet nur auf Eingaben (F7.3).
 */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { KiNachricht, KiVorschlag } from '@shared/domain/types';
import { zahl } from '@shared/geo/geometry';

const KEINE_ANGABE = 'k. A.';

interface KiStatus {
  verfuegbar: boolean;
  modell: string | null;
  hinweis: string;
  darfNutzen: boolean;
}

function quellenText(q: 'anthropic' | 'lokal' | undefined): string {
  if (q === 'anthropic') return 'Quelle: Anthropic';
  if (q === 'lokal') return 'Quelle: lokaler Regel-Assistent';
  return '';
}

export function KiPanel() {
  const projektId = nutzeZustand((s) => s.projektId);
  const [status, setStatus] = useState<KiStatus | null>(null);
  const [eingeklappt, setEingeklappt] = useState(false);

  useEffect(() => {
    if (!projektId) return;
    let lebt = true;
    void api
      .kiStatus(projektId)
      .then((s) => {
        if (lebt) setStatus(s);
      })
      .catch(() => {
        if (lebt) setStatus({ verfuegbar: false, modell: null, hinweis: 'Der Status des Assistenten ist nicht abrufbar.', darfNutzen: false });
      });
    return () => {
      lebt = false;
    };
  }, [projektId]);

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="ki-titel">
        <div className="pnl-zeile pnl-zeile--verteilt">
          <h2 className="pnl-titel" id="ki-titel">
            Assistent
          </h2>
          <button
            type="button"
            className="knopf knopf--leise"
            aria-expanded={!eingeklappt}
            aria-controls="ki-koerper"
            onClick={() => setEingeklappt((v) => !v)}
          >
            {eingeklappt ? '▾ Ausklappen' : '▴ Einklappen'}
          </button>
        </div>

        <dl className="werteliste">
          <dt>Status</dt>
          <dd>
            {status ? (
              <span className={status.verfuegbar ? 'abzeichen abzeichen--ok' : 'abzeichen abzeichen--warn'}>
                {status.verfuegbar ? 'verfügbar' : 'kein Schlüssel gesetzt'}
              </span>
            ) : (
              KEINE_ANGABE
            )}
          </dd>
          <dt>Modell</dt>
          <dd className="pnl-zahl">{status?.modell ?? KEINE_ANGABE}</dd>
        </dl>

        {/* Der Hinweis bleibt dauerhaft stehen, wenn kein Schluessel gesetzt ist. */}
        {status && !status.verfuegbar && (
          <p className="pnl-warnkasten" role="status">
            {status.hinweis || 'Ohne ANTHROPIC_API_KEY antwortet nur der lokale Regel-Assistent.'}
          </p>
        )}
        {status?.verfuegbar && status.hinweis && <p className="pnl-hilfe">{status.hinweis}</p>}
      </section>

      {!eingeklappt && (
        <div id="ki-koerper">
          <Chat gesperrt={status?.darfNutzen === false} />
          <hr className="pnl-trennlinie" />
          <Platzieren gesperrt={status?.darfNutzen === false} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Chat({ gesperrt }: { gesperrt: boolean }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  const [verlauf, setVerlauf] = useState<KiNachricht[]>([]);
  const [frage, setFrage] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const ende = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ende.current?.scrollIntoView({ block: 'end' });
  }, [verlauf]);

  async function senden() {
    const text = frage.trim();
    if (!text || !projektId || laeuft) return;
    const neuerVerlauf: KiNachricht[] = [...verlauf, { rolle: 'nutzer', text, am: new Date().toISOString() }];
    setVerlauf(neuerVerlauf);
    setFrage('');
    setLaeuft(true);
    try {
      const antwort = await api.kiFrage(
        projektId,
        text,
        verlauf.map((n) => ({ rolle: n.rolle, text: n.text })),
      );
      setVerlauf([...neuerVerlauf, { rolle: 'assistent', text: antwort.text, am: new Date().toISOString(), quelle: antwort.quelle }]);
    } catch (e) {
      zeigeFehler((e as Error).message);
      setVerlauf(neuerVerlauf);
    } finally {
      setLaeuft(false);
    }
  }

  function beiTaste(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void senden();
    }
  }

  return (
    <section className="pnl-abschnitt" aria-labelledby="ki-chat-titel">
      <h3 className="pnl-titel" id="ki-chat-titel">
        Frage zum Projekt
      </h3>

      {verlauf.length === 0 ? (
        <p className="leer">Noch keine Frage gestellt.</p>
      ) : (
        <div className="pnl-chat" role="log" aria-label="Gesprächsverlauf">
          {verlauf.map((n, i) => (
            <div key={`${n.am}-${i}`} className={n.rolle === 'nutzer' ? 'pnl-blase pnl-blase--nutzer' : 'pnl-blase pnl-blase--assistent'}>
              {n.text}
              {n.rolle === 'assistent' && n.quelle && <div className="pnl-quelle">{quellenText(n.quelle)}</div>}
            </div>
          ))}
          <div ref={ende} />
        </div>
      )}

      {laeuft && <div className="laedt-balken" />}

      <div className="pnl-eingabe">
        <div className="pnl-feldblock">
          <label htmlFor="ki-frage">Ihre Frage (Enter sendet, Umschalt+Enter macht einen Absatz)</label>
          <textarea
            id="ki-frage"
            className="feld"
            rows={2}
            value={frage}
            disabled={gesperrt || laeuft}
            onChange={(e) => setFrage(e.target.value)}
            onKeyDown={beiTaste}
          />
        </div>
        <button type="button" className="knopf knopf--haupt" disabled={gesperrt || laeuft || !frage.trim()} onClick={() => void senden()}>
          Senden
        </button>
      </div>
      {gesperrt && <p className="pnl-hilfe">Ihre Rolle darf den Assistenten nicht nutzen.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Platzieren({ gesperrt }: { gesperrt: boolean }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const typen = nutzeZustand((s) => s.typen);
  const nutzer = nutzeZustand((s) => s.nutzer);
  const objektAnlegen = nutzeZustand((s) => s.objektAnlegen);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [befehl, setBefehl] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [antwort, setAntwort] = useState<{ text: string; quelle: 'anthropic' | 'lokal'; hinweis: string } | null>(null);
  const [vorschlaege, setVorschlaege] = useState<KiVorschlag[]>([]);
  const [letzterBefehl, setLetzterBefehl] = useState('');

  async function fragen() {
    const text = befehl.trim();
    if (!text || !projektId || laeuft) return;
    setLaeuft(true);
    try {
      const r = await api.kiPlatzieren(projektId, text);
      setAntwort({ text: r.text, quelle: r.quelle, hinweis: r.hinweis });
      setVorschlaege(r.vorschlaege);
      setLetzterBefehl(text);
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  function verwerfen(index: number) {
    setVorschlaege((v) => v.filter((_, i) => i !== index));
  }

  async function uebernehmen(v: KiVorschlag, index: number) {
    if (v.aktion !== 'platzieren') {
      zeigeFehler('Dieser Vorschlag ist keine Platzierung und wird hier nicht übernommen.');
      return;
    }
    const daten: Parameters<typeof objektAnlegen>[0] & { kiVorschlag: { prompt: string; bestaetigtVon: string } } = {
      typId: v.typId,
      position: v.position,
      rotation: v.rotation,
      status: 'geplant',
      masseOverride: v.parameter,
      kiVorschlag: { prompt: letzterBefehl, bestaetigtVon: nutzer?.id ?? '' },
    };
    const angelegt = await objektAnlegen(daten);
    if (angelegt) verwerfen(index);
  }

  return (
    <section className="pnl-abschnitt" aria-labelledby="ki-platz-titel">
      <h3 className="pnl-titel" id="ki-platz-titel">
        Platzieren auf Zuruf
      </h3>
      <p className="pnl-warnkasten">
        Nichts wird ohne Ihre Bestätigung gespeichert. Der Assistent schlägt vor — übernommen wird nur, was Sie hier
        ausdrücklich mit „Übernehmen“ bestätigen.
      </p>

      <div className="pnl-eingabe">
        <div className="pnl-feldblock">
          <label htmlFor="ki-befehl">Kommando</label>
          <input
            id="ki-befehl"
            className="feld"
            type="text"
            value={befehl}
            disabled={gesperrt || laeuft}
            placeholder="z. B. Setze zwei Getränkestände an die Nordachse"
            onChange={(e) => setBefehl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void fragen();
              }
            }}
          />
        </div>
        <button type="button" className="knopf knopf--haupt" disabled={gesperrt || laeuft || !befehl.trim()} onClick={() => void fragen()}>
          Vorschlagen
        </button>
      </div>

      {laeuft && <div className="laedt-balken" />}

      {antwort && (
        <div className="pnl-empfehlung">
          <span>{antwort.text}</span>
          {antwort.hinweis && <span className="pnl-hilfe">{antwort.hinweis}</span>}
          <span className="pnl-quelle">{quellenText(antwort.quelle)}</span>
        </div>
      )}

      {vorschlaege.length === 0 ? (
        antwort && <p className="leer">Keine übernehmbaren Vorschläge.</p>
      ) : (
        <ul className="pnl-liste">
          {vorschlaege.map((v, i) => (
            <li key={`${i}-${v.aktion}`} className="pnl-vorschlag">
              {v.aktion === 'platzieren' && (
                <>
                  <strong>{typen.get(v.typId)?.name ?? v.typId}</strong>
                  <span className="pnl-zahl">
                    E {v.position[0].toFixed(2)} / N {v.position[1].toFixed(2)} · Drehung {Math.round(v.rotation)}°
                  </span>
                  {v.parameter && (
                    <span className="pnl-zahl">
                      Maße: {v.parameter.laenge !== undefined ? `${zahl(v.parameter.laenge)} m` : KEINE_ANGABE} ×{' '}
                      {v.parameter.breite !== undefined ? `${zahl(v.parameter.breite)} m` : KEINE_ANGABE} ×{' '}
                      {v.parameter.hoehe !== undefined ? `${zahl(v.parameter.hoehe)} m` : KEINE_ANGABE}
                    </span>
                  )}
                </>
              )}
              {v.aktion === 'verschieben' && (
                <>
                  <strong>Verschieben</strong>
                  <span className="pnl-zahl">
                    Objekt {v.objektId} → E {v.position[0].toFixed(2)} / N {v.position[1].toFixed(2)}
                  </span>
                </>
              )}
              {v.aktion === 'weg_aendern' && (
                <>
                  <strong>Wegbreite ändern</strong>
                  <span className="pnl-zahl">
                    Weg {v.wegId} → {zahl(v.breite)} m
                  </span>
                </>
              )}
              <span className="pnl-hilfe">{v.begruendung}</span>
              <div className="pnl-knopfreihe">
                <button
                  type="button"
                  className="knopf knopf--haupt"
                  disabled={v.aktion !== 'platzieren'}
                  onClick={() => void uebernehmen(v, i)}
                >
                  Übernehmen
                </button>
                <button type="button" className="knopf knopf--leise" onClick={() => verwerfen(i)}>
                  Verwerfen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
