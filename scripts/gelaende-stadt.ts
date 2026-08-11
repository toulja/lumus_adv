/**
 * BAUT EINE GANZE STADT — als Kacheln auf einem gemeinsamen Raster.
 *
 * WARUM NICHT IN EINEM STUECK (gemessen 10.08.2026): Der Browser haelt rund
 * 62 MB je km2; bei einem Fenster-Budget von 2 GB ist bei etwa 32 km2 Schluss.
 * Darmstadt hat 122 km2. Ein Gelaende, das sich bauen, aber nicht anzeigen
 * laesst, ist kein Gelaende — also Kacheln.
 *
 * DAS RASTER IST AUF GANZEN KILOMETERN VERANKERT. Damit liegen die Kacheln
 * dieses Laufs auf denselben Linien wie die des naechsten, und sie liegen auf
 * denselben Linien wie die DGM1-Lieferung des Landes (je 1 km2 eine Datei).
 * Zwei Nachbarkacheln stossen dadurch exakt aneinander statt sich zu
 * ueberlappen oder eine Fuge zu lassen.
 *
 * GEBAUT WIRD NUR, WO ES DIE STADT GIBT. Zwei Bedingungen, beide aus Daten:
 *  1. Es muessen amtliche Hoehen vorliegen (DGM1-Archiv des Landes).
 *  2. Die Kachel muss die amtliche Stadtgrenze beruehren (OSM-Relation mit
 *     dem Gemeindeschluessel). Das Hoehenarchiv reicht ueber die Stadt hinaus;
 *     ohne diese zweite Bedingung baute man Nachbargemeinden mit.
 *
 * Aufruf:
 *   node scripts/gelaende-stadt.ts [--kachel 3] [--nur 5] [--ab 7] [--trocken]
 *     --kachel  Kantenlaenge der Kachel in km (Standard 3 = 9 km2)
 *     --nur     nur diese eine Kachelnummer bauen
 *     --ab      erst ab dieser Nummer bauen (Fortsetzen nach Abbruch)
 *     --trocken nur anzeigen, was gebaut wuerde
 */

import fs from 'node:fs';
import { initStore, nutzer, organisationen } from '../server/lib/store.ts';
import { importStarten, auftrag, MAX_GEBIET_M2 } from '../server/geodata/gelaende.ts';
import { overpass, standardUserAgent } from '../server/geodata/osm.ts';
import { auszugDatei, vorratVorbereiten } from '../server/geodata/osm-auszug.ts';
import { nachUtm } from '../shared/geo/proj.ts';
import { punktInRing } from '../shared/geo/geometry.ts';
import type { BBox, Punkt } from '../shared/domain/types.ts';

initStore();

const arg = (name: string, standard?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : standard;
};
const kachelKm = Number(arg('kachel', '3'));
const nurNr = arg('nur') ? Number(arg('nur')) : null;
const abNr = arg('ab') ? Number(arg('ab')) : 1;
const trocken = process.argv.includes('--trocken');

const DGM_ARCHIV = 'data/cache/dgm1/Darmstadt - DGM1.zip';
const STADT = { name: 'Darmstadt', relation: 62581, schluessel: '06411000' };

// --- 1. Wo liegen amtliche Hoehen? ------------------------------------------
// Die Dateinamen des DGM1-Archivs sind das Verzeichnis: dgm1_32_<Ost>_<Nord>_1_he.tif,
// je Datei genau ein Quadratkilometer.
function dgmKilometer(): Set<string> {
  const b = fs.readFileSync(DGM_ARCHIV);
  const out = new Set<string>();
  for (let i = 0; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) !== 0x02014b50) continue;
    const len = b.readUInt16LE(i + 28);
    const name = b.toString('utf8', i + 46, i + 46 + len);
    i += 45 + len;
    const m = /dgm1_32_(\d+)_(\d+)_1_he\.tif$/i.exec(name);
    if (m) out.add(`${m[1]}_${m[2]}`);
  }
  return out;
}

