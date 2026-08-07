/**
 * Laedt Objektbibliothek und Regelwerke von der Platte und haelt sie
 * versioniert im Speicher. Beide sind bewusst Daten, kein Code — sie sollen
 * ohne Neubau der Anwendung austauschbar sein.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Bibliothek, ObjektTyp, Regelwerk } from '../../shared/domain/types.ts';
import { PRUEF_TYPEN, OBJEKT_KATEGORIEN } from '../../shared/domain/types.ts';
import { objekttypenEigen } from './store.ts';

const BIB_DATEI = path.resolve(process.cwd(), 'shared', 'library', 'objekttypen.json');
const REGEL_DIR = path.resolve(process.cwd(), 'config', 'regelwerk');

let bibliothekCache: Bibliothek | null = null;

export function bibliothek(): Bibliothek {
  if (!bibliothekCache) {
    const roh = JSON.parse(fs.readFileSync(BIB_DATEI, 'utf8')) as Bibliothek;
    const fehler = bibliothekPruefen(roh);
    if (fehler.length) {
      throw new Error(`Objektbibliothek fehlerhaft:\n - ${fehler.join('\n - ')}`);
    }
    bibliothekCache = roh;
  }
  // Eigene Typen des Veranstalters kommen obendrauf
  return { ...bibliothekCache, typen: [...bibliothekCache.typen, ...objekttypenEigen.alle()] };
}

export function typenIndex(): Map<string, ObjektTyp> {
  const m = new Map<string, ObjektTyp>();
  for (const t of bibliothek().typen) m.set(t.id, t);
  return m;
}

export function typ(id: string): ObjektTyp | undefined {
  return typenIndex().get(id);
}

export function bibliothekNeuLaden() {
  bibliothekCache = null;
}

function bibliothekPruefen(b: Bibliothek): string[] {
  const fehler: string[] = [];
  if (!Array.isArray(b.typen) || !b.typen.length) return ['Keine Objekttypen enthalten.'];
  const ids = new Set<string>();
  for (const t of b.typen) {
    if (!t.id) fehler.push('Ein Typ ohne id.');
    else if (ids.has(t.id)) fehler.push(`Doppelte id: ${t.id}`);
    ids.add(t.id);
    if (!OBJEKT_KATEGORIEN.includes(t.kategorie)) fehler.push(`${t.id}: unbekannte Kategorie „${t.kategorie}“.`);
    if (!t.masse || !(t.masse.laenge > 0) || !(t.masse.breite > 0) || !(t.masse.hoehe > 0)) {
      fehler.push(`${t.id}: Masse unvollstaendig oder nicht positiv.`);
    }
    if (t.form === 'kreis' && Math.abs(t.masse.laenge - t.masse.breite) > 1e-6) {
      fehler.push(`${t.id}: form „kreis“, aber Laenge ${t.masse.laenge} != Breite ${t.masse.breite}.`);
    }
    if (t.parametrisierbar) {
      for (const feld of ['laenge', 'breite', 'hoehe'] as const) {
        const g = t.minMax?.[feld];
        const w = t.masse[feld];
        if (!g || g.length !== 2) fehler.push(`${t.id}: minMax.${feld} fehlt.`);
        else if (w < g[0] - 1e-9 || w > g[1] + 1e-9) fehler.push(`${t.id}: Grundmass ${feld} ${w} liegt ausserhalb ${g[0]}-${g[1]}.`);
      }
    }
    if (!t.quelleMasse) fehler.push(`${t.id}: quelleMasse fehlt (Nachweispflicht).`);
  }
  return fehler;
}

// ---------------------------------------------------------------------------

const regelwerke = new Map<string, Regelwerk>();

export function regelwerkeLaden(): Map<string, Regelwerk> {
  if (regelwerke.size) return regelwerke;
  if (!fs.existsSync(REGEL_DIR)) return regelwerke;
  for (const datei of fs.readdirSync(REGEL_DIR)) {
    if (!datei.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REGEL_DIR, datei), 'utf8')) as Regelwerk;
      const fehler = regelwerkPruefen(r);
      if (fehler.length) {
        console.warn(`[Regelwerk] ${datei} wird uebersprungen:\n - ${fehler.join('\n - ')}`);
        continue;
      }
      regelwerke.set(`${r.id}@${r.version}`, r);
      // Kurzform: letzte Version gewinnt
      regelwerke.set(r.id, r);
    } catch (e) {
      console.warn(`[Regelwerk] ${datei} nicht lesbar: ${(e as Error).message}`);
    }
  }
  return regelwerke;
}

export function regelwerk(id: string): Regelwerk | undefined {
  return regelwerkeLaden().get(id);
}

export function regelwerkListe(): { id: string; version: string; bezeichnung: string; bundesland: string; stand: string; regeln: number; zuPruefen: number }[] {
  const gesehen = new Set<string>();
  const out: ReturnType<typeof regelwerkListe> = [];
  for (const r of regelwerkeLaden().values()) {
    const schluessel = `${r.id}@${r.version}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    out.push({
      id: r.id,
      version: r.version,
      bezeichnung: r.bezeichnung,
      bundesland: r.bundesland,
      stand: r.stand,
      regeln: r.regeln.length,
      zuPruefen: r.regeln.filter((x) => x.verifikation?.status === 'zu_pruefen').length,
    });
  }
  return out;
}

function regelwerkPruefen(r: Regelwerk): string[] {
  const fehler: string[] = [];
  if (!r.id) fehler.push('id fehlt.');
  if (!r.version) fehler.push('version fehlt.');
  if (!r.haftungshinweis) fehler.push('haftungshinweis fehlt (Pflicht laut Lastenheft F8.3).');
  if (!Array.isArray(r.regeln) || !r.regeln.length) return [...fehler, 'Keine Regeln enthalten.'];
  const ids = new Set<string>();
  for (const g of r.regeln) {
    if (!g.id) fehler.push('Regel ohne id.');
    else if (ids.has(g.id)) fehler.push(`Doppelte Regel-id: ${g.id}`);
    ids.add(g.id);
    if (!PRUEF_TYPEN.includes(g.pruefTyp)) fehler.push(`${g.id}: unbekannter pruefTyp „${g.pruefTyp}“.`);
    if (!g.quelle?.kuerzel || !g.quelle?.paragraf) fehler.push(`${g.id}: Fundstelle unvollstaendig.`);
    if (!['fehler', 'warnung', 'hinweis'].includes(g.schweregrad)) fehler.push(`${g.id}: schweregrad „${g.schweregrad}“ unbekannt.`);
    if (!g.verifikation?.status) fehler.push(`${g.id}: verifikation.status fehlt.`);
  }
  return fehler;
}

export function regelwerkNeuLaden() {
  regelwerke.clear();
}
