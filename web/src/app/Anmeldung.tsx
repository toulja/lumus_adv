/**
 * Anmeldung — zweigeteilter Startbildschirm.
 *
 * Links die ruhige Markenseite (was das Werkzeug tut und was es NICHT tut),
 * rechts Anmeldung, aufklappbare Registrierung und die Zugaenge dieser
 * Installation. Die Demo-Konten stehen fest im Seed (scripts/seed.ts) — sie
 * werden hier nur benannt, die Organisationsdaten kommen vom Server.
 *
 * Erwartete CSS-Klassen aus styles.css: .anmeldung, .anmeldung-seite,
 * .anmeldung-marke, .anmeldung-formular, .marke-punkte, .marke-hinweis,
 * .anmeldung-karte, .zugaenge, .zugang-knopf, .aufklapp, .aufklapp-kopf
 * (dazu die gemeinsamen: .knopf, .feld, .feld-zeile, .karte, .tabelle,
 * .abzeichen, .trenner, .leer, .laedt-balken).
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Organisation, OrgTyp } from '@shared/domain/types';
import { ORG_TYP_LABEL } from '@shared/domain/types';
import { api } from '../lib/api.ts';
import { nutzeZustand } from '../lib/zustand.ts';

interface DemoKonto {
  email: string;
  passwort: string;
  person: string;
  orgName: string;
  orgTyp: OrgTyp;
}

/** Feste Zugaenge des lokalen Betriebs — identisch zu scripts/seed.ts. */
const DEMO_KONTEN: DemoKonto[] = [
  { email: 'admin@eventplan3d.de', passwort: 'admin1234', person: 'Plattform-Admin', orgName: 'EventPlan3D Betrieb', orgTyp: 'plattform' },
  { email: 'veranstalter@heinerfest.de', passwort: 'heiner1234', person: 'Tolga Karakaya', orgName: 'Heinerfest Veranstaltungs GmbH', orgTyp: 'veranstalter' },
  { email: 'wagner@schausteller.de', passwort: 'stand1234', person: 'Martin Wagner', orgName: 'Schaustellerbetrieb Wagner', orgTyp: 'betreiber' },
  { email: 'kern@sonnenschein.de', passwort: 'stand1234', person: 'Sabine Kern', orgName: 'Imbissbetrieb Sonnenschein', orgTyp: 'betreiber' },
  { email: 'ordnungsamt@darmstadt.de', passwort: 'amt12345', person: 'Ordnungsamt Sachbearbeitung', orgName: 'Ordnungsamt Darmstadt', orgTyp: 'behoerde_ordnungsamt' },
  { email: 'brandschutz@feuerwehr-darmstadt.de', passwort: 'feuer1234', person: 'Vorbeugender Brandschutz', orgName: 'Feuerwehr Darmstadt', orgTyp: 'behoerde_feuerwehr' },
  { email: 'einsatz@polizei-suedhessen.de', passwort: 'polizei1234', person: 'Einsatzplanung Suedhessen', orgName: 'Polizeipraesidium Suedhessen', orgTyp: 'polizei' },
];

const PUNKTE = [
  'Gelände aus amtlichen Geodaten',
  'maßstabsgetreue Aufbauten und Rettungswege',
  'prüfbarer Konformitätsbericht',
];

