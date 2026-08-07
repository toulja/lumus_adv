# Vadere-Szenariodatei (.scenario) — Formatspezifikation fuer den EventPlan3D-Exporter

**Stand dieser Spezifikation:** 07.08.2026
**Geprueft gegen:** Vadere `master` (Release 4.0, getaggt 2026-04-07) — GitLab der Hochschule Muenchen,
<https://gitlab.lrz.de/vadere/vadere>. Projektseite: <https://www.vadere.org/>.

Alle Feldnamen in diesem Dokument stammen entweder aus **echten Szenariodateien des Vadere-Repos**
(Release 4.0) oder aus den **Java-Attributklassen** in `VadereState/src/org/vadere/state/attributes/`.
Jede Angabe traegt eine Quelle. Nicht belegte Angaben sind mit **(zu pruefen)** markiert.

---

## 0. Warnung vorab: die offizielle Doku ist veraltet

Im Repo liegt unter `Documentation/scenario/` eine Formatdoku
(`scenario-file-specification.md`, `source-specification.md`, `distribution/*.md`).
Diese Dateien sind **Rumpf-Stubs aus der Zeit vor Vadere 3.0** und beschreiben teilweise
Felder, die es **nicht mehr gibt** (z. B. `interSpawnTimeDistribution`, `distributionParameters`
auf Source-Ebene). Sie duerfen **nicht** als Referenz fuer den Exporter dienen.

Quelle: <https://gitlab.lrz.de/vadere/vadere/-/raw/master/Documentation/scenario/source-specification.md>
(zeigt `interSpawnTimeDistribution` / `distributionParameters`) vs. der tatsaechlichen Klasse
`AttributesSource.java` (kennt nur `targetIds`, `spawner`, `groupSizeDistribution`).

**Verbindliche Referenz sind:**

1. echte `.scenario`-Dateien aus `Scenarios/` des Repos (Release 4.0),
2. die Java-Attributklassen in `VadereState/src/org/vadere/state/attributes/`.

### Umbenennungen, die den Auftrag betreffen

Die urspruengliche Aufgabenstellung nennt einige Feldnamen aus dem **alten** Format (<= Vadere 2.x).
Diese Tabelle uebersetzt sie:

| Alter Name (<= 2.x) | Aktuell (>= 3.0 / 4.0) | Beleg |
|---|---|---|
| `source.spawnNumber` | `source.spawner.eventElementCount` | `AttributesSpawner.java`, Feld `eventElementCount` |
| `source.maxSpawnNumberTotal` | `source.spawner.constraintsElementsMax` | `AttributesSpawner.java` |
| `source.startTime` / `endTime` | `source.spawner.constraintsTimeStart` / `constraintsTimeEnd` | `AttributesSpawner.java` |
| `source.interSpawnTimeDistribution` + `distributionParameters` | `source.spawner.distribution.type` + Inline-Parameter | `AttributesDistribution.java` (`@JsonTypeInfo(property="type")`) |
| `target.absorbing` (boolean) | `target.absorber.enabled` (boolean) | `AttributesTarget.java`, Feld `AttributesAbsorber absorber` |
| `target.waitingTime` | `target.waiter.distribution` | CHANGELOG v2.3 "Removed parameter `waitingTime`"; v3.0 "Encapsulated absorbing and waiting behaviours into their own attribute classes" |

CHANGELOG-Beleg: <https://gitlab.lrz.de/vadere/vadere/-/raw/master/CHANGELOG.md>

---

## 1. Top-Level-Struktur

Eine `.scenario`-Datei ist **eine einzige JSON-Datei** (Dateiendung `.scenario`, Inhalt JSON).

```
{
  "name":           string,   // PFLICHT
  "description":    string,   // PFLICHT
  "release":        string,   // PFLICHT (praktisch)
  "commithash":     string,   // optional
  "processWriters": { ... },  // PFLICHT (darf {} sein)
  "scenario":       { ... }   // PFLICHT
}
```

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `name` | string | **ja** | Szenarioname. Wird beim Laden mit `rootNode.get("name").asText()` gelesen — fehlt der Schluessel, gibt es eine NullPointerException. |
| `description` | string | **ja** | Freitext. Gleiche Lesestelle, gleiche Konsequenz. Leerer String `""` ist erlaubt und in vielen Repo-Dateien so vorhanden. |
| `release` | string | **ja** | Version, fuer die die Datei geschrieben wurde. Muss exakt einem Label des `Version`-Enums entsprechen (`"0.1"` … `"3.0"`, `"4.0"`, `"4.1"`). |
| `commithash` | string | nein | Git-Commit der schreibenden Vadere-Instanz. Wird beim Laden nicht ausgewertet. Der Exporter sollte es **weglassen**. |
| `processWriters` | object | **ja** | Ausgabekonfiguration (Prozessoren + Ausgabedateien). Fehlt der Schluessel ganz, laeuft `DataProcessingJsonManager.deserializeFromNode(null)` auf eine NullPointerException. **Minimum: `{}`** — dann werden keine Ausgabedateien geschrieben. |
| `scenario` | object | **ja** | Der eigentliche Modell- und Geometrieteil. |

Belege:
`VadereSimulator/src/org/vadere/simulator/projects/io/JsonConverter.java`,
Methode `deserializeScenarioRunManagerFromNode` (liest `name`, `description`, `scenario`, `processWriters`);
`VadereSimulator/src/org/vadere/simulator/projects/dataprocessing/DataProcessingJsonManager.java`,
`DATAPROCCESSING_KEY = "processWriters"`.

### 1.1 `release` — genaue Semantik

`JsonMigrationAssistant` liest `release` und uebersetzt es mit `Version.fromString(...)`:

* Kennt Vadere den String nicht -> **`MigrationException`**, die Datei wird abgelehnt.
* Fehlt `release` ganz -> Warnung, Vadere nimmt `NOT_A_RELEASE` an und versucht, saemtliche
  Migrationsschritte anzuwenden. Das ist nicht das, was man will.
* Ist `release` aelter als die laufende Vadere-Version -> Vadere migriert die Datei
  (GUI fragt, Konsole `vadere-console.jar migrate`).

**Empfehlung fuer den Exporter:** `release` fest auf die Version des Ziel-Binaries setzen,
konfigurierbar, Default `"4.0"`. `"4.0"` ist gegen echte Repo-Dateien verifiziert.
Das `Version`-Enum enthaelt bereits `V4_1(4, 1)` fuer den kommenden Release.

Belege:
`VadereSimulator/src/org/vadere/simulator/projects/migration/jsontranformation/JsonMigrationAssistant.java`, Zeilen 85–98;
`VadereUtils/src/org/vadere/util/version/Version.java` (Enum-Werte, `label = major + "." + minor`).

### 1.2 `processWriters`

```json
"processWriters" : {
  "files" : [ {
    "type" : "org.vadere.simulator.projects.dataprocessing.outputfile.EventtimePedestrianIdOutputFile",
    "filename" : "postvis.traj",
    "processors" : [ 1, 2 ]
  } ],
  "processors" : [
    { "type" : "org.vadere.simulator.projects.dataprocessing.processor.FootStepProcessor", "id" : 1 },
    { "type" : "org.vadere.simulator.projects.dataprocessing.processor.FootStepTargetIDProcessor", "id" : 2 }
  ],
  "isTimestamped" : false,
  "isWriteMetaData" : false
}
```

* `files[].processors` referenziert `processors[].id`.
* Prozessoren mit Parametern tragen zusaetzlich `attributesType` (voll qualifizierte Klasse)
  und `attributes` (Objekt). Beispiel aus `passageway.scenario`:
  `"type": "...NumberOverlapsProcessor", "id": 4, "attributesType": "org.vadere.state.attributes.processor.AttributesNumberOverlapsProcessor", "attributes": { "pedestrianOverlapProcessorId": 3 }`.
* Alle vier Schluessel (`files`, `processors`, `isTimestamped`, `isWriteMetaData`) sind einzeln
  optional — `deserializeFromNode` prueft jeden auf `null`. Nur das umschliessende Objekt muss da sein.

Fuer Veranstaltungsanalysen relevante Prozessorklassen (Namen aus dem Repo-Verzeichnis
`VadereSimulator/src/org/vadere/simulator/projects/dataprocessing/processor/` verifiziert,
ihre jeweiligen `attributes`-Schemata **(zu pruefen)** — am einfachsten einmal in der Vadere-GUI
zusammenklicken und die erzeugte Datei als Vorlage nehmen):

| Prozessor | Zweck |
|---|---|
| `FootStepProcessor` | Trajektorien (Basis fuer die Post-Visualisierung) |
| `AreaDensityVoronoiProcessor`, `AreaDensityCountingProcessor` | Personendichte in einer `measurementArea` |
| `MaxAreaDensityVoronoiProcessor`, `MeanAreaDensityVoronoiProcessor` | Dichte-Maximum / -Mittel je Messflaeche |
| `AreaSpeedProcessor` | mittlere Gehgeschwindigkeit je Messflaeche |
| `PedestrianEvacuationTimeProcessor`, `EvacuationTimeProcessorMinMaxAvg` | Raeumungszeiten |
| `FlowProcessor`, `MeanFlowProcessor` | Personenfluss |
| `PedestrianOverlapProcessor`, `NumberOverlapsProcessor` | Ueberlappungen = Plausibilitaetskontrolle |

---

## 2. `scenario.mainModel`

Voll qualifizierter Java-Klassenname des Fortbewegungsmodells, als String.

| Modell | String |
|---|---|
| **Optimal Steps Model (OSM)** — Standard, empfohlen | `org.vadere.simulator.models.osm.OptimalStepsModel` |
| **Social Force Model (SFM)** | `org.vadere.simulator.models.sfm.SocialForceModel` |
| Gradient Navigation Model (GNM) | `org.vadere.simulator.models.gnm.GradientNavigationModel` **(zu pruefen — aus dem Testordner `Scenarios/ModelTests/TestGNM` abgeleitet, nicht in einer Datei nachgelesen)** |
| Behavioural Heuristics Model (BHM) | `org.vadere.simulator.models.bhm.BehaviouralHeuristicsModel` **(zu pruefen — analog aus `TestBHM` abgeleitet)** |
| Reynolds Steering Model (RSM) | `org.vadere.simulator.models.reynolds.ReynoldsSteeringModel` **(zu pruefen — analog aus `TestRSM`)** |

Verifiziert:
OSM-String aus `Scenarios/Demos/AirTransmissionModel/examples/scenarios/passageway.scenario`;
SFM-String aus `Scenarios/ModelTests/TestSFM/scenarios/basic_1_chicken_sfm1.scenario`.

