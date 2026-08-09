/**
 * Kopfzeile — Marke, Sichtwechsel, Projektkopf, Praesenz, Benachrichtigungen.
 *
 * Erwartete CSS-Klassen aus styles.css: .kopfzeile, .kopf-links, .kopf-mitte,
 * .kopf-rechts, .marke, .marke-knopf, .kopf-projekt, .praesenz, .praesenz-kreis,
 * .verbindung, .verbindung-punkt, .glocke, .glocke-zaehler, .glocke-liste,
 * .glocke-eintrag, .nutzer-block (dazu die gemeinsamen: .knopf, .knopf--leise,
 * .reiter, .reiter--aktiv, .karte, .leer, .trenner).
 */

import { useEffect, useRef, useState } from 'react';
import type { Benachrichtigung } from '@shared/domain/types';
import { api } from '../lib/api.ts';
import { nutzeZustand } from '../lib/zustand.ts';

type Sicht = 'dashboard' | 'polizei' | 'projekt';

const BEHOERDEN_TYPEN = ['polizei', 'behoerde_ordnungsamt', 'behoerde_feuerwehr'];

/** Initialen aus einem Namen, hoechstens zwei Buchstaben. */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return '?';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

function datum(iso?: string): string {
  if (!iso) return 'k. A.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'k. A.';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function datumZeit(iso?: string): string {
  if (!iso) return 'k. A.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'k. A.';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Kopfzeile({
  sicht,
  setzeSicht,
  schliesseProjekt,
}: {
  sicht: Sicht;
  setzeSicht: (s: Sicht) => void;
  schliesseProjekt: () => void;
}) {
  const nutzer = nutzeZustand((s) => s.nutzer);
  const abmelden = nutzeZustand((s) => s.abmelden);
  const projekt = nutzeZustand((s) => s.projekt);
  const projektId = nutzeZustand((s) => s.projektId);
  const praesenz = nutzeZustand((s) => s.praesenz);
  const verbunden = nutzeZustand((s) => s.verbunden);

  const istBehoerde = nutzer ? BEHOERDEN_TYPEN.includes(nutzer.orgTyp) : false;
  const darfBehoerdensicht = nutzer ? istBehoerde || nutzer.orgTyp === 'plattform' : false;
  const uebersichtSicht: Sicht = istBehoerde ? 'polizei' : 'dashboard';

  function zurUebersicht() {
    if (sicht === 'projekt') schliesseProjekt();
    else setzeSicht(uebersichtSicht);
  }

  function wechsle(z: Sicht) {
    if (sicht === 'projekt') schliesseProjekt();
    setzeSicht(z);
  }

  return (
    <header className="kopfzeile">
      <div className="kopf-links">
        <button type="button" className="marke-knopf" onClick={zurUebersicht} aria-label="EventPlan3D — zurück zur Übersicht">
          <span className="marke">EventPlan3D</span>
        </button>
        {darfBehoerdensicht && (
          <nav className="kopf-reiter" aria-label="Ansicht">
            <button
              type="button"
              className={`reiter${sicht === 'dashboard' ? ' reiter--aktiv' : ''}`}
              aria-current={sicht === 'dashboard' ? 'page' : undefined}
              onClick={() => wechsle('dashboard')}
            >
              Projekte
            </button>
            <button
              type="button"
              className={`reiter${sicht === 'polizei' ? ' reiter--aktiv' : ''}`}
              aria-current={sicht === 'polizei' ? 'page' : undefined}
              onClick={() => wechsle('polizei')}
            >
              Behördensicht
            </button>
          </nav>
        )}
      </div>

      <div className="kopf-mitte">
        {sicht === 'projekt' && projekt && (
          <div className="kopf-projekt">
            <span className="kopf-projektname">{projekt.name}</span>
            <span className="text-schwach zahl">
              {datum(projekt.zeitraumVon)} – {datum(projekt.zeitraumBis)}
            </span>
            <span className="text-schwach zahl">max. {projekt.maxBesucher.toLocaleString('de-DE')} Besucher</span>
            <ul className="praesenz" aria-label="Anwesende">
              {/*
                SCHLUESSEL MIT LAUFENDER NUMMER, nicht nur die Nutzer-Id.
                Derselbe Mensch kann mit zwei Fenstern verbunden sein — dann
                steht seine Id zweimal in der Anwesenheitsliste, und React
                warnt bei JEDEM Neuzeichnen. Die Warnung ist nicht harmlos:
                Sie hat die Entwicklerkonsole so geflutet, dass eigene
                Protokollzeilen beim Auslesen der letzten Eintraege nicht mehr
                sichtbar waren (Fehlsuche 09.08.2026 — daraus wurde faelsch-
                licherweise ein „Abbruch im Szenenaufbau" geschlossen).
              */}
              {praesenz.map((p, i) => (
                <li
                  key={`${p.nutzerId}#${i}`}
                  className="praesenz-kreis"
                  style={{ backgroundColor: p.farbe }}
                  title={`${p.nutzerName} · ${p.orgName}`}
                  aria-label={`${p.nutzerName}, ${p.orgName}`}
                >
                  {initialen(p.nutzerName)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="kopf-rechts">
        {sicht === 'projekt' && projektId && (
          <span className={`verbindung${verbunden ? ' verbindung--live' : ' verbindung--weg'}`}>
            <span className="verbindung-punkt" style={{ backgroundColor: verbunden ? 'var(--ok)' : 'var(--fehler)' }} aria-hidden="true" />
            {verbunden ? 'live' : 'getrennt'}
          </span>
        )}

        <Glocke />

        {nutzer && (
          <div className="nutzer-block">
            <span className="nutzer-name">{nutzer.name}</span>
            <span className="text-leise">{nutzer.orgName}</span>
          </div>
        )}

        {sicht === 'projekt' && (
          <button type="button" className="knopf knopf--leise" onClick={schliesseProjekt}>
            Projekt schließen
          </button>
        )}

        <button type="button" className="knopf knopf--leise" onClick={() => void abmelden()}>
          Abmelden
        </button>
      </div>
    </header>
  );
}

function Glocke() {
  const [liste, setListe] = useState<Benachrichtigung[]>([]);
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let aktiv = true;
    const laden = () => {
      api
        .benachrichtigungen()
        .then((b) => {
          if (aktiv) setListe(b);
        })
        .catch(() => {
          /* Benachrichtigungen sind Beiwerk — keine Fehlerleiste dafuer */
        });
    };
    laden();
    const t = setInterval(laden, 60_000);
    return () => {
      aktiv = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!offen) return;
    const klick = (ev: MouseEvent) => {
      if (huelle.current && !huelle.current.contains(ev.target as Node)) setOffen(false);
    };
    const taste = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOffen(false);
    };
    document.addEventListener('mousedown', klick);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('mousedown', klick);
      document.removeEventListener('keydown', taste);
    };
  }, [offen]);

  const ungelesen = liste.filter((b) => !b.gelesen);

  function umschalten() {
    const jetztOffen = !offen;
    setOffen(jetztOffen);
    if (jetztOffen && ungelesen.length) {
      const ids = ungelesen.map((b) => b.id);
      void api
        .benachrichtigungenGelesen(ids)
        .then(() => setListe((alt) => alt.map((b) => (ids.includes(b.id) ? { ...b, gelesen: true } : b))))
        .catch(() => {
          /* still */
        });
    }
  }

  return (
    <div className="glocke-huelle" ref={huelle}>
      <button
        type="button"
        className="knopf knopf--leise glocke"
        aria-expanded={offen}
        aria-label={`Benachrichtigungen: ${ungelesen.length.toLocaleString('de-DE')} ungelesen`}
        onClick={umschalten}
      >
        <span aria-hidden="true">🔔</span>
        {ungelesen.length > 0 && <span className="glocke-zaehler">{ungelesen.length.toLocaleString('de-DE')}</span>}
      </button>
      {offen && (
        <div className="karte glocke-liste" role="region" aria-label="Benachrichtigungen">
          {liste.length === 0 && <p className="leer">Keine Benachrichtigungen.</p>}
          {liste.slice(0, 30).map((b) => (
            <article key={b.id} className={`glocke-eintrag${b.gelesen ? '' : ' glocke-eintrag--neu'}`}>
              <h3>{b.titel}</h3>
              <p>{b.text}</p>
              <p className="text-leise zahl">{datumZeit(b.am)}</p>
              {b.link && (
                <a href={`#${b.link}`} onClick={() => setOffen(false)}>
                  Zum Projekt
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
