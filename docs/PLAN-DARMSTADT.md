# Plan: erst Darmstadt perfekt, dann Hessen, dann Deutschland

Beschlossen am 16.08.2026 mit dem Auftraggeber. Zwei Ziele, in dieser Reihenfolge:

1. **Die Anwendung läuft flüssig** — kein eingefrorenes Fenster, kein Warten ohne Anzeige.
2. **Darmstadt ist vollständig und richtig** — die ganze Stadt, ohne stille Lücken.

Erst danach Hessen und Deutschland. Was für Darmstadt gebaut wird, muss beim
67-fachen Gebiet noch tragen — deshalb steht in jeder Stufe, was für die
Ausweitung daraus folgt.

Dieses Dokument ist so geschrieben, dass es **Schritt für Schritt abgearbeitet**
werden kann. Jede Stufe hat ein messbares Fertig-Kriterium. Ohne erfülltes
Kriterium wird nicht zur nächsten Stufe gegangen.

---

## 0. Leitplanken (gelten in jedem Schritt)

* **Erst messen, dann ändern, dann wieder messen.** Jeder Commit, der Leistung
  betrifft, trägt die Vorher- und Nachher-Zahl in der Nachricht.
* **Eine Stufe je Commit.** Keine vermischten Umbauten.
* Nach jedem Schritt: `npm run typecheck` **und** `npm run abnahme` (59 Punkte)
  müssen durchlaufen. Fällt ein Abnahmepunkt, wird er repariert, bevor es
  weitergeht — nicht später.
* **Amtliche Geometrie bleibt die Wahrheit.** Nichts wird geschätzt, was
  gemessen werden kann. Fehlt eine Angabe, heißt sie „k. A." — nie geraten.
* **Keine stillen Kappungen.** Wo etwas abgeschnitten, übersprungen oder
  begrenzt wird, gehört das als Datenlücke ins Auftragsprotokoll, nicht nur in
  `console.warn`. (Der Overpass-Altbestand-Rückfall vom 08.08.2026 ist die
  Mahnung.)
* **OSM kommt aus dem Ortsauszug** (`data/osm-auszug/hessen-latest.osm.pbf`),
  nicht aus der Overpass-API. `overpass.osm.ch` ist verboten (liefert HTTP 200
  mit null Gebäuden für Darmstadt).
* **`asynchronous: false` bleibt.** Cesiums asynchroner Weg hängt in
  gedrosselten Hintergrund-Tabs dauerhaft bei `ready: false`. Die Antwort auf
  Ruckeln ist *weniger auf einmal bauen*, nicht *nebenläufig bauen*.
* **Eigene Zeitscheiben takten über `setTimeout`/`MessageChannel`**, nie über
  `requestAnimationFrame` — im Hintergrund-Tab gibt es kein rAF.
* Eingriffe in `data/` nur bei **gestopptem Server** (`projektCache` im
  Arbeitsspeicher überschreibt sonst die Datei).
* Während einer Messung oder Vorführung **keinen Server-Neustart**.

---

## 1. Ausgangslage (gemessen 16.08.2026, Entwicklungsrechner)

| Größe | Wert |
|---|---|
| `GET /api/projekte` | 5.153 ms |
| `GET /api/gelaende` | 4.489 ms |
| Projekt öffnen: Übertragung | 585 ms (14,3 MB) + 99 ms (10 MB Raster) |
| Projekt öffnen: Aufbau | ein synchroner Block, Fenster reagiert nicht |
| Geländedreiecke | 1.852.846 |
| Baukörper im Pilotgebiet | 5.471 |
| Browser-Bedarf | ~62 MB je km² (gemessen 10.08.2026) |
| Fenster-Budget | ~2 GB → rund **32 km²** am Stück |
| Darmstadt | **122 km²** → passt nicht in ein Gelände |
| `MAX_GEBIET_M2` | 12 km² |

Daraus folgt die Grundentscheidung, die schon in `scripts/gelaende-stadt.ts`
steht: **Darmstadt existiert als Kacheln auf einem gemeinsamen, auf ganzen
Kilometern verankerten Raster.** Die Aufgabe ist nicht, ein 122-km²-Gelände zu
bauen, sondern die Kacheln als **eine durchgehende Welt** zu zeigen.

