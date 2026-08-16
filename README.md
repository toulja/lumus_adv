# EventPlan3D — Heinerfest

KI-gestützte 3D-Planungsplattform für Großveranstaltungen. Umsetzung des Lastenhefts
„EventPlan3D" (Version 1.0, Auftraggeber Tolga Karakaya), Phase 1 (MVP), Pilotgebiet
Darmstadt.

Gelände aus amtlichen Open-Data-Geodaten → maßstabsgetreue Aufbauten, Rettungswege und
Einsatzstationen → deterministische Regelprüfung mit Fundstelle → prüffähiger
Konformitätsbericht, maßstäblicher Lageplan, Betreiberliste und Einsatzmappe.

---

## In fünf Minuten starten

Voraussetzung: **Node.js 22.6 oder neuer** (Node führt die TypeScript-Dateien direkt aus,
es gibt keinen Übersetzungsschritt für den Server).

```bash
npm install
npm run seed
npm run gelaende:heinerfest
npm run dev
```

Danach im Browser: **http://localhost:5273**

Unter Windows genügt ein Doppelklick auf **`Heinerfest starten.bat`** im Projektordner.

> **Auf einen anderen Rechner umziehen?** `git pull` bringt nur den Programmtext — alles
> unter `data/` (Geodaten, Gelände, Projekte) ist bewusst nicht in der Versionsverwaltung.
> Der vollständige Weg mit beiden Möglichkeiten (Daten mitkopieren oder neu aufbauen) und
> den Prüfzahlen für die Gegenprobe steht in [`docs/NEUER-RECHNER.md`](docs/NEUER-RECHNER.md).
> Was heute wie lange dauert und warum, steht gemessen in [`docs/LEISTUNG.md`](docs/LEISTUNG.md).

| Dienst | Port |
|---|---|
| API + WebSocket | 4720 |
| Oberfläche (Vite) | 5273 |

Die Ports weichen bewusst von anderen Projekten auf demselben Rechner ab. Der Server liest
absichtlich **nicht** `process.env.PORT` — Vorschauwerkzeuge setzen diese Variable auf den
Frontend-Port und legten sonst beide Dienste auf denselben Port.

### Zugänge der lokalen Installation

`npm run seed` legt für jede Rolle des Lastenhefts eine Organisation samt Konto an. Auf der
Anmeldeseite genügt ein Klick auf die jeweilige Zeile.

| Konto | Passwort | Rolle |
|---|---|---|
| `admin@eventplan3d.de` | `admin1234` | Plattform-Admin |
| `veranstalter@heinerfest.de` | `heiner1234` | Veranstalter |
| `wagner@schausteller.de` | `stand1234` | Standbetreiber |
| `kern@sonnenschein.de` | `stand1234` | Standbetreiber |
| `ordnungsamt@darmstadt.de` | `amt12345` | Ordnungsamt |
| `brandschutz@feuerwehr-darmstadt.de` | `feuer1234` | Feuerwehr |
| `einsatz@polizei-suedhessen.de` | `polizei1234` | Polizei |

Die Polizei bekommt **keine** Einladung und sieht das Projekt trotzdem — das ist die
ausdrückliche Vorgabe aus Kapitel 4 des Lastenhefts und in `server/lib/rechte.ts`
umgesetzt.

---

## Der Abnahmetest

Kapitel 12 des Lastenhefts beschreibt zehn End-to-End-Kriterien. Sie sind als
ausführbarer Test hinterlegt:

```bash
npm run abnahme
```

Der Test meldet je Kriterium BESTANDEN oder FEHLGESCHLAGEN **mit dem gemessenen Wert** und
legt die erzeugten Nachweise (PDF, CSV, GeoJSON, glTF, Vadere-Szenario) in `data/abnahme/`
ab. Das Protokoll des letzten Laufs steht in [`docs/ABNAHME.md`](docs/ABNAHME.md).

Bemerkenswert am Test: Er sucht die Aufbauflächen **selbst** im echten Bestand — der
Punkt mit dem größten Abstand zur Bebauung und der längste freie Korridor durch ihn. Feste
Koordinaten hätten in Darmstadts Innenstadt mit hoher Wahrscheinlichkeit in einem Haus
gelegen, und die Regelprüfung hätte dann vollkommen zu Recht 0,00 m freie Durchgangsbreite
gemeldet. Der Test wählt dadurch von allein den Herrngarten.

---

## Was die Plattform kann

