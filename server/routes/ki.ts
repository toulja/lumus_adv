import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import { darf } from '../lib/rechte.ts';
import { gelaende as gelaendeStore } from '../lib/store.ts';
import { bibliothek, typenIndex } from '../lib/kataloge.ts';
import { projektKontext } from './projekte.ts';
import { letzterBericht, pruefKontext, pruefungAusfuehren } from './pruefung.ts';
import { baueKontext } from '../ai/kontext.ts';
import { erklaereBefund, frageBeantworten, platzierenAufZuruf, rateLimitPruefen } from '../ai/assistent.ts';
import { kiKonfig } from '../ai/anthropic.ts';

const router = Router();

router.get('/:id/ki/status', anmeldungNoetig, (req: AuthRequest, res) => {
  const k = projektKontext(req, res);
  if (!k) return;
  const konf = kiKonfig();
  res.json({
    verfuegbar: konf.verfuegbar,
    modell: konf.verfuegbar ? konf.modell : null,
    hinweis: konf.verfuegbar
      ? 'Der KI-Assistent ist angebunden. Vorschlaege muessen immer bestaetigt werden.'
      : 'Kein ANTHROPIC_API_KEY gesetzt — es antwortet der lokale, regelbasierte Assistent. Er rechnet mit denselben Zahlen wie die Regel-Engine, formuliert aber knapper.',
    darfNutzen: darf(k.rolle, 'ki.nutzen'),
  });
});

/** F7.1 — Ergebnis der Regel-Engine verstaendlich erklaeren. */
router.post('/:id/ki/erklaeren', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'ki.nutzen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf den Assistenten nicht nutzen.' });
    return;
  }
  const limit = rateLimitPruefen(k.nutzer.id);
  if (!limit.erlaubt) {
    res.status(429).json({ fehler: `Zu viele Anfragen. Bitte ${limit.wartenSek} Sekunden warten.` });
    return;
  }
  try {
    const bericht = letzterBericht(k.projekt.id) ?? pruefungAusfuehren(k.projekt.id);
    const { ergebnisId } = req.body as { ergebnisId?: string };
    const ergebnis = bericht.ergebnisse.find((e) => e.id === ergebnisId);
    if (!ergebnis) {
      res.status(404).json({ fehler: 'Pruefergebnis nicht gefunden. Bitte die Pruefung neu ausfuehren.' });
      return;
    }
    const { regelwerk } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
    const kontext = baueKontext({
      inhalt: k.inhalt,
      gelaende: gelaendeStore.laden(k.projekt.gelaendeId),
      typen: typenIndex(),
      bericht,
      regelwerk,
    });
    const antwort = await erklaereBefund({ ergebnis, kontext });
    res.json({
      ...antwort,
      ergebnisId: ergebnis.id,
      // Die Zahlen kommen unveraendert aus der Regel-Engine — die KI rechnet nicht.
      istWert: ergebnis.istWert,
      sollWert: ergebnis.sollWert,
      fundstelle: ergebnis.fundstelle,
      verschiebung: ergebnis.empfehlung?.verschiebung ?? null,
    });
  } catch (e) {
    next(e);
  }
});

/** F7.2 — Frage und Antwort im Projektkontext. */
router.post('/:id/ki/frage', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'ki.nutzen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf den Assistenten nicht nutzen.' });
    return;
  }
  const limit = rateLimitPruefen(k.nutzer.id);
  if (!limit.erlaubt) {
    res.status(429).json({ fehler: `Zu viele Anfragen. Bitte ${limit.wartenSek} Sekunden warten.` });
    return;
  }
  const { frage, verlauf } = req.body as { frage?: string; verlauf?: { rolle: 'nutzer' | 'assistent'; text: string }[] };
  if (!frage?.trim()) {
    res.status(400).json({ fehler: 'Die Frage ist leer.' });
    return;
  }
  try {
    const bericht = letzterBericht(k.projekt.id) ?? pruefungAusfuehren(k.projekt.id);
    const { regelwerk } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
    const kontext = baueKontext({
      inhalt: k.inhalt,
      gelaende: gelaendeStore.laden(k.projekt.gelaendeId),
      typen: typenIndex(),
      bericht,
      regelwerk,
    });
    const antwort = await frageBeantworten({ frage: frage.trim(), kontext, verlauf });
    res.json({ ...antwort, am: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

/**
 * F7.3 — Platzieren auf Zuruf.
 * Diese Route SCHREIBT NICHTS. Sie liefert ausschliesslich Vorschlaege; das
 * Anlegen passiert erst, wenn der Nutzer sie im Editor bestaetigt (dann
 * ueber die normalen Objekt-Routen, mit Kennzeichnung im Aenderungslog).
 */
router.post('/:id/ki/platzieren', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  const k = projektKontext(req, res);
  if (!k) return;
  if (!darf(k.rolle, 'ki.nutzen') || !darf(k.rolle, 'element.anlegen')) {
    res.status(403).json({ fehler: 'Diese Rolle darf keine Objekte platzieren lassen.' });
    return;
  }
  const limit = rateLimitPruefen(k.nutzer.id);
  if (!limit.erlaubt) {
    res.status(429).json({ fehler: `Zu viele Anfragen. Bitte ${limit.wartenSek} Sekunden warten.` });
    return;
  }
  const { befehl } = req.body as { befehl?: string };
  if (!befehl?.trim()) {
    res.status(400).json({ fehler: 'Kein Kommando angegeben.' });
    return;
  }
  try {
    const g = gelaendeStore.laden(k.projekt.gelaendeId);
    if (!g) {
      res.status(400).json({ fehler: 'Zum Projekt ist kein Gelaende geladen.' });
      return;
    }
    const bericht = letzterBericht(k.projekt.id);
    const { regelwerk } = pruefKontext(k.inhalt, k.projekt.regelwerkId);
    const kontext = baueKontext({ inhalt: k.inhalt, gelaende: g, typen: typenIndex(), bericht: bericht ?? null, regelwerk });
    const antwort = await platzierenAufZuruf({
      befehl: befehl.trim(),
      kontext,
      typen: bibliothek().typen,
      gebiet: g.bbox,
    });
    res.json({
      ...antwort,
      hinweis: 'Vorschlag — nichts wurde gespeichert. Erst nach Ihrer Bestaetigung wird das Objekt angelegt.',
    });
  } catch (e) {
    next(e);
  }
});

export default router;
