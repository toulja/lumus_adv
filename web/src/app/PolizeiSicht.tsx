/**
 * F11 — Eigene, LESENDE Startansicht fuer Polizei und Behoerden.
 *
 * Kernpunkt des Lastenhefts: Die Polizei sieht alle Projekte ihres
 * Zustaendigkeitsbereichs OHNE Einladung (Serverseite: routes/polizei.ts,
 * lib/rechte.ts). Diese Ansicht veraendert nichts — sie liest, zaehlt und
 * verweist zum Bearbeiten auf die 3D-Ansicht.
 *
 * Zwei Ebenen in einer Datei:
 *   1. Uebersicht  — Karten aller zustaendigen Projekte (api.polizeiUebersicht)
 *   2. Lagebild    — Detailansicht eines Projekts (api.lagebild + betreiberliste),
 *                    eingeblendet ueber `lagebildId`, zurueck ueber den Kopfknopf.
 *
 * Eigene CSS-Klassen liegen in ./polizei.css (Praefix .pol-), die gemeinsamen
 * Bausteine kommen aus styles.css.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BLOCK_TYP_LABEL,
  FREIGABE_LABEL,
  KATEGORIE_LABEL,
  ORG_TYP_LABEL,
  ROLLE_LABEL,
  STATION_FARBE,
  WEGE_TYP_LABEL,
} from '@shared/domain/types';
import type { BetreiberZeile, Lagebild, PolizeiProjekt } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { nutzeZustand } from '../lib/zustand.ts';
import './polizei.css';

// ---------------------------------------------------------------------------
// Formatierung — fehlende Werte heissen immer "k. A.", nie geraten.
// ---------------------------------------------------------------------------

const KA = 'k. A.';

function ganzeZahl(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('de-DE') : KA;
}

/** Meter immer mit zwei Nachkommastellen. */
function meter(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return KA;
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

function datum(iso: string | null | undefined): string {
  if (!iso) return KA;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? KA : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function datumZeit(iso: string | null | undefined): string {
  if (!iso) return KA;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? KA : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function text(wert: string | null | undefined): string {
  const t = (wert ?? '').trim();
  return t.length > 0 ? t : KA;
}

/** Beschriftung aus einer der gemeinsamen Label-Tabellen, sonst "k. A.". */
function ausTabelle(tabelle: Record<string, string>, schluessel: string | null | undefined): string {
  if (!schluessel) return KA;
  const wert = tabelle[schluessel];
  return typeof wert === 'string' && wert.length > 0 ? wert : KA;
}

const RICHTUNG_LABEL: Record<string, string> = {
  vorwaerts: 'Vorwärts',
  rueckwaerts: 'Rückwärts',
  beide: 'Beide Richtungen',
};

const SCHWEREGRAD_LABEL: Record<string, string> = {
  fehler: 'Fehler',
  warnung: 'Warnung',
  hinweis: 'Hinweis',
};

const SCHWEREGRAD_RANG: Record<string, number> = { fehler: 0, warnung: 1, hinweis: 2 };

/** Signalfarbe einer Stationskategorie; unbekannte Kategorie bleibt neutral. */
function stationsFarbe(kategorie: string): string {
  const farben: Record<string, string> = STATION_FARBE;
  const f = farben[kategorie];
  return typeof f === 'string' && f.length > 0 ? f : '#6b7d8d';
}

function abzeichenKlasse(schweregrad: string): string {
  if (schweregrad === 'fehler') return 'abzeichen abzeichen--fehler';
  if (schweregrad === 'warnung') return 'abzeichen abzeichen--warn';
  return 'abzeichen';
}

function freigabeKlasse(status: string): string {
  if (status === 'freigegeben') return 'abzeichen abzeichen--ok';
  if (status === 'mit_auflagen') return 'abzeichen abzeichen--warn';
  if (status === 'abgelehnt') return 'abzeichen abzeichen--fehler';
  return 'abzeichen';
}

/** Ab dieser Entfernung zur naechsten Feuerwehrzufahrt wird gewarnt. */
const DISTANZ_WARNSCHWELLE_M = 50;

type Zusammenfassung = { fehler: number; warnungen: number; hinweise: number; ok: number; nichtPruefbar: number };

// ---------------------------------------------------------------------------
// Ampel der Regelpruefung
// ---------------------------------------------------------------------------

function Pruefampel({ pruefung }: { pruefung: Zusammenfassung | null }) {
  if (!pruefung) {
    return (
      <p className="pol-ampel">
        <span className="pol-punkte" aria-hidden="true">
          <span className="pol-punkt" />
          <span className="pol-punkt" />
          <span className="pol-punkt" />
        </span>
        <span className="pol-ampel-text">Regelprüfung: {KA} (noch kein Prüfbericht)</span>
      </p>
    );
  }
  const stufe = pruefung.fehler > 0 ? 'fehler' : pruefung.warnungen > 0 ? 'warn' : 'ok';
  const wort = stufe === 'fehler' ? 'Verstöße festgestellt' : stufe === 'warn' ? 'Warnungen offen' : 'Keine Verstöße';
  return (
    <p className="pol-ampel">
      <span className="pol-punkte" aria-hidden="true">
        <span className={`pol-punkt pol-punkt--fehler${stufe === 'fehler' ? ' pol-punkt--an' : ''}`} />
        <span className={`pol-punkt pol-punkt--warn${stufe === 'warn' ? ' pol-punkt--an' : ''}`} />
        <span className={`pol-punkt pol-punkt--ok${stufe === 'ok' ? ' pol-punkt--an' : ''}`} />
      </span>
      <span className="pol-ampel-text">
        {wort}: <b>{ganzeZahl(pruefung.fehler)}</b> Fehler, <b>{ganzeZahl(pruefung.warnungen)}</b> Warnungen,{' '}
        <b>{ganzeZahl(pruefung.hinweise)}</b> Hinweise, <b>{ganzeZahl(pruefung.nichtPruefbar)}</b> nicht prüfbar
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// 1  Uebersicht
// ---------------------------------------------------------------------------

export function PolizeiSicht({ oeffneProjekt }: { oeffneProjekt: (id: string) => void }) {
  const nutzer = nutzeZustand((s) => s.nutzer);
  const [organisation, setOrganisation] = useState<{ id: string; name: string; typ: string; zustaendigkeitsgebiet?: string } | null>(null);
  const [letzterBesuch, setLetzterBesuch] = useState<string>('');
  const [projekte, setProjekte] = useState<PolizeiProjekt[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [lagebildId, setLagebildId] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLaedt(true);
    setFehler(null);
    try {
      const d = await api.polizeiUebersicht();
      setOrganisation(d.organisation);
      setLetzterBesuch(d.letzterBesuch);
      setProjekte(d.projekte);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const sortiert = useMemo(
    () =>
      [...projekte].sort((a, b) => {
        const d = b.aenderungenSeitBesuch - a.aenderungenSeitBesuch;
        if (d !== 0) return d;
        return a.projekt.zeitraumVon.localeCompare(b.projekt.zeitraumVon);
      }),
    [projekte],
  );

  const gesamtNeu = useMemo(() => projekte.reduce((s, p) => s + p.aenderungenSeitBesuch, 0), [projekte]);

  if (lagebildId) {
    return <Lagebildansicht projektId={lagebildId} zurueck={() => setLagebildId(null)} oeffneProjekt={oeffneProjekt} />;
  }

  const erstbesuch = letzterBesuch ? new Date(letzterBesuch).getTime() <= 0 : true;

  return (
    <div className="pol">
      <header className="pol-kopf">
        <div className="pol-kopf-links">
          <h1>{text(organisation?.name ?? nutzer?.orgName)}</h1>
          <div className="pol-kopf-unter">
            <span className="abzeichen">{ausTabelle(ORG_TYP_LABEL, organisation?.typ ?? nutzer?.orgTyp)}</span>
            <span>
              Zuständigkeitsgebiet: <strong>{text(organisation?.zustaendigkeitsgebiet)}</strong>
            </span>
          </div>
        </div>
        <div className="pol-kopf-rechts">
          {erstbesuch
            ? 'Änderungen werden seit Ihrem ersten Aufruf gezählt.'
            : `Änderungen werden seit Ihrem letzten Besuch am ${datumZeit(letzterBesuch)} gezählt.`}
          {gesamtNeu > 0 ? ` Insgesamt ${ganzeZahl(gesamtNeu)} Änderungen.` : ''}
        </div>
        <button type="button" className="knopf knopf--leise" onClick={() => void laden()} disabled={laedt}>
          ↻ Aktualisieren
        </button>
      </header>

      <p className="pol-hinweis">
        Sie sehen alle Projekte Ihres Zuständigkeitsbereichs ohne Einladung. Diese Ansicht ist ausschließlich lesend —
        Anmerkungen erfassen Sie in der 3D-Ansicht des jeweiligen Projekts.
      </p>

      {laedt && <div className="laedt-balken" role="status" aria-label="Projektübersicht wird geladen" />}
      {fehler && (
        <p className="leer" role="alert">
          {fehler}
        </p>
      )}

      {!laedt && !fehler && sortiert.length === 0 && (
        <p className="leer">Für Ihren Zuständigkeitsbereich ist derzeit kein Projekt hinterlegt.</p>
      )}

      {sortiert.length > 0 && (
        <ul className="pol-raster">
          {sortiert.map((p) => (
            <li key={p.projekt.id} className="karte pol-karte">
              <div className="pol-karte-kopf">
                <h2>{text(p.projekt.name)}</h2>
                <span className={freigabeKlasse(p.freigabeStatus)}>{ausTabelle(FREIGABE_LABEL, p.freigabeStatus)}</span>
              </div>

              <div className="pol-karte-meta">
                <span>
                  Veranstalter: <strong>{text(p.veranstalter)}</strong>
                </span>
                <span>
                  Zeitraum: <span className="pol-wert">{datum(p.projekt.zeitraumVon)}</span> bis{' '}
                  <span className="pol-wert">{datum(p.projekt.zeitraumBis)}</span>
                </span>
                <span>
                  max. Besucher: <span className="pol-wert">{ganzeZahl(p.projekt.maxBesucher)}</span>
                </span>
                <span>Gelände: {text(p.gelaende?.name)}</span>
                <span>Ihre Rolle: {ausTabelle(ROLLE_LABEL, p.rolle)}</span>
              </div>

              <div className="pol-zahlen">
                <div className="pol-zahl">
                  <b>{ganzeZahl(p.objekte)}</b>
                  <span>Objekte</span>
                </div>
                <div className="pol-zahl">
                  <b>{ganzeZahl(p.wege)}</b>
                  <span>Wege</span>
                </div>
                <div className="pol-zahl">
                  <b>{ganzeZahl(p.einsatzstationen)}</b>
                  <span>Stationen</span>
                </div>
                <div className="pol-zahl">
                  <b>{ganzeZahl(p.betreiberAnzahl)}</b>
                  <span>Betreiber</span>
                </div>
              </div>

              <p className="pol-karte-meta">
                Letzter Planungsstand: {p.letzterSnapshot ? `${text(p.letzterSnapshot.name)} (${datumZeit(p.letzterSnapshot.zeit)})` : KA}
              </p>

              <Pruefampel pruefung={p.pruefung} />

              {p.aenderungenSeitBesuch > 0 && (
                <p className="pol-neu">
                  <b>{ganzeZahl(p.aenderungenSeitBesuch)}</b>
                  <span>Änderungen seit Ihrem letzten Besuch</span>
                </p>
              )}

              <div className="pol-knoepfe">
                <button type="button" className="knopf knopf--haupt" onClick={() => setLagebildId(p.projekt.id)}>
                  Lagebild öffnen
                </button>
                <a
                  className="knopf"
                  href={api.berichtUrl(p.projekt.id, 'einsatzmappe')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Einsatzmappe (PDF)
                </a>
                <button type="button" className="knopf" onClick={() => oeffneProjekt(p.projekt.id)}>
                  Im 3D-Modell ansehen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2  Lagebild
// ---------------------------------------------------------------------------

function Lagebildansicht({
  projektId,
  zurueck,
  oeffneProjekt,
}: {
  projektId: string;
  zurueck: () => void;
  oeffneProjekt: (id: string) => void;
}) {
  const [lage, setLage] = useState<Lagebild | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [betreiber, setBetreiber] = useState<BetreiberZeile[]>([]);
  const [betreiberLaedt, setBetreiberLaedt] = useState(true);
  const [betreiberFehler, setBetreiberFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);
    setBetreiberLaedt(true);
    setBetreiberFehler(null);
    void (async () => {
      try {
        const d = await api.lagebild(projektId);
        if (!abgebrochen) setLage(d);
      } catch (e) {
        if (!abgebrochen) setFehler((e as Error).message);
      } finally {
        if (!abgebrochen) setLaedt(false);
      }
    })();
    void (async () => {
      try {
        const b = await api.betreiberliste(projektId);
        if (!abgebrochen) setBetreiber(b);
      } catch (e) {
        if (!abgebrochen) setBetreiberFehler((e as Error).message);
      } finally {
        if (!abgebrochen) setBetreiberLaedt(false);
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, [projektId]);

  const beanstandungen = useMemo(() => {
    if (!lage) return [];
    const rang = (s: string) => (typeof SCHWEREGRAD_RANG[s] === 'number' ? SCHWEREGRAD_RANG[s] : 9);
    return [...lage.beanstandungen].sort((a, b) => rang(a.schweregrad) - rang(b.schweregrad));
  }, [lage]);

  const maxKategorie = useMemo(
    () => (lage ? Math.max(1, ...lage.objekteNachKategorie.map((k) => k.anzahl)) : 1),
    [lage],
  );

  return (
    <div className="pol">
      <div className="pol-lage-kopf">
        <button type="button" className="knopf knopf--leise" onClick={zurueck}>
          ← Zurück zur Übersicht
        </button>
        <h1>Lagebild: {text(lage?.projekt.name)}</h1>
        {lage && (
          <>
            <a className="knopf knopf--haupt" href={api.berichtUrl(projektId, 'einsatzmappe')} target="_blank" rel="noopener noreferrer">
              Einsatzmappe erzeugen (PDF)
            </a>
            <button type="button" className="knopf" onClick={() => oeffneProjekt(projektId)}>
              Im 3D-Modell ansehen
            </button>
          </>
        )}
      </div>

      {laedt && <div className="laedt-balken" role="status" aria-label="Lagebild wird geladen" />}
      {fehler && (
        <p className="leer" role="alert">
          {fehler}
        </p>
      )}

      {lage && (
        <div className="pol-lage">
          <p className="pol-hinweis">
            Lesende Einsatzvorbereitung. Alle Koordinaten in ETRS89 / UTM Zone 32N (EPSG:25832), Einheit Meter.
            Anmerkungen zu einzelnen Elementen erfassen Sie in der 3D-Ansicht des Projekts.
          </p>

          {/* -- Veranstalter ------------------------------------------------ */}
          <section className="pol-abschnitt karte" aria-labelledby="pol-h-veranstalter">
            <h2 id="pol-h-veranstalter">Veranstaltung und Veranstalter</h2>
            <dl className="werteliste">
              <dt>Projekt</dt>
              <dd>{text(lage.projekt.name)}</dd>
              <dt>Zeitraum</dt>
              <dd>
                {datum(lage.projekt.zeitraumVon)} – {datum(lage.projekt.zeitraumBis)}
              </dd>
              <dt>max. Besucher</dt>
              <dd>{ganzeZahl(lage.projekt.maxBesucher)}</dd>
              <dt>Veranstalter</dt>
              <dd>{text(lage.veranstalter?.name)}</dd>
              <dt>Organisationstyp</dt>
              <dd>{ausTabelle(ORG_TYP_LABEL, lage.veranstalter?.typ)}</dd>
              <dt>Anschrift</dt>
              <dd>{text(lage.veranstalter?.adresse)}</dd>
            </dl>
            <h3>Kontakt</h3>
            {lage.veranstalterKontakt.length === 0 ? (
              <p className="pol-leise">Kontaktdaten für diese Rolle gesperrt (DSGVO)</p>
            ) : (
              <ul className="pol-kontakte">
                {lage.veranstalterKontakt.map((k) => (
                  <li key={k.email}>
                    {text(k.name)} — <a href={`mailto:${k.email}`}>{text(k.email)}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* -- Einsatzstationen -------------------------------------------- */}
          <section className="pol-abschnitt" aria-labelledby="pol-h-stationen">
            <h2 id="pol-h-stationen">
              Einsatzstationen <span className="pol-anzahl">({ganzeZahl(lage.stationen.length)})</span>
            </h2>
            {lage.stationen.length === 0 ? (
              <p className="leer">Keine Einsatzstationen geplant.</p>
            ) : (
              <div className="pol-tab">
                <table className="tabelle">
                  <caption className="pol-leise">
                    Entfernung zur nächsten Feuerwehrzufahrt; ab {ganzeZahl(DISTANZ_WARNSCHWELLE_M)} m wird gewarnt.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Kategorie</th>
                      <th scope="col">Name</th>
                      <th scope="col">Besetzt von</th>
                      <th scope="col">Position (EPSG:25832)</th>
                      <th scope="col" data-zahl>
                        Distanz zur nächsten Feuerwehrzufahrt
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lage.stationen.map((s) => {
                      const weit = typeof s.distanzZuFeuerwehrzufahrtM === 'number' && s.distanzZuFeuerwehrzufahrtM > DISTANZ_WARNSCHWELLE_M;
                      return (
                        <tr key={s.id}>
                          <td>
                            <span className="pol-stationspunkt" style={{ background: stationsFarbe(s.kategorie) }} aria-hidden="true" />
                            {text(s.kategorieLabel)}
                          </td>
                          <td>{text(s.name)}</td>
                          <td>{text(s.besetztVon)}</td>
                          <td data-zahl>{text(s.position)}</td>
                          <td data-zahl className={weit ? 'pol-warnwert' : undefined}>
                            {text(s.distanzText)}
                            {weit ? ' ⚠' : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* -- Wege --------------------------------------------------------- */}
          <section className="pol-abschnitt" aria-labelledby="pol-h-wege">
            <h2 id="pol-h-wege">
              Wege <span className="pol-anzahl">({ganzeZahl(lage.wege.length)})</span>
            </h2>
            {lage.wege.length === 0 ? (
              <p className="leer">Keine Wege geplant.</p>
            ) : (
              <div className="pol-tab">
                <table className="tabelle">
                  <thead>
                    <tr>
                      <th scope="col">Typ</th>
                      <th scope="col">Name</th>
                      <th scope="col" data-zahl>
                        Breite
                      </th>
                      <th scope="col">Laufrichtung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lage.wege.map((w) => (
                      <tr key={w.id}>
                        <td>{ausTabelle(WEGE_TYP_LABEL, w.typ)}</td>
                        <td>{text(w.name)}</td>
                        <td data-zahl>{meter(w.breite)}</td>
                        <td>{ausTabelle(RICHTUNG_LABEL, w.richtung)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* -- Blockflaechen ------------------------------------------------ */}
          <section className="pol-abschnitt" aria-labelledby="pol-h-block">
            <h2 id="pol-h-block">
              Blockflächen <span className="pol-anzahl">({ganzeZahl(lage.blockflaechen.length)})</span>
            </h2>
            {lage.blockflaechen.length === 0 ? (
              <p className="leer">Keine Blockflächen ausgewiesen.</p>
            ) : (
              <div className="pol-tab">
                <table className="tabelle">
                  <thead>
                    <tr>
                      <th scope="col">Typ</th>
                      <th scope="col">Name</th>
                      <th scope="col">Begründung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lage.blockflaechen.map((b) => (
                      <tr key={b.id}>
                        <td>{ausTabelle(BLOCK_TYP_LABEL, b.typ)}</td>
                        <td>{text(b.name)}</td>
                        <td>{text(b.begruendung)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* -- Objekte nach Kategorie --------------------------------------- */}
          <section className="pol-abschnitt karte" aria-labelledby="pol-h-objekte">
            <h2 id="pol-h-objekte">Objekte nach Kategorie</h2>
            {lage.objekteNachKategorie.length === 0 ? (
              <p className="leer">Keine Objekte platziert.</p>
            ) : (
              <div className="pol-balken">
                {lage.objekteNachKategorie.map((k) => {
                  const anteil = Math.max(2, Math.round((k.anzahl / maxKategorie) * 100));
                  const name = ausTabelle(KATEGORIE_LABEL, k.kategorie);
                  return (
                    <div className="pol-balken-zeile" key={k.kategorie}>
                      <span>{name === KA ? text(k.kategorie) : name}</span>
                      <span className="pol-balken-spur" aria-hidden="true">
                        <span className="pol-balken-fuellung" style={{ width: `${anteil}%` }} />
                      </span>
                      <span className="pol-balken-zahl">{ganzeZahl(k.anzahl)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* -- Regelpruefung ------------------------------------------------ */}
          <section className="pol-abschnitt karte" aria-labelledby="pol-h-pruefung">
            <h2 id="pol-h-pruefung">
              Beanstandungen der Regelprüfung <span className="pol-anzahl">({ganzeZahl(beanstandungen.length)})</span>
            </h2>
            <Pruefampel pruefung={lage.pruefung} />
            {beanstandungen.length === 0 ? (
              <p className="pol-leise">Keine Beanstandungen im letzten Prüflauf.</p>
            ) : (
              <ul className="pol-mangel">
                {beanstandungen.map((b, i) => (
                  <li key={`${b.regelId}-${i}`}>
                    <span className={abzeichenKlasse(b.schweregrad)}>{ausTabelle(SCHWEREGRAD_LABEL, b.schweregrad)}</span>
                    <span className="pol-mangel-text">{text(b.meldung)}</span>
                    <span className="pol-mangel-fund">
                      Fundstelle: {text(b.fundstelle)} · Regel: {text(b.regelId)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* -- Betreiberliste (Abnahmekriterium 7) --------------------------- */}
          <section className="pol-abschnitt" aria-labelledby="pol-h-betreiber">
            <h2 id="pol-h-betreiber">
              Betreiberliste <span className="pol-anzahl">({ganzeZahl(betreiber.length)})</span>
            </h2>
            <div className="pol-knoepfe">
              <a
                className="knopf knopf--haupt"
                href={api.berichtUrl(projektId, 'betreiberliste', { format: 'csv' })}
                download={`betreiberliste-${projektId}.csv`}
              >
                ⭳ Betreiberliste als CSV herunterladen
              </a>
              <a className="knopf" href={api.berichtUrl(projektId, 'betreiberliste')} target="_blank" rel="noopener noreferrer">
                Betreiberliste (PDF)
              </a>
            </div>
            {betreiberLaedt && <div className="laedt-balken" role="status" aria-label="Betreiberliste wird geladen" />}
            {betreiberFehler && (
              <p className="pol-leise" role="alert">
                {betreiberFehler}
              </p>
            )}
            {!betreiberLaedt && !betreiberFehler && betreiber.length === 0 && (
              <p className="leer">Keine zugewiesenen Betreiber.</p>
            )}
            {betreiber.length > 0 && (
              <div className="pol-tab pol-tab--breit">
                <table className="tabelle">
                  <thead>
                    <tr>
                      <th scope="col">Stand-Nr.</th>
                      <th scope="col">Objekt</th>
                      <th scope="col">Kategorie</th>
                      <th scope="col">Maße (L × B × H)</th>
                      <th scope="col">Position (EPSG:25832)</th>
                      <th scope="col">Betreiber</th>
                      <th scope="col">Ansprechpartner</th>
                      <th scope="col">E-Mail</th>
                      <th scope="col">Telefon</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {betreiber.map((z, i) => (
                      <tr key={`${z.standNummer}-${z.objekt}-${i}`}>
                        <td data-zahl>{text(z.standNummer)}</td>
                        <td>{text(z.objekt)}</td>
                        <td>{text(z.kategorie)}</td>
                        <td data-zahl>{text(z.masse)}</td>
                        <td data-zahl>{text(z.position)}</td>
                        <td>{text(z.betreiberFirma)}</td>
                        <td>{text(z.ansprechpartner)}</td>
                        <td>{text(z.email)}</td>
                        <td>{text(z.telefon)}</td>
                        <td>{text(z.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
