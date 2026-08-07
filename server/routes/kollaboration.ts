import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import type { Auflage, Freigabe, Kommentar, Snapshot } from '../../shared/domain/types.ts';
import { bezeichnung } from '../../shared/domain/objekte.ts';
import { events, id, jetzt, mitgliedschaften, nutzer as nutzerTabelle, organisationen, projekte, snapshots } from '../lib/store.ts';
import { darf, darfAuflageAendern, darfKommentarAendern } from '../lib/rechte.ts';
import { benachrichtigen, protokollieren, snapshotDiff } from '../lib/ereignis.ts';
import { typenIndex } from '../lib/kataloge.ts';
import * as hub from '../realtime/hub.ts';
import { projektKontext } from './projekte.ts';
import { pruefungAusfuehren } from './pruefung.ts';

const router = Router();

// ---------------------------------------------------------------------------
// Aenderungsprotokoll (F6.4)
// ---------------------------------------------------------------------------

router.get('/:id/events', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const abSeq = Number(req.query.abSeq) || 0;
  let liste = events.lesen(k.projekt.id, abSeq);
  const wer = req.query.nutzer as string | undefined;
  const was = req.query.art as string | undefined;
  if (wer) liste = liste.filter((e) => e.nutzerId === wer);
  if (was) liste = liste.filter((e) => e.elementRef.art === was);
  res.json(liste.reverse());
});

// ---------------------------------------------------------------------------
// Kommentare (F6.3)
// ---------------------------------------------------------------------------

router.get('/:id/kommentare', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  res.json(projekte.kommentare(k.projekt.id));
});

router.post('/:id/kommentare', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'kommentar.schreiben')) {
    res.status(403).json({ fehler: 'Diese Rolle darf nicht kommentieren.' });
    return;
  }
  const b = req.body as Partial<Kommentar>;
  if (!b.text?.trim()) {
    res.status(400).json({ fehler: 'Der Kommentar ist leer.' });
    return;
  }
  // @-Erwaehnungen aufloesen
  const erwaehnt = [...b.text.matchAll(/@([\wäöüÄÖÜß.\-]+)/g)].map((m) => m[1].toLowerCase());
  const erwaehnteNutzer = nutzerTabelle
    .alle()
    .filter((n) => erwaehnt.some((e) => n.name.toLowerCase().includes(e) || n.email.toLowerCase().startsWith(e)));

  const kommentar: Kommentar = {
    id: id('kom_'),
    projektId: k.projekt.id,
    elementRef: b.elementRef,
    punkt: b.punkt,
    text: b.text.trim(),
    autorId: k.nutzer.id,
    autorName: k.nutzer.name,
    autorOrgId: k.nutzer.orgId,
    erledigt: false,
    erwaehnungen: erwaehnteNutzer.map((n) => n.id),
    am: jetzt(),
    antworten: [],
  };
  projekte.kommentarAnlegen(k.projekt.id, kommentar);
  hub.kommentarVerteilen(kommentar);
  if (erwaehnteNutzer.length) {
    benachrichtigen({
      nutzerIds: erwaehnteNutzer.map((n) => n.id),
      projektId: k.projekt.id,
      art: 'erwaehnung',
      titel: `Erwaehnung in ${k.projekt.name}`,
      text: `${k.nutzer.name}: ${kommentar.text.slice(0, 160)}`,
      link: `/projekt/${k.projekt.id}`,
    });
  }
  res.status(201).json(kommentar);
});

