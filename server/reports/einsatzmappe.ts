/**
 * Einsatzmappe (Lastenheft F11) — EIN PDF fuer die Einsatzkraefte.
 *
 * Bewusst in EINEM pdfkit-Dokument gebaut (kein Zusammenfuegen fertiger PDFs):
 * so tragen alle Seiten dieselbe Fusszeile mit durchgehender Seitenzaehlung,
 * und der Lageplan wird mit denselben Zeichenroutinen wie das A3-Planblatt
 * gesetzt — es gibt nur eine Wahrheit fuer die Geometrie.
 *
 * Seitenfolge: Deckblatt (hoch) — Uebersichtslageplan (quer) —
 * Einsatzstationen (hoch) — Betreiberliste (quer) — Regelpruefung und
 * Kontaktverzeichnis (hoch).
 */

import type {
  Einsatzstation,
  Freigabe,
  Gelaende,
  Nutzer,
  ObjektTyp,
  Organisation,
  ProjektInhalt,
  Pruefbericht,
  Punkt,
  Regelwerk,
} from '../../shared/domain/types.ts';
import {
  FREIGABE_LABEL,
  ORG_TYP_LABEL,
  STATION_LABEL,
  WEGE_TYP_LABEL,
} from '../../shared/domain/types.ts';
import { abstandPunktPolylinie, schwerpunkt, zahl } from '../../shared/geo/geometry.ts';
import type { Dok } from './pdf-basis.ts';
import {
  A4_BREITE,
  A4_HOEHE,
  FARBEN,
  RAND,
  FUSS_HOEHE,
  absatz,
  alsBuffer,
  datumDeutsch,
  datumZeit,
  farbeFuerStatus,
  feldZeile,
  fusszeile,
  hinweisKasten,
  kopfzeile,
  neuesDokument,
  satzUnterkante,
  tabelle,
  ueberschrift,
} from './pdf-basis.ts';
import { inhaltsBbox, passenderMassstab, zeichnePlan } from './lageplan.ts';
import {
  BETREIBER_SPALTEN,
  betreiberTabellenZeilen,
  betreiberZeilen,
  GESPERRT,
} from './betreiberliste.ts';

export interface EinsatzmappeOpts {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  /** Letzter Pruefbericht; null, wenn noch nicht geprueft. */
  bericht: Pruefbericht | null;
  regelwerk: Regelwerk | null;
  /** Am Projekt beteiligte Organisationen (fuer das Kontaktverzeichnis). */
  organisationen: Organisation[];
  nutzerListe: Nutzer[];
  veranstalter: Organisation | null;
  /** Stand, auf den sich die Mappe bezieht. */
  snapshot?: { name: string; zeit: string } | null;
  /** Freigaben zu diesem Snapshot. */
  freigaben?: Freigabe[];
  /** DSGVO-Schalter aus rechte.kontaktSichtbar(). */
  kontaktSichtbar: boolean;
}

const HOCH_MARGINS = { top: RAND, bottom: RAND + FUSS_HOEHE, left: RAND, right: RAND };

function seiteHoch(doc: Dok): void {
  doc.addPage({ size: [A4_BREITE, A4_HOEHE], margins: HOCH_MARGINS });
}

function seiteQuer(doc: Dok): void {
  doc.addPage({ size: [A4_HOEHE, A4_BREITE], margins: HOCH_MARGINS });
}

function stationsPunkt(st: Einsatzstation): Punkt | null {
  if (st.punkt) return st.punkt;
  if (st.polygon && st.polygon.length >= 3) return schwerpunkt(st.polygon);
  return null;
}

/** Kuerzeste Entfernung bis zum RAND einer Feuerwehrzufahrt, wie in der Regel-Engine. */
function distanzZurZufahrt(p: Punkt, inhalt: ProjektInhalt): number | null {
  const zufahrten = inhalt.wege.filter((w) => w.typ === 'feuerwehrzufahrt');
  if (!zufahrten.length) return null;
  let d = Infinity;
  for (const w of zufahrten) {
    if (w.polylinie.length < 1) continue;
    d = Math.min(d, Math.max(0, abstandPunktPolylinie(p, w.polylinie) - w.breite / 2));
  }
  return Number.isFinite(d) ? d : null;
}