**Fuer den Heinerfest-Exporter: OSM.** Es ist Vaderes Referenzmodell, es ist das Modell aller
mitgelieferten RiMEA-Testfaelle, und es reagiert korrekt auf enge Gassen und Engstellen —
genau der Fall zwischen Buden.

---

## 3. `scenario.attributesModel`, `attributesSimulation`, `attributesPsychology`

### 3.1 `attributesModel` — Modellparameter

Ein **Objekt, dessen Schluessel voll qualifizierte Java-Klassennamen sind**. Vadere instanziiert
zu jedem Schluessel die genannte Klasse und deserialisiert den Wert hinein
(`StateJsonConverter.deserializeAttributesListFromNode`).

**Welche Bloecke Pflicht sind, haengt vom `mainModel` und dessen Untermodellen ab.** Fehlt ein
benoetigter Block, wirft `Model.findAttributes(...)` eine `AttributesNotFoundException`; ist er
doppelt da, eine `AttributesMultiplyDefinedException`
(`VadereSimulator/src/org/vadere/simulator/models/Model.java`).

Fuer das OSM in der Standardkonfiguration sind **genau drei Bloecke Pflicht**:

| Schluessel | Wird gebraucht von | Beleg |
|---|---|---|
| `org.vadere.state.attributes.models.AttributesOSM` | `OptimalStepsModel` | `OptimalStepsModel.java:65` `Model.findAttributes(..., AttributesOSM.class)` |
| `org.vadere.state.attributes.models.AttributesFloorField` | `PotentialFieldTargetGrid` (Zielpotenzial) | `OptimalStepsModel.java:144` `Model.findAttributes(..., AttributesFloorField.class)` |
| `org.vadere.state.attributes.models.AttributesPotentialCompactSoftshell` | `PotentialFieldPedestrianCompactSoftshell` **und** `PotentialFieldObstacleCompactSoftshell` | `PotentialFieldPedestrianCompactSoftshell.java:45`, `PotentialFieldObstacleCompactSoftshell.java:39` |

Fuer das SFM sind es entsprechend `AttributesSFM`, `AttributesPotentialSFM`, `AttributesFloorField`
(verifiziert an `basic_1_chicken_sfm1.scenario`).

Die drei Untermodelle werden **innerhalb** von `AttributesOSM` benannt:

```json
"targetPotentialModel"   : "org.vadere.simulator.models.potential.fields.PotentialFieldTargetGrid",
"pedestrianPotentialModel": "org.vadere.simulator.models.potential.PotentialFieldPedestrianCompactSoftshell",
"obstaclePotentialModel" : "org.vadere.simulator.models.potential.PotentialFieldObstacleCompactSoftshell",
"submodels"              : [ ]
```

Wer diese Strings aendert, aendert damit auch, welche `attributesModel`-Bloecke Pflicht werden.
**Empfehlung: nicht aendern.** Den vollstaendigen, verifizierten Block siehe Kapitel 9.

Einzelne Felder mit Wirkung auf Laufzeit und Plausibilitaet:

| Feld (in `AttributesFloorField`) | Wirkung |
|---|---|
| `potentialFieldResolution` | Gitterweite des Zielpotenzialfelds in Metern. `0.1` ist der Repo-Standard. Bei einem Festgelaende von mehreren hundert Metern Kantenlaenge kostet das viel Speicher — `0.2`–`0.5` pruefen. Achtung: zu grob und die Fusswege zwischen Buden verschwinden im Gitter. |
| `cacheType`, `cacheDir` | `"NO_CACHE"` / `""` = Standard. Fuer wiederholte Laeufe auf gleicher Geometrie lohnt Caching **(Enum-Werte zu pruefen)**. |
| `createMethod` | `"HIGH_ACCURACY_FAST_MARCHING"` (Repo-Standard). **Achtung:** in Release 4.0 wurden mehrere Eikonal-Solver **entfernt** (`FAST_SWEEPING_METHOD`, `FAST_ITERATIVE_METHOD` u. a., CHANGELOG v4.0 "Removed"). Alte Beispieldateien aus dem Netz koennen hier ungueltige Werte enthalten. |

| Feld (in `AttributesPotentialCompactSoftshell`) | Wirkung |
|---|---|
| `pedPotentialPersonalSpaceWidth` (`1.2`) | Persoenlicher Abstand in Metern. Der wichtigste Stellhebel fuer erreichbare Dichten. |
| `pedPotentialIntimateSpaceWidth` (`0.45`) | Intimabstand in Metern. |
| `obstPotentialWidth` (`0.8`) | Abstand, den Personen zu Hindernissen (= Buden, Gebaeude) halten. |

### 3.2 `attributesSimulation` — Pflichtblock

Fehlt der Schluessel, bricht das Laden ab (`scenarioNode.get("attributesSimulation")` -> `null`).
Vollstaendige Felderliste aus `VadereState/src/org/vadere/state/attributes/AttributesSimulation.java`:

| Feld | Typ | Default (Java) | Bedeutung |
|---|---|---|---|
| `finishTime` | double | `500` | Simulationsende in Sekunden. |
| `simTimeStepLength` | double | `0.4` | Zeitschritt in Sekunden. |
| `realTimeSimTimeRatio` | double | `0.1` | Nur GUI-Abspielgeschwindigkeit. Fuer Batchlaeufe `0.0`. |
| `writeSimulationData` | boolean | `true` | Ausgabedateien schreiben. |
| `visualizationEnabled` | boolean | `true` | Online-Visualisierung in der GUI. |
| `printFPS` | boolean | `false` | |
| `digitsPerCoordinate` | int | `2` | Nachkommastellen in den Ausgabedateien. |
| `useFixedSeed` | boolean | `true` | Reproduzierbarkeit — **fuer Behoerdenunterlagen zwingend `true`.** |
| `fixedSeed` | long | Zufallszahl | Der verwendete Seed. |
| `simulationSeed` | long | — | Wird von Vadere beim Lauf zurueckgeschrieben. Der Exporter setzt ihn auf denselben Wert wie `fixedSeed` oder auf `0`. |

`finishTime` muss **groesser** sein als `spawner.constraintsTimeEnd` plus die laengste Gehzeit,
sonst sind am Ende noch Personen unterwegs und die Raeumungszeit ist unbrauchbar.

### 3.3 `attributesPsychology` — Pflichtblock

Ebenfalls Pflicht (`scenarioNode.get("attributesPsychology")`), auch wenn die Psychologieschicht
gar nicht genutzt wird. Struktur aus `AttributesPsychology.java`
(`usePsychologyLayer`, `psychologyLayer`) plus dem verifizierten Inhalt aus `passageway.scenario`:

```json
"attributesPsychology" : {
  "usePsychologyLayer" : false,
  "psychologyLayer" : {
    "perception" : "SimplePerceptionModel",
    "cognition" : "SimpleCognitionModel",
    "attributesModel" : {
      "org.vadere.state.attributes.models.psychology.perception.AttributesSimplePerceptionModel" : {
        "priority" : {
          "1" : "InformationStimulus", "2" : "ChangeTargetScripted", "3" : "ChangeTarget",
          "4" : "Threat", "5" : "Wait", "6" : "WaitInArea", "7" : "DistanceRecommendation"
        }
      },
      "org.vadere.state.attributes.models.psychology.cognition.AttributesSimpleCognitionModel" : { }
    }
  }
}
```

`perception` und `cognition` sind hier **Kurznamen** ohne Paket, im Gegensatz zu `mainModel`.
Der Exporter schreibt diesen Block unveraendert als Konstante.

### 3.4 `scenario.stimulusInfos`

Array von Reizen (Durchsagen, Bedrohungen) fuer die Psychologieschicht.
**Optional** — `deserializeStimuliFromArrayNode` prueft auf `null` und liefert dann einen leeren Store.
Trotzdem immer `"stimulusInfos": []` schreiben: der Klonpfad der GUI
(`JsonConverter.cloneScenarioStore`) wirft sonst `"Cannot clone scenario: No stimuli found!"`.

---

## 4. `scenario.topography`

```
"topography" : {
  "attributes"           : { bounds, boundingBoxWidth, bounded, referenceCoordinateSystem },
  "obstacles"            : [ ... ],
  "measurementAreas"     : [ ... ],
  "stairs"               : [ ... ],
  "targets"              : [ ... ],
  "targetChangers"       : [ ... ],
  "absorbingAreas"       : [ ... ],
  "aerosolClouds"        : [ ... ],
  "droplets"             : [ ... ],
  "sources"              : [ ... ],
  "dynamicElements"      : [ ... ],
  "attributesPedestrian" : { ... },
  "teleporter"           : null
}
```

Reihenfolge und Schluessel verifiziert an `passageway.scenario`, `basic_1_chicken_sfm1.scenario`,
`bridge_coordinates_kai.scenario` (alle Release 4.0).

Formal sind **alle Listen optional** — die interne Klasse `StateJsonConverter.TopographyStore`
initialisiert jede Sammlung mit einer leeren Liste. **Der Exporter schreibt sie trotzdem alle**,
auch die leeren: die Datei bleibt so nach einem Vadere-Speichervorgang byte-aehnlich, und Diffs
gegen die GUI-Ausgabe bleiben lesbar. `aerosolClouds` und `droplets` gehoeren zum
Infektionsmodell und bleiben leer.

### 4.1 `topography.attributes`

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `bounds` | Rechteck `{x, y, width, height}` | `(0,0,10,10)` | Simulationsgebiet in **lokalen Metern**. |
| `boundingBoxWidth` | double | `0.5` | Dicke der automatisch erzeugten Randmauer in Metern. |
| `bounded` | boolean | `true` | Wenn `true`, legt Vadere die Randmauer selbst an. |
| `referenceCoordinateSystem` | object \| `null` | `null` | Georeferenz, siehe Kapitel 6. |

Beleg: `VadereState/src/org/vadere/state/attributes/scenario/AttributesTopography.java`.

**Wichtig — die nutzbare Flaeche ist kleiner als `bounds`.** Bei `bounded: true` erzeugt
`Topography.createObstacleBoundary` eine umlaufende Mauer. Der begehbare Innenbereich ist:

```
contentRect.x      = bounds.x      + boundingBoxWidth
contentRect.y      = bounds.y      + boundingBoxWidth
contentRect.width  = bounds.width  - 2 * boundingBoxWidth
contentRect.height = bounds.height - 2 * boundingBoxWidth
```

Beleg: `VadereState/src/org/vadere/state/scenario/Topography.java`, Methode `getContentRect()`.

**Jede Quelle, jedes Ziel und jede Person muss innerhalb von `contentRect` liegen.** Der Exporter
muss deshalb einen Rand aufschlagen: `bounds` = Bounding-Box der Planung, aufgeweitet um
mindestens `boundingBoxWidth` (Vorschlag: 1,0 m) auf allen vier Seiten.

