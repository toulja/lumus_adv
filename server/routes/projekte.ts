import { Router } from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import type {
  Blockflaeche,
  Einsatzstation,
  ElementRef,
  Nutzer,
  ObjektInstanz,
  Projekt,
  ProjektInhalt,
  ProjektUebersicht,
  Rolle,
  Weg,
} from '../../shared/domain/types.ts';
import { WEGE_TYPEN, STATIONS_KATEGORIEN } from '../../shared/domain/types.ts';
import { bezeichnung, masseGueltig } from '../../shared/domain/objekte.ts';
import { polylinieLaenge } from '../../shared/geo/geometry.ts';
import { gelaende as gelaendeStore, id, jetzt, mitgliedschaften, nutzer as nutzerTabelle, objekttypenEigen, organisationen, projekte, snapshots } from '../lib/store.ts';
import { darf, darfObjektAendern, darfWegAendern, felderFiltern, rolleFuer, sichtbareProjekte } from '../lib/rechte.ts';
import { EingabeFehler, pruefeGeometriePatch, pruefeMeter, pruefePunkt, pruefePunktfolge } from '../lib/eingabe.ts';
import { benachrichtigen, protokollieren } from '../lib/ereignis.ts';
import { typenIndex } from '../lib/kataloge.ts';
import * as hub from '../realtime/hub.ts';
import { letzterBericht } from './pruefung.ts';

const router = Router();

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

export interface ProjektKontext {
  projekt: Projekt;
  inhalt: ProjektInhalt;
  rolle: Rolle;
  nutzer: Nutzer;
}

export function projektKontext(req: AuthRequest, res: Response): ProjektKontext | null {
  const pid = req.params.id ?? req.params.pid;
  const projekt = projekte.finde(pid);
  if (!projekt) {
    res.status(404).json({ fehler: 'Projekt nicht gefunden.' });
    return null;
  }
  const rolle = rolleFuer(req.nutzer!, projekt);
  if (!rolle) {
    res.status(403).json({ fehler: 'Kein Zugriff auf dieses Projekt.' });
    return null;
  }
  return { projekt, inhalt: projekte.inhalt(pid)!, rolle, nutzer: req.nutzer! };
}

/**
 * Fuehrt eine Eingabepruefung aus und beantwortet einen Verstoss mit 400.
 * Rueckgabe `false` heisst: die Antwort ist bereits geschrieben, die Route
 * muss abbrechen.
 */
function eingabeOk(res: Response, pruefung: () => void): boolean {
  try {
    pruefung();
    return true;
  } catch (e) {
    if (e instanceof EingabeFehler) {
      res.status(400).json({ fehler: e.message });
      return false;
    }
    throw e;
  }
}

function sperrePruefen(res: Response, pid: string, ref: ElementRef, nutzerId: string): boolean {
  const s = hub.darfSchreiben(pid, ref, nutzerId);
  if (!s.ok) {
    res.status(423).json({ fehler: s.grund });
    return false;
  }
  return true;
}

function rechteAntwort(rolle: Rolle) {
  return {
    rolle,
    darf: {
      projektAendern: darf(rolle, 'projekt.aendern'),
      elementAnlegen: darf(rolle, 'element.anlegen'),
      elementAendern: darf(rolle, 'element.aendern'),
      elementLoeschen: darf(rolle, 'element.loeschen'),
      feuerwehrflaeche: darf(rolle, 'feuerwehrflaeche.aendern'),
      zuweisen: darf(rolle, 'zuweisen'),
      einladen: darf(rolle, 'einladen'),
      snapshotAnlegen: darf(rolle, 'snapshot.anlegen'),
      einreichen: darf(rolle, 'einreichen'),
      freigabeSetzen: darf(rolle, 'freigabe.setzen'),
      kommentieren: darf(rolle, 'kommentar.schreiben'),
      berichte: darf(rolle, 'bericht.erzeugen'),
      betreiberliste: darf(rolle, 'betreiberliste.lesen'),
      kontaktdaten: darf(rolle, 'kontaktdaten.sehen'),
      ki: darf(rolle, 'ki.nutzen'),
      objekttypAnlegen: darf(rolle, 'objekttyp.anlegen'),
    },
  };
}

