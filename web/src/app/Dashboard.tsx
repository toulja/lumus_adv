/**
 * Dashboard — Startseite fuer Veranstalter und Standbetreiber.
 *
 * Projektliste, Gelaendeliste und die beiden Dialoge "Neues Projekt" und
 * "Gelaende importieren" (F1 des Lastenhefts). Alle Geometrien in EPSG:25832,
 * Einheit Meter — die Bbox wird ausschliesslich aus den amtlichen Koordinaten
 * des Suchtreffers gerechnet, nie aus Bildschirmkoordinaten.
 *
 * Erwartete CSS-Klassen aus styles.css: .dashboard, .dashboard-kopf,
 * .projekt-liste, .projekt-karte, .projekt-kopf, .gelaende-liste,
 * .treffer-liste, .treffer, .treffer--aktiv, .fortschritt, .fortschritt-balken,
 * .protokoll, .hinweis, .modal, .modal-karte, .modal-kopf, .modal-koerper,
 * .modal-fuss (dazu die gemeinsamen: .knopf, .knopf--haupt, .knopf--leise,
 * .feld, .feld-zeile, .karte, .abzeichen, .abzeichen--ok/--warn/--fehler,
 * .tabelle, .leer, .laedt-balken, .trenner, .werteliste).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { BBox, ProjektUebersicht } from '@shared/domain/types';
import { FREIGABE_LABEL, ROLLE_LABEL } from '@shared/domain/types';
import type { Fundstelle, ImportAuftrag } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { nutzeZustand } from '../lib/zustand.ts';

interface GelaendeKopf {
  id: string;
  name: string;
  erstelltAm: string;
}

interface RegelwerkKopf {
  id: string;
  version: string;
  bezeichnung: string;
  bundesland: string;
  stand: string;
  haftungshinweis: string;
  regeln: number;
  zuPruefen: number;
}

interface GebietPruefung {
  flaecheKm2: number;
  zulaessig: boolean;
  grenzeKm2: number;
}

/** Mittelpunkt des Importgebiets (EPSG:25832). */
interface Mitte {
  label: string;
  e: number;
  n: number;
}

/** Fester Ausschnitt der Darmstaedter Innenstadt (Pilotgelaende). */
const HEINERFEST_BBOX: BBox = { minE: 474700, minN: 5524150, maxE: 475900, maxN: 5525150 };
const HEINERFEST_NAME = 'Heinerfest Darmstadt (Innenstadt)';

const BREITE_STANDARD = 1200;
const HOEHE_STANDARD = 1000;

// ---------------------------------------------------------------------------