router.patch('/:id/kommentare/:kid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const vorhanden = projekte.kommentare(k.projekt.id).find((x) => x.id === req.params.kid);
  if (!vorhanden) {
    res.status(404).json({ fehler: 'Kommentar nicht gefunden.' });
    return;
  }
  const b = req.body as { erledigt?: boolean; antwort?: string };
  // Rechtepruefung: PATCH war bis 07.08.2026 offen und damit ein Schleichweg
  // an POST /kommentare vorbei.
  const erlaubt = darfKommentarAendern(k.rolle, k.nutzer.id, vorhanden.autorId, {
    antwort: Boolean(b.antwort?.trim()),
    erledigt: typeof b.erledigt === 'boolean',
  });
  if (!erlaubt.ok) {
    res.status(403).json({ fehler: erlaubt.grund });
    return;
  }
  const patch: Partial<Kommentar> = {};
  if (typeof b.erledigt === 'boolean') patch.erledigt = b.erledigt;
  if (b.antwort?.trim()) {
    patch.antworten = [
      ...vorhanden.antworten,
      { id: id('ant_'), text: b.antwort.trim(), autorId: k.nutzer.id, autorName: k.nutzer.name, am: jetzt() },
    ];
  }
  const neu = projekte.kommentarAendern(k.projekt.id, req.params.kid, patch);
  if (neu) hub.kommentarVerteilen(neu);
  res.json(neu);
});

// ---------------------------------------------------------------------------
// Snapshots (F6.4) und Freigabe-Workflow (F6.5)
// ---------------------------------------------------------------------------

router.get('/:id/snapshots', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const freigaben = projekte.freigaben(k.projekt.id);
  res.json(
    snapshots.liste(k.projekt.id).map((s) => ({
      id: s.id,
      name: s.name,
      zeit: s.zeit,
      eventCursor: s.eventCursor,
      erstelltVon: s.erstelltVon,
      bemerkung: s.bemerkung,
      objekte: s.inhalt.objekte.length,
      wege: s.inhalt.wege.length,
      freigaben: freigaben.filter((f) => f.snapshotId === s.id),
    })),
  );
});

router.post('/:id/snapshots', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'snapshot.anlegen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Planungsstaende festhalten.' });
    return;
  }
  const { name, bemerkung, einreichen } = req.body as { name?: string; bemerkung?: string; einreichen?: boolean };
  if (!name?.trim()) {
    res.status(400).json({ fehler: 'Ein Name fuer den Planungsstand ist erforderlich (z. B. „Einreichung Ordnungsamt 01.03.“).' });
    return;
  }
  const s: Snapshot = {
    id: id('snp_'),
    projektId: k.projekt.id,
    name: name.trim(),
    zeit: jetzt(),
    eventCursor: projekte.letzteSeq(k.projekt.id),
    erstelltVon: k.nutzer.id,
    inhalt: structuredClone(k.inhalt),
    bemerkung,
  };
  snapshots.anlegen(s);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'anlegen',
    elementRef: { art: 'projekt', id: k.projekt.id },
    bezeichnung: `Planungsstand „${s.name}“`,
    diff: [{ feld: 'snapshot', vorher: null, nachher: s.name }],
  });

  if (einreichen) {
    k.projekt.status = 'eingereicht';
    projekte.speichern(k.projekt.id, true);
    const behoerden = mitgliedschaften
      .fuerProjekt(k.projekt.id)
      .filter((m) => m.rolle === 'ordnungsamt' || m.rolle === 'feuerwehr');
    const empfaenger = behoerden.flatMap((m) => nutzerTabelle.suche((n) => n.orgId === m.orgId).map((n) => n.id));
    benachrichtigen({
      nutzerIds: empfaenger,
      projektId: k.projekt.id,
      art: 'einreichung',
      titel: `Einreichung: ${k.projekt.name}`,
      text: `${k.nutzer.name} hat den Planungsstand „${s.name}“ zur Freigabe eingereicht.`,
      link: `/projekt/${k.projekt.id}`,
    });
  }
  res.status(201).json(s);
});

router.get('/:id/snapshots/:sid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const s = snapshots.finde(k.projekt.id, req.params.sid);
  if (!s) {
    res.status(404).json({ fehler: 'Planungsstand nicht gefunden.' });
    return;
  }
  res.json(s);
});