// ---------------------------------------------------------------------------
// Projekte
// ---------------------------------------------------------------------------

router.get('/', anmeldungNoetig, (req: AuthRequest, res) => {
  const typen = typenIndex();
  const uebersicht: ProjektUebersicht[] = sichtbareProjekte(req.nutzer!, projekte.liste()).map(({ projekt, rolle }) => {
    const inhalt = projekte.inhalt(projekt.id)!;
    const snaps = snapshots.liste(projekt.id);
    const letzter = snaps[0];
    const freigaben = projekte.freigaben(projekt.id).filter((f) => f.snapshotId === letzter?.id);
    const bericht = letzterBericht(projekt.id);
    return {
      projekt,
      gelaendeName: gelaendeStore.laden(projekt.gelaendeId)?.name ?? 'k. A.',
      veranstalterName: organisationen.finde(projekt.veranstalterOrgId)?.name ?? 'k. A.',
      rolle,
      objekteAnzahl: inhalt.objekte.length,
      letzterSnapshot: letzter
        ? { id: letzter.id, name: letzter.name, zeit: letzter.zeit, status: freigaben[0]?.status ?? 'offen' }
        : undefined,
      offeneFehler: bericht?.zusammenfassung.fehler ?? 0,
    };
  });
  void typen;
  res.json(uebersicht);
});

router.post('/', anmeldungNoetig, (req: AuthRequest, res) => {
  const org = organisationen.finde(req.nutzer!.orgId);
  if (org?.typ !== 'veranstalter' && org?.typ !== 'plattform') {
    res.status(403).json({ fehler: 'Nur Veranstalter koennen Projekte anlegen.' });
    return;
  }
  const b = req.body as Partial<Projekt>;
  if (!b.name || !b.gelaendeId) {
    res.status(400).json({ fehler: 'Name und Gelaende sind erforderlich.' });
    return;
  }
  if (!gelaendeStore.laden(b.gelaendeId)) {
    res.status(400).json({ fehler: 'Das angegebene Gelaende existiert nicht.' });
    return;
  }
  const maxBesucher = Number(b.maxBesucher);
  if (!Number.isFinite(maxBesucher) || maxBesucher <= 0) {
    res.status(400).json({ fehler: 'Bitte die erwartete maximale Besucherzahl angeben — sie ist Grundlage der Regelpruefung.' });
    return;
  }
  const projekt: Projekt = {
    id: id('prj_'),
    gelaendeId: b.gelaendeId,
    veranstalterOrgId: req.nutzer!.orgId,
    name: b.name,
    zeitraumVon: b.zeitraumVon ?? jetzt().slice(0, 10),
    zeitraumBis: b.zeitraumBis ?? jetzt().slice(0, 10),
    maxBesucher,
    status: 'entwurf',
    regelwerkId: b.regelwerkId ?? 'he-mvstaettvo',
    beschreibung: b.beschreibung,
    erstelltAm: jetzt(),
    erstelltVon: req.nutzer!.id,
    geaendertAm: jetzt(),
  };
  projekte.anlegen({ projekt, objekte: [], wege: [], blockflaechen: [], einsatzstationen: [] });
  mitgliedschaften.setzen({
    projektId: projekt.id,
    orgId: req.nutzer!.orgId,
    rolle: 'veranstalter',
    automatisch: true,
    eingeladenAm: jetzt(),
  });
  protokollieren({
    projektId: projekt.id,
    nutzer: req.nutzer!,
    orgId: req.nutzer!.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'projekt', id: projekt.id },
    bezeichnung: projekt.name,
    nachher: projekt,
  });
  res.status(201).json(projekt);
});

router.get('/:id', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const g = gelaendeStore.laden(k.projekt.gelaendeId);
  res.json({
    ...k.inhalt,
    ...rechteAntwort(k.rolle),
    gelaende: g ? { id: g.id, name: g.name, bbox: g.bbox, hoeheMittel: g.hoeheMittel, hoehenHerkunft: g.hoehenHerkunft, quellennachweis: g.quellennachweis } : null,
    veranstalter: organisationen.finde(k.projekt.veranstalterOrgId) ?? null,
    beteiligte: mitgliedschaften.fuerProjekt(k.projekt.id).map((m) => ({
      ...m,
      orgName: organisationen.finde(m.orgId)?.name ?? 'k. A.',
      orgTyp: organisationen.finde(m.orgId)?.typ ?? null,
    })),
    letzteSeq: projekte.letzteSeq(k.projekt.id),
  });
});