export function Anmeldung() {
  const anmelden = nutzeZustand((s) => s.anmelden);
  const anmeldungPruefen = nutzeZustand((s) => s.anmeldungPruefen);

  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const [orgs, setOrgs] = useState<(Organisation & { nutzer: number })[] | null>(null);
  const [orgsFehler, setOrgsFehler] = useState<string | null>(null);

  const [regOffen, setRegOffen] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPasswort, setRegPasswort] = useState('');
  const [regOrg, setRegOrg] = useState('');
  const [regFehler, setRegFehler] = useState<string | null>(null);
  const [regLaeuft, setRegLaeuft] = useState(false);

  useEffect(() => {
    let aktiv = true;
    api
      .organisationen()
      .then((o) => {
        if (aktiv) setOrgs(o);
      })
      .catch((e: unknown) => {
        if (aktiv) setOrgsFehler((e as Error).message);
      });
    return () => {
      aktiv = false;
    };
  }, []);

  async function melden(e: string, p: string) {
    setFehler(null);
    setLaeuft(true);
    try {
      await anmelden(e, p);
    } catch (err) {
      setFehler((err as Error).message);
      setLaeuft(false);
    }
  }

  function konto(k: DemoKonto) {
    setEmail(k.email);
    setPasswort(k.passwort);
    void melden(k.email, k.passwort);
  }

  async function registrieren(ev: FormEvent) {
    ev.preventDefault();
    setRegFehler(null);
    setRegLaeuft(true);
    try {
      await api.registrieren({ name: regName, email: regEmail, passwort: regPasswort, orgId: regOrg });
      await anmeldungPruefen();
    } catch (err) {
      setRegFehler((err as Error).message);
      setRegLaeuft(false);
    }
  }

  return (
    <div className="anmeldung">
      <section className="anmeldung-seite anmeldung-marke">
        <h1 className="marke">EventPlan3D</h1>
        <p className="marke-untertitel">3D-Planung für Großveranstaltungen</p>
        <ul className="marke-punkte">
          {PUNKTE.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="marke-hinweis">
          Die Prüfung ist eine Planungsunterstützung. Sie ersetzt die behördliche Prüfung nicht — verbindlich sind
          allein die Entscheidungen der zuständigen Behörden.
        </p>
      </section>

      <section className="anmeldung-seite anmeldung-formular">
        <div className="karte anmeldung-karte">
          <h2>Anmelden</h2>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void melden(email, passwort);
            }}
          >
            <div className="feld-zeile">
              <label htmlFor="an-email">E-Mail</label>
              <input
                id="an-email"
                className="feld"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div className="feld-zeile">
              <label htmlFor="an-passwort">Passwort</label>
              <input
                id="an-passwort"
                className="feld"
                type="password"
                autoComplete="current-password"
                required
                value={passwort}
                onChange={(ev) => setPasswort(ev.target.value)}
              />
            </div>
            {fehler && (
              <p className="abzeichen abzeichen--fehler" role="alert">
                {fehler}
              </p>
            )}
            <button type="submit" className="knopf knopf--haupt" disabled={laeuft}>
              {laeuft ? 'Anmeldung läuft …' : 'Anmelden'}
            </button>
            {laeuft && <div className="laedt-balken" />}
          </form>

          <div className="trenner" />

          <div className="aufklapp">
            <button
              type="button"
              className="knopf knopf--leise aufklapp-kopf"
              aria-expanded={regOffen}
              aria-controls="registrieren-block"
              onClick={() => setRegOffen((o) => !o)}
            >
              <span aria-hidden="true">{regOffen ? '▾' : '▸'}</span> Registrieren
            </button>
            {regOffen && (
              <form id="registrieren-block" onSubmit={registrieren}>
                <div className="feld-zeile">
                  <label htmlFor="reg-name">Name</label>
                  <input id="reg-name" className="feld" required value={regName} onChange={(ev) => setRegName(ev.target.value)} />
                </div>
                <div className="feld-zeile">
                  <label htmlFor="reg-email">E-Mail</label>
                  <input
                    id="reg-email"
                    className="feld"
                    type="email"
                    autoComplete="email"
                    required
                    value={regEmail}
                    onChange={(ev) => setRegEmail(ev.target.value)}
                  />
                </div>
                <div className="feld-zeile">
                  <label htmlFor="reg-passwort">Passwort (mindestens 8 Zeichen)</label>
                  <input
                    id="reg-passwort"
                    className="feld"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={regPasswort}
                    onChange={(ev) => setRegPasswort(ev.target.value)}
                  />
                </div>
                <div className="feld-zeile">
                  <label htmlFor="reg-org">Organisation</label>
                  <select id="reg-org" className="feld" required value={regOrg} onChange={(ev) => setRegOrg(ev.target.value)}>
                    <option value="">Bitte wählen …</option>
                    {(orgs ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {ORG_TYP_LABEL[o.typ]}
                      </option>
                    ))}
                  </select>
                </div>
                {orgsFehler && (
                  <p className="abzeichen abzeichen--warn" role="alert">
                    Organisationen konnten nicht geladen werden: {orgsFehler}
                  </p>
                )}
                {regFehler && (
                  <p className="abzeichen abzeichen--fehler" role="alert">
                    {regFehler}
                  </p>
                )}
                <button type="submit" className="knopf" disabled={regLaeuft || !regOrg}>
                  {regLaeuft ? 'Registrierung läuft …' : 'Konto anlegen'}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="karte zugaenge">
          <h2>Zugänge dieser Installation</h2>
          <p className="text-schwach">
            Lokaler Betrieb mit Demo-Daten. Ein Klick auf eine Zeile füllt die Felder aus und meldet direkt an.
          </p>
          <table className="tabelle">
            <thead>
              <tr>
                <th scope="col">Konto</th>
                <th scope="col">Passwort</th>
                <th scope="col">Organisation</th>
                <th scope="col">Rolle</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_KONTEN.map((k) => {
                const org = (orgs ?? []).find((o) => o.name === k.orgName) ?? null;
                return (
                  <tr key={k.email} onClick={() => konto(k)}>
                    <td>
                      <button
                        type="button"
                        className="knopf knopf--leise zugang-knopf"
                        aria-label={`Als ${k.person} (${k.email}) anmelden`}
                        disabled={laeuft}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          konto(k);
                        }}
                      >
                        <strong>{k.email}</strong>
                        <span className="text-leise">{k.person}</span>
                      </button>
                    </td>
                    <td className="zahl">{k.passwort}</td>
                    <td>
                      {org ? org.name : k.orgName}
                      {org ? <span className="text-leise"> · {org.nutzer.toLocaleString('de-DE')} Nutzer</span> : null}
                    </td>
                    <td>{ORG_TYP_LABEL[org ? org.typ : k.orgTyp]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orgs === null && !orgsFehler && <div className="laedt-balken" />}
        </div>
      </section>
    </div>
  );
}