### Gelände (F1)
Adresssuche oder Rechteck auf der Karte → das System lädt amtliche 3D-Gebäude (LoD2),
Orthophotos (DOP20) und Flurstücke (ALKIS), leitet die Geländehöhen ab und speichert das
Ergebnis als wiederverwendbaren digitalen Zwilling. Jede Quelle wird mit Dienst, Abrufdatum,
Lizenz und Quellenvermerk im Projekt geführt (Nachweispflicht F1.4).

Für das Pilotgebiet liegen konkret vor: **2.563 amtliche LoD2-Gebäude**, 12 Orthophoto-Kacheln,
**800 ALKIS-Flurstücke**, Geländehöhen 136,1 – 168,4 m ü. NHN.

### 3D-Editor (F2)
Orbit, Schwenken, Zoom, Fußgängerperspektive auf 1,70 m Augenhöhe. Objekte aus der
Bibliothek per Klick setzen, ziehen, drehen (Griff, Tastatur, Zahleneingabe), Maße numerisch
sichtbar und eingebbar. Fangen an Raster (0,1 / 0,5 / 1 m), an Objektkanten und an
Wegachsen. Messwerkzeug für Distanz (auch räumlich mit Höhenunterschied) und Fläche.
Kollisionen rot, unterschrittene Pflichtabstände orange. Ebenen einzeln schaltbar.
3D und 2D-Lageplan (MapLibre) laufen synchron auf demselben Modell.

