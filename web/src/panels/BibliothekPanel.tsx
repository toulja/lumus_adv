/**
 * Reiter "Bauteile": Objektbibliothek zum Platzieren.
 *
 * Jede Kachel weist ihre Masse nach (quelleMasse) — das ist Vorgabe aus dem
 * Lastenheft: kein Mass ohne Herkunft.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { api } from '../lib/api.ts';
import type { ObjektKategorie, ObjektTyp } from '@shared/domain/types';
import { KATEGORIE_LABEL, OBJEKT_KATEGORIEN } from '@shared/domain/types';
import { zahl } from '@shared/geo/geometry';

const KEINE_ANGABE = 'k. A.';

function masstext(t: ObjektTyp): string {
  const m = t.masse;
  return `${zahl(m.laenge)} × ${zahl(m.breite)} × ${zahl(m.hoehe)} m`;
}

export function BibliothekPanel() {
  const bibliothek = nutzeZustand((s) => s.bibliothek);
  const platzierTypId = nutzeZustand((s) => s.platzierTypId);
  const werkzeug = nutzeZustand((s) => s.werkzeug);
  const setzeWerkzeug = nutzeZustand((s) => s.setzeWerkzeug);
  const darf = nutzeZustand((s) => s.darf);

  const [suche, setSuche] = useState('');
  const [kategorie, setKategorie] = useState<ObjektKategorie | 'alle'>('alle');
  const [offen, setOffen] = useState<string | null>(null);

  const treffer = useMemo(() => {
    const alle = bibliothek?.typen ?? [];
    const q = suche.trim().toLowerCase();
    return alle
      .filter((t) => (kategorie === 'alle' ? true : t.kategorie === kategorie))
      .filter((t) => (q ? t.name.toLowerCase().includes(q) || KATEGORIE_LABEL[t.kategorie].toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'de-DE'));
  }, [bibliothek, suche, kategorie]);

  if (!bibliothek) {
    return (
      <div className="pnl-abschnitt">
        <div className="laedt-balken" />
        <p className="pnl-hilfe">Bibliothek wird geladen …</p>
      </div>
    );
  }

  return (
    <>
      <section className="pnl-abschnitt" aria-labelledby="bib-titel">
        <h2 className="pnl-titel" id="bib-titel">
          Bauteile ({bibliothek.typen.length.toLocaleString('de-DE')})
        </h2>
        <p className="pnl-hilfe">
          Bauteil auswählen, danach in der Szene platzieren. Stand der Bibliothek: {bibliothek.stand || KEINE_ANGABE} (Version{' '}
          {bibliothek.version || KEINE_ANGABE}).
        </p>

        <div className="pnl-filter">
          <div className="pnl-feldblock">
            <label htmlFor="bib-suche">Suche</label>
            <input
              id="bib-suche"
              className="feld"
              type="search"
              value={suche}
              placeholder="Name oder Kategorie"
              onChange={(e) => setSuche(e.target.value)}
            />
          </div>
          <div className="pnl-feldblock">
            <label htmlFor="bib-kat">Kategorie</label>
            <select
              id="bib-kat"
              className="feld"
              value={kategorie}
              onChange={(e) => setKategorie(e.target.value as ObjektKategorie | 'alle')}
            >
              <option value="alle">Alle Kategorien</option>
              {OBJEKT_KATEGORIEN.map((k) => (
                <option key={k} value={k}>
                  {KATEGORIE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {treffer.length === 0 ? (
          <p className="leer">Kein Bauteil gefunden.</p>
        ) : (
          <ul className="pnl-kacheln">
            {treffer.map((t) => {
              const aktiv = werkzeug === 'platzieren' && platzierTypId === t.id;
              const detailsOffen = offen === t.id;
              return (
                <li key={t.id} className={aktiv ? 'pnl-kachel pnl-kachel--aktiv' : 'pnl-kachel'}>
                  <button
                    type="button"
                    className="pnl-kachel__haupt"
                    onClick={() => setzeWerkzeug('platzieren', t.id)}
                    aria-pressed={aktiv}
                    aria-label={`${t.name} platzieren, ${masstext(t)}`}
                  >
                    <span className="pnl-kachel__streifen" style={{ background: t.farbe }} aria-hidden="true" />
                    <span className="pnl-kachel__text">
                      <span className="pnl-kachel__name">{t.name}</span>
                      <span className="pnl-kachel__masse">{masstext(t)}</span>
                      <span className="pnl-kachel__meta">
                        {KATEGORIE_LABEL[t.kategorie]}
                        {t.personenkapazitaet !== null && t.personenkapazitaet !== undefined
                          ? ` · ${t.personenkapazitaet.toLocaleString('de-DE')} Personen`
                          : ''}
                        {t.technik.stromKW > 0 ? ` · ${zahl(t.technik.stromKW, 1)} kW` : ''}
                        {t.eigen ? ' · eigener Typ' : ''}
                      </span>
                    </span>
                  </button>
                  <div className="pnl-kachel__fuss">
                    <button
                      type="button"
                      className="knopf knopf--leise"
                      aria-expanded={detailsOffen}
                      onClick={() => setOffen(detailsOffen ? null : t.id)}
                    >
                      {detailsOffen ? '▴ Nachweis' : '▾ Nachweis'}
                    </button>
                  </div>
                  {detailsOffen && (
                    <div className="pnl-nachweis">
                      <dl className="werteliste">
                        <dt>Massquelle</dt>
                        <dd>{t.quelleMasse || KEINE_ANGABE}</dd>
                        <dt>Hinweis</dt>
                        <dd>{t.hinweis || KEINE_ANGABE}</dd>
                        <dt>Umlauf (freizuhalten)</dt>
                        <dd className="pnl-zahl">{zahl(t.flaechenbedarfZusatz)} m</dd>
                        <dt>Maße veränderbar</dt>
                        <dd>
                          {t.parametrisierbar
                            ? `ja — Länge ${zahl(t.minMax.laenge[0])}–${zahl(t.minMax.laenge[1])} m, Breite ${zahl(
                                t.minMax.breite[0],
                              )}–${zahl(t.minMax.breite[1])} m, Höhe ${zahl(t.minMax.hoehe[0])}–${zahl(t.minMax.hoehe[1])} m`
                            : 'nein — Typmaß ist verbindlich'}
                        </dd>
                        <dt>Technik</dt>
                        <dd>
                          {t.technik.stromKW > 0 ? `${zahl(t.technik.stromKW, 1)} kW` : 'kein Strom'}
                          {t.technik.wasser ? ' · Wasser' : ''}
                          {t.technik.gasflaschen ? ' · Gasflaschen' : ''}
                        </dd>
                        <dt>Ein-/Ausstiege</dt>
                        <dd>{t.einAusstiege.length > 0 ? `${t.einAusstiege.length}` : KEINE_ANGABE}</dd>
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {darf.objekttypAnlegen === true && <EigenerTyp />}
    </>
  );
}

// ---------------------------------------------------------------------------

const LEERFORM = { name: '', kategorie: 'infrastruktur' as ObjektKategorie, laenge: '4.00', breite: '3.00', hoehe: '3.00', farbe: '#4a9eda' };

function EigenerTyp() {
  const projektId = nutzeZustand((s) => s.projektId);
  const katalogeLaden = nutzeZustand((s) => s.katalogeLaden);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);

  const [offen, setOffen] = useState(false);
  const [form, setForm] = useState(LEERFORM);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    if (!projektId || laeuft) return;
    const laenge = Number(form.laenge.replace(',', '.'));
    const breite = Number(form.breite.replace(',', '.'));
    const hoehe = Number(form.hoehe.replace(',', '.'));
    if (!form.name.trim() || !(laenge > 0) || !(breite > 0) || !(hoehe > 0)) {
      zeigeFehler('Name und positive Maße (Länge, Breite, Höhe) sind erforderlich.');
      return;
    }
    setLaeuft(true);
    try {
      await api.objekttypAnlegen(projektId, {
        name: form.name.trim(),
        kategorie: form.kategorie,
        masse: { laenge, breite, hoehe },
        farbe: form.farbe,
      });
      await katalogeLaden();
      setForm(LEERFORM);
      setOffen(false);
    } catch (err) {
      zeigeFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="pnl-abschnitt" aria-labelledby="bib-eigen-titel">
      <hr className="pnl-trennlinie" />
      <h2 className="pnl-titel" id="bib-eigen-titel">
        Eigene Bauteile
      </h2>
      {!offen ? (
        <button type="button" className="knopf" onClick={() => setOffen(true)}>
          + Eigenen Typ anlegen
        </button>
      ) : (
        <form className="pnl-abschnitt" onSubmit={absenden}>
          <div className="pnl-feldblock">
            <label htmlFor="et-name">Name</label>
            <input
              id="et-name"
              className="feld"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="pnl-feldblock">
            <label htmlFor="et-kat">Kategorie</label>
            <select
              id="et-kat"
              className="feld"
              value={form.kategorie}
              onChange={(e) => setForm({ ...form, kategorie: e.target.value as ObjektKategorie })}
            >
              {OBJEKT_KATEGORIEN.map((k) => (
                <option key={k} value={k}>
                  {KATEGORIE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="pnl-gitter3">
            <div className="pnl-feldblock">
              <label htmlFor="et-l">Länge (m)</label>
              <input
                id="et-l"
                className="feld"
                type="number"
                step="0.01"
                min="0.1"
                value={form.laenge}
                onChange={(e) => setForm({ ...form, laenge: e.target.value })}
              />
            </div>
            <div className="pnl-feldblock">
              <label htmlFor="et-b">Breite (m)</label>
              <input
                id="et-b"
                className="feld"
                type="number"
                step="0.01"
                min="0.1"
                value={form.breite}
                onChange={(e) => setForm({ ...form, breite: e.target.value })}
              />
            </div>
            <div className="pnl-feldblock">
              <label htmlFor="et-h">Höhe (m)</label>
              <input
                id="et-h"
                className="feld"
                type="number"
                step="0.01"
                min="0.1"
                value={form.hoehe}
                onChange={(e) => setForm({ ...form, hoehe: e.target.value })}
              />
            </div>
          </div>
          <div className="pnl-feldblock">
            <label htmlFor="et-farbe">Farbe</label>
            <input
              id="et-farbe"
              className="feld"
              type="color"
              value={form.farbe}
              onChange={(e) => setForm({ ...form, farbe: e.target.value })}
            />
          </div>
          <p className="pnl-hilfe">
            Eigene Typen gelten als Massquelle „Eigenangabe des Veranstalters“ und sind damit im Bericht als nicht amtlich
            gekennzeichnet.
          </p>
          <div className="pnl-knopfreihe">
            <button type="submit" className="knopf knopf--haupt" disabled={laeuft}>
              {laeuft ? 'Wird angelegt …' : 'Anlegen'}
            </button>
            <button type="button" className="knopf knopf--leise" onClick={() => setOffen(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
