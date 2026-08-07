import { nutzeZustand } from '../lib/zustand.ts';
import type { Werkzeug } from '../lib/zustand.ts';

interface Eintrag {
  werkzeug: Werkzeug;
  zeichen: string;
  titel: string;
  /** Recht, das die Rolle haben muss. */
  recht?: string;
}

const WERKZEUGE: Eintrag[] = [
  { werkzeug: 'auswahl', zeichen: '➤', titel: 'Auswaehlen und verschieben (Esc bricht ab)' },
  { werkzeug: 'weg', zeichen: '⎯', titel: 'Weg zeichnen — Doppelklick beendet', recht: 'elementAnlegen' },
  { werkzeug: 'blockflaeche', zeichen: '⬠', titel: 'Blockflaeche zeichnen', recht: 'elementAnlegen' },
  { werkzeug: 'station', zeichen: '✚', titel: 'Einsatzstation setzen', recht: 'elementAnlegen' },
  { werkzeug: 'messen_distanz', zeichen: '↔', titel: 'Distanz messen (auch raeumlich)' },
  { werkzeug: 'messen_flaeche', zeichen: '▢', titel: 'Flaeche messen' },
  { werkzeug: 'kommentar', zeichen: '💬', titel: 'Kommentar an eine Stelle heften', recht: 'kommentieren' },
];

export function Werkzeugleiste() {
  const werkzeug = nutzeZustand((s) => s.werkzeug);
  const setzeWerkzeug = nutzeZustand((s) => s.setzeWerkzeug);
  const setzeAnsicht = nutzeZustand((s) => s.setzeAnsicht);
  const ansicht = nutzeZustand((s) => s.ansicht);
  const darf = nutzeZustand((s) => s.darf);
  const pruefen = nutzeZustand((s) => s.pruefen);
  const pruefungLaeuft = nutzeZustand((s) => s.pruefungLaeuft);
  const platzierTypId = nutzeZustand((s) => s.platzierTypId);
  const typen = nutzeZustand((s) => s.typen);

  return (
    <nav className="werkzeugleiste" aria-label="Werkzeuge">
      {WERKZEUGE.filter((w) => !w.recht || darf[w.recht]).map((w) => (
        <button
          key={w.werkzeug}
          type="button"
          className={`werkzeug${werkzeug === w.werkzeug ? ' werkzeug--aktiv' : ''}`}
          title={w.titel}
          aria-label={w.titel}
          aria-pressed={werkzeug === w.werkzeug}
          onClick={() => setzeWerkzeug(w.werkzeug)}
        >
          <span aria-hidden="true">{w.zeichen}</span>
        </button>
      ))}

      {werkzeug === 'platzieren' && platzierTypId && (
        <div className="werkzeug werkzeug--aktiv werkzeug--platzieren" title={`Platzieren: ${typen.get(platzierTypId)?.name ?? ''}`}>
          <span aria-hidden="true">▣</span>
        </div>
      )}

      <div className="werkzeug-trenner" />

      <div className="werkzeug-gruppe" role="group" aria-label="Ansicht">
        {(['3d', 'geteilt', '2d'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`werkzeug${ansicht === a ? ' werkzeug--aktiv' : ''}`}
            title={a === '3d' ? '3D-Ansicht' : a === '2d' ? '2D-Lageplan' : 'Beide Ansichten nebeneinander'}
            aria-pressed={ansicht === a}
            onClick={() => setzeAnsicht(a)}
          >
            <span aria-hidden="true">{a === '3d' ? '3D' : a === '2d' ? '2D' : '◫'}</span>
          </button>
        ))}
      </div>

      <div className="werkzeug-trenner" />

      <button
        type="button"
        className="werkzeug"
        title="Planung vollstaendig gegen das Regelwerk pruefen"
        onClick={() => void pruefen()}
        disabled={pruefungLaeuft}
      >
        <span aria-hidden="true">{pruefungLaeuft ? '…' : '✓'}</span>
      </button>
    </nav>
  );
}
