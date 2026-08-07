/**
 * Reiter "Eigenschaften": bearbeitet das aktuell ausgewaehlte Element.
 *
 * Alle Masse kommen in Metern aus EPSG:25832 — die Felder rechnen NICHT um.
 * Beim Betreten eines Feldes wird das Element gesperrt, beim Verlassen wieder
 * freigegeben; fremde Sperren legen die Felder still.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type {
  Blockflaeche,
  ElementRef,
  Laufrichtung,
  ObjektStatus,
  Organisation,
  StationsKategorie,
  WegeTyp,
} from '@shared/domain/types';
import {
  BLOCK_TYP_LABEL,
  STATION_LABEL,
  STATIONS_KATEGORIEN,
  WEGE_TYP_LABEL,
  WEGE_TYPEN,
} from '@shared/domain/types';
import { flaeche, polylinieLaenge, zahl } from '@shared/geo/geometry';
import { masseVon } from '@shared/domain/objekte';

const KEINE_ANGABE = 'k. A.';

const STATUS_LABEL: Record<ObjektStatus, string> = {
  geplant: 'Geplant',
  bestaetigt: 'Bestätigt',
  aufgebaut: 'Aufgebaut',
};

const RICHTUNG_LABEL: Record<Laufrichtung, string> = {
  beide: 'Beide Richtungen',
  vorwaerts: 'Vorwärts (in Zeichenrichtung)',
  rueckwaerts: 'Rückwärts',
};

const BLOCK_TYPEN: (keyof typeof BLOCK_TYP_LABEL)[] = ['gesperrt', 'nicht_bebaubar', 'nur_einsatzkraefte'];

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

interface ZahlFeldProps {
  id: string;
  label: string;
  wert: number;
  stellen: number;
  schritt: number;
  min?: number;
  max?: number;
  gesperrt: boolean;
  aendern: (wert: number) => void;
}

/** Zahlenfeld, das erst beim Verlassen oder mit Enter uebernimmt. */
function ZahlFeld({ id, label, wert, stellen, schritt, min, max, gesperrt, aendern }: ZahlFeldProps) {
  const [text, setText] = useState(() => wert.toFixed(stellen));
  const zuletzt = useRef(wert);

  useEffect(() => {
    if (zuletzt.current !== wert) {
      zuletzt.current = wert;
      setText(wert.toFixed(stellen));
    }
  }, [wert, stellen]);

  function uebernehmen() {
    const roh = Number(text.replace(',', '.'));
    if (!Number.isFinite(roh)) {
      setText(wert.toFixed(stellen));
      return;
    }
    const begrenzt = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, roh));
    setText(begrenzt.toFixed(stellen));
    zuletzt.current = begrenzt;
    if (Math.abs(begrenzt - wert) > 1e-9) aendern(begrenzt);
  }

  return (
    <div className="pnl-feldblock">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="feld"
        type="number"
        inputMode="decimal"
        step={schritt}
        min={min}
        max={max}
        value={text}
        disabled={gesperrt}
        onChange={(e) => setText(e.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            uebernehmen();
          }
        }}
      />
    </div>
  );
}

interface TextFeldProps {
  id: string;
  label: string;
  wert: string;
  gesperrt: boolean;
  mehrzeilig?: boolean;
  platzhalter?: string;
  aendern: (wert: string) => void;
}

function TextFeld({ id, label, wert, gesperrt, mehrzeilig, platzhalter, aendern }: TextFeldProps) {
  const [text, setText] = useState(wert);
  const zuletzt = useRef(wert);

  useEffect(() => {
    if (zuletzt.current !== wert) {
      zuletzt.current = wert;
      setText(wert);
    }
  }, [wert]);

  function uebernehmen() {
    zuletzt.current = text;
    if (text !== wert) aendern(text);
  }

  return (
    <div className="pnl-feldblock">
      <label htmlFor={id}>{label}</label>
      {mehrzeilig ? (
        <textarea
          id={id}
          className="feld"
          rows={3}
          value={text}
          disabled={gesperrt}
          placeholder={platzhalter}
          onChange={(e) => setText(e.target.value)}
          onBlur={uebernehmen}
        />
      ) : (
        <input
          id={id}
          className="feld"
          type="text"
          value={text}
          disabled={gesperrt}
          placeholder={platzhalter}
          onChange={(e) => setText(e.target.value)}
          onBlur={uebernehmen}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              uebernehmen();
            }
          }}
        />
      )}
    </div>
  );
}