// ---------------------------------------------------------------------------
// Deckblatt
// ---------------------------------------------------------------------------

function deckblatt(doc: Dok, o: EinsatzmappeOpts): void {
  const p = o.inhalt.projekt;
  kopfzeile(doc, 'Einsatzmappe', `${p.name} — Unterlagen fuer Einsatz- und Sicherheitskraefte`);

  feldZeile(doc, 'Projekt', p.name);
  feldZeile(doc, 'Zeitraum', `${datumDeutsch(p.zeitraumVon)} bis ${datumDeutsch(p.zeitraumBis)}`);
  feldZeile(doc, 'Max. Besucher (gleichzeitig)', p.maxBesucher ? p.maxBesucher.toLocaleString('de-DE') : 'k. A.');
  feldZeile(doc, 'Projektstatus', p.status);
  feldZeile(doc, 'Veranstalter', o.veranstalter ? o.veranstalter.name : 'k. A.');
  feldZeile(doc, 'Anschrift Veranstalter', o.veranstalter?.adresse ?? 'k. A.');

  const kontakt = (() => {
    if (!o.kontaktSichtbar) return GESPERRT;
    const org = o.veranstalter;
    if (!org) return 'k. A.';
    const eigene = o.nutzerListe.filter((n) => n.orgId === org.id);
    const person = eigene.find((n) => n.rolleInOrg === 'admin') ?? eigene[0];
    return person ? `${person.name}, ${person.email}` : 'k. A.';
  })();
  feldZeile(doc, 'Kontakt Veranstalter', kontakt);
  feldZeile(doc, 'Gelaende', o.gelaende ? o.gelaende.name : 'k. A.');
  doc.y += 8;

  ueberschrift(doc, 'Planstand', 1);
  feldZeile(doc, 'Snapshot', o.snapshot ? o.snapshot.name : 'Arbeitsstand (kein Snapshot)');
  feldZeile(doc, 'Stand vom', o.snapshot ? datumZeit(o.snapshot.zeit) : datumZeit(p.geaendertAm));

  const freigaben = o.freigaben ?? [];
  if (!freigaben.length) {
    feldZeile(doc, 'Freigabestatus', 'offen — es liegt keine behoerdliche Freigabe zu diesem Stand vor');
  } else {
    for (const f of freigaben) {
      feldZeile(
        doc,
        `Freigabe ${f.behoerdenOrgName}`,
        `${FREIGABE_LABEL[f.status]} (${datumDeutsch(f.am)})${f.auflagen.length ? ` — ${f.auflagen.length} Auflage(n)` : ''}`,
      );
    }
    const auflagen = freigaben.flatMap((f) => f.auflagen);
    if (auflagen.length) {
      doc.y += 6;
      ueberschrift(doc, 'Auflagen', 2);
      tabelle(
        doc,
        [
          { titel: 'Auflage', breite: 335 },
          { titel: 'Von', breite: 110 },
          { titel: 'Erledigt', breite: 70 },
        ],
        auflagen.map((a) => [a.text, `${a.vonOrg} (${datumDeutsch(a.am)})`, a.erledigt ? 'ja' : 'offen']),
        { groesse: 7.5 },
      );
    }
  }

  doc.y += 6;
  ueberschrift(doc, 'Inhalt dieser Mappe', 2);
  absatz(
    doc,
    '1. Uebersichtslageplan (massstaeblich, ETRS89 / UTM 32N)\n' +
      '2. Einsatzstationen mit Koordinate und Entfernung zur naechsten Feuerwehrzufahrt\n' +
      '3. Betreiberliste aller Aufbauten\n' +
      '4. Zusammenfassung der Regelpruefung (nur Beanstandungen)\n' +
      '5. Kontaktverzeichnis der beteiligten Organisationen',
    { groesse: 9 },
  );

  const hinweis =
    o.regelwerk?.haftungshinweis ??
    o.bericht?.haftungshinweis ??
    'Diese Mappe ist Planungsunterstuetzung und ersetzt weder das Sicherheitskonzept noch behoerdliche Auflagen.';
  doc.y += 4;
  hinweisKasten(doc, hinweis);
}