### 4.2 Gemeinsame Felder aller Topographie-Elemente

Alle Elemente erben von `AttributesVisualElement`
(`VadereState/src/org/vadere/state/attributes/scenario/AttributesVisualElement.java`):

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | int | Elementkennung. `-1` bedeutet "nicht gesetzt" (`Attributes.ID_NOT_SET`). Fuer `targets` und `sources` **zwingend** ein echter, eindeutiger, positiver Wert, weil `source.targetIds` darauf verweist. `obstacles` duerfen `-1` tragen (so machen es die Repo-Testdateien), sollten aber fuer nachvollziehbare Fehlermeldungen echte IDs bekommen. |
| `shape` | Shape | Geometrie, siehe Kapitel 5. |
| `visible` | boolean | Nur Sichtbarkeit im Topographie-Editor der GUI. **Ohne Wirkung auf die Simulation.** Immer `true` schreiben. |

### 4.3 `obstacles` — Hindernisse

```json
{ "id" : 1, "shape" : { ... }, "visible" : true }
```

Keine weiteren Felder (`AttributesObstacle.java` fuegt der Basisklasse nichts hinzu).
Hindernisse sind fuer Personen **undurchdringlich**. Das ist das Arbeitspferd des Exporters:
Gebaeude, Buden, Fahrgeschaefte, Absperrungen und alle nicht begehbaren Flaechen werden Hindernisse.

### 4.4 `measurementAreas` — Messflaechen

```json
{ "id" : 1, "shape" : { "x": 8.5, "y": 6.0, "width": 1.0, "height": 3.0, "type": "RECTANGLE" }, "visible" : true }
```

Keine weiteren Felder (`AttributesMeasurementArea.java`). Beeinflusst die Simulation **nicht** —
dient nur als Bezugsflaeche fuer Dichte-, Fluss- und Geschwindigkeitsprozessoren, die die
`id` in ihren `attributes` referenzieren. Verifiziert an
`Scenarios/Demos/supermarket/scenarios/Liddle_osm_v4.scenario`.

Fuer den Heinerfest-Fall genau das Werkzeug, um Engstellen und Platzflaechen auf Personendichte
zu ueberwachen.

### 4.5 `stairs` — Treppen

```json
{
  "id" : -1,
  "shape" : { "type" : "POLYGON", "points" : [ {"x":3.8,"y":2.0}, {"x":1.7,"y":4.0}, {"x":5.9,"y":8.4}, {"x":8.1,"y":6.5} ] },
  "visible" : true,
  "treadCount" : 20,
  "upwardDirection" : { "x" : 1.0, "y" : 1.0 }
}
```

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `treadCount` | int | `1` | Anzahl der Stufen. |
| `upwardDirection` | `{x, y}` | `(1.0, 0.0)` | Richtung bergauf im lokalen Koordinatensystem. |

Belege: `AttributesStairs.java`; `Scenarios/ModelTests/TestStairs/scenarios/stairs_diagonal_1_+1.scenario`.

Vadere warnt, wenn die Auftrittstiefe ausserhalb 10 cm < x < 35 cm liegt
(`Documentation/changelog/TopographyCheckerMessages.md`).
EventPlan3D fuehrt derzeit keine Treppen — der Exporter schreibt `"stairs": []`.

### 4.6 `targets` — Ziele

Siehe Kapitel 8.

### 4.7 `targetChangers` — Zielwechsler

```json
{
  "id" : 5,
  "shape" : { "type" : "POLYGON", "points" : [ ... ] },
  "visible" : true,
  "reachDistance" : 0.3,
  "changeAlgorithmType" : "SELECT_LIST",
  "nextTarget" : [ 4, 3 ],
  "probabilityToChangeTarget" : [ 0.05 ]
}
```

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `reachDistance` | double | `0.0` | Wirkradius in Metern. |
| `changeAlgorithmType` | enum | `SELECT_LIST` | `SELECT_LIST` = die ganze Liste `nextTarget` wird neue Zielliste; `SELECT_ELEMENT` = **ein** Element daraus wird gewaehlt. Weitere Werte **(zu pruefen)** — Enum `TargetChangerAlgorithmType`. |
| `nextTarget` | int[] | `[]` | IDs der neuen Ziele. |
| `probabilityToChangeTarget` | double[] | `[1.0]` | Wechselwahrscheinlichkeiten. |

Belege: `AttributesTargetChanger.java`;
`Scenarios/Demos/S2UCRE/scenarios/MWE_groups_target_changer.scenario`.

Nuetzlich fuer realistische Besucherstroeme (Bummeln von Stand zu Stand), fuer den ersten
Exporter aber **nicht noetig**: `"targetChangers": []`.

### 4.8 `absorbingAreas` — Absorptionsflaechen

```json
{ "id" : 1, "shape" : { ... }, "visible" : true, "deletionDistance" : 0.1 }
```

`deletionDistance` (double) aus `AttributesAbsorbingArea.java`.

Unterschied zu einem Ziel mit `absorber.enabled = true`: eine `absorbingArea` **entfernt** Personen,
ist aber **kein Navigationsziel** — niemand laeuft dorthin. Fuer Sammelplaetze und Ausgaenge ist
daher ein **`target` mit aktivem Absorber** das Richtige, nicht eine `absorbingArea`.

### 4.9 `sources` — Quellen

Siehe Kapitel 7.

### 4.10 `dynamicElements` — vorplatzierte Personen

Array bereits zu Simulationsbeginn vorhandener Personen (Vadere deserialisiert sie als
`DynamicElement`, praktisch `Pedestrian`). In allen untersuchten Repo-Szenarien leer.
Das genaue Serialisierungsformat einer vorplatzierten Person ist hier **(zu pruefen)** —
falls je gebraucht, in der GUI eine Person setzen, speichern, Ergebnis als Vorlage nehmen.
Der Exporter schreibt `"dynamicElements": []`; Personen entstehen ausschliesslich aus `sources`.

### 4.11 `attributesPedestrian` — Standardeigenschaften aller Personen

Verifiziert (identisch in `passageway.scenario`, `MWE_groups_target_changer.scenario`,
`basic_1_chicken_sfm1.scenario`):

```json
"attributesPedestrian" : {
  "shape" : { "x":0.0, "y":0.0, "width":1.0, "height":1.0, "type":"RECTANGLE" },
  "visible" : true,
  "radius" : 0.2,
  "densityDependentSpeed" : false,
  "speedDistributionMean" : 1.34,
  "speedDistributionStandardDeviation" : 0.26,
  "minimumSpeed" : 0.5,
  "maximumSpeed" : 2.2,
  "acceleration" : 2.0,
  "footstepHistorySize" : 4,
  "searchRadius" : 1.0,
  "walkingDirectionSameIfAngleLessOrEqual" : 45.0,
  "walkingDirectionCalculation" : "BY_TARGET_CENTER"
}
```

| Feld | Bedeutung fuer die Veranstaltungsplanung |
|---|---|
| `radius` (`0.2` m) | Koerperradius, also 40 cm Durchmesser. Bestimmt zusammen mit `pedPotentialPersonalSpaceWidth` die erreichbare Dichte. |
| `speedDistributionMean` (`1.34` m/s) | Mittlere Wunschgeschwindigkeit. Fuer ein Volksfest mit Familien, Kinderwagen und Alkohol ist das eher hoch — der Wert ist ein **Modellparameter, kein Messwert des Heinerfests**. Wird er geaendert, muss das im Simulationsbericht mit Begruendung stehen. |
| `speedDistributionStandardDeviation` (`0.26` m/s) | Streuung. |
| `minimumSpeed` / `maximumSpeed` | Kappungsgrenzen. Vadere meldet einen **Fehler**, wenn `speedDistributionMean` ausserhalb liegt, und eine **Warnung** ab 12,0 m/s (`TopographyCheckerMessages.md`). |
| `footstepHistorySize` | Bis Vadere 1.x hiess das Feld `footStepsToStore` (CHANGELOG v1.4). |

Der Exporter schreibt diesen Block als Konstante, mit `radius`, `speedDistributionMean` und
`speedDistributionStandardDeviation` als konfigurierbaren Parametern.

### 4.12 `teleporter`

`null` oder `{ "shift": {"x":..,"y":..}, "position": {"x":..,"y":..} }` (`AttributesTeleporter.java`,
Felder `shift` und `position`). Fuer periodische Randbedingungen in Laborszenarien.
Der Exporter schreibt immer `"teleporter": null`.

---

## 5. Geometrie-Notation (`shape`)

Vadere serialisiert Geometrien ueber `JacksonObjectMapper.VShapeStore` mit einem
Diskriminator-Feld `type`. Es gibt genau **drei** Formen. Belege:
`VadereState/src/org/vadere/state/util/VRectangleStore.java`, `VPolygon2DStore.java`, `VCircleStore.java`.

### 5.1 RECTANGLE

```json
{ "x" : 8.5, "y" : 6.0, "width" : 1.0, "height" : 3.0, "type" : "RECTANGLE" }
```

`x`/`y` sind die Koordinaten der **Suedwest-Ecke** (unten links), nicht des Mittelpunkts.
Das Rechteck ist **achsparallel** — es kann nicht rotiert werden.
`width` und `height` muessen `> 0` sein.

### 5.2 POLYGON

```json
{
  "type" : "POLYGON",
  "points" : [ { "x" : 16.0, "y" : 13.0 }, { "x" : 22.0, "y" : 13.0 },
               { "x" : 22.0, "y" : 16.0 }, { "x" : 16.0, "y" : 16.0 } ]
}
```

* Der Ring ist **implizit geschlossen** — der erste Punkt wird **nicht** wiederholt.
  (Verifiziert an `bridge_coordinates_kai.scenario`: die Polygone enden nicht auf dem Startpunkt.)
* Das entspricht exakt der EventPlan3D-Konvention `Ring` in `shared/domain/types.ts`
  ("Geschlossener Ring; erster Punkt wird NICHT wiederholt") — **keine Umformung noetig.**
* Der Javadoc-Kommentar in `VPolygon2DStore` sagt "The points are lay out clockwise".
  `GeometryUtils.polygonFromPoints2D` normalisiert die Orientierung beim Einlesen
  **(zu pruefen — nicht im Quelltext nachgelesen)**. Sicherer Weg: der Exporter dreht jeden Ring
  auf eine feste Orientierung, EventPlan3D hat dafuer `gegenUhrzeiger()` in `shared/geo/geometry.ts`.
* **Keine Loecher.** Ein `POLYGON` ist ein einfacher Ring. Ein Polygon mit Loch muss in
  mehrere lochfreie Hindernisse zerlegt werden (`polygon-clipping` ist bereits Abhaengigkeit).

### 5.3 CIRCLE