### Objektbibliothek (F3)
**54 Objekttypen** mit realistischen Maßen. Jeder Typ trägt das Feld `quelleMasse` — die
Herkunft der Maße ist in der Oberfläche einsehbar. Wo keine Quelle gefunden wurde, steht das
ausdrücklich dort („Annahme, nicht belegt – zu prüfen"). Belegte Normmaße u. a.:
Container 20 ft nach ISO 668 (6,058 × 2,438 × 2,591 m), Bauzaun 3,50 × 2,00 m,
Feuerwehr-Bewegungsfläche 7 × 12 m.

### Regel-Engine (F8) — der Kern
Deterministisch, ohne KI. **23 Regeln**, alle vierzehn geforderten Prüfarten belegt.
Jedes Ergebnis trägt Ist-Wert, Soll-Wert, Fundstelle mit wörtlichem Zitat und — wo
berechenbar — eine **konkrete Verschiebung**:

> Stand S8 (Losbude) um mindestens 4,25 m nach Süden verschieben, dann ist Rettungsweg W3
> wieder 3,00 m breit.

Diese Zahl ist nicht geschätzt: Die Engine verschiebt das Objekt binär suchend und rechnet
die freie Durchgangsbreite jedes Mal neu. Der Abnahmetest macht die Gegenprobe.

### KI-Assistent (F7)
Serverseitig angebunden, der Schlüssel verlässt den Server nie. Drei Funktionen: Befunde
erklären, Fragen im Projektkontext beantworten, auf Zuruf platzieren (Tool Use mit strengem
Schema). **Die KI hat keine Rechenhoheit** — sie formuliert aus, was die Engine gerechnet
hat; das steht so im System-Prompt. Vorschläge werden nie ohne Bestätigung gespeichert und
im Änderungsprotokoll als „KI-Vorschlag, bestätigt von …" gekennzeichnet.

Ohne `ANTHROPIC_API_KEY` antwortet ein **lokaler, regelbasierter Assistent** aus demselben
Prüf-JSON. Die Plattform ist damit vollständig ohne KI-Zugang nutzbar; die Herkunft jeder
Antwort ist in der Oberfläche sichtbar.

```bash
# optional, aktiviert den Anthropic-Assistenten
set ANTHROPIC_API_KEY=sk-ant-...
```

### Berichte und Exporte (F10, F9.1)
Konformitätsbericht (PDF, mit Lageplan-Abbildung je Beanstandung), **maßstäblicher**
Lageplan 1:250/1:500/1:1000 mit Maßstabsleiste und um die Meridiankonvergenz gedrehtem
Nordpfeil, Betreiberliste (CSV mit UTF-8-BOM und Semikolon für deutsches Excel, und PDF),
Einsatzmappe als Sammel-PDF, GeoJSON, glTF (.glb) und Vadere-Szenario.

Die Maßstabstreue ist nachgemessen: bei 1:500 sind 20 m Gebäudekante exakt 113,3858 pt
(= 5,66929 pt/m).

---

## Aufbau

```
shared/     Domänenmodell, Geometrie-Kern, Regel-Engine   ← läuft in Server UND Browser
server/     API, WebSocket, Geodaten-Pipeline, KI, Berichte, Exporte
web/        React-Oberfläche, Cesium-3D-Szene, MapLibre-2D-Karte
config/     geodata.<land>.json, regelwerk/*.json, heinerfest.json
docs/       Datenquellen, Architektur, Abnahme, Sicherheit, Vadere-Format
db/postgis/ Produktionsschema (die lokale Installation nutzt Dateien)
scripts/    seed, Geländeaufbau, Abnahmetest
data/       Laufzeitdaten (nicht im Versionsverwaltungssystem)
```

Die Regel-Engine und der Geometrie-Kern liegen bewusst in `shared/` und laufen unverändert
an beiden Enden. Der Editor zeigt damit **exakt** die Zahlen, die später im
Konformitätsbericht stehen — es gibt keine zweite Implementierung, die abweichen könnte.

Ausführliche Begründung der Architekturentscheidungen und aller Abweichungen vom
Lastenheft: [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md).

---

## Geodaten je Bundesland pflegen

Die Pipeline ist landesunabhängig. Ein neues Bundesland braucht genau eine Datei:

```
config/geodata.<land>.json
```

Vorlage ist `config/geodata.hessen.json`. Die Abschnitte sind fest:

| Abschnitt | Inhalt |
|---|---|
| `geokodierung` | Adress-Suchdienst, Drossel, User-Agent |
| `orthophoto` | WMS für Luftbilder — **muss im UTM-CRS des Landes liefern** |
| `karte` | WMS mit Maßstabskaskade für die 2D-Ansicht |
| `flurstuecke` | ALKIS-WFS, FeatureType-Namen, BBOX-Achsenreihenfolge |
| `gebaeude3d` | LoD2-Bezugsquelle (Downloadmuster oder lokale Datei) |
| `gelaendehoehen` | Woher die Höhen kommen und was der Rückfallweg ist |
| `rechtsgrundlagen` | Welches Regelwerk gilt |

Alle Endpunkte sind mit Datum und Prüfmethode in
[`docs/DATENQUELLEN.md`](docs/DATENQUELLEN.md) belegt.

**Wichtiger Befund zu Hessen:** Für DGM1 gibt es **keine** skriptbaren Direktlinks; ein WCS
existiert nicht, der WMS liefert nur ein Schummerungsbild ohne Höhenwerte. Die Geländehöhen
werden deshalb aus den amtlichen **LoD2-Bodenhöhen** (Attribut `AbsoluteHoehe`, je Gebäude
eine gemessene Geländehöhe) interpoliert. Ein manuell geladenes DGM1-Raster kann jederzeit
nachgereicht werden und hat dann Vorrang:

```bash
curl -X POST --data-binary @dgm1_darmstadt.xyz \
  -H "Content-Type: text/plain" \
  http://localhost:4720/api/gelaende/<gelaendeId>/dgm
```

Unterstützt werden XYZ-Listen und ESRI-ASCII-Raster.

---

## Regelwerk pflegen

Regelwerke sind versionierte JSON-Dateien in `config/regelwerk/`. Sie enthalten **Daten,
keinen Code** und lassen sich ohne Neubau der Anwendung austauschen. Aufbau je Regel:

```jsonc
{
  "id": "R-008",
  "titel": "Freie Durchgangsbreite im Rettungsweg",
  "quelle": { "kuerzel": "H-VStättR", "paragraf": "§ 7 Abs. 4", "zitat": "…", "url": "…" },
  "geltungsbereich": { "bundesland": "HE", "umgebung": "draussen" },
  "pruefTyp": "rettungsweg_engstelle",
  "parameter":   { "wegetyp": "rettungsweg" },
  "schwellwerte": { "toleranzM": 0.0 },
  "meldungstext": "… {ist} … {soll} … {element} … {ort}",
  "schweregrad": "fehler",
  "verifikation": { "status": "verifiziert", "geprueftAm": "2026-08-07", "beleg": "…" }
}
```

Der Server prüft beim Start, dass jede Regel eine Fundstelle, einen bekannten `pruefTyp` und
einen Verifikationsstatus hat, und verweigert sonst das Laden — mit Angabe der Fehler.

Die vierzehn Prüfarten stehen als `PRUEF_TYPEN` in `shared/domain/types.ts`; ihre
Rechenvorschriften in `shared/rules/engine.ts`. Eine neue Prüfart braucht dort einen Eintrag
in beiden Dateien.

**Rechtsstand Hessen (recherchiert, wichtig):** Hessen hat die MVStättVO **nicht** als
Rechtsverordnung übernommen. Es gilt die **Hessische Versammlungsstättenrichtlinie
(H-VStättR)** vom 03.12.2015, seit 2021 Bestandteil der H-VV TB — eine bauaufsichtliche
Richtlinie, keine Verordnung. Der mitgelieferte Regelsatz benennt das im Haftungshinweis.
Sechs der 23 Regeln tragen `verifikation.status = "zu_pruefen"`; sie sind in
[`docs/ABNAHME.md`](docs/ABNAHME.md) einzeln mit Begründung aufgeführt.

---

## Was diese Plattform nicht ist

Die Prüfung ist eine **Planungsunterstützung**. Sie ersetzt die sachverständige und
behördliche Prüfung nicht; verbindlich sind allein die Entscheidungen der zuständigen
Behörden. Dieser Hinweis steht in jedem erzeugten Bericht.

Nicht im Umfang der Phase 1 (Lastenheft Kap. 10): eigene Crowd-Simulation, Ticketing,
native Mobil-Anwendungen, rechtsverbindliche Genehmigungsbescheide, automatische Vermessung
vor Ort. Die Vadere-Schnittstelle ist vorbereitet und liefert gültige Szenariodateien; der
Simulator selbst gehört zu Phase 2.

---

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | API und Oberfläche zusammen starten |
| `npm run dev:api` | nur die API (Port 4720) |
| `npm run dev:web` | nur die Oberfläche (Port 5273) |
| `npm run seed` | Organisationen und Konten anlegen |
| `npm run gelaende:heinerfest` | Pilotgelände aus amtlichen Daten bauen |
| `npm run abnahme` | Abnahmetest Kapitel 12 fahren |
| `npm run build` | Oberfläche für den Produktivbetrieb bauen |
| `npm run typecheck` | TypeScript prüfen |

Beim Geländeaufbau kann eine bereits vorhandene CityGML-Datei genutzt werden, statt 159 MB
neu zu laden:

```bash
HEINERFEST_LOD2_DATEI=/pfad/zu/Darmstadt-LoD2.gml npm run gelaende:heinerfest
```

## Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `ANTHROPIC_API_KEY` | aktiviert den KI-Assistenten (sonst lokaler Regel-Assistent) |
| `HEINERFEST_KI_MODELL` | Modell-ID, Standard ist ein aktuelles Sonnet-Modell |
| `HEINERFEST_SECRET` | Signaturgeheimnis der Sitzungen — **im Produktivbetrieb Pflicht** |
| `HEINERFEST_DATA` | abweichendes Datenverzeichnis |
| `HEINERFEST_LOD2_DATEI` | lokale CityGML-Quelle für den Geländeaufbau |

## Hinweise für den Betrieb unter Windows

- Bleibt nach einem Abbruch ein Prozess auf 4720 oder 5273 liegen, blockiert er den
  Neustart. Freigeben mit:
  ```bash
  netstat -ano | findstr ":4720"
  taskkill /PID <pid> /F
  ```
- Der Dateispeicher schreibt atomar (erst `.tmp`, dann umbenennen). Weil `rename` über eine
  bestehende Datei unter Windows sporadisch mit `EPERM` fehlschlägt, wenn ein Virenscanner
  die Zieldatei gerade offen hält, wiederholt `server/lib/store.ts` den Vorgang kurz und
  weicht erst danach auf einen direkten Schreibvorgang aus.

## Lizenzen der Geodaten

Alle genutzten Geodaten sind amtliche Open Data. Die Quellenvermerke werden in Berichten
und Exporten mitgeführt:

- © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG) — ALKIS, DOP20,
  LoD2, Liegenschaftskarte. Datenlizenz Deutschland – Zero, Version 2.0.
- © basemap.de / BKG — Datenlizenz Deutschland – Namensnennung 2.0.
- © OpenStreetMap-Mitwirkende (ODbL) — nur für die Adresssuche im Entwicklungsbetrieb.

Bewusst **nicht** genutzt: Google Photorealistic 3D Tiles. Die Anzeige wäre lizenzierbar,
Extraktion und Vermessung sind untersagt — für eine Planungsplattform damit unbrauchbar.
