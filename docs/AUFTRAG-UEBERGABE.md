# Auftrag zur Übernahme — EventPlan3D / Heinerfest

Du übernimmst ein laufendes Projekt. Dieses Dokument ist deine einzige Quelle für
den Stand; du hast keinen Zugriff auf den bisherigen Gesprächsverlauf. Alles hier
ist **gemessen**, nicht geschätzt. Wo etwas unsicher ist, steht es dabei.

---

## 1. Was das Projekt ist

`C:\Users\Mitarbeiter\Desktop\QWEN\Heinerfest` — EventPlan3D, eine 3D-Planungs­plattform
für Großveranstaltungen (Pilot: Heinerfest Darmstadt). Aus amtlichen Geodaten entsteht
ein maßstabsgetreuer digitaler Zwilling der Stadt; darauf werden Stände, Rettungswege
und Einsatzstationen geplant und gegen ein Regelwerk geprüft.

**Starten:** `npm run dev` → API auf **4720**, Oberfläche auf **5273**.
`predev` räumt die Ports frei. Der Server liest bewusst **nicht** `process.env.PORT`.

**Prüfen (wichtig, sonst arbeitest du blind):**
Seite mit `?debug=1` öffnen, dann in der Browserkonsole `window.EP3D.abzug('name')` →
schreibt ein PNG nach `data/cache/<name>.png`, das du mit einem Datei-Lesewerkzeug
ansehen kannst. `window.EP3D` = `{ viewer, Cesium, zustand, hoehen, abzug }`.
Anmeldung: `veranstalter@heinerfest.de` / `heiner1234`.

**Lies zuerst:** `docs/BAUWERKSMODELL.md` (der Entwurf, dem das Modell folgt),
`docs/DATENQUELLEN.md` (belegte Quellen), `docs/ARCHITEKTUR.md`, `README.md`.

---

## 2. Eiserne Regeln — nicht verhandelbar

1. **Wahrheitspflicht.** Was von Bund, Land, Stadt oder einer anderen amtlichen Stelle
   belegt ist, gilt als Wahrheit und wird mit Fundstelle im Code hinterlegt. Alles
   andere ist eine **Annahme** und wird als solche gekennzeichnet
   (`verifikation.status = "zu_pruefen"`), samt Begründung, warum kein Beleg vorliegt.
   Niemals eine Zahl aus dem Gedächtnis als Tatsache ausgeben.
2. **Maße gehören in Daten, nicht in Programmtext.** Vorbilder:
   `config/regelwerk/*.json`, `config/bauklassen/de-strassenraum-2026.1.json`,
   `shared/bau/oberbau.ts`. Jeder Wert trägt Bezeichnung, Quelle, Status.
3. **Messen statt schauen.** Behauptungen über die Szene werden mit `scene.drillPick`,
   Bildpunktmessung auf dem Canvas oder Zahlen aus den Daten belegt — nicht mit
   „sieht richtig aus".
4. **Eine Wahrheit je Frage.** Gezeichnete und gerechnete Oberfläche müssen dieselbe
   sein (`Gelaendeoberflaeche` in `shared/geo/gelaendenetz.ts`). Zwei Auswertungen
   derselben Frage sind der Ursprung fast aller Fehler in diesem Projekt gewesen.
5. **Der Auftraggeber ist token-bewusst.** Keine automatischen Mehr-Agenten-Reviews.
6. **Zu jedem Schritt ein Bild.** Der Auftraggeber kann die laufende Anwendung nicht
   selbst ansehen. Ohne Bildschirmabzug ist eine Aussage über das Aussehen wertlos.

---

## 3. Was bereits steht (Commits `688fedd`, `1e4761c`)

Das „Bauwerksmodell" ersetzt einen Millimeter-Stapel bemalter Flächen durch echte
Höhen. Fertig und nachgemessen:

| Baustein | Datei | Stand |
|---|---|---|
| Höhenraster DGM1 in **1 m** (statt 4,7 m geglättet) | `shared/geo/raster.ts`, `server/geodata/dgm.ts` | fertig |
| GeoTIFF-Leser (LZW + Prädiktor), gegen amtliche Kachel verifiziert | `server/geodata/geotiff.ts` | fertig |
| Fehlergesteuertes, rissfreies Geländenetz + abfragbare Oberfläche | `shared/geo/gelaendenetz.ts` | fertig |
| Konstruktionshöhen je Bauklasse | `config/bauklassen/*.json`, `server/geodata/bauwerk.ts` | fertig |
| Kantenregel (Bordstein aus Höhendifferenz) | `server/geodata/bauwerk.ts`, `web/src/scene/kanten.ts` | fertig |
| Bauhöhen-Abfrage für alles, was auf dem Boden steht | `shared/geo/bauhoehe.ts`, `Hoehenlage.bauOben()` | fertig |
| Gleisnetz (Stränge statt Einzelwege) | `shared/geo/netz.ts` | fertig |
| Profil-Extruder (Querschnitt × Achse) | `shared/geo/profil.ts` | fertig |
| Gleisquerschnitte | `shared/bau/oberbau.ts`, `web/src/scene/gleise.ts` | Geometrie fertig, **unsichtbar** (siehe 4.2) |
| Treppen als Körper | `shared/bau/treppe.ts`, `web/src/scene/treppen.ts` | erste Fassung |

