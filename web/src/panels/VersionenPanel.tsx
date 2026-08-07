/**
 * Reiter "Planungsstände" (F6): Snapshots, Freigaben, Vergleich, Auflagen
 * und das Änderungsprotokoll.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { AenderungsEvent, Aktion, ElementArt, Freigabe, FreigabeStatus } from '@shared/domain/types';
import { FREIGABE_LABEL } from '@shared/domain/types';

const KEINE_ANGABE = 'k. A.';

type SnapshotZeile = {
  id: string;
  name: string;
  zeit: string;
  eventCursor: number;
  erstelltVon: string;
  bemerkung?: string;
  objekte: number;
  wege: number;
  freigaben: Freigabe[];
};

interface Auflage {
  id: string;
  text: string;
  von: string;
  vonOrg: string;
  am: string;
  erledigt: boolean;
  quelle: string;
}

interface DiffEintrag {
  art: string;
  id: string;
  bezeichnung: string;
}
interface DiffGeaendert extends DiffEintrag {
  felder: { feld: string; vorher: unknown; nachher: unknown }[];
}
interface DiffAntwort {
  von: { name: string };
  nach: { name: string };
  neu: DiffEintrag[];
  geaendert: DiffGeaendert[];
  entfernt: DiffEintrag[];
}

const ART_LABEL: Record<ElementArt, string> = {
  objekt: 'Objekt',
  weg: 'Weg',
  blockflaeche: 'Blockfläche',
  einsatzstation: 'Einsatzstation',
  projekt: 'Projekt',
  kommentar: 'Kommentar',
  objekttyp: 'Objekttyp',
};

const AKTION_LABEL: Record<Aktion, string> = {
  anlegen: 'angelegt',
  aendern: 'geändert',
  loeschen: 'gelöscht',
};

const FREIGABE_SETZBAR: FreigabeStatus[] = ['freigegeben', 'mit_auflagen', 'abgelehnt'];

function abzeichenKlasse(s: FreigabeStatus): string {
  if (s === 'freigegeben') return 'abzeichen abzeichen--ok';
  if (s === 'mit_auflagen') return 'abzeichen abzeichen--warn';
  if (s === 'abgelehnt') return 'abzeichen abzeichen--fehler';
  return 'abzeichen';
}

function wertText(v: unknown): string {
  if (v === null || v === undefined) return KEINE_ANGABE;
  if (typeof v === 'number') return v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'string') return v || KEINE_ANGABE;
  return JSON.stringify(v);
}

export function VersionenPanel() {
  const projektId = nutzeZustand((s) => s.projektId);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  const [snapshots, setSnapshots] = useState<SnapshotZeile[] | null>(null);

  const laden = useCallback(() => {
    if (!projektId) return;
    void api
      .snapshots(projektId)
      .then((l) => setSnapshots(l as SnapshotZeile[]))
      .catch((e: unknown) => {
        setSnapshots([]);
        zeigeFehler((e as Error).message);
      });
  }, [projektId, zeigeFehler]);

  useEffect(laden, [laden]);

  if (!projektId) return null;

  return (
    <>
      <Festhalten neuLaden={laden} />
      <StandListe snapshots={snapshots} neuLaden={laden} />
      <Vergleich snapshots={snapshots ?? []} />
      <Auflagenliste />
      <Protokoll />
    </>
  );
}

// ---------------------------------------------------------------------------

function Festhalten({ neuLaden }: { neuLaden: () => void }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const darf = nutzeZustand((s) => s.darf);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [name, setName] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [einreichen, setEinreichen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  if (darf.snapshotAnlegen !== true) return null;

  async function festhalten() {
    if (!projektId || !name.trim() || laeuft) return;
    setLaeuft(true);
    try {
      await api.snapshotAnlegen(projektId, name.trim(), bemerkung.trim() || undefined, einreichen);
      setName('');
      setBemerkung('');
      setEinreichen(false);
      neuLaden();
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="pnl-abschnitt" aria-labelledby="vs-neu">
      <h2 className="pnl-titel" id="vs-neu">
        Planungsstand festhalten
      </h2>
      <div className="pnl-feldblock">
        <label htmlFor="vs-name">Name (Pflichtangabe)</label>
        <input
          id="vs-name"
          className="feld"
          type="text"
          required
          value={name}
          placeholder="z. B. Stand für Ordnungsamt, 2. Vorlage"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="pnl-feldblock">
        <label htmlFor="vs-bem">Bemerkung</label>
        <textarea id="vs-bem" className="feld" rows={2} value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} />
      </div>
      {darf.einreichen === true && (
        <div className="pnl-schalterzeile">
          <input id="vs-einreichen" type="checkbox" checked={einreichen} onChange={(e) => setEinreichen(e.target.checked)} />
          <label htmlFor="vs-einreichen">zugleich zur Freigabe einreichen</label>
        </div>
      )}
      <button type="button" className="knopf knopf--haupt" disabled={!name.trim() || laeuft} onClick={() => void festhalten()}>
        {laeuft ? 'Wird festgehalten …' : 'Planungsstand festhalten'}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------

function StandListe({ snapshots, neuLaden }: { snapshots: SnapshotZeile[] | null; neuLaden: () => void }) {
  const darf = nutzeZustand((s) => s.darf);

  return (
    <section className="pnl-abschnitt" aria-labelledby="vs-liste">
      <h2 className="pnl-titel" id="vs-liste">
        Planungsstände {snapshots ? `(${snapshots.length.toLocaleString('de-DE')})` : ''}
      </h2>
      {!snapshots && <div className="laedt-balken" />}
      {snapshots && snapshots.length === 0 && <p className="leer">Noch kein Planungsstand festgehalten.</p>}
      {snapshots && snapshots.length > 0 && (
        <ul className="pnl-liste">
          {snapshots.map((s) => (
            <li key={s.id} className="pnl-eintrag">
              <div className="pnl-eintrag__kopf">
                <span className="pnl-eintrag__name">{s.name}</span>
                <span className="pnl-eintrag__zeit">{new Date(s.zeit).toLocaleString('de-DE')}</span>
              </div>
              <span className="pnl-zahl">
                {s.objekte.toLocaleString('de-DE')} Objekte · {s.wege.toLocaleString('de-DE')} Wege
              </span>
              {s.bemerkung && <span className="pnl-hilfe">{s.bemerkung}</span>}

              {s.freigaben.length === 0 ? (
                <span className="abzeichen">Freigabe offen</span>
              ) : (
                <ul className="pnl-liste">
                  {s.freigaben.map((f) => (
                    <li key={f.id}>
                      <div className="pnl-zeile">
                        <span className={abzeichenKlasse(f.status)}>{FREIGABE_LABEL[f.status]}</span>
                        <span className="pnl-fundstelle">
                          {f.behoerdenOrgName || KEINE_ANGABE} · {new Date(f.am).toLocaleDateString('de-DE')}
                        </span>
                      </div>
                      {f.kommentar && <div className="pnl-antwort">{f.kommentar}</div>}
                      {f.auflagen.length > 0 && (
                        <ul className="pnl-diff">
                          {f.auflagen.map((a) => (
                            <li key={a.id}>{a.text}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {darf.freigabeSetzen === true && <FreigabeForm snapshotId={s.id} neuLaden={neuLaden} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function FreigabeForm({ snapshotId, neuLaden }: { snapshotId: string; neuLaden: () => void }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [offen, setOffen] = useState(false);
  const [status, setStatus] = useState<FreigabeStatus>('freigegeben');
  const [kommentar, setKommentar] = useState('');
  const [auflagen, setAuflagen] = useState<string[]>(['']);
  const [laeuft, setLaeuft] = useState(false);

  async function setzen() {
    if (!projektId || laeuft) return;
    setLaeuft(true);
    try {
      await api.freigabeSetzen(projektId, snapshotId, {
        status,
        kommentar: kommentar.trim() || undefined,
        auflagen: auflagen.map((a) => a.trim()).filter(Boolean),
      });
      setOffen(false);
      setKommentar('');
      setAuflagen(['']);
      neuLaden();
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  if (!offen) {
    return (
      <button type="button" className="knopf" onClick={() => setOffen(true)}>
        Freigabe setzen
      </button>
    );
  }

  return (
    <div className="pnl-abschnitt">
      <div className="pnl-feldblock">
        <label htmlFor={`fg-status-${snapshotId}`}>Status</label>
        <select
          id={`fg-status-${snapshotId}`}
          className="feld"
          value={status}
          onChange={(e) => setStatus(e.target.value as FreigabeStatus)}
        >
          {FREIGABE_SETZBAR.map((s) => (
            <option key={s} value={s}>
              {FREIGABE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="pnl-feldblock">
        <label htmlFor={`fg-kom-${snapshotId}`}>Kommentar</label>
        <textarea
          id={`fg-kom-${snapshotId}`}
          className="feld"
          rows={2}
          value={kommentar}
          onChange={(e) => setKommentar(e.target.value)}
        />
      </div>

      <fieldset className="pnl-abschnitt">
        <legend className="pnl-titel">Auflagen</legend>
        {auflagen.map((a, i) => (
          <div className="pnl-zeile" key={i}>
            <input
              className="feld"
              type="text"
              value={a}
              aria-label={`Auflage ${i + 1}`}
              onChange={(e) => setAuflagen(auflagen.map((x, k) => (k === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="knopf knopf--leise"
              aria-label={`Auflage ${i + 1} entfernen`}
              onClick={() => setAuflagen(auflagen.length > 1 ? auflagen.filter((_, k) => k !== i) : [''])}
            >
              −
            </button>
          </div>
        ))}
        <button type="button" className="knopf knopf--leise" onClick={() => setAuflagen([...auflagen, ''])}>
          + Auflage
        </button>
      </fieldset>

      <div className="pnl-knopfreihe">
        <button type="button" className="knopf knopf--haupt" disabled={laeuft} onClick={() => void setzen()}>
          {laeuft ? 'Wird gespeichert …' : 'Freigabe speichern'}
        </button>
        <button type="button" className="knopf knopf--leise" onClick={() => setOffen(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Vergleich({ snapshots }: { snapshots: SnapshotZeile[] }) {
  const projektId = nutzeZustand((s) => s.projektId);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [a, setA] = useState('');
  const [b, setB] = useState('aktuell');
  const [diff, setDiff] = useState<DiffAntwort | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function vergleichen() {
    if (!projektId || !a || !b || laeuft) return;
    setLaeuft(true);
    try {
      const roh = await api.snapshotDiff(projektId, a, b);
      setDiff(roh as unknown as DiffAntwort);
    } catch (e) {
      setDiff(null);
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="pnl-abschnitt" aria-labelledby="vs-diff">
      <h2 className="pnl-titel" id="vs-diff">
        Stände vergleichen
      </h2>
      {snapshots.length === 0 ? (
        <p className="leer">Für einen Vergleich wird mindestens ein Planungsstand gebraucht.</p>
      ) : (
        <>
          <div className="pnl-gitter2">
            <div className="pnl-feldblock">
              <label htmlFor="vg-a">Von</label>
              <select id="vg-a" className="feld" value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">— bitte wählen —</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pnl-feldblock">
              <label htmlFor="vg-b">Nach</label>
              <select id="vg-b" className="feld" value={b} onChange={(e) => setB(e.target.value)}>
                <option value="aktuell">Aktueller Stand</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className="knopf" disabled={!a || laeuft} onClick={() => void vergleichen()}>
            {laeuft ? 'Wird verglichen …' : 'Vergleichen'}
          </button>
        </>
      )}

      {diff && (
        <>
          <p className="pnl-hilfe">
            {diff.von.name} → {diff.nach.name}
          </p>
          <h3 className="pnl-titel">Neu ({diff.neu.length.toLocaleString('de-DE')})</h3>
          {diff.neu.length === 0 ? (
            <p className="leer">nichts</p>
          ) : (
            <ul className="pnl-liste">
              {diff.neu.map((d) => (
                <li key={`n-${d.id}`} className="pnl-eintrag">
                  <span>
                    {ART_LABEL[d.art as ElementArt] ?? d.art}: {d.bezeichnung}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="pnl-titel">Geändert ({diff.geaendert.length.toLocaleString('de-DE')})</h3>
          {diff.geaendert.length === 0 ? (
            <p className="leer">nichts</p>
          ) : (
            <ul className="pnl-liste">
              {diff.geaendert.map((d) => (
                <li key={`g-${d.id}`} className="pnl-eintrag">
                  <span>
                    {ART_LABEL[d.art as ElementArt] ?? d.art}: {d.bezeichnung}
                  </span>
                  <ul className="pnl-diff">
                    {d.felder.map((f, i) => (
                      <li key={`${f.feld}-${i}`}>
                        {f.feld}: {wertText(f.vorher)} → {wertText(f.nachher)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <h3 className="pnl-titel">Entfernt ({diff.entfernt.length.toLocaleString('de-DE')})</h3>
          {diff.entfernt.length === 0 ? (
            <p className="leer">nichts</p>
          ) : (
            <ul className="pnl-liste">
              {diff.entfernt.map((d) => (
                <li key={`e-${d.id}`} className="pnl-eintrag">
                  <span>
                    {ART_LABEL[d.art as ElementArt] ?? d.art}: {d.bezeichnung}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Auflagenliste() {
  const projektId = nutzeZustand((s) => s.projektId);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  const [auflagen, setAuflagen] = useState<Auflage[] | null>(null);

  const laden = useCallback(() => {
    if (!projektId) return;
    void api
      .auflagen(projektId)
      .then(setAuflagen)
      .catch(() => setAuflagen([]));
  }, [projektId]);

  useEffect(laden, [laden]);

  async function umschalten(aid: string, erledigt: boolean) {
    if (!projektId) return;
    try {
      await api.auflageErledigt(projektId, aid, erledigt);
      setAuflagen((l) => (l ? l.map((a) => (a.id === aid ? { ...a, erledigt } : a)) : l));
    } catch (e) {
      zeigeFehler((e as Error).message);
    }
  }

  const offen = auflagen?.filter((a) => !a.erledigt).length ?? 0;

  return (
    <section className="pnl-abschnitt" aria-labelledby="vs-auflagen">
      <h2 className="pnl-titel" id="vs-auflagen">
        Auflagen {auflagen ? `(${offen.toLocaleString('de-DE')} offen von ${auflagen.length.toLocaleString('de-DE')})` : ''}
      </h2>
      {!auflagen && <div className="laedt-balken" />}
      {auflagen && auflagen.length === 0 && <p className="leer">Keine Auflagen erteilt.</p>}
      {auflagen && auflagen.length > 0 && (
        <ul className="pnl-liste">
          {auflagen.map((a) => (
            <li key={a.id} className="pnl-eintrag">
              <div className="pnl-schalterzeile">
                <input
                  id={`auf-${a.id}`}
                  type="checkbox"
                  checked={a.erledigt}
                  onChange={(e) => void umschalten(a.id, e.target.checked)}
                />
                <label htmlFor={`auf-${a.id}`}>{a.text}</label>
              </div>
              <span className="pnl-fundstelle">
                {a.vonOrg || KEINE_ANGABE} · {a.von || KEINE_ANGABE} · {new Date(a.am).toLocaleDateString('de-DE')} ·{' '}
                {a.quelle || KEINE_ANGABE}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Protokoll() {
  const ereignisse = nutzeZustand((s) => s.ereignisse);
  const ereignisseLaden = nutzeZustand((s) => s.ereignisseLaden);

  const [nutzerFilter, setNutzerFilter] = useState('');
  const [artFilter, setArtFilter] = useState('');
  const [offen, setOffen] = useState<string | null>(null);

  const nutzerListe = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of ereignisse) m.set(e.nutzerId, e.nutzerName);
    return [...m.entries()];
  }, [ereignisse]);

  const gefiltert = ereignisse.filter(
    (e: AenderungsEvent) =>
      (nutzerFilter ? e.nutzerId === nutzerFilter : true) && (artFilter ? e.elementRef.art === artFilter : true),
  );

  return (
    <section className="pnl-abschnitt" aria-labelledby="vs-prot">
      <div className="pnl-zeile pnl-zeile--verteilt">
        <h2 className="pnl-titel" id="vs-prot">
          Änderungsprotokoll
        </h2>
        <button type="button" className="knopf knopf--leise" onClick={() => void ereignisseLaden()}>
          Aktualisieren
        </button>
      </div>

      <div className="pnl-filter">
        <div className="pnl-feldblock">
          <label htmlFor="pr-nutzer">Nutzer</label>
          <select id="pr-nutzer" className="feld" value={nutzerFilter} onChange={(e) => setNutzerFilter(e.target.value)}>
            <option value="">alle</option>
            {nutzerListe.map(([nid, name]) => (
              <option key={nid} value={nid}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="pnl-feldblock">
          <label htmlFor="pr-art">Elementart</label>
          <select id="pr-art" className="feld" value={artFilter} onChange={(e) => setArtFilter(e.target.value)}>
            <option value="">alle</option>
            {(Object.keys(ART_LABEL) as ElementArt[]).map((a) => (
              <option key={a} value={a}>
                {ART_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {gefiltert.length === 0 ? (
        <p className="leer">Keine Einträge.</p>
      ) : (
        <ul className="pnl-liste">
          {gefiltert.slice(0, 200).map((e) => (
            <li key={e.id} className="pnl-eintrag">
              <div className="pnl-eintrag__kopf">
                <span className="pnl-eintrag__name">
                  {ART_LABEL[e.elementRef.art] ?? e.elementRef.art} {AKTION_LABEL[e.aktion]}
                </span>
                <span className="pnl-eintrag__zeit">{new Date(e.zeit).toLocaleString('de-DE')}</span>
              </div>
              <span>{e.bezeichnung || KEINE_ANGABE}</span>
              <span className="pnl-fundstelle">
                {e.nutzerName || KEINE_ANGABE}
                {e.kiVorschlag ? ' · nach KI-Vorschlag, vom Menschen bestätigt' : ''}
              </span>
              {e.diff.length > 0 && (
                <>
                  <button
                    type="button"
                    className="knopf knopf--leise"
                    aria-expanded={offen === e.id}
                    onClick={() => setOffen(offen === e.id ? null : e.id)}
                  >
                    {offen === e.id ? '▴ Felder' : `▾ ${e.diff.length.toLocaleString('de-DE')} Feld-Änderungen`}
                  </button>
                  {offen === e.id && (
                    <ul className="pnl-diff">
                      {e.diff.map((d, i) => (
                        <li key={`${d.feld}-${i}`}>
                          {d.feld}: {wertText(d.vorher)} → {wertText(d.nachher)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
