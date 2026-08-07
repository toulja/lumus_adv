/**
 * Reiter "Beteiligte": Organisationen im Projekt, Einladungen und die
 * Betreiberliste (mit CSV-/PDF-Ausgabe).
 */

import { useCallback, useEffect, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { BetreiberZeile } from '../lib/api.ts';
import type { Organisation, Rolle } from '@shared/domain/types';
import { ORG_TYP_LABEL, ROLLE_LABEL } from '@shared/domain/types';

const KEINE_ANGABE = 'k. A.';

/** Rollen, die per Einladung vergeben werden koennen. */
const EINLADBAR: Rolle[] = ['standbetreiber', 'ordnungsamt', 'feuerwehr', 'polizei', 'gast'];

export function BeteiligtePanel() {
  const beteiligte = nutzeZustand((s) => s.beteiligte);
  const darf = nutzeZustand((s) => s.darf);
  const projektId = nutzeZustand((s) => s.projektId);
  const projektLaden = nutzeZustand((s) => s.projektLaden);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [orgId, setOrgId] = useState('');
  const [rolle, setRolle] = useState<Rolle>('standbetreiber');
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (darf.einladen !== true) return;
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
  }, [darf.einladen]);

  async function einladen() {
    if (!projektId || !orgId || laeuft) return;
    setLaeuft(true);
    try {
      await api.einladen(projektId, orgId, rolle);
      await projektLaden(projektId);
      setOrgId('');
    } catch (e) {
      zeigeFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function entfernen(zielOrgId: string, name: string) {
    if (!projektId) return;
    if (!window.confirm(`${name} wirklich aus dem Projekt entfernen?`)) return;
    try {
      await api.beteiligtenEntfernen(projektId, zielOrgId);
      await projektLaden(projektId);
    } catch (e) {
      zeigeFehler((e as Error).message);
    }
  }

  const schonDrin = new Set(beteiligte.map((b) => b.orgId));

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="bt-titel">
        <h2 className="pnl-titel" id="bt-titel">
          Beteiligte ({beteiligte.length.toLocaleString('de-DE')})
        </h2>
        {beteiligte.length === 0 ? (
          <p className="leer">Noch keine weitere Organisation beteiligt.</p>
        ) : (
          <ul className="pnl-liste">
            {beteiligte.map((b) => (
              <li key={b.orgId} className="pnl-eintrag">
                <div className="pnl-eintrag__kopf">
                  <span className="pnl-eintrag__name">{b.orgName || KEINE_ANGABE}</span>
                  <span className="pnl-eintrag__zeit">{new Date(b.eingeladenAm).toLocaleDateString('de-DE')}</span>
                </div>
                <div className="pnl-zeile">
                  <span className="abzeichen">{ROLLE_LABEL[b.rolle]}</span>
                  <span className={b.automatisch ? 'abzeichen abzeichen--warn' : 'abzeichen abzeichen--ok'}>
                    {b.automatisch ? 'automatisch (gesetzlicher Zugriff)' : 'eingeladen'}
                  </span>
                </div>
                <span className="pnl-fundstelle">
                  {b.orgTyp && b.orgTyp in ORG_TYP_LABEL
                    ? ORG_TYP_LABEL[b.orgTyp as keyof typeof ORG_TYP_LABEL]
                    : (b.orgTyp ?? KEINE_ANGABE)}
                </span>
                {darf.einladen === true && !b.automatisch && (
                  <button type="button" className="knopf knopf--gefahr" onClick={() => void entfernen(b.orgId, b.orgName)}>
                    Entfernen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {darf.einladen === true && (
        <section className="pnl-abschnitt" aria-labelledby="bt-einladen">
          <h2 className="pnl-titel" id="bt-einladen">
            Organisation einladen
          </h2>
          <div className="pnl-feldblock">
            <label htmlFor="bt-org">Organisation</label>
            <select id="bt-org" className="feld" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">— bitte wählen —</option>
              {orgs
                .filter((o) => !schonDrin.has(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({ORG_TYP_LABEL[o.typ]})
                  </option>
                ))}
            </select>
          </div>
          <div className="pnl-feldblock">
            <label htmlFor="bt-rolle">Rolle</label>
            <select id="bt-rolle" className="feld" value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>
              {EINLADBAR.map((r) => (
                <option key={r} value={r}>
                  {ROLLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="knopf knopf--haupt" disabled={!orgId || laeuft} onClick={() => void einladen()}>
            {laeuft ? 'Wird eingeladen …' : 'Einladen'}
          </button>
        </section>
      )}

      {darf.betreiberliste === true && <Betreiberliste />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Betreiberliste() {
  const projektId = nutzeZustand((s) => s.projektId);
  const inhalt = nutzeZustand((s) => s.inhalt);
  const [zeilen, setZeilen] = useState<BetreiberZeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(() => {
    if (!projektId) return;
    void api
      .betreiberliste(projektId)
      .then((l) => {
        setZeilen(l);
        setFehler(null);
      })
      .catch((e: unknown) => {
        setZeilen(null);
        setFehler((e as Error).message);
      });
  }, [projektId]);

  // Laedt neu, sobald sich der Objektbestand aendert.
  useEffect(laden, [laden, inhalt?.objekte]);

  if (!projektId) return null;

  return (
    <section className="pnl-abschnitt" aria-labelledby="bt-liste">
      <h2 className="pnl-titel" id="bt-liste">
        Betreiberliste
      </h2>
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
        <button type="button" className="knopf knopf--leise" onClick={laden}>
          Aktualisieren
        </button>
      </div>

      {fehler && <p className="pnl-hilfe">Liste nicht abrufbar: {fehler}</p>}
      {!zeilen && !fehler && <div className="laedt-balken" />}
      {zeilen && zeilen.length === 0 && <p className="leer">Noch kein Objekt einem Betreiber zugewiesen.</p>}
      {zeilen && zeilen.length > 0 && (
        <div className="pnl-tabellenrahmen">
          <table className="tabelle">
            <caption className="pnl-hilfe">
              {zeilen.length.toLocaleString('de-DE')} Einträge — Kontaktdaten nur für berechtigte Rollen sichtbar.
            </caption>
            <thead>
              <tr>
                <th scope="col">Stand</th>
                <th scope="col">Objekt</th>
                <th scope="col">Betreiber</th>
                <th scope="col">Ansprechpartner</th>
                <th scope="col">Maße</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z, i) => (
                <tr key={`${z.standNummer}-${i}`}>
                  <td className="pnl-zahl">{z.standNummer || KEINE_ANGABE}</td>
                  <td>{z.objekt || KEINE_ANGABE}</td>
                  <td>{z.betreiberFirma || KEINE_ANGABE}</td>
                  <td>
                    {z.ansprechpartner || KEINE_ANGABE}
                    {z.email ? ` · ${z.email}` : ''}
                    {z.telefon ? ` · ${z.telefon}` : ''}
                  </td>
                  <td className="pnl-zahl">{z.masse || KEINE_ANGABE}</td>
                  <td>{z.status || KEINE_ANGABE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