// ---------------------------------------------------------------------------
// Uebersichtslageplan
// ---------------------------------------------------------------------------

function uebersichtsplan(doc: Dok, o: EinsatzmappeOpts): void {
  seiteQuer(doc);
  kopfzeile(doc, 'Uebersichtslageplan', `${o.inhalt.projekt.name} — Gitternord oben, Massstab siehe Titelblock`);

  const x = RAND;
  const y = doc.y;
  const breite = A4_HOEHE - 2 * RAND;
  // Bis zur Satzunterkante, nicht bis zum Blattrand: die Fusszeile wird in
  // alsBuffer() ZULETZT gestempelt und laege sonst im Titelblock des Plans.
  const hoehe = satzUnterkante(doc) - y;
  const streifen = Math.min(210, breite * 0.4);
  const gebiet = inhaltsBbox(o) ?? {
    minE: 0,
    minN: 0,
    maxE: 1,
    maxN: 1,
  };
  const massstab = passenderMassstab(gebiet, breite - streifen - 10, hoehe);

  zeichnePlan(doc, {
    inhalt: o.inhalt,
    gelaende: o.gelaende,
    typen: o.typen,
    massstab,
    titel: o.inhalt.projekt.name,
    untertitel: o.snapshot ? `Stand: ${o.snapshot.name}` : 'Arbeitsstand',
    x,
    y,
    breite,
    hoehe,
    zeigeLegende: true,
    zeigeTitelblock: true,
    zeigeMassstab: true,
    zeigeNordpfeil: true,
    zeigeRahmen: true,
  });
}

// ---------------------------------------------------------------------------
// Einsatzstationen
// ---------------------------------------------------------------------------

function einsatzstationen(doc: Dok, o: EinsatzmappeOpts): void {
  seiteHoch(doc);
  kopfzeile(doc, 'Einsatzstationen', `${o.inhalt.projekt.name} — ${o.inhalt.einsatzstationen.length} Station(en)`);

  const zufahrten = o.inhalt.wege.filter((w) => w.typ === 'feuerwehrzufahrt');
  absatz(
    doc,
    zufahrten.length
      ? `Entfernungen sind Luftlinien bis zum Rand der naechsten Feuerwehrzufahrt (${zufahrten.length} Zufahrt(en) geplant), gemessen in der Ebene EPSG:25832.`
      : 'Es ist keine Feuerwehrzufahrt geplant — die Entfernungen sind daher nicht bestimmbar (k. A.).',
    { groesse: 7.5, farbe: zufahrten.length ? FARBEN.grau : FARBEN.orange },
  );

  const orgs = new Map<string, Organisation>();
  for (const org of o.organisationen) orgs.set(org.id, org);

  const zeilen = o.inhalt.einsatzstationen
    .slice()
    .sort((a, b) => STATION_LABEL[a.kategorie].localeCompare(STATION_LABEL[b.kategorie], 'de') || a.name.localeCompare(b.name, 'de'))
    .map((st) => {
      const p = stationsPunkt(st);
      const d = p ? distanzZurZufahrt(p, o.inhalt) : null;
      return [
        STATION_LABEL[st.kategorie],
        st.name || 'k. A.',
        st.besetztVonOrgId ? (orgs.get(st.besetztVonOrgId)?.name ?? 'unbekannte Organisation') : 'nicht zugewiesen',
        p ? `E ${Math.round(p[0])}, N ${Math.round(p[1])}` : 'k. A.',
        d === null ? 'k. A.' : `${zahl(d, 1)} m`,
      ];
    });

  tabelle(
    doc,
    [
      { titel: 'Kategorie', breite: 95 },
      { titel: 'Name', breite: 135 },
      { titel: 'Besetzt von', breite: 120 },
      { titel: 'Koordinate (EPSG:25832)', breite: 100 },
      { titel: 'Distanz Feuerwehrzufahrt', breite: 65, ausrichtung: 'rechts' },
    ],
    zeilen,
    { groesse: 7.5 },
  );

  if (zufahrten.length) {
    ueberschrift(doc, 'Feuerwehrzufahrten und Bewegungsflaechen', 2);
    const fw = o.inhalt.wege.filter((w) => w.typ === 'feuerwehrzufahrt' || w.typ === 'feuerwehrbewegungsflaeche');
    tabelle(
      doc,
      [
        { titel: 'Typ', breite: 150 },
        { titel: 'Bezeichnung', breite: 175 },
        { titel: 'Breite', breite: 60, ausrichtung: 'rechts' },
        { titel: 'Lichte Hoehe', breite: 70, ausrichtung: 'rechts' },
        { titel: 'Richtung', breite: 60 },
      ],
      fw.map((w) => [
        WEGE_TYP_LABEL[w.typ],
        w.name ?? 'k. A.',
        `${zahl(w.breite)} m`,
        w.lichteHoehe === undefined || w.lichteHoehe === null ? 'k. A.' : `${zahl(w.lichteHoehe)} m`,
        w.richtung,
      ]),
      { groesse: 7.5 },
    );
  }
}

