/**
 * Reiter "Berichte": Ausgaben und Exporte.
 *
 * Der Vadere-Export wird VOR dem Herunterladen geprueft (Abnahmekriterium 10) —
 * ein ungueltiges Szenario darf nicht kommentarlos die Simulation erreichen.
 */

import { useEffect, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import { WEGE_TYP_LABEL } from '@shared/domain/types';

const KEINE_ANGABE = 'k. A.';

type SnapshotWahl = { id: string; name: string };

const MASSSTAEBE = [250, 500, 1000];

const SZENARIEN: { wert: string; label: string; erklaerung: string }[] = [
  { wert: 'normalbetrieb', label: 'Normalbetrieb', erklaerung: 'Besucherströme im laufenden Betrieb, alle Wege offen.' },
  { wert: 'evakuierung', label: 'Evakuierung', erklaerung: 'Vollräumung über die Entfluchtungswege.' },
  { wert: 'weg_blockiert', label: 'Weg blockiert', erklaerung: 'Ein Weg fällt aus — prüft die Ausweichkapazität.' },
];

interface VaderePruefung {
  gueltig: boolean;
  fehler: string[];
  warnungen: string[];
}

export function BerichtePanel() {
  const projektId = nutzeZustand((s) => s.projektId);
  // Bewusst der ganze Inhalt statt s.inhalt?.wege ?? [] — ein frisches []
  // aus dem Selektor wuerde den Store bei jedem Render als geaendert melden.
  const inhalt = nutzeZustand((s) => s.inhalt);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  const wege = inhalt?.wege ?? [];

  const [snapshots, setSnapshots] = useState<SnapshotWahl[]>([]);
  const [snapshotWahl, setSnapshotWahl] = useState('');
  const [massstab, setMassstab] = useState(500);
  const [szenario, setSzenario] = useState('normalbetrieb');
  const [wegWahl, setWegWahl] = useState('');
  const [pruefung, setPruefung] = useState<VaderePruefung | null>(null);
  const [pruefLaeuft, setPruefLaeuft] = useState(false);

  useEffect(() => {
    if (!projektId) return;
    let lebt = true;
    void api
      .snapshots(projektId)
      .then((l) => {
        if (lebt) setSnapshots(l.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {
        if (lebt) setSnapshots([]);
      });
    return () => {
      lebt = false;
    };
  }, [projektId]);

  // Eine neue Szenariowahl entwertet die vorherige Pruefung.
  useEffect(() => {
    setPruefung(null);
  }, [szenario, wegWahl]);

  if (!projektId) return null;

  async function vaderePruefen() {
    if (!projektId || pruefLaeuft) return;
    setPruefLaeuft(true);
    try {
      const r = await api.vaderePruefen(projektId, szenario);
      setPruefung(r.pruefung);
    } catch (e) {
      setPruefung(null);
      zeigeFehler((e as Error).message);
    } finally {
      setPruefLaeuft(false);
    }
  }

  const vadereUrl = api.exportUrl(projektId, 'vadere', {
    szenario,
    weg: szenario === 'weg_blockiert' && wegWahl ? wegWahl : undefined,
  });

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="be-titel">
        <h2 className="pnl-titel" id="be-titel">
          Berichte
        </h2>

        <div className="pnl-feldblock">
          <label htmlFor="be-snap">Datengrundlage</label>
          <select id="be-snap" className="feld" value={snapshotWahl} onChange={(e) => setSnapshotWahl(e.target.value)}>
            <option value="">Aktueller Stand</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">Konformitätsbericht (PDF)</span>
          <span className="pnl-hilfe">
            Alle geprüften Regeln mit Ist- und Sollwert, Fundstelle und Rechtsquelle — das Dokument für die Behörde.
          </span>
          <a
            className="knopf knopf--haupt"
            href={api.berichtUrl(projektId, 'konformitaet', { format: 'pdf', snapshot: snapshotWahl || undefined })}
            target="_blank"
            rel="noreferrer"
          >
            ⤓ Konformitätsbericht öffnen
          </a>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">Lageplan (PDF)</span>
          <span className="pnl-hilfe">Maßstäblicher Plan mit Objekten, Wegen, Blockflächen und Einsatzstationen.</span>
          <div className="pnl-feldblock">
            <label htmlFor="be-massstab">Maßstab</label>
            <select id="be-massstab" className="feld" value={massstab} onChange={(e) => setMassstab(Number(e.target.value))}>
              {MASSSTAEBE.map((m) => (
                <option key={m} value={m}>
                  1:{m.toLocaleString('de-DE')}
                </option>
              ))}
            </select>
          </div>
          <a
            className="knopf"
            href={api.berichtUrl(projektId, 'lageplan', { format: 'pdf', massstab, snapshot: snapshotWahl || undefined })}
            target="_blank"
            rel="noreferrer"
          >
            ⤓ Lageplan öffnen
          </a>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">Betreiberliste</span>
          <span className="pnl-hilfe">Alle Stände mit Betreiber, Ansprechpartner, Maßen und Status.</span>
          <div className="pnl-knopfreihe">
            <a
              className="knopf"
              href={api.berichtUrl(projektId, 'betreiberliste', { format: 'csv' })}
              target="_blank"
              rel="noreferrer"
            >
              ⤓ CSV
            </a>
            <a
              className="knopf"
              href={api.berichtUrl(projektId, 'betreiberliste', { format: 'pdf' })}
              target="_blank"
              rel="noreferrer"
            >
              ⤓ PDF
            </a>
          </div>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">Einsatzmappe (PDF)</span>
          <span className="pnl-hilfe">
            Unterlage für Einsatzkräfte: Stationen, Zufahrten, Sammelplätze und Ansprechpartner auf einen Blick.
          </span>
          <a
            className="knopf"
            href={api.berichtUrl(projektId, 'einsatzmappe', { format: 'pdf' })}
            target="_blank"
            rel="noreferrer"
          >
            ⤓ Einsatzmappe öffnen
          </a>
        </div>
      </section>

      <section className="pnl-abschnitt" aria-labelledby="be-export">
        <h2 className="pnl-titel" id="be-export">
          Exporte
        </h2>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">GeoJSON</span>
          <span className="pnl-hilfe">
            Alle Geometrien in EPSG:25832 für GIS-Programme — Objekte, Wege, Blockflächen, Stationen.
          </span>
          <a className="knopf" href={api.exportUrl(projektId, 'geojson')} target="_blank" rel="noreferrer">
            ⤓ GeoJSON
          </a>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">3D-Szene (glTF/.glb)</span>
          <span className="pnl-hilfe">Gelände und Baukörper als 3D-Modell für Präsentation und externe Betrachter.</span>
          <a className="knopf" href={api.exportUrl(projektId, 'szene.glb')} target="_blank" rel="noreferrer">
            ⤓ szene.glb
          </a>
        </div>

        <div className="pnl-eintrag">
          <span className="pnl-eintrag__name">Vadere-Szenario</span>
          <span className="pnl-hilfe">
            Eingabedatei für die Personenstromsimulation Vadere. Vor dem Export wird geprüft, ob das Szenario vollständig ist.
          </span>

          <div className="pnl-feldblock">
            <label htmlFor="be-szenario">Szenario</label>
            <select id="be-szenario" className="feld" value={szenario} onChange={(e) => setSzenario(e.target.value)}>
              {SZENARIEN.map((s) => (
                <option key={s.wert} value={s.wert}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <p className="pnl-hilfe">{SZENARIEN.find((s) => s.wert === szenario)?.erklaerung ?? KEINE_ANGABE}</p>

          {szenario === 'weg_blockiert' && (
            <div className="pnl-feldblock">
              <label htmlFor="be-weg">Blockierter Weg</label>
              <select id="be-weg" className="feld" value={wegWahl} onChange={(e) => setWegWahl(e.target.value)}>
                <option value="">— bitte wählen —</option>
                {wege.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name ?? WEGE_TYP_LABEL[w.typ]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pnl-knopfreihe">
            <button type="button" className="knopf" disabled={pruefLaeuft} onClick={() => void vaderePruefen()}>
              {pruefLaeuft ? 'Wird geprüft …' : 'Szenario prüfen'}
            </button>
            <a
              className={pruefung?.gueltig ? 'knopf knopf--haupt' : 'knopf knopf--leise'}
              href={vadereUrl}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!pruefung?.gueltig}
              onClick={(e) => {
                if (!pruefung?.gueltig) {
                  e.preventDefault();
                  zeigeFehler('Bitte zuerst das Szenario prüfen — der Export ist erst nach gültiger Prüfung sinnvoll.');
                }
              }}
            >
              ⤓ Vadere-Szenario
            </a>
          </div>

          {pruefLaeuft && <div className="laedt-balken" />}
          {pruefung && (
            <div className={pruefung.gueltig ? 'pnl-befund' : 'pnl-befund pnl-befund--fehler'}>
              <span className={pruefung.gueltig ? 'abzeichen abzeichen--ok' : 'abzeichen abzeichen--fehler'}>
                {pruefung.gueltig ? 'Szenario gültig' : 'Szenario ungültig'}
              </span>
              {pruefung.fehler.length > 0 && (
                <>
                  <span className="pnl-befund__meldung">Fehler:</span>
                  <ul className="pnl-diff">
                    {pruefung.fehler.map((f, i) => (
                      <li key={`f-${i}`}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
              {pruefung.warnungen.length > 0 && (
                <>
                  <span className="pnl-befund__meldung">Warnungen:</span>
                  <ul className="pnl-diff">
                    {pruefung.warnungen.map((w, i) => (
                      <li key={`w-${i}`}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              {pruefung.fehler.length === 0 && pruefung.warnungen.length === 0 && (
                <span className="pnl-hilfe">Keine Beanstandungen.</span>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