router.patch('/:id', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'projekt.aendern')) {
    res.status(403).json({ fehler: 'Diese Rolle darf die Projektdaten nicht aendern.' });
    return;
  }
  const erlaubt = ['name', 'zeitraumVon', 'zeitraumBis', 'maxBesucher', 'beschreibung', 'regelwerkId', 'status'] as const;
  const vorher = { ...k.projekt };
  for (const f of erlaubt) {
    if (f in req.body) (k.projekt as unknown as Record<string, unknown>)[f] = (req.body as Record<string, unknown>)[f];
  }
  if (!(k.projekt.maxBesucher > 0)) {
    Object.assign(k.projekt, vorher);
    res.status(400).json({ fehler: 'Die maximale Besucherzahl muss groesser als 0 sein.' });
    return;
  }
  projekte.speichern(k.projekt.id, true);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'projekt', id: k.projekt.id },
    bezeichnung: k.projekt.name,
    vorher,
    nachher: k.projekt,
    nutzlast: { projekt: k.projekt },
  });
  res.json(k.projekt);
});

router.delete('/:id', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'projekt.loeschen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf das Projekt nicht loeschen.' });
    return;
  }
  projekte.loeschen(k.projekt.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Beteiligte / Einladungen
// ---------------------------------------------------------------------------

router.post('/:id/einladen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'einladen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf niemanden einladen.' });
    return;
  }
  const { orgId, rolle } = req.body as { orgId?: string; rolle?: Rolle };
  const org = orgId ? organisationen.finde(orgId) : null;
  if (!org || !rolle) {
    res.status(400).json({ fehler: 'Organisation und Rolle sind erforderlich.' });
    return;
  }
  if (org.typ === 'polizei') {
    res.status(400).json({ fehler: 'Polizei-Organisationen haben ohnehin organisationsweiten Lesezugriff — eine Einladung ist nicht noetig.' });
    return;
  }
  mitgliedschaften.setzen({
    projektId: k.projekt.id,
    orgId: org.id,
    rolle,
    automatisch: false,
    eingeladenVon: k.nutzer.id,
    eingeladenAm: jetzt(),
  });
  benachrichtigen({
    nutzerIds: nutzerTabelle.suche((n) => n.orgId === org.id).map((n) => n.id),
    projektId: k.projekt.id,
    art: 'einladung',
    titel: `Einladung: ${k.projekt.name}`,
    text: `${k.nutzer.name} hat ${org.name} als ${rolle} zum Projekt „${k.projekt.name}“ eingeladen.`,
    link: `/projekt/${k.projekt.id}`,
  });
  res.json({ ok: true, orgId: org.id, rolle });
});