// --- 2. Wo liegt die Stadt? --------------------------------------------------
/**
 * DIE STADTGRENZE ALS GESCHLOSSENE RINGE.
 *
 * OpenStreetMap liefert eine Gemeindegrenze als RELATION aus vielen offenen
 * Linienstuecken — fuer Darmstadt 33 Stueck mit zusammen 1.951 Punkten. Sie
 * kommen weder in einer Reihenfolge noch in einer einheitlichen Richtung.
 *
 * Ein Punkt-in-Polygon-Test auf einem offenen Stueck ist sinnlos, und das war
 * beim ersten Lauf teuer sichtbar: Die Kacheln der INNENSTADT fehlten in der
 * Liste, weil kein einzelnes Grenzstueck sie umschliesst. Gebaut worden waeren
 * nur die Raender.
 *
 * Also erst ketten: Stueck nehmen, passendes Anschlussstueck suchen (notfalls
 * umgedreht), bis der Ring sich schliesst. Was uebrig bleibt, wird verworfen.
 */
function zuRingen(stuecke: Punkt[][], nahtM = 1): Punkt[][] {
  const offen = stuecke.filter((s) => s.length >= 2).map((s) => [...s]);
  const nah = (a: Punkt, b: Punkt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= nahtM;
  const ringe: Punkt[][] = [];
  while (offen.length) {
    const kette = offen.shift() as Punkt[];
    let gewachsen = true;
    while (gewachsen && !nah(kette[0], kette[kette.length - 1])) {
      gewachsen = false;
      for (let i = 0; i < offen.length; i++) {
        const s = offen[i];
        const ende = kette[kette.length - 1];
        if (nah(ende, s[0])) kette.push(...s.slice(1));
        else if (nah(ende, s[s.length - 1])) kette.push(...[...s].reverse().slice(1));
        else if (nah(kette[0], s[s.length - 1])) kette.unshift(...s.slice(0, -1));
        else if (nah(kette[0], s[0])) kette.unshift(...[...s].reverse().slice(0, -1));
        else continue;
        offen.splice(i, 1);
        gewachsen = true;
        break;
      }
    }
    if (kette.length >= 4 && nah(kette[0], kette[kette.length - 1])) ringe.push(kette);
  }
  return ringe;
}

async function stadtgrenze(): Promise<Punkt[][]> {
  const rumpf = `[out:json][timeout:120];relation(${STADT.relation});out geom;`;
  const el = await overpass(rumpf, `grenze_${STADT.relation}`, { minE: 0, minN: 0, maxE: 1, maxN: 1 }, standardUserAgent());
  const stuecke: Punkt[][] = [];
  for (const e of el as unknown as { members?: { role?: string; geometry?: { lat: number; lon: number }[] }[] }[]) {
    for (const m of e.members ?? []) {
      if (m.role && m.role !== 'outer') continue;
      if (!m.geometry || m.geometry.length < 2) continue;
      stuecke.push(m.geometry.map((p) => nachUtm([p.lon, p.lat]) as Punkt));
    }
  }
  const ringe = zuRingen(stuecke);
  console.log(`Stadtgrenze: ${stuecke.length} Grenzstuecke -> ${ringe.length} geschlossene Ringe.`);
  return ringe;
}

/** Beruehrt die Kachel die Stadt? Geprueft an neun Punkten und an den Grenzstuecken. */
function beruehrtStadt(bb: BBox, ringe: Punkt[][]): boolean {
  for (let a = 0; a <= 1; a += 0.5) {
    for (let b = 0; b <= 1; b += 0.5) {
      const p: Punkt = [bb.minE + (bb.maxE - bb.minE) * a, bb.minN + (bb.maxN - bb.minN) * b];
      for (const r of ringe) if (punktInRing(p, r)) return true;
    }
  }
  // Ein Grenzverlauf kann die Kachel auch nur durchqueren, ohne dass einer der
  // neun Punkte drinliegt — dann liegt ein Grenzpunkt IN der Kachel.
  for (const r of ringe) {
    for (const p of r) {
      if (p[0] >= bb.minE && p[0] <= bb.maxE && p[1] >= bb.minN && p[1] <= bb.maxN) return true;
    }
  }
  return false;
}

// --- 3. Kacheln bilden -------------------------------------------------------
const km = kachelKm * 1000;
if (km * km > MAX_GEBIET_M2) {
  console.error(`Kachel ${kachelKm} x ${kachelKm} km = ${((km * km) / 1e6).toFixed(0)} km2 ueberschreitet MAX_GEBIET_M2 (${(MAX_GEBIET_M2 / 1e6).toFixed(0)} km2).`);
  process.exit(1);
}

const hoehen = dgmKilometer();
console.log(`Hoehendaten: ${hoehen.size} km2 im Archiv.`);
console.log(`Stadtgrenze wird geholt (OSM-Relation ${STADT.relation}, Gemeindeschluessel ${STADT.schluessel}) …`);
const ringe = await stadtgrenze();
if (!ringe.length) {
  console.error('Stadtgrenze nicht erhalten — Abbruch, statt versehentlich Nachbargemeinden zu bauen.');
  process.exit(1);
}
console.log(`Umschlossene Flaeche: ${(ringe.reduce((s,r)=>{let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=r[j][0]*r[i][1]-r[i][0]*r[j][1];return s+Math.abs(a/2);},0)/1e6).toFixed(2)} km2 (amtlich 122,07 km2).`);

type Kachel = { nr: number; bb: BBox; km2MitHoehen: number };
const kacheln: Kachel[] = [];
{
  const ost = [...hoehen].map((s) => Number(s.split('_')[0]));
  const nord = [...hoehen].map((s) => Number(s.split('_')[1]));
  const e0 = Math.floor(Math.min(...ost) / kachelKm) * kachelKm;
  const e1 = Math.max(...ost);
  const n0 = Math.floor(Math.min(...nord) / kachelKm) * kachelKm;
  const n1 = Math.max(...nord);
  for (let n = n0; n <= n1; n += kachelKm) {
    for (let e = e0; e <= e1; e += kachelKm) {
      /*
       * DIE KACHEL WIRD AUF DIE HOEHENDATEN ZUSAMMENGEZOGEN.
       *
       * BEFUND 11.08.2026, beim ersten Stadtlauf gestoppt: Das DGM1-Archiv
       * endet an der Kreisgrenze, das 3-km-Raster nicht. Sechzehn der 26
       * Kacheln ragten darueber hinaus, vier davon mit nur 1 von 9 km2
       * Hoehendaten. Der Import haette die Luecken mit `luecken_fuellen()` aus
       * dem Rand extrapoliert — acht Millionen erfundene Zellen je Kachel, die
       * aussehen wie gemessenes Gelaende.
       *
       * Statt das Loch zu fuellen, wird der Auftrag kleiner: Die Kachel bekommt
       * die Huelle IHRER gemessenen Quadratkilometer. Ein Randblock mit 1 km2
       * Hoehen baut dann 1 km2 — vollstaendig statt gross und erfunden.
       *
       * Der Rest (L-Formen innerhalb der Huelle) bleibt und wird vom Import als
       * Datenluecke gemeldet, sobald er 1 % ueberschreitet.
       */
      let mit = 0;
      let e0 = Infinity;
      let e1 = -Infinity;
      let n0 = Infinity;
      let n1 = -Infinity;
      for (let de = 0; de < kachelKm; de++) {
        for (let dn = 0; dn < kachelKm; dn++) {
          if (!hoehen.has(`${e + de}_${n + dn}`)) continue;
          mit++;
          e0 = Math.min(e0, e + de);
          e1 = Math.max(e1, e + de + 1);
          n0 = Math.min(n0, n + dn);
          n1 = Math.max(n1, n + dn + 1);
        }
      }
      if (!mit) continue;
      const bb: BBox = { minE: e0 * 1000, minN: n0 * 1000, maxE: e1 * 1000, maxN: n1 * 1000 };
      if (!beruehrtStadt(bb, ringe)) continue;
      kacheln.push({ nr: kacheln.length + 1, bb, km2MitHoehen: mit });
    }
  }
}

console.log('');
console.log(`${kacheln.length} Kacheln a ${kachelKm} x ${kachelKm} km (${((km * km) / 1e6).toFixed(0)} km2), Raster auf ganzen Kilometern verankert:`);
for (const k of kacheln) {
  const km2=((k.bb.maxE-k.bb.minE)*(k.bb.maxN-k.bb.minN))/1e6;
  console.log(`  ${String(k.nr).padStart(2)}  E ${k.bb.minE}-${k.bb.maxE}  N ${k.bb.minN}-${k.bb.maxN}   ${km2.toFixed(0).padStart(2)} km2 Auftrag, ${k.km2MitHoehen} km2 gemessen${k.km2MitHoehen<km2?`  (${(100*k.km2MitHoehen/km2).toFixed(0)} %)`:`  (voll)`}`);
}
console.log(`Zusammen ${kacheln.reduce((s, k) => s + k.km2MitHoehen, 0)} km2 mit amtlichen Hoehen.`);
if (trocken) {
  console.log('\n--trocken: nichts gebaut.');
  process.exit(0);
}

// --- 4. Bauen ----------------------------------------------------------------
const veranstalter = organisationen.eines((o) => o.typ === 'veranstalter');
const anleger = veranstalter ? nutzer.eines((n) => n.orgId === veranstalter.id) : undefined;
if (!anleger) {
  console.error('Keine Veranstalter-Organisation gefunden. Bitte zuerst `npm run seed` ausfuehren.');
  process.exit(1);
}

/*
 * OSM-VORRAT EINMAL FUER DIE GANZE STADT, nicht je Kachel.
 *
 * Der Ortsauszug wird beim ersten Zugriff fuer das angefragte Gebiet
 * aufgeschlossen (drei Durchgaenge durch 343 MB, rund 40 s). Ohne diesen
 * Vorgriff faende jede Kachel ihr eigenes, kleineres Gebiet vor und der
 * Vorrat wuerde 26-mal neu gebaut — gut siebzehn Minuten fuer nichts.
 *
 * Mit dem Gebiet ALLER Kacheln auf einmal passiert es genau einmal; jede
 * Kachel findet ihren Ausschnitt darin und wird sofort bedient.
 */
{
  const alle = {
    minE: Math.min(...kacheln.map((k) => k.bb.minE)),
    minN: Math.min(...kacheln.map((k) => k.bb.minN)),
    maxE: Math.max(...kacheln.map((k) => k.bb.maxE)),
    maxN: Math.max(...kacheln.map((k) => k.bb.maxN)),
  };
  const datei = auszugDatei();
  if (datei) {
    console.log(`\nOSM-Ortsauszug: ${datei.pfad} (${(datei.bytes / 1e6).toFixed(0)} MB, Stand ${datei.stand.toLocaleString('de-DE')})`);
    console.log(`  wird einmal fuer das Gesamtgebiet aufgeschlossen (${((alle.maxE - alle.minE) / 1000).toFixed(0)} x ${((alle.maxN - alle.minN) / 1000).toFixed(0)} km):`);
    vorratVorbereiten(alle, (s) => console.log(s));
  } else {
    console.log('\nKein OSM-Ortsauszug vorhanden — es wird die Overpass-API befragt.');
    console.log('  Fuer einen Stadtlauf ist das der schlechtere Weg (siehe server/geodata/pbf.ts).');
    console.log('  Holen mit:  node scripts/osm-auszug-holen.ts');
  }
}

const ergebnisse: { nr: number; id?: string; gebaeude?: number; flaechen?: number; sekunden: number; fehler?: string }[] = [];
for (const k of kacheln) {
  if (nurNr !== null && k.nr !== nurNr) continue;
  if (k.nr < abNr) continue;
  const t0 = Date.now();
  const name = `${STADT.name} Kachel ${k.nr} (E${k.bb.minE / 1000} N${k.bb.minN / 1000})`;
  console.log(`\n=== ${k.nr}/${kacheln.length}  ${name} ===`);
  try {
    const a = importStarten({
      name,
      bbox: k.bb,
      land: 'hessen',
      kreis: 'Kreisfreie Stadt Darmstadt',
      nutzerId: anleger.id,
      // Anweisung des Auftraggebers fuer das Stadtmodell (11.08.2026):
      // „lass die moeblierung weg". Der Detailbereich am Grossen Woog behaelt
      // seine Baenke und Laternen — das ist derselbe Programmweg mit Schalter,
      // keine zweite Qualitaetsstufe (Begruendung: stadtdetails.DetailOpts).
      ohneMoebel: true,
    });
    let gelesen = 0;
    while (true) {
      const stand = auftrag(a.id);
      if (!stand) break;
      // Nur die Zeilen zeigen, die etwas Neues sagen — bei 20 Kacheln waere
      // jede Zwischenmeldung sonst eine Bildschirmseite.
      for (const m of stand.meldungen.slice(gelesen)) {
        if (/ACHTUNG|FEHLT|unvollstaendig|gescheitert|Flurstuecken|gespeichert/i.test(m)) console.log('  ' + m.slice(0, 200));
      }
      gelesen = stand.meldungen.length;
      if (stand.status === 'fertig' || stand.status === 'fehler') {
        const s = (Date.now() - t0) / 1000;
        if (stand.status === 'fehler') {
          console.log(`  FEHLER: ${stand.fehler}`);
          ergebnisse.push({ nr: k.nr, sekunden: s, fehler: stand.fehler });
        } else {
          const g = stand.gelaendeId ? JSON.parse(fs.readFileSync(`data/gelaende/${stand.gelaendeId}/gelaende.json`, 'utf8')) : null;
          ergebnisse.push({ nr: k.nr, id: stand.gelaendeId, gebaeude: g?.gebaeude?.length, flaechen: g?.flaechen?.length, sekunden: s });
          console.log(`  fertig in ${s.toFixed(0)} s -> ${stand.gelaendeId} (${g?.gebaeude?.length ?? '?'} Gebaeude, ${g?.flaechen?.length ?? '?'} Flaechen)`);
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    const s = (Date.now() - t0) / 1000;
    console.log(`  FEHLER: ${(e as Error).message}`);
    ergebnisse.push({ nr: k.nr, sekunden: s, fehler: (e as Error).message });
  }
}

console.log('\n=== Ergebnis ===');
const gut = ergebnisse.filter((e) => !e.fehler);
console.log(`${gut.length} von ${ergebnisse.length} Kacheln gebaut, ${(ergebnisse.reduce((s, e) => s + e.sekunden, 0) / 60).toFixed(0)} min.`);
for (const e of ergebnisse) {
  console.log(
    `  ${String(e.nr).padStart(2)}  ${e.fehler ? 'FEHLER: ' + e.fehler.slice(0, 90) : `${e.id}  ${e.gebaeude ?? '?'} Geb, ${e.flaechen ?? '?'} Flaechen`}  (${e.sekunden.toFixed(0)} s)`,
  );
}
if (ergebnisse.some((e) => e.fehler)) {
  console.log('\nGescheiterte Kacheln lassen sich einzeln nachziehen: node scripts/gelaende-stadt.ts --nur <Nr>');
}
