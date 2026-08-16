# Auf einem anderen Rechner in Betrieb nehmen

Diese Anleitung bringt eine frische Maschine auf denselben Stand wie der
Entwicklungsrechner — einschließlich der 3D-Ansicht „Darmstadt Innenstadt +
Mathildenhöhe" mit 5.471 Baukörpern.

Anlass: die Plattform soll auf stärkerer Hardware gemessen werden
(siehe [`LEISTUNG.md`](LEISTUNG.md)).

---

## 1. Was `git pull` mitbringt — und was nicht

**Mit dabei:** der gesamte Programmtext, die Regelwerke (`config/regelwerk/`),
die Bauklassen (`config/bauklassen/`), die Objektbibliothek, alle Dokumente und
alle Skripte. Das sind rund 3 MB.

**Nicht dabei** (bewusst, `.gitignore`): alles unter `data/`. Das sind die
Laufzeit- und Fremddaten:

| Ordner | Umfang hier | Herkunft |
|---|---|---|
| `data/osm-auszug/hessen-latest.osm.pbf` | 328 MB | Geofabrik, Skript vorhanden |
| `data/cache/dgm1/Darmstadt - DGM1.zip` | 334 MB | HVBG-Downloadcenter |
| `data/cache/lod2/` | 312 MB | HVBG, aufbereiteter Zwischenspeicher |
| `data/cache/wms/` | 1,1 GB | Luftbildkacheln, regenerierbar |
| `data/cache/baumkataster/` | 14 MB | 3d.darmstadt.de, Skripte vorhanden |
| `data/gelaende/<id>/` | 39 MB je Pilotgebiet | Ergebnis des Imports |
| `data/projekte/`, `data/nutzer.json` … | < 1 MB | `npm run seed` + eigene Arbeit |

Grund: Fremddaten mit eigener Herkunft und Prüfsumme gehören nicht in die
Versionsverwaltung, und Importergebnisse sind reproduzierbar. Für die Übernahme
gibt es deshalb **zwei Wege** — Weg A ist schnell, Weg B ist sauber.

---

## 2. Grundinstallation (beide Wege)

Voraussetzung: **Node.js 22.6 oder neuer** (der Server führt TypeScript ohne
Übersetzungsschritt aus).

```bash
git clone https://github.com/toulja/lumus_adv.git heinerfest
cd heinerfest
npm install
npm run seed
```

`npm run seed` legt Organisationen und Konten an (Tabelle im
[README](../README.md)). Ohne diesen Schritt findet der Geländeimport keinen
Anleger und bricht ab.

---

## 3. Weg A — Daten mitkopieren (schnell, empfohlen für die Messung)

Vom alten Rechner den Ordner `data/` übernehmen. Für den vollen Stand genügen
diese Teile:

```bash
data/gelaende/gel_8e8c8905b47a5300/    # das Pilotgelände (39 MB)
data/projekte/                          # die Projekte samt Änderungsprotokoll
data/nutzer.json data/organisationen.json data/mitgliedschaften.json
```

Wer auch **neue Gebiete importieren** will, nimmt zusätzlich die Quellen mit —
sonst müssen sie neu geladen werden:

```bash
data/osm-auszug/                         # 328 MB
data/cache/dgm1/                         # 334 MB
data/cache/lod2/                         # 312 MB
data/cache/baumkataster/                 # 14 MB
```

`data/cache/wms/` (1,1 GB Luftbildkacheln) kann bleiben, wo es ist — es baut
sich bei Bedarf neu auf.

Unter Windows, wenn beide Rechner im selben Netz sind:

```bash
robocopy "\\ALTERPC\QWEN\Heinerfest\data" "C:\Pfad\zu\heinerfest\data" /E /XD wms
```

Danach:

```bash
npm run dev
```

Die Konten sind dieselben. Das Projekt heißt „Darmstadt 3D — HIER KLICKEN".

> **Achtung bei Handeingriffen in `data/`:** Der laufende Server hält Projekte im
> Arbeitsspeicher (`projektCache` in `server/lib/store.ts`). Dateien nur bei
> gestopptem Server tauschen, sonst überschreibt der Server sie wieder.

---

## 4. Weg B — alles neu aufbauen

Nur Programmtext, alle Daten frisch. Dauert je nach Leitung und Rechner ein bis
mehrere Stunden, ist dafür der ehrliche Test der ganzen Kette.

### 4.1 OSM-Ortsauszug holen (328 MB)

```bash
node scripts/osm-auszug-holen.ts
```

Pflicht. Ohne ihn fragt der Import die Overpass-API — das ist bei mehreren
Kacheln ein Massenabruf, den die Overpass-Regeln abweisen (zwei Stadtläufe sind
daran gescheitert, 11.08.2026). **`overpass.osm.ch` niemals verwenden**: der
Dienst antwortet mit HTTP 200 und liefert für Darmstadt null Gebäude.

### 4.2 Baumkataster holen (optional, 36.409 Bäume)

```bash
node scripts/baumkataster-holen.ts
node scripts/baumarten-holen.ts
```

Ohne diesen Schritt kommen die Bäume allein aus OSM — deutlich weniger und ohne
amtliche Höhe, Kronendurchmesser und Art.

