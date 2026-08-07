/**
 * Authentifizierung: E-Mail + Passwort (scrypt), Sitzung als signiertes Cookie.
 * OIDC-faehig vorbereitet — der Sitzungsaufbau haengt an `sitzungAnlegen`,
 * ein OIDC-Callback muesste nur dort einhaengen.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Nutzer, NutzerOeffentlich } from '../../shared/domain/types.ts';
import { nutzer as nutzerTabelle, organisationen, id, jetzt } from './store.ts';

/**
 * Sitzungsgeheimnis.
 *
 * SICHERHEIT (Befund 07.08.2026): Das Ersatzgeheimnis fuer den
 * Entwicklungsbetrieb wird aus dem Installationspfad abgeleitet und ist damit
 * NICHT geheim — wer den Pfad kennt, kann ein Sitzungscookie fuer einen
 * beliebigen Nutzer selbst berechnen, auch fuer den Plattform-Admin. Das ist
 * fuer den lokalen Einzelplatzbetrieb hinnehmbar (der Dienst lauscht nur auf
 * 127.0.0.1), fuer einen Mehrbenutzer- oder Netzbetrieb aber nicht.
 * Darum: im Produktivbetrieb wird HEINERFEST_SECRET erzwungen.
 */
const GEHEIMNIS = (() => {
  const gesetzt = (process.env.HEINERFEST_SECRET ?? '').trim();
  if (gesetzt.length > 0) {
    if (gesetzt.length < 32) {
      throw new Error('HEINERFEST_SECRET ist zu kurz — bitte mindestens 32 zufaellige Zeichen verwenden.');
    }
    return gesetzt;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'HEINERFEST_SECRET fehlt. Im Produktivbetrieb muss das Sitzungsgeheimnis aus der Umgebung kommen — ' +
        'das abgeleitete Entwicklungsgeheimnis ist aus dem Installationspfad berechenbar und erlaubt gefaelschte Sitzungen. ' +
        'Beispiel: HEINERFEST_SECRET=$(node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))")',
    );
  }
  console.warn(
    '[Sicherheit] HEINERFEST_SECRET ist nicht gesetzt — es wird ein aus dem Installationspfad abgeleitetes ' +
      'Entwicklungsgeheimnis verwendet. Sitzungscookies sind damit faelschbar. Nur fuer den lokalen Betrieb geeignet.',
  );
  return crypto.createHash('sha256').update(`heinerfest-dev-${process.cwd()}`).digest('hex');
})();

const COOKIE = 'heinerfest_sitzung';
const GUELTIG_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * `secure` setzt das Cookie nur ueber HTTPS. Im lokalen Betrieb laeuft alles
 * ueber http://127.0.0.1 — dort wuerde `secure` die Anmeldung unmoeglich
 * machen. Darum ueber die Umgebung schaltbar (HEINERFEST_HTTPS=1).
 */
const COOKIE_SECURE = process.env.HEINERFEST_HTTPS === '1' || process.env.NODE_ENV === 'production';

export function passwortHashen(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function passwortPruefen(pw: string, gespeichert: string): boolean {
  const [saltHex, hashHex] = gespeichert.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const soll = Buffer.from(hashHex, 'hex');
  return hash.length === soll.length && crypto.timingSafeEqual(hash, soll);
}

function signieren(nutzlast: string): string {
  const sig = crypto.createHmac('sha256', GEHEIMNIS).update(nutzlast).digest('base64url');
  return `${nutzlast}.${sig}`;
}

function pruefen(token: string): { nutzerId: string; bis: number } | null {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const nutzlast = token.slice(0, i);
  const sig = token.slice(i + 1);
  const soll = crypto.createHmac('sha256', GEHEIMNIS).update(nutzlast).digest('base64url');
  if (sig.length !== soll.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(soll))) return null;
  try {
    const daten = JSON.parse(Buffer.from(nutzlast, 'base64url').toString('utf8')) as { nutzerId: string; bis: number };
    if (daten.bis < Date.now()) return null;
    return daten;
  } catch {
    return null;
  }
}

export function sitzungAnlegen(res: Response, n: Nutzer) {
  const nutzlast = Buffer.from(JSON.stringify({ nutzerId: n.id, bis: Date.now() + GUELTIG_MS }), 'utf8').toString('base64url');
  res.cookie(COOKIE, signieren(nutzlast), {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: GUELTIG_MS,
    path: '/',
  });
  nutzerTabelle.aendern(n.id, { letzterBesuch: jetzt() });
}

export function sitzungBeenden(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Liest die Sitzung aus einem Cookie-Header (auch fuer die WebSocket-Verbindung). */
export function nutzerAusCookieHeader(header: string | undefined): Nutzer | null {
  if (!header) return null;
  for (const teil of header.split(';')) {
    const [k, ...rest] = teil.trim().split('=');
    if (k !== COOKIE) continue;
    const daten = pruefen(decodeURIComponent(rest.join('=')));
    if (!daten) return null;
    return nutzerTabelle.finde(daten.nutzerId) ?? null;
  }
  return null;
}

export interface AuthRequest extends Request {
  nutzer?: Nutzer;
}

export function sitzungLesen(req: AuthRequest, _res: Response, next: NextFunction) {
  req.nutzer = nutzerAusCookieHeader(req.headers.cookie) ?? undefined;
  next();
}

export function anmeldungNoetig(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.nutzer) {
    res.status(401).json({ fehler: 'Nicht angemeldet.' });
    return;
  }
  next();
}

export function oeffentlich(n: Nutzer): NutzerOeffentlich {
  const org = organisationen.finde(n.orgId);
  return {
    id: n.id,
    orgId: n.orgId,
    orgName: org?.name ?? 'Unbekannte Organisation',
    orgTyp: org?.typ ?? 'veranstalter',
    name: n.name,
    email: n.email,
    rolleInOrg: n.rolleInOrg,
  };
}

export function nutzerAnlegen(orgId: string, name: string, email: string, passwort: string, rolleInOrg: 'admin' | 'mitglied' = 'mitglied'): Nutzer {
  const vorhanden = nutzerTabelle.eines((n) => n.email.toLowerCase() === email.toLowerCase());
  if (vorhanden) throw new Error(`E-Mail ${email} ist bereits vergeben.`);
  return nutzerTabelle.einfuegen({
    id: id('u_'),
    orgId,
    name,
    email,
    passwortHash: passwortHashen(passwort),
    rolleInOrg,
    erstelltAm: jetzt(),
  });
}

export function anmelden(email: string, passwort: string): Nutzer | null {
  const n = nutzerTabelle.eines((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!n) return null;
  return passwortPruefen(passwort, n.passwortHash) ? n : null;
}