// ---------------------------------------------------------------------------
// Betreiberliste
// ---------------------------------------------------------------------------

function betreiberSeite(doc: Dok, o: EinsatzmappeOpts): void {
  seiteQuer(doc);
  kopfzeile(doc, 'Betreiberliste', `${o.inhalt.projekt.name} — ${o.inhalt.objekte.length} Aufbauten`);
  const zeilen = betreiberZeilen(o.inhalt, o.typen, o.organisationen, o.nutzerListe, o.kontaktSichtbar);
  if (!o.kontaktSichtbar) {
    absatz(doc, 'Hinweis: Kontaktdaten sind fuer Ihre Rolle gesperrt (DSGVO).', {
      groesse: 7.5,
      farbe: FARBEN.orange,
    });
  }
  tabelle(doc, BETREIBER_SPALTEN, betreiberTabellenZeilen(zeilen), { groesse: 7 });
}

// ---------------------------------------------------------------------------
// Regelpruefung (nur Beanstandungen)
// ---------------------------------------------------------------------------

function pruefungSeite(doc: Dok, o: EinsatzmappeOpts): void {
  seiteHoch(doc);
  kopfzeile(doc, 'Regelpruefung — Beanstandungen', o.inhalt.projekt.name);

  if (!o.bericht) {
    absatz(doc, 'Fuer diesen Planstand liegt keine Regelpruefung vor (k. A.).', {
      fett: true,
      farbe: FARBEN.orange,
    });
    return;
  }
  const z = o.bericht.zusammenfassung;
  absatz(
    doc,
    `Pruefung vom ${datumZeit(o.bericht.zeit)}, Regelwerk ${o.bericht.regelwerkId} Version ${o.bericht.regelwerkVersion}: ` +
      `${z.fehler} Fehler, ${z.warnungen} Warnungen, ${z.hinweise} Hinweise, ${z.ok} ohne Beanstandung, ${z.nichtPruefbar} nicht pruefbar.`,
    { groesse: 8.5, fett: true },
  );

  const verstoesse = o.bericht.ergebnisse.filter((e) => e.status === 'verstoss');
  if (!verstoesse.length) {
    absatz(doc, 'Es liegen keine Beanstandungen vor.', { fett: true, farbe: FARBEN.gruen });
  } else {
    tabelle(
      doc,
      [
        { titel: 'Regel-ID', breite: 55 },
        { titel: 'Schweregrad', breite: 60 },
        { titel: 'Meldung', breite: 240 },
        { titel: 'Ist', breite: 55, ausrichtung: 'rechts' },
        { titel: 'Soll', breite: 55, ausrichtung: 'rechts' },
        { titel: 'Fundstelle', breite: 50 },
      ],
      verstoesse.map((e) => [
        e.regelId,
        e.schweregrad,
        e.meldung,
        e.istWert === null ? 'k. A.' : `${zahl(e.istWert)} ${e.einheit}`.trim(),
        e.sollWert === null ? 'k. A.' : `${zahl(e.sollWert)} ${e.einheit}`.trim(),
        e.fundstelle.split(' — ')[0],
      ]),
      {
        groesse: 7,
        zeilenFarbe: (_z, i) => {
          const e = verstoesse[i];
          return e ? farbeFuerStatus(e.status, e.schweregrad) : undefined;
        },
      },
    );
  }

  const nichtPruefbar = o.bericht.ergebnisse.filter((e) => e.status === 'nicht_pruefbar');
  if (nichtPruefbar.length) {
    ueberschrift(doc, 'Nicht pruefbare Regeln', 2);
    tabelle(
      doc,
      [
        { titel: 'Regel-ID', breite: 55 },
        { titel: 'Titel', breite: 150 },
        { titel: 'Begruendung', breite: 310 },
      ],
      nichtPruefbar.map((e) => [e.regelId, e.regelTitel, e.meldung]),
      { groesse: 7, kopfFarbe: FARBEN.grau },
    );
  }

  hinweisKasten(doc, o.bericht.haftungshinweis || o.regelwerk?.haftungshinweis || 'k. A.');
}

