import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmelden, anmeldungNoetig, nutzerAnlegen, oeffentlich, sitzungAnlegen, sitzungBeenden } from '../lib/auth.ts';
import { benachrichtigungen, nutzer, organisationen } from '../lib/store.ts';

const router = Router();

router.post('/anmelden', (req: AuthRequest, res) => {
  const { email, passwort } = req.body as { email?: string; passwort?: string };
  if (!email || !passwort) {
    res.status(400).json({ fehler: 'E-Mail und Passwort sind erforderlich.' });
    return;
  }
  const n = anmelden(email, passwort);
  if (!n) {
    res.status(401).json({ fehler: 'E-Mail oder Passwort stimmt nicht.' });
    return;
  }
  sitzungAnlegen(res, n);
  res.json(oeffentlich(n));
});

router.post('/abmelden', (_req, res) => {
  sitzungBeenden(res);
  res.json({ ok: true });
});

router.get('/ich', (req: AuthRequest, res) => {
  if (!req.nutzer) {
    res.status(401).json({ fehler: 'Nicht angemeldet.' });
    return;
  }
  res.json(oeffentlich(req.nutzer));
});

/** Registrierung — im lokalen Betrieb offen, damit Rollen ausprobierbar sind. */
router.post('/registrieren', (req: AuthRequest, res) => {
  const { name, email, passwort, orgId } = req.body as Record<string, string>;
  if (!name || !email || !passwort || !orgId) {
    res.status(400).json({ fehler: 'Name, E-Mail, Passwort und Organisation sind erforderlich.' });
    return;
  }
  if (passwort.length < 8) {
    res.status(400).json({ fehler: 'Das Passwort muss mindestens 8 Zeichen haben.' });
    return;
  }
  if (!organisationen.finde(orgId)) {
    res.status(400).json({ fehler: 'Unbekannte Organisation.' });
    return;
  }
  try {
    const n = nutzerAnlegen(orgId, name, email, passwort);
    sitzungAnlegen(res, n);
    res.status(201).json(oeffentlich(n));
  } catch (e) {
    res.status(409).json({ fehler: (e as Error).message });
  }
});

/** Organisationen als Mandanten — fuer Einladungen und die Registrierung. */
router.get('/organisationen', (_req, res) => {
  res.json(
    organisationen.alle().map((o) => ({
      id: o.id,
      name: o.name,
      typ: o.typ,
      zustaendigkeitsgebiet: o.zustaendigkeitsgebiet,
      nutzer: nutzer.suche((n) => n.orgId === o.id).length,
    })),
  );
});

router.get('/benachrichtigungen', anmeldungNoetig, (req: AuthRequest, res) => {
  res.json(benachrichtigungen.fuerNutzer(req.nutzer!.id));
});

router.post('/benachrichtigungen/gelesen', anmeldungNoetig, (req: AuthRequest, res) => {
  const { ids } = req.body as { ids?: string[] };
  benachrichtigungen.gelesen(req.nutzer!.id, ids ?? []);
  res.json({ ok: true });
});

export default router;