router.delete('/:id/beteiligte/:orgId', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'einladen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf Beteiligte nicht entfernen.' });
    return;
  }
  if (req.params.orgId === k.projekt.veranstalterOrgId) {
    res.status(400).json({ fehler: 'Der Veranstalter kann nicht entfernt werden.' });
    return;
  }
  mitgliedschaften.entfernen(k.projekt.id, req.params.orgId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Objekte
// ---------------------------------------------------------------------------

router.post('/:id/objekte', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.anlegen') || k.rolle === 'feuerwehr') {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Objekte platzieren.' });
    return;
  }
  const b = req.body as Partial<ObjektInstanz>;
  const typ = b.typId ? typenIndex().get(b.typId) : undefined;
  if (!typ) {
    res.status(400).json({ fehler: `Unbekannter Objekttyp „${b.typId ?? ''}“.` });
    return;
  }
  let position: [number, number] = [0, 0];
  let hoehe = 0;
  if (
    !eingabeOk(res, () => {
      position = pruefePunkt(b.position, 'position') as [number, number];
      const h = Number(b.hoeheUeberGelaende ?? 0);
      if (!Number.isFinite(h) || Math.abs(h) > 10_000) {
        throw new EingabeFehler('hoeheUeberGelaende: Bitte eine Hoehe in Metern angeben.');
      }
      hoehe = h;
    })
  ) {
    return;
  }
  if (b.masseOverride) {
    const p = masseGueltig(typ, b.masseOverride);
    if (!p.ok) {
      res.status(400).json({ fehler: p.fehler.join(' ') });
      return;
    }
  }
  const objekt: ObjektInstanz = {
    id: id('obj_'),
    projektId: k.projekt.id,
    typId: typ.id,
    position,
    rotation: Number.isFinite(b.rotation) ? ((b.rotation as number) % 360 + 360) % 360 : 0,
    masseOverride: b.masseOverride,
    hoeheUeberGelaende: hoehe,
    betreiberOrgId: b.betreiberOrgId,
    standNummer: b.standNummer,
    status: b.status ?? 'geplant',
    notizen: b.notizen,
    auflagen: [],
    erstelltVon: k.nutzer.id,
    erstelltAm: jetzt(),
  };
  k.inhalt.objekte.push(objekt);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'objekt', id: objekt.id },
    bezeichnung: bezeichnung(typ, objekt),
    nachher: objekt,
    kiVorschlag: (req.body as { kiVorschlag?: never }).kiVorschlag,
    nutzlast: { objekte: [objekt] },
  });
  res.status(201).json(objekt);
});

router.patch('/:id/objekte/:oid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const objekt = k.inhalt.objekte.find((o) => o.id === req.params.oid);
  if (!objekt) {
    res.status(404).json({ fehler: 'Objekt nicht gefunden.' });
    return;
  }
  const erlaubt = darfObjektAendern(k.nutzer, k.rolle, objekt);
  if (!erlaubt.ok) {
    res.status(403).json({ fehler: erlaubt.grund });
    return;
  }
  if (!sperrePruefen(res, k.projekt.id, { art: 'objekt', id: objekt.id }, k.nutzer.id)) return;

  const patch = felderFiltern(k.rolle, req.body as Record<string, unknown>);
  // Geometrie pruefen, BEVOR sie ins Projekt geschrieben wird — ungeprueft
  // machte ein `position: {"a":1}` saemtliche Berichte dauerhaft unbrauchbar.
  if (!eingabeOk(res, () => pruefeGeometriePatch(patch))) return;
  const typ = typenIndex().get(objekt.typId);
  if (patch.masseOverride && typ) {
    const p = masseGueltig(typ, patch.masseOverride as never);
    if (!p.ok) {
      res.status(400).json({ fehler: p.fehler.join(' ') });
      return;
    }
  }
  const vorher = structuredClone(objekt);
  const felder = ['position', 'rotation', 'masseOverride', 'hoeheUeberGelaende', 'betreiberOrgId', 'standNummer', 'status', 'notizen'];
  for (const f of felder) if (f in patch) (objekt as unknown as Record<string, unknown>)[f] = patch[f];
  if (typeof objekt.rotation === 'number') objekt.rotation = ((objekt.rotation % 360) + 360) % 360;

  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'objekt', id: objekt.id },
    bezeichnung: bezeichnung(typ, objekt),
    vorher,
    nachher: objekt,
    kiVorschlag: (req.body as { kiVorschlag?: never }).kiVorschlag,
    nutzlast: { objekte: [objekt] },
  });
  res.json(objekt);
});

router.delete('/:id/objekte/:oid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.loeschen') || k.rolle === 'feuerwehr') {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Objekte loeschen.' });
    return;
  }
  const i = k.inhalt.objekte.findIndex((o) => o.id === req.params.oid);
  if (i < 0) {
    res.status(404).json({ fehler: 'Objekt nicht gefunden.' });
    return;
  }
  if (!sperrePruefen(res, k.projekt.id, { art: 'objekt', id: req.params.oid }, k.nutzer.id)) return;
  const [weg] = k.inhalt.objekte.splice(i, 1);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'loeschen',
    elementRef: { art: 'objekt', id: weg.id },
    bezeichnung: bezeichnung(typenIndex().get(weg.typId), weg),
    vorher: weg,
    nachher: {},
  });
  res.json({ ok: true });
});