```json
{ "type" : "CIRCLE", "center" : { "x" : 10.0, "y" : 5.0 }, "radius" : 1.5 }
```

Felder `center` und `radius` aus `VCircleStore.java`. Passt zu EventPlan3D-Objekttypen mit
`form: 'kreis'` (Karussells, Rundzelte). Alternativ liefert `kreisRing()` aus
`shared/geo/geometry.ts` ein Polygon — das ist die robustere Variante, weil `CIRCLE` in
keiner der untersuchten Repo-Dateien vorkam **(CIRCLE-Serialisierung ist aus der Java-Klasse
belegt, aber nicht an einer echten Szenariodatei gegengeprueft)**.

### 5.4 Regeln fuer alle Formen

* Koordinaten sind **Meter** im lokalen System (Kapitel 6), keine Grad, keine UTM-Werte.
* Alle Werte sind JSON-Zahlen. Fuer `int`-Felder (`id`, `treadCount`, `eventElementCount`,
  `digitsPerCoordinate`) **echte Ganzzahlen** schreiben, nicht `1.0`.
* Booleans muessen echte JSON-Booleans sein — `JacksonObjectMapper` registriert einen strengen
  Boolean-Deserializer, der `0`/`1` und `"true"` ablehnt.
* **Doppelte Schluessel sind verboten**: `JsonParser.Feature.STRICT_DUPLICATE_DETECTION` ist aktiv.

---

## 6. Koordinaten: von EPSG:25832 nach lokal

### 6.1 Das Problem

EventPlan3D fuehrt **jede** Geometrie in ETRS89 / UTM Zone 32N (EPSG:25832), Einheit Meter,
als `[Rechtswert E, Hochwert N]` (`shared/domain/types.ts`, "EISERNE REGEL").
Fuer Darmstadt liegen die Werte bei E ~ 474 900, N ~ 5 524 500.

Vadere rechnet in einem **lokalen kartesischen Meter-System**, dessen `bounds`-Rechteck
konventionell bei `(0, 0)` beginnt und dessen Ursprung **unten links** liegt (y zeigt nach oben,
wie der Hochwert). Direkt UTM-Werte einzusetzen ist zwar geometrisch nicht falsch, aber
praktisch unbrauchbar: Vaderes Potenzialfeldgitter und die GUI-Darstellung gehen von einem
Gebiet nahe dem Ursprung aus.

### 6.2 Die Transformation

Beide Systeme sind kartesisch, metrisch und gleich orientiert (E -> x, N -> y). Die Abbildung
ist deshalb eine **reine Verschiebung, ohne Drehung und ohne Skalierung**:

```
x_lokal = E - T_x
y_lokal = N - T_y
```

und zurueck:

```
E = x_lokal + T_x
N = y_lokal + T_y
```

`T` ist die UTM-Koordinate des lokalen Ursprungs `(0, 0)`.

**Das ist exakt Vaderes eigene Konvention.** In
`VadereState/src/org/vadere/state/scenario/ReferenceCoordinateSystem.java`:

```java
public VPoint convertToGeo(VPoint cartesian) {
    VPoint translated = cartesian.add(translation);   // lokal + translation = UTM
    ...  // dann UTM -> geografisch
}
public VPoint convertToCartesian(double latitude, double longitude) {
    ...  // geografisch -> UTM
    return ret.subtract(this.translation);            // UTM - translation = lokal
}
```

Also: **`translation` = UTM-Koordinate des lokalen Nullpunkts.**

### 6.3 Wahl von T

```
T_x = bbox.minE - rand
T_y = bbox.minN - rand
```

mit `bbox` = Bounding-Box aller exportierten Geometrien (EventPlan3D hat dafuer
`bboxVonPunkten()` und `bboxErweitern()` in `shared/geo/geometry.ts`) und
`rand >= boundingBoxWidth`, Vorschlag `rand = 1.0` m.

Daraus folgt unmittelbar:

```
bounds = {
  x: 0.0,
  y: 0.0,
  width:  (bbox.maxE - bbox.minE) + 2 * rand,
  height: (bbox.maxN - bbox.minN) + 2 * rand
}
```

**T einmal pro Export bestimmen und auf alle Geometrien anwenden.** Auf keinen Fall pro Element
neu berechnen. `T` auf zwei Nachkommastellen runden — das haelt die Datei lesbar und die
Rundung verschiebt das gesamte Gelaende starr, verzerrt also nichts.

### 6.4 `referenceCoordinateSystem` mitschreiben

Damit der Rueckweg (Vadere-Trajektorien -> EventPlan3D-Karte) verlustfrei ist, gehoert `T`
in die Datei:

```json
"referenceCoordinateSystem" : {
  "epsgCode" : "EPSG:25832",
  "description" : "EventPlan3D Heinerfest - lokaler Ursprung = bboxMin minus 1 m Rand",
  "translation" : { "x" : 474934.48, "y" : 5524542.08 }
}
```

Felder `epsgCode`, `description`, `translation` aus `ReferenceCoordinateSystem.java`.
Der Javadoc dort nennt ausdruecklich **"EPSG:25832 = ETRS89 / UTM Zone 32N (UTM Zone System)
zone 32 contains most of germany"**.

**Achtung Format des `epsgCode`:** Vadere gibt den String an
`org.apache.sis.referencing.CRS.forCode(epsgCode)` weiter — also muss es ein **echter
Autoritaetscode** sein: `"EPSG:25832"`. Der CHANGELOG-Eintrag zu v1.3 zeigt als Beispiel
`"epsgCode": "UTM Zone 32U"`; das ist ein Altbestand aus einer frueheren `osm2vadere`-Version
und **kein gueltiger Code fuer `CRS.forCode`**. Nicht nachbauen.

Der Wert wird nur ausgewertet, wenn jemand `convertToGeo` / `convertToCartesian` aufruft —
die Simulation selbst laeuft rein lokal. Ein falscher Code faellt also erst spaet auf.

### 6.5 UTM-Massstabsverzerrung — bewusst ignoriert

UTM ist eine konforme Abbildung mit Massstabsfaktor `k0 = 0,9996` am Hauptmeridian.
Gitterstrecken sind daher nicht identisch mit Strecken am Boden. EventPlan3D hat die Formel
bereits: `massstabsfaktor()` in `shared/geo/proj.ts`:

```
k = 0,9996 * (1 + (dl^2 * cos^2(lat)) / 2),    dl = (lon - 9 Grad) in Bogenmass
```

Fuer den Darmstaedter Marktplatz (49,87276 N / 8,65117 E; UTM32: E 474 934,48 / N 5 524 542,08)
ergibt das **k = 0,99960769**, also **-392 ppm** oder **-3,9 cm je 100 m**
(mit dieser Formel und `proj4` gerechnet, 07.08.2026).

Auf einem Festgelaende von 500 m Ausdehnung sind das rund **20 cm** ueber die gesamte Diagonale.
Das liegt weit unterhalb der Modellunsicherheit einer Personenstromsimulation.

**Entscheidung: nicht korrigieren.** Der Exporter verwendet UTM-Gittermeter unveraendert als
Vadere-Meter. Das haelt die Transformation exakt umkehrbar. Der Wert gehoert aber in den
Simulationsbericht, damit die Naeherung dokumentiert ist. Wer korrigieren will, teilt alle
lokalen Koordinaten durch `k` — dann ist die Rueckrechnung allerdings nicht mehr die einfache
Verschiebung, die `ReferenceCoordinateSystem` annimmt, und `translation` waere falsch.

### 6.6 Was der Exporter NICHT tun darf

* **Kein WGS84.** Nie ueber Grad zwischenrechnen. `nachWgs`/`nachUtm` haben im Exportpfad nichts
  verloren — jede Hin-und-Rueck-Projektion kostet Genauigkeit.
* **Keine Drehung.** Vaderes y-Achse ist Gitternord, nicht geografisch Nord. Die
  Meridiankonvergenz (in Darmstadt rund -0,27 Grad, `meridiankonvergenz()` in `shared/geo/proj.ts`)
  wird **nicht** herausgerechnet. Sie ist nur fuer den Nordpfeil im Lageplan relevant.
* **Kein Hoehenbezug.** Vadere ist 2D. `bodenHoehe`, `traufHoehe`, `firstHoehe` und
  `GelaendePatch.hoehen` werden **ignoriert** — nur der Grundriss zaehlt.
  Gelaendesteigungen bilden sich in Vadere ueber `stairs` ab, sonst gar nicht.

---

## 7. `sources` — Quellen

### 7.1 Struktur

```json
{
  "id" : 10,
  "shape" : { "x":1.0, "y":12.0, "width":2.0, "height":6.0, "type":"RECTANGLE" },
  "visible" : true,
  "targetIds" : [ 100 ],
  "spawner" : {
    "type" : "org.vadere.state.attributes.spawner.AttributesRegularSpawner",
    "constraintsElementsMax" : 200,
    "constraintsTimeStart" : 0.0,
    "constraintsTimeEnd" : 120.0,
    "eventPositionRandom" : true,
    "eventPositionGridCA" : false,
    "eventPositionFreeSpace" : true,
    "eventElementCount" : 1,
    "eventElement" : null,
    "distribution" : {
      "type" : "org.vadere.state.attributes.distributions.AttributesConstantDistribution",
      "updateFrequency" : 0.6
    }
  },
  "groupSizeDistribution" : [ 1.0 ]
}
```

Belege: `AttributesSource.java` (Felder `targetIds`, `spawner`, `groupSizeDistribution`);
`passageway.scenario`; `stairs_diagonal_1_+1.scenario`.

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `targetIds` | int[] | `[]` | IDs der Ziele, die erzeugte Personen nacheinander ansteuern. **Leere Liste bei aktiver Quelle = Fehler** im TopographyChecker. |
| `spawner` | object | `AttributesRegularSpawner` | Erzeugungslogik, siehe 7.2. |
| `groupSizeDistribution` | double[] | `[1.0]` | Wahrscheinlichkeiten der Gruppengroessen: Index 0 = Einzelpersonen, Index 1 = Zweiergruppen usw. `[1.0]` = ausschliesslich Einzelpersonen. **Achtung:** Gruppen brauchen ein gruppenfaehiges Modell (`Scenarios/ModelTests/TestOSMGroup`) — mit reinem OSM `[1.0]` lassen. |

### 7.2 `spawner` — vier Typen

`AttributesSpawner` ist abstrakt mit `@JsonTypeInfo(property = "type")`. Erlaubte `type`-Strings
(aus `@JsonSubTypes` in `AttributesSpawner.java`):

