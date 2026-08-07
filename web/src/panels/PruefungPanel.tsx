/**
 * Reiter "Pruefung": Ergebnis der Regelpruefung, Verstoesse zuerst.
 *
 * Die KI erklaert nur — geaendert wird ausschliesslich nach ausdruecklicher
 * Bestaetigung durch den Menschen (Lastenheft F7).
 */

import { useEffect, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { ElementRef, Pruefergebnis, Punkt, Regelwerk, Schweregrad } from '@shared/domain/types';
import { zahl } from '@shared/geo/geometry';

const KEINE_ANGABE = 'k. A.';

const GRAD_LABEL: Record<Schweregrad, string> = {
  fehler: 'Fehler',
  warnung: 'Warnungen',
  hinweis: 'Hinweise',
};

interface Erklaerung {
  text: string;
  quelle: 'anthropic' | 'lokal';
  verschiebung: { elementId: string; dE: number; dN: number; meter: number; richtung: string } | null;
}

function quellenText(q: 'anthropic' | 'lokal'): string {
  return q === 'anthropic' ? 'Quelle: Anthropic' : 'Quelle: lokaler Regel-Assistent';
}

export function PruefungPanel() {
  const bericht = nutzeZustand((s) => s.bericht);
  const pruefungLaeuft = nutzeZustand((s) => s.pruefungLaeuft);
  const pruefen = nutzeZustand((s) => s.pruefen);
  const projekt = nutzeZustand((s) => s.projekt);

  const [regelwerk, setRegelwerk] = useState<Regelwerk | null>(null);
  const regelwerkId = projekt?.regelwerkId;

  useEffect(() => {
    if (!regelwerkId) return;
    let lebt = true;
    void api
      .regelwerk(regelwerkId)
      .then((r) => {
        if (lebt) setRegelwerk(r);
      })
      .catch(() => {
        if (lebt) setRegelwerk(null);
      });
    return () => {
      lebt = false;
    };
  }, [regelwerkId]);

  const z = bericht?.zusammenfassung;
  const verstoesse = (bericht?.ergebnisse ?? []).filter((e) => e.status === 'verstoss');
  const nichtPruefbar = (bericht?.ergebnisse ?? []).filter((e) => e.status === 'nicht_pruefbar');
  const inOrdnung = (bericht?.ergebnisse ?? []).filter((e) => e.status === 'ok');

  const gruppen: { grad: Schweregrad; liste: Pruefergebnis[] }[] = (['fehler', 'warnung', 'hinweis'] as Schweregrad[]).map(
    (grad) => ({ grad, liste: verstoesse.filter((e) => e.schweregrad === grad) }),
  );

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="pr-titel">
        <h2 className="pnl-titel" id="pr-titel">
          Prüfung
        </h2>

        <div className="pnl-ampel">
          <div className="pnl-ampel__feld pnl-ampel__feld--fehler">
            <div className="pnl-ampel__zahl">{(z?.fehler ?? 0).toLocaleString('de-DE')}</div>
            <div className="pnl-ampel__text">Fehler</div>
          </div>
          <div className="pnl-ampel__feld pnl-ampel__feld--warnung">
            <div className="pnl-ampel__zahl">{(z?.warnungen ?? 0).toLocaleString('de-DE')}</div>
            <div className="pnl-ampel__text">Warnungen</div>
          </div>
          <div className="pnl-ampel__feld pnl-ampel__feld--hinweis">
            <div className="pnl-ampel__zahl">{(z?.hinweise ?? 0).toLocaleString('de-DE')}</div>
            <div className="pnl-ampel__text">Hinweise</div>
          </div>
          <div className="pnl-ampel__feld pnl-ampel__feld--ok">
            <div className="pnl-ampel__zahl">{(z?.ok ?? 0).toLocaleString('de-DE')}</div>
            <div className="pnl-ampel__text">OK</div>
          </div>
          <div className="pnl-ampel__feld">
            <div className="pnl-ampel__zahl">{(z?.nichtPruefbar ?? 0).toLocaleString('de-DE')}</div>
            <div className="pnl-ampel__text">n. prüfbar</div>
          </div>
        </div>

        <button type="button" className="knopf knopf--haupt" disabled={pruefungLaeuft} onClick={() => void pruefen()}>
          {pruefungLaeuft ? 'Prüfung läuft …' : 'Jetzt vollständig prüfen'}
        </button>
        {pruefungLaeuft && <div className="laedt-balken" />}

        <dl className="werteliste">
          <dt>Letzte Prüfung</dt>
          <dd className="pnl-zahl">{bericht ? new Date(bericht.zeit).toLocaleString('de-DE') : KEINE_ANGABE}</dd>
          <dt>Regelwerk</dt>
          <dd>
            {regelwerk?.bezeichnung ?? bericht?.regelwerkId ?? KEINE_ANGABE} · Version{' '}
            {bericht?.regelwerkVersion ?? regelwerk?.version ?? KEINE_ANGABE}
            {regelwerk?.stand ? ` · Stand ${regelwerk.stand}` : ''}
          </dd>
        </dl>
      </section>

      {!bericht && <p className="leer">Es liegt noch kein Prüfbericht vor.</p>}

      {bericht && verstoesse.length === 0 && (
        <p className="abzeichen abzeichen--ok">Keine Verstöße — {inOrdnung.length.toLocaleString('de-DE')} Regeln erfüllt.</p>
      )}

      {gruppen
        .filter((g) => g.liste.length > 0)
        .map((g) => (
          <section className="pnl-abschnitt" key={g.grad} aria-labelledby={`pr-grad-${g.grad}`}>
            <h3 className="pnl-titel" id={`pr-grad-${g.grad}`}>
              {GRAD_LABEL[g.grad]} ({g.liste.length.toLocaleString('de-DE')})
            </h3>
            {g.liste.map((e) => (
              <Befund key={e.id} ergebnis={e} />
            ))}
          </section>
        ))}

      {nichtPruefbar.length > 0 && (
        <section className="pnl-abschnitt" aria-labelledby="pr-np">
          <h3 className="pnl-titel" id="pr-np">
            Nicht prüfbar ({nichtPruefbar.length.toLocaleString('de-DE')})
          </h3>
          {nichtPruefbar.map((e) => (
            <Befund key={e.id} ergebnis={e} />
          ))}
        </section>
      )}

      <section className="pnl-abschnitt">
        <h3 className="pnl-titel">Haftungshinweis</h3>
        <p className="pnl-haftung">{regelwerk?.haftungshinweis || bericht?.haftungshinweis || KEINE_ANGABE}</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Befund({ ergebnis }: { ergebnis: Pruefergebnis }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const setzeAuswahl = nutzeZustand((s) => s.setzeAuswahl);
  const objektAendern = nutzeZustand((s) => s.objektAendern);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  const darfKi = nutzeZustand((s) => s.darf.ki);

  const [erklaerung, setErklaerung] = useState<Erklaerung | null>(null);
  const [laedt, setLaedt] = useState(false);

  const klasse = ergebnis.status === 'nicht_pruefbar' ? 'nicht_pruefbar' : ergebnis.schweregrad;
  const einheit = ergebnis.einheit || '';

  function springen() {
    setzeAuswahl(ergebnis.elemente);
    window.dispatchEvent(
      new CustomEvent<{ ort: Punkt | undefined; elemente: ElementRef[] }>('ep3d:springe', {
        detail: { ort: ergebnis.ort, elemente: ergebnis.elemente },
      }),
    );
  }

  async function erklaeren() {
    if (!projektId || laedt) return;
    setLaedt(true);
    try {
      setErklaerung(await api.kiErklaeren(projektId, ergebnis.id));
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaedt(false);
    }
  }

  function verschiebungAnwenden() {
    const v = erklaerung?.verschiebung;
    if (!v) return;
    const objekt = nutzeZustand.getState().inhalt?.objekte.find((o) => o.id === v.elementId);
    if (!objekt) {
      zeigeFehler('Das zu verschiebende Objekt wurde nicht gefunden.');
      return;
    }
    const ziel: Punkt = [objekt.position[0] + v.dE, objekt.position[1] + v.dN];
    const frage =
      `Objekt um ${zahl(v.meter)} m nach ${v.richtung} verschieben?\n` +
      `Neue Lage: E ${ziel[0].toFixed(2)} / N ${ziel[1].toFixed(2)}`;
    if (!window.confirm(frage)) return;
    void objektAendern(v.elementId, { position: ziel }, true);
  }

  return (
    <article className={`pnl-befund pnl-befund--${klasse}`}>
      <div className="pnl-befund__kopf">
        <span className="pnl-befund__titel">{ergebnis.regelTitel}</span>
        <span className="pnl-befund__regel">{ergebnis.regelId}</span>
      </div>
      <p className="pnl-befund__meldung">{ergebnis.meldung}</p>

      <div className="pnl-messwert">
        <span className="pnl-messwert__ist">
          Ist {ergebnis.istWert === null ? KEINE_ANGABE : `${zahl(ergebnis.istWert)}${einheit ? ` ${einheit}` : ''}`}
        </span>
        <span className="pnl-messwert__soll">
          {' / Soll '}
          {ergebnis.sollWert === null ? KEINE_ANGABE : `${zahl(ergebnis.sollWert)}${einheit ? ` ${einheit}` : ''}`}
        </span>
      </div>

      <div className="pnl-fundstelle">{ergebnis.fundstelle || KEINE_ANGABE}</div>

      <div className="pnl-knopfreihe">
        <button type="button" className="knopf" onClick={springen}>
          Zum Ort springen
        </button>
        {darfKi === true && (
          <button type="button" className="knopf knopf--leise" disabled={laedt} onClick={() => void erklaeren()}>
            {laedt ? 'Empfehlung wird geholt …' : 'Empfehlung'}
          </button>
        )}
      </div>

      {erklaerung && (
        <div className="pnl-empfehlung">
          <span>{erklaerung.text}</span>
          <span className="pnl-quelle">{quellenText(erklaerung.quelle)}</span>
          {erklaerung.verschiebung && (
            <>
              <span className="pnl-zahl">
                Vorschlag: {zahl(erklaerung.verschiebung.meter)} m nach {erklaerung.verschiebung.richtung}
              </span>
              <button type="button" className="knopf" onClick={verschiebungAnwenden}>
                Verschiebung anwenden
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