**Messwerte am Gelände `gel_b0650d4a952b8e25`** (Pilotgebiet Darmstadt):
Raster 1536 × 1280 à 1 m · Geländenetz 384.243 Dreiecke bei 8 cm Toleranz ·
2.074 von 2.225 Flächen mit Konstruktionshöhe (die übrigen 151 sind Wasser und Treppen)
· 1.175 Bordsteine / 38.987 m · 137 Treppenflächen → 65 Läufe mit 503 Stufen ·
72 Gleisstücke → 39 Stränge, 19 Weichen, 5.649 m.

---

## 4. Deine Aufgaben

Reihenfolge ist eine Empfehlung, keine Vorschrift. Jede Aufgabe hat ein
**Abnahmekriterium** — liefere dazu Zahl **und** Bild.

### 4.1 Die Karte hat verschiedene Farben und Böden, die keinen Sinn ergeben

**Befund des Auftraggebers, mehrfach:** Die Fläche wirkt wie ein Fleckenteppich aus
Weiß, Creme und Grau; Details verschwinden.

**Was bereits gefunden wurde:** Die Bodenzeichnung wird **unbeleuchtet** gezeichnet
(`flat: true`), und die ganze Palette in `web/src/scene/palette.ts` ist auf
unbeleuchtete Töne kalibriert — die Helligkeitsabstände gelten nur so. Wer eine
bodennahe Fläche beleuchtet zeichnet, bekommt sofort zwei Helligkeitssysteme auf
einem Boden. Das ist zweimal passiert (Gelände, Gleise) und jeweils behoben.

**Was bleibt:** Die Töne selbst sind zu hell und zu ähnlich.
Fahrbahn `#f5f6f8` (L\* 97) · Geländeplatte `#e7e4e0` (L\* 92) · Gehweg `#d4d6d9` ·
ALKIS-Platte `#ddd9d2`. Vier fast weiße Flächen nebeneinander — jedes Detail darauf
(Gleis, Markierung, Bordstein) hat keinen Grund mehr, gegen den es lesen könnte.

**Auftrag:** Die Basiskarte neu durchrechnen, damit sie als *Karte* funktioniert:
eine klare Rangfolge der Helligkeiten mit belegbaren Mindestabständen (ΔL\* ≥ 9 zwischen
benachbarten Klassen ist die im Projekt verwendete Schwelle), die hellsten Werte deutlich
unter Weiß, damit oben noch Platz für Figuren bleibt. `web/src/scene/palette.ts` enthält
mit `pruefePalette()` bereits einen Validator — erweitere ihn, sodass er die
Nachbarschafts-Abstände prüft und beim Laden meckert. `docs/KARTENDESIGN.md` enthält
Referenzwerte echter Kartenwerke (CARTO Positron, basemap.de Grau, Mapbox Light);
nutze sie als Beleg statt eigener Erfindungen.

**Abnahme:** Für jedes Paar benachbarter Flächenklassen ΔL\* ≥ 9, kein Flächenton
heller als L\* 93, und ein Bildschirmabzug einer Straßenkreuzung, auf dem Fahrbahn,
Gehweg, Platz und Grünfläche ohne Beschriftung auseinanderzuhalten sind.

### 4.2 Die Schienen funktionieren immer noch nicht

**Der Stand:** Netz und Querschnitt sind fertig und richtig. Das Gleis liegt als
Auflage über der Fahrbahn — und ist trotzdem unsichtbar.

**Der Beweis (nicht wiederholen, sondern darauf aufbauen):**
`scene.drillPick` senkrecht auf die Gleisachse (475357 / 5524443) liefert von vorn
nach hinten `boden:fahrbahn:osm_fahrbahn_118`, dann `gleis:0`, dann `gelaende:p8` —
die Fahrbahn liegt **über** dem Gleis, obwohl das Gleisband 4,5 cm höher angesetzt ist.
Bildpunktmessung auf einer Scanlinie: Fahrfläche 61 Pixel, Eindeckung 24, **Rille 0**.