/** Diff zweier Planungsstaende (F6.4). */
router.get('/:id/snapshots/:sid/diff/:sid2', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const a = snapshots.finde(k.projekt.id, req.params.sid);
  const b =
    req.params.sid2 === 'aktuell'
      ? { inhalt: k.inhalt, name: 'Aktueller Stand' }
      : snapshots.finde(k.projekt.id, req.params.sid2);
  if (!a || !b) {
    res.status(404).json({ fehler: 'Mindestens ein Planungsstand wurde nicht gefunden.' });
    return;
  }
  const typen = typenIndex();
  const benenne = (art: string, el: unknown): string => {
    const e = el as Record<string, string>;
    if (art === 'objekt') return bezeichnung(typen.get(e.typId), el as never);
    if (art === 'weg') return e.name ?? e.typ;
    if (art === 'blockflaeche') return e.name ?? e.typ;
    if (art === 'einsatzstation') return `${e.kategorie}: ${e.name}`;
    return e.id;
  };
  res.json({
    von: { id: a.id, name: a.name, zeit: (a as Snapshot).zeit },
    nach: { id: (b as Snapshot).id ?? 'aktuell', name: b.name, zeit: (b as Snapshot).zeit ?? jetzt() },
    ...snapshotDiff(a.inhalt, b.inhalt, benenne as never),
  });
});

router.post('/:id/snapshots/:sid/freigabe', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'freigabe.setzen')) {
    res.status(403).json({ fehler: 'Nur Behoerdenrollen koennen eine Freigabe setzen.' });
    return;
  }
  const s = snapshots.finde(k.projekt.id, req.params.sid);
  if (!s) {
    res.status(404).json({ fehler: 'Planungsstand nicht gefunden.' });
    return;
  }
  const { status, kommentar, auflagen } = req.body as { status?: Freigabe['status']; kommentar?: string; auflagen?: string[] };
  if (!status || !['freigegeben', 'mit_auflagen', 'abgelehnt'].includes(status)) {
    res.status(400).json({ fehler: 'Status muss freigegeben, mit_auflagen oder abgelehnt sein.' });
    return;
  }
  if (status === 'mit_auflagen' && !(auflagen?.length || kommentar)) {
    res.status(400).json({ fehler: 'Bei „mit Auflagen“ bitte mindestens eine Auflage oder einen Kommentar angeben.' });
    return;
  }
  const org = organisationen.finde(k.nutzer.orgId);
  const liste: Auflage[] = (auflagen ?? []).map((t) => ({
    id: id('auf_'),
    text: t,
    von: k.nutzer.name,
    vonOrg: org?.name ?? '',
    am: jetzt(),
    erledigt: false,
  }));
  const f: Freigabe = {
    id: id('frg_'),
    snapshotId: s.id,
    projektId: k.projekt.id,
    behoerdenOrgId: k.nutzer.orgId,
    behoerdenOrgName: org?.name ?? '',
    status,
    kommentar: kommentar ?? '',
    auflagen: liste,
    am: jetzt(),
    vonNutzerId: k.nutzer.id,
  };
  projekte.freigabeSetzen(k.projekt.id, f);

  // Auflagen erscheinen beim Veranstalter als Aufgabenliste
  if (liste.length) {
    for (const o of k.inhalt.objekte) void o;
    k.projekt.status = status === 'freigegeben' ? 'freigegeben' : 'entwurf';
  }
  projekte.speichern(k.projekt.id, true);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'projekt', id: k.projekt.id },
    bezeichnung: `Freigabe „${s.name}“: ${status}`,
    diff: [{ feld: 'freigabe', vorher: null, nachher: { status, auflagen: liste.length } }],
  });
  benachrichtigen({
    nutzerIds: nutzerTabelle.suche((n) => n.orgId === k.projekt.veranstalterOrgId).map((n) => n.id),
    projektId: k.projekt.id,
    art: 'statuswechsel',
    titel: `${org?.name ?? 'Behoerde'}: ${status === 'freigegeben' ? 'freigegeben' : status === 'mit_auflagen' ? 'mit Auflagen' : 'abgelehnt'}`,
    text: `Planungsstand „${s.name}“${liste.length ? ` — ${liste.length} Auflage(n)` : ''}. ${kommentar ?? ''}`.trim(),
    link: `/projekt/${k.projekt.id}`,
  });
  res.status(201).json(f);
});

