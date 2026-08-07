# Architektur und Entscheidungen

Dieses Dokument begründet die Bauweise von EventPlan3D und benennt **jede Abweichung vom
Lastenheft** samt Grund. Maßstab ist die Auslegungsregel des Lastenhefts selbst:

> „Bei Auslegungsspielraum gilt: die einfachste Lösung wählen, die alle Abnahmekriterien
> (Kap. 12) erfüllt."

---

## 1. Der gemeinsame Kern

Die wichtigste Entscheidung: **Geometrie-Kern und Regel-Engine liegen in `shared/` und
laufen unverändert im Server und im Browser.**

```
shared/domain/types.ts     Domänenmodell (Kap. 7)
shared/domain/objekte.ts   Ableitungen: Grundriss, Maße, Ein-/Ausstiege
shared/geo/geometry.ts     Geometrie in der Ebene, in Metern
shared/geo/proj.ts         EPSG:25832 ↔ WGS84
shared/rules/engine.ts     Regel-Engine, 14 Prüfarten
```

Der Grund ist fachlich, nicht technisch: Der Editor zeigt beim Verschieben eines Standes
eine freie Durchgangsbreite an, und dieselbe Zahl steht später im Konformitätsbericht, der
an eine Behörde geht. Zwei Implementierungen — eine schnelle im Browser, eine „richtige" im
Server — würden früher oder später auseinanderlaufen, und niemand merkte es, bis eine
Behörde nachmisst. Es gibt deshalb genau eine.

**Alles rechnet in EPSG:25832 (ETRS89 / UTM 32N) in Metern.** Abstände, Breiten und Flächen
sind damit direkt messbar. WGS84 existiert nur für Anzeige, Adresssuche und
Austauschformate.

### Rechenhoheit

