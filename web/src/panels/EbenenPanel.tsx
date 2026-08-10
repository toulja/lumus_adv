/**
 * Reiter "Ebenen": Sichtbarkeit, Raster, Fang, Ansicht, Messungen — und der
 * Quellennachweis des Gelaendes (Nachweispflicht F1.4).
 */

import { nutzeZustand } from '../lib/zustand.ts';
import type { Ebenen } from '../lib/zustand.ts';
import { zahl } from '@shared/geo/geometry';

const KEINE_ANGABE = 'k. A.';

const EBENEN_LABEL: Record<keyof Ebenen, string> = {
  nutzung: 'Bodenzeichnung (Straßen, Gehwege, Grün)',
  gebaeude: 'Gebäude',
  objekte: 'Objekte',
  wege: 'Wege',
  blockflaechen: 'Blockflächen',
  einsatzstationen: 'Einsatzstationen',
  bemassung: 'Bemaßung',
  luftbild: 'Luftbild',
  flurstuecke: 'Flurstücke',
  gelaende: 'Gelände',
  schatten: 'Schlagschatten',
};

const EBENEN_REIHE: (keyof Ebenen)[] = [
  'gebaeude',
  'objekte',
  'wege',
  'blockflaechen',
  'einsatzstationen',
  'bemassung',
  'luftbild',
  'flurstuecke',
  'gelaende',
  'schatten',
];

const RASTER: { wert: 0 | 0.1 | 0.5 | 1; label: string }[] = [
  { wert: 0, label: 'aus' },
  { wert: 0.1, label: '0,1 m' },
  { wert: 0.5, label: '0,5 m' },
  { wert: 1, label: '1 m' },
];

const ANSICHTEN: { wert: '3d' | '2d' | 'geteilt'; label: string }[] = [
  { wert: '3d', label: '3D' },
  { wert: '2d', label: '2D' },
  { wert: 'geteilt', label: 'geteilt' },
];