/** Stand einem Betreiber zuweisen (F3.3 / Abnahmekriterium 4). */
router.post('/:id/objekte/:oid/zuweisen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'zuweisen')) {
    res.status(403).json({ fehler: 'Nur der Veranstalter kann Staende zuweisen.' });
    return;
  }
  const objekt = k.inhalt.objekte.find((o) => o.id === req.params.oid);
  if (!objekt) {
    res.status(404).json({ fehler: 'Objekt nicht gefunden.' });
    return;
  }
  const { betreiberOrgId, standNummer } = req.body as { betreiberOrgId?: string | null; standNummer?: string };
  if (betreiberOrgId) {
    const org = organisationen.finde(betreiberOrgId);
    if (!org) {
      res.status(400).json({ fehler: 'Unbekannte Organisation.' });
      return;
    }
    if (org.typ !== 'betreiber') {
      res.status(400).json({ fehler: `„${org.name}“ ist kein Schaustellerbetrieb/Standbetreiber.` });
      return;
    }
    // Betreiber automatisch als Beteiligte fuehren, sonst sehen sie das Projekt nicht
    if (!mitgliedschaften.finde(k.projekt.id, org.id)) {
      mitgliedschaften.setzen({
        projektId: k.projekt.id,
        orgId: org.id,
        rolle: 'standbetreiber',
        automatisch: true,
        eingeladenVon: k.nutzer.id,
        eingeladenAm: jetzt(),
      });
      benachrichtigen({
        nutzerIds: nutzerTabelle.suche((n) => n.orgId === org.id).map((n) => n.id),
        projektId: k.projekt.id,
        art: 'einladung',
        titel: `Standzuweisung: ${k.projekt.name}`,
        text: `${org.name} wurde ein Stand im Projekt „${k.projekt.name}“ zugewiesen.`,
        link: `/projekt/${k.projekt.id}`,
      });
    }
  }
  const vorher = structuredClone(objekt);
  objekt.betreiberOrgId = betreiberOrgId ?? undefined;
  if (standNummer !== undefined) objekt.standNummer = standNummer;
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'objekt', id: objekt.id },
    bezeichnung: bezeichnung(typenIndex().get(objekt.typId), objekt),
    vorher,
    nachher: objekt,
    nutzlast: { objekte: [objekt] },
  });
  res.json(objekt);
});

// ---------------------------------------------------------------------------
// Wege
// ---------------------------------------------------------------------------

router.post('/:id/wege', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const b = req.body as Partial<Weg>;
  if (!b.typ || !WEGE_TYPEN.includes(b.typ)) {
    res.status(400).json({ fehler: `Wegetyp fehlt oder unbekannt. Erlaubt: ${WEGE_TYPEN.join(', ')}.` });
    return;
  }
  const erlaubt = darfWegAendern(k.rolle, b.typ);
  if (!erlaubt.ok) {
    res.status(403).json({ fehler: erlaubt.grund });
    return;
  }
  let polylinie: [number, number][] = [];
  let breite = 0;
  if (
    !eingabeOk(res, () => {
      polylinie = pruefePunktfolge(b.polylinie, 'polylinie', 2) as [number, number][];
      breite = pruefeMeter(b.breite, 'breite');
      if (b.lichteHoehe !== undefined && b.lichteHoehe !== null) pruefeMeter(b.lichteHoehe, 'lichteHoehe');
    })
  ) {
    return;
  }
  const weg: Weg = {
    id: id('weg_'),
    projektId: k.projekt.id,
    typ: b.typ,
    polylinie,
    breite,
    lichteHoehe: b.lichteHoehe,
    richtung: b.richtung ?? 'beide',
    name: b.name,
    entfluchtungFuerPersonen: b.entfluchtungFuerPersonen,
    erstelltVon: k.nutzer.id,
    erstelltAm: jetzt(),
  };
  k.inhalt.wege.push(weg);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'weg', id: weg.id },
    bezeichnung: `${weg.name ?? weg.typ} (${polylinieLaenge(weg.polylinie).toFixed(1)} m)`,
    nachher: weg,
    nutzlast: { wege: [weg] },
  });
  res.status(201).json(weg);
});

