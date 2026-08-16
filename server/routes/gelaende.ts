import fs from 'node:fs';
import { Router } from 'express';
import type { AuthRequest } from '../lib/auth.ts';
import { anmeldungNoetig } from '../lib/auth.ts';
import { darf, rolleFuer } from '../lib/rechte.ts';
import { gelaende as gelaendeStore, organisationen, projekte } from '../lib/store.ts';
import { bboxNachUtm, bboxNachWgs } from '../../shared/geo/proj.ts';
import { bboxFlaeche } from '../../shared/geo/geometry.ts';
import * as geocode from '../geodata/geocode.ts';
import * as gelaendeImport from '../geodata/gelaende.ts';
import { karte } from '../geodata/wms.ts';
import { geoKonfig, verfuegbareLaender } from '../geodata/konfig.ts';

const router = Router();

/** Rolle: Gelaende darf anlegen, wer irgendwo Veranstalter oder Admin ist. */
function darfGelaendeAnlegen(req: AuthRequest): boolean {
  const org = organisationen.finde(req.nutzer!.orgId);
  return org?.typ === 'veranstalter' || org?.typ === 'plattform';
}

router.get('/suche', anmeldungNoetig, async (req: AuthRequest, res, next) => {
  try {
    const q = String(req.query.q ?? '');
    res.json(await geocode.suche(q, String(req.query.land ?? 'hessen')));
  } catch (e) {
    next(e);
  }
});

router.get('/laender', (_req, res) => {
  res.json(
    verfuegbareLaender().map((code) => {
      const k = geoKonfig(code);
      return { code, name: k.name, epsg: k.epsg, stand: k.stand };
    }),
  );
});

router.get('/', anmeldungNoetig, (_req, res) => {
  res.json(gelaendeStore.liste());
});

/**
 * Ein Gelaende ausliefern.
 *
 * SCHNELLER WEG (seit 16.08.2026): Die Datei IST bereits die gewuenschte
 * Antwort — sie wird gestreamt, nicht geparst. Vorher las die Route 14 MB,
 * baute daraus ein Objekt, haengte `bbox4326` an und serialisierte alles
 * zurueck: 459 ms je Aufruf, davon der groesste Teil blockierte den
 * einthreadigen Server fuer alle anderen.
 *
 * Liegt eine vorkomprimierte `.gz` daneben und versteht der Browser gzip, geht
 * sie raus — 14,3 MB werden zu rund 2 MB, ohne dass jemand dafuer rechnet.
 * Die Frische wird ueber die Aenderungszeit geprueft: eine `.gz`, die aelter
 * ist als die Quelle (etwa nach `POST /:id/dachfarben` mit altem Code), wird
 * nicht benutzt.
 *
 * ETag statt langer Verfallszeit: Gelaende sind fast unveraenderlich, aber
 * eben nur fast (die Dachfarben-Messung schreibt sie neu). Mit ETag kostet das
 * zweite Oeffnen desselben Gelaendes einen 304 statt 14 MB — und eine
 * Aenderung kommt trotzdem sofort an.
 */
router.get('/:id', anmeldungNoetig, (req, res) => {
  if (!GELAENDE_ID.test(req.params.id)) {
    res.status(400).json({ fehler: 'Ungueltiger Gelaende-Bezeichner.' });
    return;
  }
  const kopf = gelaendeStore.kopf(req.params.id);
  const datei = gelaendeStore.datei(req.params.id);
  if (kopf?.hatBbox4326 && fs.existsSync(datei)) {
    const gz = gelaendeStore.gzDatei(req.params.id);
    const roh = fs.statSync(datei);
    let gzFrisch = false;
    try {
      gzFrisch = fs.statSync(gz).mtimeMs >= roh.mtimeMs;
    } catch {
      gzFrisch = false;
    }
    res.type('application/json');
    res.setHeader('Cache-Control', 'private, no-cache');
    if (gzFrisch && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      res.setHeader('Content-Encoding', 'gzip');
      // Der ETag muss an der QUELLE haengen, nicht an der .gz — sonst haetten
      // komprimierte und unkomprimierte Auslieferung verschiedene Marken fuer
      // denselben Inhalt.
      res.setHeader('ETag', `W/"${roh.size}-${Math.round(roh.mtimeMs)}"`);
      if (req.headers['if-none-match'] === res.getHeader('ETag')) {
        res.status(304).end();
        return;
      }
      fs.createReadStream(gz).pipe(res);
      return;
    }
    res.setHeader('ETag', `W/"${roh.size}-${Math.round(roh.mtimeMs)}"`);
    if (req.headers['if-none-match'] === res.getHeader('ETag')) {
      res.status(304).end();
      return;
    }
    fs.createReadStream(datei).pipe(res);
    return;
  }

  // Rueckfallweg fuer Gelaende aus Importen vor dem 16.08.2026: ihnen fehlt
  // `bbox4326` in der Datei, also muss sie hier entstehen.
  const g = gelaendeStore.laden(req.params.id);
  if (!g) {
    res.status(404).json({ fehler: 'Gelaende nicht gefunden.' });
    return;
  }
  res.json({ ...g, bbox4326: bboxNachWgs(g.bbox) });
});

