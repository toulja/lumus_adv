import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import type { ProjektInhalt } from '../../shared/domain/types.ts';
import { darf, kontaktSichtbar } from '../lib/rechte.ts';
import { gelaende as gelaendeStore, nutzer as nutzerTabelle, organisationen, projekte, snapshots } from '../lib/store.ts';
import { typenIndex } from '../lib/kataloge.ts';
import { projektKontext } from './projekte.ts';
import { pruefKontext, pruefungAusfuehren } from './pruefung.ts';

import { lageplanPdf } from '../reports/lageplan.ts';
import { konformitaetsberichtPdf } from '../reports/konformitaet.ts';
import { betreiberZeilen, betreiberlisteCsv, betreiberlistePdf } from '../reports/betreiberliste.ts';
import { einsatzmappePdf } from '../reports/einsatzmappe.ts';
import { projektAlsGeoJson } from '../exports/geojson.ts';
import { szeneAlsGltf } from '../exports/gltf.ts';
import { vadereSzenario, validiereVadere, vadereDateiname } from '../exports/vadere.ts';

const router = Router();

function dateiName(text: string, endung: string): string {
  const sauber = text
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${sauber || 'export'}.${endung}`;
}

/** Nimmt entweder den aktuellen Stand oder einen benannten Planungsstand. */
function inhaltFuer(k: { projekt: { id: string; name: string }; inhalt: ProjektInhalt }, snapshotId?: string) {
  if (!snapshotId) return { inhalt: k.inhalt, snapshotName: undefined as string | undefined };
  const s = snapshots.finde(k.projekt.id, snapshotId);
  if (!s) throw new Error('Planungsstand nicht gefunden.');
  return { inhalt: s.inhalt, snapshotName: s.name };
}

// ---------------------------------------------------------------------------
// F10.2 — massstaeblicher Lageplan
// ---------------------------------------------------------------------------

router.get('/:id/berichte/lageplan.pdf', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Berichte erzeugen.' });
    return;
  }
  try {
    const massstabRoh = Number(req.query.massstab) || 1000;
    const massstab = ([250, 500, 1000] as const).includes(massstabRoh as never) ? (massstabRoh as 250 | 500 | 1000) : 1000;
    const { inhalt, snapshotName } = inhaltFuer(k, req.query.snapshot as string | undefined);
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    const pdf = await lageplanPdf({
      inhalt,
      gelaende: g,
      typen: typenIndex(),
      massstab,
      titel: `Lageplan — ${k.projekt.name}`,
      untertitel: [
        snapshotName ? `Planungsstand: ${snapshotName}` : 'Aktueller Planungsstand',
        `Zeitraum ${k.projekt.zeitraumVon} bis ${k.projekt.zeitraumBis}`,
        `max. ${k.projekt.maxBesucher.toLocaleString('de-DE')} Besucher gleichzeitig`,
      ].join(' · '),
    });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${dateiName(`Lageplan_${k.projekt.name}_1zu${massstab}`, 'pdf')}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// F10.1 — Konformitaetsbericht
// ---------------------------------------------------------------------------

router.get('/:id/berichte/konformitaet.pdf', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Berichte erzeugen.' });
    return;
  }
  try {
    const { inhalt, snapshotName } = inhaltFuer(k, req.query.snapshot as string | undefined);
    const { kontext, regelwerk, gelaende } = pruefKontext(inhalt, k.projekt.regelwerkId);
    const { pruefe } = await import('../../shared/rules/engine.ts');
    const bericht = req.query.snapshot ? pruefe(kontext) : pruefungAusfuehren(k.projekt.id);
    const pdf = await konformitaetsberichtPdf({
      bericht,
      inhalt,
      gelaende,
      typen: typenIndex(),
      regelwerk,
      projektName: k.projekt.name,
      snapshotName,
      veranstalter: organisationen.finde(k.projekt.veranstalterOrgId)?.name ?? 'k. A.',
    });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${dateiName(`Konformitaetsbericht_${k.projekt.name}`, 'pdf')}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// F10.3 — Betreiberliste (Zugriff gemaess Rollenmodell, insbesondere Polizei)
// ---------------------------------------------------------------------------

function betreiberDaten(k: { projekt: { id: string; name: string }; inhalt: ProjektInhalt; rolle: never }) {
  return betreiberZeilen(
    k.inhalt,
    typenIndex(),
    organisationen.alle(),
    nutzerTabelle.alle(),
    kontaktSichtbar(k.rolle),
  );
}

router.get('/:id/berichte/betreiberliste.csv', anmeldungNoetig, (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'betreiberliste.lesen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf die Betreiberliste nicht einsehen.' });
    return;
  }
  try {
    const csv = betreiberlisteCsv(betreiberDaten(k as never));
    res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${dateiName(`Betreiberliste_${k.projekt.name}`, 'csv')}"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/berichte/betreiberliste.pdf', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'betreiberliste.lesen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf die Betreiberliste nicht einsehen.' });
    return;
  }
  try {
    const pdf = await betreiberlistePdf(
      betreiberDaten(k as never),
      `Betreiberliste — ${k.projekt.name}`,
      kontaktSichtbar(k.rolle)
        ? `Stand ${new Date().toLocaleString('de-DE')}`
        : `Stand ${new Date().toLocaleString('de-DE')} — Kontaktdaten sind fuer diese Rolle gesperrt (DSGVO)`,
    );
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${dateiName(`Betreiberliste_${k.projekt.name}`, 'pdf')}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/berichte/betreiberliste.json', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'betreiberliste.lesen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf die Betreiberliste nicht einsehen.' });
    return;
  }
  res.json(betreiberDaten(k as never));
});

// ---------------------------------------------------------------------------
// F11 — Einsatzmappe (Sammel-PDF)
// ---------------------------------------------------------------------------

router.get('/:id/berichte/einsatzmappe.pdf', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Berichte erzeugen.' });
    return;
  }
  try {
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    const bericht = pruefungAusfuehren(k.projekt.id);
    const snaps = snapshots.liste(k.projekt.id);
    const letzter = snaps[0];
    const freigaben = projekte.freigaben(k.projekt.id).filter((f) => f.snapshotId === letzter?.id);
    const { regelwerk } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
    // Feldnamen muessen EXAKT auf EinsatzmappeOpts passen — kein `as never`:
    // ein falsch benanntes `nutzer` statt `nutzerListe` liess die Route frueher
    // mit TypeError abstuerzen, ohne dass der Typecheck es sah.
    const pdf = await einsatzmappePdf({
      inhalt: k.inhalt,
      gelaende: g,
      typen: typenIndex(),
      bericht,
      regelwerk,
      veranstalter: organisationen.finde(k.projekt.veranstalterOrgId) ?? null,
      organisationen: organisationen.alle(),
      nutzerListe: nutzerTabelle.alle(),
      snapshot: letzter ? { name: letzter.name, zeit: letzter.zeit } : null,
      freigaben,
      kontaktSichtbar: kontaktSichtbar(k.rolle),
    });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${dateiName(`Einsatzmappe_${k.projekt.name}`, 'pdf')}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// F10.4 / F9.1 — Exporte
// ---------------------------------------------------------------------------

router.get('/:id/export/geojson', anmeldungNoetig, (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf den Plan nicht exportieren.' });
    return;
  }
  try {
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    const daten = projektAlsGeoJson({
      inhalt: k.inhalt,
      gelaende: g,
      typen: typenIndex(),
      wgs84: req.query.crs !== '25832',
    });
    res.type('application/geo+json').setHeader('Content-Disposition', `attachment; filename="${dateiName(k.projekt.name, 'geojson')}"`);
    res.send(JSON.stringify(daten, null, 1));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/export/szene.glb', anmeldungNoetig, (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf den Plan nicht exportieren.' });
    return;
  }
  try {
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    const glb = szeneAlsGltf({
      inhalt: k.inhalt,
      gelaende: g,
      typen: typenIndex(),
      nurObjekte: req.query.nurObjekte === '1',
    });
    res.type('model/gltf-binary').setHeader('Content-Disposition', `attachment; filename="${dateiName(k.projekt.name, 'glb')}"`);
    res.send(glb);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/export/vadere', anmeldungNoetig, (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'bericht.erzeugen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf den Plan nicht exportieren.' });
    return;
  }
  try {
    const szenarioRoh = String(req.query.szenario ?? 'evakuierung');
    const szenario = (['normalbetrieb', 'evakuierung', 'weg_blockiert'] as const).includes(szenarioRoh as never)
      ? (szenarioRoh as 'normalbetrieb' | 'evakuierung' | 'weg_blockiert')
      : 'evakuierung';
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    const s = vadereSzenario({
      inhalt: k.inhalt,
      gelaende: g,
      typen: typenIndex(),
      szenario,
      blockierterWegId: req.query.weg as string | undefined,
    });
    const pruefung = validiereVadere(s);
    if (req.query.pruefen === '1') {
      res.json({ pruefung, szenario: s });
      return;
    }
    res
      .type('application/json')
      .setHeader('Content-Disposition', `attachment; filename="${vadereDateiname(k.projekt.name, szenario)}"`)
      .setHeader('X-Vadere-Gueltig', String(pruefung.gueltig))
      .send(JSON.stringify(s, null, 1));
  } catch (e) {
    next(e);
  }
});

export default router;