router.patch('/:id/wege/:wid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const weg = k.inhalt.wege.find((w) => w.id === req.params.wid);
  if (!weg) {
    res.status(404).json({ fehler: 'Weg nicht gefunden.' });
    return;
  }
  const erlaubt = darfWegAendern(k.rolle, weg.typ);
  if (!erlaubt.ok) {
    res.status(403).json({ fehler: erlaubt.grund });
    return;
  }
  const patch = req.body as Record<string, unknown>;
  // Auch der NEUE Typ muss erlaubt sein: sonst haette die Feuerwehr eine
  // Feuerwehrzufahrt in einen Besucherweg umwidmen und so ihre Beschraenkung
  // auf Feuerwehrflaechen umgehen koennen (Befund 07.08.2026).
  if ('typ' in patch) {
    const neuerTyp = patch.typ as string;
    if (!WEGE_TYPEN.includes(neuerTyp as never)) {
      res.status(400).json({ fehler: `Wegetyp unbekannt. Erlaubt: ${WEGE_TYPEN.join(', ')}.` });
      return;
    }
    const erlaubtNeu = darfWegAendern(k.rolle, neuerTyp);
    if (!erlaubtNeu.ok) {
      res.status(403).json({ fehler: erlaubtNeu.grund });
      return;
    }
  }
  if (!eingabeOk(res, () => pruefeGeometriePatch(patch))) return;
  if (!sperrePruefen(res, k.projekt.id, { art: 'weg', id: weg.id }, k.nutzer.id)) return;
  const vorher = structuredClone(weg);
  for (const f of ['polylinie', 'breite', 'lichteHoehe', 'richtung', 'name', 'typ', 'entfluchtungFuerPersonen']) {
    if (f in patch) (weg as unknown as Record<string, unknown>)[f] = patch[f];
  }
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'weg', id: weg.id },
    bezeichnung: weg.name ?? weg.typ,
    vorher,
    nachher: weg,
    nutzlast: { wege: [weg] },
  });
  res.json(weg);
});

router.delete('/:id/wege/:wid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const i = k.inhalt.wege.findIndex((w) => w.id === req.params.wid);
  if (i < 0) {
    res.status(404).json({ fehler: 'Weg nicht gefunden.' });
    return;
  }
  const erlaubt = darfWegAendern(k.rolle, k.inhalt.wege[i].typ);
  if (!erlaubt.ok) {
    res.status(403).json({ fehler: erlaubt.grund });
    return;
  }
  const [weg] = k.inhalt.wege.splice(i, 1);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'loeschen',
    elementRef: { art: 'weg', id: weg.id },
    bezeichnung: weg.name ?? weg.typ,
    vorher: weg,
    nachher: {},
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Blockflaechen
// ---------------------------------------------------------------------------

router.post('/:id/blockflaechen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.anlegen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Blockflaechen anlegen.' });
    return;
  }
  const b = req.body as Partial<Blockflaeche>;
  if (!b.typ || !['gesperrt', 'nicht_bebaubar', 'nur_einsatzkraefte'].includes(b.typ)) {
    res.status(400).json({ fehler: 'Typ muss gesperrt, nicht_bebaubar oder nur_einsatzkraefte sein.' });
    return;
  }
  let polygon: [number, number][] = [];
  if (!eingabeOk(res, () => { polygon = pruefePunktfolge(b.polygon, 'polygon', 3) as [number, number][]; })) return;
  const flaeche: Blockflaeche = {
    id: id('blk_'),
    projektId: k.projekt.id,
    typ: b.typ,
    polygon,
    begruendung: b.begruendung ?? '',
    name: b.name,
    erstelltVon: k.nutzer.id,
    erstelltAm: jetzt(),
  };
  k.inhalt.blockflaechen.push(flaeche);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'blockflaeche', id: flaeche.id },
    bezeichnung: flaeche.name ?? flaeche.typ,
    nachher: flaeche,
    nutzlast: { blockflaechen: [flaeche] },
  });
  res.status(201).json(flaeche);
});

