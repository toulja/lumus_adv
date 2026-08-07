/**
 * Reiter "Kommentare" (F6.3): Anmerkungen am Plan, mit Bezug auf ein Element
 * oder eine Koordinate. @-Erwaehnungen loest der Server auf.
 */

import { useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { ElementArt, Kommentar } from '@shared/domain/types';

const KEINE_ANGABE = 'k. A.';

const ART_LABEL: Record<ElementArt, string> = {
  objekt: 'Objekt',
  weg: 'Weg',
  blockflaeche: 'Blockfläche',
  einsatzstation: 'Einsatzstation',
  projekt: 'Projekt',
  kommentar: 'Kommentar',
  objekttyp: 'Objekttyp',
};

function bezugText(k: Kommentar): string {
  if (k.elementRef) return `${ART_LABEL[k.elementRef.art] ?? k.elementRef.art} ${k.elementRef.id}`;
  if (k.punkt) return `Koordinate E ${k.punkt[0].toFixed(2)} / N ${k.punkt[1].toFixed(2)}`;
  return 'ohne Bezug';
}

export function KommentarePanel() {
  const kommentare = nutzeZustand((s) => s.kommentare);
  const auswahl = nutzeZustand((s) => s.auswahl);
  const projektId = nutzeZustand((s) => s.projektId);
  const darf = nutzeZustand((s) => s.darf);
  const kommentareLaden = nutzeZustand((s) => s.kommentareLaden);
  const setzeAuswahl = nutzeZustand((s) => s.setzeAuswahl);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [nurOffen, setNurOffen] = useState(true);
  const [neu, setNeu] = useState('');
  const [mitBezug, setMitBezug] = useState(true);
  const [laeuft, setLaeuft] = useState(false);

  const sichtbar = kommentare
    .filter((k) => (nurOffen ? !k.erledigt : true))
    .slice()
    .sort((a, b) => b.am.localeCompare(a.am));

  const bezug = auswahl.length > 0 ? auswahl[0] : null;

  async function anlegen() {
    const text = neu.trim();
    if (!projektId || !text || laeuft) return;
    setLaeuft(true);
    try {
      await api.kommentarAnlegen(projektId, { text, elementRef: mitBezug && bezug ? bezug : undefined });
      setNeu('');
      await kommentareLaden();
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function erledigtSetzen(kid: string, erledigt: boolean) {
    if (!projektId) return;
    try {
      await api.kommentarAendern(projektId, kid, { erledigt });
      await kommentareLaden();
    } catch (e) {
      zeigeFehler((e as Error).message);
    }
  }

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="ko-titel">
        <div className="pnl-zeile pnl-zeile--verteilt">
          <h2 className="pnl-titel" id="ko-titel">
            Kommentare ({sichtbar.length.toLocaleString('de-DE')})
          </h2>
          <button type="button" className="knopf knopf--leise" onClick={() => void kommentareLaden()}>
            Aktualisieren
          </button>
        </div>

        <div className="pnl-knopfreihe" role="group" aria-label="Filter">
          <button
            type="button"
            className={nurOffen ? 'knopf knopf--haupt' : 'knopf'}
            aria-pressed={nurOffen}
            onClick={() => setNurOffen(true)}
          >
            offen
          </button>
          <button
            type="button"
            className={!nurOffen ? 'knopf knopf--haupt' : 'knopf'}
            aria-pressed={!nurOffen}
            onClick={() => setNurOffen(false)}
          >
            alle
          </button>
        </div>
      </section>

      {darf.kommentieren === true && (
        <section className="pnl-abschnitt" aria-labelledby="ko-neu">
          <h3 className="pnl-titel" id="ko-neu">
            Neuer Kommentar
          </h3>
          <div className="pnl-feldblock">
            <label htmlFor="ko-text">Text</label>
            <textarea
              id="ko-text"
              className="feld"
              rows={3}
              value={neu}
              placeholder="@Name erwähnt eine Person"
              onChange={(e) => setNeu(e.target.value)}
            />
          </div>
          <div className="pnl-schalterzeile">
            <input
              id="ko-bezug"
              type="checkbox"
              checked={mitBezug && !!bezug}
              disabled={!bezug}
              onChange={(e) => setMitBezug(e.target.checked)}
            />
            <label htmlFor="ko-bezug">
              {bezug ? `Bezug auf ${ART_LABEL[bezug.art] ?? bezug.art} ${bezug.id}` : 'Kein Element ausgewählt'}
            </label>
          </div>
          <p className="pnl-hilfe">
            Mit @ erwähnen Sie Beteiligte (z. B. @Meier). Die Zuordnung übernimmt der Server; erwähnte Personen erhalten eine
            Benachrichtigung.
          </p>
          <button type="button" className="knopf knopf--haupt" disabled={!neu.trim() || laeuft} onClick={() => void anlegen()}>
            {laeuft ? 'Wird gespeichert …' : 'Kommentar anlegen'}
          </button>
        </section>
      )}

      {sichtbar.length === 0 ? (
        <p className="leer">Keine Kommentare.</p>
      ) : (
        <ul className="pnl-liste">
          {sichtbar.map((k) => (
            <Eintrag
              key={k.id}
              kommentar={k}
              darfSchreiben={darf.kommentieren === true}
              springen={() => k.elementRef && setzeAuswahl([k.elementRef])}
              erledigtSetzen={erledigtSetzen}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface EintragProps {
  kommentar: Kommentar;
  darfSchreiben: boolean;
  springen: () => void;
  erledigtSetzen: (kid: string, erledigt: boolean) => Promise<void>;
}

function Eintrag({ kommentar, darfSchreiben, springen, erledigtSetzen }: EintragProps) {
  const projektId = nutzeZustand((s) => s.projektId);
  const kommentareLaden = nutzeZustand((s) => s.kommentareLaden);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [antwort, setAntwort] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function antworten() {
    const text = antwort.trim();
    if (!projektId || !text || laeuft) return;
    setLaeuft(true);
    try {
      await api.kommentarAendern(projektId, kommentar.id, { antwort: text });
      setAntwort('');
      await kommentareLaden();
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <li className="pnl-eintrag">
      <div className="pnl-eintrag__kopf">
        <span className="pnl-eintrag__name">{kommentar.autorName || KEINE_ANGABE}</span>
        <span className="pnl-eintrag__zeit">{new Date(kommentar.am).toLocaleString('de-DE')}</span>
      </div>
      <span>{kommentar.text}</span>
      <div className="pnl-zeile">
        <span className="pnl-fundstelle">{bezugText(kommentar)}</span>
        {kommentar.elementRef && (
          <button type="button" className="knopf knopf--leise" onClick={springen}>
            Auswählen
          </button>
        )}
      </div>

      {kommentar.antworten.length > 0 && (
        <ul className="pnl-liste">
          {kommentar.antworten.map((a) => (
            <li key={a.id} className="pnl-antwort">
              <strong>{a.autorName || KEINE_ANGABE}</strong> · {new Date(a.am).toLocaleString('de-DE')}
              <div>{a.text}</div>
            </li>
          ))}
        </ul>
      )}

      {darfSchreiben && (
        <div className="pnl-eingabe">
          <div className="pnl-feldblock">
            <label htmlFor={`ko-ant-${kommentar.id}`}>Antwort</label>
            <input
              id={`ko-ant-${kommentar.id}`}
              className="feld"
              type="text"
              value={antwort}
              onChange={(e) => setAntwort(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void antworten();
                }
              }}
            />
          </div>
          <button type="button" className="knopf" disabled={!antwort.trim() || laeuft} onClick={() => void antworten()}>
            Antworten
          </button>
        </div>
      )}

      <div className="pnl-schalterzeile">
        <input
          id={`ko-erl-${kommentar.id}`}
          type="checkbox"
          checked={kommentar.erledigt}
          disabled={!darfSchreiben}
          onChange={(e) => void erledigtSetzen(kommentar.id, e.target.checked)}
        />
        <label htmlFor={`ko-erl-${kommentar.id}`}>erledigt</label>
      </div>
    </li>
  );
}