// ---------------------------------------------------------------------------
// Kontaktverzeichnis
// ---------------------------------------------------------------------------

function kontaktverzeichnis(doc: Dok, o: EinsatzmappeOpts): void {
  seiteHoch(doc);
  kopfzeile(doc, 'Kontaktverzeichnis', `${o.inhalt.projekt.name} — beteiligte Organisationen`);

  const zeilen = o.organisationen
    .slice()
    .sort((a, b) => a.typ.localeCompare(b.typ, 'de') || a.name.localeCompare(b.name, 'de'))
    .map((org) => {
      const personen = o.nutzerListe.filter((n) => n.orgId === org.id);
      const person = personen.find((n) => n.rolleInOrg === 'admin') ?? personen[0];
      return [
        ORG_TYP_LABEL[org.typ],
        org.name,
        org.adresse ?? 'k. A.',
        o.kontaktSichtbar ? (person?.name ?? 'k. A.') : GESPERRT,
        o.kontaktSichtbar ? (person?.email ?? 'k. A.') : GESPERRT,
      ];
    });

  tabelle(
    doc,
    [
      { titel: 'Rolle', breite: 110 },
      { titel: 'Organisation', breite: 130 },
      { titel: 'Anschrift', breite: 120 },
      { titel: 'Ansprechpartner', breite: 75 },
      { titel: 'E-Mail', breite: 80 },
    ],
    zeilen,
    { groesse: 7.5 },
  );

  absatz(
    doc,
    'Telefonnummern werden im Datenmodell nicht gefuehrt und sind darum durchgehend mit „k. A.“ ausgewiesen.',
    { groesse: 7, farbe: FARBEN.grau },
  );
}

// ---------------------------------------------------------------------------
// Oeffentliche Schnittstelle
// ---------------------------------------------------------------------------

export async function einsatzmappePdf(o: EinsatzmappeOpts): Promise<Buffer> {
  const doc = neuesDokument({ titel: `Einsatzmappe — ${o.inhalt.projekt.name}` });
  fusszeile(
    doc,
    `Einsatzmappe ${o.inhalt.projekt.name} | Stand ${o.snapshot ? o.snapshot.name : 'Arbeitsstand'} | ETRS89 / UTM 32N (EPSG:25832)`,
  );

  deckblatt(doc, o);
  uebersichtsplan(doc, o);
  einsatzstationen(doc, o);
  betreiberSeite(doc, o);
  pruefungSeite(doc, o);
  kontaktverzeichnis(doc, o);

  return alsBuffer(doc);
}
