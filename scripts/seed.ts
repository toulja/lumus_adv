/**
 * Startdaten: Organisationen und Nutzer fuer alle Rollen des Lastenhefts.
 * Aufruf: npm run seed
 *
 * Die Passwoerter sind bewusst schlicht — das ist eine lokale Installation.
 * Fuer den Produktivbetrieb: HEINERFEST_SECRET setzen und eigene Konten anlegen.
 */

import { initStore, organisationen, nutzer, id, jetzt } from '../server/lib/store.ts';
import { nutzerAnlegen } from '../server/lib/auth.ts';
import type { OrgTyp } from '../shared/domain/types.ts';

initStore();

interface Vorgabe {
  name: string;
  typ: OrgTyp;
  adresse?: string;
  zustaendigkeitsgebiet?: string;
  nutzer: { name: string; email: string; passwort: string; rolleInOrg?: 'admin' | 'mitglied' }[];
}

const VORGABEN: Vorgabe[] = [
  {
    name: 'EventPlan3D Betrieb',
    typ: 'plattform',
    adresse: 'Darmstadt',
    nutzer: [{ name: 'Plattform-Admin', email: 'admin@eventplan3d.de', passwort: 'admin1234', rolleInOrg: 'admin' }],
  },
  {
    name: 'Heinerfest Veranstaltungs GmbH',
    typ: 'veranstalter',
    adresse: 'Luisenplatz 5, 64283 Darmstadt',
    nutzer: [
      { name: 'Tolga Karakaya', email: 'veranstalter@heinerfest.de', passwort: 'heiner1234', rolleInOrg: 'admin' },
      { name: 'Planungsteam', email: 'planung@heinerfest.de', passwort: 'heiner1234' },
    ],
  },
  {
    name: 'Schaustellerbetrieb Wagner',
    typ: 'betreiber',
    adresse: 'Rheinstrasse 12, 64283 Darmstadt',
    nutzer: [{ name: 'Martin Wagner', email: 'wagner@schausteller.de', passwort: 'stand1234', rolleInOrg: 'admin' }],
  },
  {
    name: 'Imbissbetrieb Sonnenschein',
    typ: 'betreiber',
    adresse: 'Kasinostrasse 2, 64293 Darmstadt',
    nutzer: [{ name: 'Sabine Kern', email: 'kern@sonnenschein.de', passwort: 'stand1234', rolleInOrg: 'admin' }],
  },
  {
    name: 'Ordnungsamt Darmstadt',
    typ: 'behoerde_ordnungsamt',
    adresse: 'Bessunger Strasse 125, 64295 Darmstadt',
    zustaendigkeitsgebiet: 'Wissenschaftsstadt Darmstadt',
    nutzer: [{ name: 'Ordnungsamt Sachbearbeitung', email: 'ordnungsamt@darmstadt.de', passwort: 'amt12345', rolleInOrg: 'admin' }],
  },
  {
    name: 'Feuerwehr Darmstadt',
    typ: 'behoerde_feuerwehr',
    adresse: 'Bismarckstrasse 88, 64293 Darmstadt',
    zustaendigkeitsgebiet: 'Wissenschaftsstadt Darmstadt',
    nutzer: [{ name: 'Vorbeugender Brandschutz', email: 'brandschutz@feuerwehr-darmstadt.de', passwort: 'feuer1234', rolleInOrg: 'admin' }],
  },
  {
    name: 'Polizeipraesidium Suedhessen',
    typ: 'polizei',
    adresse: 'Klappacher Strasse 145, 64285 Darmstadt',
    zustaendigkeitsgebiet: 'Suedhessen (Darmstadt, Darmstadt-Dieburg, Odenwaldkreis, Bergstrasse, Gross-Gerau)',
    nutzer: [{ name: 'Einsatzplanung Suedhessen', email: 'einsatz@polizei-suedhessen.de', passwort: 'polizei1234', rolleInOrg: 'admin' }],
  },
];

let neueOrgs = 0;
let neueNutzer = 0;

for (const v of VORGABEN) {
  let org = organisationen.eines((o) => o.name === v.name);
  if (!org) {
    org = organisationen.einfuegen({
      id: id('org_'),
      name: v.name,
      typ: v.typ,
      adresse: v.adresse,
      zustaendigkeitsgebiet: v.zustaendigkeitsgebiet,
      erstelltAm: jetzt(),
    });
    neueOrgs++;
  }
  for (const n of v.nutzer) {
    if (nutzer.eines((x) => x.email.toLowerCase() === n.email.toLowerCase())) continue;
    nutzerAnlegen(org.id, n.name, n.email, n.passwort, n.rolleInOrg ?? 'mitglied');
    neueNutzer++;
  }
}

console.log(`Startdaten angelegt: ${neueOrgs} Organisationen, ${neueNutzer} Nutzer.`);
console.log('');
console.log('Zugaenge (lokal):');
const breite = Math.max(...VORGABEN.flatMap((v) => v.nutzer.map((n) => n.email.length)));
for (const v of VORGABEN) {
  for (const n of v.nutzer) {
    console.log(`  ${n.email.padEnd(breite)}  ${n.passwort.padEnd(12)}  ${v.name} (${v.typ})`);
  }
}