Die Regel-Engine rechnet, die KI formuliert. Die Verschiebe-Empfehlung
(„4,25 m nach Süden") entsteht durch binäre Suche: das Objekt wird versuchsweise verschoben
und die freie Durchgangsbreite jedes Mal neu bestimmt — mit demselben Algorithmus, der den
Verstoß gefunden hat. Der System-Prompt des KI-Dienstes weist ausdrücklich an, die Zahlen
unverändert zu übernehmen. Ohne KI-Schlüssel liefert ein lokaler Assistent dieselben Zahlen,
nur knapper formuliert.

---

## 2. Abweichungen vom Lastenheft

### 2.1 Backend: Node.js + Express statt NestJS

**Lastenheft Kap. 5:** „Node.js (NestJS) oder Python (FastAPI) — eine der beiden,
konsequent."

**Umgesetzt:** Node.js mit Express, in NestJS-artige Module gegliedert (je Fachbereich ein
Router plus Bibliotheksmodul), REST + WebSocket wie gefordert.

**Grund:** NestJS bringt Decorators und Dependency Injection mit. Decorators sind mit dem
gewählten Ausführungsweg (Node führt TypeScript direkt aus, siehe 2.3) nicht vereinbar und
erzwängen einen Übersetzungsschritt. Der Gewinn wäre Struktur, die hier ohnehin durch die
Modulaufteilung besteht. Die Auslegungsregel des Lastenhefts spricht damit für Express.

**Folge für einen späteren Wechsel:** Die Fachlogik liegt nicht in den Routern, sondern in
`server/lib/*` und `shared/*`. Ein Umbau auf NestJS wäre ein Austausch der HTTP-Schicht.

### 2.2 Persistenz: Dateispeicher statt PostgreSQL/PostGIS

**Lastenheft Kap. 5:** „PostgreSQL + PostGIS (alle Geometrien als PostGIS-Typen in
EPSG:25832). Objekt-/Projektdaten relational, Versionierung als Event-Log-Tabelle."

**Umgesetzt:** dateibasierter Speicher in `data/` — je Projekt eine JSON-Datei mit dem
Inhalt, daneben ein Append-only-Log `events.jsonl` und ein Ordner mit Planungsständen.
Geometrien liegen als Koordinatenlisten in EPSG:25832, mit denselben Feldnamen wie im
Schema. **Das vollständige Produktionsschema liegt bei: `db/postgis/schema.sql`.**

**Gründe:**
1. Der Auftrag lautet „baue es lokal". Auf dem Zielrechner ist kein Docker installiert; eine
   Datenbankinstallation wäre eine Hürde vor dem ersten Start.
2. Sämtliche Geometrieoperationen laufen ohnehin im gemeinsamen Kern (siehe 1). PostGIS
   würde dieselben Rechnungen ein zweites Mal anstellen — mit eigener Rundung und eigenen
   Randfällen. Genau das soll der gemeinsame Kern verhindern.
3. Die geforderte Versionierung ist ein Append-only-Event-Log. JSONL ist dessen direkte
   Entsprechung und lässt sich zeilenweise nach `aenderungs_event` übernehmen.

**Wann das nicht mehr trägt:** mehrere Serverinstanzen, gleichzeitige Schreibzugriffe über
Prozessgrenzen hinweg, Projekte mit deutlich mehr als den geforderten 500 Objekten,
oder räumliche Abfragen über alle Projekte hinweg. Dann greift `db/postgis/schema.sql`; der
Migrationsweg steht dort im Kopf der Datei.

**Was dafür getan wurde:** Der Zugriff läuft ausschließlich über die Repository-Funktionen
in `server/lib/store.ts`. Kein Router liest oder schreibt Dateien selbst.

### 2.3 Server ohne Übersetzungsschritt

Node 22.6+ führt TypeScript direkt aus (Typen werden entfernt). Der Server startet mit
`node server/index.ts` — kein `tsc`, kein `tsx`, kein `dist/`. Das kostet: keine `enum`s,
keine Decorators, keine Parameter-Properties. Der Preis ist gering, der Gewinn ist ein
Projekt, das nach `npm install` sofort läuft.

Die Oberfläche wird weiterhin von Vite gebaut.

### 2.4 Gelände: eigenes Dreiecksnetz statt Globus

Cesium wird ohne Globus betrieben (`scene.globe.show = false`). Das Gelände ist ein eigenes
Netz: je Kachel ein regelmäßiges Gitter in **UTM-Koordinaten** mit den amtlichen Höhen, und
die Luftbildkachel wird beim WMS in **genau derselben UTM-Bbox** angefordert.

Dadurch sitzt das Bild pixelgenau auf dem Netz. Es gibt keine Umprojizierung — und damit
auch nicht den Versatz, den ein Warp nach WGS84 an den Kachelrändern erzeugt. Als
Nebenwirkung braucht die Anwendung **keinen Kartendienst-Zugang** (kein Cesium-ion-Token)
und läuft offline, sobald ein Gelände gebaut ist.

Der Preis: keine Weltkulisse außerhalb des Gebiets. Für eine Veranstaltungsplanung auf
maximal 2 km² ist das kein Verlust.

### 2.5 Geländehöhen ohne DGM1

**Lastenheft Kap. 3:** DGM1 als Quelle der Geländehöhen.

**Befund vom 07.08.2026 (belegt in `docs/DATENQUELLEN.md`):** Für Hessen gibt es keine
skriptbaren Direktlinks auf DGM1. Fünf Pfadmuster im Downloadcenter geprüft — alle 404. Ein
WCS existiert nicht (`service=WCS` → HTTP 400, `ogc-free-dgm.ows` → 404).
`opendata.hessen.de` nennt für den Datensatz „ATKIS-DGM 1" als einzige Schnittstelle einen
WMS, der ein Schummerungsbild liefert, keine Höhenwerte.

**Umgesetzt:** Die Höhen werden aus den amtlichen **LoD2-Bodenhöhen** abgeleitet. Jedes
Gebäude trägt im CityGML das Attribut `AbsoluteHoehe` — eine gemessene Geländehöhe an
seinem Fuß. Im Pilotgebiet sind das 2.563 Stützpunkte auf 1,2 km². Dazwischen wird
invers-distanzgewichtet interpoliert.

Zwei Maßnahmen sichern die Qualität:
- Bauwerke mit `LAGEZURERD < 0` (unterirdisch, amtliches ALKIS-Merkmal) werden verworfen.
- Stützpunkte, die um mehr als 8 m vom **Median ihrer zwölf nächsten Nachbarn** abweichen,
  werden verworfen. Ein globaler Filter wäre falsch — die Innenstadt steigt real um über
  30 m zur Mathildenhöhe. Ohne diesen Filter zog ein einzelner Ausreißer bei 106 m das
  Gelände auf 115,7 m statt 136,1 m herunter.

**Rückfallweg wie im Lastenheft vorgesehen:** ein manuell geladenes DGM1 (XYZ oder
ESRI-ASCII) lässt sich jederzeit einspielen und hat dann Vorrang; die Herkunft steht als
`hoehenHerkunft` am Gelände und im Quellennachweis.

### 2.6 Kein Bildbearbeitungspaket

Weil die Luftbildkacheln in ihrem eigenen CRS bleiben (2.4), entfällt der Umprojizierer und
damit die native Bildbibliothek. Leerbilder des WMS — der Dienst beantwortet Anfrage-Bursts
zeitweise mit praktisch leeren JPEGs bei HTTP 200 — werden über die Dateigröße erkannt
(Schwelle in der Länderkonfiguration), nie gecacht und mit steigendem Abstand wiederholt.

### 2.7 E-Mail-Versand

Benachrichtigungen laufen in der Anwendung (WebSocket) und werden zusätzlich protokolliert.
Ein echter Mailversand ist im lokalen Betrieb nicht angeschlossen; die Stelle dafür ist eine
einzige Funktion (`benachrichtigen` in `server/lib/ereignis.ts`).

---

## 3. Kollaboration

Ein WebSocket-Kanal je Projekt. **Kein CRDT** — das Lastenheft verlangt ausdrücklich nur
Objekt-Locking: wer ein Element greift, sperrt es; die Sperre verfällt nach fünf Minuten
ohne Aktivität. Umgesetzt in `server/realtime/hub.ts`, mit Freigabe beim Verbindungsabbruch
und einem Aufräumer alle 30 Sekunden.

Jede Änderung erzeugt ein Event mit Feld-Diff, das sofort an alle Berechtigten geht und
unveränderlich im Log landet. Planungsstände frieren den Inhalt vollständig ein, Freigaben
beziehen sich immer auf einen Planungsstand.

---

## 4. Rollen und Rechte

Eine einzige Stelle entscheidet, wer was darf: `server/lib/rechte.ts`. Die Matrix bildet
Kapitel 4 des Lastenhefts ab, mit zwei Besonderheiten:

- **Polizei:** organisationsweiter Lesezugriff auf alle Projekte, ohne Einladung. Das ist
  in `rolleFuer()` hart verdrahtet und läuft bewusst **nicht** über Mitgliedschaften —
  sonst hinge ein Rechtsanspruch an einem Datensatz, den jemand löschen kann.
- **Standbetreiber:** liest das gesamte Projekt, ändert ausschließlich die ihm zugewiesenen
  Objekte. Die Bindung prüft `darfObjektAendern()`; zusätzlich filtert `felderFiltern()` den
  Änderungsumfang auf die erlaubten Felder.

Die Feuerwehr darf ausschließlich Feuerwehrzufahrten und Bewegungsflächen bearbeiten —
geprüft in `darfWegAendern()`.

---

## 5. Bekannte Näherungen

Ehrlichkeit ist hier wichtiger als der Eindruck von Vollständigkeit:

| Stelle | Näherung | Auswirkung |
|---|---|---|
| Geländehöhen | aus LoD2-Bodenhöhen interpoliert | zwischen Gebäuden ungenauer als ein DGM1; auf Plätzen die größte Unsicherheit |
| Rettungsweglänge | Dijkstra über das geplante Wegnetz, Restweg als Luftlinie zum nächsten Netzknoten | leicht optimistisch, wenn Hindernisse zwischen Objekt und Weg liegen |
| Wegkorridor | Rechteck je Segment plus Rundung an den Knicken | an sehr spitzen Knicken minimal zu großzügig |
| Freie Durchgangsbreite | Querschnitte alle 0,50 m | eine Engstelle schmaler als 0,50 m Länge kann zwischen zwei Schnitten liegen |
| Objektabstand | Grundriss gegen Grundriss in der Ebene | Auskragungen oberhalb des Bodens sind nicht abgebildet |

Alle fünf lassen sich verfeinern, ohne die Schnittstellen zu ändern.

---

## 6. Leistung

Das Lastenheft fordert ≥ 30 fps bei rund 500 Objekten und 1 km² Gelände. Gemessen im
Pilotgebiet: 2.563 Bestandsgebäude, 12 texturierte Geländekacheln, 21 Aufbauten, vier Wege,
vier Einsatzstationen — 31 Primitives insgesamt.

Dafür sorgen: Bündelung vieler Gebäude in wenige Primitives (350 je Bündel), ein Primitive
je Elementgruppe statt eines je Element, und **synchroner** Aufbau aller Primitives. Der
asynchrone Weg von Cesium bleibt in gedrosselten Hintergrund-Tabs dauerhaft im Zustand
„nicht bereit" hängen — das fällt erst auf, wenn jemand den Tab wechselt und zurückkommt.

---

## 7. Fallstricke, die beim Bau aufgetreten sind

Festgehalten, weil sie beim Weiterbauen wieder auftreten werden:

1. **ALKIS-WFS-Achsenreihenfolge:** bei `urn:ogc:def:crs:EPSG::25832` kommt der Rechtswert
   zuerst, bei `EPSG::4326` die Breite. Falsch herum liefert der Dienst HTTP 200 mit
   `numberReturned="0"` — kein Fehler, nur nichts.
2. **DOP20 nur in EPSG:25832.** In 4326 und 3857 antwortet der Dienst mit Leerbildern.
3. **`gds.hessen.de` verbietet HEAD** (HTTP 405). Prüfungen mit GET und Range-Header.
4. **Cesium `setInputAction` ersetzt** den Handler je Ereignistyp auf derselben
   Handler-Instanz — denselben Typ nie zweimal registrieren.
5. **React StrictMode** baut den Cesium-Viewer im Entwicklungsbetrieb doppelt auf und
   zerstört den ersten. Das Abräumen wird deshalb verzögert und beim Wiederaufbau
   abbestellt.
6. **Vite-WebSocket-Proxy** beendet unter Windows den gesamten Entwicklungsserver, wenn die
   Seite die Verbindung beim Neuladen abbricht (`ECONNABORTED`). Eigener Fehlerbehandler in
   `vite.config.ts`.
7. **`rename` über eine bestehende Datei** schlägt unter Windows sporadisch mit `EPERM`
   fehl. Der atomare Schreibvorgang wiederholt kurz.
8. **Node-`fetch` hält Verbindungen im Pool.** Nach einer längeren Rechenpause im Client ist
   die serverseitige Keep-alive-Frist (Standard 5 s) abgelaufen und die nächste Anfrage
   läuft auf eine tote Leitung. Der Server setzt die Frist deshalb auf 120 s.
