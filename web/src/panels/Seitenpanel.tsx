/**
 * Seitenpanel der Projektansicht: Reiterleiste + aktiver Reiter.
 *
 * Die Reiter holen sich ihre Daten selbst aus dem Zustandsspeicher — hier
 * werden bewusst KEINE Daten durchgereicht. Sichtbar ist ein Reiter nur,
 * wenn die Projektrolle das zugehoerige Recht mitbringt (zustand.darf.*).
 */

import { useEffect, useRef, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { BibliothekPanel } from './BibliothekPanel.tsx';
import { EigenschaftenPanel } from './EigenschaftenPanel.tsx';
import { PruefungPanel } from './PruefungPanel.tsx';
import { KiPanel } from './KiPanel.tsx';
import { EbenenPanel } from './EbenenPanel.tsx';
import { BeteiligtePanel } from './BeteiligtePanel.tsx';
import { VersionenPanel } from './VersionenPanel.tsx';
import { KommentarePanel } from './KommentarePanel.tsx';
import { BerichtePanel } from './BerichtePanel.tsx';
import './panels.css';

type ReiterId =
  | 'bauteile'
  | 'eigenschaften'
  | 'pruefung'
  | 'assistent'
  | 'ebenen'
  | 'beteiligte'
  | 'staende'
  | 'kommentare'
  | 'berichte';

interface ReiterDef {
  id: ReiterId;
  label: string;
  /** Schluessel in zustand.darf; ohne Angabe immer sichtbar. */
  recht?: string;
}

const REITER: ReiterDef[] = [
  { id: 'bauteile', label: 'Bauteile', recht: 'elementAnlegen' },
  { id: 'eigenschaften', label: 'Eigenschaften' },
  { id: 'pruefung', label: 'Prüfung' },
  { id: 'assistent', label: 'Assistent', recht: 'ki' },
  { id: 'ebenen', label: 'Ebenen' },
  { id: 'beteiligte', label: 'Beteiligte' },
  { id: 'staende', label: 'Planungsstände' },
  { id: 'kommentare', label: 'Kommentare' },
  { id: 'berichte', label: 'Berichte', recht: 'berichte' },
];

export function Seitenpanel() {
  const darf = nutzeZustand((s) => s.darf);
  const auswahl = nutzeZustand((s) => s.auswahl);

  const [aktiv, setAktiv] = useState<ReiterId>('eigenschaften');
  const vorherigeAnzahl = useRef(auswahl.length);

  // Wechselt auf "Eigenschaften", sobald etwas ausgewaehlt wird und vorher
  // nichts ausgewaehlt war. Wer selbst umschaltet, bleibt dort.
  useEffect(() => {
    if (auswahl.length > 0 && vorherigeAnzahl.current === 0) setAktiv('eigenschaften');
    vorherigeAnzahl.current = auswahl.length;
  }, [auswahl]);

  const sichtbare = REITER.filter((r) => !r.recht || darf[r.recht] === true);
  const gewaehlt = sichtbare.some((r) => r.id === aktiv) ? aktiv : (sichtbare[0]?.id ?? 'eigenschaften');

  return (
    <aside className="pnl-panel" aria-label="Projektwerkzeuge">
      <div className="pnl-reiterleiste" role="tablist" aria-label="Bereiche">
        {sichtbare.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            id={`pnl-reiter-${r.id}`}
            aria-selected={gewaehlt === r.id}
            aria-controls={`pnl-tafel-${r.id}`}
            className={gewaehlt === r.id ? 'reiter reiter--aktiv' : 'reiter'}
            onClick={() => setAktiv(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div
        className="pnl-inhalt"
        role="tabpanel"
        id={`pnl-tafel-${gewaehlt}`}
        aria-labelledby={`pnl-reiter-${gewaehlt}`}
        tabIndex={0}
      >
        {gewaehlt === 'bauteile' && <BibliothekPanel />}
        {gewaehlt === 'eigenschaften' && <EigenschaftenPanel />}
        {gewaehlt === 'pruefung' && <PruefungPanel />}
        {gewaehlt === 'assistent' && <KiPanel />}
        {gewaehlt === 'ebenen' && <EbenenPanel />}
        {gewaehlt === 'beteiligte' && <BeteiligtePanel />}
        {gewaehlt === 'staende' && <VersionenPanel />}
        {gewaehlt === 'kommentare' && <KommentarePanel />}
        {gewaehlt === 'berichte' && <BerichtePanel />}
      </div>
    </aside>
  );
}
