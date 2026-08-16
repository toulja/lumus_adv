# Leistung und Skalierung

Gemessen am 16.08.2026 auf dem Entwicklungsrechner (Windows 11, lokaler Betrieb,
`npm run dev`), Gelände `gel_8e8c8905b47a5300` „Darmstadt Innenstadt +
Mathildenhoehe" (1,81 km², 5.471 Baukörper), 31 Projekte und 29 Gelände im
Datenordner.

Dieses Dokument hält **gemessene Werte** fest, nicht Vermutungen, und leitet
daraus den Umbauweg ab. Die Messmethode steht jeweils dabei, damit jeder Wert
nachprüfbar bleibt.

---

## 1. Was gemessen wurde

### 1.1 Die Oberfläche wartet auf den Server, nicht auf die Grafik

Gemessen im angemeldeten Browser mit `performance.now()` um `fetch()`:

| Aufruf | Dauer | Ergebnis |
|---|---|---|
| `GET /api/projekte` | **5.153 ms** | 31 Projekte |
| `GET /api/gelaende` | **4.489 ms** (Wiederholung 4.339 ms) | 29 Gelände |

Beides sind reine Namenslisten. Die Ursachen:

* [`server/routes/projekte.ts:121`](../server/routes/projekte.ts) ruft je
  Projektzeile `gelaendeStore.laden(projekt.gelaendeId)?.name` — das lädt und
  parst die **vollständige** Geländedatei, nur um ein Namensfeld zu lesen.
* `gelaende.liste()` in [`server/lib/store.ts`](../server/lib/store.ts) parst
  jede der 29 Geländedateien vollständig, um `id`, `name`, `erstelltAm` zu
  gewinnen.

Umfang der Dateien: 29 Stück, zusammen **0,3 GB**, größte einzelne
`gelaende.json` **58 MB**. Node arbeitet einthreadig — während dieser Sekunden
steht der ganze Server, auch für alle anderen Anfragen.

Die Wiederholungsmessung zeigt: es gibt **keinen Zwischenspeicher**. Jeder
Aufruf liest und parst erneut.

### 1.2 Ein Projekt zu öffnen kostet weniger als eine Sekunde Übertragung

| Schritt | Dauer | Umfang |
|---|---|---|
| `GET /api/gelaende/:id` (Netz) | 585 ms | 14,3 MB |
| Text dekodieren | 38 ms | |
| `JSON.parse` | 156 ms | 5.471 Gebäude, 3.192 Flächen, 3.941 Punkte |
| `GET /api/gelaende/:id/hoehen.bin` | 99 ms | 10,0 MB |

Zusammen rund **0,9 s**. Die Datenübertragung ist also **nicht** der Engpass.

Zwei Nebenbefunde:

* Die Antwort trägt **kein** `content-encoding` — es gibt keine Kompression.
  14,3 MB gehen roh über die Leitung. Auf `localhost` ist das gleichgültig, über
  LAN oder VPN nicht.
* `/api/gelaende/:id` setzt **kein** `Cache-Control`, und das Höhenraster wird
  bewusst mit `cache: 'no-store'` geholt (Notnagel gegen
  `ERR_CACHE_WRITE_FAILURE`, Runde 7). Beim zweiten Öffnen desselben Geländes
  werden dieselben 24 MB erneut geholt und erneut geparst.
* [`server/routes/gelaende.ts:44`](../server/routes/gelaende.ts) parst 15 MB und
  serialisiert sie sofort wieder — die Datei ist bereits das gewünschte JSON.

### 1.3 Der Engpass ist der Szenenaufbau im Browser

Nach dem Laden läuft **ein einziger synchroner Block** in
[`web/src/scene/Szene3D.tsx:313`](../web/src/scene/Szene3D.tsx). Aus den
Konsolenmeldungen desselben Laufs:

```
[Gelaende] 1.852.846 Dreiecke aus 2048x1280 Zellen a 1 m, groesste Restabweichung 2.0 cm.
[Kanten]   1857 x bordstein (54.590 m), 16 x stuetzmauer (138 m)
```

Danach folgen im selben Block 5.471 Baukörper, Gebäudekanten, Geschossbänder,
Gleise, Treppen, Brücken, Bäume, Möbel, Verkehrszeichen — **alle** Primitives mit
`asynchronous: false`, also Geometrieaufbau und GPU-Übergabe im Hauptthread.

Solange dieser Block läuft, reagiert die Seite auf nichts. Das ist der Befund
„die Seite reagiert nicht" vom 16.08.2026.

Das `asynchronous: false` ist **kein Versehen** und darf nicht einfach umgedreht
werden: Cesiums asynchroner Weg bleibt in gedrosselten Hintergrund-Tabs dauerhaft
bei `ready: false` hängen (dokumentiert in `web/src/scene/darstellung.ts` und im
Schwesterprojekt LUMUS). Die Lösung ist **weniger auf einmal bauen**, nicht
nebenläufig bauen.

---

## 2. Was daraus folgt

Die beiden Engpässe brauchen verschiedene Antworten:

| Engpass | Antwort |
|---|---|
| 5 Sekunden für eine Namensliste | Datenhaltung — Kopfdaten trennen, später Datenbank |
| Eingefrorener Tab beim Öffnen | Weniger Geometrie auf einmal — Kacheln mit Detailstufen |