/**
 * Textur einer Gelaendekachel.
 *
 * SICHERHEIT (Befund 07.08.2026): Die Route war unangemeldet erreichbar und
 * hat den Gelaende-Bezeichner ungeprueft in den Dateipfad uebernommen. Jetzt
 * gilt Anmeldepflicht, und der Bezeichner muss dem vergebenen Muster
 * entsprechen; `texturPfad` prueft zusaetzlich die Einbettung im Datenordner.
 */
const GELAENDE_ID = /^[A-Za-z0-9_-]+$/;

router.get('/:id/textur/:datei', anmeldungNoetig, (req, res) => {
  if (!GELAENDE_ID.test(req.params.id)) {
    res.status(400).json({ fehler: 'Ungueltiger Gelaende-Bezeichner.' });
    return;
  }
  let p: string;
  try {
    p = gelaendeStore.texturPfad(req.params.id, req.params.datei);
  } catch {
    res.status(400).json({ fehler: 'Ungueltiger Texturpfad.' });
    return;
  }
  if (!fs.existsSync(p)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(p.endsWith('.png') ? 'image/png' : 'image/jpeg');
  fs.createReadStream(p).pipe(res);
});

/**
 * Binaeres Hoehenraster eines Gelaendes (shared/geo/raster.ts).
 *
 * Der Browser holt es als ArrayBuffer und legt eine Float32Array darueber —
 * ohne Umwandlung, ohne Textparser. Es ist unveraenderlich, sobald es
 * geschrieben ist (ein neuer Import legt ein neues Gelaende an), darum darf es
 * lange zwischengespeichert werden.
 */
router.get('/:id/hoehen.bin', anmeldungNoetig, (req, res) => {
  if (!GELAENDE_ID.test(req.params.id)) {
    res.status(400).json({ fehler: 'Ungueltiger Gelaende-Bezeichner.' });
    return;
  }
  let p: string;
  try {
    p = gelaendeStore.rasterPfad(req.params.id);
  } catch {
    res.status(400).json({ fehler: 'Ungueltiger Rasterpfad.' });
    return;
  }
  if (!fs.existsSync(p)) {
    res.status(404).json({ fehler: 'Fuer dieses Gelaende gibt es kein Hoehenraster (Import vor dem 09.08.2026).' });
    return;
  }
  // NACHPRUEFEN STATT BLIND VERTRAUEN (16.08.2026): Frueher stand hier
  // `immutable` mit einer Woche Gueltigkeit — und der Browser holte das Raster
  // trotzdem jedes Mal neu, weil die Gegenseite `cache: 'no-store'` setzte. Der
  // Grund dort war richtig: wird ein Gelaende unter derselben Id neu
  // eingesetzt, waere ein alter Zwischenspeicher ein FALSCHES Hoehenmodell,
  // und das faellt niemandem auf. `no-cache` loest beides: der Browser fragt
  // kurz nach, der Server antwortet bei unveraendertem Raster mit 304 (ein
  // paar Byte statt 10 MB) und bei geaendertem mit den neuen Daten.
  // `res.sendFile` setzt ETag und Last-Modified und beantwortet bedingte
  // Anfragen von allein.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type('application/octet-stream');
  res.sendFile(p);
});

/** Kartenkachel fuer die 2D-Ansicht (Liegenschaftskarte / Topo-Kaskade). */
router.get('/karte/kachel', async (req, res, next) => {
  try {
    const minE = Number(req.query.minE);
    const minN = Number(req.query.minN);
    const maxE = Number(req.query.maxE);
    const maxN = Number(req.query.maxN);
    const px = Math.min(2048, Math.max(64, Number(req.query.px) || 512));
    if (![minE, minN, maxE, maxN].every(Number.isFinite)) {
      res.status(400).json({ fehler: 'minE, minN, maxE, maxN erforderlich (EPSG:25832).' });
      return;
    }
    const schluessel = `karte_${Math.round(minE)}_${Math.round(minN)}_${Math.round(maxE - minE)}_${px}.png`;
    const k = await karte({ minE, minN, maxE, maxN }, px, px, String(req.query.land ?? 'hessen'), schluessel);
    if (k.leer) {
      res.status(204).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Karte-Layer', k.layer);
    res.type('image/png').send(k.daten);
  } catch (e) {
    next(e);
  }
});

/** Import starten (F1). Laeuft im Hintergrund, Fortschritt ueber /auftrag/:id. */
router.post('/import', anmeldungNoetig, (req: AuthRequest, res) => {
  if (!darfGelaendeAnlegen(req)) {
    res.status(403).json({ fehler: 'Nur Veranstalter und Plattform-Admins koennen ein Gelaende importieren.' });
    return;
  }
  const body = req.body as {
    name?: string;
    bbox25832?: { minE: number; minN: number; maxE: number; maxN: number };
    bbox4326?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
    land?: string;
    kreis?: string;
    ohneLuftbild?: boolean;
    texturPx?: number;
  };
  if (!body.name) {
    res.status(400).json({ fehler: 'Ein Name fuer das Gelaende ist erforderlich.' });
    return;
  }
  const bbox = body.bbox25832 ?? (body.bbox4326 ? bboxNachUtm(body.bbox4326) : null);
  if (!bbox) {
    res.status(400).json({ fehler: 'Gebiet fehlt: bbox25832 oder bbox4326 angeben.' });
    return;
  }
  if (!(bbox.maxE > bbox.minE) || !(bbox.maxN > bbox.minN)) {
    res.status(400).json({ fehler: 'Das Gebiet ist leer oder verdreht.' });
    return;
  }
  try {
    const auftrag = gelaendeImport.importStarten({
      name: body.name,
      bbox,
      land: body.land,
      kreis: body.kreis,
      nutzerId: req.nutzer!.id,
      ohneLuftbild: body.ohneLuftbild,
      texturPx: body.texturPx,
    });
    res.status(202).json(auftrag);
  } catch (e) {
    res.status(400).json({ fehler: (e as Error).message });
  }
});

router.get('/import/auftrag/:id', anmeldungNoetig, (req, res) => {
  const a = gelaendeImport.auftrag(req.params.id);
  if (!a) {
    res.status(404).json({ fehler: 'Auftrag nicht gefunden.' });
    return;
  }
  res.json(a);
});

router.get('/import/auftraege', anmeldungNoetig, (_req, res) => {
  res.json(gelaendeImport.alleAuftraege());
});

/** Vorschau: wie gross waere das Gebiet? */
router.post('/import/pruefen', anmeldungNoetig, (req, res) => {
  const body = req.body as { bbox25832?: never; bbox4326?: never };
  const bbox = body.bbox25832 ?? (body.bbox4326 ? bboxNachUtm(body.bbox4326) : null);
  if (!bbox) {
    res.status(400).json({ fehler: 'Gebiet fehlt.' });
    return;
  }
  const flaeche = bboxFlaeche(bbox);
  res.json({
    bbox25832: bbox,
    bbox4326: bboxNachWgs(bbox),
    flaecheM2: Math.round(flaeche),
    flaecheKm2: +(flaeche / 1_000_000).toFixed(3),
    zulaessig: flaeche <= gelaendeImport.MAX_GEBIET_M2,
    grenzeKm2: gelaendeImport.MAX_GEBIET_M2 / 1_000_000,
  });
});

/**
 * Dachfarben aus dem DOP20-Orthophoto messen (Medianfarbe je Grundriss).
 * Ein eigener Schritt nach dem Import: er braucht nur die schon geladenen
 * Gelaendetexturen und ersetzt die bisher deterministisch GEWAEHLTEN
 * Dachtoene durch GEMESSENE.
 */
router.post('/:id/dachfarben', anmeldungNoetig, async (req: AuthRequest, res) => {
  if (!darfGelaendeAnlegen(req)) {
    res.status(403).json({ fehler: 'Nur Veranstalter und Plattform-Admins duerfen Dachfarben messen.' });
    return;
  }
  const g = gelaendeStore.laden(req.params.id);
  if (!g) {
    res.status(404).json({ fehler: 'Gelaende nicht gefunden.' });
    return;
  }
  try {
    const { dachfarbenMessen } = await import('../geodata/dachfarben.ts');
    const bilanz = dachfarbenMessen(g);
    if (bilanz.gemessen > 0) {
      g.quellennachweis = (g.quellennachweis ?? []).filter((q) => q.datensatz !== 'Dachfarben aus DOP20');
      g.quellennachweis.push({
        datensatz: 'Dachfarben aus DOP20',
        dienst: 'Medianfarbe der Orthophoto-Pixel je Gebaeudegrundriss (lokal gemessen)',
        url: 'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
        abgerufenAm: new Date().toISOString(),
        lizenz: 'Datenlizenz Deutschland — Zero, Version 2.0 (Open Data HVBG)',
        quellenvermerk: '(c) HVBG, DOP20',
        hinweis: `${bilanz.gemessen} Daecher gemessen, ${bilanz.uebersprungen} ohne ausreichende Bildabdeckung.`,
      });
      gelaendeStore.speichern(g);
    }
    res.json(bilanz);
  } catch (e) {
    res.status(500).json({ fehler: (e as Error).message });
  }
});

/** Manueller DGM1-Import (Fallback laut Lastenheft F1, weil Hessen keine Direktlinks bietet). */
router.post('/:id/dgm', anmeldungNoetig, (req: AuthRequest, res) => {
  if (!darfGelaendeAnlegen(req)) {
    res.status(403).json({ fehler: 'Nur Veranstalter und Plattform-Admins duerfen Hoehendaten einspielen.' });
    return;
  }
  const inhalt = typeof req.body === 'string' ? req.body : (req.body as { inhalt?: string }).inhalt;
  if (!inhalt) {
    res.status(400).json({ fehler: 'Dateiinhalt fehlt (XYZ oder ESRI-ASCII-Grid als Text senden).' });
    return;
  }
  try {
    res.json(gelaendeImport.dgmImportieren(req.params.id, inhalt));
  } catch (e) {
    res.status(400).json({ fehler: (e as Error).message });
  }
});

/** Welche Projekte nutzen dieses Gelaende? */
router.get('/:id/projekte', anmeldungNoetig, (req: AuthRequest, res) => {
  const liste = projekte
    .liste()
    .filter((p) => p.gelaendeId === req.params.id)
    .filter((p) => Boolean(rolleFuer(req.nutzer!, p)))
    .map((p) => ({ id: p.id, name: p.name, status: p.status }));
  res.json(liste);
});

router.delete('/:id', anmeldungNoetig, (req: AuthRequest, res) => {
  const org = organisationen.finde(req.nutzer!.orgId);
  if (org?.typ !== 'plattform') {
    res.status(403).json({ fehler: 'Nur Plattform-Admins koennen ein Gelaende loeschen.' });
    return;
  }
  const genutzt = projekte.liste().filter((p) => p.gelaendeId === req.params.id);
  if (genutzt.length) {
    res.status(409).json({ fehler: `Das Gelaende wird noch von ${genutzt.length} Projekt(en) genutzt.` });
    return;
  }
  fs.rmSync(gelaendeStore.verzeichnis(req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

export default router;

// Beruhigt den Typpruefer: darf() wird in dieser Datei ueber die
// Organisationstypen abgebildet, bleibt aber als Importziel dokumentiert.
void darf;
