/**
 * Regel-Engine (F8) — deterministisch, ohne KI.
 *
 * Grundsatz aus dem Lastenheft: Die Rechenhoheit liegt HIER. Die KI erklaert
 * nur, was diese Engine ausgerechnet hat. Jede Meldung traegt Ist-Wert,
 * Soll-Wert, Fundstelle und — wo berechenbar — eine konkrete Verschiebung.
 */

import type {
  Blockflaeche,
  ElementRef,
  Einsatzstation,
  Empfehlung,
  Gelaende,
  ObjektInstanz,
  ObjektTyp,
  ProjektInhalt,
  Pruefbericht,
  Pruefergebnis,
  Punkt,
  Regel,
  Regelwerk,
  Ring,
  Schweregrad,
  Weg,
  WegeTyp,
} from '../domain/types.ts';
import { WEGE_TYP_LABEL, STATION_LABEL } from '../domain/types.ts';
import { bezeichnung, grundriss, zugaengeWelt, masseVon } from '../domain/objekte.ts';
import type { Blockierer, Engstelle } from '../geo/geometry.ts';
import {
  abstand,
  abstandPunktPolylinie,
  abstandPunktRing,
  abstandRingPolylinie,
  abstandRingRing,
  bboxVonPunkten,
  durchgangsbreiten,
  engsteStelle,
  himmelsrichtung,
  norm,
  polylinieLaenge,
  punktInRing,
  ringeUeberlappen,
  schwerpunkt,
  sub,
  zahl,
} from '../geo/geometry.ts';