| `type` | Verteilung | Einsatz |
|---|---|---|
| `org.vadere.state.attributes.spawner.AttributesRegularSpawner` | beliebige | **Standard.** Feste oder zufaellige Zeitabstaende. |
| `org.vadere.state.attributes.spawner.AttributesTimeSeriesSpawner` | `AttributesTimeSeriesDistribution` | **Ideal fuer Festbetrieb:** vorgegebene Personenzahl je Zeitintervall = Ankunftsganglinie. |
| `org.vadere.state.attributes.spawner.AttributesLerpSpawner` | `AttributesLinearInterpolationDistribution` | linear interpolierte Rate. |
| `org.vadere.state.attributes.spawner.AttributesMixedSpawner` | `AttributesMixedDistribution` | Kombination mehrerer Verteilungen. |

Gemeinsame Felder (alle aus `AttributesSpawner.java`):

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `constraintsElementsMax` | int | `-1` | **Obergrenze der insgesamt erzeugten Personen.** `-1` = unbegrenzt. Das ist der Hebel fuer `maxBesucher`. |
| `constraintsTimeStart` | double | `0.0` | Beginn der Erzeugung in Sekunden. |
| `constraintsTimeEnd` | double | `0.0` | Ende der Erzeugung in Sekunden. **Der Default `0.0` bedeutet: es passiert nichts.** Immer explizit setzen. |
| `eventPositionRandom` | boolean | `false` | `true` = zufaellige Position innerhalb der Quellflaeche; `false` = alle im Ursprung der Quelle. **Fuer flaechige Eingaenge zwingend `true`.** |
| `eventPositionGridCA` | boolean | `false` | Nur fuer zellulaere Automaten. `false`. |
| `eventPositionFreeSpace` | boolean | `true` | Nur auf freien Platz erzeugen. `true` lassen — sonst entstehen ueberlappende Personen. |
| `eventElementCount` | int | `1` | **Personen pro Erzeugungsereignis** (das alte `spawnNumber`). |
| `eventElement` | object \| null | `null` | Abweichende Personeneigenschaften nur fuer diese Quelle. `null` = `attributesPedestrian` gilt. |
| `distribution` | object | typabhaengig | Zeitliche Verteilung, siehe 7.3. |

**Versionsfalle:** Das Feld `alwaysSpawnAtConstraintsTimeStart` (boolean) existiert im aktuellen
`master`, aber **nicht in Release 4.0** — keine der 4.0-Repo-Dateien enthaelt es
(CHANGELOG "In Progress": "set `alwaysSpawnAtConstraintsTimeStart` on the spawner to true").
Da Jackson unbekannte Felder ablehnt (siehe Kapitel 11.1), wuerde es eine 4.0-Instanz
**zum Absturz bringen**. Bei `release: "4.0"` **weglassen**.

### 7.3 `distribution` — Verteilungstypen

Ebenfalls per `type` diskriminiert (`AttributesDistribution.java`, `@JsonSubTypes`).
Voll qualifizierte Klassennamen aus `org.vadere.state.attributes.distributions`:

| `type` (Klasse) | Parameterfelder | Bedeutung |
|---|---|---|
| `AttributesConstantDistribution` | `updateFrequency` (double) | Konstanter Zeitabstand **in Sekunden** zwischen zwei Ereignissen. Trotz des Namens ist es eine Periodendauer, keine Frequenz. Beleg: Javadoc "It is usually used as a time period between two samples". |
| `AttributesPoissonDistribution` | `numberPedsPerSecond` (double) | Poisson-Ankuenfte. **Realistischster Ansatz fuer einen Festeingang.** |
| `AttributesNegativeExponentialDistribution` | `mean` (double) | Exponentialverteilte Abstaende. |
| `AttributesTimeSeriesDistribution` | `intervalLength` (double), `spawnsPerInterval` (int[]) | Ankunftsganglinie: je Intervall eine feste Personenzahl. |
| `AttributesBinomialDistribution` | **(zu pruefen)** | |
| `AttributesNormalDistribution` | **(zu pruefen)** | |
| `AttributesEmpiricalDistribution` | **(zu pruefen)** | |
| `AttributesLinearInterpolationDistribution` | **(zu pruefen)** | |
| `AttributesMixedDistribution` | **(zu pruefen)** | |
| `AttributesSingleSpawnDistribution` | `spawnTime` (double) | Ein einziges Ereignis. **Nicht verwenden:** CHANGELOG "In Progress" / "Fixed": *"SingleSpawnDistribution could not be used due to serialization issues"*. Ausserdem nennt die Repo-Doku ein Feld `spawnNumber`, das die aktuelle Klasse gar nicht hat. |

Jeder `type` **muss** zum Spawner passen: `AttributesTimeSeriesSpawner` akzeptiert ausschliesslich
`AttributesTimeSeriesDistribution` (harter Cast in `setDistributionAttributes`), `AttributesLerpSpawner`
nur `AttributesLinearInterpolationDistribution`, `AttributesMixedSpawner` nur `AttributesMixedDistribution`.
Nur `AttributesRegularSpawner` nimmt beliebige Verteilungen.

### 7.4 Wie viele Personen entstehen wirklich?

Bei `AttributesRegularSpawner` mit `AttributesConstantDistribution`:

```
Ereignisse   = floor((constraintsTimeEnd - constraintsTimeStart) / updateFrequency)
Personen     = min(Ereignisse * eventElementCount, constraintsElementsMax)     falls constraintsElementsMax >= 0
```

Die genaue Behandlung des Randereignisses bei `constraintsTimeStart` hat sich nach 4.0 geaendert
(CHANGELOG "In Progress"), die Formel ist deshalb um **+/- 1 Ereignis** unsicher **(zu pruefen —
einmal gegen die Zielversion messen)**.

**Robuster Weg fuer eine garantierte Personenzahl:** `constraintsElementsMax` auf die Sollzahl
setzen und das Zeitfenster grosszuegig waehlen, sodass die Rate ohnehin frueher abgeschnitten
wird. Dann ist die Zahl exakt, und nur die letzte Ankunftszeit variiert.

---

## 8. `targets` — Ziele

```json
{
  "id" : 100,
  "shape" : { "x":37.0, "y":12.0, "width":2.0, "height":6.0, "type":"RECTANGLE" },
  "visible" : true,
  "absorber" : { "enabled" : true,  "deletionDistance" : 0.1 },
  "waiter"   : { "enabled" : false, "distribution" : null, "individualWaiting" : true },
  "leavingSpeed" : -1.0,
  "parallelEvents" : 0
}
```

Belege: `AttributesTarget.java`; `passageway.scenario`; `MWE_groups_target_changer.scenario`.

| Feld | Typ | Default | Bedeutung |
|---|---|---|---|
| `id` | int | — | **Muss eindeutig und positiv sein**, `source.targetIds` verweist darauf. |
| `absorber` | object | `{enabled: true, deletionDistance: 0.1}` | Ersetzt das alte `absorbing`. |
| `absorber.enabled` | boolean | `true` | `true` = Person verlaesst die Simulation beim Erreichen. **Fuer Ausgaenge und Sammelplaetze: `true`.** |
| `absorber.deletionDistance` | double | `0.1` | Entfernung in Metern, ab der die Person entfernt wird. |
| `waiter` | object | `enabled: false` | Ersetzt das alte `waitingTime`. |
| `waiter.enabled` | boolean | `false` | Wartepunkt (Kasse, Toilette, Ausschank). |
| `waiter.distribution` | object \| null | `null` | Wartezeitverteilung, **gleiches Typschema wie in 7.3**. Beispiel aus `MWE_groups_target_changer.scenario`: `{"type":"org.vadere.state.attributes.distributions.AttributesConstantDistribution","updateFrequency":10.0}` = 10 s Wartezeit. |
| `waiter.individualWaiting` | boolean | `true` | `true` = jede Person wartet fuer sich; `false` = gemeinsames Freigeben (Ampellogik). |
| `leavingSpeed` | double | `-1.0` | `-1.0` = unbegrenzt. Sonst Abflussrate in Personen/Sekunde **(Einheit zu pruefen)**. |
| `parallelEvents` | int | `0` | Anzahl gleichzeitig bedienbarer Personen; `0` = unbegrenzt **(zu pruefen)**. |