Zielwerte für „läuft flüssig":

| Ölçüt | Ziel |
|---|---|
| Erste Ansicht nach „Projekt öffnen" | < 2 s |
| Längster Einzelframe während des Aufbaus | < 50 ms |
| Bild beim Fliegen | flüssig, 1–2 Mio. Dreiecke gleichzeitig |
| Speicher nach 10 min Bewegung | < 1,5 GB, mit Freigabe |
| Namenslisten (`/api/projekte`, `/api/gelaende`) | < 100 ms |

---

## Stufe A — Messzeug (zuerst, sonst ist „perfekt" nicht prüfbar)

**Warum:** Ohne wiederholbare Messung ist jede Aussage über Leistung eine
Meinung. Alle folgenden Stufen berufen sich auf dieselben Zahlen.

**Schritte**

1. `scripts/leistung-messen.ts`: misst serverseitig `/api/projekte`,
   `/api/gelaende`, `/api/gelaende/:id`, `hoehen.bin` (je 3 Läufe, Median) und
   schreibt `data/cache/leistung/<zeitstempel>.json` samt Rechnername.
2. Aufbau-Uhren in `web/src/scene/Szene3D.tsx`: je Gruppe (Gelände, Nutzung,
   Gebäude, Kanten, Gleise, Treppen, Vegetation, Möbel) Dauer und Primitive-Zahl;
   dazu längster Frame (`PerformanceObserver` auf `longtask`) und
   `performance.memory` wo vorhanden.
3. `POST /api/debug/leistung` legt denselben Bericht ab. `window.EP3D.messen()`
   löst ihn von Hand aus.
4. Einen Referenzbericht des Ist-Zustands ablegen und in `docs/LEISTUNG.md`
   verlinken.

**Fertig wenn:** ein Befehl plus ein Seitenaufruf einen vergleichbaren Bericht
erzeugen, und der Ist-Zustand als Bezugspunkt abgelegt ist.

---

## Stufe B — Server aufräumen (Stufe 0 aus `docs/LEISTUNG.md`)

**Warum:** 10 Sekunden Wartezeit in der Oberfläche, die niemand braucht.

**Schritte**

1. **Kopfdatei je Gelände:** beim Import `kopf.json` schreiben (id, name,
   erstelltAm, erstelltVon, bbox, Mengen: Gebäude/Flächen/Punkte/Linien).
   `gelaende.liste()` und `routes/projekte.ts:121` lesen nur noch sie. Für
   bestehende Gelände einmalig nachziehen (`scripts/kopfdateien-nachziehen.ts`),
   fehlende Kopfdatei fällt auf den alten Weg zurück.
2. **Speicher-Cache** für `gelaendeStore.laden()` mit mtime-Prüfung.
3. `GET /api/gelaende/:id` streamt die Datei (`sendFile`) statt sie zu parsen und
   neu zu serialisieren; `bbox4326` wandert beim Import in die Datei.
4. `compression()` einschalten; `Cache-Control: private, max-age=…, immutable`
   für Gelände und Raster (beide sind nach dem Schreiben unveränderlich).
5. Client legt Gelände und `hoehen.bin` unter der Gelände-Id in der **Cache-API**
   ab; das `cache: 'no-store'` beim Raster entfällt dadurch, die Warnung bei
   fehlendem Raster bleibt.

**Fertig wenn:** beide Namenslisten unter 100 ms; zweites Öffnen desselben
Geländes ohne erneuten Download der 24 MB; `npm run abnahme` unverändert grün.

---

## Stufe C — Kein Einfrieren mehr (Zeitscheiben)