router.patch('/:id/blockflaechen/:bid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.aendern') || k.rolle === 'standbetreiber') {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Blockflaechen aendern.' });
    return;
  }
  const f = k.inhalt.blockflaechen.find((x) => x.id === req.params.bid);
  if (!f) {
    res.status(404).json({ fehler: 'Blockflaeche nicht gefunden.' });
    return;
  }
  const patch = req.body as Record<string, unknown>;
  if ('typ' in patch && !['gesperrt', 'nicht_bebaubar', 'nur_einsatzkraefte'].includes(patch.typ as string)) {
    res.status(400).json({ fehler: 'Typ muss gesperrt, nicht_bebaubar oder nur_einsatzkraefte sein.' });
    return;
  }
  if (!eingabeOk(res, () => pruefeGeometriePatch(patch))) return;
  if (!sperrePruefen(res, k.projekt.id, { art: 'blockflaeche', id: f.id }, k.nutzer.id)) return;
  const vorher = structuredClone(f);
  for (const feld of ['polygon', 'typ', 'begruendung', 'name']) {
    if (feld in patch) (f as unknown as Record<string, unknown>)[feld] = patch[feld];
  }
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'blockflaeche', id: f.id },
    bezeichnung: f.name ?? f.typ,
    vorher,
    nachher: f,
    nutzlast: { blockflaechen: [f] },
  });
  res.json(f);
});

router.delete('/:id/blockflaechen/:bid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.loeschen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Blockflaechen loeschen.' });
    return;
  }
  const i = k.inhalt.blockflaechen.findIndex((x) => x.id === req.params.bid);
  if (i < 0) {
    res.status(404).json({ fehler: 'Blockflaeche nicht gefunden.' });
    return;
  }
  const [f] = k.inhalt.blockflaechen.splice(i, 1);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'loeschen',
    elementRef: { art: 'blockflaeche', id: f.id },
    bezeichnung: f.name ?? f.typ,
    vorher: f,
    nachher: {},
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Einsatzstationen
// ---------------------------------------------------------------------------

router.post('/:id/einsatzstationen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.anlegen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Einsatzstationen setzen.' });
    return;
  }
  const b = req.body as Partial<Einsatzstation>;
  if (!b.kategorie || !STATIONS_KATEGORIEN.includes(b.kategorie)) {
    res.status(400).json({ fehler: `Kategorie fehlt oder unbekannt. Erlaubt: ${STATIONS_KATEGORIEN.join(', ')}.` });
    return;
  }
  if (!b.punkt && !b.polygon) {
    res.status(400).json({ fehler: 'Entweder ein Punkt oder eine Flaeche ist erforderlich.' });
    return;
  }
  let punkt: [number, number] | undefined;
  let polygon: [number, number][] | undefined;
  if (
    !eingabeOk(res, () => {
      if (b.punkt) punkt = pruefePunkt(b.punkt, 'punkt') as [number, number];
      if (b.polygon) polygon = pruefePunktfolge(b.polygon, 'polygon', 3) as [number, number][];
    })
  ) {
    return;
  }
  const station: Einsatzstation = {
    id: id('sta_'),
    projektId: k.projekt.id,
    kategorie: b.kategorie,
    punkt,
    polygon,
    name: b.name ?? b.kategorie,
    besetztVonOrgId: b.besetztVonOrgId,
    notizen: b.notizen,
    erstelltVon: k.nutzer.id,
    erstelltAm: jetzt(),
  };
  k.inhalt.einsatzstationen.push(station);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'einsatzstation', id: station.id },
    bezeichnung: `${station.kategorie}: ${station.name}`,
    nachher: station,
    nutzlast: { einsatzstationen: [station] },
  });
  res.status(201).json(station);
});