**Entfallen:** `waitingTime` (ab v2.3), `waitingTimeDistribution`/`distributionParameters`/`waitingMode`
(ab v3.0 durch `waiter` ersetzt), Ampel-Attribute (v3.0: "Targets are not able to represent
traffic lights anymore"). Beispieldateien aus dem Netz, die diese Felder tragen, sind
**aelter als 3.0** und muessen migriert werden.

---

## 9. Vollstaendiges Minimalbeispiel

40 x 30 m Gebiet, ein Hindernis (Bude 6 x 3 m), eine Quelle (Eingang West), ein absorbierendes
Ziel (Sammelplatz Ost), 200 Personen in 120 s. Georeferenziert auf den Darmstaedter Marktplatz.

Aufgebaut aus den verifizierten Bloecken von
`Scenarios/Demos/AirTransmissionModel/examples/scenarios/passageway.scenario` (Release 4.0),
ohne das Infektionsmodell. Die JSON-Syntax ist maschinell geprueft; ein Lauf gegen ein echtes
Vadere-Binary steht noch aus **(zu pruefen)**.

```json
{
  "name" : "heinerfest_minimal",
  "description" : "Minimalbeispiel EventPlan3D-Export: ein Rechteck, ein Hindernis, eine Quelle, ein Ziel.",
  "release" : "4.0",
  "processWriters" : {
    "files" : [ {
      "type" : "org.vadere.simulator.projects.dataprocessing.outputfile.EventtimePedestrianIdOutputFile",
      "filename" : "postvis.traj",
      "processors" : [ 1, 2 ]
    } ],
    "processors" : [ {
      "type" : "org.vadere.simulator.projects.dataprocessing.processor.FootStepProcessor",
      "id" : 1
    }, {
      "type" : "org.vadere.simulator.projects.dataprocessing.processor.FootStepTargetIDProcessor",
      "id" : 2
    } ],
    "isTimestamped" : false,
    "isWriteMetaData" : false
  },
  "scenario" : {
    "mainModel" : "org.vadere.simulator.models.osm.OptimalStepsModel",
    "attributesModel" : {
      "org.vadere.state.attributes.models.AttributesOSM" : {
        "stepCircleResolution" : 4,
        "numberOfCircles" : 1,
        "optimizationType" : "NELDER_MEAD",
        "varyStepDirection" : true,
        "movementType" : "ARBITRARY",
        "stepLengthIntercept" : 0.4625,
        "stepLengthSlopeSpeed" : 0.2345,
        "stepLengthSD" : 0.036,
        "movementThreshold" : 0.0,
        "minStepLength" : 0.1,
        "minimumStepLength" : true,
        "maxStepDuration" : 1.7976931348623157E308,
        "dynamicStepLength" : true,
        "updateType" : "EVENT_DRIVEN",
        "seeSmallWalls" : false,
        "targetPotentialModel" : "org.vadere.simulator.models.potential.fields.PotentialFieldTargetGrid",
        "pedestrianPotentialModel" : "org.vadere.simulator.models.potential.PotentialFieldPedestrianCompactSoftshell",
        "obstaclePotentialModel" : "org.vadere.simulator.models.potential.PotentialFieldObstacleCompactSoftshell",
        "submodels" : [ ]
      },
      "org.vadere.state.attributes.models.AttributesPotentialCompactSoftshell" : {
        "pedPotentialIntimateSpaceWidth" : 0.45,
        "pedPotentialPersonalSpaceWidth" : 1.2,
        "pedPotentialHeight" : 50.0,
        "obstPotentialWidth" : 0.8,
        "obstPotentialHeight" : 6.0,
        "intimateSpaceFactor" : 1.2,
        "personalSpacePower" : 1,
        "intimateSpacePower" : 1
      },
      "org.vadere.state.attributes.models.AttributesFloorField" : {
        "createMethod" : "HIGH_ACCURACY_FAST_MARCHING",
        "potentialFieldResolution" : 0.1,
        "obstacleGridPenalty" : 0.1,
        "targetAttractionStrength" : 1.0,
        "cacheType" : "NO_CACHE",
        "cacheDir" : "",
        "timeCostAttributes" : {
          "standardDeviation" : 0.7,
          "type" : "UNIT",
          "obstacleDensityWeight" : 3.5,
          "pedestrianSameTargetDensityWeight" : 3.5,
          "pedestrianOtherTargetDensityWeight" : 3.5,
          "pedestrianWeight" : 3.5,
          "queueWidthLoading" : 1.0,
          "pedestrianDynamicWeight" : 6.0,
          "loadingType" : "CONSTANT",
          "width" : 0.2,
          "height" : 1.0
        }
      }
    },
    "attributesSimulation" : {
      "finishTime" : 300.0,
      "simTimeStepLength" : 0.4,
      "realTimeSimTimeRatio" : 0.0,
      "writeSimulationData" : true,
      "visualizationEnabled" : true,
      "printFPS" : false,
      "digitsPerCoordinate" : 2,
      "useFixedSeed" : true,
      "fixedSeed" : 1,
      "simulationSeed" : 0
    },
    "attributesPsychology" : {
      "usePsychologyLayer" : false,
      "psychologyLayer" : {
        "perception" : "SimplePerceptionModel",
        "cognition" : "SimpleCognitionModel",
        "attributesModel" : {
          "org.vadere.state.attributes.models.psychology.perception.AttributesSimplePerceptionModel" : {
            "priority" : {
              "1" : "InformationStimulus",
              "2" : "ChangeTargetScripted",
              "3" : "ChangeTarget",
              "4" : "Threat",
              "5" : "Wait",
              "6" : "WaitInArea",
              "7" : "DistanceRecommendation"
            }
          },
          "org.vadere.state.attributes.models.psychology.cognition.AttributesSimpleCognitionModel" : { }
        }
      }
    },
    "topography" : {
      "attributes" : {
        "bounds" : { "x" : 0.0, "y" : 0.0, "width" : 40.0, "height" : 30.0 },
        "boundingBoxWidth" : 0.5,
        "bounded" : true,
        "referenceCoordinateSystem" : {
          "epsgCode" : "EPSG:25832",
          "description" : "EventPlan3D Heinerfest - lokaler Ursprung = bboxMin minus 1 m Rand",
          "translation" : { "x" : 474934.48, "y" : 5524542.08 }
        }
      },
      "obstacles" : [ {
        "id" : 1,
        "shape" : {
          "type" : "POLYGON",
          "points" : [ { "x" : 16.0, "y" : 13.0 }, { "x" : 22.0, "y" : 13.0 },
                       { "x" : 22.0, "y" : 16.0 }, { "x" : 16.0, "y" : 16.0 } ]
        },
        "visible" : true
      } ],
      "measurementAreas" : [ ],
      "stairs" : [ ],
      "targets" : [ {
        "id" : 100,
        "shape" : { "x" : 37.0, "y" : 12.0, "width" : 2.0, "height" : 6.0, "type" : "RECTANGLE" },
        "visible" : true,
        "absorber" : { "enabled" : true, "deletionDistance" : 0.1 },
        "waiter" : { "enabled" : false, "distribution" : null, "individualWaiting" : true },
        "leavingSpeed" : -1.0,
        "parallelEvents" : 0
      } ],
      "targetChangers" : [ ],
      "absorbingAreas" : [ ],
      "aerosolClouds" : [ ],
      "droplets" : [ ],
      "sources" : [ {
        "id" : 10,
        "shape" : { "x" : 1.0, "y" : 12.0, "width" : 2.0, "height" : 6.0, "type" : "RECTANGLE" },
        "visible" : true,
        "targetIds" : [ 100 ],
        "spawner" : {
          "type" : "org.vadere.state.attributes.spawner.AttributesRegularSpawner",
          "constraintsElementsMax" : 200,
          "constraintsTimeStart" : 0.0,
          "constraintsTimeEnd" : 120.0,
          "eventPositionRandom" : true,
          "eventPositionGridCA" : false,
          "eventPositionFreeSpace" : true,
          "eventElementCount" : 1,
          "eventElement" : null,
          "distribution" : {
            "type" : "org.vadere.state.attributes.distributions.AttributesConstantDistribution",
            "updateFrequency" : 0.6
          }
        },
        "groupSizeDistribution" : [ 1.0 ]
      } ],
      "dynamicElements" : [ ],
      "attributesPedestrian" : {
        "shape" : { "x" : 0.0, "y" : 0.0, "width" : 1.0, "height" : 1.0, "type" : "RECTANGLE" },
        "visible" : true,
        "radius" : 0.2,
        "densityDependentSpeed" : false,
        "speedDistributionMean" : 1.34,
        "speedDistributionStandardDeviation" : 0.26,
        "minimumSpeed" : 0.5,
        "maximumSpeed" : 2.2,
        "acceleration" : 2.0,
        "footstepHistorySize" : 4,
        "searchRadius" : 1.0,
        "walkingDirectionSameIfAngleLessOrEqual" : 45.0,
        "walkingDirectionCalculation" : "BY_TARGET_CENTER"
      },
      "teleporter" : null
    },
    "stimulusInfos" : [ ]
  }
}
```

Kontrollrechnung zur Personenzahl: 120 s / 0,6 s = 200 Ereignisse a 1 Person = 200 Personen,
`constraintsElementsMax` = 200 greift also gerade nicht einschraenkend. `finishTime` = 300 s
laesst nach dem letzten Spawn noch 180 s Zeit fuer den Weg von x = 2 bis x = 38
(36 m bei 1,34 m/s = rund 27 s ohne Stau) — reichlich Reserve.

---

## 10. Abbildung EventPlan3D -> Vadere

Bezug: `shared/domain/types.ts`, `shared/domain/objekte.ts`, `shared/geo/geometry.ts`.
Alle Geometrien liegen dort bereits in EPSG:25832-Metern — es ist nur die Verschiebung aus
Kapitel 6 anzuwenden.

### 10.1 Uebersicht

| EventPlan3D | Vadere | Geometriequelle |
|---|---|---|
| `Gelaende.bbox` (bzw. Bbox der Planung) | `topography.attributes.bounds` + `translation` | `bboxVonPunkten()`, `bboxErweitern()` |
| `GelaendeGebaeude.grundriss` | `obstacles[]` POLYGON | direkt (`Ring`) |
| `ObjektInstanz` + `ObjektTyp` (Stand, Fahrgeschaeft, Buehne, Zelt) | `obstacles[]` POLYGON | `grundriss(typ, inst)` |
| `Blockflaeche` mit `typ: 'gesperrt'` | `obstacles[]` POLYGON | `polygon` |
| `Blockflaeche` mit `typ: 'nur_einsatzkraefte'` | `obstacles[]` **im Besucherszenario** | `polygon` |
| `Blockflaeche` mit `typ: 'nicht_bebaubar'` | **kein** Hindernis | — |
| `Weg` (alle Typen) | begehbarer Negativraum | `wegKorridor(polylinie, breite)` |
| Eingang (siehe 10.4) | `sources[]` | Weg-Ende an der Gebietsgrenze |
| `Einsatzstation` mit `kategorie: 'sammelplatz'` | `targets[]`, `absorber.enabled = true` | `polygon` oder `punkt` |
| `Einsatzstation` mit `kategorie: 'notausgangspunkt'` | `targets[]`, `absorber.enabled = true` | `polygon` oder `punkt` |
| `Projekt.maxBesucher` | Summe `constraintsElementsMax` ueber alle `sources` | — |
| Engstellen aus dem Pruefbericht | `measurementAreas[]` | `Pruefergebnis.geometrie` |

### 10.2 Hindernisse im Einzelnen

**Gebaeude.** `Gelaende.gebaeude[].grundriss` ist bereits ein `Ring` in EPSG:25832 -> nach der
Verschiebung direkt ein POLYGON-Hindernis. Nur Gebaeude innerhalb der Planungs-Bbox exportieren.
`bodenHoehe`/`traufHoehe`/`firstHoehe` werden ignoriert (Vadere ist 2D).

**Objekte (Staende, Fahrgeschaefte, Buehnen, Zelte).**
`grundriss(typ, inst)` aus `shared/domain/objekte.ts` liefert den gedrehten, massstaeblichen
Grundriss als `Ring` — inklusive `masseOverride` und `rotation`.

> **Nicht `grundrissMitUmlauf()` verwenden.** Der Umlauf `flaechenbedarfZusatz` ist ein
> planungsrechtlicher Freihaltebereich (Abstandsflaeche), keine physische Wand. Er darf die
> Personen nicht blockieren, sonst wird der Weg im Modell schmaler als in der Realitaet und
> die Simulation liefert kuenstlich zu hohe Dichten.

Kategorien, die **keine** Hindernisse werden: `moeblierung` **(Entscheidung zu treffen —
Baenke und Muelleimer sind physisch durchaus Hindernisse, aber unterhalb der Modellaufloesung;
Vorschlag: nur ab einer Mindestgrundflaeche, z. B. 1 m^2, exportieren)**.
`absperrung` wird **immer** Hindernis — das ist ihr ganzer Zweck.

**Blockflaechen.** Nur `typ: 'gesperrt'` und `typ: 'nur_einsatzkraefte'` sind physische Sperren.
`typ: 'nicht_bebaubar'` ist eine reine Planungsrestriktion ("hier darf nichts hingestellt werden")
und muss begehbar bleiben. Wer sie zum Hindernis macht, sperrt Personen aus einer Flaeche aus,
die in Wirklichkeit offen ist.

Fuer ein **Einsatzkraefte-Szenario** (Zugang der Feuerwehr) wird `nur_einsatzkraefte` umgekehrt
zur begehbaren Flaeche. Der Exporter braucht daher einen Schalter `perspektive: 'besucher' | 'einsatz'`.

### 10.3 Wege: Vadere kennt keine "begehbare Flaeche"

Vadere hat **kein** Element fuer begehbaren Raum. Begehbar ist alles, was **kein** Hindernis ist.
`Weg` muss deshalb als **Negativraum** ausgedrueckt werden. Zwei Strategien:

**Strategie A — additiv (empfohlen fuer den ersten Wurf).**
Nur die tatsaechlichen Koerper werden Hindernisse (Gebaeude, Objekte, gesperrte Flaechen).
Alles andere ist begehbar. `Weg` fliesst gar nicht in die Datei ein.

* Vorteil: einfach, robust, keine Boolesche Geometrie, keine Splitterpolygone.
* Nachteil: Personen laufen auch dort, wo im Plan gar kein Weg vorgesehen ist
  (Rasenflaechen, Zwischenraeume). Fuer die Frage "reichen die Wegbreiten zwischen den Buden"
  ist das trotzdem meist die realistischere Annahme — Besucher halten sich nicht an gezeichnete Wege.

**Strategie B — subtraktiv (praezise, aufwendiger).**

```
begehbar   = union( wegKorridor(weg.polylinie, weg.breite) fuer alle Wege )
             union( Platzflaechen )
hindernis  = bounds-Rechteck  MINUS  begehbar  MINUS  (nichts)
             PLUS  Gebaeude, Objekte, Blockflaechen
```

Die Boolesche Operation liefert `polygon-clipping` (bereits in `package.json`).
Fallstricke: das Ergebnis ist ein **MultiPolygon mit Loechern** — jedes Loch muss aufgeloest und
jeder Teil als eigenes lochfreies POLYGON-Hindernis geschrieben werden (Kapitel 5.2).
Schmale Splitter (< ~0,2 m) vorher wegwerfen, sonst explodiert die Hindernisanzahl und mit ihr
die Rechenzeit des Potenzialfelds.

`Weg.richtung` (`vorwaerts`/`rueckwaerts`/`beide`) laesst sich in Vadere nur ueber
`targetChangers` als Wegfuehrung nachbilden — im ersten Exporter **nicht** abbilden.

### 10.4 Quellen: EventPlan3D hat keinen Eingangstyp

**Das ist eine echte Luecke.** Das Domaenenmodell kennt keine Entitaet "Gelaendeeingang".
`Zugang` in `shared/domain/types.ts` beschreibt Ein-/Ausstiege **eines Objekts**
(Fahrgeschaeft-Einstieg), nicht den Zugang zum Gelaende.

Drei Wege, in Reihenfolge der Empfehlung:

1. **Neues Feld** `Eingang` (Punkt + Breite + erwarteter Besucheranteil) im Domaenenmodell
   ergaenzen. Sauber, explizit, planbar. **Empfohlen.**
2. **Ableiten aus `Weg`:** jedes Ende einer `besucherweg`-Polylinie, das die Gelaendegrenze
   (`Gelaende.polygon`) schneidet, wird ein Eingang. Quellflaeche = Rechteck der Breite
   `weg.breite` quer zur Wegrichtung, Tiefe rund 2 m. Kein Modellumbau noetig, aber die
   Erkennung ist heuristisch.
3. **Manuell im Exportdialog** setzen. Als Rueckfallebene immer anbieten.

Quellflaechen muessen **vollstaendig innerhalb `contentRect`** liegen (Kapitel 4.1) und duerfen
**kein Hindernis beruehren** — Ueberlappung Obstacle/Source ist im TopographyChecker ein **Fehler**,
nicht nur eine Warnung.

### 10.5 Ziele

Sammelplaetze und Notausgangspunkte werden `targets` mit `absorber.enabled = true`.

`Einsatzstation` traegt entweder `punkt` oder `polygon`:

* `polygon` -> POLYGON-Shape direkt.
* `punkt` -> Vadere braucht eine Flaeche. Quadrat um den Punkt legen, Kantenlaenge konfigurierbar,
  Vorschlag 4 m. Ein zu kleines Ziel staut sich zu, ein zu grosses verfaelscht die Laufwege.

Jede Quelle braucht mindestens ein Ziel in `targetIds`, und jedes Ziel sollte von mindestens
einer Quelle referenziert werden (sonst Warnung und unnoetige Potenzialfeldberechnung).

**Zieltrennung bei mehreren Sammelplaetzen:** OSM laesst jede Person die `targetIds` ihrer Quelle
der Reihe nach abarbeiten. Sollen sich Personen auf **mehrere** Sammelplaetze verteilen, geht das
**nicht** ueber eine Quelle mit mehreren `targetIds` (das waere eine Route ueber alle nacheinander).
Stattdessen: die Quelle in mehrere Quellen mit gleicher Geometrie und je einem Ziel aufteilen und
die Personenzahl ueber `constraintsElementsMax` aufteilen. **(Verhalten von `targetIds` als
sequenzielle Route ist aus der Vadere-Dokumentationslage abgeleitet und zu pruefen.)**

### 10.6 Personenzahl: `maxBesucher` -> Summe `spawnNumber`

```
Sigma ueber alle sources: constraintsElementsMax  =  Projekt.maxBesucher
```

Aufteilung auf die Eingaenge nach einem Gewicht `w_i` (Default: gleichverteilt; besser:
nach Eingangsbreite oder erwartetem Anteil):

```
constraintsElementsMax_i = round(maxBesucher * w_i)
```

**Rundungsdifferenz auf die groesste Quelle aufschlagen**, damit die Summe exakt `maxBesucher` ist.

**Zwei fachlich verschiedene Szenarien — nicht verwechseln:**

| Szenario | Bedeutung | Parameter |
|---|---|---|
| **Zustrom / Anreise** | `maxBesucher` kommen ueber die Veranstaltungsdauer an | `constraintsTimeEnd` = realistische Anreisedauer (Stunden); Ziel = Attraktionen. Fuer die Ganglinie `AttributesTimeSeriesSpawner`. |
| **Raeumung / Entfluchtung** | `maxBesucher` sind bereits auf dem Gelaende und muessen raus | Personen muessen **verteilt** starten, nicht an den Eingaengen. Praktikabel: viele kleine Quellen ueber das Gelaende mit `constraintsTimeStart = constraintsTimeEnd = 0`; Ziele = Sammelplaetze. Sauberer waere `dynamicElements` — dessen Format ist aber **(zu pruefen)**, Kapitel 4.10. |

Fuer die Bewertung nach `Regel`/`Pruefergebnis` (`kapazitaet_vs_wegbreite`, `rettungsweglaenge_max`)
ist der **Raeumungsfall** der relevante. Der Exporter sollte beide Varianten erzeugen koennen.

`maxBesucher` ist eine **Planungsgroesse des Veranstalters**, kein Messwert — sie ist bereits
Pflichtfeld in `Projekt` und wandert unveraendert durch. Der Simulationsbericht muss sie mit
Herkunft ausweisen.

---

## 11. Struktur-Check: was ein Validator mindestens pruefen muss

Der Exporter sollte **vor** dem Schreiben validieren. Reihenfolge: erst JSON-Ebene, dann
Referenzen, dann Geometrie, dann Plausibilitaet.

### 11.1 JSON- und Serialisierungsebene

| # | Pruefung | Warum |
|---|---|---|
| 1 | Datei ist gueltiges JSON, UTF-8, **ein** Wurzelobjekt | `StateJsonConverter.checkForTextOutOfNode` lehnt Text nach dem Wurzelknoten ab. |
| 2 | **Keine doppelten Schluessel** in irgendeinem Objekt | `JsonParser.Feature.STRICT_DUPLICATE_DETECTION` ist in `JacksonObjectMapper` aktiv -> harter Parserfehler. |
| 3 | **Keine unbekannten Feldnamen** | `JacksonObjectMapper` deaktiviert `FAIL_ON_UNKNOWN_PROPERTIES` **nicht**, Jacksons Default ist `true` -> `UnrecognizedPropertyException`. Ein Tippfehler wie `absorbers` bricht das Laden ab. Konkret betroffen: `alwaysSpawnAtConstraintsTimeStart` gegenueber Release 4.0 (7.2). **(einmal praktisch gegen die Zielversion verifizieren)** |
| 4 | Booleans sind echte JSON-Booleans | `JacksonObjectMapper` registriert einen strengen Boolean-Deserializer, der `0`/`1`/`"true"` zurueckweist. |
| 5 | `int`-Felder ohne Nachkommastellen: `id`, `treadCount`, `eventElementCount`, `constraintsElementsMax`, `digitsPerCoordinate`, `parallelEvents`, `processors[].id` | `ACCEPT_FLOAT_AS_INT` ist gesetzt; der Kommentar im Quelltext und das Verhalten widersprechen sich. Ganzzahlen schreiben und die Frage ist erledigt. |

### 11.2 Pflichtfelder

| # | Pruefung |
|---|---|
| 6 | Top-Level: `name`, `description`, `release`, `processWriters`, `scenario` vorhanden |
| 7 | `release` ist ein bekanntes `Version`-Label (`"4.0"`, `"4.1"`, `"3.0"`, …) — sonst `MigrationException` |
| 8 | `scenario`: `mainModel`, `attributesModel`, `attributesSimulation`, `attributesPsychology`, `topography` vorhanden; `stimulusInfos` vorhanden (mindestens `[]`) |
| 9 | `mainModel` ist einer der Strings aus Kapitel 2 |
| 10 | `attributesModel` enthaelt **genau einmal** jeden vom `mainModel` benoetigten Block (OSM: `AttributesOSM`, `AttributesFloorField`, `AttributesPotentialCompactSoftshell`) — fehlend = `AttributesNotFoundException`, doppelt = `AttributesMultiplyDefinedException` |
| 11 | `topography.attributes.bounds` vorhanden mit `width > 0` und `height > 0` |

### 11.3 Referenzielle Integritaet

| # | Pruefung | Konsequenz in Vadere |
|---|---|---|
| 12 | Jede `source.targetIds`-ID existiert in `targets[].id` | **Fehler** ("A Source has a targetId set but the target does not exist") |
| 13 | Jede Quelle hat mindestens eine `targetId` | **Fehler**, wenn die Quelle Personen erzeugt |
| 14 | `targets[].id` sind untereinander eindeutig und `!= -1` | sonst greift `Topography.getTarget(id)` das falsche Ziel |
| 15 | `sources[].id` sind eindeutig | Zuordnung der Ausgabedaten |
| 16 | Jedes Ziel wird von mindestens einer Quelle referenziert | **Warnung** ("A Target is never used by any Source ... this will cost performance") |
| 17 | `targetChangers[].nextTarget`-IDs existieren | analog |
| 18 | `processWriters.files[].processors` verweist auf existierende `processors[].id` | sonst leere Ausgabedatei |

Belege Spalte 3: `Documentation/changelog/TopographyCheckerMessages.md`.

### 11.4 Geometrie

| # | Pruefung | Konsequenz |
|---|---|---|
| 19 | **Jedes** Element liegt vollstaendig in `contentRect` (= `bounds` minus `boundingBoxWidth` ringsum) | Elemente ausserhalb sind unerreichbar bzw. stecken in der Randmauer |
| 20 | POLYGON hat >= 3 Punkte, keine Doppelpunkte, ist nicht selbstueberschneidend, erster Punkt **nicht** wiederholt | `polygonFromPoints2D` liefert sonst Unsinn |
| 21 | RECTANGLE: `width > 0`, `height > 0` | |
| 22 | CIRCLE: `radius > 0` | Javadoc `VCircleStore`: "It cannot be less or equals zero" |
| 23 | **Obstacle / Source ueberlappen nicht** (weder teilweise noch ganz) | **Fehler — Simulation nicht moeglich** |
| 24 | **Obstacle / Target** ueberlappen nicht vollstaendig | vollstaendig = **Fehler**, teilweise = Warnung |
| 25 | Stairs / Stairs ueberlappen nicht | **Fehler** |
| 26 | Obstacle / Obstacle | nur Warnung — fuer den Exporter unkritisch, aber Zusammenfuehren spart Rechenzeit |
| 27 | Source / Source, Source / Target, Target / Target | Warnungen |
| 28 | Jedes Ziel ist von jeder Quelle aus **erreichbar** (nicht von Hindernissen eingeschlossen) | Vadere prueft das nicht — Personen laufen dann bis `finishTime` gegen eine Wand. **Der Exporter muss das selbst pruefen**, etwa per Flutfuellung auf einem Raster von `potentialFieldResolution` |

Belege Spalten 23–27: `Documentation/changelog/TopographyCheckerMessages.md`, Tabelle "Overlapping ScenarioElements".

### 11.5 Plausibilitaet

| # | Pruefung | Konsequenz |
|---|---|---|
| 29 | `minimumSpeed <= speedDistributionMean <= maximumSpeed` | **Fehler** im TopographyChecker |
| 30 | `maximumSpeed <= 12.0` m/s | Warnung (Weltrekord) |
| 31 | `radius > 0` und `2 * radius` deutlich kleiner als die schmalste Engstelle | sonst kommt niemand hindurch |
| 32 | `finishTime > constraintsTimeEnd` aller Quellen, mit Reserve fuer die laengste Gehstrecke | sonst unbrauchbare Raeumungszeit |
| 33 | `simTimeStepLength > 0`; Repo-Standard `0.4` | |
| 34 | Summe der `constraintsElementsMax` == `Projekt.maxBesucher` (exakt, nach Rundungsausgleich) | fachliche Korrektheit des Berichts |
| 35 | Kein `constraintsElementsMax` == `-1` bei einem Kapazitaetsnachweis | unbegrenzte Erzeugung ist fuer eine Behoerdenunterlage wertlos |
| 36 | `constraintsTimeEnd > constraintsTimeStart` (ausser bei gewolltem Einmal-Spawn) | Default `0.0` erzeugt sonst stillschweigend niemanden |
| 37 | `potentialFieldResolution` passt zur Gebietsgroesse | Gitter = `bounds.width * bounds.height / res^2` Zellen. Bei 500 x 500 m und `res = 0.1` sind das 25 Mio. Zellen **je Ziel** — Warnschwelle einbauen |
| 38 | `useFixedSeed == true` und `fixedSeed` dokumentiert | Reproduzierbarkeit fuer die Behoerde |
| 39 | Anzahl Hindernisse in vernuenftigem Rahmen (Warnschwelle z. B. 2 000) | Strategie B in 10.3 kann tausende Splitter erzeugen |

### 11.6 Gegenprobe gegen Vadere selbst

Der beste Validator ist Vadere. Nach dem Export einmal ueber die Konsole laufen lassen:

```
java -jar vadere-console.jar scenario-run --scenario-file <datei>.scenario --output-dir <ordner>
```

Der TopographyChecker meldet dann alle Fehler und Warnungen aus 11.3/11.4/11.5.
Das gehoert in die CI, mit einem festen Referenzprojekt als Regressionstest.
**(Der exakte Aufruf ist aus `VadereSimulator/src/org/vadere/simulator/entrypoints/cmd/commands/ScenarioRunSubCommand.java`
abgeleitet, aber nicht ausgefuehrt worden — Parameternamen zu pruefen.)**

---

## 12. Offene Punkte

| Thema | Status |
|---|---|
| Klassennamen fuer GNM, BHM, RSM als `mainModel` | zu pruefen (Kapitel 2) |
| Serialisierungsformat von `dynamicElements` (vorplatzierte Personen) | zu pruefen (Kapitel 4.10) — blockiert den sauberen Raeumungsfall |
| Parameterfelder von Binomial-, Normal-, Empirical-, LinearInterpolation-, Mixed-Verteilung | zu pruefen (Kapitel 7.3) |
| `attributes`-Schemata der Dichte- und Raeumungszeit-Prozessoren | zu pruefen (Kapitel 1.2) |
| Genaue Spawn-Zahl am Intervallrand (`alwaysSpawnAtConstraintsTimeStart`) | zu pruefen (Kapitel 7.4) |
| `targetIds` mit mehreren Zielen = sequenzielle Route? | zu pruefen (Kapitel 10.5) |
| `leavingSpeed`-Einheit, `parallelEvents`-Semantik | zu pruefen (Kapitel 8) |
| Ringorientierung: normalisiert `polygonFromPoints2D` selbst? | zu pruefen (Kapitel 5.2) |
| `FAIL_ON_UNKNOWN_PROPERTIES` praktisch gegen 4.0 verifizieren | zu pruefen (Kapitel 11.1) |
| Eingangs-Entitaet im EventPlan3D-Domaenenmodell | Entscheidung offen (Kapitel 10.4) |
| Umgang mit `moeblierung` als Hindernis | Entscheidung offen (Kapitel 10.2) |
| Minimalbeispiel gegen echtes Vadere-Binary laufen lassen | offen (Kapitel 9) |

---

## 13. Quellen

**Vadere-Projekt**

* Projektseite: <https://www.vadere.org/>
* Quelltext: <https://gitlab.lrz.de/vadere/vadere>
* CHANGELOG: <https://gitlab.lrz.de/vadere/vadere/-/raw/master/CHANGELOG.md>
  (v4.0 vom 2026-04-07; v3.0 vom 2023-10-04 mit der Spawner-Umstellung; v2.3 vom 2022-09-01
  mit dem Entfall von `waitingTime`; v1.3 vom 2019-07-31 mit `referenceCoordinateSystem`)

**Echte Szenariodateien (Release 4.0), gegen die verifiziert wurde**

* `Scenarios/Demos/AirTransmissionModel/examples/scenarios/passageway.scenario` — OSM, Quellen, Ziele, vollstaendiger `attributesModel`
* `Scenarios/ModelTests/TestSFM/scenarios/basic_1_chicken_sfm1.scenario` — SFM, RECTANGLE-Hindernisse
* `Scenarios/ModelTests/TestStairs/scenarios/stairs_diagonal_1_+1.scenario` — `stairs`, POLYGON
* `Scenarios/Demos/S2UCRE/scenarios/bridge_coordinates_kai.scenario` — POLYGON-Hindernisse
* `Scenarios/Demos/S2UCRE/scenarios/MWE_groups_target_changer.scenario` — `targetChangers`, `waiter` mit Verteilung
* `Scenarios/Demos/supermarket/scenarios/Liddle_osm_v4.scenario` — `measurementAreas`

**Java-Attributklassen (`VadereState/src/org/vadere/state/`)**

`attributes/scenario/`: `AttributesTopography`, `AttributesVisualElement`, `AttributesObstacle`,
`AttributesTarget`, `AttributesSource`, `AttributesTargetChanger`, `AttributesMeasurementArea`,
`AttributesAbsorbingArea`, `AttributesStairs`, `AttributesTeleporter`, `AttributesAgent`
`attributes/`: `AttributesSimulation`, `AttributesPsychology`
`attributes/spawner/`: `AttributesSpawner`, `AttributesRegularSpawner`, `AttributesTimeSeriesSpawner`,
`AttributesLerpSpawner`, `AttributesMixedSpawner`
`attributes/distributions/`: `AttributesDistribution` und Unterklassen
`scenario/`: `Topography` (`getContentRect`, `createObstacleBoundary`), `ReferenceCoordinateSystem`
`util/`: `JacksonObjectMapper`, `StateJsonConverter`, `VRectangleStore`, `VPolygon2DStore`, `VCircleStore`

**Simulator (`VadereSimulator/src/org/vadere/simulator/`)**

`projects/io/JsonConverter`, `projects/dataprocessing/DataProcessingJsonManager`,
`projects/migration/jsontranformation/JsonMigrationAssistant`, `models/Model`,
`models/osm/OptimalStepsModel`, `models/potential/PotentialFieldPedestrianCompactSoftshell`,
`models/potential/PotentialFieldObstacleCompactSoftshell`

**Weiteres**

* `Documentation/changelog/TopographyCheckerMessages.md` — Validierungsregeln (Kapitel 11)
* `VadereUtils/src/org/vadere/util/version/Version.java` — gueltige `release`-Labels
* `Documentation/scenario/*.md` — **veraltet, nicht verwenden** (Kapitel 0)

**EventPlan3D (dieses Projekt)**

* `shared/domain/types.ts` — Domaenenmodell, EPSG:25832-Konvention, `Ring`-Definition
* `shared/domain/objekte.ts` — `grundriss()`, `grundrissMitUmlauf()`, `zugaengeWelt()`
* `shared/geo/geometry.ts` — `wegKorridor()`, `kreisRing()`, `gegenUhrzeiger()`, `bboxVonPunkten()`, `bboxErweitern()`
* `shared/geo/proj.ts` — `massstabsfaktor()`, `meridiankonvergenz()`

**Gerechnete Werte**

* Darmstadt Marktplatz 49,87276 N / 8,65117 E -> EPSG:25832 E 474 934,48 / N 5 524 542,08;
  UTM-Massstabsfaktor k = 0,99960769 (-392 ppm). Gerechnet am 07.08.2026 mit `proj4` 2.15
  und der Formel aus `shared/geo/proj.ts`. Die Stuetzkoordinate selbst ist eine ueberschlaegige
  Ortsangabe fuer das Beispiel, **kein amtlicher Festpunkt**.