/** Alle Auflagen als Aufgabenliste (F6.5). */
router.get('/:id/auflagen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const ausFreigaben = projekte.freigaben(k.projekt.id).flatMap((f) =>
    f.auflagen.map((a) => ({ ...a, quelle: `${f.behoerdenOrgName} (${f.status})`, snapshotId: f.snapshotId, freigabeId: f.id })),
  );
  const anObjekten = k.inhalt.objekte.flatMap((o) =>
    o.auflagen.map((a) => ({ ...a, quelle: 'Objektauflage', objektId: o.id, snapshotId: null, freigabeId: null })),
  );
  res.json([...ausFreigaben, ...anObjekten]);
});

router.patch('/:id/auflagen/:aid', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  // Amtliche Auflagen darf nur der Veranstalter abhaken oder die erteilende
  // Behoerde zuruecknehmen — nicht Standbetreiber, Gaeste oder die Polizei.
  if (!darfAuflageAendern(k.rolle)) {
    res.status(403).json({ fehler: 'Diese Rolle darf Auflagen nicht als erledigt markieren.' });
    return;
  }
  const { erledigt } = req.body as { erledigt?: boolean };
  let gefunden = false;
  for (const f of projekte.freigaben(k.projekt.id)) {
    for (const a of f.auflagen) {
      if (a.id === req.params.aid) {
        a.erledigt = Boolean(erledigt);
        gefunden = true;
        projekte.freigabeSetzen(k.projekt.id, f);
      }
    }
  }
  for (const o of k.inhalt.objekte) {
    for (const a of o.auflagen) {
      if (a.id === req.params.aid) {
        a.erledigt = Boolean(erledigt);
        gefunden = true;
        projekte.speichern(k.projekt.id, true);
      }
    }
  }
  if (!gefunden) {
    res.status(404).json({ fehler: 'Auflage nicht gefunden.' });
    return;
  }
  res.json({ ok: true });
});

/** Auflage direkt an ein Objekt haengen (Behoerdenrollen). */
router.post('/:id/objekte/:oid/auflagen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'freigabe.setzen')) {
    res.status(403).json({ fehler: 'Nur Behoerdenrollen koennen Auflagen setzen.' });
    return;
  }
  const o = k.inhalt.objekte.find((x) => x.id === req.params.oid);
  if (!o) {
    res.status(404).json({ fehler: 'Objekt nicht gefunden.' });
    return;
  }
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ fehler: 'Der Auflagentext fehlt.' });
    return;
  }
  const a: Auflage = {
    id: id('auf_'),
    text: text.trim(),
    von: k.nutzer.name,
    vonOrg: organisationen.finde(k.nutzer.orgId)?.name ?? '',
    am: jetzt(),
    erledigt: false,
  };
  o.auflagen.push(a);
  protokollieren({
    projektId: k.projekt.id,
    nutzer: k.nutzer,
    orgId: k.nutzer.orgId,
    aktion: 'aendern',
    elementRef: { art: 'objekt', id: o.id },
    bezeichnung: bezeichnung(typenIndex().get(o.typId), o),
    diff: [{ feld: 'auflagen', vorher: o.auflagen.length - 1, nachher: o.auflagen.length }],
    nutzlast: { objekte: [o] },
  });
  benachrichtigen({
    nutzerIds: nutzerTabelle.suche((n) => n.orgId === k.projekt.veranstalterOrgId).map((n) => n.id),
    projektId: k.projekt.id,
    art: 'auflage',
    titel: `Neue Auflage in ${k.projekt.name}`,
    text: a.text,
    link: `/projekt/${k.projekt.id}`,
  });
  res.status(201).json(a);
});

/** Auf Wunsch die Pruefung nach dem Anlegen eines Standes gleich mitfahren. */
router.post('/:id/neu-pruefen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const bericht = pruefungAusfuehren(k.projekt.id);
  hub.pruefungVerteilen(bericht);
  res.json(bericht.zusammenfassung);
});

export default router;
