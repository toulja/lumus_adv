import { useEffect, useState } from 'react';
import { nutzeZustand } from '../lib/zustand.ts';
import { Anmeldung } from './Anmeldung.tsx';
import { Dashboard } from './Dashboard.tsx';
import { PolizeiSicht } from './PolizeiSicht.tsx';
import { Arbeitsflaeche } from './Arbeitsflaeche.tsx';
import { Kopfzeile } from './Kopfzeile.tsx';

export type Sicht = 'dashboard' | 'polizei' | 'projekt';

export function App() {
  const nutzer = nutzeZustand((s) => s.nutzer);
  const geprueft = nutzeZustand((s) => s.angemeldetGeprueft);
  const anmeldungPruefen = nutzeZustand((s) => s.anmeldungPruefen);
  const projektLaden = nutzeZustand((s) => s.projektLaden);
  const projektVerlassen = nutzeZustand((s) => s.projektVerlassen);
  const projektId = nutzeZustand((s) => s.projektId);

  const [sicht, setSicht] = useState<Sicht>('dashboard');

  useEffect(() => {
    void anmeldungPruefen();
  }, [anmeldungPruefen]);

  // Behoerden- und Polizei-Organisationen starten in ihrer eigenen Ansicht (F11).
  // ABER: ein Tiefenlink in der Adresse hat Vorrang — sonst wirft diese
  // Startzuweisung den Nutzer aus dem verlinkten Projekt zurueck auf die
  // Uebersicht, sobald die Anmeldepruefung antwortet.
  useEffect(() => {
    if (!nutzer) return;
    if (/^#\/projekt\/\w+/.test(location.hash)) return;
    const istBehoerde = ['polizei', 'behoerde_ordnungsamt', 'behoerde_feuerwehr'].includes(nutzer.orgTyp);
    setSicht(istBehoerde ? 'polizei' : 'dashboard');
  }, [nutzer]);

  // Tiefe Verlinkung ueber den URL-Anteil, damit Ansichten teilbar sind
  useEffect(() => {
    const ausUrl = () => {
      const m = /^#\/projekt\/([\w]+)/.exec(location.hash);
      if (m) {
        setSicht('projekt');
        void projektLaden(m[1]);
      }
    };
    ausUrl();
    window.addEventListener('hashchange', ausUrl);
    return () => window.removeEventListener('hashchange', ausUrl);
  }, [projektLaden]);

  function oeffneProjekt(id: string) {
    location.hash = `#/projekt/${id}`;
    setSicht('projekt');
    void projektLaden(id);
  }

  function schliesseProjekt() {
    location.hash = '';
    projektVerlassen();
    setSicht(nutzer && ['polizei', 'behoerde_ordnungsamt', 'behoerde_feuerwehr'].includes(nutzer.orgTyp) ? 'polizei' : 'dashboard');
  }

  if (!geprueft) {
    return (
      <div className="startbildschirm">
        <div className="marke">EventPlan3D</div>
        <div className="laedt-balken" />
      </div>
    );
  }

  if (!nutzer) return <Anmeldung />;

  return (
    <div className="rahmen" data-sicht={sicht}>
      <Kopfzeile sicht={sicht} setzeSicht={setSicht} schliesseProjekt={schliesseProjekt} />
      <main className="inhalt">
        {sicht === 'dashboard' && <Dashboard oeffneProjekt={oeffneProjekt} />}
        {sicht === 'polizei' && <PolizeiSicht oeffneProjekt={oeffneProjekt} />}
        {sicht === 'projekt' && projektId && <Arbeitsflaeche />}
        {sicht === 'projekt' && !projektId && <ProjektNichtDa zurueck={schliesseProjekt} />}
      </main>
      <Fehlerleiste />
    </div>
  );
}

/**
 * Was zu sehen ist, solange in der Projektansicht KEIN Projekt geladen ist.
 *
 * Vorher stand hier nur „Kein Projekt geoeffnet." — eine Sackgasse: sie nannte
 * weder den Grund noch einen Rueckweg, und sie erschien auch waehrend des
 * normalen Ladens sowie nach einem fehlgeschlagenen Abruf (dessen Fehlerleiste
 * sich nach 9 s selbst schliesst). Wer darauf landete, sah nur einen leeren
 * Bildschirm mit einem Satz, der nichts erklaert (Nutzerbefund 08.08.2026).
 */
function ProjektNichtDa({ zurueck }: { zurueck: () => void }) {
  const laedt = nutzeZustand((s) => s.laedt);
  const fehler = nutzeZustand((s) => s.fehler);

  if (laedt) {
    return (
      <div className="leer">
        <p>Projekt wird geladen …</p>
        <p className="hinweis">Das Gelände umfasst mehrere tausend Gebäude — der erste Aufbau dauert einen Moment.</p>
        <div className="laedt-balken" />
      </div>
    );
  }

  return (
    <div className="leer">
      <p>Das Projekt konnte nicht geöffnet werden.</p>
      {fehler && <p className="hinweis">Grund: {fehler}</p>}
      <p className="hinweis">
        Häufigste Ursache: Die Anmeldung gilt nicht mehr, oder das angemeldete Konto hat für dieses Projekt keine Rolle.
        Melden Sie sich neu an — als Veranstalter (Tolga Karakaya) sehen Sie alle Projekte.
      </p>
      <button type="button" className="knopf" onClick={zurueck}>
        Zurück zur Übersicht
      </button>
    </div>
  );
}

function Fehlerleiste() {
  const fehler = nutzeZustand((s) => s.fehler);
  const zeigeFehler = nutzeZustand((s) => s.zeigeFehler);
  useEffect(() => {
    if (!fehler) return;
    const t = setTimeout(() => zeigeFehler(null), 9000);
    return () => clearTimeout(t);
  }, [fehler, zeigeFehler]);
  if (!fehler) return null;
  return (
    <div className="fehlerleiste" role="alert">
      <span>{fehler}</span>
      <button type="button" onClick={() => zeigeFehler(null)} aria-label="Meldung schliessen">
        ×
      </button>
    </div>
  );
}
