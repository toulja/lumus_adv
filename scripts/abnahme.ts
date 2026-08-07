/**
 * Abnahmetest Phase 1 — "Heinerfest Darmstadt" (Lastenheft Kapitel 12).
 *
 * Faehrt alle zehn Abnahmekriterien end-to-end gegen den laufenden Server und
 * meldet je Kriterium BESTANDEN oder FEHLGESCHLAGEN mit dem gemessenen Wert.
 *
 * Aufruf:  npm run abnahme        (Server muss laufen: npm run dev:api)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Einsatzstation, ObjektInstanz, Pruefbericht, Punkt, Ring, Weg } from '../shared/domain/types.ts';
import { abstandPunktRing, bboxVonPunkten } from '../shared/geo/geometry.ts';

const BASIS = process.env.HEINERFEST_API ?? 'http://127.0.0.1:4720';
const AUSGABE = path.resolve(process.cwd(), 'data', 'abnahme');

interface Sitzung {
  name: string;
  keks: string;
}

const ergebnisse: { nr: number; titel: string; ok: boolean; befund: string }[] = [];
let aktuellerTitel = '';
let aktuelleNr = 0;

function pruefe(bedingung: boolean, befund: string) {
  ergebnisse.push({ nr: aktuelleNr, titel: aktuellerTitel, ok: bedingung, befund });
  const marke = bedingung ? '  OK  ' : ' FEHL ';
  console.log(`  [${marke}] ${befund}`);
}

function kriterium(nr: number, titel: string) {
  aktuelleNr = nr;
  aktuellerTitel = titel;
  console.log(`\n${nr}. ${titel}`);
}

async function anmelden(email: string, passwort: string, name: string): Promise<Sitzung> {
  const res = await fetch(`${BASIS}/api/auth/anmelden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, passwort }),
  });
  if (!res.ok) throw new Error(`Anmeldung ${email} fehlgeschlagen: HTTP ${res.status}`);
  const keks = (res.headers.getSetCookie?.() ?? [])[0]?.split(';')[0] ?? '';
  if (!keks) throw new Error('Kein Sitzungskeks erhalten.');
  return { name, keks };
}

/** Einmal wiederholen, falls eine gepoolte Verbindung inzwischen tot ist. */
async function hole(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Connection: 'close' } });
  }
}