function datum(iso?: string): string {
  if (!iso) return 'k. A.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'k. A.';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function meter(m: number): string {
  return `${m.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

export function Dashboard({ oeffneProjekt }: { oeffneProjekt: (id: string) => void }) {
  const nutzer = nutzeZustand((s) => s.nutzer);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [projekte, setProjekte] = useState<ProjektUebersicht[] | null>(null);
  const [gelaende, setGelaende] = useState<GelaendeKopf[] | null>(null);
  const [dialog, setDialog] = useState<'projekt' | 'import' | null>(null);

  const darfAnlegen = nutzer ? nutzer.orgTyp === 'veranstalter' || nutzer.orgTyp === 'plattform' : false;

  const laden = useCallback(() => {
    api
      .projekte()
      .then(setProjekte)
      .catch((e: unknown) => {
        setProjekte([]);
        zeigeFehler((e as Error).message);
      });
    api
      .gelaendeListe()
      .then(setGelaende)
      .catch((e: unknown) => {
        setGelaende([]);
        zeigeFehler((e as Error).message);
      });
  }, [zeigeFehler]);

  useEffect(() => {
    laden();
  }, [laden]);

  const gelaendeNeuLaden = useCallback(() => {
    api
      .gelaendeListe()
      .then(setGelaende)
      .catch(() => undefined);
  }, []);

  return (
    <div className="dashboard">
      <div className="dashboard-kopf">
        <h1>Projekte</h1>
        {darfAnlegen && (
          <button type="button" className="knopf knopf--haupt" onClick={() => setDialog('projekt')}>
            Neues Projekt
          </button>
        )}
      </div>

      {projekte === null && <div className="laedt-balken" />}
      {projekte !== null && projekte.length === 0 && (
        <p className="leer">
          Noch keine Projekte. {darfAnlegen ? 'Legen Sie ein Projekt an — dafür wird ein importiertes Gelände benötigt.' : 'Sobald Sie eingeladen werden, erscheinen Projekte hier.'}
        </p>
      )}

      <div className="projekt-liste">
        {(projekte ?? []).map((p) => (
          <ProjektKarte key={p.projekt.id} u={p} oeffnen={() => oeffneProjekt(p.projekt.id)} />
        ))}
      </div>

      <div className="trenner" />

      <div className="dashboard-kopf">
        <h2>Gelände</h2>
        {darfAnlegen && (
          <button type="button" className="knopf" onClick={() => setDialog('import')}>
            Gelände importieren
          </button>
        )}
      </div>

      {gelaende === null && <div className="laedt-balken" />}
      {gelaende !== null && gelaende.length === 0 && <p className="leer">Noch kein Gelände importiert.</p>}
      {gelaende !== null && gelaende.length > 0 && (
        <table className="tabelle gelaende-liste">
          <thead>
            <tr>
              <th scope="col">Gelände</th>
              <th scope="col">Importiert am</th>
              <th scope="col">Kennung</th>
            </tr>
          </thead>
          <tbody>
            {gelaende.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="zahl">{datum(g.erstelltAm)}</td>
                <td className="zahl text-leise">{g.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog === 'projekt' && (
        <NeuesProjektDialog
          gelaende={gelaende ?? []}
          onSchliessen={() => setDialog(null)}
          onAngelegt={(id) => {
            setDialog(null);
            oeffneProjekt(id);
          }}
        />
      )}
      {dialog === 'import' && (
        <GelaendeImportDialog onSchliessen={() => setDialog(null)} onFertig={gelaendeNeuLaden} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProjektKarte({ u, oeffnen }: { u: ProjektUebersicht; oeffnen: () => void }) {
  const fehler = u.offeneFehler;
  return (
    <article className="karte projekt-karte" onClick={oeffnen}>
      <div className="projekt-kopf">
        <h3>{u.projekt.name}</h3>
        <span className={`abzeichen ${fehler === 0 ? 'abzeichen--ok' : 'abzeichen--fehler'}`}>
          {fehler === 0 ? 'keine Fehler' : `${fehler.toLocaleString('de-DE')} Fehler`}
        </span>
      </div>
      <dl className="werteliste">
        <dt>Gelände</dt>
        <dd>{u.gelaendeName || 'k. A.'}</dd>
        <dt>Veranstalter</dt>
        <dd>{u.veranstalterName || 'k. A.'}</dd>
        <dt>Zeitraum</dt>
        <dd className="zahl">
          {datum(u.projekt.zeitraumVon)} – {datum(u.projekt.zeitraumBis)}
        </dd>
        <dt>max. Besucher</dt>
        <dd className="zahl">{u.projekt.maxBesucher.toLocaleString('de-DE')}</dd>
        <dt>Ihre Rolle</dt>
        <dd>{ROLLE_LABEL[u.rolle]}</dd>
        <dt>Objekte</dt>
        <dd className="zahl">{u.objekteAnzahl.toLocaleString('de-DE')}</dd>
        <dt>Planungsstand</dt>
        <dd>
          {u.letzterSnapshot
            ? `${u.letzterSnapshot.name} (${datum(u.letzterSnapshot.zeit)}) — ${FREIGABE_LABEL[u.letzterSnapshot.status]}`
            : 'k. A.'}
        </dd>
      </dl>
      <button
        type="button"
        className="knopf"
        onClick={(ev) => {
          ev.stopPropagation();
          oeffnen();
        }}
      >
        Projekt öffnen
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------

function Modal({ titel, weit, onSchliessen, children }: { titel: string; weit?: boolean; onSchliessen: () => void; children: ReactNode }) {
  useEffect(() => {
    const taste = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onSchliessen();
    };
    document.addEventListener('keydown', taste);
    return () => document.removeEventListener('keydown', taste);
  }, [onSchliessen]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={titel}>
      <div className={`modal-karte${weit ? ' modal-karte--weit' : ''}`}>
        <div className="modal-kopf">
          <h2>{titel}</h2>
          <button type="button" className="knopf knopf--leise" onClick={onSchliessen} aria-label="Dialog schließen">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NeuesProjektDialog({
  gelaende,
  onSchliessen,
  onAngelegt,
}: {
  gelaende: GelaendeKopf[];
  onSchliessen: () => void;
  onAngelegt: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [gelaendeId, setGelaendeId] = useState(gelaende.length === 1 ? gelaende[0].id : '');
  const [von, setVon] = useState(heute());
  const [bis, setBis] = useState(heute());
  const [maxBesucher, setMaxBesucher] = useState('');
  const [regelwerke, setRegelwerke] = useState<RegelwerkKopf[] | null>(null);
  const [regelwerkId, setRegelwerkId] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    let aktiv = true;
    api
      .regelwerke()
      .then((r) => {
        if (!aktiv) return;
        setRegelwerke(r);
        if (r.length) setRegelwerkId((alt) => alt || r[0].id);
      })
      .catch((e: unknown) => {
        if (aktiv) {
          setRegelwerke([]);
          setFehler((e as Error).message);
        }
      });
    return () => {
      aktiv = false;
    };
  }, []);

  const gewaehltesRegelwerk = (regelwerke ?? []).find((r) => r.id === regelwerkId) ?? null;
  const besucher = Number(maxBesucher);
  const besucherOk = Number.isFinite(besucher) && besucher > 0;

  async function absenden(ev: FormEvent) {
    ev.preventDefault();
    setFehler(null);
    if (!besucherOk) {
      setFehler('Bitte die erwartete maximale Besucherzahl angeben — sie ist Grundlage der Rettungswegbemessung.');
      return;
    }
    if (bis < von) {
      setFehler('Das Ende des Zeitraums liegt vor dem Beginn.');
      return;
    }
    setLaeuft(true);
    try {
      const p = await api.projektAnlegen({
        name: name.trim(),
        gelaendeId,
        zeitraumVon: von,
        zeitraumBis: bis,
        maxBesucher: besucher,
        regelwerkId,
        beschreibung: beschreibung.trim() || undefined,
      });
      onAngelegt(p.id);
    } catch (e) {
      setFehler((e as Error).message);
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Neues Projekt" onSchliessen={onSchliessen}>
      <form onSubmit={absenden}>
        <div className="modal-koerper">
          <div className="feld-zeile">
            <label htmlFor="np-name">Name des Projekts</label>
            <input id="np-name" className="feld" required value={name} onChange={(ev) => setName(ev.target.value)} />
          </div>

          <div className="feld-zeile">
            <label htmlFor="np-gelaende">Gelände</label>
            <select id="np-gelaende" className="feld" required value={gelaendeId} onChange={(ev) => setGelaendeId(ev.target.value)}>
              <option value="">Bitte wählen …</option>
              {gelaende.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {gelaende.length === 0 && (
              <p className="hinweis">Es ist noch kein Gelände importiert. Bitte zuerst ein Gelände importieren.</p>
            )}
          </div>

          <div className="feld-zeile">
            <label htmlFor="np-von">Zeitraum von</label>
            <input id="np-von" className="feld" type="date" required value={von} onChange={(ev) => setVon(ev.target.value)} />
          </div>
          <div className="feld-zeile">
            <label htmlFor="np-bis">Zeitraum bis</label>
            <input id="np-bis" className="feld" type="date" required value={bis} onChange={(ev) => setBis(ev.target.value)} />
          </div>

          <div className="feld-zeile">
            <label htmlFor="np-besucher">Maximale Besucherzahl</label>
            <input
              id="np-besucher"
              className="feld zahl"
              type="number"
              min={1}
              step={1}
              required
              aria-describedby="np-besucher-hinweis"
              value={maxBesucher}
              onChange={(ev) => setMaxBesucher(ev.target.value)}
            />
            <p className="hinweis" id="np-besucher-hinweis">
              Pflichtangabe: Grundlage der Rettungswegbemessung.
            </p>
          </div>

          <div className="feld-zeile">
            <label htmlFor="np-regelwerk">Regelwerk</label>
            <select id="np-regelwerk" className="feld" required value={regelwerkId} onChange={(ev) => setRegelwerkId(ev.target.value)}>
              <option value="">Bitte wählen …</option>
              {(regelwerke ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.bezeichnung} · Version {r.version} · Stand {r.stand}
                </option>
              ))}
            </select>
            {gewaehltesRegelwerk && (
              <p className="hinweis">
                {gewaehltesRegelwerk.regeln.toLocaleString('de-DE')} Regeln,{' '}
                {gewaehltesRegelwerk.zuPruefen > 0
                  ? `${gewaehltesRegelwerk.zuPruefen.toLocaleString('de-DE')} davon noch zu prüfen`
                  : 'alle verifiziert'}
                . {gewaehltesRegelwerk.haftungshinweis}
              </p>
            )}
            {regelwerke === null && <div className="laedt-balken" />}
          </div>

          <div className="feld-zeile">
            <label htmlFor="np-beschreibung">Beschreibung</label>
            <textarea
              id="np-beschreibung"
              className="feld"
              rows={3}
              value={beschreibung}
              onChange={(ev) => setBeschreibung(ev.target.value)}
            />
          </div>

          {fehler && (
            <p className="abzeichen abzeichen--fehler" role="alert">
              {fehler}
            </p>
          )}
        </div>

        <div className="modal-fuss">
          <button type="button" className="knopf knopf--leise" onClick={onSchliessen}>
            Abbrechen
          </button>
          <button type="submit" className="knopf knopf--haupt" disabled={laeuft || !gelaendeId || !name.trim() || !besucherOk}>
            {laeuft ? 'Wird angelegt …' : 'Projekt anlegen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function GelaendeImportDialog({ onSchliessen, onFertig }: { onSchliessen: () => void; onFertig: () => void }) {
  const [suche, setSuche] = useState('');
  const [treffer, setTreffer] = useState<Fundstelle[]>([]);
  const [suchtLaeuft, setSuchtLaeuft] = useState(false);
  const [suchFehler, setSuchFehler] = useState<string | null>(null);

  const [mitte, setMitte] = useState<Mitte | null>(null);
  const [breite, setBreite] = useState(String(BREITE_STANDARD));
  const [hoehe, setHoehe] = useState(String(HOEHE_STANDARD));
  const [name, setName] = useState('');
  const [ohneLuftbild, setOhneLuftbild] = useState(false);

  const [pruefung, setPruefung] = useState<GebietPruefung | null>(null);
  const [pruefFehler, setPruefFehler] = useState<string | null>(null);

  const [auftrag, setAuftrag] = useState<ImportAuftrag | null>(null);
  const [startFehler, setStartFehler] = useState<string | null>(null);
  const [startLaeuft, setStartLaeuft] = useState(false);
  const fertigGemeldet = useRef(false);

  // -- Adresssuche, entprellt (400 ms) --------------------------------------
  useEffect(() => {
    const q = suche.trim();
    if (q.length < 3) {
      setTreffer([]);
      setSuchFehler(null);
      setSuchtLaeuft(false);
      return;
    }
    let aktiv = true;
    setSuchtLaeuft(true);
    const t = setTimeout(() => {
      api
        .adressSuche(q)
        .then((f) => {
          if (!aktiv) return;
          setTreffer(f);
          setSuchFehler(f.length ? null : 'Keine Treffer.');
          setSuchtLaeuft(false);
        })
        .catch((e: unknown) => {
          if (!aktiv) return;
          setTreffer([]);
          setSuchFehler((e as Error).message);
          setSuchtLaeuft(false);
        });
    }, 400);
    return () => {
      aktiv = false;
      clearTimeout(t);
    };
  }, [suche]);

  // -- Bbox aus Mittelpunkt + Gebietsgroesse (EPSG:25832, Meter) ------------
  const breiteZahl = Number(breite.replace(',', '.'));
  const hoeheZahl = Number(hoehe.replace(',', '.'));
  const masseOk = Number.isFinite(breiteZahl) && breiteZahl > 0 && Number.isFinite(hoeheZahl) && hoeheZahl > 0;

  const bbox = useMemo<BBox | null>(() => {
    if (!mitte || !masseOk) return null;
    return {
      minE: mitte.e - breiteZahl / 2,
      minN: mitte.n - hoeheZahl / 2,
      maxE: mitte.e + breiteZahl / 2,
      maxN: mitte.n + hoeheZahl / 2,
    };
  }, [mitte, breiteZahl, hoeheZahl, masseOk]);

  // -- Gebiet laufend pruefen ----------------------------------------------
  useEffect(() => {
    if (!bbox) {
      setPruefung(null);
      setPruefFehler(null);
      return;
    }
    let aktiv = true;
    const t = setTimeout(() => {
      api
        .gebietPruefen(bbox)
        .then((p) => {
          if (!aktiv) return;
          setPruefung({ flaecheKm2: p.flaecheKm2, zulaessig: p.zulaessig, grenzeKm2: p.grenzeKm2 });
          setPruefFehler(null);
        })
        .catch((e: unknown) => {
          if (!aktiv) return;
          setPruefung(null);
          setPruefFehler((e as Error).message);
        });
    }, 250);
    return () => {
      aktiv = false;
      clearTimeout(t);
    };
  }, [bbox]);

  // -- Auftrag pollen (1500 ms) ---------------------------------------------
  const auftragId = auftrag ? auftrag.id : null;
  const auftragStatus = auftrag ? auftrag.status : null;
  useEffect(() => {
    if (!auftragId || auftragStatus === 'fertig' || auftragStatus === 'fehler') return;
    let aktiv = true;
    const t = setInterval(() => {
      api
        .importAuftrag(auftragId)
        .then((a) => {
          if (!aktiv) return;
          setAuftrag(a);
          if (a.status === 'fertig' && !fertigGemeldet.current) {
            fertigGemeldet.current = true;
            onFertig();
          }
        })
        .catch((e: unknown) => {
          if (aktiv) setStartFehler((e as Error).message);
        });
    }, 1500);
    return () => {
      aktiv = false;
      clearInterval(t);
    };
  }, [auftragId, auftragStatus, onFertig]);

  function trefferWaehlen(f: Fundstelle) {
    setMitte({ label: f.label, e: f.e, n: f.n });
    setTreffer([]);
    setSuche(f.label);
    if (!name.trim()) setName(f.label);
  }

  function heinerfest() {
    setMitte({
      label: HEINERFEST_NAME,
      e: (HEINERFEST_BBOX.minE + HEINERFEST_BBOX.maxE) / 2,
      n: (HEINERFEST_BBOX.minN + HEINERFEST_BBOX.maxN) / 2,
    });
    setBreite(String(HEINERFEST_BBOX.maxE - HEINERFEST_BBOX.minE));
    setHoehe(String(HEINERFEST_BBOX.maxN - HEINERFEST_BBOX.minN));
    setName(HEINERFEST_NAME);
    setSuche(HEINERFEST_NAME);
    setTreffer([]);
  }

  async function starten() {
    if (!bbox) return;
    setStartFehler(null);
    setStartLaeuft(true);
    fertigGemeldet.current = false;
    try {
      const a = await api.gelaendeImport({ name: name.trim(), bbox25832: bbox, ohneLuftbild });
      setAuftrag(a);
    } catch (e) {
      setStartFehler((e as Error).message);
    } finally {
      setStartLaeuft(false);
    }
  }

  const laeuftGerade = auftrag !== null && (auftrag.status === 'wartet' || auftrag.status === 'laeuft');
  const startBereit = Boolean(bbox) && Boolean(name.trim()) && pruefung !== null && pruefung.zulaessig && !laeuftGerade && !startLaeuft;

  let startGrund = '';
  if (!mitte) startGrund = 'Bitte zuerst eine Adresse suchen und einen Treffer wählen.';
  else if (!masseOk) startGrund = 'Breite und Höhe müssen positive Zahlen in Metern sein.';
  else if (!name.trim()) startGrund = 'Bitte einen Namen für das Gelände angeben.';
  else if (pruefung && !pruefung.zulaessig)
    startGrund = `Das Gebiet ist mit ${pruefung.flaecheKm2.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km² größer als die Grenze von ${pruefung.grenzeKm2.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km². Bitte Breite und Höhe verkleinern.`;

  return (
    <Modal titel="Gelände importieren" weit onSchliessen={onSchliessen}>
      <div className="modal-koerper">
        <div className="feld-zeile">
          <label htmlFor="gi-suche">Adresse oder Ort suchen</label>
          <input
            id="gi-suche"
            className="feld"
            type="search"
            autoComplete="off"
            placeholder="z. B. Luisenplatz, Darmstadt"
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
          />
          {suchtLaeuft && <div className="laedt-balken" />}
          {suchFehler && <p className="hinweis">{suchFehler}</p>}
          {treffer.length > 0 && (
            <ul className="treffer-liste">
              {treffer.map((f) => (
                <li key={`${f.label}_${f.e}_${f.n}`}>
                  <button type="button" className="knopf knopf--leise treffer" onClick={() => trefferWaehlen(f)}>
                    <span>{f.label}</span>
                    <span className="text-leise zahl">
                      {f.typ} · E {f.e.toLocaleString('de-DE', { maximumFractionDigits: 2 })} / N{' '}
                      {f.n.toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" className="knopf" onClick={heinerfest}>
          Heinerfest Darmstadt (Innenstadt)
        </button>

        <div className="trenner" />

        <dl className="werteliste">
          <dt>Mittelpunkt</dt>
          <dd className="zahl">
            {mitte
              ? `${mitte.label} — E ${mitte.e.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / N ${mitte.n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (EPSG:25832)`
              : 'k. A.'}
          </dd>
          <dt>Gebiet</dt>
          <dd className="zahl">
            {bbox
              ? `${meter(bbox.minE)} … ${meter(bbox.maxE)} Ost · ${meter(bbox.minN)} … ${meter(bbox.maxN)} Nord`
              : 'k. A.'}
          </dd>
          <dt>Fläche</dt>
          <dd className="zahl">
            {pruefung
              ? `${pruefung.flaecheKm2.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km² von höchstens ${pruefung.grenzeKm2.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`
              : 'k. A.'}
          </dd>
        </dl>

        {pruefung && (
          <p className={`abzeichen ${pruefung.zulaessig ? 'abzeichen--ok' : 'abzeichen--fehler'}`}>
            {pruefung.zulaessig ? 'Gebietsgröße zulässig' : 'Gebiet zu groß'}
          </p>
        )}
        {pruefFehler && (
          <p className="abzeichen abzeichen--warn" role="alert">
            Gebietsprüfung fehlgeschlagen: {pruefFehler}
          </p>
        )}

        <div className="feld-zeile">
          <label htmlFor="gi-breite">Breite (m)</label>
          <input
            id="gi-breite"
            className="feld zahl"
            type="number"
            min={50}
            step={10}
            value={breite}
            onChange={(ev) => setBreite(ev.target.value)}
          />
        </div>
        <div className="feld-zeile">
          <label htmlFor="gi-hoehe">Höhe (m)</label>
          <input
            id="gi-hoehe"
            className="feld zahl"
            type="number"
            min={50}
            step={10}
            value={hoehe}
            onChange={(ev) => setHoehe(ev.target.value)}
          />
        </div>

        <div className="feld-zeile">
          <label htmlFor="gi-name">Name des Geländes</label>
          <input id="gi-name" className="feld" required value={name} onChange={(ev) => setName(ev.target.value)} />
        </div>

        <div className="feld-zeile">
          <label htmlFor="gi-ohne">
            <input
              id="gi-ohne"
              type="checkbox"
              checked={ohneLuftbild}
              onChange={(ev) => setOhneLuftbild(ev.target.checked)}
            />{' '}
            ohne Luftbild (schneller)
          </label>
        </div>

        {startGrund && !auftrag && <p className="hinweis">{startGrund}</p>}
        {startFehler && (
          <p className="abzeichen abzeichen--fehler" role="alert">
            {startFehler}
          </p>
        )}

        {auftrag && (
          <section className="karte" aria-live="polite">
            <h3>Import „{auftrag.name}“</h3>
            <div className="fortschritt">
              <div
                className="fortschritt-balken"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, auftrag.fortschritt)) * 100)}%` }}
              />
            </div>
            <p className="zahl">
              {Math.round(Math.min(1, Math.max(0, auftrag.fortschritt)) * 100).toLocaleString('de-DE')} % ·{' '}
              {auftrag.schritt || 'k. A.'}
            </p>
            {auftrag.status === 'fertig' && (
              <p className="abzeichen abzeichen--ok">Gelände fertig importiert. Es steht jetzt für neue Projekte bereit.</p>
            )}
            {auftrag.status === 'fehler' && (
              <p className="abzeichen abzeichen--fehler" role="alert">
                {auftrag.fehler ?? 'Der Import ist fehlgeschlagen.'}
              </p>
            )}
            <ul className="protokoll">
              {auftrag.meldungen.slice(-8).map((m, i) => (
                <li key={`${i}_${m}`}>{m}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="hinweis">
          Geländehöhen werden aus den amtlichen LoD2-Bodenhöhen abgeleitet, weil Hessen für das DGM1 keine
          automatisierbaren Direktlinks anbietet. Ein DGM1-Raster kann nachträglich importiert werden und ersetzt
          die abgeleiteten Höhen dann vollständig.
        </p>
      </div>

      <div className="modal-fuss">
        <button type="button" className="knopf knopf--leise" onClick={onSchliessen}>
          {auftrag && auftrag.status === 'fertig' ? 'Schließen' : 'Abbrechen'}
        </button>
        <button type="button" className="knopf knopf--haupt" onClick={() => void starten()} disabled={!startBereit}>
          {laeuftGerade ? 'Import läuft …' : 'Import starten'}
        </button>
      </div>
    </Modal>
  );
}