export function EbenenPanel() {
  const ebenen = nutzeZustand((s) => s.ebenen);
  const setzeEbene = nutzeZustand((s) => s.setzeEbene);
  const raster = nutzeZustand((s) => s.raster);
  const anKantenFangen = nutzeZustand((s) => s.anKantenFangen);
  const ansicht = nutzeZustand((s) => s.ansicht);
  const setzeAnsicht = nutzeZustand((s) => s.setzeAnsicht);
  const messungen = nutzeZustand((s) => s.messungen);
  const messungEntfernen = nutzeZustand((s) => s.messungEntfernen);
  const gelaende = nutzeZustand((s) => s.gelaende);

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="eb-titel">
        <h2 className="pnl-titel" id="eb-titel">
          Ebenen
        </h2>
        {EBENEN_REIHE.map((k) => (
          <div className="pnl-schalterzeile" key={k}>
            <input
              id={`eb-${k}`}
              type="checkbox"
              checked={ebenen[k]}
              onChange={(e) => setzeEbene(k, e.target.checked)}
            />
            <label htmlFor={`eb-${k}`}>{EBENEN_LABEL[k]}</label>
          </div>
        ))}
      </section>

      <section className="pnl-abschnitt" aria-labelledby="eb-zeichnen">
        <h2 className="pnl-titel" id="eb-zeichnen">
          Zeichenhilfen
        </h2>
        <div className="pnl-feldblock">
          <label htmlFor="eb-raster">Raster</label>
          <select
            id="eb-raster"
            className="feld"
            value={String(raster)}
            onChange={(e) => nutzeZustand.setState({ raster: Number(e.target.value) as 0 | 0.1 | 0.5 | 1 })}
          >
            {RASTER.map((r) => (
              <option key={r.label} value={String(r.wert)}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pnl-schalterzeile">
          <input
            id="eb-fangen"
            type="checkbox"
            checked={anKantenFangen}
            onChange={(e) => nutzeZustand.setState({ anKantenFangen: e.target.checked })}
          />
          <label htmlFor="eb-fangen">an Kanten fangen</label>
        </div>
        <p className="pnl-hilfe">
          Das Raster rundet Positionen beim Zeichnen und Verschieben. Der Kantenfang zieht zusätzlich auf Objekt- und
          Wegkanten in der Nähe.
        </p>
      </section>

      <section className="pnl-abschnitt" aria-labelledby="eb-ansicht">
        <h2 className="pnl-titel" id="eb-ansicht">
          Ansicht
        </h2>
        <div className="pnl-knopfreihe" role="group" aria-label="Ansicht umschalten">
          {ANSICHTEN.map((a) => (
            <button
              key={a.wert}
              type="button"
              className={ansicht === a.wert ? 'knopf knopf--haupt' : 'knopf'}
              aria-pressed={ansicht === a.wert}
              onClick={() => setzeAnsicht(a.wert)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </section>

      <section className="pnl-abschnitt" aria-labelledby="eb-messungen">
        <h2 className="pnl-titel" id="eb-messungen">
          Messungen ({messungen.length.toLocaleString('de-DE')})
        </h2>
        {messungen.length === 0 ? (
          <p className="leer">Keine Messung abgelegt.</p>
        ) : (
          <ul className="pnl-liste">
            {messungen.map((m) => (
              <li key={m.id} className="pnl-eintrag">
                <div className="pnl-eintrag__kopf">
                  <span className="pnl-eintrag__name">{m.art === 'distanz' ? 'Strecke' : 'Fläche'}</span>
                  <span className="pnl-eintrag__zeit pnl-zahl">
                    {m.art === 'distanz' ? `${zahl(m.wert)} m` : `${zahl(m.wert, 1)} m²`}
                  </span>
                </div>
                <span>{m.text || KEINE_ANGABE}</span>
                <button
                  type="button"
                  className="knopf knopf--gefahr"
                  onClick={() => messungEntfernen(m.id)}
                  aria-label={`Messung ${m.text || m.id} löschen`}
                >
                  Löschen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        DATENLUECKEN — sie stehen VOR dem Quellennachweis, weil sie die
        wichtigere Aussage sind: nicht, woher die Daten kommen, sondern WO SIE
        FEHLEN. Der Befund, der dazu gefuehrt hat: Beim Ausbau des Gebiets
        fehlten an den neuen Stellen die Baeume, weil der ortsgebundene
        Katasterauszug dort endet — und nichts hat es gemeldet. Ein stiller
        Ausfall ist damit ausgeschlossen.
      */}
      {gelaende?.datenluecken?.length ? (
        <section className="pnl-abschnitt" aria-labelledby="eb-luecken">
          <h2 className="pnl-titel" id="eb-luecken">
            Datenlücken ({gelaende.datenluecken.length})
          </h2>
          <p className="pnl-hilfe">
            Stellen, an denen das Modell weniger weiß, als es soll. Sie sind kein Fehler der Anwendung, sondern eine
            Angabe über ihre Reichweite — beim Import gemessen, nicht vermutet.
          </p>
          <ul className="pnl-liste">
            {gelaende.datenluecken.map((l, i) => (
              <li key={`${l.elementart}-${l.art}-${i}`} className="pnl-eintrag">
                <span className="pnl-eintrag__name">{l.bezeichnung}</span>
                <dl className="pnl-quellennachweis">
                  <dt>Art</dt>
                  <dd>
                    {l.art === 'kataster_deckt_nicht'
                      ? 'Katasterauszug deckt das Gebiet nicht'
                      : l.art === 'kein_kataster'
                        ? 'Kein Katasterauszug vorhanden'
                        : l.art === 'ungleiche_verteilung'
                          ? 'Ungleiche Verteilung im Gebiet'
                          : l.art === 'unter_erwartung'
                            ? 'Unter der Abdeckungserwartung'
                            : 'Zwischengespeicherter Stand benutzt'}
                  </dd>
                  <dt>Befund</dt>
                  <dd>{l.text}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pnl-abschnitt" aria-labelledby="eb-quellen">
        <h2 className="pnl-titel" id="eb-quellen">
          Quellennachweis
        </h2>
        {!gelaende || gelaende.quellennachweis.length === 0 ? (
          <p className="leer">Kein Quellennachweis hinterlegt.</p>
        ) : (
          <>
            <p className="pnl-hilfe">
              Herkunft der Geländedaten — Höhenherkunft: {gelaende.hoehenHerkunft || KEINE_ANGABE}.
            </p>
            <ul className="pnl-liste">
              {gelaende.quellennachweis.map((q, i) => (
                <li key={`${q.datensatz}-${i}`} className="pnl-eintrag">
                  <span className="pnl-eintrag__name">{q.datensatz || KEINE_ANGABE}</span>
                  <dl className="pnl-quellennachweis">
                    <dt>Dienst</dt>
                    <dd>{q.dienst || KEINE_ANGABE}</dd>
                    <dt>Abgerufen am</dt>
                    <dd className="pnl-zahl">{q.abgerufenAm ? new Date(q.abgerufenAm).toLocaleString('de-DE') : KEINE_ANGABE}</dd>
                    <dt>Lizenz</dt>
                    <dd>{q.lizenz || KEINE_ANGABE}</dd>
                    <dt>Quellenvermerk</dt>
                    <dd>{q.quellenvermerk || KEINE_ANGABE}</dd>
                    {q.hinweis && (
                      <>
                        <dt>Hinweis</dt>
                        <dd>{q.hinweis}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