router.patch('/:id/einsatzstationen/:sid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.aendern') || k.rolle === 'standbetreiber') {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Einsatzstationen aendern.' });
    return;
  }
  const s = k.inhalt.einsatzstationen.find((x) => x.id === req.params.sid);
  if (!s) {
    res.status(404).json({ fehler: 'Einsatzstation nicht gefunden.' });
    return;
  }
  const patch = req.body as Record<string, unknown>;
  if ('kategorie' in patch && !STATIONS_KATEGORIEN.includes(patch.kategorie as never)) {
    res.status(400).json({ fehler: `Kategorie unbekannt. Erlaubt: ${STATIONS_KATEGORIEN.join(', ')}.` });
    return;
  }
  if (!eingabeOk(res, () => pruefeGeometriePatch(patch))) return;
  if (!sperrePruefen(res, k.projekt.id, { art: 'einsatzstation', id: s.id }, k.nutzer.id)) return;
  const vorher = structuredClone(s);
  for (const f of ['punkt', 'polygon', 'name', 'kategorie', 'besetztVonOrgId', 'notizen']) {
    if (f in patch) (s as unknown as Record<string, unknown>)[f] = patch[f];
  }
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'einsatzstation', id: s.id },
    bezeichnung: `${s.kategorie}: ${s.name}`,
    vorher,
    nachher: s,
    nutzlast: { einsatzstationen: [s] },
  });
  res.json(s);
});

router.delete('/:id/einsatzstationen/:sid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'element.loeschen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Einsatzstationen loeschen.' });
    return;
  }
  const i = k.inhalt.einsatzstationen.findIndex((x) => x.id === req.params.sid);
  if (i < 0) {
    res.status(404).json({ fehler: 'Einsatzstation nicht gefunden.' });
    return;
  }
  const [s] = k.inhalt.einsatzstationen.splice(i, 1);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'loeschen',
    elementRef: { art: 'einsatzstation', id: s.id },
    bezeichnung: `${s.kategorie}: ${s.name}`,
    vorher: s,
    nachher: {},
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Eigene Objekttypen (F3.4)
// ---------------------------------------------------------------------------

router.post('/:id/objekttypen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'objekttyp.anlegen')) {
    res.status(403).json({ fehler: 'Nur der Veranstalter darf eigene Objekttypen anlegen.' });
    return;
  }
  const b = req.body as Record<string, unknown>;
  const masse = b.masse as { laenge?: number; breite?: number; hoehe?: number } | undefined;
  if (!b.name || !masse || !(masse.laenge! > 0) || !(masse.breite! > 0) || !(masse.hoehe! > 0)) {
    res.status(400).json({ fehler: 'Name und positive Masse (Laenge, Breite, Hoehe) sind erforderlich.' });
    return;
  }
  const neuerTyp = {
    id: `eigen-${id()}`,
    kategorie: (b.kategorie as never) ?? 'infrastruktur',
    name: String(b.name),
    geometrieTyp: 'box' as const,
    form: (b.form as never) ?? 'rechteck',
    masse: { laenge: masse.laenge!, breite: masse.breite!, hoehe: masse.hoehe! },
    parametrisierbar: true,
    minMax: {
      laenge: [Math.max(0.1, masse.laenge! * 0.2), masse.laenge! * 5] as [number, number],
      breite: [Math.max(0.1, masse.breite! * 0.2), masse.breite! * 5] as [number, number],
      hoehe: [Math.max(0.1, masse.hoehe! * 0.2), masse.hoehe! * 5] as [number, number],
    },
    einAusstiege: (b.einAusstiege as never) ?? [],
    flaechenbedarfZusatz: Number(b.flaechenbedarfZusatz) || 0,
    technik: (b.technik as never) ?? { stromKW: 0, wasser: false, gasflaschen: false },
    personenkapazitaet: (b.personenkapazitaet as number) ?? null,
    quelleMasse: String(b.quelleMasse ?? `Eigene Angabe von ${k.nutzer.name}, ${jetzt().slice(0, 10)}`),
    farbe: String(b.farbe ?? '#8ea4b8'),
    hinweis: b.hinweis ? String(b.hinweis) : undefined,
    eigen: true,
    eigentuemerOrgId: k.nutzer.orgId,
  };
  objekttypenEigen.einfuegen(neuerTyp as never);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'objekttyp', id: neuerTyp.id },
    bezeichnung: neuerTyp.name,
    nachher: neuerTyp,
  });
  res.status(201).json(neuerTyp);
});

export default router;