**Eine Datenbank allein macht das Bild nicht schneller.** Die 1,85 Mio.
Geländedreiecke baut und zeichnet immer der lokale Rechner, gleich woher die
Zahlen kommen. Was den Client entlastet, ist ausschließlich, **weniger zu
schicken** — und genau dafür gibt es in Cesium einen fertigen Weg: **3D Tiles**
mit bildschirmfehlergesteuerten Detailstufen. Weit weg: grobe Klötze oder nur
Kennzahlen. Nah dran: das volle LoD2-Dach mit Kanten und Geschossbändern.

### 2.1 Der Grundsatz, der dabei nicht fallen darf

Das Bauwerksmodell (`docs/BAUWERKSMODELL.md`, Stufe 1) hat die gezeichnete und
die gerechnete Fläche bewusst **gleich** gemacht: `GelaendeFlaeche` ist beides.
Detailstufen brechen das, denn eine Stufe-0-Kachel ist ein vereinfachtes Bild.

Deshalb gilt beim Umbau als Regel:

> **Das Bild kommt aus Kacheln, das Maß kommt aus der Datenhaltung.**

Regel-Engine, Engstellen, Rettungswege, Vadere-Hindernisse und jeder Wert im
Konformitätsbericht fragen weiterhin die **exakte** Geometrie ab (später:
PostGIS mit `ST_Intersects` auf dem Ausschnitt) — niemals eine Zeichenkachel.
Damit das nicht versehentlich verletzt wird, brauchen Kachelgeometrie und
Modellgeometrie **getrennte Typen**.

---

## 3. Stufenplan

| Stufe | Inhalt | Aufwand | Erwartete Wirkung |
|---|---|---|---|
| **0** | Kopfdatei je Gelände (`kopf.json`: id, name, erstelltAm, bbox, Mengen) beim Import schreiben; `liste()` und die Projektübersicht lesen nur sie. Speicher-Cache für `laden()` mit mtime-Prüfung. Dazu `compression()`, `Cache-Control: immutable` für Gelände und Raster, `sendFile` statt parse+stringify. | ~1 Tag | 5 s → unter 50 ms; 14,3 MB → ~2 MB; zweites Öffnen ohne Netz |
| **1** | PostGIS als Speicher (`db/postgis/schema.sql` liegt fertig bei, samt Migrationsweg). Import schreibt in die Datenbank, API beantwortet Bbox-Abfragen statt ganze Gebiete auszuliefern. | 1–2 Wochen | räumliche Abfragen, mehrere Nutzer, kein 14-MB-Klumpen |
| **2** | Kachel-Backerei: Gelände als quantized-mesh, Gebäude als b3dm je 256-m-Kachel mit Detailstufen, Punktobjekte als i3dm. Cesium streamt selbst. | 3–5 Wochen | kein Einfrieren mehr; ganz Darmstadt wird darstellbar |
| **3** | Kennzahlen-Stufe beim Rauszoomen (Blockumrisse, Beschriftung, Mengen statt Geometrie); Kacheln nach Änderungen gezielt neu backen. | 1–2 Wochen | flüssiges Zoomen über die ganze Stadt |
| **4** | **Import auf einen Server verlagern** (ausdrücklicher Wunsch 16.08.2026): LoD2, DGM1, Dachfarben, Baumkataster und die Kachel-Backerei laufen als Auftrag auf einem Server, nicht mehr auf dem Rechner des Nutzers. Die Arbeitsplätze holen nur noch Kacheln. | eigener Abschnitt | die SaaS-Form des Produkts |

Stufe 0 lohnt sich unabhängig von allem Weiteren und ist auch nach einer
Datenbankmigration nicht verloren, weil die Übersicht dann ohnehin nur Kopfdaten
braucht.

### 3.1 Was ihr für Stufe 2 schon habt

* einen glTF-Schreiber (`server/exports/gltf.ts`) — b3dm ist glTF plus Kopf,
* einen i3dm-Leser (Baumkataster Darmstadt) — dasselbe Format wird gebraucht,
* das **global verankerte 256-m-Raster** aus Runde 7: benachbarte Importe stoßen
  kantengenau aneinander. Das ist bereits ein Kachelschema.
* den gemeinsamen Kern in `shared/`, der die Geometrie erzeugt — die Kacheln
  müssen aus genau ihm gebacken werden, sonst driften Bild und Maß auseinander.

### 3.2 Die Grenze, die bleibt

Das Bild rechnet immer der lokale Rechner. Ein brauchbares Budget sind grob
**1–2 Mio. Dreiecke gleichzeitig im Bild**; heute verbraucht das Gelände allein
1,85 Mio., bevor ein einziges Haus dazukommt. Ein stärkerer Rechner verschiebt
diese Grenze, er hebt sie nicht auf. Was dagegen vollständig verschwinden kann,
ist das einmalige Aufbauen von allem — und der Import, der auf einen Server
gehört (Stufe 4).

---

## 4. Bekannte Größenordnungen (Stand 16.08.2026)

| Größe | Wert |
|---|---|
| Pilotgebiet | E 474700–476510, N 5524150–5525150 (EPSG:25832), 1,81 km² |
| Baukörper darin | 5.471 |
| Flächen / Punkte / Linien | 3.192 / 3.941 / — |
| Höhenraster | 2048 × 1280 Zellen à 1 m, Ursprung 474624 / 5523968 |
| Geländehöhen | 131,91 – 181,20 m ü. NHN (Mathildenhöhe) |
| Geländedreiecke bei 2 cm Toleranz | 1.852.846 |
| Bruchkanten | 1.857 Bordsteine (54.590 m), 16 Stützmauern (138 m) |
| Stadtgebiet Darmstadt gesamt | 122 km² = das 67-fache des Pilotgebiets |
| `MAX_GEBIET_M2` in `server/geodata/gelaende.ts` | 2 km² |
