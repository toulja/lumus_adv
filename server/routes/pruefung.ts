import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import type { Gelaende, ProjektInhalt, Pruefbericht, Regelwerk } from '../../shared/domain/types.ts';
import { pruefe, wegEngstellen, editorStatus } from '../../shared/rules/engine.ts';
import type { PruefKontext } from '../../shared/rules/engine.ts';
import { gelaende as gelaendeStore, projekte } from '../lib/store.ts';
import { regelwerk as regelwerkLaden, typenIndex } from '../lib/kataloge.ts';
import * as hub from '../realtime/hub.ts';
import { projektKontext } from './projekte.ts';

const router = Router();

/** Letzter Pruefbericht je Projekt — fuer Uebersichten und die KI. */
const berichte = new Map<string, Pruefbericht>();

export function letzterBericht(projektId: string): Pruefbericht | undefined {
  return berichte.get(projektId);
}

export function pruefKontext(inhalt: ProjektInhalt, regelwerkId: string): { kontext: PruefKontext; regelwerk: Regelwerk; gelaende: Gelaende | null } {
  const rw = regelwerkLaden(regelwerkId) ?? regelwerkLaden('he-mvstaettvo');
  if (!rw) throw new Error(`Regelwerk „${regelwerkId}“ nicht gefunden.`);
  const g = gelaendeStore.laden(inhalt.projekt.gelaendeId);
  return {
    regelwerk: rw,
    gelaende: g,
    kontext: {
      inhalt,
      gelaende: g ? { gebaeude: g.gebaeude, polygon: g.polygon } : null,
      typen: typenIndex(),
      regelwerk: rw,
    },
  };
}

/** Volle Pruefung auf Knopfdruck (F8.4). */
export function pruefungAusfuehren(projektId: string): Pruefbericht {
  const inhalt = projekte.inhalt(projektId);
  if (!inhalt) throw new Error('Projekt nicht gefunden.');
  const { kontext } = pruefKontext(inhalt, inhalt.projekt.regelwerkId);
  const bericht = pruefe(kontext);
  berichte.set(projektId, bericht);
  return bericht;
}

router.post('/:id/pruefung', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  try {
    const bericht = pruefungAusfuehren(k.projekt.id);
    hub.pruefungVerteilen(bericht);
    res.json(bericht);
  } catch (e) {
    res.status(400).json({ fehler: (e as Error).message });
  }
});

router.get('/:id/pruefung', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const vorhanden = berichte.get(k.projekt.id);
  if (vorhanden) {
    res.json(vorhanden);
    return;
  }
  try {
    res.json(pruefungAusfuehren(k.projekt.id));
  } catch (e) {
    res.status(400).json({ fehler: (e as Error).message });
  }
});

/**
 * Schnelle Editor-Rueckmeldung (F2.6): Kollisionen und unterschrittene
 * Pflichtabstaende je Objekt — ohne das volle Regelwerk zu fahren.
 */
router.get('/:id/editorstatus', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const { kontext } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
  const minAbstand = Number(req.query.minAbstand) || 0;
  res.json(Object.fromEntries(editorStatus(kontext, minAbstand)));
});

/** Engstellen eines einzelnen Weges (F4.2) — fuer die Live-Anzeige. */
router.get('/:id/wege/:wid/engstellen', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const weg = k.inhalt.wege.find((w) => w.id === req.params.wid);
  if (!weg) {
    res.status(404).json({ fehler: 'Weg nicht gefunden.' });
    return;
  }
  const { kontext } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
  const stellen = wegEngstellen(kontext, weg);
  const min = stellen.length ? stellen.reduce((a, b) => (b.freieBreite < a.freieBreite ? b : a)) : null;
  res.json({
    wegId: weg.id,
    planbreite: weg.breite,
    minFreieBreite: min ? +min.freieBreite.toFixed(3) : weg.breite,
    engsteStelle: min,
    // nur die tatsaechlich eingeschnuerten Querschnitte zurueckgeben
    stellen: stellen.filter((s) => s.freieBreite < weg.breite - 0.01),
  });
});

export default router;