**Die Ursache:** Bodenzeichnung und Gleisband sind zwei getrennt vernetzte Flächen, die
dasselbe Gelände an **verschiedenen** Stützpunkten abtasten. Die zulässige Abweichung
des Geländenetzes beträgt 8 cm. Ein Zeichenversatz, der das sicher überbietet, wäre
größer als die Bordsteinhöhe von 12 cm — dann stünde das Gleis als Rampe über der Straße.
**Die Auflage-Lösung ist ausgeschieden.**

**Auftrag:** Die Gleiszone beim Import **aus den Bodenflächen ausschneiden**.
In `server/geodata/gelaende.ts` nach den Stadtdetails je Gleisachse einen Korridor der
Eindeckungsbreite bilden, alle vereinigen, von den Bodenflächen abziehen und als eigene
Fläche (Bauklasse „Gleiszone") einsetzen. Danach `zPlatte` in `shared/bau/oberbau.ts`
auf 0 setzen — das Gleis liegt dann bündig, und man sieht in die Rille hinein.

*Zwei Fallen:* `bandRing` in `shared/geo/geometry.ts` hat einen bekannten Selbstschnitt —
bilde den Korridor aus Segment-Rechtecken und vereinige sie. Und `polygon-clipping`
bricht bei UTM-Koordinaten ab („Unable to find segment in SweepLine tree"); alle
Koordinaten vorher um einen lokalen Ursprung verschieben (Vorbild: `bodenAufbauen`
in derselben Datei).

**Abnahme:** `drillPick` senkrecht auf die Gleisachse liefert als **ersten** Treffer
das Gleis, nicht die Fahrbahn. Bildpunktmessung: Rille > 0 Pixel. Dazu ein Bild aus
Fußgängerhöhe, auf dem man ein Straßenbahngleis als solches erkennt.

*Offen bleibt außerdem:* An 4 Stellen wechselt die Bauart (Rillenschiene ↔ Schotter­oberbau).
Beide werden getrennt vernetzt, deshalb bricht dort der Strang. Es fehlt ein Übergangsstück.

### 4.3 Es gibt keine echten Tiefen — Tiefgarageneinfahrten, Unterführungen, Brücken

**Befund des Auftraggebers:** „Tiefgarageneinfahrten werden nicht tief."

**Der Stand:** Das Modell kennt bisher nur *Aufbau nach oben* (Konstruktionshöhen
0 bis 12 cm) und das gewachsene Gelände. Es gibt **kein Höhenband** — kein Bauwerk hat
eine Unterkante. Tunnel werden beim Import in `server/geodata/stadtdetails.ts`
ausdrücklich **verworfen** (`if (tags.tunnel && tags.tunnel !== 'no') continue;`),
Brücken werden auf Geländehöhe gemalt. Rampen in Tiefgaragen sind in OSM als
`highway=service` mit `tunnel`/`covered`/`layer=-1` erfasst und fallen damit ganz heraus.

**Auftrag:** Ein **vertikales Lagenmodell** einführen:
- Jedes Bauwerk und jede Verkehrsfläche bekommt Ober- **und** Unterkante.
- `layer`, `bridge`, `tunnel`, `covered`, `level` und `incline` aus OSM auswerten und
  im Datenmodell führen (`shared/domain/types.ts`).
- Rampen: aus Anfangs- und Endhöhe eine geneigte Fläche bauen; wo OSM `incline` führt,
  ist das ein Beleg, sonst eine Annahme.
- Brücken: Überbau mit Widerlagern und **lichter Höhe darunter** — daraus kann die
  Regelprüfung die lichte Höhe einer Feuerwehrzufahrt später *messen*, statt sie in
  ein Eingabefeld zu schreiben.
- Unterführungen und Tiefgaragen: Portal und Sohle; das Gelände muss dort eingeschnitten
  werden, sonst liegt die Rampe auf der Wiese.

**Abnahme:** Eine Tiefgarageneinfahrt im Pilotgebiet ist im Bild als abfallende Rampe
mit Portal erkennbar, und `hoehen.bei()` liefert an ihrem tiefsten Punkt einen messbar
niedrigeren Wert als an der Straße. Mindestens eine Brücke zeigt eine lichte Höhe.

### 4.4 Treppen: erste Fassung, noch nicht gut genug

65 Läufe mit 503 Stufen entstehen bereits (`shared/bau/treppe.ts`). Bekannte Schwächen:

- 72 der 137 Flächen werden als Podest/Rampe eingestuft (unter 30 cm Steigung). Das ist
  bewusst so, aber ungeprüft — bei manchen dürfte die gemessene Höhendifferenz falsch
  sein, weil das DGM an einer Treppenwange nicht sauber trennt.
- Die Laufrichtung kommt aus der Hauptträgheitsachse. Bei L-förmigen Treppen mit Podest
  ist das falsch; solche Läufe müssten geteilt werden.
- Das Stufenmaß (17/29 cm) ist eine **Annahme**. OSM führt `step_count` gelegentlich —
  wo es steht, ist es ein Beleg und muss vorgehen.
- Geländer fehlen ganz, obwohl sie für die Fluchtwegbeurteilung zählen.
- Der Umriss wird mit Sutherland-Hodgman geschnitten; bei konkaven Treppenflächen kann
  das entarten.

**Abnahme:** Eine Treppe mit bekanntem `step_count` aus OSM hat im Modell genau diese
Stufenzahl. Kein Lauf hat Stufen höher als 21 cm oder flacher als 12 cm.

### 4.5 Standards fehlen — deshalb fehlen die Bäume am Großen Woog

**Befund des Auftraggebers:** Das Gebiet wurde erweitert, und an neuen Stellen fehlen
Bäume. Er will **Standards**.

**Die Ursache:** Die Stadtdetails hängen an ortsgebundenen Sonderwegen. Die Bäume kommen
aus zwei Quellen — OpenStreetMap und einem **Extrakt des Darmstädter Baumkatasters**, der
als Datei unter `data/cache/baumkataster/darmstadt_stadtbaeume.json` liegt
(`server/geodata/baumkataster.ts`). Dieser Extrakt deckt nur das ursprüngliche Pilotgebiet
ab. Außerhalb davon gibt es keine Katasterbäume, und wenn dort auch OSM dünn ist, steht
die Fläche leer. Es gibt **keine Abdeckungsprüfung**, die das meldet.

Dasselbe Muster gilt für andere Elemente: Der Overpass-Abruf hat einen Rückfall auf einen
Altbestand (`ausAltbestand()` in `server/geodata/osm.ts`), dessen Meldungen zwar erzeugt,
aber **nirgends angezeigt** werden — ein stiller Ausfall ist damit möglich und ist schon
einmal aufgetreten (349 Bäume, 238 Barrieren, 117 Zebrastreifen fielen weg, ohne dass es
im Protokoll auftauchte).

**Auftrag — das ist die eigentliche Standardisierung:**
1. Für **jede** Elementart (Baum, Laterne, Bank, Poller, Haltestelle, Gleis, Mauer,
   Zaun, Zebrastreifen, Ampel, Verkehrszeichen …) eine Quellenkette festschreiben:
   *amtlich zuerst, OSM als Ergänzung, Klassenannahme als letzter Ausweg* — als Daten,
   nicht als Programmtext, gleiche Bauart wie `config/geodata.<land>.json`.
2. Jede Elementart bekommt eine **Abdeckungserwartung** (z. B. Bäume je Hektar
   Grünfläche). Nach dem Import wird sie geprüft; Unterschreitungen erscheinen im
   Auftragsprotokoll **und** in der Oberfläche als Datenlücke.
3. Ortsgebundene Extrakte (Darmstädter Baumkataster) bekommen eine **Gebietsangabe**.
   Liegt das Zielgebiet nicht darin, muss der Import das melden, statt still weniger
   zu liefern.
4. Die Altbestand-Meldungen aus `osm.ts` ins Auftragsprotokoll und in den
   Quellennachweis hängen.
5. Für ganz Hessen / Deutschland: prüfen, welche Städte offene Baumkataster haben, und
   die Anbindung so bauen, dass eine neue Stadt eine Konfigurationsdatei braucht und
   keinen Programmtext.

**Abnahme:** Ein Import über den Großen Woog liefert dort Bäume — oder das Protokoll
sagt ausdrücklich, warum nicht und aus welcher Quelle sie fehlen. Kein stiller Ausfall.

### 4.6 Wasser hat keinen Boden

9 von 14 Wasserflächen tragen einen Wasserspiegel (`wasserspiegelM`), keine hat eine
Sohle. Ein Bach liegt damit auf dem Ufer statt darin. In den Bauklassen sind Spiegel und
Sohlentiefe bereits als Datenfelder vorgesehen (`wasser` in
`config/bauklassen/de-strassenraum-2026.1.json`), aber nicht umgesetzt: Das Raster müsste
innerhalb der Wasserfläche auf die Sohle abgesenkt und die Wasserfläche als eigene,
leicht durchscheinende Ebene auf dem Spiegel gezeichnet werden.

### 4.7 Hygiene

- 30 Geländeordner in `data/gelaende/` (je rund 10 MB plus Texturen); nur einer wird
  benutzt. Unreferenzierte verschieben oder löschen — vorher prüfen, welche Projekte
  darauf zeigen.
- Drei verwaiste Arbeitszweige unter `.claude/worktrees/`.
- `eigenerBahnkoerper` (Rillenschiene ja/nein) wird bei **jedem** Import neu aus der
  Flächenüberlagerung berechnet und schwankt: 73/73, dann 68/73, dann 68/72. Der Wert
  sollte stabil und begründet sein.

---

## 5. Fallstricke, die dich sonst Stunden kosten

Alle selbst erlebt, jeder hat Zeit gekostet:

1. **Die Seite lädt nicht neu, obwohl du es anweist.** Läuft `location.reload()` in eine
   Zeitüberschreitung („Browser pane is stuck"), lebt der **alte** JavaScript-Kontext
   weiter und beantwortet brav alle Abfragen. Du fotografierst dann einen alten
   Programmstand und suchst den Fehler in der Geometrie. Prüfe nach jedem Neuladen an
   einem frischen Merkmal, ob dein Code wirklich läuft.
2. **Der Szenenaufbau ist synchron und dauert bei großen Gebieten über 30 Sekunden.**
   Werkzeugaufrufe laufen in Zeitüberschreitungen, und du fotografierst Zwischenstände,
   in denen spätere Gruppen (Gleise, Treppen, Stadt) noch gar nicht existieren. Warte auf
   die Protokollzeile der letzten Gruppe, bevor du ein Bild machst.
3. **Die Entwicklerkonsole wird von React-Warnungen geflutet.** Eine einzige
   Warnung mit doppeltem Schlüssel hat die eigenen Protokollzeilen verdrängt und zu der
   Fehldiagnose „der Szenenaufbau bricht ab" geführt. (Behoben, aber achte darauf.)
4. **Der API-Server hält Projekte im Arbeitsspeicher.** Änderst du `projekt.json` direkt
   auf der Platte, sieht der laufende Server sie nicht — Neustart nötig.
5. **Es kann eine zweite Sitzung am selben Baum arbeiten.** Während dieser Arbeit wurden
   Konstanten geändert, fünf Geländeimporte gefahren und das Projekt mehrfach umgehängt.
   Prüfe Zeitstempel und Konstanten, bevor du eine Messung glaubst.
6. **`polygon-clipping` bricht bei UTM-Koordinaten ab.** Immer um einen lokalen Ursprung
   verschieben.
7. **Cesium gibt `geometryInstances` nach dem Bauen frei.** Primitives lassen sich danach
   nicht mehr über ihre Instanz-Id erkennen — für Suchen in der Szene einen anderen Weg
   nehmen.
8. **Kein Refactoring mit Suchmustern über ganze Dateien.** Ein zu gieriges Muster hat
   24 KB aus `web/src/scene/verkehr.ts` gelöscht; die Datei war nur durch Splicing aus dem
   Git-Stand zu retten. Arbeite zeilengenau und mit Prüfung der Anker.
9. **Vite liefert bei `import('...?t=')` nur das angefragte Modul frisch**, nicht dessen
   Abhängigkeiten. Für einen echten Test der Kette hilft nur ein vollständiges Neuladen.
10. **Bintree-Zerlegung:** Die Anfangsdreiecke müssen die **Diagonale** als Hypotenuse
    haben. Eine Kathete als Hypotenuse ergibt entartete Dreiecke und Löcher im Netz
    (331 m² von 65.536 fehlten).

---

## 6. Wie „fertig" aussieht

Für jede Aufgabe: **eine Zahl und ein Bild.** Kein „sieht besser aus".
Beispiele für gute Belege aus diesem Projekt:

- „Querschnitt an der steilsten Stelle: vorher 138,8 → 136,5 m (Rampe), jetzt
  138,9 → 132,4 m (echte 6,4-m-Kante)."
- „1.175 Bordsteine / 38.987 m statt 556 m aus OSM."
- „`drillPick` liefert als ersten Treffer das Gleis, nicht die Fahrbahn."
- „Von 4.394 Gehwegkanten sind 1.758 länger als die Maschenweite."

Und zum Schluss die Frage, an der dieses Projekt hängt: **Sieht ein Mensch, der die
Stadt kennt, auf dem Bild seine Stadt?** Wenn eine Gleisstraße wie eine Straße aussieht,
ist die Aufgabe nicht erledigt — egal wie gut die Zahlen sind.