**Warum:** Das ist der Befund des Auftraggebers („die Seite reagiert nicht").
Auch ein Aufbau, der 20 s dauert, ist erträglich, wenn das Fenster lebt und
zeigt, was passiert.

**Schritte**

1. Den Gelände-Effekt in `Szene3D.tsx` in eine **Aufbau-Warteschlange**
   umbauen: jede Gruppe ist ein Auftrag, Aufträge werden nacheinander
   abgearbeitet, zwischen den Aufträgen wird das Bild freigegeben.
2. Taktgeber: `MessageChannel`-Nachricht oder `setTimeout(…, 0)`, **nicht** rAF.
   Frame-Budget rund 8 ms; große Gruppen (Gebäude) intern in Blöcke von n
   Körpern zerlegen.
3. **Abbruch:** Projektwechsel oder Verlassen bricht die Warteschlange ab und
   räumt die bereits gebauten Primitives (`ersetze` je Gruppe).
4. **Fortschritt** in der Oberfläche: „Gelände … Gebäude 2.100/5.471 …" statt
   eines toten Fensters.
5. Reihenfolge nach Nutzen: Gelände → Gebäude → Bodenzeichnung/Kanten →
   Vegetation → Möbel/Zeichen. Der Nutzer sieht früh etwas Sinnvolles.

**Fertig wenn:** längster Einzelframe < 50 ms (Stufe A misst es), die Oberfläche
bleibt während des Aufbaus bedienbar, Fortschritt sichtbar, Abbruch sauber.

**Fallstricke:** Hintergrund-Tab (rAF fehlt) und doppelter Effektlauf im
React-StrictMode — beides gezielt prüfen.

---

## Stufe D — Nähe zuerst, Ferne billig

**Warum:** Die halbe Arbeit betrifft Dinge, die man nicht sieht. Das ist der
Schritt, der aus „langsam, aber flüssig" ein „sofort da" macht — und die
Vorstufe zu Kacheln.

**Schritte**

1. Gebäude nach **Kameraentfernung** einsortieren; die Warteschlange arbeitet
   von innen nach außen.
2. **Grobe Ferne:** jenseits einer Entfernung zunächst ein Klotz aus dem
   Grundriss (eine Fläche, kein LoD2-Dach, keine Kanten, keine Geschossbänder);
   kommt der Körper näher, wird er durch die volle Fassung ersetzt.
3. Die vorhandenen Entfernungs-Ausblendungen (Geschossbänder 450 m, Firste
   700 m, Gebäudekanten 1200 m) bestimmen **schon den Bau**, nicht erst das
   Zeichnen.
4. Beim Wegfliegen Gruppen wieder auf die grobe Fassung zurücknehmen und
   Speicher freigeben.

**Fertig wenn:** erste Ansicht < 2 s; beim Fliegen kein Frame > 50 ms; Speicher
nach 10 min Bewegung < 1,5 GB.

**Für die Ausweitung:** Diese Stufe ist die Probe aufs Exempel für die
Kachelidee — ohne Serverumbau, im vorhandenen Code.

---

## Stufe E — Darmstadt vollständig und richtig

**Warum:** „Perfekt" heißt nicht nur flüssig, sondern auch vollständig. Die
Stadt liegt bereits als Kacheln vor; jetzt geht es um Nahtlosigkeit und um die
offenen Befunde.

**Schritte**

1. **Nahtlose Welt:** Das Projekt zeigt heute genau ein Gelände. Nachbarkacheln
   müssen nach Kameralage **dazugeladen und wieder entladen** werden (das Raster
   ist auf ganzen Kilometern verankert, die Kanten passen exakt). Budget: höchstens
   ~32 km² gleichzeitig im Speicher, also Kacheln nach Entfernung halten und werfen.
2. **Stadtlauf prüfen und ergänzen:** `node scripts/gelaende-stadt.ts --trocken`
   zeigt, welche Kacheln fehlen; fehlende bauen, danach je Kachel
   `POST /:id/dachfarben`.
3. **Mengen gegen den Vorstand prüfen** (`scripts/stadt-bericht.ts`,
   `scripts/stadt-gegen-referenz.ts`): Gebäude, Bäume, Ampeln, Haltestellen,
   Flächen. Abweichungen erklären, nicht wegdrücken. Kontrollzahl für das
   Pilotgebiet: Grundflächensumme ≈ 451.700 m².
4. **Offene fachliche Befunde abarbeiten** (jeder einzeln, mit Beleg):
   * `maxFeatures: 800` in `config/geodata.hessen.json` — prüfen, ob der
     ALKIS-Abruf noch still kappt; wenn ja, Seitenabruf.
   * **`ringPuffern` ist kein echter Puffer** (`shared/geo/geometry.ts:378`) —
     das geht in die Regel-Engine ein und ist damit **sicherheitsrelevant**.
   * `bandRing`-Selbstschnitt, `HoehenFeld`-Zellsprung.
   * Wasser-Sohle: der Bach liegt noch auf dem Ufer statt darin.
   * Brücken/Tunnel-Höhenbänder (Tunnel werden beim Import verworfen).
   * Randkacheln: Straßen der Nachbargemeinden ohne Häuser — das ist **keine
     Panne**, sondern eine Datenlücke und gehört dokumentiert.
5. **Gleisbreite entscheiden** (offene Frage seit Stufe 4/5): maßstabstreu oder
   kartografische Mindestzeichenbreite. Wird sie erhöht, muss sie als
   Zeichenhilfe gekennzeichnet sein und darf nie in eine Messung eingehen.

**Fertig wenn:** Man kann über ganz Darmstadt fliegen, ohne Naht und ohne
Absturz; der Stadtbericht weist keine unerklärte Lücke aus; die fachlichen
Befunde sind entweder behoben oder als bewusste Grenze dokumentiert.

---

## Stufe F — Kachel-Sondierung (Entscheidung, kein Automatismus)

**Warum:** Wenn A–E die Zielwerte erreichen, ist Darmstadt fertig und der
Aufwand für die Backerei kann warten. Erreichen sie sie **nicht**, ist der Weg
über 3D Tiles unausweichlich — dann aber erst als Sondierung, nicht als
Wochenprojekt.

**Schritte (2–3 Tage)**

1. Einen 256-m-Kachelsatz des Pilotgebiets serverseitig backen — aus demselben
   `shared/`-Kern, `server/exports/gltf.ts` als Grundlage.
2. Als `Cesium3DTileset` laden, Zielwerte messen (Tabelle unter Punkt 1).
3. **Ausdrücklich prüfen:** Verhalten im gedrosselten Hintergrund-Tab und beim
   Zurückkehren — genau dort ist Cesiums asynchroner Weg früher hängen geblieben.
4. Ergebnis mit Zahlen in `docs/LEISTUNG.md` festhalten und **erst dann**
   entscheiden.

**Grundsatz, der dabei nicht fallen darf:** *Das Bild kommt aus Kacheln, das Maß
kommt aus der Datenhaltung.* Regel-Engine, Engstellen, Rettungswege und jeder
Wert im Bericht lesen weiter die exakte Geometrie — nie eine Zeichenkachel.
Getrennte Typen erzwingen das.

---

## Reihenfolge und Abhängigkeiten

| Stufe | Hängt ab von | Kann liegenbleiben? |
|---|---|---|
| A Messzeug | — | nein, alles andere beruft sich darauf |
| B Server | A | nein, billigster Gewinn |
| C Zeitscheiben | A | nein, das ist der Nutzerbefund |
| D Nähe zuerst | C | nein, ohne sie bleibt „erste Ansicht < 2 s" unerreichbar |
| E Darmstadt vollständig | D (Speicherfreigabe) | teilweise: Punkt 4 kann parallel laufen |
| F Kacheln | Messwerte aus D und E | ja, nur wenn die Zielwerte verfehlt werden |

Hessen und Deutschland kommen **nach** F. Was dann zu tun ist, steht bereits in
`docs/LEISTUNG.md` (Stufen 1–4: PostGIS, Kachel-Backerei, Kennzahlen-Stufe,
Import auf einen Server) und im Betriebsplan für gemietete Maschinen.

---

## Messprotokoll (je Stufe ausfüllen)

```
Stufe:            
Rechner:          (Name, CPU, RAM, GPU)
Datum:            
/api/projekte:        vorher      ms   nachher      ms
/api/gelaende:        vorher      ms   nachher      ms
Erste Ansicht:        vorher       s   nachher       s
Längster Frame:       vorher      ms   nachher      ms
Speicher nach 10 min: vorher      MB   nachher      MB
typecheck:            grün / rot
abnahme:              __ / 59
Bemerkung:
```