async function ruf<T>(s: Sitzung, pfad: string, opts: RequestInit = {}): Promise<T> {
  const res = await hole(`${BASIS}/api${pfad}`, {
    ...opts,
    headers: { Cookie: s.keks, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers as Record<string, string>) },
  });
  if (!res.ok) {
    let d = `HTTP ${res.status}`;
    try {
      d = ((await res.json()) as { fehler?: string }).fehler ?? d;
    } catch {
      /* egal */
    }
    throw new Error(`${opts.method ?? 'GET'} ${pfad}: ${d}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

async function rufRoh(s: Sitzung, pfad: string): Promise<{ status: number; bytes: Buffer; typ: string }> {
  const res = await hole(`${BASIS}/api${pfad}`, { headers: { Cookie: s.keks } });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), typ: res.headers.get('content-type') ?? '' };
}

async function erwarteFehler(s: Sitzung, pfad: string, opts: RequestInit): Promise<number> {
  const res = await hole(`${BASIS}/api${pfad}`, {
    ...opts,
    headers: { Cookie: s.keks, 'Content-Type': 'application/json' },
  });
  return res.status;
}

const j = (d: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(d) });
const p = (d: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(d) });

// ---------------------------------------------------------------------------
// Freiflaechensuche
//
// Das Testgebiet ist die echte Darmstaedter Innenstadt mit 2.500 amtlichen
// Gebaeuden. Feste Koordinaten waeren geraten und laegen mit hoher
// Wahrscheinlichkeit in einem Haus — die Regel-Engine meldete dann voellig zu
// Recht 0,00 m freie Durchgangsbreite. Der Test sucht die Aufbauflaechen
// deshalb selbst: den Punkt mit dem groessten Abstand zur Bebauung und von
// dort aus den laengsten freien Korridor.
// ---------------------------------------------------------------------------

class Bebauung {
  private zellen = new Map<string, Ring[]>();
  private zellGroesse = 60;

  constructor(gebaeude: { grundriss: Ring }[]) {
    for (const g of gebaeude) {
      if (g.grundriss.length < 3) continue;
      const b = bboxVonPunkten(g.grundriss);
      for (let e = Math.floor(b.minE / this.zellGroesse); e <= Math.floor(b.maxE / this.zellGroesse); e++) {
        for (let n = Math.floor(b.minN / this.zellGroesse); n <= Math.floor(b.maxN / this.zellGroesse); n++) {
          const k = `${e}:${n}`;
          const liste = this.zellen.get(k);
          if (liste) liste.push(g.grundriss);
          else this.zellen.set(k, [g.grundriss]);
        }
      }
    }
  }

  /** Abstand zur naechsten Bebauung, gedeckelt bei `grenze` Metern. */
  abstand(p: Punkt, grenze = 40): number {
    const ce = Math.floor(p[0] / this.zellGroesse);
    const cn = Math.floor(p[1] / this.zellGroesse);
    const reichweite = Math.ceil(grenze / this.zellGroesse);
    let min = grenze;
    for (let de = -reichweite; de <= reichweite; de++) {
      for (let dn = -reichweite; dn <= reichweite; dn++) {
        for (const ring of this.zellen.get(`${ce + de}:${cn + dn}`) ?? []) {
          const d = abstandPunktRing(p, ring);
          if (d < min) min = d;
          if (min <= 0) return 0;
        }
      }
    }
    return min;
  }
}

interface Freiflaeche {
  mitte: Punkt;
  abstand: number;
  achse: [Punkt, Punkt];
  laenge: number;
  richtungGrad: number;
}

function findeFreiflaeche(bebauung: Bebauung, bbox: { minE: number; minN: number; maxE: number; maxN: number }, mindestbreite = 4): Freiflaeche {
  let besterPunkt: Punkt = [(bbox.minE + bbox.maxE) / 2, (bbox.minN + bbox.maxN) / 2];
  let besterAbstand = -1;
  for (let e = bbox.minE + 40; e <= bbox.maxE - 40; e += 8) {
    for (let n = bbox.minN + 40; n <= bbox.maxN - 40; n += 8) {
      const d = bebauung.abstand([e, n], 60);
      if (d > besterAbstand) {
        besterAbstand = d;
        besterPunkt = [e, n];
      }
    }
  }
  // Laengsten freien Korridor durch diesen Punkt suchen
  let besteAchse: [Punkt, Punkt] = [besterPunkt, besterPunkt];
  let besteLaenge = 0;
  let besteRichtung = 0;
  for (let grad = 0; grad < 180; grad += 7.5) {
    const rad = (grad * Math.PI) / 180;
    const r: Punkt = [Math.sin(rad), Math.cos(rad)];
    const reichweite = (vorzeichen: number): number => {
      let s = 0;
      for (; s < 400; s += 4) {
        const q: Punkt = [besterPunkt[0] + r[0] * s * vorzeichen, besterPunkt[1] + r[1] * s * vorzeichen];
        if (q[0] < bbox.minE + 10 || q[0] > bbox.maxE - 10 || q[1] < bbox.minN + 10 || q[1] > bbox.maxN - 10) break;
        if (bebauung.abstand(q, mindestbreite + 1) < mindestbreite) break;
      }
      return Math.max(0, s - 4);
    };
    const vor = reichweite(1);
    const zurueck = reichweite(-1);
    if (vor + zurueck > besteLaenge) {
      besteLaenge = vor + zurueck;
      besteAchse = [
        [besterPunkt[0] - r[0] * zurueck, besterPunkt[1] - r[1] * zurueck],
        [besterPunkt[0] + r[0] * vor, besterPunkt[1] + r[1] * vor],
      ];
      besteRichtung = grad;
    }
  }
  return { mitte: besterPunkt, abstand: besterAbstand, achse: besteAchse, laenge: besteLaenge, richtungGrad: besteRichtung };
}

// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(AUSGABE, { recursive: true });
  const bibliothekTypen = (await (await fetch(`${BASIS}/api/bibliothek`)).json() as {
    typen: { id: string; name: string; masse: { laenge: number; breite: number; hoehe: number }; form: string; einAusstiege: { richtung: number; typ: string }[] }[];
  }).typen;
  console.log('Abnahmetest Phase 1 — Heinerfest Darmstadt');
  console.log(`API: ${BASIS}\n`);

  const veranstalter = await anmelden('veranstalter@heinerfest.de', 'heiner1234', 'Veranstalter');
  const betreiber = await anmelden('wagner@schausteller.de', 'stand1234', 'Standbetreiber Wagner');
  const ordnungsamt = await anmelden('ordnungsamt@darmstadt.de', 'amt12345', 'Ordnungsamt');
  const polizei = await anmelden('einsatz@polizei-suedhessen.de', 'polizei1234', 'Polizei');

  // -- 1 ---------------------------------------------------------------
  kriterium(1, 'Gebiet in Darmstadt laden — 3D-Gelaende mit realen Hoehen und Luftbild, Quellennachweis sichtbar');
  const gelaendeListe = await ruf<{ id: string; name: string }[]>(veranstalter, '/gelaende');
  pruefe(gelaendeListe.length > 0, `${gelaendeListe.length} Gelaende vorhanden`);
  if (!gelaendeListe.length) {
    console.error('\nKein Gelaende vorhanden. Bitte zuerst `npm run gelaende:heinerfest` ausfuehren.');
    process.exit(1);
  }
  const gid = gelaendeListe[0].id;
  const gelaende = await ruf<{
    id: string;
    name: string;
    gebaeude: { bodenHoehe: number; traufHoehe?: number }[];
    patches: { texturDatei?: string }[];
    hoeheMin: number;
    hoeheMax: number;
    hoehenHerkunft: string;
    flurstuecke: unknown[];
    quellennachweis: { datensatz: string; quellenvermerk: string; abgerufenAm: string }[];
    bbox: { minE: number; minN: number; maxE: number; maxN: number };
  }>(veranstalter, `/gelaende/${gid}`);
  pruefe(gelaende.gebaeude.length > 100, `${gelaende.gebaeude.length} amtliche LoD2-Gebaeude im Gelaende`);
  const mitHoehe = gelaende.gebaeude.filter((g) => (g.traufHoehe ?? 0) > g.bodenHoehe).length;
  pruefe(mitHoehe > gelaende.gebaeude.length * 0.8, `${mitHoehe} Gebaeude mit echter Traufhoehe (${Math.round((mitHoehe / gelaende.gebaeude.length) * 100)} %)`);
  pruefe(gelaende.hoeheMax - gelaende.hoeheMin > 5, `Gelaendehoehen ${gelaende.hoeheMin}–${gelaende.hoeheMax} m ue. NHN (Spanne ${(gelaende.hoeheMax - gelaende.hoeheMin).toFixed(1)} m)`);
  const mitTextur = gelaende.patches.filter((x) => x.texturDatei).length;
  pruefe(mitTextur === gelaende.patches.length && mitTextur > 0, `${mitTextur} von ${gelaende.patches.length} Kacheln mit Luftbildtextur`);
  pruefe(gelaende.flurstuecke.length > 0, `${gelaende.flurstuecke.length} ALKIS-Flurstuecke`);
  pruefe(gelaende.quellennachweis.length >= 3, `Quellennachweis mit ${gelaende.quellennachweis.length} Eintraegen: ${gelaende.quellennachweis.map((q) => q.datensatz).join(', ')}`);
  const textur = await rufRoh(veranstalter, `/gelaende/${gid}/textur/${gelaende.patches.find((x) => x.texturDatei)?.texturDatei}`);
  pruefe(textur.status === 200 && textur.bytes.length > 50_000, `Luftbildkachel abrufbar (${Math.round(textur.bytes.length / 1024)} kB, ${textur.typ})`);

  // Freiflaeche im echten Stadtgebiet suchen statt Koordinaten zu raten
  const bebauung = new Bebauung(gelaende.gebaeude as unknown as { grundriss: Ring }[]);
  const frei = findeFreiflaeche(bebauung, gelaende.bbox, 4);
  pruefe(
    frei.laenge > 60,
    `Freiflaechensuche im Bestand: groesster Abstand zur Bebauung ${frei.abstand.toFixed(1)} m bei E ${Math.round(frei.mitte[0])} / N ${Math.round(frei.mitte[1])}, freier Korridor ${frei.laenge.toFixed(0)} m lang (Richtung ${frei.richtungGrad.toFixed(0)} Grad)`,
  );

  const achsRichtung: Punkt = [
    (frei.achse[1][0] - frei.achse[0][0]) / Math.max(1e-9, frei.laenge),
    (frei.achse[1][1] - frei.achse[0][1]) / Math.max(1e-9, frei.laenge),
  ];
  const achsLot: Punkt = [-achsRichtung[1], achsRichtung[0]];
  const aufAchse = (t: number, versatz = 0): Punkt => [
    frei.achse[0][0] + achsRichtung[0] * t + achsLot[0] * versatz,
    frei.achse[0][1] + achsRichtung[1] * t + achsLot[1] * versatz,
  ];

  /**
   * Freie Standplaetze: Rasterpunkte mit genug Abstand zur Bebauung.
   * Der Abstand zur Rettungswegachse wird MITGELIEFERT, damit beim Platzieren
   * die halbe Objektdiagonale beruecksichtigt werden kann — ein Riesenrad mit
   * 16,5 m Radius braucht deutlich mehr Luft als ein Imbissstand.
   */
  function standplaetze(anzahl: number, mindestAbstandBebauung: number, abstandVonAchse: number): (Punkt & { rel?: number })[] {
    const kandidaten: { p: Punkt; guete: number }[] = [];
    for (let e = gelaende.bbox.minE + 30; e <= gelaende.bbox.maxE - 30; e += 6) {
      for (let n = gelaende.bbox.minN + 30; n <= gelaende.bbox.maxN - 30; n += 6) {
        const p: Punkt = [e, n];
        const d = bebauung.abstand(p, mindestAbstandBebauung + 2);
        if (d < mindestAbstandBebauung) continue;
        // Abstand zur Rettungswegachse
        const rel = (p[0] - frei.achse[0][0]) * achsLot[0] + (p[1] - frei.achse[0][1]) * achsLot[1];
        const laengs = (p[0] - frei.achse[0][0]) * achsRichtung[0] + (p[1] - frei.achse[0][1]) * achsRichtung[1];
        const aufAchseNah = laengs >= -20 && laengs <= frei.laenge + 20;
        if (aufAchseNah && Math.abs(rel) < abstandVonAchse) continue;
        kandidaten.push({ p, guete: d - Math.abs(rel) * 0.02 - Math.abs(laengs - frei.laenge / 2) * 0.01 });
      }
    }
    kandidaten.sort((a, b) => b.guete - a.guete);
    const gewaehlt: Punkt[] = [];
    for (const k of kandidaten) {
      if (gewaehlt.length >= anzahl) break;
      if (gewaehlt.some((g) => Math.hypot(g[0] - k.p[0], g[1] - k.p[1]) < 24)) continue;
      gewaehlt.push(k.p);
    }
    return gewaehlt;
  }

  const plaetze = standplaetze(60, 12, 4);
  pruefe(plaetze.length >= 25, `${plaetze.length} freie Standplaetze mit mindestens 12 m Abstand zur Bebauung gefunden`);

  /** Abstand eines Punktes von der Rettungswegachse (quer). */
  const achsAbstand = (q: Punkt): number =>
    Math.abs((q[0] - frei.achse[0][0]) * achsLot[0] + (q[1] - frei.achse[0][1]) * achsLot[1]);

  const belegt = new Set<number>();
  /**
   * Sucht einen Platz, der die halbe Objektdiagonale plus die halbe Wegbreite
   * frei laesst — sonst ragt das Objekt schon beim Aufstellen in den Rettungsweg
   * und die spaetere Engstellenpruefung haette keine saubere Ausgangslage.
   */
  function platzFuer(halbeDiagonale: number): Punkt {
    const noetig = halbeDiagonale + 1.5 + 1.0;
    for (let i = 0; i < plaetze.length; i++) {
      if (belegt.has(i)) continue;
      if (achsAbstand(plaetze[i]) < noetig) continue;
      belegt.add(i);
      return plaetze[i];
    }
    // Nichts gefunden: seitlich neben die Achse ausweichen
    const nr = belegt.size;
    belegt.add(-nr - 1);
    return aufAchse(20 + nr * 26, (nr % 2 ? -1 : 1) * (noetig + 6));
  }

  const halbeDiagonaleVon = (typId: string): number => {
    const t = bibliothekTypen.find((x) => x.id === typId);
    if (!t) return 5;
    return t.form === 'kreis' ? t.masse.laenge / 2 : Math.hypot(t.masse.laenge, t.masse.breite) / 2;
  };

  // -- 2 ---------------------------------------------------------------
  kriterium(2, 'Projekt „Heinerfest 2027“ anlegen, max. Besucher 30.000');
  const projekt = await ruf<{ id: string; name: string; maxBesucher: number }>(
    veranstalter,
    '/projekte',
    j({
      name: 'Heinerfest 2027',
      gelaendeId: gid,
      zeitraumVon: '2027-07-01',
      zeitraumBis: '2027-07-05',
      maxBesucher: 30000,
      regelwerkId: 'he-mvstaettvo',
      beschreibung: 'Abnahmetest Phase 1',
    }),
  );
  const pid = projekt.id;
  pruefe(projekt.name === 'Heinerfest 2027' && projekt.maxBesucher === 30000, `Projekt angelegt: „${projekt.name}“, ${projekt.maxBesucher.toLocaleString('de-DE')} Besucher`);

  // -- 3 ---------------------------------------------------------------
  kriterium(3, 'Riesenrad (33 m / H 38 m) platzieren, 45 Grad drehen, Einstieg nach Sueden');
  const riesenradTyp = bibliothekTypen.find((t) => t.id === 'riesenrad');
  pruefe(!!riesenradTyp, `Objekttyp „Riesenrad“ in der Bibliothek (${bibliothekTypen.length} Typen gesamt)`);
  pruefe(
    !!riesenradTyp && riesenradTyp.masse.laenge === 33 && riesenradTyp.masse.hoehe === 38 && riesenradTyp.form === 'kreis',
    `Masse laut Bibliothek: Durchmesser ${riesenradTyp?.masse.laenge} m, Hoehe ${riesenradTyp?.masse.hoehe} m, Form ${riesenradTyp?.form}`,
  );
  const riesenrad = await ruf<ObjektInstanz>(veranstalter, `/projekte/${pid}/objekte`, j({ typId: 'riesenrad', position: platzFuer(halbeDiagonaleVon('riesenrad')), rotation: 0, standNummer: 'R1' }));
  const gedreht = await ruf<ObjektInstanz>(veranstalter, `/projekte/${pid}/objekte/${riesenrad.id}`, p({ rotation: 45 }));
  pruefe(gedreht.rotation === 45, `Riesenrad um ${gedreht.rotation} Grad gedreht`);

  // Einstieg nach Sueden ausrichten: Weltrichtung = rotation + lokale Richtung, 180 = Sued
  const einstieg = riesenradTyp?.einAusstiege.find((z) => z.typ === 'einstieg');
  const noetigeRotation = einstieg ? ((180 - einstieg.richtung) % 360 + 360) % 360 : 180;
  const ausgerichtet = await ruf<ObjektInstanz>(veranstalter, `/projekte/${pid}/objekte/${riesenrad.id}`, p({ rotation: noetigeRotation }));
  const weltrichtung = einstieg ? (ausgerichtet.rotation + einstieg.richtung) % 360 : -1;
  pruefe(Math.abs(weltrichtung - 180) < 0.5, `Einstieg zeigt nach ${weltrichtung.toFixed(0)} Grad (180 = Sueden), Objektdrehung ${ausgerichtet.rotation} Grad`);

  // -- 4 ---------------------------------------------------------------
  kriterium(4, '20 weitere Objekte platzieren, 5 einem Standbetreiber zuweisen — dieser darf nur diese bearbeiten');
  const typReihe = ['imbissstand', 'verkaufsstand', 'schankzelt', 'bierwagen', 'kinderkarussell', 'autoscooter', 'schiessbude', 'losbude', 'toilettenwagen', 'container-20ft'];
  const vorhandene = new Set(bibliothekTypen.map((t) => t.id));
  const gewaehlteTypen = typReihe.filter((t) => vorhandene.has(t));
  const ersatz = bibliothekTypen.filter((t) => !gewaehlteTypen.includes(t.id)).map((t) => t.id);
  const platziert: ObjektInstanz[] = [];
  for (let i = 0; i < 20; i++) {
    const typId = gewaehlteTypen[i % gewaehlteTypen.length] ?? ersatz[i % ersatz.length];
    const platz = platzFuer(halbeDiagonaleVon(typId));
    platziert.push(
      await ruf<ObjektInstanz>(veranstalter, `/projekte/${pid}/objekte`, j({ typId, position: platz, rotation: 0, standNummer: `S${i + 1}` })),
    );
  }
  pruefe(platziert.length === 20, `${platziert.length} weitere Objekte platziert (Gesamt ${platziert.length + 1})`);

  const orgs = await ruf<{ id: string; name: string; typ: string }[]>(veranstalter, '/auth/organisationen');
  const wagnerOrg = orgs.find((o) => o.name.includes('Wagner'))!;
  for (const o of platziert.slice(0, 5)) {
    await ruf(veranstalter, `/projekte/${pid}/objekte/${o.id}/zuweisen`, j({ betreiberOrgId: wagnerOrg.id }));
  }
  const nachZuweisung = await ruf<{ objekte: ObjektInstanz[]; rolle: string }>(veranstalter, `/projekte/${pid}`);
  const zugewiesen = nachZuweisung.objekte.filter((o) => o.betreiberOrgId === wagnerOrg.id);
  pruefe(zugewiesen.length === 5, `${zugewiesen.length} Objekte an „${wagnerOrg.name}“ zugewiesen`);

  const sichtBetreiber = await ruf<{ objekte: ObjektInstanz[]; rolle: string }>(betreiber, `/projekte/${pid}`);
  pruefe(sichtBetreiber.rolle === 'standbetreiber', `Standbetreiber sieht das Projekt in der Rolle „${sichtBetreiber.rolle}“`);
  pruefe(sichtBetreiber.objekte.length === 21, `Standbetreiber sieht das GESAMTE Projekt lesend (${sichtBetreiber.objekte.length} Objekte)`);
  const eigenesOk = await erwarteFehler(betreiber, `/projekte/${pid}/objekte/${platziert[0].id}`, p({ notizen: 'Anschluss 32 A geprueft' }));
  pruefe(eigenesOk === 200, `Standbetreiber darf sein zugewiesenes Objekt aendern (HTTP ${eigenesOk})`);
  const fremdesVerboten = await erwarteFehler(betreiber, `/projekte/${pid}/objekte/${platziert[10].id}`, p({ notizen: 'Fremdzugriff' }));
  pruefe(fremdesVerboten === 403, `Standbetreiber darf ein fremdes Objekt NICHT aendern (HTTP ${fremdesVerboten})`);
  const wegVerboten = await erwarteFehler(betreiber, `/projekte/${pid}/wege`, j({ typ: 'rettungsweg', polylinie: [aufAchse(10), aufAchse(30)], breite: 3 }));
  pruefe(wegVerboten === 403, `Standbetreiber darf keine Wege anlegen (HTTP ${wegVerboten})`);

  // -- 5 ---------------------------------------------------------------
  kriterium(5, 'Rettungsweg 3,00 m quer ueber den Platz — Stand hineinschieben, Engstelle und Regelverstoss mit Ist/Soll');
  const rettungsweg = await ruf<Weg>(
    veranstalter,
    `/projekte/${pid}/wege`,
    j({
      typ: 'rettungsweg',
      name: 'Rettungsweg W3',
      polylinie: [aufAchse(4), aufAchse(frei.laenge - 4)],
      breite: 3.0,
      richtung: 'beide',
      entfluchtungFuerPersonen: 600,
    }),
  );
  pruefe(rettungsweg.breite === 3, `Rettungsweg „${rettungsweg.name}“ mit ${rettungsweg.breite.toFixed(2)} m Breite und ${(frei.laenge - 8).toFixed(0)} m Laenge durch die gefundene Freiflaeche angelegt`);

  const vorher = await ruf<{ minFreieBreite: number }>(veranstalter, `/projekte/${pid}/wege/${rettungsweg.id}/engstellen`);
  pruefe(vorher.minFreieBreite >= 2.999, `Weg zunaechst durchgaengig frei: ${vorher.minFreieBreite.toFixed(2)} m`);

  // Einen Stand in den Weg schieben
  const stoerer = platziert[7];
  await ruf(veranstalter, `/projekte/${pid}/objekte/${stoerer.id}`, p({ position: aufAchse(frei.laenge / 2, -0.9) }));
  const engstellen = await ruf<{ minFreieBreite: number; planbreite: number; stellen: unknown[] }>(veranstalter, `/projekte/${pid}/wege/${rettungsweg.id}/engstellen`);
  pruefe(
    engstellen.minFreieBreite < engstellen.planbreite - 0.01,
    `Engstelle erkannt: freie Durchgangsbreite ${engstellen.minFreieBreite.toFixed(2)} m bei ${engstellen.planbreite.toFixed(2)} m Planbreite (${engstellen.stellen.length} eingeschnuerte Querschnitte)`,
  );

  const bericht = await ruf<Pruefbericht>(veranstalter, `/projekte/${pid}/pruefung`, { method: 'POST' });
  const engstellenBefund = bericht.ergebnisse.find((e) => e.pruefTyp === 'rettungsweg_engstelle' && e.status === 'verstoss');
  pruefe(
    !!engstellenBefund,
    engstellenBefund
      ? `Regelverstoss gemeldet: ${engstellenBefund.regelId} — Ist ${engstellenBefund.istWert?.toFixed(2)} m / Soll ${engstellenBefund.sollWert?.toFixed(2)} m`
      : 'KEIN Engstellen-Verstoss im Pruefbericht',
  );
  pruefe(!!engstellenBefund?.fundstelle, `Fundstelle: ${engstellenBefund?.fundstelle ?? 'fehlt'}`);
  pruefe(
    !!engstellenBefund?.empfehlung?.verschiebung,
    engstellenBefund?.empfehlung
      ? `Handlungsempfehlung: ${engstellenBefund.empfehlung.text}`
      : 'KEINE Handlungsempfehlung berechnet',
  );

  const kiAntwort = await ruf<{ text: string; quelle: string; verschiebung: { meter: number; richtung: string } | null }>(
    veranstalter,
    `/projekte/${pid}/ki/erklaeren`,
    j({ ergebnisId: engstellenBefund?.id }),
  );
  pruefe(kiAntwort.text.length > 20, `KI-Panel liefert Verschiebe-Empfehlung (Quelle: ${kiAntwort.quelle}): ${kiAntwort.text.slice(0, 130)}`);

  // Gegenprobe: Empfehlung anwenden und pruefen, ob der Verstoss verschwindet
  if (kiAntwort.verschiebung) {
    const aktuell = (await ruf<{ objekte: ObjektInstanz[] }>(veranstalter, `/projekte/${pid}`)).objekte.find((o) => o.id === stoerer.id)!;
    const v = engstellenBefund!.empfehlung!.verschiebung!;
    await ruf(veranstalter, `/projekte/${pid}/objekte/${stoerer.id}`, p({ position: [aktuell.position[0] + v.dE, aktuell.position[1] + v.dN] }));
    const danach = await ruf<{ minFreieBreite: number }>(veranstalter, `/projekte/${pid}/wege/${rettungsweg.id}/engstellen`);
    pruefe(danach.minFreieBreite >= 2.999, `Gegenprobe: nach der empfohlenen Verschiebung wieder ${danach.minFreieBreite.toFixed(2)} m frei`);
    // Fuer die weiteren Kriterien den Verstoss wieder herstellen, damit der
    // Konformitaetsbericht eine echte Beanstandung zeigt
    await ruf(veranstalter, `/projekte/${pid}/objekte/${stoerer.id}`, p({ position: aufAchse(frei.laenge / 2, -0.9) }));
  }

  // -- 6 ---------------------------------------------------------------
  kriterium(6, 'Blockflaeche „nur Einsatzkraefte“, Laufrichtung auf zwei Besucherwegen, vier Einsatzstationen');
  const block = await ruf<{ id: string; typ: string }>(
    veranstalter,
    `/projekte/${pid}/blockflaechen`,
    j({
      typ: 'nur_einsatzkraefte',
      name: 'Bereitstellungsraum Rettungsdienst',
      begruendung: 'Aufstellflaeche fuer Rettungsmittel, Freihaltung nach Absprache mit der Feuerwehr.',
      polygon: (() => {
        const z = platzFuer(16);
        return [
          [z[0] - 12, z[1] - 10],
          [z[0] + 12, z[1] - 10],
          [z[0] + 12, z[1] + 10],
          [z[0] - 12, z[1] + 10],
        ];
      })(),
    }),
  );
  pruefe(block.typ === 'nur_einsatzkraefte', `Blockflaeche „nur Einsatzkraefte“ angelegt (${block.id})`);

  const besucherwege: Weg[] = [];
  for (const [i, spec] of [
    { name: 'Besucherweg A (Einbahn)', versatz: 14, richtung: 'vorwaerts' },
    { name: 'Besucherweg B (Einbahn)', versatz: -14, richtung: 'rueckwaerts' },
  ].entries()) {
    besucherwege.push(
      await ruf<Weg>(
        veranstalter,
        `/projekte/${pid}/wege`,
        j({
          typ: 'besucherweg',
          name: spec.name,
          polylinie: [aufAchse(6, spec.versatz), aufAchse(frei.laenge - 6, spec.versatz)],
          breite: 5,
          richtung: spec.richtung,
        }),
      ),
    );
    void i;
  }
  pruefe(
    besucherwege.every((w) => w.richtung !== 'beide'),
    `Zwei Besucherwege mit Laufrichtung: ${besucherwege.map((w) => `${w.name} (${w.richtung})`).join(', ')}`,
  );

  const stationen: Einsatzstation[] = [];
  const stationsOrte: Punkt[] = [aufAchse(10, 8), aufAchse(frei.laenge * 0.35, -8), aufAchse(frei.laenge * 0.65, 8), aufAchse(frei.laenge - 10, -8)];
  for (const [i, s] of [
    { kategorie: 'sanitaet', name: 'Sanitaetsstation Nord' },
    { kategorie: 'polizei', name: 'Polizeiposten Mitte' },
    { kategorie: 'einsatzleitung', name: 'Einsatzleitung' },
    { kategorie: 'sammelplatz', name: 'Sammelplatz Sued' },
  ].entries()) {
    stationen.push(await ruf<Einsatzstation>(veranstalter, `/projekte/${pid}/einsatzstationen`, j({ kategorie: s.kategorie, name: s.name, punkt: stationsOrte[i] })));
  }
  pruefe(stationen.length === 4, `${stationen.length} Einsatzstationen gesetzt: ${stationen.map((s) => s.kategorie).join(', ')}`);

  // Feuerwehrzufahrt, damit die Erreichbarkeitsregeln pruefbar werden
  await ruf<Weg>(
    veranstalter,
    `/projekte/${pid}/wege`,
    j({
      typ: 'feuerwehrzufahrt',
      name: 'Feuerwehrzufahrt Ost',
      polylinie: [aufAchse(8, 20), aufAchse(frei.laenge - 8, 20)],
      breite: 3.5,
      lichteHoehe: 3.5,
      richtung: 'beide',
    }),
  );

  // -- 7 ---------------------------------------------------------------
  kriterium(7, 'Polizei (nicht eingeladen) sieht das Projekt automatisch, exportiert Betreiberliste als CSV, erzeugt Einsatzmappe');
  const beteiligte = (await ruf<{ beteiligte: { orgId: string; orgTyp: string }[] }>(veranstalter, `/projekte/${pid}`)).beteiligte;
  const polizeiEingeladen = beteiligte.some((b) => b.orgTyp === 'polizei');
  pruefe(!polizeiEingeladen, `Die Polizei wurde NICHT eingeladen (Beteiligte: ${beteiligte.map((b) => b.orgTyp).join(', ')})`);

  const uebersicht = await ruf<{ organisation: { name: string; zustaendigkeitsgebiet?: string }; projekte: { projekt: { id: string; name: string }; betreiberAnzahl: number }[] }>(
    polizei,
    '/polizei/uebersicht',
  );
  const gefunden = uebersicht.projekte.find((x) => x.projekt.id === pid);
  pruefe(!!gefunden, gefunden ? `Polizei sieht „${gefunden.projekt.name}“ ohne Einladung (Zustaendigkeit: ${uebersicht.organisation.zustaendigkeitsgebiet ?? 'k. A.'})` : 'Polizei sieht das Projekt NICHT');

  const lagebild = await ruf<{ stationen: { name: string; distanzText: string }[]; beanstandungen: unknown[] }>(polizei, `/polizei/projekte/${pid}/lagebild`);
  pruefe(lagebild.stationen.length === 4, `Lagebild: ${lagebild.stationen.length} Einsatzstationen mit Erreichbarkeitsangabe (z. B. „${lagebild.stationen[0]?.name}“: ${lagebild.stationen[0]?.distanzText})`);

  const csv = await rufRoh(polizei, `/projekte/${pid}/berichte/betreiberliste.csv`);
  const csvText = csv.bytes.toString('utf8');
  const csvZeilen = csvText.trim().split('\n').length;
  pruefe(csv.status === 200 && csvZeilen > 5, `Betreiberliste als CSV exportiert: ${csvZeilen} Zeilen, ${csv.bytes.length} Bytes`);
  pruefe(csvText.charCodeAt(0) === 0xfeff, 'CSV traegt UTF-8-BOM (oeffnet in Excel mit korrekten Umlauten)');
  pruefe(csvText.includes(';'), 'CSV ist semikolongetrennt (deutsches Excel)');
  pruefe(csvText.includes('Wagner'), 'Betreiberfirma „Wagner“ steht in der Liste');
  fs.writeFileSync(path.join(AUSGABE, 'betreiberliste.csv'), csv.bytes);

  const mappe = await rufRoh(polizei, `/projekte/${pid}/berichte/einsatzmappe.pdf`);
  pruefe(
    mappe.status === 200 && mappe.bytes.subarray(0, 5).toString() === '%PDF-' && mappe.bytes.length > 20000,
    `Einsatzmappe erzeugt: ${Math.round(mappe.bytes.length / 1024)} kB PDF`,
  );
  fs.writeFileSync(path.join(AUSGABE, 'einsatzmappe.pdf'), mappe.bytes);

  // Die Polizei darf NICHTS aendern
  const polizeiSchreibverbot = await erwarteFehler(polizei, `/projekte/${pid}/objekte/${platziert[1].id}`, p({ notizen: 'Test' }));
  pruefe(polizeiSchreibverbot === 403, `Polizei hat reinen Lesezugriff (Schreibversuch HTTP ${polizeiSchreibverbot})`);

  // -- 8 ---------------------------------------------------------------
  kriterium(8, 'Planungsstand „Einreichung“, Ordnungsamt setzt „mit Auflagen“ + Kommentar, Veranstalter sieht die Aufgabe');
  const ordnungsamtOrg = orgs.find((o) => o.typ === 'behoerde_ordnungsamt')!;
  await ruf(veranstalter, `/projekte/${pid}/einladen`, j({ orgId: ordnungsamtOrg.id, rolle: 'ordnungsamt' }));
  const snapshot = await ruf<{ id: string; name: string; eventCursor: number }>(veranstalter, `/projekte/${pid}/snapshots`, j({ name: 'Einreichung Ordnungsamt 01.03.', bemerkung: 'Abnahmetest', einreichen: true }));
  pruefe(!!snapshot.id, `Planungsstand „${snapshot.name}“ festgehalten (Ereignis-Stand ${snapshot.eventCursor})`);

  const freigabe = await ruf<{ status: string; auflagen: { id: string; text: string }[] }>(
    ordnungsamt,
    `/projekte/${pid}/snapshots/${snapshot.id}/freigabe`,
    j({
      status: 'mit_auflagen',
      kommentar: 'Grundsaetzlich zustimmungsfaehig, jedoch mit Auflagen zur Rettungswegfuehrung.',
      auflagen: ['Rettungsweg W3 durchgaengig 3,00 m freihalten — Stand S8 versetzen.', 'Sammelplatz Herrngarten ausschildern.'],
    }),
  );
  pruefe(freigabe.status === 'mit_auflagen' && freigabe.auflagen.length === 2, `Ordnungsamt setzt „${freigabe.status}“ mit ${freigabe.auflagen.length} Auflagen`);

  const auflagen = await ruf<{ id: string; text: string; erledigt: boolean; quelle: string }[]>(veranstalter, `/projekte/${pid}/auflagen`);
  pruefe(auflagen.length >= 2, `Veranstalter sieht ${auflagen.length} Auflagen als Aufgabenliste: „${auflagen[0]?.text.slice(0, 70)}…“`);
  await ruf(veranstalter, `/projekte/${pid}/auflagen/${auflagen[0].id}`, p({ erledigt: true }));
  const nachHaken = await ruf<{ id: string; erledigt: boolean }[]>(veranstalter, `/projekte/${pid}/auflagen`);
  pruefe(nachHaken.find((a) => a.id === auflagen[0].id)?.erledigt === true, 'Auflage kann als erledigt abgehakt werden');

  const benachrichtigungen = await ruf<{ art: string; titel: string }[]>(veranstalter, '/auth/benachrichtigungen');
  pruefe(benachrichtigungen.some((b) => b.art === 'statuswechsel'), `Veranstalter wurde benachrichtigt (${benachrichtigungen.length} Nachrichten, zuletzt „${benachrichtigungen[0]?.titel}“)`);

  // -- 9 ---------------------------------------------------------------
  kriterium(9, 'Konformitaetsbericht und massstaeblicher Lageplan 1:1000 als PDF, KI beantwortet die Rettungswegfrage');
  const konf = await rufRoh(veranstalter, `/projekte/${pid}/berichte/konformitaet.pdf`);
  pruefe(
    konf.status === 200 && konf.bytes.subarray(0, 5).toString() === '%PDF-' && konf.bytes.length > 20000,
    `Konformitaetsbericht erzeugt: ${Math.round(konf.bytes.length / 1024)} kB`,
  );
  fs.writeFileSync(path.join(AUSGABE, 'konformitaetsbericht.pdf'), konf.bytes);

  const plan = await rufRoh(veranstalter, `/projekte/${pid}/berichte/lageplan.pdf?massstab=1000`);
  pruefe(plan.status === 200 && plan.bytes.subarray(0, 5).toString() === '%PDF-', `Lageplan 1:1000 erzeugt: ${Math.round(plan.bytes.length / 1024)} kB`);
  fs.writeFileSync(path.join(AUSGABE, 'lageplan_1zu1000.pdf'), plan.bytes);
  const plan500 = await rufRoh(veranstalter, `/projekte/${pid}/berichte/lageplan.pdf?massstab=500`);
  pruefe(plan500.status === 200 && plan500.bytes.length > 5000, `Lageplan 1:500 erzeugt: ${Math.round(plan500.bytes.length / 1024)} kB`);
  fs.writeFileSync(path.join(AUSGABE, 'lageplan_1zu500.pdf'), plan500.bytes);

  const frage = await ruf<{ text: string; quelle: string }>(veranstalter, `/projekte/${pid}/ki/frage`, j({ frage: 'Reichen die Rettungswegbreiten fuer 30.000 Besucher?' }));
  const nenntRegel = /R-\d+|Paragraf|§|MVSt|Rettungsweg/i.test(frage.text);
  pruefe(frage.text.length > 40 && nenntRegel, `KI-Antwort (${frage.quelle}) mit Regelbezug: ${frage.text.slice(0, 180).replace(/\n/g, ' ')}`);

  const kapazitaet = bericht.ergebnisse.find((e) => e.pruefTyp === 'kapazitaet_vs_wegbreite');
  const neuerBericht = await ruf<Pruefbericht>(veranstalter, `/projekte/${pid}/pruefung`, { method: 'POST' });
  const kap2 = neuerBericht.ergebnisse.find((e) => e.pruefTyp === 'kapazitaet_vs_wegbreite');
  pruefe(
    !!kap2 && kap2.sollWert !== null,
    kap2 ? `Kapazitaetsregel gerechnet: Summe Rettungswegbreiten ${kap2.istWert?.toFixed(2)} m / erforderlich ${kap2.sollWert?.toFixed(2)} m bei 30.000 Besuchern` : 'Kapazitaetsregel fehlt',
  );
  void kapazitaet;
  pruefe(
    neuerBericht.zusammenfassung.fehler + neuerBericht.zusammenfassung.warnungen > 0,
    `Pruefbericht: ${neuerBericht.zusammenfassung.fehler} Fehler, ${neuerBericht.zusammenfassung.warnungen} Warnungen, ${neuerBericht.zusammenfassung.ok} ohne Beanstandung, ${neuerBericht.zusammenfassung.nichtPruefbar} nicht pruefbar`,
  );
  pruefe(!!neuerBericht.haftungshinweis, `Haftungshinweis im Bericht vorhanden (${neuerBericht.haftungshinweis.length} Zeichen)`);

  // -- 10 --------------------------------------------------------------
  kriterium(10, 'Vadere-Szenario-Export erzeugt eine gueltige Datei (Struktur-Check)');
  for (const szenario of ['normalbetrieb', 'evakuierung']) {
    const v = await ruf<{ pruefung: { gueltig: boolean; fehler: string[]; warnungen: string[] } }>(veranstalter, `/projekte/${pid}/export/vadere?pruefen=1&szenario=${szenario}`);
    pruefe(v.pruefung.gueltig, `Szenario „${szenario}“: ${v.pruefung.gueltig ? 'gueltig' : `ungueltig — ${v.pruefung.fehler.join('; ')}`}${v.pruefung.warnungen.length ? ` (${v.pruefung.warnungen.length} Warnungen)` : ''}`);
  }
  const vDatei = await rufRoh(veranstalter, `/projekte/${pid}/export/vadere?szenario=evakuierung`);
  fs.writeFileSync(path.join(AUSGABE, 'vadere_evakuierung.scenario'), vDatei.bytes);
  pruefe(vDatei.bytes.length > 1000, `Vadere-Datei geschrieben: ${Math.round(vDatei.bytes.length / 1024)} kB`);

  // Weitere Exporte des Lastenhefts F10.4
  const geojson = await rufRoh(veranstalter, `/projekte/${pid}/export/geojson`);
  const gj = JSON.parse(geojson.bytes.toString('utf8')) as { type: string; features: unknown[] };
  pruefe(gj.type === 'FeatureCollection' && gj.features.length > 20, `GeoJSON-Gesamtexport: ${gj.features.length} Features`);
  fs.writeFileSync(path.join(AUSGABE, 'projekt.geojson'), geojson.bytes);

  const glb = await rufRoh(veranstalter, `/projekte/${pid}/export/szene.glb`);
  pruefe(glb.bytes.subarray(0, 4).toString() === 'glTF' && glb.bytes.readUInt32LE(4) === 2, `glTF-Export der Szene: ${Math.round(glb.bytes.length / 1024)} kB, Version ${glb.bytes.readUInt32LE(4)}`);
  fs.writeFileSync(path.join(AUSGABE, 'szene.glb'), glb.bytes);

  // -- Zusammenfassung -------------------------------------------------
  const bestanden = ergebnisse.filter((e) => e.ok).length;
  const gescheitert = ergebnisse.filter((e) => !e.ok);
  console.log('\n' + '='.repeat(78));
  console.log(`Ergebnis: ${bestanden} von ${ergebnisse.length} Pruefpunkten bestanden.`);
  const proKriterium = new Map<number, { titel: string; ok: number; gesamt: number }>();
  for (const e of ergebnisse) {
    const k = proKriterium.get(e.nr) ?? { titel: e.titel, ok: 0, gesamt: 0 };
    k.gesamt++;
    if (e.ok) k.ok++;
    proKriterium.set(e.nr, k);
  }
  for (const [nr, k] of [...proKriterium.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${k.ok === k.gesamt ? 'BESTANDEN     ' : 'FEHLGESCHLAGEN'} Kriterium ${nr}: ${k.titel.slice(0, 60)} (${k.ok}/${k.gesamt})`);
  }
  if (gescheitert.length) {
    console.log('\nOffene Punkte:');
    for (const e of gescheitert) console.log(`  - Kriterium ${e.nr}: ${e.befund}`);
  }
  console.log(`\nErzeugte Nachweise in ${AUSGABE}`);
  console.log(`Projekt-ID fuer die Oberflaeche: ${pid}`);
  process.exit(gescheitert.length ? 1 : 0);
}

main().catch((e: Error) => {
  console.error(`\nAbbruch: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