/** Sperrverwaltung: Fokus im Block = Sperre halten. */
function useSperrBlock(ref: ElementRef | null) {
  const sperreAnfordern = nutzeZustand((s) => s.sperreAnfordern);
  const sperreFreigeben = nutzeZustand((s) => s.sperreFreigeben);
  const gehalten = useRef<ElementRef | null>(null);

  const freigeben = useCallback(() => {
    if (gehalten.current) {
      sperreFreigeben(gehalten.current);
      gehalten.current = null;
    }
  }, [sperreFreigeben]);

  // Auswahlwechsel oder Verlassen des Panels gibt die Sperre zuverlaessig frei.
  useEffect(() => freigeben, [freigeben, ref?.art, ref?.id]);

  const beimFokus = useCallback(() => {
    if (!ref || gehalten.current) return;
    gehalten.current = ref;
    sperreAnfordern(ref);
  }, [ref, sperreAnfordern]);

  const beimVerlassen = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      freigeben();
    },
    [freigeben],
  );

  return { beimFokus, beimVerlassen };
}

/** Organisationen einmalig laden (fuer Betreiber-/Besetzungsauswahl). */
function useOrganisationen(aktiv: boolean) {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  useEffect(() => {
    if (!aktiv) return;
    let lebt = true;
    void api
      .organisationen()
      .then((l) => {
        if (lebt) setOrgs(l);
      })
      .catch(() => {
        if (lebt) setOrgs([]);
      });
    return () => {
      lebt = false;
    };
  }, [aktiv]);
  return orgs;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function EigenschaftenPanel() {
  const auswahl = nutzeZustand((s) => s.auswahl);
  const inhalt = nutzeZustand((s) => s.inhalt);
  const sperren = nutzeZustand((s) => s.sperren);
  const nutzer = nutzeZustand((s) => s.nutzer);

  const ref = auswahl.length > 0 ? auswahl[0] : null;
  const fremd = ref ? sperren.find((s) => s.elementRef.art === ref.art && s.elementRef.id === ref.id && s.nutzerId !== nutzer?.id) : undefined;
  const sperrHinweis = fremd ? `wird gerade von ${fremd.nutzerName} bearbeitet` : null;

  if (!ref || !inhalt) {
    return (
      <section className="pnl-abschnitt">
        <h2 className="pnl-titel">Eigenschaften</h2>
        <p className="leer">Nichts ausgewählt.</p>
        <p className="pnl-hilfe">
          Klicken Sie ein Objekt, einen Weg, eine Blockfläche oder eine Einsatzstation in der Szene an. Mit Umschalt-Klick
          erweitern Sie die Auswahl, mit Esc heben Sie sie auf.
        </p>
      </section>
    );
  }

  return (
    <>
      {auswahl.length > 1 && (
        <p className="pnl-hilfe">
          {auswahl.length.toLocaleString('de-DE')} Elemente ausgewählt — bearbeitet wird das zuerst gewählte.
        </p>
      )}
      {sperrHinweis && (
        <div className="pnl-gesperrt" role="status">
          🔒 Dieses Element {sperrHinweis}. Die Felder sind so lange gesperrt.
        </div>
      )}
      {ref.art === 'objekt' && <ObjektForm id={ref.id} gesperrt={!!fremd} />}
      {ref.art === 'weg' && <WegForm id={ref.id} gesperrt={!!fremd} />}
      {ref.art === 'blockflaeche' && <BlockForm id={ref.id} gesperrt={!!fremd} />}
      {ref.art === 'einsatzstation' && <StationForm id={ref.id} gesperrt={!!fremd} />}
      {!['objekt', 'weg', 'blockflaeche', 'einsatzstation'].includes(ref.art) && (
        <p className="leer">Für dieses Element gibt es keine Eigenschaften.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Objekt
// ---------------------------------------------------------------------------

function ObjektForm({ id, gesperrt }: { id: string; gesperrt: boolean }) {
  const objekt = nutzeZustand((s) => s.inhalt?.objekte.find((o) => o.id === id) ?? null);
  const typen = nutzeZustand((s) => s.typen);
  const darf = nutzeZustand((s) => s.darf);
  const projektId = nutzeZustand((s) => s.projektId);
  const objektAendern = nutzeZustand((s) => s.objektAendern);
  const objektLoeschen = nutzeZustand((s) => s.objektLoeschen);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const sperrblock = useSperrBlock(objekt ? { art: 'objekt', id } : null);
  const orgs = useOrganisationen(darf.zuweisen === true);

  if (!objekt) return <p className="leer">Das Objekt ist nicht mehr vorhanden.</p>;

  const typ = typen.get(objekt.typId);
  const masse = typ ? masseVon(typ, objekt) : { laenge: 0, breite: 0, hoehe: 0 };
  const aus = gesperrt || darf.elementAendern !== true;

  function masseSetzen(feld: 'laenge' | 'breite' | 'hoehe', wert: number) {
    void objektAendern(id, { masseOverride: { ...(objekt?.masseOverride ?? {}), [feld]: wert } }, true);
  }

  async function betreiberSetzen(orgId: string) {
    if (!projektId) return;
    try {
      const neu = await api.objektZuweisen(projektId, id, orgId || null, objekt?.standNummer);
      nutzeZustand.setState((s) => ({
        inhalt: s.inhalt ? { ...s.inhalt, objekte: s.inhalt.objekte.map((o) => (o.id === id ? neu : o)) } : s.inhalt,
      }));
    } catch (e) {
      zeigeFehler((e as Error).message);
    }
  }

  return (
    <section className="pnl-abschnitt" onFocus={sperrblock.beimFokus} onBlur={sperrblock.beimVerlassen}>
      <h2 className="pnl-titel">Objekt</h2>
      <div className="pnl-zeile">
        <span className="pnl-farbtupfer" style={{ background: typ?.farbe ?? '#666' }} aria-hidden="true" />
        <strong>{typ?.name ?? objekt.typId}</strong>
      </div>

      <TextFeld
        id="ob-stand"
        label="Standnummer"
        wert={objekt.standNummer ?? ''}
        gesperrt={aus}
        platzhalter="z. B. A-12"
        aendern={(v) => void objektAendern(id, { standNummer: v.trim() || undefined })}
      />

      <h3 className="pnl-titel">Maße</h3>
      {typ?.parametrisierbar ? (
        <div className="pnl-gitter3">
          <ZahlFeld
            id="ob-l"
            label="Länge (m)"
            wert={masse.laenge}
            stellen={2}
            schritt={0.05}
            min={typ.minMax.laenge[0]}
            max={typ.minMax.laenge[1]}
            gesperrt={aus}
            aendern={(w) => masseSetzen('laenge', w)}
          />
          <ZahlFeld
            id="ob-b"
            label="Breite (m)"
            wert={masse.breite}
            stellen={2}
            schritt={0.05}
            min={typ.minMax.breite[0]}
            max={typ.minMax.breite[1]}
            gesperrt={aus}
            aendern={(w) => masseSetzen('breite', w)}
          />
          <ZahlFeld
            id="ob-h"
            label="Höhe (m)"
            wert={masse.hoehe}
            stellen={2}
            schritt={0.05}
            min={typ.minMax.hoehe[0]}
            max={typ.minMax.hoehe[1]}
            gesperrt={aus}
            aendern={(w) => masseSetzen('hoehe', w)}
          />
        </div>
      ) : (
        <>
          <dl className="werteliste">
            <dt>Länge</dt>
            <dd className="pnl-zahl">{zahl(masse.laenge)} m</dd>
            <dt>Breite</dt>
            <dd className="pnl-zahl">{zahl(masse.breite)} m</dd>
            <dt>Höhe</dt>
            <dd className="pnl-zahl">{zahl(masse.hoehe)} m</dd>
          </dl>
          <p className="pnl-hilfe">
            Dieser Typ ist nicht parametrisierbar — das Typmaß ist verbindlich. Massquelle: {typ?.quelleMasse || KEINE_ANGABE}
          </p>
        </>
      )}

      <h3 className="pnl-titel">Lage</h3>
      <div className="pnl-feldblock">
        <label htmlFor="ob-rot">Drehung (Grad, 0 = Norden)</label>
        <input
          id="ob-rot"
          className="feld"
          type="number"
          step={1}
          min={0}
          max={359}
          value={Math.round(objekt.rotation)}
          disabled={aus}
          onChange={(e) => void objektAendern(id, { rotation: ((Number(e.target.value) % 360) + 360) % 360 }, true)}
        />
        <input
          className="pnl-regler"
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.round(objekt.rotation) % 360}
          disabled={aus}
          aria-label="Drehung in Grad"
          onChange={(e) => void objektAendern(id, { rotation: Number(e.target.value) }, true)}
        />
      </div>
      <div className="pnl-gitter2">
        <ZahlFeld
          id="ob-e"
          label="Rechtswert E (m)"
          wert={objekt.position[0]}
          stellen={0}
          schritt={1}
          gesperrt={aus}
          aendern={(w) => void objektAendern(id, { position: [w, objekt.position[1]] }, true)}
        />
        <ZahlFeld
          id="ob-n"
          label="Hochwert N (m)"
          wert={objekt.position[1]}
          stellen={0}
          schritt={1}
          gesperrt={aus}
          aendern={(w) => void objektAendern(id, { position: [objekt.position[0], w] }, true)}
        />
      </div>
      <ZahlFeld
        id="ob-hg"
        label="Höhe über Gelände (m)"
        wert={objekt.hoeheUeberGelaende ?? 0}
        stellen={2}
        schritt={0.05}
        gesperrt={aus}
        aendern={(w) => void objektAendern(id, { hoeheUeberGelaende: w })}
      />

      <h3 className="pnl-titel">Organisation</h3>
      <div className="pnl-feldblock">
        <label htmlFor="ob-status">Status</label>
        <select
          id="ob-status"
          className="feld"
          value={objekt.status}
          disabled={aus}
          onChange={(e) => void objektAendern(id, { status: e.target.value as ObjektStatus })}
        >
          {(Object.keys(STATUS_LABEL) as ObjektStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {darf.zuweisen === true && (
        <div className="pnl-feldblock">
          <label htmlFor="ob-betreiber">Betreiber</label>
          <select
            id="ob-betreiber"
            className="feld"
            value={objekt.betreiberOrgId ?? ''}
            disabled={gesperrt}
            onChange={(e) => void betreiberSetzen(e.target.value)}
          >
            <option value="">— nicht zugewiesen —</option>
            {orgs
              .filter((o) => o.typ === 'betreiber')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </div>
      )}
      {darf.zuweisen !== true && (
        <dl className="werteliste">
          <dt>Betreiber</dt>
          <dd>{objekt.betreiberOrgId ? objekt.betreiberOrgId : KEINE_ANGABE}</dd>
        </dl>
      )}

      <TextFeld
        id="ob-notiz"
        label="Notizen"
        wert={objekt.notizen ?? ''}
        gesperrt={aus}
        mehrzeilig
        aendern={(v) => void objektAendern(id, { notizen: v })}
      />

      <h3 className="pnl-titel">Auflagen</h3>
      {objekt.auflagen.length === 0 ? (
        <p className="leer">Keine Auflagen für dieses Objekt.</p>
      ) : (
        <ul className="pnl-liste">
          {objekt.auflagen.map((a) => (
            <li key={a.id} className="pnl-eintrag">
              <div className="pnl-eintrag__kopf">
                <span className={a.erledigt ? 'abzeichen abzeichen--ok' : 'abzeichen abzeichen--warn'}>
                  {a.erledigt ? 'erledigt' : 'offen'}
                </span>
                <span className="pnl-eintrag__zeit">{new Date(a.am).toLocaleString('de-DE')}</span>
              </div>
              <span>{a.text}</span>
              <span className="pnl-fundstelle">
                {a.von || KEINE_ANGABE} · {a.vonOrg || KEINE_ANGABE}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="werteliste">
        <dt>Angelegt</dt>
        <dd className="pnl-zahl">{new Date(objekt.erstelltAm).toLocaleString('de-DE')}</dd>
      </dl>

      {darf.elementLoeschen === true && (
        <button
          type="button"
          className="knopf knopf--gefahr"
          disabled={gesperrt}
          onClick={() => {
            if (window.confirm('Dieses Objekt wirklich löschen?')) void objektLoeschen(id);
          }}
        >
          Objekt löschen
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Weg
// ---------------------------------------------------------------------------

interface EngstellenDaten {
  planbreite: number;
  minFreieBreite: number;
  stellen: { station: number; freieBreite: number }[];
}

function WegForm({ id, gesperrt }: { id: string; gesperrt: boolean }) {
  const weg = nutzeZustand((s) => s.inhalt?.wege.find((w) => w.id === id) ?? null);
  const darf = nutzeZustand((s) => s.darf);
  const projektId = nutzeZustand((s) => s.projektId);
  const wegAendern = nutzeZustand((s) => s.wegAendern);
  const wegLoeschen = nutzeZustand((s) => s.wegLoeschen);

  const sperrblock = useSperrBlock(weg ? { art: 'weg', id } : null);

  const [eng, setEng] = useState<EngstellenDaten | null>(null);
  const [engFehler, setEngFehler] = useState<string | null>(null);
  const breite = weg?.breite;

  useEffect(() => {
    if (!projektId || breite === undefined) return;
    let lebt = true;
    setEngFehler(null);
    void api
      .engstellen(projektId, id)
      .then((d) => {
        if (lebt) setEng({ planbreite: d.planbreite, minFreieBreite: d.minFreieBreite, stellen: d.stellen });
      })
      .catch((e: unknown) => {
        if (lebt) {
          setEng(null);
          setEngFehler((e as Error).message);
        }
      });
    return () => {
      lebt = false;
    };
  }, [projektId, id, breite]);

  if (!weg) return <p className="leer">Der Weg ist nicht mehr vorhanden.</p>;

  const aus = gesperrt || (darf.elementAendern !== true && darf.feuerwehrflaeche !== true);
  const laenge = polylinieLaenge(weg.polylinie);
  const unterschritten = eng ? eng.minFreieBreite + 1e-6 < eng.planbreite : false;
  const engeStellen = eng ? eng.stellen.filter((s) => s.freieBreite + 1e-6 < eng.planbreite).length : 0;

  return (
    <section className="pnl-abschnitt" onFocus={sperrblock.beimFokus} onBlur={sperrblock.beimVerlassen}>
      <h2 className="pnl-titel">Weg</h2>

      <TextFeld
        id="we-name"
        label="Name"
        wert={weg.name ?? ''}
        gesperrt={aus}
        platzhalter="z. B. Hauptachse Nord"
        aendern={(v) => void wegAendern(id, { name: v.trim() || undefined })}
      />

      <div className="pnl-feldblock">
        <label htmlFor="we-typ">Typ</label>
        <select
          id="we-typ"
          className="feld"
          value={weg.typ}
          disabled={aus}
          onChange={(e) => void wegAendern(id, { typ: e.target.value as WegeTyp })}
        >
          {WEGE_TYPEN.map((t) => (
            <option key={t} value={t}>
              {WEGE_TYP_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="pnl-gitter2">
        <ZahlFeld
          id="we-breite"
          label="Planbreite (m)"
          wert={weg.breite}
          stellen={2}
          schritt={0.1}
          min={0.5}
          max={50}
          gesperrt={aus}
          aendern={(w) => void wegAendern(id, { breite: w })}
        />
        {weg.typ === 'feuerwehrzufahrt' && (
          <ZahlFeld
            id="we-lichte"
            label="Lichte Höhe (m)"
            wert={weg.lichteHoehe ?? 3.5}
            stellen={2}
            schritt={0.1}
            min={0}
            max={20}
            gesperrt={aus}
            aendern={(w) => void wegAendern(id, { lichteHoehe: w })}
          />
        )}
      </div>

      <div className="pnl-feldblock">
        <label htmlFor="we-richtung">Laufrichtung</label>
        <select
          id="we-richtung"
          className="feld"
          value={weg.richtung}
          disabled={aus}
          onChange={(e) => void wegAendern(id, { richtung: e.target.value as Laufrichtung })}
        >
          {(Object.keys(RICHTUNG_LABEL) as Laufrichtung[]).map((r) => (
            <option key={r} value={r}>
              {RICHTUNG_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      <ZahlFeld
        id="we-entfluchtung"
        label="Entfluchtung für … Personen"
        wert={weg.entfluchtungFuerPersonen ?? 0}
        stellen={0}
        schritt={50}
        min={0}
        max={500000}
        gesperrt={aus}
        aendern={(w) => void wegAendern(id, { entfluchtungFuerPersonen: w > 0 ? Math.round(w) : undefined })}
      />
      <p className="pnl-hilfe">
        Anzahl der Personen, die im Ernstfall über diesen Weg abfließen sollen. Daraus prüft das Regelwerk, ob die Breite für
        die Entfluchtung ausreicht. 0 bedeutet: dieser Weg dient nicht der Entfluchtung.
      </p>

      <h3 className="pnl-titel">Gemessen</h3>
      <dl className="werteliste">
        <dt>Länge</dt>
        <dd className="pnl-zahl">{zahl(laenge)} m</dd>
        <dt>Stützpunkte</dt>
        <dd className="pnl-zahl">{weg.polylinie.length.toLocaleString('de-DE')}</dd>
      </dl>

      <h3 className="pnl-titel">Freie Durchgangsbreite</h3>
      {engFehler && <p className="pnl-hilfe">Engstellen nicht abrufbar: {engFehler}</p>}
      {!eng && !engFehler && <div className="laedt-balken" />}
      {eng && (
        <div className={unterschritten ? 'pnl-befund pnl-befund--fehler' : 'pnl-befund'}>
          <span className="pnl-messwert">
            schmalste Stelle:{' '}
            <span className={unterschritten ? 'pnl-messwert__ist' : ''}>{zahl(eng.minFreieBreite)} m</span>{' '}
            <span className="pnl-messwert__soll">von {zahl(eng.planbreite)} m Planbreite</span>
          </span>
          {unterschritten ? (
            <span className="abzeichen abzeichen--fehler">
              {engeStellen.toLocaleString('de-DE')} Engstelle{engeStellen === 1 ? '' : 'n'} unterschreiten die Planbreite
            </span>
          ) : (
            <span className="abzeichen abzeichen--ok">Keine Einengung durch Objekte</span>
          )}
        </div>
      )}

      {darf.elementLoeschen === true && (
        <button
          type="button"
          className="knopf knopf--gefahr"
          disabled={gesperrt}
          onClick={() => {
            if (window.confirm('Diesen Weg wirklich löschen?')) void wegLoeschen(id);
          }}
        >
          Weg löschen
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Blockflaeche
// ---------------------------------------------------------------------------

function BlockForm({ id, gesperrt }: { id: string; gesperrt: boolean }) {
  const block = nutzeZustand((s) => s.inhalt?.blockflaechen.find((b) => b.id === id) ?? null);
  const darf = nutzeZustand((s) => s.darf);
  const blockflaecheAendern = nutzeZustand((s) => s.blockflaecheAendern);
  const blockflaecheLoeschen = nutzeZustand((s) => s.blockflaecheLoeschen);
  const sperrblock = useSperrBlock(block ? { art: 'blockflaeche', id } : null);

  if (!block) return <p className="leer">Die Blockfläche ist nicht mehr vorhanden.</p>;

  const aus = gesperrt || darf.elementAendern !== true;
  const groesse = flaeche(block.polygon);

  return (
    <section className="pnl-abschnitt" onFocus={sperrblock.beimFokus} onBlur={sperrblock.beimVerlassen}>
      <h2 className="pnl-titel">Blockfläche</h2>

      <TextFeld
        id="bl-name"
        label="Name"
        wert={block.name ?? ''}
        gesperrt={aus}
        platzhalter="z. B. Aufstellfläche Drehleiter"
        aendern={(v) => void blockflaecheAendern(id, { name: v.trim() || undefined })}
      />

      <div className="pnl-feldblock">
        <label htmlFor="bl-typ">Typ</label>
        <select
          id="bl-typ"
          className="feld"
          value={block.typ}
          disabled={aus}
          onChange={(e) => void blockflaecheAendern(id, { typ: e.target.value as Blockflaeche['typ'] })}
        >
          {BLOCK_TYPEN.map((t) => (
            <option key={t} value={t}>
              {BLOCK_TYP_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <TextFeld
        id="bl-begr"
        label="Begründung (Pflichtangabe)"
        wert={block.begruendung}
        gesperrt={aus}
        mehrzeilig
        platzhalter="Warum ist diese Fläche gesperrt?"
        aendern={(v) => void blockflaecheAendern(id, { begruendung: v })}
      />
      {!block.begruendung.trim() && (
        <p className="pnl-warnkasten">
          Ohne Begründung ist die Sperrung im Konformitätsbericht nicht nachvollziehbar — bitte nachtragen.
        </p>
      )}

      <dl className="werteliste">
        <dt>Fläche</dt>
        <dd className="pnl-zahl">{zahl(groesse, 1)} m²</dd>
        <dt>Stützpunkte</dt>
        <dd className="pnl-zahl">{block.polygon.length.toLocaleString('de-DE')}</dd>
      </dl>

      {darf.elementLoeschen === true && (
        <button
          type="button"
          className="knopf knopf--gefahr"
          disabled={gesperrt}
          onClick={() => {
            if (window.confirm('Diese Blockfläche wirklich löschen?')) void blockflaecheLoeschen(id);
          }}
        >
          Blockfläche löschen
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Einsatzstation
// ---------------------------------------------------------------------------

function StationForm({ id, gesperrt }: { id: string; gesperrt: boolean }) {
  const station = nutzeZustand((s) => s.inhalt?.einsatzstationen.find((x) => x.id === id) ?? null);
  const darf = nutzeZustand((s) => s.darf);
  const stationAendern = nutzeZustand((s) => s.stationAendern);
  const stationLoeschen = nutzeZustand((s) => s.stationLoeschen);
  const sperrblock = useSperrBlock(station ? { art: 'einsatzstation', id } : null);
  const orgs = useOrganisationen(true);

  if (!station) return <p className="leer">Die Einsatzstation ist nicht mehr vorhanden.</p>;

  const aus = gesperrt || darf.elementAendern !== true;

  return (
    <section className="pnl-abschnitt" onFocus={sperrblock.beimFokus} onBlur={sperrblock.beimVerlassen}>
      <h2 className="pnl-titel">Einsatzstation</h2>

      <div className="pnl-feldblock">
        <label htmlFor="st-kat">Kategorie</label>
        <select
          id="st-kat"
          className="feld"
          value={station.kategorie}
          disabled={aus}
          onChange={(e) => void stationAendern(id, { kategorie: e.target.value as StationsKategorie })}
        >
          {STATIONS_KATEGORIEN.map((k) => (
            <option key={k} value={k}>
              {STATION_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <TextFeld
        id="st-name"
        label="Name"
        wert={station.name}
        gesperrt={aus}
        aendern={(v) => void stationAendern(id, { name: v })}
      />

      <div className="pnl-feldblock">
        <label htmlFor="st-org">Besetzt von</label>
        <select
          id="st-org"
          className="feld"
          value={station.besetztVonOrgId ?? ''}
          disabled={aus}
          onChange={(e) => void stationAendern(id, { besetztVonOrgId: e.target.value || undefined })}
        >
          <option value="">— noch nicht besetzt —</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <TextFeld
        id="st-notiz"
        label="Notizen"
        wert={station.notizen ?? ''}
        gesperrt={aus}
        mehrzeilig
        aendern={(v) => void stationAendern(id, { notizen: v })}
      />

      <dl className="werteliste">
        <dt>Lage</dt>
        <dd className="pnl-zahl">
          {station.punkt
            ? `E ${station.punkt[0].toFixed(0)} / N ${station.punkt[1].toFixed(0)}`
            : station.polygon
              ? `Fläche, ${zahl(flaeche(station.polygon), 1)} m²`
              : KEINE_ANGABE}
        </dd>
      </dl>

      {darf.elementLoeschen === true && (
        <button
          type="button"
          className="knopf knopf--gefahr"
          disabled={gesperrt}
          onClick={() => {
            if (window.confirm('Diese Einsatzstation wirklich löschen?')) void stationLoeschen(id);
          }}
        >
          Einsatzstation löschen
        </button>
      )}
    </section>
  );
}
