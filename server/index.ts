/**
 * EventPlan3D — API-Server.
 *
 * Port 4720 ist bewusst fest verdrahtet und liest NICHT process.env.PORT:
 * Entwicklungs-Vorschauwerkzeuge setzen PORT auf den Frontend-Port und wuerden
 * damit beide Dienste auf denselben Port legen.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { cache, initStore, organisationen, projekte } from './lib/store.ts';
import { anmeldungNoetig, nutzerAusCookieHeader, sitzungLesen } from './lib/auth.ts';
import { rolleFuer } from './lib/rechte.ts';
import { bibliothek, regelwerkeLaden } from './lib/kataloge.ts';
import * as hub from './realtime/hub.ts';
import type { Teilnehmer } from './realtime/hub.ts';

import authRouter from './routes/auth.ts';
import gelaendeRouter from './routes/gelaende.ts';
import projekteRouter from './routes/projekte.ts';
import kollaborationRouter from './routes/kollaboration.ts';
import pruefungRouter from './routes/pruefung.ts';
import berichteRouter from './routes/berichte.ts';
import kiRouter from './routes/ki.ts';
import polizeiRouter from './routes/polizei.ts';

const PORT = 4720;

initStore();

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ limit: '80mb', type: ['text/plain', 'application/xyz'] }));
app.use(sitzungLesen);

app.use('/api/auth', authRouter);
app.use('/api/gelaende', gelaendeRouter);
app.use('/api/projekte', projekteRouter);
app.use('/api/projekte', kollaborationRouter);
app.use('/api/projekte', pruefungRouter);
app.use('/api/projekte', berichteRouter);
app.use('/api/projekte', kiRouter);
app.use('/api/polizei', polizeiRouter);

app.get('/api/bibliothek', (_req, res) => {
  res.json(bibliothek());
});

app.get('/api/regelwerke', (_req, res) => {
  const liste = [...new Map([...regelwerkeLaden().values()].map((r) => [`${r.id}@${r.version}`, r])).values()];
  res.json(
    liste.map((r) => ({
      id: r.id,
      version: r.version,
      bezeichnung: r.bezeichnung,
      bundesland: r.bundesland,
      stand: r.stand,
      haftungshinweis: r.haftungshinweis,
      quellen: r.quellen,
      regeln: r.regeln.length,
      zuPruefen: r.regeln.filter((x) => x.verifikation?.status === 'zu_pruefen').length,
    })),
  );
});

app.get('/api/regelwerke/:id', (req, res) => {
  const r = regelwerkeLaden().get(req.params.id);
  if (!r) {
    res.status(404).json({ fehler: 'Regelwerk nicht gefunden.' });
    return;
  }
  res.json(r);
});

app.get('/api/status', (_req, res) => {
  res.json({
    dienst: 'EventPlan3D',
    version: '1.0.0',
    zeit: new Date().toISOString(),
    projekte: projekte.liste().length,
    organisationen: organisationen.alle().length,
    kiVerfuegbar: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

/**
 * Bildschirmabzug der 3D-Szene fuer die Entwicklung.
 * Der Browser schickt `viewer.canvas.toDataURL()` hierher; das Bild landet in
 * data/cache/. Damit ist die Szene ueberpruefbar, ohne dass ein Werkzeug
 * WebGL-Frames abgreifen muss. Nur im Entwicklungsbetrieb erreichbar.
 */
app.post('/api/debug/snapshot', anmeldungNoetig, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).end();
    return;
  }
  const { bild, name } = req.body as { bild?: string; name?: string };
  const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(bild ?? '');
  if (!m) {
    res.status(400).json({ fehler: 'Kein gueltiges Bild empfangen (erwartet data:image/...;base64,...).' });
    return;
  }
  const datei = `${(name ?? 'snapshot').replace(/[^\w-]/g, '') || 'snapshot'}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
  const daten = Buffer.from(m[2], 'base64');
  cache.schreiben(daten, datei);
  // Nur den Dateinamen zurueckgeben — der absolute Serverpfad gehoert nicht in
  // eine API-Antwort.
  res.json({ ok: true, datei, bytes: daten.length });
});

// Gebaute Oberflaeche ausliefern, falls vorhanden (Produktionsbetrieb)
const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((fehler: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Fehler]', fehler);
  res.status(500).json({ fehler: fehler.message || 'Unbekannter Serverfehler.' });
});

const server = http.createServer(app);
// Gelaendeimport, Pruefungen und PDF-Erzeugung dauern; die Standardvorgabe von
// 5 Sekunden schliesst zwischendurch gepoolte Verbindungen der Clients und
// laesst deren naechste Anfrage auf einer toten Leitung auflaufen.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
server.requestTimeout = 0;

// --- WebSocket: ein Kanal je Projekt ---------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const nutzer = nutzerAusCookieHeader(req.headers.cookie);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const projektId = url.searchParams.get('projekt') ?? '';
  if (!nutzer) {
    hub.senden(ws, { art: 'fehler', text: 'Nicht angemeldet.' });
    ws.close();
    return;
  }
  const projekt = projekte.finde(projektId);
  if (!projekt) {
    hub.senden(ws, { art: 'fehler', text: 'Projekt nicht gefunden.' });
    ws.close();
    return;
  }
  const rolle = rolleFuer(nutzer, projekt);
  if (!rolle) {
    hub.senden(ws, { art: 'fehler', text: 'Kein Zugriff auf dieses Projekt.' });
    ws.close();
    return;
  }
  const org = organisationen.finde(nutzer.orgId);
  const teilnehmer: Teilnehmer = hub.beitreten(ws, nutzer, projektId, org?.name ?? '');

  ws.on('message', (roh) => {
    let n: Record<string, unknown>;
    try {
      n = JSON.parse(String(roh)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (n.art) {
      case 'cursor':
        hub.cursorSetzen(teilnehmer, (n.cursor as [number, number] | null) ?? null);
        break;
      case 'auswahl':
        hub.auswahlSetzen(teilnehmer, (n.auswahl as never) ?? []);
        break;
      case 'sperren': {
        const ref = n.elementRef as never;
        const sp = hub.sperren_setzen(projektId, ref, nutzer);
        if (!sp) {
          const halter = hub.sperreHalter(projektId, ref);
          hub.senden(ws, { art: 'fehler', text: `Element ist von ${halter?.nutzerName ?? 'jemand anderem'} gesperrt.` });
        }
        break;
      }
      case 'entsperren':
        hub.sperreLoesen(projektId, n.elementRef as never, nutzer.id);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => hub.verlassen(teilnehmer));
  ws.on('error', () => hub.verlassen(teilnehmer));
});

server.listen(PORT, '127.0.0.1', () => {
  const anzahlTypen = (() => {
    try {
      return bibliothek().typen.length;
    } catch (e) {
      console.error(`[Start] Objektbibliothek konnte nicht geladen werden: ${(e as Error).message}`);
      return 0;
    }
  })();
  const regelwerke = regelwerkeLaden();
  console.log(`EventPlan3D-API laeuft auf http://127.0.0.1:${PORT}`);
  console.log(`  Objekttypen: ${anzahlTypen} | Regelwerke: ${new Set([...regelwerke.values()].map((r) => r.id)).size} | Projekte: ${projekte.liste().length}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  Hinweis: ANTHROPIC_API_KEY nicht gesetzt — der KI-Assistent antwortet lokal und regelbasiert.');
  }
});
