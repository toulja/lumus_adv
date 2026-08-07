/**
 * F11 — Eigene, lesende Startansicht fuer Polizei und Behoerden.
 *
 * Kernpunkt des Lastenhefts: Die Polizei sieht ALLE Projekte ihres
 * Zustaendigkeitsbereichs OHNE Einladung. Die Rollenaufloesung dafuer steckt in
 * lib/rechte.ts (`rolleFuer`), damit es genau eine Wahrheit gibt.
 */

import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import { darf, rolleFuer, kontaktSichtbar } from '../lib/rechte.ts';
import { events, gelaende as gelaendeStore, nutzer as nutzerTabelle, organisationen, projekte, snapshots } from '../lib/store.ts';
import { typenIndex } from '../lib/kataloge.ts';
import { STATION_LABEL } from '../../shared/domain/types.ts';
import { abstandPunktPolylinie, schwerpunkt, zahl } from '../../shared/geo/geometry.ts';
import { letzterBericht, pruefungAusfuehren } from './pruefung.ts';

const router = Router();

router.get('/uebersicht', anmeldungNoetig, (req: AuthRequest, res) => {
  const org = organisationen.finde(req.nutzer!.orgId);
  const istBehoerde = org && ['polizei', 'behoerde_ordnungsamt', 'behoerde_feuerwehr', 'plattform'].includes(org.typ);
  if (!istBehoerde) {
    res.status(403).json({ fehler: 'Diese Ansicht ist Behoerden- und Polizei-Organisationen vorbehalten.' });
    return;
  }
  const seitBesuch = req.nutzer!.letzterBesuch ?? '1970-01-01T00:00:00.000Z';

  const liste = projekte
    .liste()
    .map((p) => {
      const rolle = rolleFuer(req.nutzer!, p);
      if (!rolle) return null;
      const inhalt = projekte.inhalt(p.id)!;
      const snaps = snapshots.liste(p.id);
      const letzter = snaps[0];
      const freigaben = projekte.freigaben(p.id).filter((f) => f.snapshotId === letzter?.id);
      const bericht = letzterBericht(p.id);
      const g = gelaendeStore.laden(p.gelaendeId);
      return {
        projekt: {
          id: p.id,
          name: p.name,
          zeitraumVon: p.zeitraumVon,
          zeitraumBis: p.zeitraumBis,
          maxBesucher: p.maxBesucher,
          status: p.status,
        },
        rolle,
        veranstalter: organisationen.finde(p.veranstalterOrgId)?.name ?? 'k. A.',
        gelaende: g ? { id: g.id, name: g.name, bbox: g.bbox } : null,
        objekte: inhalt.objekte.length,
        wege: inhalt.wege.length,
        einsatzstationen: inhalt.einsatzstationen.length,
        betreiberAnzahl: new Set(inhalt.objekte.map((o) => o.betreiberOrgId).filter(Boolean)).size,
        letzterSnapshot: letzter ? { id: letzter.id, name: letzter.name, zeit: letzter.zeit } : null,
        freigabeStatus: freigaben[0]?.status ?? 'offen',
        pruefung: bericht?.zusammenfassung ?? null,
        aenderungenSeitBesuch: events.anzahlSeit(p.id, seitBesuch),
      };
    })
    .filter(Boolean);

  res.json({
    organisation: org ? { id: org.id, name: org.name, typ: org.typ, zustaendigkeitsgebiet: org.zustaendigkeitsgebiet } : null,
    letzterBesuch: seitBesuch,
    projekte: liste,
  });
});

/** Lagebild eines Projekts: Einsatzstationen mit Erreichbarkeit. */
router.get('/projekte/:id/lagebild', anmeldungNoetig, (req: AuthRequest, res) => {
  const p = projekte.finde(req.params.id);
  if (!p) {
    res.status(404).json({ fehler: 'Projekt nicht gefunden.' });
    return;
  }
  const rolle = rolleFuer(req.nutzer!, p);
  if (!rolle || !darf(rolle, 'projekt.lesen')) {
    res.status(403).json({ fehler: 'Kein Zugriff auf dieses Projekt.' });
    return;
  }
  const inhalt = projekte.inhalt(p.id)!;
  const typen = typenIndex();
  const zufahrten = inhalt.wege.filter((w) => w.typ === 'feuerwehrzufahrt');

  const stationen = inhalt.einsatzstationen.map((s) => {
    const punkt = s.punkt ?? (s.polygon ? schwerpunkt(s.polygon) : null);
    let distanz: number | null = null;
    if (punkt && zufahrten.length) {
      distanz = Math.min(...zufahrten.map((w) => Math.max(0, abstandPunktPolylinie(punkt, w.polylinie) - w.breite / 2)));
    }
    return {
      id: s.id,
      kategorie: s.kategorie,
      kategorieLabel: STATION_LABEL[s.kategorie],
      name: s.name,
      besetztVon: s.besetztVonOrgId ? organisationen.finde(s.besetztVonOrgId)?.name ?? 'k. A.' : 'k. A.',
      position: punkt ? `E ${Math.round(punkt[0])} / N ${Math.round(punkt[1])}` : 'k. A.',
      punkt,
      distanzZuFeuerwehrzufahrtM: distanz === null ? null : +distanz.toFixed(1),
      distanzText: distanz === null ? 'k. A. (keine Feuerwehrzufahrt geplant)' : `${zahl(distanz, 1)} m`,
      notizen: s.notizen,
    };
  });

  const bericht = letzterBericht(p.id) ?? pruefungAusfuehren(p.id);
  res.json({
    projekt: { id: p.id, name: p.name, zeitraumVon: p.zeitraumVon, zeitraumBis: p.zeitraumBis, maxBesucher: p.maxBesucher },
    veranstalter: organisationen.finde(p.veranstalterOrgId) ?? null,
    veranstalterKontakt: kontaktSichtbar(rolle)
      ? nutzerTabelle.suche((n) => n.orgId === p.veranstalterOrgId).map((n) => ({ name: n.name, email: n.email }))
      : [],
    stationen,
    wege: inhalt.wege.map((w) => ({ id: w.id, name: w.name, typ: w.typ, breite: w.breite, richtung: w.richtung })),
    blockflaechen: inhalt.blockflaechen.map((b) => ({ id: b.id, name: b.name, typ: b.typ, begruendung: b.begruendung })),
    objekteNachKategorie: Object.entries(
      inhalt.objekte.reduce<Record<string, number>>((a, o) => {
        const kat = typen.get(o.typId)?.kategorie ?? 'unbekannt';
        a[kat] = (a[kat] ?? 0) + 1;
        return a;
      }, {}),
    ).map(([kategorie, anzahl]) => ({ kategorie, anzahl })),
    pruefung: bericht.zusammenfassung,
    beanstandungen: bericht.ergebnisse
      .filter((e) => e.status === 'verstoss')
      .map((e) => ({ regelId: e.regelId, meldung: e.meldung, schweregrad: e.schweregrad, fundstelle: e.fundstelle })),
  });
});

export default router;