### 4.3 DGM1 bereitstellen (334 MB)

Das Geländemodell wird beim Import automatisch mitgelesen, wenn das Archiv
gefunden wird. Gesucht wird an zwei Stellen
([`server/geodata/dgm.ts:136`](../server/geodata/dgm.ts)):

1. Umgebungsvariable `HEINERFEST_DGM1` (Datei oder Ordner),
2. sonst `data/cache/dgm1/` — dort genügt das ZIP.

Bezugsweg (HVBG-Downloadcenter, in `docs/DATENQUELLEN.md` belegt):

```
downloadcenter/<JJJJMMTT>/3D-Daten/Digitales Geländemodell (DGM1)/<Kreis>/<Gemeinde> - DGM1.zip
```

Ohne DGM1 läuft der Import, aber die Höhen werden aus den LoD2-Bodenhöhen
interpoliert — dann stimmen Bordsteine, Treppen und Rampen nicht mehr.

### 4.4 LoD2-Gebäude bereitstellen

Der Server kann das HVBG-Archiv selbst laden, **aber**: die entpackte CityGML für
Darmstadt ist rund 1,6 GB groß, und der Download-Weg ist daran schon gescheitert
(„Cannot create a string longer than 0x1fffffe8", 08.08.2026). Sicherer ist die
lokale Datei:

```bash
# Windows (PowerShell)
$env:HEINERFEST_LOD2_DATEI = "D:\geodaten\Darmstadt - LoD2.gml"
# Linux/macOS
export HEINERFEST_LOD2_DATEI=/pfad/Darmstadt-LoD2.gml
```

### 4.5 Das Pilotgebiet importieren

```bash
npm run gelaende:innenstadt
```

Das ist genau das Gebiet, das auf dem alten Rechner läuft:
**E 474700–476510, N 5524150–5525150** (EPSG:25832, 1,81 km²) — Innenstadt bis
Ostende des Olbrichwegs auf der Mathildenhöhe.

Danach die Dachfarben aus den Luftbildern messen (sonst sind die Dächer neutral):

```bash
curl -X POST http://localhost:4720/api/gelaende/<neue-id>/dachfarben
```

### 4.6 Das Projekt auf das neue Gelände setzen

`gelaendeId` ist bewusst **nicht** über die API änderbar. Also in
`data/projekte/<prj-id>/projekt.json` das Feld `gelaendeId` auf die neue
Gelände-Id setzen — **bei gestopptem Server** — und danach `npm run dev`.

---

## 5. Gegenprobe: läuft es richtig?

Nach dem Start unter <http://localhost:5273> anmelden
(`veranstalter@heinerfest.de` / `heiner1234`) und das Projekt öffnen. Die
Browserkonsole muss melden:

```
[Gelaende] ~1.85 Mio. Dreiecke aus 2048x1280 Zellen a 1 m
[Kanten]   ~1857 x bordstein
[Stadt]    ... Gebaeude mit echter Dachform
```

Zahlen zum Abgleich (aus `docs/LEISTUNG.md`):

| Prüfgröße | Sollwert |
|---|---|
| `zustand.getState().gelaende.bbox.maxE` | **476510** — sonst zeigt das Projekt auf ein altes Gelände |
| Baukörper | **5.471** |
| Grundflächensumme im Pilotgebiet | **≈ 451.700 m²** (Kontrollzahl nach dem BuildingParts-Fix) |
| Höhen | 131,9 – 181,2 m ü. NHN |
| `window.EP3D.hoehen().genau` | **true** — bei `false` ist das Höhenraster nicht geladen und die Szene läuft auf dem groben Ersatzgitter |

Zusätzlich:

```bash
npm run typecheck    # muss fehlerfrei sein
npm run abnahme      # 59 Prüfpunkte, Protokoll in docs/ABNAHME.md
```

---

## 6. Leistung auf der neuen Maschine messen

Damit der Vergleich etwas wert ist, dieselben Messungen wie in
[`LEISTUNG.md`](LEISTUNG.md) fahren. In der Browserkonsole der angemeldeten
Seite:

```js
// Serverseitig: Namenslisten (hier gemessen: 5.153 ms bzw. 4.489 ms)
for (const p of ['/api/projekte', '/api/gelaende']) {
  const t = performance.now();
  await (await fetch(p, { credentials: 'include' })).json();
  console.log(p, Math.round(performance.now() - t), 'ms');
}
```

Diese beiden Werte sind **reine Server- und Plattenzeit** — sie sollten auf
schnellerer Hardware und SSD deutlich fallen, bleiben aber im Sekundenbereich,
solange Stufe 0 des Stufenplans nicht umgesetzt ist.

Die Zeit vom Klick auf „Projekt öffnen" bis zum stehenden Bild ist dagegen
**CPU- und GPU-Zeit im Browser**. Sie ist der eigentliche Prüfstein der stärkeren
Maschine.

> Bildabzüge: Seite mit `?debug=1` öffnen, dann `window.EP3D.abzug('name')` →
> PNG in `data/cache/<name>.png`. Ohne `?debug=1` liefert `toDataURL` Schwarz,
> und ein **verborgenes** Fenster rendert gar kein WebGL.