export interface PruefKontext {
  inhalt: ProjektInhalt;
  gelaende: Pick<Gelaende, 'gebaeude' | 'polygon'> | null;
  typen: Map<string, ObjektTyp>;
  regelwerk: Regelwerk;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function ref(art: ElementRef['art'], id: string): ElementRef {
  return { art, id };
}

function fundstelle(r: Regel): string {
  const q = r.quelle;
  const teile = [q.kuerzel, q.paragraf].filter(Boolean);
  return `${r.id} — ${teile.join(' ')}${q.zitat ? ` („${q.zitat}“)` : ''}`;
}

function text(vorlage: string, werte: Record<string, string | number>): string {
  return vorlage.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = werte[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

/**
 * Aufrunden auf Staffelschritte: MVStaettVO bemisst Rettungswegbreiten in
 * Stufen (Mindestbreite + n * Schritt).
 */
export function staffelBreite(personen: number, breiteJeEinheit: number, personenJeEinheit: number, mindest: number, schritt: number): number {
  const roh = (personen / personenJeEinheit) * breiteJeEinheit;
  // schritt = 0 heisst im Regelwerk ausdruecklich „Zwischenwerte zulaessig, es
  // wird nicht aufgerundet“ (so dokumentiert im Meldungstext von R-006/R-007).
  // Ohne diesen Zweig teilt die Staffelung durch 0 und liefert NaN — das stand
  // als „NaN m erforderlich“ im Konformitaetsbericht.
  if (!(schritt > 0)) return +Math.max(mindest, roh).toFixed(2);
  const ueber = Math.max(0, roh - mindest);
  const stufen = Math.ceil(ueber / schritt - 1e-9);
  return +(mindest + stufen * schritt).toFixed(2);
}

function objektRinge(k: PruefKontext): { inst: ObjektInstanz; typ: ObjektTyp; ring: Ring; name: string }[] {
  const out: { inst: ObjektInstanz; typ: ObjektTyp; ring: Ring; name: string }[] = [];
  for (const o of k.inhalt.objekte) {
    const typ = k.typen.get(o.typId);
    if (!typ) continue;
    out.push({ inst: o, typ, ring: grundriss(typ, o), name: bezeichnung(typ, o) });
  }
  return out;
}

function blockiererFuerWeg(k: PruefKontext, weg: Weg): Blockierer[] {
  const liste: Blockierer[] = [];
  for (const o of objektRinge(k)) {
    // Absperrungen und Wegweiser blockieren einen Weg nicht relevant in der Breite,
    // aber Bauzaeune sehr wohl — daher nur echte Durchfahrts-Freigaben ausnehmen.
    if (o.typ.kategorie === 'moeblierung' && o.typ.masse.hoehe < 0.3) continue;
    liste.push({ id: o.inst.id, art: 'objekt', ring: o.ring, bezeichnung: o.name });
  }
  if (k.gelaende) {
    for (const g of k.gelaende.gebaeude) {
      liste.push({ id: g.id, art: 'gebaeude', ring: g.grundriss, bezeichnung: 'Bestandsgebaeude' });
    }
  }
  for (const b of k.inhalt.blockflaechen) {
    if (b.typ === 'gesperrt' && weg.typ !== 'feuerwehrzufahrt') {
      liste.push({ id: b.id, art: 'blockflaeche', ring: b.polygon, bezeichnung: b.name ?? 'Blockflaeche' });
    }
  }
  return liste;
}

function wegeVomTyp(k: PruefKontext, typ: WegeTyp | undefined): Weg[] {
  if (!typ) return k.inhalt.wege;
  return k.inhalt.wege.filter((w) => w.typ === typ);
}

// ---------------------------------------------------------------------------
// Empfehlung: wie weit muss ein Objekt weg, damit die Engstelle verschwindet?
// ---------------------------------------------------------------------------

function empfehlungEngstelle(
  weg: Weg,
  engstelle: Engstelle,
  blockierer: Blockierer[],
  soll: number,
  objekte: { inst: ObjektInstanz; typ: ObjektTyp; ring: Ring; name: string }[],
): Empfehlung | undefined {
  const verursacher = engstelle.verursacher.find((v) => v.art === 'objekt');
  if (!verursacher) {
    return {
      text:
        `Die Engstelle wird nicht durch ein Planungsobjekt verursacht, sondern durch ` +
        `${engstelle.verursacher.map((v) => v.bezeichnung).join(', ') || 'die Wegfuehrung selbst'}. ` +
        `Der Weg muss verlegt oder verbreitert werden.`,
    };
  }
  const objekt = objekte.find((o) => o.inst.id === verursacher.id);
  if (!objekt) return undefined;

  // Richtung: senkrecht vom Wegquerschnitt weg, auf die Seite, auf der das Objekt liegt.
  const mitte: Punkt = [
    (engstelle.schnitt[0][0] + engstelle.schnitt[1][0]) / 2,
    (engstelle.schnitt[0][1] + engstelle.schnitt[1][1]) / 2,
  ];
  const s = schwerpunkt(objekt.ring);
  let richtung = norm(sub(s, mitte));
  if (!Number.isFinite(richtung[0]) || (richtung[0] === 0 && richtung[1] === 0)) {
    richtung = norm(sub(engstelle.schnitt[1], engstelle.schnitt[0]));
  }

  // Binaere Suche: wie weit muss es verschoben werden, bis die Sollbreite frei ist?
  const andere = blockierer.filter((b) => b.id !== objekt.inst.id);
  const teste = (m: number): number => {
    const verschoben: Ring = objekt.ring.map((p) => [p[0] + richtung[0] * m, p[1] + richtung[1] * m]);
    const liste = [...andere, { ...objekt, id: objekt.inst.id, art: 'objekt' as const, ring: verschoben, bezeichnung: objekt.name }];
    const teil = durchgangsbreiten(weg.polylinie, weg.breite, liste, 0.5);
    const e = engsteStelle(teil);
    return e ? e.freieBreite : weg.breite;
  };
  let lo = 0;
  let hi = soll + 2;
  if (teste(hi) < soll - 1e-6) {
    return {
      text:
        `Verschieben allein reicht nicht: auch ${zahl(hi, 1)} m Versatz stellen die Sollbreite ` +
        `von ${zahl(soll, 2)} m nicht her. Objekt entfernen oder Weg verlegen.`,
    };
  }
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (teste(mid) >= soll - 1e-6) hi = mid;
    else lo = mid;
  }
  const meterNoetig = Math.ceil(hi * 100) / 100;
  const hr = himmelsrichtung(richtung[0], richtung[1]);
  return {
    text:
      `${objekt.name} um mindestens ${zahl(meterNoetig, 2)} m nach ${hr} verschieben, ` +
      `dann ist ${weg.name ?? WEGE_TYP_LABEL[weg.typ]} wieder ${zahl(soll, 2)} m breit.`,
    verschiebung: {
      elementId: objekt.inst.id,
      art: 'objekt',
      dE: +(richtung[0] * meterNoetig).toFixed(3),
      dN: +(richtung[1] * meterNoetig).toFixed(3),
      meter: meterNoetig,
      richtung: hr,
    },
  };
}

// ---------------------------------------------------------------------------
// Rettungswegnetz — Laengen entlang der geplanten Wege statt Luftlinie
// ---------------------------------------------------------------------------

interface Knoten {
  p: Punkt;
  nachbarn: { i: number; d: number }[];
}

function baueWegnetz(wege: Weg[], verbindungsToleranz = 2.5): Knoten[] {
  const knoten: Knoten[] = [];
  const finde = (p: Punkt): number => {
    for (let i = 0; i < knoten.length; i++) if (abstand(knoten[i].p, p) <= verbindungsToleranz) return i;
    knoten.push({ p, nachbarn: [] });
    return knoten.length - 1;
  };
  for (const w of wege) {
    let vorher = -1;
    for (const p of w.polylinie) {
      const i = finde(p);
      if (vorher >= 0 && vorher !== i) {
        const d = abstand(knoten[vorher].p, knoten[i].p);
        knoten[vorher].nachbarn.push({ i, d });
        knoten[i].nachbarn.push({ i: vorher, d });
      }
      vorher = i;
    }
  }
  return knoten;
}

function dijkstraVon(knoten: Knoten[], startIdx: number[]): number[] {
  const dist = new Array(knoten.length).fill(Infinity);
  const besucht = new Array(knoten.length).fill(false);
  for (const i of startIdx) dist[i] = 0;
  for (;;) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < knoten.length; i++) if (!besucht[i] && dist[i] < bestD) ((bestD = dist[i]), (best = i));
    if (best < 0) break;
    besucht[best] = true;
    for (const n of knoten[best].nachbarn) {
      const nd = dist[best] + n.d;
      if (nd < dist[n.i]) dist[n.i] = nd;
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Einzelpruefungen
// ---------------------------------------------------------------------------

type Pruefer = (k: PruefKontext, r: Regel, id: () => string) => Pruefergebnis[];

function ergebnis(
  r: Regel,
  id: string,
  status: Pruefergebnis['status'],
  meldung: string,
  ist: number | null,
  soll: number | null,
  einheit: string,
  elemente: ElementRef[],
  ort?: Punkt,
  extra?: Partial<Pruefergebnis>,
): Pruefergebnis {
  const schweregrad: Schweregrad = status === 'verstoss' ? r.schweregrad : 'hinweis';
  return {
    id,
    regelId: r.id,
    regelTitel: r.titel,
    pruefTyp: r.pruefTyp,
    status,
    schweregrad,
    meldung,
    istWert: ist,
    sollWert: soll,
    einheit,
    elemente,
    ort,
    fundstelle: fundstelle(r),
    ...extra,
  };
}

const PRUEFER: Record<string, Pruefer> = {
  // -- Mindestbreite je Wegetyp -------------------------------------------
  wegbreite_min: (k, r, id) => {
    const typ = r.parameter.wegetyp as WegeTyp | undefined;
    const soll = r.schwellwerte.minBreiteM;
    const wege = wegeVomTyp(k, typ);
    if (!wege.length) {
      return [ergebnis(r, id(), 'nicht_pruefbar', `Kein Weg vom Typ „${typ ? WEGE_TYP_LABEL[typ] : 'beliebig'}“ geplant.`, null, soll, 'm', [])];
    }
    return wege.map((w) => {
      const ok = w.breite + 1e-9 >= soll;
      return ergebnis(
        r,
        id(),
        ok ? 'ok' : 'verstoss',
        ok
          ? `${w.name ?? WEGE_TYP_LABEL[w.typ]}: Planbreite ${zahl(w.breite)} m erfuellt die Mindestbreite.`
          : text(r.meldungstext, { element: w.name ?? WEGE_TYP_LABEL[w.typ], ist: zahl(w.breite), soll: zahl(soll), ort: '' }),
        w.breite,
        soll,
        'm',
        [ref('weg', w.id)],
        w.polylinie[0],
        ok
          ? undefined
          : {
              empfehlung: {
                text: `${w.name ?? WEGE_TYP_LABEL[w.typ]} auf mindestens ${zahl(soll)} m verbreitern (aktuell ${zahl(w.breite)} m).`,
              },
            },
      );
    });
  },

  // -- Breitenstaffelung nach Personenzahl --------------------------------
  wegbreite_staffelung: (k, r, id) => {
    const typ = (r.parameter.wegetyp as WegeTyp) ?? 'rettungsweg';
    const s = r.schwellwerte;
    // Konvention des Regelwerks ist `minBreiteM` (wie bei wegbreite_min);
    // `mindestBreiteM` bleibt als Altname lesbar. Ohne diese Zeile las die
    // Pruefung undefined und schrieb „NaN m erforderlich“ in den Bericht.
    const mindest = s.minBreiteM ?? s.mindestBreiteM;
    // schritt 0 = „Zwischenwerte sind zulaessig“ (H-VStaettR), keine Staffelung.
    const schritt = s.staffelSchrittM;
    const wege = wegeVomTyp(k, typ);
    if (!wege.length) return [ergebnis(r, id(), 'nicht_pruefbar', `Kein ${WEGE_TYP_LABEL[typ]} geplant.`, null, null, 'm', [])];
    const out: Pruefergebnis[] = [];
    for (const w of wege) {
      if (w.entfluchtungFuerPersonen && w.entfluchtungFuerPersonen > 0) {
        const soll = staffelBreite(w.entfluchtungFuerPersonen, s.breiteJeEinheitM, s.personenJeEinheit, mindest, schritt);
        const ok = w.breite + 1e-9 >= soll;
        out.push(
          ergebnis(
            r,
            id(),
            ok ? 'ok' : 'verstoss',
            ok
              ? `${w.name ?? WEGE_TYP_LABEL[w.typ]}: ${zahl(w.breite)} m fuer ${w.entfluchtungFuerPersonen} Personen ausreichend (erforderlich ${zahl(soll)} m).`
              : text(r.meldungstext, { element: w.name ?? WEGE_TYP_LABEL[w.typ], ist: zahl(w.breite), soll: zahl(soll), ort: '' }),
            w.breite,
            soll,
            'm',
            [ref('weg', w.id)],
            w.polylinie[0],
            ok ? undefined : { empfehlung: { text: `${w.name ?? 'Weg'} auf ${zahl(soll)} m verbreitern oder die zugeordnete Personenzahl senken.` } },
          ),
        );
      } else {
        // Ohne zugeordnete Personenzahl bleibt nur die Staffelungstreue pruefbar.
        const ueber = w.breite - mindest;
        const stufig =
          ueber >= -1e-9 &&
          (!(schritt > 0) || Math.abs(ueber / schritt - Math.round(ueber / schritt)) < 1e-6);
        out.push(
          ergebnis(
            r,
            id(),
            stufig ? 'ok' : 'nicht_pruefbar',
            stufig
              ? schritt > 0
                ? `${w.name ?? WEGE_TYP_LABEL[w.typ]}: Breite ${zahl(w.breite)} m liegt auf der Staffelung (${zahl(mindest)} m + n x ${zahl(schritt)} m).`
                : `${w.name ?? WEGE_TYP_LABEL[w.typ]}: Breite ${zahl(w.breite)} m erreicht die Mindestbreite ${zahl(mindest)} m; Zwischenwerte sind zulaessig.`
              : `${w.name ?? WEGE_TYP_LABEL[w.typ]}: Breite ${zahl(w.breite)} m unterschreitet die Mindestbreite ${zahl(mindest)} m bzw. liegt nicht auf der Staffelung (n x ${zahl(schritt)} m); ohne zugeordnete Personenzahl nicht abschliessend pruefbar.`,
            w.breite,
            null,
            'm',
            [ref('weg', w.id)],
            w.polylinie[0],
          ),
        );
      }
    }
    return out;
  },

  // -- Engstellen: freie Durchgangsbreite ---------------------------------
  rettungsweg_engstelle: (k, r, id) => {
    const typ = (r.parameter.wegetyp as WegeTyp) ?? 'rettungsweg';
    const toleranz = r.schwellwerte.toleranzM ?? 0;
    const wege = wegeVomTyp(k, typ);
    if (!wege.length) return [ergebnis(r, id(), 'nicht_pruefbar', `Kein ${WEGE_TYP_LABEL[typ]} geplant.`, null, null, 'm', [])];
    const objekte = objektRinge(k);
    const out: Pruefergebnis[] = [];
    for (const w of wege) {
      const blockierer = blockiererFuerWeg(k, w);
      const stellen = durchgangsbreiten(w.polylinie, w.breite, blockierer, 0.5);
      const eng = engsteStelle(stellen);
      if (!eng) continue;
      const soll = w.breite;
      const ok = eng.freieBreite + toleranz + 1e-9 >= soll;
      const wname = w.name ?? WEGE_TYP_LABEL[w.typ];
      out.push(
        ergebnis(
          r,
          id(),
          ok ? 'ok' : 'verstoss',
          ok
            ? `${wname}: freie Durchgangsbreite durchgaengig ${zahl(eng.freieBreite)} m (Planbreite ${zahl(soll)} m).`
            : text(r.meldungstext, {
                element: wname,
                ist: zahl(eng.freieBreite),
                soll: zahl(soll),
                ort: `Station ${zahl(eng.station, 1)} m`,
              }),
          +eng.freieBreite.toFixed(3),
          soll,
          'm',
          [ref('weg', w.id), ...eng.verursacher.filter((v) => v.art === 'objekt').map((v) => ref('objekt', v.id))],
          eng.ort,
          ok
            ? undefined
            : {
                geometrie: [eng.schnitt[0], eng.schnitt[1]],
                empfehlung: empfehlungEngstelle(w, eng, blockierer, soll, objekte),
              },
        ),
      );
    }
    return out;
  },

  // -- Maximale Rettungsweglaenge -----------------------------------------
  rettungsweglaenge_max: (k, r, id) => {
    const maxL = r.schwellwerte.maxLaengeM;
    const rettungswege = k.inhalt.wege.filter((w) => w.typ === 'rettungsweg' || w.typ === 'besucherweg');
    const sichere = k.inhalt.einsatzstationen.filter((s) => s.kategorie === 'sammelplatz' || s.kategorie === 'notausgangspunkt');
    if (!rettungswege.length || !sichere.length) {
      return [
        ergebnis(
          r,
          id(),
          'nicht_pruefbar',
          !rettungswege.length
            ? 'Kein Rettungs-/Besucherweg geplant — Rettungsweglaenge nicht berechenbar.'
            : 'Kein Sammelplatz und kein Notausgangspunkt gesetzt — Rettungsweglaenge nicht berechenbar.',
          null,
          maxL,
          'm',
          [],
        ),
      ];
    }
    const knoten = baueWegnetz(rettungswege);
    if (!knoten.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Wegnetz leer.', null, maxL, 'm', [])];
    // Startknoten = Netzknoten, die nahe an einem sicheren Bereich liegen
    const startIdx: number[] = [];
    for (let i = 0; i < knoten.length; i++) {
      for (const s of sichere) {
        const p = s.punkt ?? (s.polygon ? schwerpunkt(s.polygon) : null);
        if (p && abstand(knoten[i].p, p) <= 15) {
          startIdx.push(i);
          break;
        }
      }
    }
    if (!startIdx.length) {
      return [
        ergebnis(
          r,
          id(),
          'nicht_pruefbar',
          'Kein sicherer Bereich liegt naeher als 15 m am Wegnetz — bitte Sammelplatz an einen Weg legen.',
          null,
          maxL,
          'm',
          sichere.map((s) => ref('einsatzstation', s.id)),
        ),
      ];
    }
    const dist = dijkstraVon(knoten, startIdx);
    const out: Pruefergebnis[] = [];
    for (const o of objektRinge(k)) {
      if (o.typ.kategorie === 'absperrung' || o.typ.kategorie === 'moeblierung') continue;
      const s = schwerpunkt(o.ring);
      // naechster Netzknoten + Restweg dorthin
      let best = Infinity;
      let bestOrt: Punkt | undefined;
      for (let i = 0; i < knoten.length; i++) {
        if (!Number.isFinite(dist[i])) continue;
        const gesamt = dist[i] + abstand(s, knoten[i].p);
        if (gesamt < best) {
          best = gesamt;
          bestOrt = knoten[i].p;
        }
      }
      if (!Number.isFinite(best)) continue;
      const ok = best <= maxL + 1e-9;
      out.push(
        ergebnis(
          r,
          id(),
          ok ? 'ok' : 'verstoss',
          ok
            ? `${o.name}: Rettungsweglaenge ${zahl(best, 1)} m (zulaessig ${zahl(maxL, 1)} m).`
            : text(r.meldungstext, { element: o.name, ist: zahl(best, 1), soll: zahl(maxL, 1), ort: '' }),
          +best.toFixed(1),
          maxL,
          'm',
          [ref('objekt', o.inst.id)],
          bestOrt ?? s,
          ok ? undefined : { empfehlung: { text: `Zusaetzlichen Sammelplatz oder Notausgangspunkt in maximal ${zahl(maxL, 0)} m Wegentfernung von ${o.name} vorsehen.` } },
        ),
      );
    }
    // Nur die kritischen Ergebnisse behalten, sonst wird die Liste unlesbar
    const verstoesse = out.filter((e) => e.status === 'verstoss');
    if (verstoesse.length) return verstoesse;
    const schlimmstes = out.reduce<Pruefergebnis | null>((a, b) => (!a || (b.istWert ?? 0) > (a.istWert ?? 0) ? b : a), null);
    return schlimmstes ? [schlimmstes] : [];
  },

  // -- Abstand Objekt <-> Objekt ------------------------------------------
  abstand_objekt_objekt: (k, r, id) => {
    const min = r.schwellwerte.minAbstandM;
    const katA = (r.parameter.kategorienA as string[]) ?? ['*'];
    const katB = (r.parameter.kategorienB as string[]) ?? ['*'];
    const passt = (kat: string, liste: string[]) => liste.includes('*') || liste.includes(kat);
    const objekte = objektRinge(k);
    const out: Pruefergebnis[] = [];
    for (let i = 0; i < objekte.length; i++) {
      for (let j = i + 1; j < objekte.length; j++) {
        const a = objekte[i];
        const b = objekte[j];
        const relevant =
          (passt(a.typ.kategorie, katA) && passt(b.typ.kategorie, katB)) ||
          (passt(b.typ.kategorie, katA) && passt(a.typ.kategorie, katB));
        if (!relevant) continue;
        const bba = bboxVonPunkten(a.ring);
        const bbb = bboxVonPunkten(b.ring);
        const grob = Math.max(0, Math.max(bba.minE - bbb.maxE, bbb.minE - bba.maxE, bba.minN - bbb.maxN, bbb.minN - bba.maxN));
        const nötig = Math.max(min, a.typ.flaechenbedarfZusatz + b.typ.flaechenbedarfZusatz);
        if (grob > nötig + 1) continue;
        const d = abstandRingRing(a.ring, b.ring);
        if (d + 1e-9 >= nötig) continue;
        const ueberlappt = d <= 1e-9 && ringeUeberlappen(a.ring, b.ring);
        const v = { ...schwerpunktMitte(a.ring, b.ring) };
        out.push(
          ergebnis(
            r,
            id(),
            'verstoss',
            ueberlappt
              ? `${a.name} und ${b.name} ueberlappen sich.`
              : text(r.meldungstext, { element: `${a.name} / ${b.name}`, ist: zahl(d), soll: zahl(nötig), ort: '' }),
            +d.toFixed(3),
            +nötig.toFixed(2),
            'm',
            [ref('objekt', a.inst.id), ref('objekt', b.inst.id)],
            v,
            {
              empfehlung: (() => {
                const t = trennung(a.ring, b.ring, nötig);
                return {
                  text: `${b.name} um ${zahl(t.meter)} m nach ${himmelsrichtung(t.dE, t.dN)} verschieben (Soll-Abstand ${zahl(nötig)} m, aktuell ${zahl(d)} m).`,
                  verschiebung: { elementId: b.inst.id, art: 'objekt' as const, dE: +t.dE.toFixed(3), dN: +t.dN.toFixed(3), meter: +t.meter.toFixed(2), richtung: himmelsrichtung(t.dE, t.dN) },
                };
              })(),
            },
          ),
        );
      }
    }
    if (!out.length) {
      return [ergebnis(r, id(), 'ok', `Alle Objektabstaende erfuellen mindestens ${zahl(min)} m.`, null, min, 'm', [])];
    }
    return out;
  },

  // -- Abstand Objekt <-> Bestandsgebaeude --------------------------------
  abstand_objekt_gebaeude: (k, r, id) => {
    const min = r.schwellwerte.minAbstandM;
    if (!k.gelaende || !k.gelaende.gebaeude.length) {
      return [ergebnis(r, id(), 'nicht_pruefbar', 'Kein Gebaeudebestand im Gelaende geladen.', null, min, 'm', [])];
    }
    const out: Pruefergebnis[] = [];
    for (const o of objektRinge(k)) {
      if (o.typ.kategorie === 'absperrung' || o.typ.kategorie === 'moeblierung') continue;
      const bbo = bboxVonPunkten(o.ring);
      let dMin = Infinity;
      let treffer: { id: string; ring: Ring } | null = null;
      for (const g of k.gelaende.gebaeude) {
        const bbg = bboxVonPunkten(g.grundriss);
        const grob = Math.max(0, Math.max(bbo.minE - bbg.maxE, bbg.minE - bbo.maxE, bbo.minN - bbg.maxN, bbg.minN - bbo.maxN));
        if (grob > min + 1) continue;
        const d = abstandRingRing(o.ring, g.grundriss);
        if (d < dMin) {
          dMin = d;
          treffer = { id: g.id, ring: g.grundriss };
        }
      }
      if (!treffer || dMin + 1e-9 >= min) continue;
      const t = trennung(o.ring, treffer.ring, min);
      out.push(
        ergebnis(
          r,
          id(),
          'verstoss',
          text(r.meldungstext, { element: o.name, ist: zahl(dMin), soll: zahl(min), ort: '' }),
          +dMin.toFixed(3),
          min,
          'm',
          [ref('objekt', o.inst.id)],
          schwerpunkt(o.ring),
          {
            empfehlung: {
              text: `${o.name} um ${zahl(t.meter)} m nach ${himmelsrichtung(t.dE, t.dN)} vom Bestandsgebaeude wegruecken.`,
              verschiebung: { elementId: o.inst.id, art: 'objekt', dE: +t.dE.toFixed(3), dN: +t.dN.toFixed(3), meter: +t.meter.toFixed(2), richtung: himmelsrichtung(t.dE, t.dN) },
            },
          },
        ),
      );
    }
    if (!out.length) return [ergebnis(r, id(), 'ok', `Alle Objekte halten mindestens ${zahl(min)} m zum Gebaeudebestand.`, null, min, 'm', [])];
    return out;
  },

  // -- Feuerwehrzufahrt: lichte Breite ------------------------------------
  feuerwehrzufahrt_breite: (k, r, id) => {
    const soll = r.schwellwerte.minBreiteM;
    const wege = wegeVomTyp(k, 'feuerwehrzufahrt');
    if (!wege.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Feuerwehrzufahrt geplant.', null, soll, 'm', [])];
    const objekte = objektRinge(k);
    return wege.map((w) => {
      const blockierer = blockiererFuerWeg(k, w);
      const stellen = durchgangsbreiten(w.polylinie, Math.max(w.breite, soll), blockierer, 0.5);
      const eng = engsteStelle(stellen);
      const ist = eng ? Math.min(eng.freieBreite, w.breite) : w.breite;
      const ok = ist + 1e-9 >= soll;
      const wname = w.name ?? 'Feuerwehrzufahrt';
      return ergebnis(
        r,
        id(),
        ok ? 'ok' : 'verstoss',
        ok
          ? `${wname}: lichte Breite durchgaengig ${zahl(ist)} m.`
          : text(r.meldungstext, { element: wname, ist: zahl(ist), soll: zahl(soll), ort: eng ? `Station ${zahl(eng.station, 1)} m` : '' }),
        +ist.toFixed(3),
        soll,
        'm',
        [ref('weg', w.id), ...(eng?.verursacher.filter((v) => v.art === 'objekt').map((v) => ref('objekt', v.id)) ?? [])],
        eng?.ort ?? w.polylinie[0],
        ok || !eng ? undefined : { geometrie: [eng.schnitt[0], eng.schnitt[1]], empfehlung: empfehlungEngstelle(w, eng, blockierer, soll, objekte) },
      );
    });
  },

  // -- Feuerwehrzufahrt: lichte Hoehe -------------------------------------
  feuerwehrzufahrt_hoehe: (k, r, id) => {
    const soll = r.schwellwerte.minHoeheM;
    const wege = wegeVomTyp(k, 'feuerwehrzufahrt');
    if (!wege.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Feuerwehrzufahrt geplant.', null, soll, 'm', [])];
    return wege.map((w) => {
      const wname = w.name ?? 'Feuerwehrzufahrt';
      if (w.lichteHoehe === undefined || w.lichteHoehe === null) {
        return ergebnis(r, id(), 'nicht_pruefbar', `${wname}: lichte Hoehe nicht angegeben (k. A.). Bitte am Weg eintragen.`, null, soll, 'm', [ref('weg', w.id)], w.polylinie[0]);
      }
      const ok = w.lichteHoehe + 1e-9 >= soll;
      return ergebnis(
        r,
        id(),
        ok ? 'ok' : 'verstoss',
        ok ? `${wname}: lichte Hoehe ${zahl(w.lichteHoehe)} m.` : text(r.meldungstext, { element: wname, ist: zahl(w.lichteHoehe), soll: zahl(soll), ort: '' }),
        w.lichteHoehe,
        soll,
        'm',
        [ref('weg', w.id)],
        w.polylinie[0],
        ok ? undefined : { empfehlung: { text: `Ueberbauung/Ueberspannung ueber ${wname} auf mindestens ${zahl(soll)} m anheben oder entfernen.` } },
      );
    });
  },

  // -- Erreichbarkeit aller Objekte durch die Feuerwehr -------------------
  feuerwehr_erreichbarkeit: (k, r, id) => {
    const max = r.schwellwerte.maxDistanzM;
    const zufahrten = wegeVomTyp(k, 'feuerwehrzufahrt');
    if (!zufahrten.length) {
      return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Feuerwehrzufahrt geplant — Erreichbarkeit nicht pruefbar.', null, max, 'm', [])];
    }
    const out: Pruefergebnis[] = [];
    for (const o of objektRinge(k)) {
      if (o.typ.kategorie === 'absperrung' || o.typ.kategorie === 'moeblierung') continue;
      let d = Infinity;
      for (const w of zufahrten) d = Math.min(d, abstandRingPolylinie(o.ring, w.polylinie));
      const ok = d <= max + 1e-9;
      if (!ok) {
        out.push(
          ergebnis(r, id(), 'verstoss', text(r.meldungstext, { element: o.name, ist: zahl(d, 1), soll: zahl(max, 1), ort: '' }), +d.toFixed(1), max, 'm', [ref('objekt', o.inst.id)], schwerpunkt(o.ring), {
            empfehlung: { text: `Feuerwehrzufahrt bis auf ${zahl(max, 0)} m an ${o.name} heranfuehren oder das Objekt naeher an eine Zufahrt legen (aktuell ${zahl(d, 1)} m).` },
          }),
        );
      }
    }
    if (!out.length) return [ergebnis(r, id(), 'ok', `Alle Objekte liegen hoechstens ${zahl(max, 0)} m von einer Feuerwehrzufahrt entfernt.`, null, max, 'm', [])];
    return out;
  },

  // -- Bewegungsflaeche 7 x 12 m ------------------------------------------
  feuerwehr_bewegungsflaeche: (k, r, id) => {
    const minL = r.schwellwerte.minLaengeM;
    const minB = r.schwellwerte.minBreiteM;
    const flaechen = wegeVomTyp(k, 'feuerwehrbewegungsflaeche');
    const objekteBF = objektRinge(k).filter((o) => o.typ.id.includes('bewegungsflaeche'));
    if (!flaechen.length && !objekteBF.length) {
      return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Feuerwehr-Bewegungsflaeche geplant.', null, minL, 'm', [])];
    }
    const out: Pruefergebnis[] = [];
    for (const w of flaechen) {
      const l = polylinieLaenge(w.polylinie);
      const okL = l + 1e-9 >= minL;
      const okB = w.breite + 1e-9 >= minB;
      const ok = okL && okB;
      out.push(
        ergebnis(
          r,
          id(),
          ok ? 'ok' : 'verstoss',
          ok
            ? `${w.name ?? 'Bewegungsflaeche'}: ${zahl(l, 1)} m x ${zahl(w.breite)} m.`
            : text(r.meldungstext, { element: w.name ?? 'Bewegungsflaeche', ist: `${zahl(l, 1)} x ${zahl(w.breite)}`, soll: `${zahl(minL, 1)} x ${zahl(minB)}`, ort: '' }),
          okL ? w.breite : l,
          okL ? minB : minL,
          'm',
          [ref('weg', w.id)],
          w.polylinie[0],
        ),
      );
    }
    for (const o of objekteBF) {
      const m = masseVon(o.typ, o.inst);
      const ok = Math.max(m.laenge, m.breite) + 1e-9 >= minL && Math.min(m.laenge, m.breite) + 1e-9 >= minB;
      out.push(
        ergebnis(
          r,
          id(),
          ok ? 'ok' : 'verstoss',
          ok ? `${o.name}: ${zahl(m.laenge)} m x ${zahl(m.breite)} m.` : text(r.meldungstext, { element: o.name, ist: `${zahl(m.laenge)} x ${zahl(m.breite)}`, soll: `${zahl(minL)} x ${zahl(minB)}`, ort: '' }),
          Math.min(m.laenge, m.breite),
          minB,
          'm',
          [ref('objekt', o.inst.id)],
          o.inst.position,
        ),
      );
    }
    return out;
  },

  // -- Ein-/Ausstiege muessen an einem Weg liegen -------------------------
  einausstieg_wegangebunden: (k, r, id) => {
    const max = r.schwellwerte.maxDistanzM;
    const wege = k.inhalt.wege.filter((w) => w.typ === 'besucherweg' || w.typ === 'rettungsweg');
    const objekte = objektRinge(k);
    const mitZugang = objekte.filter((o) => o.typ.einAusstiege.length > 0);
    if (!mitZugang.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Objekte mit Ein-/Ausstiegen geplant.', null, max, 'm', [])];
    if (!wege.length) {
      return [
        ergebnis(
          r,
          id(),
          'verstoss',
          `Kein Besucher- oder Rettungsweg geplant — ${mitZugang.length} Objekte mit Ein-/Ausstiegen sind nicht angebunden.`,
          null,
          max,
          'm',
          mitZugang.map((o) => ref('objekt', o.inst.id)),
          mitZugang[0].inst.position,
          { empfehlung: { text: 'Mindestens einen Besucherweg anlegen und an die Ein-/Ausstiege heranfuehren.' } },
        ),
      ];
    }
    const out: Pruefergebnis[] = [];
    for (const o of mitZugang) {
      for (const z of zugaengeWelt(o.typ, o.inst)) {
        let d = Infinity;
        let nahesterWeg: Weg | null = null;
        for (const w of wege) {
          // Abstand bis zum RAND des Wegkorridors, nicht bis zur Achse
          const dAchse = abstandPunktPolylinie(z.anschlussPunkt, w.polylinie);
          const dRand = Math.max(0, dAchse - w.breite / 2);
          if (dRand < d) {
            d = dRand;
            nahesterWeg = w;
          }
        }
        const ok = d <= max + 1e-9;
        const label = `${o.name} — ${z.typ === 'einstieg' ? 'Einstieg' : z.typ === 'ausstieg' ? 'Ausstieg' : 'Notausgang'} ${z.index + 1}`;
        out.push(
          ergebnis(
            r,
            id(),
            ok ? 'ok' : 'verstoss',
            ok
              ? `${label}: an ${nahesterWeg?.name ?? WEGE_TYP_LABEL[nahesterWeg!.typ]} angebunden (${zahl(d)} m).`
              : text(r.meldungstext, { element: label, ist: zahl(d), soll: zahl(max), ort: '' }),
            +d.toFixed(2),
            max,
            'm',
            [ref('objekt', o.inst.id)],
            z.welt,
            ok ? undefined : { empfehlung: { text: `Weg bis auf ${zahl(max)} m an ${label} heranfuehren (Luecke ${zahl(d - max)} m) oder das Objekt drehen, sodass der Zugang zum Weg zeigt.` } },
          ),
        );
      }
    }
    const verstoesse = out.filter((e) => e.status === 'verstoss');
    return verstoesse.length ? verstoesse : [ergebnis(r, id(), 'ok', `Alle ${out.length} Ein-/Ausstiege sind an einen Weg angebunden.`, null, max, 'm', [])];
  },

  // -- Gesamtkapazitaet gegen Summe der Rettungswegbreiten ----------------
  kapazitaet_vs_wegbreite: (k, r, id) => {
    const s = r.schwellwerte;
    const personen = k.inhalt.projekt.maxBesucher;
    const rettungswege = k.inhalt.wege.filter((w) => w.typ === 'rettungsweg');
    const summe = rettungswege.reduce((a, w) => a + w.breite, 0);
    const soll = staffelBreite(personen, s.breiteJeEinheitM, s.personenJeEinheit, s.breiteJeEinheitM, s.breiteJeEinheitM);
    if (!rettungswege.length) {
      return [
        ergebnis(r, id(), 'verstoss', `Kein Rettungsweg geplant. Fuer ${personen.toLocaleString('de-DE')} Besucher sind rechnerisch ${zahl(soll)} m Gesamtbreite erforderlich.`, 0, soll, 'm', [], undefined, {
          empfehlung: { text: `Rettungswege mit zusammen mindestens ${zahl(soll)} m Breite anlegen (z. B. ${Math.ceil(soll / 3)} Wege a 3,00 m).` },
        }),
      ];
    }
    const ok = summe + 1e-9 >= soll;
    return [
      ergebnis(
        r,
        id(),
        ok ? 'ok' : 'verstoss',
        ok
          ? `Rettungswegbreiten zusammen ${zahl(summe)} m fuer ${personen.toLocaleString('de-DE')} Besucher (erforderlich ${zahl(soll)} m).`
          : text(r.meldungstext, { element: `${rettungswege.length} Rettungswege`, ist: zahl(summe), soll: zahl(soll), ort: '' }),
        +summe.toFixed(2),
        soll,
        'm',
        rettungswege.map((w) => ref('weg', w.id)),
        rettungswege[0].polylinie[0],
        ok
          ? undefined
          : {
              empfehlung: {
                text: `Es fehlen ${zahl(soll - summe)} m Rettungswegbreite. Entweder Wege verbreitern oder ${Math.ceil((soll - summe) / 3)} weitere Rettungswege a 3,00 m anlegen — oder die Besucherzahl auf ${Math.floor((summe / s.breiteJeEinheitM) * s.personenJeEinheit).toLocaleString('de-DE')} begrenzen.`,
              },
            },
      ),
    ];
  },

  // -- Einsatzstationen erreichbar ----------------------------------------
  einsatzstation_erreichbarkeit: (k, r, id) => {
    const max = r.schwellwerte.maxDistanzM;
    const kategorien = (r.parameter.kategorien as string[]) ?? ['sanitaet', 'feuerwehr', 'einsatzleitung'];
    const zufahrten = wegeVomTyp(k, 'feuerwehrzufahrt');
    const stationen = k.inhalt.einsatzstationen.filter((s) => kategorien.includes(s.kategorie));
    if (!stationen.length) return [ergebnis(r, id(), 'nicht_pruefbar', `Keine Einsatzstationen der Kategorien ${kategorien.join(', ')} gesetzt.`, null, max, 'm', [])];
    if (!zufahrten.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Feuerwehrzufahrt geplant — Erreichbarkeit der Einsatzstationen nicht pruefbar.', null, max, 'm', stationen.map((s) => ref('einsatzstation', s.id)))];
    const out: Pruefergebnis[] = [];
    for (const st of stationen) {
      const p = st.punkt ?? (st.polygon ? schwerpunkt(st.polygon) : null);
      if (!p) continue;
      let d = Infinity;
      for (const w of zufahrten) d = Math.min(d, Math.max(0, abstandPunktPolylinie(p, w.polylinie) - w.breite / 2));
      const ok = d <= max + 1e-9;
      out.push(
        ergebnis(
          r,
          id(),
          ok ? 'ok' : 'verstoss',
          ok
            ? `${STATION_LABEL[st.kategorie]} „${st.name}“: ${zahl(d, 1)} m bis zur naechsten Feuerwehrzufahrt.`
            : text(r.meldungstext, { element: `${STATION_LABEL[st.kategorie]} „${st.name}“`, ist: zahl(d, 1), soll: zahl(max, 1), ort: '' }),
          +d.toFixed(1),
          max,
          'm',
          [ref('einsatzstation', st.id)],
          p,
          ok ? undefined : { empfehlung: { text: `${st.name} um mindestens ${zahl(d - max, 1)} m naeher an eine Feuerwehrzufahrt legen.` } },
        ),
      );
    }
    return out;
  },

  // -- Blockflaechen muessen frei bleiben ---------------------------------
  blockflaeche_frei: (k, r, id) => {
    const typen = (r.parameter.typen as string[]) ?? ['gesperrt', 'nur_einsatzkraefte'];
    const flaechen = k.inhalt.blockflaechen.filter((b) => typen.includes(b.typ));
    if (!flaechen.length) return [ergebnis(r, id(), 'nicht_pruefbar', 'Keine Blockflaechen der geprueften Typen vorhanden.', null, null, 'm', [])];
    const out: Pruefergebnis[] = [];
    for (const b of flaechen) {
      for (const o of objektRinge(k)) {
        if (o.typ.kategorie === 'einsatz' && b.typ === 'nur_einsatzkraefte') continue;
        if (!ringeUeberlappen(o.ring, b.polygon)) continue;
        out.push(
          ergebnis(
            r,
            id(),
            'verstoss',
            text(r.meldungstext, { element: o.name, ist: '0,00', soll: zahl(r.schwellwerte.toleranzM ?? 0), ort: b.name ?? b.typ }),
            0,
            r.schwellwerte.toleranzM ?? 0,
            'm',
            [ref('objekt', o.inst.id), ref('blockflaeche', b.id)],
            schwerpunkt(o.ring),
            {
              geometrie: b.polygon,
              empfehlung: (() => {
                const t = trennung(o.ring, b.polygon, 0.5);
                return {
                  text: `${o.name} aus der Blockflaeche „${b.name ?? b.typ}“ entfernen — mindestens ${zahl(t.meter)} m nach ${himmelsrichtung(t.dE, t.dN)}. Begruendung der Sperrung: ${b.begruendung || 'k. A.'}`,
                  verschiebung: { elementId: o.inst.id, art: 'objekt' as const, dE: +t.dE.toFixed(3), dN: +t.dN.toFixed(3), meter: +t.meter.toFixed(2), richtung: himmelsrichtung(t.dE, t.dN) },
                };
              })(),
            },
          ),
        );
      }
    }
    if (!out.length) return [ergebnis(r, id(), 'ok', `Alle ${flaechen.length} Blockflaechen sind frei von Aufbauten.`, null, null, 'm', flaechen.map((b) => ref('blockflaeche', b.id)))];
    return out;
  },
};

// Kleine Helfer, die von mehreren Pruefern gebraucht werden
function schwerpunktMitte(a: Ring, b: Ring): Punkt {
  const sa = schwerpunkt(a);
  const sb = schwerpunkt(b);
  return [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
}

function trennung(a: Ring, b: Ring, soll: number): { dE: number; dN: number; meter: number } {
  const sa = schwerpunkt(a);
  const sb = schwerpunkt(b);
  let richtung = norm(sub(sa, sb));
  if (richtung[0] === 0 && richtung[1] === 0) richtung = [0, 1];
  let lo = 0;
  let hi = soll + abstandRingRing(a, b) + Math.max(...a.map((p) => abstand(p, sa))) + 1;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    const v: Ring = a.map((p) => [p[0] + richtung[0] * mid, p[1] + richtung[1] * mid]);
    if (abstandRingRing(v, b) + 1e-6 >= soll) hi = mid;
    else lo = mid;
  }
  return { dE: richtung[0] * hi, dN: richtung[1] * hi, meter: hi };
}

// ---------------------------------------------------------------------------
// Oeffentliche Schnittstelle
// ---------------------------------------------------------------------------

export function pruefe(k: PruefKontext, nurRegelIds?: string[]): Pruefbericht {
  let zaehler = 0;
  const naechsteId = () => `E${String(++zaehler).padStart(4, '0')}`;
  const ergebnisse: Pruefergebnis[] = [];

  for (const regel of k.regelwerk.regeln) {
    if (regel.aktiv === false) continue;
    if (nurRegelIds && !nurRegelIds.includes(regel.id)) continue;
    const pruefer = PRUEFER[regel.pruefTyp];
    if (!pruefer) {
      ergebnisse.push(ergebnis(regel, naechsteId(), 'nicht_pruefbar', `Pruefart „${regel.pruefTyp}“ ist in dieser Version nicht implementiert.`, null, null, '', []));
      continue;
    }
    try {
      ergebnisse.push(...pruefer(k, regel, naechsteId));
    } catch (e) {
      ergebnisse.push(
        ergebnis(regel, naechsteId(), 'nicht_pruefbar', `Pruefung fehlgeschlagen: ${(e as Error).message}`, null, null, '', []),
      );
    }
  }

  // Verstoesse zuerst, danach nach Schweregrad
  const rang: Record<string, number> = { fehler: 0, warnung: 1, hinweis: 2 };
  ergebnisse.sort((a, b) => {
    if (a.status !== b.status) {
      const s: Record<string, number> = { verstoss: 0, nicht_pruefbar: 1, ok: 2 };
      return s[a.status] - s[b.status];
    }
    return rang[a.schweregrad] - rang[b.schweregrad];
  });

  const zusammenfassung = {
    fehler: ergebnisse.filter((e) => e.status === 'verstoss' && e.schweregrad === 'fehler').length,
    warnungen: ergebnisse.filter((e) => e.status === 'verstoss' && e.schweregrad === 'warnung').length,
    hinweise: ergebnisse.filter((e) => e.status === 'verstoss' && e.schweregrad === 'hinweis').length,
    ok: ergebnisse.filter((e) => e.status === 'ok').length,
    nichtPruefbar: ergebnisse.filter((e) => e.status === 'nicht_pruefbar').length,
  };

  return {
    projektId: k.inhalt.projekt.id,
    regelwerkId: k.regelwerk.id,
    regelwerkVersion: k.regelwerk.version,
    zeit: new Date().toISOString(),
    ergebnisse,
    zusammenfassung,
    haftungshinweis: k.regelwerk.haftungshinweis,
  };
}

/**
 * Kollisions- und Abstandsanzeige fuer den Editor (F2.6) — schnell, ohne
 * das volle Regelwerk. Liefert je Objekt einen Status.
 */
export function editorStatus(k: PruefKontext, minAbstand = 0): Map<string, 'ok' | 'kollision' | 'zu_nah'> {
  const objekte = objektRinge(k);
  const status = new Map<string, 'ok' | 'kollision' | 'zu_nah'>();
  for (const o of objekte) status.set(o.inst.id, 'ok');
  for (let i = 0; i < objekte.length; i++) {
    for (let j = i + 1; j < objekte.length; j++) {
      const a = objekte[i];
      const b = objekte[j];
      const noetig = Math.max(minAbstand, a.typ.flaechenbedarfZusatz + b.typ.flaechenbedarfZusatz);
      const d = abstandRingRing(a.ring, b.ring);
      if (d <= 1e-9) {
        status.set(a.inst.id, 'kollision');
        status.set(b.inst.id, 'kollision');
      } else if (d < noetig) {
        if (status.get(a.inst.id) !== 'kollision') status.set(a.inst.id, 'zu_nah');
        if (status.get(b.inst.id) !== 'kollision') status.set(b.inst.id, 'zu_nah');
      }
    }
  }
  if (k.gelaende) {
    for (const o of objekte) {
      if (status.get(o.inst.id) === 'kollision') continue;
      for (const g of k.gelaende.gebaeude) {
        if (ringeUeberlappen(o.ring, g.grundriss)) {
          status.set(o.inst.id, 'kollision');
          break;
        }
      }
    }
  }
  for (const b of k.inhalt.blockflaechen) {
    for (const o of objekte) {
      if (b.typ === 'nur_einsatzkraefte' && o.typ.kategorie === 'einsatz') continue;
      if (ringeUeberlappen(o.ring, b.polygon)) status.set(o.inst.id, 'kollision');
    }
  }
  return status;
}

/** Nur die Engstellen — fuer die Live-Anzeige am Weg. */
export function wegEngstellen(k: PruefKontext, weg: Weg): Engstelle[] {
  return durchgangsbreiten(weg.polylinie, weg.breite, blockiererFuerWeg(k, weg), 0.5);
}

export { blockiererFuerWeg };
