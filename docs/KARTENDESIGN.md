# KARTENDESIGN — wie Lesbarkeit in Karten und 3D-Stadtmodellen entsteht

**Zweck.** Grundlage für die Neufassung der Darstellung in EventPlan3D. Der Auftraggeber hat die
aktuelle Fassung mit „entspricht ca. 20 % meiner Vorstellung" zurückgewiesen; seine Punkte waren:
Straßen nicht erkennbar, Grünflächen „random", Wege sehen nicht nach Wegen aus, kein Luftbild und
keine Fotogrammetrie, sondern eine aus echten Maßen gebaute Welt, und: „alles in verschiedenen
Kontrasten, keine bunte Masse".

**Belegregel.** Jede Zahl in diesem Dokument hat eine Quelle mit URL und Abrufdatum. Alle Abrufe
erfolgten am **07.08.2026**. Werte, die nicht aus einer Quelle stammen, sondern von mir aus belegten
Werten berechnet wurden (im Wesentlichen die CIELAB-L\*-Angaben), sind als **[berechnet]**
gekennzeichnet — Umrechnung sRGB → CIELAB, Weißpunkt D65, Standardformel.

**Nicht belegt = nicht behauptet.** Wo eine Quelle die gewünschte Zahl nicht hergab, steht das
ausdrücklich da (z. B. Google publiziert seine Standardfarben nicht).

---

## 1 Kartografische Grundtechniken für Verkehrsflächen

### 1.1 Casing / Kontur — warum die doppelte Zeichnung Straßen lesbar macht

**Was es ist.** Casing ist eine zweite, breitere Linie in kontrastierendem Ton, die unter der
eigentlichen Füllung liegt und links und rechts als schmaler Saum sichtbar bleibt. Esri beschreibt
es als „visually protective wrapper around a symbol", der die Linie „over most any background"
sichtbar hält, und nennt als Zweck ausdrücklich die visuelle Hierarchie in Straßennetzen.
(Quelle: Esri/Adventures in Mapping, „Make lines legible, and POP, with casing",
https://adventuresinmapping.com/2026/01/14/make-lines-legible-and-pop-with-casing/ — abgerufen 07.08.2026)

**Warum es funktioniert — drei Wirkungen, die eine einfache Füllung nicht hat:**

1. **Konstanter lokaler Kontrast.** Die Füllung muss nicht mehr gegen den jeweiligen Untergrund
   ankommen (Bauflächen, Grün, Wasser, Gebäude — alle verschieden hell). Sie muss nur gegen ihre
   eigene Kontur ankommen, und dieser Kontrast ist überall identisch. Genau das ist der Grund, warum
   ein Straßennetz auch über einer heterogenen Fläche als *ein zusammenhängendes Netz* liest.
   Esri formuliert das Problem so: „highly variable visual content" hinter Linienobjekten macht sie
   schwer sichtbar (Quelle wie oben).
2. **Trennung paralleler Linien.** Zwei nebeneinanderliegende Fahrbahnen (Richtungsfahrbahnen,
   Fahrbahn + Gehweg) verschmelzen ohne Kontur zu einem Balken. Mit Kontur bleibt zwischen ihnen ein
   dunkler Strich stehen — aus einer Fläche werden wieder zwei Objekte.
3. **Kreuzungslogik.** Weil Kontur und Füllung in getrennten Zeichenebenen liegen (erst alle
   Konturen, dann alle Füllungen), überdeckt an einer Kreuzung die Füllung der einen Straße die
   Kontur der anderen — die Straßen „fließen" durcheinander, statt sich gegenseitig zu zerschneiden.
   Alle drei unten untersuchten Vektorstile bauen ihre Straßen genau so auf.

**Die üblichen Breitenverhältnisse.** Ich habe die tatsächlichen Werte aus drei offenen bzw.
amtlichen Stilen ausgelesen. Das Ergebnis ist erstaunlich einheitlich:

| System | Klasse / Zoom | Kontur (px) | Füllung (px) | Saum je Seite | Verhältnis |
|---|---|---|---|---|---|
| basemap.de Web Vektor Farbe | Gemeindestr., z14 | 4,0 | 3,0 | 0,50 | 1,33 |
| basemap.de Web Vektor Farbe | Gemeindestr., z16 | 8,0 | 6,0 | 1,00 | 1,33 |
| basemap.de Web Vektor Farbe | Gemeindestr., z20 | 20,0 | 18,0 | 1,00 | 1,11 |
| basemap.de Web Vektor Farbe | Kreisstr., z20 | 22,0 | 20,0 | 1,00 | 1,10 |
| basemap.de Web Vektor Farbe | Bundesstr., z20 | 22,0 | 20,5 | 0,75 | 1,07 |
| basemap.de Web Vektor Farbe | Fußweg auf Brücke, z20 | 5,5 | 4,0 | 0,75 | 1,38 |
| CARTO Positron | road_minor, z18 | 14 | 12 | 1,00 | 1,17 |
| CARTO Positron | road_sec, z18 | 16 | 14 | 1,00 | 1,14 |
| CARTO Positron | road_pri, z18 | 18 | 16 | 1,00 | 1,13 |
| CARTO Positron | road_mot, z18 | 22 | 20 | 1,00 | 1,10 |
| CARTO Positron | road_sec, z16 | 8 | 6 | 1,00 | 1,33 |
| OpenStreetMap Carto | tertiary, z17 | 18,0 | 16,4 | 0,80 | 1,10 |
| OpenStreetMap Carto | residential, z17 | 12,0 | 10,4 | 0,80 | 1,15 |
| OpenStreetMap Carto | service, z17 | 7,0 | 5,4 | 0,80 | 1,30 |

Quellen der Rohwerte:
basemap.de Web Vektor Farbe, Style-JSON `bm_web_col.json` (550 Layer, MapLibre/Mapbox-Style v8),
https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json — abgerufen 07.08.2026;
CARTO Positron, https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json — abgerufen 07.08.2026;
OpenStreetMap Carto, `style/roads.mss` (`@casing-width-z17: 0.8`, Füllbreite = Gesamtbreite − 2 × Casing),
https://raw.githubusercontent.com/gravitystorm/openstreetmap-carto/master/style/roads.mss — abgerufen 07.08.2026.
Spalten „Saum je Seite" und „Verhältnis" sind **[berechnet]** aus diesen Werten.

> **Die Regel, die sich daraus ableiten lässt:** Die Kontur ragt **konstant etwa 0,75–1,0 px je
> Seite** über die Füllung hinaus — unabhängig von der Straßenklasse. Das Verhältnis Kontur:Füllung
> ist deshalb *keine* Konstante, sondern fällt von ca. **1,3–1,4 bei schmalen Wegen** auf ca.
> **1,07–1,15 bei breiten Straßen**. Schmale Objekte brauchen relativ die dickste Kontur, sonst
> verschwinden sie. Wichtig für EventPlan3D: die Kontur ist eine **Bildschirmgröße in Pixeln**, keine
> Weltgröße in Metern — sie darf beim Zoomen nicht mitskalieren, sonst wird sie in der Nahansicht
> zum Betonrand und in der Fernansicht unsichtbar.

**Der Fachbegriff im deutschen amtlichen Stil.** basemap.de nennt die beiden Ebenen wörtlich
`Kontur_*` und `Decker_*` (z. B. `Kontur_Gemeindestr_Sonstige_Str` / `Decker_Gemeindestr_Sonstige_Str`).
Das ist die amtliche Umsetzung genau dieser Technik — nützlich, weil die Nomenklatur direkt in den
Code von EventPlan3D übernommen werden kann.
(Quelle: `bm_web_col.json`, Layer-IDs — abgerufen 07.08.2026)

### 1.2 Straßenhierarchie: worüber gute Karten Klassen unterscheiden

Aus dem Vergleich der Referenzstile ergeben sich vier Mittel, die immer in Kombination auftreten:

| Mittel | Positron (hell, entsättigt) | basemap.de Farbe (amtlich) | OSM Carto (bunt) | basemap.de Grau |
|---|---|---|---|---|
| **Breite** | ja: mot 20 px > pri 16 > sec 14 > minor 12 (z18) | ja: Bundes 20,5 > Kreis 20 > Gemeinde 18 (z20) | ja: tertiary 18 > residential 12 > service 7 (z17) | ja, identisch zu Farbe |
| **Helligkeit der Füllung** | minimal: `#fff` vs `#fdfdfd` | ja: Autobahn dunkel-blau vs Gemeindestr. weiß | ja: motorway `#e892a2` bis residential `#ffffff` | **Hauptmittel**: 255 / 216 / 229 |
| **Farbton der Füllung** | nein (alles neutral) | **Hauptmittel**: blau / bernstein / gelb / weiß | **Hauptmittel**: rot-orange-gelb-Rampe | nein |
| **Konturfarbe** | einheitlich `#ddd`–`#e6e6e6` | einheitlich `rgb(153,153,153)` | **je Klasse eigene Kontur** (s. Tabelle 2.4) | einheitlich `rgb(102,102,102)` |

Zwei brauchbare Lehren daraus:

- **Positron und basemap.de Grau tragen die gesamte Hierarchie über Breite** und halten die Farbe
  konstant. Das ist genau das Modell, das der Auftraggeber verlangt („verschiedene Kontraste, keine
  bunte Masse"): die Klasse steckt in der Geometrie, nicht im Farbton.
- **OSM Carto ist der Gegenentwurf** — dort variiert die Konturfarbe mit der Klasse. Die
  Konturfarben sind dabei systematisch erzeugt: `road-colors.yaml` definiert für die Füllung
  Lightness 70→97 und Chroma 35→29 über die Klassen motorway→secondary, für die Kontur dagegen
  Lightness 50→50 und Chroma 70→55, bei einem Farbwinkel von 10°→106°. Die Kontur ist also
  *systematisch dunkler und bunter* als die Füllung.
  (Quelle: https://raw.githubusercontent.com/gravitystorm/openstreetmap-carto/master/road-colors.yaml — abgerufen 07.08.2026)

### 1.3 Wie Gehwege von Fahrbahnen abgesetzt werden

Vier belegte Verfahren, in der Reihenfolge ihrer Wirkung:

1. **Eigene, deutlich dunklere Kontur bei sehr schmaler Füllung.** basemap.de zeichnet Fußwege in
   der Fläche gar nicht, sondern nur als Kontur `rgb(153,153,153)` mit 1 px (z14) bis 4 px (z20).
   Erst auf Brücken bekommt der Fußweg eine eigene Füllung: `Bruecke_Fusswege_Kontur` 5,1 px
   `rgb(153,153,153)` mit `Bruecke_Fusswege_Decker` 3,6 px `rgb(255,255,255)`.
   (Quelle: `bm_web_col.json` — abgerufen 07.08.2026)
2. **Helligkeitssprung nach unten gegenüber der Fahrbahn.** In basemap.de **Grau** liegt die
   Fahrbahn der Gemeindestraße auf `rgb(255,255,255)` = L\* 100,0 **[berechnet]**, der
   Hauptwirtschaftsweg dagegen auf `rgb(238,238,238)` = L\* 94,1 **[berechnet]** — ein Abstand von
   knapp 6 L\*-Einheiten bei gleicher Kontur. Der Weg ist also *derselbe Bautyp*, nur eine Stufe
   dunkler. (Quelle: `bm_web_gry.json`,
   https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json — abgerufen 07.08.2026)
3. **Farbstich statt Buntheit.** basemap.de Farbe gibt der Fußgängerzone einen eigenen, sehr
   schwachen Farbstich: `rgb(182,223,210)` (L\* 85,7 / a\* −15,9 / b\* +1,9 **[berechnet]**) — ein
   entsättigtes Minttürkis, das sich vom weißen Fahrbahn-Decker klar absetzt, ohne bunt zu wirken.
   Dieselbe Farbe wird sowohl als Fläche (`Verkehrsflaeche_Fussgaengerzone`) als auch als
   Linien-Decker (`Decker_Fussgaengerzone_Gemeindestr_Sonstige_Str`) verwendet — Fläche und Achse
   sind farbidentisch, das verhindert Doppelbilder. (Quelle: `bm_web_col.json` — abgerufen 07.08.2026)
4. **Strichelung als Klassenmerkmal für „nicht befahrbar".** Positron zeichnet `road_path` mit
   `line-dasharray` 2,2 (z15) bis 3,3 (z18) in `#d5d5d5` bei 0,5–3 px Breite; OSM Carto strichelt
   Fußwege ebenfalls. Die Strichelung sagt „das ist keine Fahrbahn", ohne einen zusätzlichen Farbton
   zu verbrauchen. (Quellen: Positron style.json; OSM Carto `roads.mss` — beide abgerufen 07.08.2026)

**Der Bordstein als eigene Linie** wird in keinem der untersuchten 2D-Vektorstile als eigenes Objekt
geführt — er *ist* dort die Kontur. Für ein 3D-Modell mit echten Maßen ist das aber eine reale
Option, weil der Höhensprung ohnehin modelliert werden kann (siehe Abschnitt 5).

### 1.4 Wie man den „knubbeligen" Eindruck gepufferter Achsen vermeidet

Das Problem hat drei Ursachen, jede mit einer belegten Gegenmaßnahme:

**(a) Rundkappen an den Achsenenden.** Der Default beim Puffern ist `round`. PostGIS bietet dafür
explizit Parameter: „The endcap style can be set with `endcap=round|flat|square` (defaults to
round)", `butt` ist Synonym für `flat`; „The join style can be controlled with
`join=round|mitre|bevel` (defaults to round)", `mitre_limit=#.#` begrenzt die Gehrungslänge. Die
Dokumentation nennt als Anwendungsfall wörtlich das Umwandeln von Straßen-Linestrings in
Straßenpolygone „with flat or square edges instead of rounded edges".
(Quelle: PostGIS, ST_Buffer, https://postgis.net/docs/ST_Buffer.html — abgerufen 07.08.2026)
→ **`endcap=flat join=mitre mitre_limit=2.0`** statt der Defaults.

**(b) Rundgelenke an jedem Stützpunkt.** Dieselbe Unterscheidung gibt es auf der Renderseite. Die
MapLibre-/Mapbox-Style-Spezifikation definiert für Linien:
`line-join: bevel` = „A join with a squared-off end which is drawn beyond the endpoint of the line
at a distance of one-half of the line's width"; `round` = „…at a radius of one-half of the line's
width and centered on the endpoint"; `miter` = „A join with a sharp, angled corner which is drawn
with the outer sides beyond the endpoint of the path until they meet"; `line-miter-limit` wird
„used to automatically convert miter joins to bevel joins for sharp angles" eingesetzt.
`line-cap` kennt entsprechend `butt` („drawn to the exact endpoint of the line"), `round` und `square`.
(Quelle: MapLibre Style Spec, Layers, https://maplibre.org/maplibre-style-spec/layers/ — abgerufen 07.08.2026)
→ Für Straßenpolygone in einem 3D-Netz: **Gehrung mit Limit**, nie Rundung.

**(c) Jede Achse wird einzeln gepuffert und einzeln gezeichnet.** Solange die Puffer einzelne
Polygone bleiben, sieht man an jeder Kreuzung die Überlappungskanten und an jedem Knick die
Kappenrundung. Die Gegenmaßnahme ist das **Verschmelzen (Dissolve/Union) je Klasse vor dem
Rendern**: alle Fahrbahnpolygone einer Klasse zu einer einzigen MultiPolygon-Geometrie vereinigen,
und erst diese Außenkante konturieren. Danach existiert genau eine Kontur — die des Netzes —, nicht
mehr eine Kontur je Segment. PostGIS `ST_Union` ist dafür der Standardweg, `ST_Buffer` mit den
Style-Parametern liefert die Eingangsgeometrie.
(Quelle: PostGIS Special Functions Index / ST_Buffer, https://postgis.net/docs/ST_Buffer.html — abgerufen 07.08.2026)

**(d) Die Reihenfolge, in der gezeichnet wird.** Alle drei Referenzstile zeichnen strikt in dieser
Reihenfolge: **alle Konturen aller Klassen → alle Füllungen aller Klassen**. In Positron liegen die
`*_case`-Layer geschlossen vor den `*_fill`-Layern; in basemap.de liegen alle `Kontur_*`-Layer vor
allen `Decker_*`-Layern. Wer stattdessen je Straße erst Kontur, dann Füllung zeichnet, bekommt an
jeder Kreuzung einen Querstrich.
(Quellen: Positron style.json; `bm_web_col.json` — beide abgerufen 07.08.2026)

---

## 2 Referenzsysteme — die tatsächlichen Farbwerte

Alle Werte in diesem Abschnitt sind wörtlich aus den jeweiligen Stildefinitionen ausgelesen, nicht
aus dem Gedächtnis. L\*-Angaben sind **[berechnet]** (sRGB → CIELAB, D65).

### 2.1 CARTO „Positron" (heller Overlay-Basemap-Stil)

Quelle: https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json — abgerufen 07.08.2026
(Repository: https://github.com/CartoDB/basemap-styles — abgerufen 07.08.2026)

| Objekt | Layer-ID | Farbe | L\* [berechnet] |
|---|---|---|---|
| Hintergrund / Landfläche | `background` | `#fafaf8` | 98,2 |
| Landbedeckung / Park | `landcover`, `park_national_park` | `rgba(234,241,233,0.5)` | 94,4 (deckend) |
| Bauflächen (Wohnen) | `landuse_residential` | `rgba(237,237,237,0.5)` → `0.25` | 93,7 (deckend) |
| Gebäude (Seite) | `building` | `#dfdfdf` | 88,8 |
| Gebäude (Dach/Deckfläche) | `building-top` | `#ededed` | 93,7 |
| Wasser | `water` | `#d4dadc` | 86,7 |
| Fließgewässer | `waterway` | `#d1dbdf` | — |
| Autobahn Füllung / Kontur | `road_mot_fill_noramp` / `road_mot_case_noramp` | `#fff` / `#e6e6e6`→`#ddd` | 100,0 / 91,3→88,1 |
| Bundes-/Hauptstraße | `road_pri_fill_noramp` / `_case_` | `#fff` / `#e6e6e6`→`#ddd` | 100,0 / 91,3→88,1 |
| Nebenstraße | `road_sec_fill_noramp` / `_case_` | `#fff` / `#e6e6e6`→`#ddd` | 100,0 / 91,3→88,1 |
| Anliegerstraße | `road_minor_fill` / `road_minor_case` | `#fdfdfd` / `#e6e6e6`→`#ddd` | 99,3 / 91,3→88,1 |
| Erschließung | `road_service_fill` / `road_service_case` | `#fdfdfd` / `#ddd` | 99,3 / 88,1 |
| Fuß-/Radweg | `road_path` (gestrichelt 2,2→3,3) | `#d5d5d5` | 85,3 |
| Bahn | `rail` | `#dddddd` | 88,1 |
| Verwaltungsgrenze | `boundary_country_inner` | `#f2e6e7`→`#ebd6d8` | — |

**Bemerkenswert:** Die gesamte Basiskarte spannt nur den L\*-Bereich **85,3 bis 100,0**, also
**14,7 L\*-Einheiten** **[berechnet]**. Positron ist ausdrücklich als Untergrund für farbige
Datenlayer gebaut — es lässt 85 der 100 L\*-Einheiten für das Overlay frei. Fußgängerzone, Platz
und Radweg gibt es als eigene Klassen **nicht** (die Datengrundlage OpenMapTiles führt sie nicht
getrennt).

### 2.2 CARTO „Dark Matter" (dunkler Overlay-Basemap-Stil)

Quelle: https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json — abgerufen 07.08.2026

| Objekt | Layer-ID | Farbe | L\* [berechnet] |
|---|---|---|---|
| Hintergrund / Landfläche | `background`, `landcover`, `landuse` | `#0e0e0e` | 4,0 |
| Bauflächen | `landuse_residential` | `rgba(0,0,0,0.5)`→`0.15` | — |
| Gebäude (Deckfläche) | `building-top` | `rgba(57,57,57,1)` = `#393939` | 24,0 |
| Gebäude (Seite) | `building` | transparent | — |
| Wasser | `water` | `#2C353C` | 21,6 |
| Fließgewässer | `waterway` | `rgba(63,90,109,1)` | — |
| Autobahn Füllung / Kontur | `road_mot_fill_noramp` / `_case_` | `rgba(73,73,73,1)` / `#1a1a1a`→`#232323` | 31,0 / — |
| Hauptstraße Füllung | `road_pri_fill_noramp` | `rgba(83,86,102,1)` | 36,8 |
| Nebenstraße Füllung | `road_sec_fill_noramp` | `rgba(65,71,88,1)` | 30,2 |
| Anliegerstraße Füllung / Kontur | `road_minor_fill` / `road_minor_case` | `rgba(65,71,88,1)` / `rgba(65,71,88,1)` | 30,2 |
| Erschließung | `road_service_fill` / `_case` | `#0b0b0b` / `#1c1c1c` | — |
| Fuß-/Radweg | `road_path` | `#262626` | 15,2 |
| Bahn | `rail` / `rail_dash` | `#1a1a1a` / `#111` | — |
| Grenzen | `boundary_state` | `rgba(103,103,114,1)` | — |

**Bemerkenswert:** Auch hier ein enges Band, aber breiter als bei Positron — **L\* 4,0 bis 36,8 =
32,8 Einheiten** **[berechnet]**. Und: Die Straßenfüllungen sind nicht neutral grau, sondern
**leicht kühl** (a\* +1,9 / b\* −10,9 bei `rgba(65,71,88)` **[berechnet]**), während die Autobahn
neutral grau bleibt (`#494949`, a\* 0 / b\* 0 **[berechnet]**). Das ist genau die Technik
„Unterscheidung über Farbtemperatur statt über Buntheit" aus Abschnitt 3.2.

### 2.3 Mapbox Light

Die aktuellen Mapbox-Stile sind nicht offen. Belegbar ist eine archivierte Fassung des
Light-Stils in einer öffentlichen Spiegelung. **Diese Werte deshalb als historisch/indikativ
behandeln, nicht als heutigen Mapbox-Standard.**

Quelle: https://raw.githubusercontent.com/jingsam/mapbox-gl-styles/master/Light.json — abgerufen 07.08.2026
(offizielles, aber ohne `light-v9` bestücktes Repo: https://github.com/mapbox/mapbox-gl-styles — abgerufen 07.08.2026)

| Objekt | Layer-ID | Farbe |
|---|---|---|
| Hintergrund / Landfläche | `background` | `#eee` |
| Park | `landuse_park` | `#e4e4e4` |
| Wald | `landuse_wood` | `#e0e0e0` |
| Wasser | `water` | `#d6d6d6` |
| Gebäude | `building` | `#cbcbcb` |
| Autobahn / Trunk / Hauptstraße | `road-motorway`, `road-trunk`, `road-main` | `#fff` |
| Anliegerstraße | `road-street` (Breiten: z12,5 → 0,3; z14 → 2; z18 → 18) | `#fff` |
| Erschließung / Weg / Bahn | `road-service-driveway`, `road-path`, `road-rail` | `#fff` |

**Bemerkenswert:** In dieser Fassung gibt es **keine** eigenen `-case`-Layer; die gesamte Hierarchie
läuft ausschließlich über Linienbreite und Zeichenreihenfolge auf einem einheitlich grauen
Untergrund. Das ist die minimalistische Variante — und sie ist der Grund, warum Mapbox Light in
Nahansichten schwächer liest als Positron oder basemap.de.

### 2.4 OpenStreetMap Carto

Quellen (alle abgerufen 07.08.2026):
`style/style.mss` https://raw.githubusercontent.com/gravitystorm/openstreetmap-carto/master/style/style.mss ·
`style/landcover.mss` .../style/landcover.mss ·
`style/roads.mss` .../style/roads.mss ·
`road-colors-generated.mss` .../style/road-colors-generated.mss ·
`road-colors.yaml` .../road-colors.yaml

| Objekt | Variable | Füllung | Kontur |
|---|---|---|---|
| Hintergrund / Landfläche | `@land-color` | `#f2efe9` | — |
| Wohnbaufläche | `@residential` | `#e0dfdf` | — |
| Bebauung Fernzoom | `@built-up-lowzoom` / `@built-up-z12` | `#d0d0d0` / `#dddddd` | — |
| Industrie | `@industrial` | `#ebdbe8` | — |
| Gewerbe / Einzelhandel | `@commercial` / `@retail` | `#f2dad9` / `#ffd6d1` | — |
| Grünland | `@grass` | `#cdebb0` | — |
| Park | `@park` | `#c8facc` | — |
| Wald | `@forest` | `#add19e` | — |
| Gebüsch / Heide | `@scrub` / `@heath` | `#c8d7ab` / `#d6d99f` | — |
| Kleingärten | `@allotments` | `#c9e1bf` | — |
| Friedhof | `@cemetery` | `#aacbaf` | — |
| Ackerland / Hofstelle | `@farmland` / `@farmyard` | `#eef0d5` / `#f5dcba` | — |
| Sportfläche | `@pitch` | `#88e0be` | — |
| Sand / Strand / offener Boden | `@sand` / `@beach` / `@bare_ground` | `#f5e9c6` / `#fff1ba` / `#eee5dc` | — |
| Wasser | `@water-color` | `#aad3df` | — |
| Autobahn | motorway | `#e892a2` | `#dc2a67` |
| Trunk / Bundesstraße | trunk | `#f9b29c` | `#c84e2f` |
| Hauptstraße | primary | `#fcd6a4` | `#a06b00` |
| Nebenstraße | secondary | `#f7fabf` | `#707d05` |
| Anliegerstraße | `@residential-fill` / `@residential-casing` | `#ffffff` | `#bbb` |
| Erschließung | `@service-fill` / `@service-casing` | `#ffffff` | `#bbb` |
| Verkehrsberuhigt | `@living-street-*` | `#ededed` | `#bbb` |
| Fußgängerzone | `@pedestrian-*` | `#dddde8` | `#999` |
| Gehweg | `@footway-fill` | `salmon` (CSS = `#fa8072`) | `@default-casing` (weiß) |
| Radweg | `@cycleway-fill` | `blue` (CSS = `#0000ff`) | weiß |
| Reitweg | `@bridleway-fill` | `green` (CSS = `#008000`) | weiß |
| Treppe | `@steps-fill` | wie Gehweg | weiß |
| Feldweg | `@track-fill` | `#996600` | weiß |
| unbestimmte Straße | `@road-fill` / `@road-casing` | `#ddd` / `#bbb` | — |

Die Klassenfarben von motorway…secondary sind nicht handgesetzt, sondern erzeugt aus
`road-colors.yaml`: Farbwinkel `hue: [10, 106]`, Füllung `lightness: [70, 97]` / `chroma: [35, 29]`,
Kontur `lightness: [50, 50]` / `chroma: [70, 55]`.

**Bemerkenswert für unseren Fall:** OSM Carto ist der Stil, der dem Vorwurf „bunte Masse" am
nächsten kommt — Gehweg lachsrot, Radweg reinblau, Reitweg grün. Für eine Nutzungskarte ist das
richtig (jede Wegeart ist sofort benennbar), für ein Planungswerkzeug mit farbigen Planobjekten
obendrauf ist es **untauglich**: Die Basiskarte verbraucht bereits Rot, Blau und Grün.

### 2.5 basemap.de Web Vektor — Farbe (amtlicher deutscher Stil, AdV/BKG)

Quelle: https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json
(Style `bm_web_col`, Version 8, 550 Layer) — abgerufen 07.08.2026.
Produktseite: https://basemap.de/produkte-und-dienste/web-vektor/ — abgerufen 07.08.2026.
Signaturenkatalog (HTML, wird clientseitig nachgeladen, deshalb hier die Werte direkt aus dem Style):
https://basemap.de/data/produkte/web_vektor/meta/bm_web_vektor_col_signaturenkatalog.html — abgerufen 07.08.2026.

| Objekt | Layer-ID | Farbe (rgb) | L\* [berechnet] |
|---|---|---|---|
| Hintergrund / Landfläche | `Hintergrund` | `255,253,238` | 99,1 |
| Ackerland | `VegetationsF_Ackerland_und_Co` | `255,253,238` | 99,1 |
| Siedlungsfläche | `SiedlungF_Siedlung` | `242,236,249` | 94,2 |
| Siedlung/Industrie (Fernzoom) | `SiedlungF_Siedlung_Industrie` | `238,221,255` (z9) → `242,236,249` (z13) | — |
| Industrie / Gewerbe | `SiedlungF_Industrie_und_Gewerbe` | `214,210,219` | — |
| Sport / Freizeit / Erholung | `SiedlungF_SportFreizeitundErholung` | `230,247,210` | — |
| Friedhof | `SiedlungF_Friedhof` | `223,240,182` | — |
| Grünland | `VegetationsF_Gruenland` | `223,240,182` | 92,3 |
| Gartenland | `VegetationsF_Gartenland` | `201,245,216` | — |
| Wald / Gehölz | `VegetationsF_Wald`, `_Gehoelz` | `223,240,182` (z11) → `154,182,109` (z22) | 92,3 → 70,5 |
| Baumreihe (Linie + Füllung) | `VegetationsL_Baumreihe` / `_Fuellung` | `115,141,0` / `223,240,182` | — |
| Hecke | `VegetationsL_Hecke` | `147,217,101` | — |
| Gewässer Fläche | `Gewaesser_F_See_Hafenbecken`, `_Fliessgewaesser`, `_Meer` | `210,232,250` | 90,9 |
| Gewässer Linie | `Gewaesser_L_*` | `170,204,255` | — |
| Gebäude nicht öffentlich | `Gebaeude2D_nicht_oeffentlich` | `168,168,168` | 68,9 |
| Gebäude öffentlich | `Gebaeude2D_oeffentlich` | `232,179,158` | — |
| Tiefgarage | `Gebaeude_Tiefgarage` / `_Kontur` | `153,153,153` / `153,153,153` | 63,2 |
| **Kontur ALLER Straßenklassen** | `Kontur_Autobahn_*`, `Kontur_Bundesstr*`, `Kontur_Landesstr*`, `Kontur_Kreisstr*`, `Kontur_Gemeindestr*` | `153,153,153` | 63,2 |
| Autobahn Füllung | `Decker_Autobahn_getrennt` | `89,143,236` | 59,7 |
| Autobahn-Abfahrt Füllung | `Decker_Autobahn_Abfahrt` | `89,143,236` | 59,7 |
| Bundesstraße Füllung | `Decker_Bundesstr` | `255,203,79` | 84,2 |
| Landes-/Staatsstraße Füllung | `Decker_Landesstr_Staatsstr` | `255,243,105` | — |
| Kreisstraße Füllung | `Decker_Kreisstr` | `255,255,255` | 100,0 |
| Gemeinde-/sonstige Straße Füllung | `Decker_Gemeindestr_Sonstige_Str` | `255,255,255` | 100,0 |
| **Fußgängerzone (Fläche)** | `Verkehrsflaeche_Fussgaengerzone` | `182,223,210` | 85,7 |
| **Fußgängerzone (Achse)** | `Decker_Fussgaengerzone_Gemeindestr_Sonstige_Str` | `182,223,210` | 85,7 |
| **Platz** | `Verkehrsflaeche_Platz`, `IstWeitereNutzung_Flaeche_Platz` | `255,255,255` | 100,0 |
| Fußweg (nur Kontur) | `Kontur_Fusswege` (1 px z14 → 4 px z20) | `153,153,153` | 63,2 |
| Fußweg auf Brücke | `Bruecke_Fusswege_Kontur` / `_Decker` | `153,153,153` / `255,255,255` | 63,2 / 100,0 |
| Wirtschaftsweg | `Kontur_Wirtschaftsweg` | `153,153,153` | 63,2 |
| Hauptwirtschaftsweg | `Kontur_Hauptwirtschaftsweg` / `Decker_Hauptwirtschaftsweg` | `153,153,153` / `230,230,230` | 63,2 / 90,9 |
| Mittellinie Autobahn / sonst | `Mittellinie_Autobahn` / `_ausser_Autobahn` | `255,255,255` / `153,153,153` | — |
| Bahnverkehrsfläche | `Verkehrsflaeche_Bahnverkehr_Schiffsverkehr` | `214,210,219` | — |
| Eisenbahn | `Bahnstrecke_Eisenbahn` | `102,102,102` | 43,2 |
| Gleis | `Bahnstrecke_Gleis` | `153,153,153` | 63,2 |
| S-Bahn / U-Bahn / Stadtbahn | `Bahnstrecke_S_Bahn` / `_U_Bahn` / `_Stadtbahn` | `51,153,51` / `0,0,255` / `241,82,82` | — |
| **Radweg** | — | **nicht als eigene Klasse geführt** | — |

**Bemerkenswert:** Ein einziger Konturton `rgb(153,153,153)` für das komplette Straßennetz —
Klassifikation ausschließlich über Deckerfarbe und Breite. Und: Fußgängerzone hat als einzige
Verkehrsklasse einen eigenen Farbstich, Platz ist reinweiß wie die Fahrbahn (der Unterschied
entsteht allein durch die Geometrie und die Kontur).

### 2.6 basemap.de Web Vektor — Grau (der Schlüsselfall für „keine bunte Masse")

Quelle: https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json (Style `bm_web_gry`) — abgerufen 07.08.2026.
Signaturenkatalog: https://basemap.de/data/produkte/web_vektor/meta/bm_web_vektor_gry_signaturenkatalog.html — abgerufen 07.08.2026.

Dies ist **derselbe Datenbestand, dieselbe Geometrie, dieselben Linienbreiten** wie in 2.5 — nur die
Farben sind ersetzt. Damit ist es der direkte Beleg dafür, dass eine vollständig lesbare Stadtkarte
ohne jede Buntheit möglich ist:

| Objekt | Farbe (rgb) | L\* [berechnet] | ΔL\* zur nächsten Stufe |
|---|---|---|---|
| Fahrbahn Kreis-/Gemeindestr. (`Decker_*`) | `255,255,255` | 100,0 | — |
| Hintergrund / Platz | `255,255,255` | 100,0 | 0,0 |
| Grünland | `242,242,242` | 95,5 | 4,5 |
| Fußgängerzone, Hauptwirtschaftsweg-Decker | `238,238,238` | 94,1 | 1,4 |
| Siedlung, Industrie/Gewerbe, Autobahn-Decker | `229,229,229` | 90,9 | 3,2 |
| Wald (z22) | `224,224,224` | 89,2 | 1,7 |
| Bundesstraße-Decker | `216,216,216` | 86,3 | 2,9 |
| Wasser | `204,204,204` | 82,0 | 4,3 |
| Gebäude nicht öffentlich | `178,178,178` | 72,6 | 9,4 |
| **Kontur aller Straßen**, Gebäude öffentlich | `102,102,102` | 43,2 | 29,4 |
| Eisenbahn, Gewächshaus-Kontur | `51,51,51` | 21,2 | 22,0 |

**Das ist die wichtigste Tabelle des ganzen Dokuments.** Drei Dinge sind daran abzulesen:

1. **Die Flächen liegen alle in einem sehr engen Band: L\* 82–100, also 18 Einheiten** **[berechnet]**.
   Innerhalb dieses Bandes reichen Abstände von **1,4 bis 4,5 L\*** aus, um Grün von Siedlung von
   Wald von Wasser zu unterscheiden — weil die Flächen groß sind und aneinandergrenzen.
2. **Die Linien brechen aus dem Band aus:** die Straßenkontur springt auf L\* 43,2, die Bahn auf
   21,2. Der Abstand zwischen Fahrbahn (100,0) und ihrer Kontur (43,2) beträgt **56,8 L\***
   **[berechnet]** — mehr als die Hälfte der gesamten Skala. Genau dieser Sprung macht das
   Straßennetz auf einen Blick sichtbar. Schmale Objekte brauchen große Kontraste, große Flächen
   kleine.
3. **Die Fahrbahn ist das hellste Objekt der Karte und trägt zugleich die dunkelste Kontur.** Das
   ist die eigentliche Antwort auf „die Straßen sind nicht zu erkennen".

### 2.7 Google Maps

**Google publiziert die Standardfarben seiner Karte nicht als Tabelle.** Die Style-Referenz
dokumentiert nur die Feature-Typen (`road.highway`, `landscape.man_made`, `poi.park` …) und
Element-Typen (`geometry`, `geometry.fill`, `geometry.stroke`), nicht die Defaultwerte.
(Quelle: Google Maps Platform, Style Reference for Maps JavaScript API,
https://developers.google.com/maps/documentation/javascript/style-reference — abgerufen 07.08.2026)

Belegbar sind aber (a) die **Struktur** und (b) die **offiziellen Beispielstile** mit echten Werten.

**(a) Struktur — Google trennt ausdrücklich Füllung und Kontur.** Die Elementtypen `geometry.fill`
und `geometry.stroke` existieren für jeden Feature-Typ. `geometry.stroke` **ist** das Casing.
(Quelle wie oben — abgerufen 07.08.2026)

**(b) Offizieller Beispielstil „Night mode"** aus der Google-Dokumentation
(Quelle: https://developers.google.com/maps/documentation/javascript/examples/style-array — abgerufen 07.08.2026):

| Feature | Element | Farbe |
|---|---|---|
| (global) | `geometry` | `#242f3e` |
| `poi.park` | `geometry` | `#263c3f` |
| `road` | `geometry` (Füllung) | `#38414e` |
| `road` | `geometry.stroke` (**Kontur**) | `#212a37` |
| `road.highway` | `geometry` (Füllung) | `#746855` |
| `road.highway` | `geometry.stroke` (**Kontur**) | `#1f2835` |
| `transit` | `geometry` | `#2f3948` |
| `water` | `geometry` | `#17263c` |
| `road` | `labels.text.fill` | `#9ca5b3` |
| `road.highway` | `labels.text.fill` | `#f3d19c` |

**Bemerkenswert:** Die normale Straße ist **kühl** (`#38414e`, blaustichig), die Autobahn ist
**warm** (`#746855`, braunstichig) — bei nahezu gleicher Sättigung. Die Klassenunterscheidung läuft
über **Farbtemperatur**, nicht über Buntheit. Und: die Kontur ist hier *dunkler* als die Füllung
(dunkler Grund), bei Positron/basemap.de ist sie *dunkler* als eine helle Füllung — in beiden Fällen
gilt: **die Kontur ist immer die dunklere der beiden Linien**, unabhängig vom Grundton.

**(c) Was Google zur Geometriegenauigkeit sagt** — direkt einschlägig für den Wunsch „aus echten
Maßen gebaute Welt": „soon, you'll be able to see highly detailed street information that shows the
accurate shape and width of a road to scale. You can also see exactly where sidewalks, crosswalks,
and pedestrian islands are located."
(Quelle: Google, „A more detailed, colorful map", 18.08.2020,
https://blog.google/products-and-platforms/products/maps/more-detailed-colorful-map/ — abgerufen 07.08.2026)

Zur Farbgebung der Naturflächen beschreibt derselbe Beitrag ein datengetriebenes Verfahren:
„First, we use computer vision to identify natural features from our satellite imagery, looking
specifically at arid, icy, forested, and mountainous regions. We then analyze these features and
assign them a range of colors on the HSV color model." — „a densely covered forest can be classified
as dark green, while an area of patchy shrubs could appear as a lighter shade of green."
(Quelle wie oben — abgerufen 07.08.2026)

→ Übersetzt auf EventPlan3D: Google löst „Grünflächen wirken random" **nicht** über zusätzliche
Farbtöne, sondern über eine **Helligkeitsabstufung innerhalb eines Farbtons**, gesteuert durch eine
gemessene Eigenschaft (Bestandsdichte). Genau das lässt sich mit ALKIS-Nutzungsarten und
OSM-`landuse`-Tags nachbauen.

### 2.8 3D-Stadtmodelle

Für 3D-Stadtmodelle gibt es **keine publizierte Farbtabelle** vergleichbar mit den 2D-Stilen. Was
belegbar ist, sind die Darstellungs-*Mechanismen*:

- Der **3DCityDB-Web-Map-Client** (Cesium-basiert, der De-facto-Standard für CityGML-Modelle,
  maßgeblich von virtualcitySYSTEMS mitentwickelt) arbeitet mit „pre-styled 3D visualization models
  in the form of tiled KML/glTF datasets", einem Plugin zur Definition „constant material
  information for building surfaces based on thematic properties (e.g., to colorize roofs according
  to their solar potential)" und mit „on-the-fly activating and deactivating shadow visualization of
  3D objects".
  (Quellen: https://github.com/3dcitydb/3dcitydb-web-map und
  https://3dcitydb-docs.readthedocs.io/en/latest/webmap/ — beide abgerufen 07.08.2026)
  → Zwei Dinge daraus: **Dach und Wand sind getrennt adressierbare Materialien** (die Semantik
  RoofSurface/WallSurface aus CityGML macht das möglich), und **Schatten ist eine schaltbare Ebene**,
  kein fester Bestandteil.
- Die **Level-of-Detail-Definition** erklärt, warum LoD2 überhaupt Chancen auf ein nicht-klotziges
  Bild hat: „LoD1: Klötzchen- bzw. Blockmodell", LoD2 dagegen mit Dachform — „Standardisierte
  Dachformen werden zugeordnet und entsprechend dem tatsächlichen Firstverlauf ausgerichtet."
  (Quelle: LGL Baden-Württemberg, 3D-Gebäudemodell LoD2,
  https://www.lgl-bw.de/Produkte/3D-Produkte/3D-Gebaeudemodelle/LoD2/ — abgerufen 07.08.2026)
- **CesiumJS** stellt die nötigen Bildeffekte als Post-Process-Stages bereit: Ambient Occlusion,
  Silhouette/Edge Detection, Bloom, Depth of Field. Die AO-Uniforms sind `intensity`, `bias`,
  `lengthCap`, `stepSize`, `frustumLength`, `ambientOcclusionOnly`, `delta`, `sigma`, `blurStepSize`;
  „Intensity is a scalar value used to lighten or darken the shadows exponentially, with higher
  values making the shadows darker."
  (Quelle: Cesium, PostProcessStageLibrary,
  https://cesium.com/learn/cesiumjs/ref-doc/PostProcessStageCollection.html und
  https://cesium.com/learn/ion-sdk/ref-doc/PostProcessStageLibrary.html — abgerufen 07.08.2026)

### 2.9 Quervergleich der Grundtöne

| System | Grundton | L\* [berechnet] | Charakter |
|---|---|---|---|
| CARTO Positron | `#fafaf8` | 98,2 | neutral, minimal warm |
| CARTO Dark Matter | `#0e0e0e` | 4,0 | neutral schwarz |
| Mapbox Light (Spiegelung) | `#eee` | 94,1 | neutral |
| OpenStreetMap Carto | `#f2efe9` | 94,5 | warm-beige |
| basemap.de Farbe | `rgb(255,253,238)` | 99,1 | warm (b\* +7,4) |
| basemap.de Grau | `rgb(255,255,255)` | 100,0 | reinweiß |
| Google „Night mode" | `#242f3e` | 19,0 | kühl-dunkelblau |

---

## 3 Farblehre für genau diesen Fall

### 3.1 Warum eine reine Graustufenleiter flach wirkt — und zu viele Farbtöne „random"

**Der Kern: Helligkeit und Farbton leisten nicht dasselbe.** Die kartografische Standardlehre
trennt strikt:

- **Helligkeit (Lightness/Value) ordnet.** „sequential data classes are logically arranged from
  high to low, and this stepped sequence of categories should be represented by sequential lightness
  steps"; „low data values are usually represented by light colors and high values represented by
  dark colors". Für geordnete Daten gilt: „the light-to-dark progression should dominate the scheme".
  (Quelle: Cynthia A. Brewer, „Color Use Guidelines for Mapping and Visualization",
  https://web.natur.cuni.cz/~langhamr/lectures/vtfg1/mapinfo_2/barvy/colors.html — abgerufen 07.08.2026)
- **Farbton (Hue) unterscheidet, ordnet aber nicht.** „Qualitative schemes use differences in hue to
  represent nominal differences, or differences in kind." (Quelle wie oben — abgerufen 07.08.2026)
- Das übergeordnete Prinzip: „the perceptual structure of the color scheme should match the
  perceptual structure of the data."
  (Quelle: Penn State GEOG 486, „Types of Color Schemes",
  https://courses.ems.psu.edu/geog486/node/878 — abgerufen 07.08.2026)

**Daraus folgt die Diagnose beider Fehler:**

- **Reine Graustufen = flach.** Straßenverkehr, Gehweg, Grünfläche, Bauflächen sind *nominale*,
  nicht geordnete Kategorien. Wenn man sie ausschließlich über Helligkeit codiert, behauptet die
  Karte eine Rangfolge, die es nicht gibt — und der Betrachter sucht vergeblich nach ihr. Das Bild
  wirkt monoton, weil die einzige verfügbare Dimension überstrapaziert ist. Es fehlt die selektive
  Dimension (Farbton), die sagt „das hier ist eine *andere Art* von Fläche".
- **Zu viele Farbtöne = random.** Die Wahrnehmungsgrenze ist bezifferbar: „the (color vision
  unimpaired) human eye can discriminate between about twelve different hues in the same image";
  bei Überschreitung gilt die Empfehlung, Kategorien „into hue classes" zu gruppieren und dann
  „lightness and saturation to create intra-class differences" einzusetzen.
  (Quelle: Penn State GEOG 486, https://courses.ems.psu.edu/geog486/node/878 — abgerufen 07.08.2026)
  Zusätzlich gilt als praktische Kartografenregel: „cartographers seldom use more than seven classes
  on a choropleth map".
  (Quelle: Penn State GEOG 486, „Making Choropleth Maps",
  https://www.e-education.psu.edu/geog486/node/881 — abgerufen 07.08.2026)
  Der aktuelle EventPlan3D-Stand hat neun OSM-Klassen plus sechs ALKIS-Klassen — ohne Gruppierung
  landet man zwangsläufig jenseits dieser Grenze, und dann liest das Auge keine Ordnung mehr,
  sondern Rauschen.

**Die Auflösung ist die Zwei-Ebenen-Regel:** wenige Farbton-*Familien* (Gruppen), innerhalb jeder
Familie Abstufung über Helligkeit. Genau so ist basemap.de Farbe gebaut (siehe 2.5): Verkehr =
neutral/weiß mit einheitlicher grauer Kontur, Vegetation = eine Grünfamilie mit Helligkeitsrampe
von `rgb(223,240,182)` bis `rgb(154,182,109)`, Siedlung = eine blassviolette Familie, Wasser = eine
blaue Familie. **Vier Familien, nicht fünfzehn Farben.**

### 3.2 Unterscheidbarkeit über Helligkeit + leichte Farbtemperatur statt über Buntheit

**Die Technik.** Statt zwei Klassen unterschiedlich *bunt* zu machen, gibt man ihnen (a) einen
Helligkeitsabstand und (b) einen minimalen, gegenläufigen Stich auf der a\*/b\*-Achse — kühl gegen
warm. Der Effekt ist, dass die Flächen sich sauber trennen, ohne dass eine von ihnen als „farbig"
auffällt. Belege in den Referenzsystemen:

- Google „Night mode": `road` = `#38414e` (kühl) gegen `road.highway` = `#746855` (warm), beide bei
  moderater Sättigung. (Quelle: 2.7 — abgerufen 07.08.2026)
- Dark Matter: Neben-/Anliegerstraße `rgba(65,71,88)` mit a\* +1,9 / b\* **−10,9** (kühl) gegen
  Autobahn `#494949` mit a\* 0 / b\* 0 (neutral) **[berechnet]**. (Rohwerte: 2.2 — abgerufen 07.08.2026)
- Positron: Hintergrund `#fafaf8` mit b\* **+1,0** (Hauch warm) gegen Wasser `#d4dadc` mit a\* −1,7 /
  b\* **−1,7** (Hauch kühl) **[berechnet]**. Ein b\*-Unterschied von 2,7 Einheiten genügt bereits,
  damit Wasser nicht als „grauer Fleck" gelesen wird. (Rohwerte: 2.1 — abgerufen 07.08.2026)

**Wie viele Helligkeitsstufen sind unterscheidbar? — zwei verschiedene Zahlen, die man nicht
verwechseln darf:**

| Frage | Zahl | Gilt für | Quelle |
|---|---|---|---|
| Ab wann sieht man überhaupt einen Unterschied? | **ΔL\* ≈ 0,4** (JND); ab **ΔL\* ≥ 0,8** „just objectionable" | zwei direkt aneinandergrenzende, große, gleichmäßige Farbfelder unter Idealbedingungen | Konica Minolta, „What Is Delta E?", https://sensing.konicaminolta.eu/mi-en/colourblogtop/colour-blog/whatisdeltae — abgerufen 07.08.2026 |
| Wie viele Klassen kann ein Kartenleser zuverlässig *zuordnen*? | **höchstens ~7** | Flächenklassen in einer Karte, die über eine Legende gelesen werden | Penn State GEOG 486, https://www.e-education.psu.edu/geog486/node/881 — abgerufen 07.08.2026 |
| Wie viele Farbtöne sind gleichzeitig unterscheidbar? | **~12** | nominale Kategorien im selben Bild | Penn State GEOG 486, https://courses.ems.psu.edu/geog486/node/878 — abgerufen 07.08.2026 |

Die 0,4-Einheiten-Grenze ist eine Laborschwelle für Sehen-ob-anders, **nicht** für
Wiedererkennen-was-es-ist. Für eine Karte ist die zweite Zahl maßgeblich. Aus den tatsächlich
verwendeten Werten von basemap.de Grau lässt sich die praktische Regel ableiten **[berechnet aus
den Werten in 2.6]**:

- **Große, aneinandergrenzende Flächen:** ΔL\* **1,4 bis 4,5** genügt (Grünland → Fußgängerzone
  → Siedlung → Wald → Wasser).
- **Flächen, die nicht aneinandergrenzen und getrennt erkannt werden müssen:** ΔL\* **≥ 9**
  (Wasser 82,0 → Gebäude 72,6).
- **Schmale Linienobjekte gegen ihren Untergrund:** ΔL\* **≥ 25–30** (Kontur 43,2 gegen alle
  Flächen ab 82,0 → ΔL\* ≥ 38,8; Bahn 21,2 gegen Kontur 43,2 → ΔL\* 22,0).
- **Zwischen Füllung und ihrer eigenen Kontur:** ΔL\* **≥ 50** (Fahrbahn 100,0 gegen Kontur 43,2 →
  ΔL\* 56,8).

**Als Arbeitsregel für EventPlan3D:** Flächen im Abstand von **2–5 L\***, Objektgrenzen im Abstand
von **≥ 10 L\***, Konturen im Abstand von **≥ 30 L\*** zur zugehörigen Füllung. Für jede Zuordnung
höchstens **7 Flächenklassen** pro Ansicht sichtbar halten — der Rest wird zusammengefasst oder erst
beim Hineinzoomen aufgeschlüsselt.

### 3.3 Die Rolle des Untergrunds: hell oder dunkel für ein Planungswerkzeug?

**Das entscheidende Prinzip ist Figur-Grund.** Figure-ground ist „the spontaneous separation of the
primary area of interest in the foreground (the figure) from an amorphous background". Für
Basiskarten gilt: „Low visual contrast works best for basemaps so that the overlaid thematic layers
are more visually prominent", erreicht „through desaturation and muted colors"; „Some features (the
more colorful, contrasting, and detailed ones) will appear to be in the foreground of the map, while
other features (the pale, desaturated, and plain ones) will appear to be in the background."
(Quellen: Esri, „Primary Design Principles for Cartography",
https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/primary-design-principles-for-cartography
und Wikipedia, „Figure-ground (cartography)",
https://en.wikipedia.org/wiki/Figure-ground_(cartography) — beide abgerufen 07.08.2026)

**Die messbare Konsequenz: nicht „hell oder dunkel" ist die Frage, sondern wie breit das
Helligkeitsband der Basiskarte ist.** Aus 2.1 und 2.2 **[berechnet]**:

| Basiskarte | belegtes L\*-Band | Breite | freier L\*-Bereich für Planobjekte |
|---|---|---|---|
| CARTO Positron (hell) | 85,3 – 100,0 | **14,7** | 85,3 Einheiten (alles darunter) |
| basemap.de Grau (Flächen) | 82,0 – 100,0 | **18,0** | 82,0 Einheiten (alles darunter) |
| CARTO Dark Matter (dunkel) | 4,0 – 36,8 | **32,8** | 63,2 Einheiten (alles darüber) |

**Empfehlung für EventPlan3D: heller, sehr leicht warmer Grund mit engem Band.** Begründung:

1. Der freie Helligkeitsbereich ist bei einer hellen Basis mit engem Band am größten (85 gegen 63
   Einheiten **[berechnet]**). Zelte, Fahrgeschäfte, Rettungswege und Sperrungen können dann
   **gleichzeitig dunkler und bunter** sein als alles darunter — sie haben eine ganze
   Wahrnehmungsdimension für sich allein.
2. Signalfarben funktionieren im dunklen Bereich stabiler als im hellen. Ein Rettungsweg in kräftigem
   Rot/Magenta (L\* ≈ 45–55, Chroma > 50) hebt sich auf einem Grund bei L\* 90 mit ΔL\* ≈ 40 ab —
   auf einem Dark-Matter-Grund (L\* 4–37) müsste dieselbe Farbe *aufgehellt* werden und verlöre
   dabei Sättigung.
3. Alle amtlichen und alle Overlay-orientierten Referenzen (Positron, basemap.de Grau, basemap.de
   Farbe, OSM Carto, Mapbox Light) verwenden helle Grundtöne zwischen L\* 94,1 und 100,0
   **[berechnet, Rohwerte in 2.9]**. Nur die reinen „Darstellungs"-Stile (Dark Matter, Google Night
   mode) gehen dunkel.
4. Ein leicht warmer Grund (b\* +3 bis +7, wie OSM Carto `#f2efe9` und basemap.de `rgb(255,253,238)`)
   lässt kühle Verkehrs- und Wassertöne ohne Buntheit hervortreten — Farbtemperaturkontrast statt
   Sättigungskontrast.

**Wenn dennoch eine dunkle Fassung verlangt wird** (Abend-/Nachtszenarien beim Heinerfest sind ein
realistischer Anwendungsfall): dann nach dem Dark-Matter-Muster **das Band eng halten (L\* 4–30)**,
Straßen kühl-blaugrau (b\* ≈ −10) und Planobjekte ausschließlich oberhalb L\* 55 ansiedeln. Beide
Fassungen aus **einer** Palettendefinition erzeugen, nicht getrennt pflegen.

---

## 4 3D-spezifisch

### 4.1 Wie man verhindert, dass das Modell „wie ein Haufen weißer Klötze" aussieht

Fünf Mittel, jedes mit Beleg:

**(1) Dach und Wand als getrennte Materialien.** Das ist der einzige Punkt, an dem die Datenlage
von EventPlan3D bereits alles hergibt: LoD2 liefert echte Dach- und Wandflächen (Sattel/Walm/Pult/
Zelt). CityGML/3DCityDB behandeln Dach- und Wandflächen als semantisch getrennte, einzeln
einfärbbare Objekte („constant material information for building surfaces based on thematic
properties … to colorize roofs"). Erst dadurch wird aus dem Volumen eine Dachlandschaft.
(Quelle: 3DCityDB-Web-Map-Client, https://3dcitydb-docs.readthedocs.io/en/latest/webmap/ — abgerufen 07.08.2026)
LoD1 ist definitionsgemäß das „Klötzchen- bzw. Blockmodell", LoD2 hat „standardisierte Dachformen …
entsprechend dem tatsächlichen Firstverlauf ausgerichtet".
(Quelle: LGL BW, https://www.lgl-bw.de/Produkte/3D-Produkte/3D-Gebaeudemodelle/LoD2/ — abgerufen 07.08.2026)

**Welche Richtung?** Die Referenzsysteme sind hier uneins, und das ist erklärbar:
Positron macht die Deckfläche **heller** als die Seite (`building-top` `#ededed` = L\* 93,7 gegen
`building` `#dfdfdf` = L\* 88,8, Δ 4,9 **[berechnet]**), ebenso Dark Matter (`building-top`
`#393939` = L\* 24,0, Seiten transparent) — beides sind **2,5D-Extrusionen ohne Sonne**, dort muss
das Material die Beleuchtung ersetzen. **EventPlan3D hat eine echte Richtungsbeleuchtung**, die den
Dach-/Wand-Kontrast bereits erzeugt. Deshalb sollte das *Material* dort **gegenläufig** wirken:
Dachmaterial etwas dunkler und wärmer als das Wandmaterial (Vorschlag in Abschnitt 5), sonst
brennen die besonnten Dachflächen aus und das Modell wird wieder weiß.

**(2) Kantenbetonung.** Cesium bietet Silhouette- und Edge-Detection-Stages an.
(Quelle: Cesium PostProcessStageLibrary,
https://cesium.com/learn/ion-sdk/ref-doc/PostProcessStageLibrary.html — abgerufen 07.08.2026)
Das ist die 3D-Entsprechung des Casings aus Abschnitt 1: eine dunkle Linie an jeder Silhouette
trennt Baukörper voneinander, auch wenn beide dieselbe Wandfarbe haben.

**(3) Umgebungsverdeckung (Ambient Occlusion).** AO ist „a shading and rendering technique used to
calculate how exposed each point in a scene is to ambient lighting"; es ist „a very crude
approximation to full global illumination", und „the appearance achieved by ambient occlusion alone
is similar to the way an object might appear on an overcast day".
(Quelle: Wikipedia, „Ambient occlusion", https://en.wikipedia.org/wiki/Ambient_occlusion — abgerufen 07.08.2026)
Der perzeptive Nutzen ist experimentell belegt: Langer & Bülthoff, „Depth discrimination from
shading under diffuse lighting", *Perception* 29(6), 2000, S. 649–660, zeigen, dass die
Tiefenunterscheidung unter diffusem Himmelslicht besser ist, als ein reines Direktlichtmodell
vorhersagt. (Quelle: zitiert in Wikipedia, „Ambient occlusion" — abgerufen 07.08.2026)
→ **AO ist die wirksamste Einzelmaßnahme gegen den Klotz-Eindruck**, weil sie genau dort abdunkelt,
wo Gebäude auf Boden trifft und wo Fassaden in Innenhöfen aufeinandertreffen — also genau an den
Kanten, die sonst fehlen. In CesiumJS: `PostProcessStageLibrary.createAmbientOcclusionStage()`,
steuerbar über `intensity`, `bias`, `lengthCap`, `stepSize`, `blurStepSize`.
(Quelle: Cesium, https://cesium.com/learn/cesiumjs/ref-doc/PostProcessStageCollection.html — abgerufen 07.08.2026)

**(4) Schlagschatten.** Der 3DCityDB-Web-Map-Client führt „on-the-fly activating and deactivating
shadow visualization of 3D objects" als eigenständige Funktion.
(Quelle: https://github.com/3dcitydb/3dcitydb-web-map — abgerufen 07.08.2026)
Für ein Veranstaltungsplanungswerkzeug ist der Schatten doppelt wertvoll: er erzeugt Tiefe **und**
er ist eine Planungsinformation (Verschattung von Standflächen, Sonneneinstrahlung auf
Publikumsbereiche).

**(5) Himmelslicht statt Umgebungskonstante.** Ein konstanter Ambient-Term hebt alle Flächen
gleichmäßig an und ist damit die Hauptursache für „flach". Ein Himmelsgradient (oben heller als
unten) sorgt dafür, dass horizontale Flächen (Dächer, Straße) heller sind als vertikale (Fassaden) —
auch im Schatten. Das ist die physikalische Grundlage dessen, was AO annähert („similar to the way
an object might appear on an overcast day", Quelle wie (3)).

### 4.2 Übliche Lichtführung bei Architekturmodellen

- **Grundschema ist Dreipunktlicht aus der Fotografie**: Führungslicht (key), Aufhelllicht (fill),
  Kantenlicht (rim), „to define form and depth".
  (Quelle: Rendimension, „How to prepare your project for stunning visualization results",
  https://rendimension.com/prepare-project-stunning-visualization/ — abgerufen 07.08.2026)
- **Sonnenstand**: In der Architekturvisualisierung ist eine Sonne von **oben links bei ca. 45°
  Höhe** die verbreitete Ausgangseinstellung (typische Sonnenlampen-Einstellung Rotation X 45°,
  Z 135°).
  (Quelle: Apatero, „Best Architecture Visualization Prompts",
  https://apatero.com/blog/best-prompts-architecture-visualization-renderings-2025 — abgerufen 07.08.2026)
- **Verhältnis Führungs- zu Aufhelllicht**: Lichtverhältnisse werden als key:fill angegeben —
  „a key light of 200 footcandles and fill light of 100 footcandles have a 3:1 ratio, while a key
  light of 800 footcandles and fill light of 200 footcandles has a 5:1 ratio".
  (Quelle: Wikipedia, „Lighting ratio", https://en.wikipedia.org/wiki/Lighting_ratio — abgerufen 07.08.2026)
  Für Architektur-/Planungsdarstellung ist ein **weiches Verhältnis von etwa 2:1 bis 3:1** üblich:
  „one soft key light and a gentle fill keep architectural reveals, frames, and relief legible".
  (Quelle: ArchiVinci, „Elevation Rendering: A Guide for Modern Architects",
  https://www.archivinci.com/blogs/elevation-rendering — abgerufen 07.08.2026)
  Ein härteres Verhältnis (5:1 und mehr) lässt Schattenseiten zulaufen — in einer Planungskarte
  verschwindet dann die Hälfte der Fassaden.
- **AO-Stärke**: für Architektur-Massenmodelle ist eine Umgebungsverdeckung mit „a distance of 0.5m
  and factor of 1.0" als Ausgangswert dokumentiert.
  (Quelle: Apatero, wie oben — abgerufen 07.08.2026)

> **Hinweis zur Quellenqualität:** Die Angaben in 4.2 stammen aus Praxisliteratur, nicht aus
> begutachteten Studien (anders als Langer & Bülthoff in 4.1). Sie sind als übliche Werkspraxis zu
> lesen, nicht als Norm.

---

## 5 Was das für EventPlan3D heißt — konkrete Empfehlungen

Die vier genannten Schwächen lassen sich eins zu eins auf die Befunde abbilden.

### 5.1 Sofortmaßnahme 1 — Konturen einführen (behebt „die Straßen sind nicht zu erkennen")

Jede Verkehrsfläche bekommt eine Kontur. Umsetzung im Dreiecksnetz: die Union-Geometrie je Klasse
(siehe 5.3) wird zweimal gezeichnet — einmal um **1 px je Seite** aufgeweitet in der Konturfarbe,
darüber die Füllung. Reihenfolge strikt **erst alle Konturen aller Klassen, dann alle Füllungen**
(siehe 1.4 d).

- Saumbreite **0,8–1,0 px je Seite, bildschirmfest** (Beleg: 1.1 — drei unabhängige Systeme stimmen
  überein). Nicht in Metern, nicht mitskalierend.
- Konturfarbe **einheitlich für das ganze Straßennetz** (Modell basemap.de: ein Ton `rgb(153,153,153)`
  für alle Klassen). Nur zwei Konturstufen: **Hauptkontur** für Fahrbahnen/Plätze, **Nebenkontur**
  eine Stufe heller für Gehwege/Radwege/Grünflächen.
- Helligkeitsabstand Füllung ↔ Kontur **≥ 30 L\***, für die Fahrbahn eher **≥ 40 L\*** (Beleg: 3.2).

### 5.2 Sofortmaßnahme 2 — die Doppelbelegung ALKIS × OSM auflösen

Das ist der Hauptfehler im aktuellen Stand: derselbe Straßenraum wird zweimal als „fahrbahn"
eingefärbt. Die Lösung liegt in der Datenbedeutung selbst und hat in basemap.de ein exaktes Vorbild
(dort: `Verkehrsflaeche_*` als **Fläche** plus `Kontur_*`/`Decker_*` als **Linie**, beides
gleichzeitig, aber mit verschiedener Rolle):

| Datenquelle | Bedeutung | Rolle in der Darstellung |
|---|---|---|
| ALKIS „Straßenverkehr" (113 Flächen) | der **gesamte Straßenraum** inkl. Gehweg, Parkstreifen, Bankett | **Platte**: ein einziger, ruhiger Flächenton — die Bühne, auf der alles andere liegt. Keine eigene starke Kontur, nur eine schwache Grenze gegen Bauflächen. |
| OSM „fahrbahn" (640 Flächen, gepufferte Achse) | die **befahrbare Fahrbahn** | **Decker**: heller Streifen mit Hauptkontur, liegt auf der Platte. |
| OSM „gehweg" (736) | Gehweg | **Decker** eine Helligkeitsstufe dunkler, Nebenkontur. |
| OSM „radweg" (41) | Radweg | **Decker** wie Gehweg, aber mit kühlem Stich (b\* ≈ −6). |
| ALKIS „Fußgängerzone" (7) + OSM „fussgaengerzone" (155) | dasselbe Objekt aus zwei Quellen | **eine** Klasse, eigener schwacher Grünstich (Vorbild basemap.de `rgb(182,223,210)`), Fläche und Achse **farbidentisch** (siehe 1.3). |
| ALKIS „Platz" (22) | Platz | **Decker** hellster Ton, wie Fahrbahn, aber ohne Mittellinie. |
| ALKIS „Weg" (16) + OSM „weg" (30) | Weg | eine Klasse, Decker dunkler als Gehweg. |

**Regel:** Kein Objekt bekommt in zwei Ebenen dieselbe Farbe. Wo ALKIS und OSM dasselbe meinen
(Fußgängerzone, Weg), wird **eine** Klasse gebildet — die ALKIS-Geometrie ist die Fläche, die
OSM-Geometrie liefert die Achse für Mittellinien/Beschriftung, nicht eine zweite Füllung.

### 5.3 Sofortmaßnahme 3 — das Puffer-Netz sanieren (behebt „die Wege sehen nicht nach Wegen aus")

Reihenfolge der Verarbeitung:

1. **Puffern mit `endcap=flat join=mitre mitre_limit=2.0`** statt der Defaults (Beleg: 1.4 a).
2. **Union je Klasse** — alle Fahrbahnpolygone zu einer Geometrie, alle Gehwegpolygone zu einer
   Geometrie usw. Erst danach existiert ein *Netz* statt 640 Einzelplatten (Beleg: 1.4 c).
3. **Vereinfachen mit sehr kleiner Toleranz** (Größenordnung 0,10–0,25 m, unterhalb der
   Erfassungsgenauigkeit der Breiten), um Mikrozacken aus dem Union zu entfernen — die echten Maße
   bleiben dabei erhalten, was der Forderung „aus echten Maßen gebaut" nicht widerspricht.
4. **Erst dann triangulieren und rendern.**
5. **Beim Rendern `line-join: miter` / `line-cap: butt`** für alle Kontur- und Deckerlinien
   (Beleg: 1.4 b).

**Zur Breitenqualität:** Die Aufgabenbeschreibung nennt Breiten „teils gemessen, teils aus
Fahrstreifen, teils Klassenannahme". Das ist ein Genauigkeitsgefälle, das der Auftraggeber merken
wird. Empfehlung: eine Herkunftsstufe je Objekt mitführen (gemessen / abgeleitet / angenommen) und
sie im UI abrufbar machen — das ist die ehrliche Version von „aus echten Maßen gebaut" und deckt
sich mit Googles Anspruch „the accurate shape and width of a road to scale" (Beleg: 2.7 c).

### 5.4 Palettenvorschlag (behebt „Grünflächen random" und „keine bunte Masse")

Die folgende Palette ist **aus den Befunden der Abschnitte 2 und 3 konstruiert**, nicht aus einem
Referenzsystem kopiert: heller warmer Grund (Vorbild basemap.de/OSM Carto), Hierarchie über
Helligkeit + Konturen (Vorbild basemap.de Grau), nur **vier Farbtonfamilien** — neutral-warm
(Bebauung), kühl-neutral (Verkehr), gedämpftes Grün (Vegetation), kühles Blau (Wasser). Alle Werte
sind in CIELAB definiert und nach sRGB umgerechnet **[berechnet]**, damit die Helligkeitsabstände
belastbar sind statt nur „nach Augenmaß":

| Rolle | L\* | a\* | b\* | sRGB | Hex |
|---|---|---|---|---|---|
| Fahrbahn (Decker) | 97 | 0 | −1 | 245,246,248 | `#f5f6f8` |
| Platz / Fußgängerzone (Decker) | 94 | −2 | +1 | 235,239,236 | `#ebefec` |
| Grundton / Bauflächen | 92 | +0,5 | +2,5 | 235,232,227 | `#ebe8e3` |
| Gehweg (Decker) | 90 | 0 | −1,5 | 225,226,229 | `#e1e2e5` |
| ALKIS-Straßenraum (Platte) | 88 | −0,5 | −1,5 | 218,221,223 | `#dadddf` |
| Grünfläche | 87 | −9 | +10 | 208,222,199 | `#d0dec7` |
| Radweg (Decker) | 86 | −1 | −6 | 207,216,226 | `#cfd8e2` |
| Wasser | 82 | −5 | −9 | 185,207,220 | `#b9cfdc` |
| Gebäude Wand | 80 | 0 | +1,5 | 200,198,196 | `#c8c6c4` |
| Wald / Baumgruppe | 76 | −13 | +14 | 173,194,161 | `#adc2a1` |
| Gebäude Dach | 70 | +2 | +4 | 178,170,164 | `#b2aaa4` |
| Nebenkontur (Gehweg/Rad/Grün) | 70 | 0 | −1 | 170,171,173 | `#aaabad` |
| Kontur Grünfläche | 68 | −8 | +9 | 158,170,149 | `#9eaa95` |
| **Hauptkontur (Fahrbahn/Platz)** | 58 | 0 | −1 | 139,139,141 | `#8b8b8d` |
| Bahn / Schiene | 45 | 0 | −1 | 106,107,108 | `#6a6b6c` |
| Beschriftung | 30 | 0 | 0 | 71,71,71 | `#474747` |

Prüfung gegen die Regeln aus 3.2 **[berechnet]**:
Fahrbahn 97 ↔ Hauptkontur 58 = **ΔL\* 39** (Ziel ≥ 30 ✔) ·
Gehweg 90 ↔ Nebenkontur 70 = **ΔL\* 20** (schmales Objekt, zusätzlich Farbtemperatur ✔) ·
Fahrbahn 97 ↔ Gehweg 90 = **ΔL\* 7** ✔ · Gehweg 90 ↔ Radweg 86 = **ΔL\* 4** plus b\*-Differenz 4,5 ✔ ·
Grundton 92 ↔ Grünfläche 87 = **ΔL\* 5** plus a\*-Differenz 9,5 ✔ ·
Gebäude Wand 80 ↔ Dach 70 = **ΔL\* 10** ✔.
**Das gesamte Basisband liegt zwischen L\* 30 und 97**, die Flächen zwischen **76 und 97 (21
Einheiten)** — vergleichbar eng wie basemap.de Grau (18) und Positron (14,7).

**Damit bleibt für Planobjekte frei:** alles mit **L\* < 65 und Chroma > 40**. Konkret:
Rettungswege/Sperrungen in kräftigem Rot-Magenta, Zelte/Stände in gesättigtem Blau oder Violett,
Fahrgeschäfte in Orange — jeweils **dunkler und deutlich bunter** als jede Basisfläche. Kein
Planobjekt darf einen der 16 Basistöne wiederverwenden.

### 5.5 Grünflächen entzufälligen

„Random" entsteht dadurch, dass 18 ALKIS-Grünflächen, 50 OSM-Grünflächen und 8 Waldflächen als
gleichwertige bunte Flecken nebeneinanderliegen. Zwei Maßnahmen:

1. **Eine Grünfamilie mit Helligkeitsrampe statt mehrerer Grüns** — Vorbild basemap.de, das für Wald
   und Gehölz einen zoomabhängigen Verlauf `rgb(223,240,182)` → `rgb(154,182,109)` verwendet, also
   L\* 92,3 → 70,5 **[berechnet]** innerhalb *eines* Farbtons (Rohwerte: 2.5).
   In der Palette oben: Grünfläche L\* 87 → Wald L\* 76, gleiche a\*/b\*-Richtung, nur stärker.
2. **Die Abstufung an eine gemessene Eigenschaft binden**, nicht an die Quellenherkunft — Vorbild
   Google, das Bestandsdichte in Helligkeitsstufen desselben Grüns übersetzt („a densely covered
   forest can be classified as dark green, while an area of patchy shrubs could appear as a lighter
   shade of green", Beleg 2.7 c). Verfügbare Eigenschaften im Bestand: ALKIS-Nutzungsart,
   OSM-`landuse`/`natural`, Vorhandensein von Baumkataster-Punkten.

### 5.6 3D-Einstellungen

| Einstellung | Empfehlung | Beleg |
|---|---|---|
| Ambient Occlusion | **einschalten** — die wirksamste Einzelmaßnahme gegen den Klotz-Eindruck; CesiumJS `createAmbientOcclusionStage`, Ausgangswerte `intensity` moderat, Radius in der Größenordnung 0,5 m | 4.1 (3); Langer & Bülthoff 2000 |
| Silhouette / Edge | **einschalten**, dünn und dunkel — 3D-Entsprechung des Casings | 4.1 (2) |
| Sonnenstand | ca. **45° Höhe**, Azimut so, dass die Hauptstraßenrichtung Darmstadts schräg beleuchtet wird (nicht parallel) | 4.2 |
| key:fill | **2:1 bis 3:1**, nicht härter — sonst laufen Schattenfassaden zu | 4.2 |
| Dach vs. Wand | Dachmaterial **~10 L\* dunkler und leicht wärmer** als Wandmaterial (Palette 5.4: 70 gegen 80); die Sonne erzeugt den Rest des Kontrasts | 4.1 (1) |
| Schlagschatten | schaltbar, mit echter Tageszeit — doppelter Nutzen: Tiefe **und** Planungsinformation (Verschattung von Standflächen) | 4.1 (4) |
| Boden-Flächen | **ungeschattet lassen** (wie bisher) und ausschließlich über Palette + Kontur differenzieren — sonst konkurriert die Beleuchtung mit der Kartenlogik | Figur-Grund, 3.3 |

### 5.7 Reihenfolge der Umsetzung

1. Union + Kappen/Gehrung (5.3) — behebt „knubbelig" und ist Voraussetzung für alles Weitere.
2. ALKIS-Platte / OSM-Decker trennen (5.2) — behebt die Doppelbelegung.
3. Konturen einführen (5.1) — behebt „Straßen nicht erkennbar".
4. Palette umstellen (5.4/5.5) — behebt „random" und „bunte Masse".
5. AO + Silhouette + Lichtführung (5.6) — behebt „weiße Klötze".

---

---

## 6 Die Palette wird **gerechnet**, nicht gewählt (10.08.2026)

Der Auftraggeber sah einen „Fleckenteppich" und Flächen, die er nicht
auseinanderhalten konnte. Der Abschnitt 5.4 hatte eine Palette *vorgeschlagen*;
was fehlte, war der Nachweis, dass sie an den Stellen trägt, an denen sie
gebraucht wird. Denn nicht jedes Klassenpaar ist gleich wichtig: Ob sich Wald
und Radweg unterscheiden lassen, entscheidet sich nur dort, wo Wald und Radweg
**aneinanderstoßen** — und im Pilotgebiet tun sie das auf 0 m.

### 6.1 Erst messen, welche Klassen sich überhaupt berühren

`scripts/flaechen-nachbarschaft.ts` misst an den fertigen Bodenflächen, welche
Zeichenklassen sich berühren und über **welche Länge**. Ergebnis für das
Pilotgebiet (`npm run flaechen:nachbarschaft`, Ablage in
`data/abnahme/flaechen-nachbarschaft.json`):

- **141.681 m** gemeinsame Grenze
- **53 Klassenpaare** — von 105 theoretisch möglichen
- längstes Paar `fahrbahn|platte` mit **28.646 m** (20,2 % aller Grenze)
- die 10 längsten Paare tragen zusammen **rund drei Viertel** der Grenze

Wichtig für die Klassenbildung: Der Schlüssel ist die **Zeichen**klasse, nicht
die Nutzungsart. `fahrbahn` aus ALKIS wird als `platte` gezeichnet — sonst
zählte man ein Paar, das im Bild gar nicht vorkommt.

### 6.2 Die Helligkeitsleiter ist eine **Färbung des Nachbarschaftsgraphen**

Damit wird aus der Palettenfrage eine gelöste Aufgabe: Gesucht ist die kleinste
Zahl von Helligkeitsstufen, mit der sich der gemessene Nachbarschaftsgraph so
färben lässt, dass **kein Paar, das sich nennenswert berührt**, dieselbe Stufe
bekommt. `scripts/palette-leiter.ts` rechnet das für verschiedene Schwellen —
ab welchem Anteil an der Gesamtgrenze ein Paar als „berührt sich" gilt:

| Schwelle | Paare oberhalb | nötige Stufen |
|---|---|---|
| 2 % | 8 | 4 |
| 1 % | 12 | 4 |
| **0,5 %** | **17** | **5** |
| 0,25 % | 24 | 6 |
| 0 % (alle 53) | 53 | 9 |

Gewählt: **0,5 %** → **fünf Stufen**. Neun Stufen wären zwar „vollständig",
müssten aber L\* 93 bis L\* 20 überspannen — die untersten Stufen wären so
dunkel wie die Konturen, und die Karte kippt in das „graue Einerlei", das der
Auftraggeber schon einmal abgelehnt hat. Fünf Stufen mit ΔL\* 9,5 passen in das
Band L\* 92,8 bis 54,8.

Das ist der Punkt, an dem sich diese Palette von einer gewählten unterscheidet:
Die Stufenzahl ist **hergeleitet**, und die 17 Paare oberhalb der Schwelle
tragen zusammen **95,6 %** der gesamten Grenzlänge. Für die restlichen 4,4 %
muss die Farbtemperatur tragen (Abschnitt 3.2).

### 6.3 Die Töne werden aus L\*a\*b\* zurückgerechnet

`scripts/palette-rechnen.ts` erzeugt jeden Ton aus Zielwerten in CIELAB, wandelt
nach sRGB, rundet auf den Hexwert und **rechnet ihn zurück** — die Tabelle unten
zeigt die zurückgerechneten Werte, nicht die gewünschten. Deshalb ist die
Stufenweite 9,5 und nicht 9,0: Nach der Quantisierung auf 8 Bit je Kanal blieb
sonst ein Paar knapp unter der geforderten Differenz von 9.

Ergebnis der Selbstprüfung (`npm run palette:pruefen`, Stand 10.08.2026):

```
  fahrbahn         #e9eaec  L* 92,67      wald        #8ea283  L* 64,35
  landwirtschaft   #eaecd3  L* 92,66      wasser      #899fac  L* 64,24
  HIMMEL           #d5dee6  L* 88,02      PLATTE      #999c9f  L* 64,20
  gruen            #c6d4bd  L* 83,32      weg         #a49a91  L* 64,20
  platz            #cfcfd0  L* 83,15      gleiszone   #728691  L* 54,73
  radweg           #c8b0ad  L* 73,77      bahn        #80838a  L* 54,72
  fussgaengerzone  #acb8b3  L* 73,74      sonstige    #87827e  L* 54,68
  treppe           #bbb4ae  L* 73,72      bebauung    #87827e  L* 54,68
  gehweg           #b4b5b9  L* 73,71      GELÄNDE     #87827e  L* 54,68
```

### 6.4 `pruefePalette()` prüft jetzt die **gemessene** Nachbarschaft

Die Selbstprüfung in `web/src/scene/palette.ts` lief bisher gegen eine
Wunschliste. Jetzt kennt sie `NACHBARSCHAFT_M` — die 53 gemessenen Paare — und
meldet beim Laden, wenn ein Paar oberhalb der Schwelle **weniger als ΔL\* 9**
auseinanderliegt. Neun Prüfungen insgesamt, darunter:

- kein Flächenton heller als **L\* 93** (sonst leuchtet die Karte)
- der Himmel darf **nicht heller** sein als die hellste Fläche (er war es:
  L\* 94 gegen 92,7 — die Karte wirkte dadurch matt, das Bild „ausgeblichen")
- jede Kontur mindestens **3:1** gegen ihre Füllung (WCAG 2.1 SC 1.4.11)
- Gleiszone und Eindeckung des Oberbaus **derselbe** Ton — sie sind dasselbe
  Bauteil, und zwei Töne wären zwei Wahrheiten

Der Lauf ist als `npm run palette:pruefen` auch ohne Browser möglich und endet
mit Rückgabewert 1, wenn ein Befund bleibt. Stand 10.08.2026: **bestanden, kein
Befund**; 98,3 % der Grenzlänge liegen bei ΔL\* ≥ 9.

### 6.5 Was die neue Palette an Zeichenfehlern **sichtbar gemacht** hat

Solange die Geländeplatte denselben Ton trug wie die Flächen darauf, war jeder
Durchstich unsichtbar. Mit dem eigenen Ton (`GRUNDTON` #87827e) wurde er
sichtbar — und messbar:

1. **59,7 % Doppelzeichnung.** 87.194 m² der OSM-Fahrbahndecke lagen über der
   amtlichen Platte, weil eine einzelne fehlgeschlagene Vereinigung die Klasse
   im Ergebnis ließ, aber nicht in der Belegtfläche. Behoben durch blockweisen
   Abzug mit Millimeterrundung: **607 m² (0,4 %)** Rest, und gescheiterte Abzüge
   werden seitdem **gezählt und gemeldet**.
2. **Gelände sticht durch die Bodenflächen.** Zwei Ursachen: Die vereinfachte
   Geländeplatte durfte um `netzToleranzM` vom Raster abweichen (behoben, indem
   die **Zeichnung** der Platte um genau diesen Betrag abgesenkt wird —
   gerechnet wird unverändert), und Bodenflächen wurden innen gar nicht
   unterteilt (behoben mit `granularity`).
3. **Die Maschenweite der Bodenflächen** ist gemessen worden (20.000
   Stichproben): Bei 2 m liegt das Gelände in 13,4 % der Stichproben mehr als
   2 cm über der Fläche, 99-%-Wert 19 cm. Bei 1 m wären es 3,6 % und 5,8 cm —
   **der Schritt wurde trotzdem verworfen**, weil große Flächen (der größte
   Gehweg misst 233 × 370 m) bei 1 m in den Rückfallweg ohne Unterteilung
   fallen und dann über ihre ganze Breite durchhängen. Im Bild verschwand die
   Grünfläche vollständig unter der Geländeplatte. Wer das auflösen will, muss
   die Masche **je Fläche aus ihrer Größe** bestimmen, nicht die Konstante
   drehen. Der Befund steht als Kommentar an `FLAECHEN_MASCHE_RAD` in
   `web/src/scene/stadt.ts`.


---

## Quellenverzeichnis

Alle Quellen abgerufen am **07.08.2026**.

**Stildefinitionen (Primärquellen mit echten Farbwerten)**
- CARTO Positron: https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json — Repo: https://github.com/CartoDB/basemap-styles
- CARTO Dark Matter: https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
- Mapbox Light (öffentliche Spiegelung, historisch): https://raw.githubusercontent.com/jingsam/mapbox-gl-styles/master/Light.json — offizielles Repo: https://github.com/mapbox/mapbox-gl-styles
- OpenStreetMap Carto: https://raw.githubusercontent.com/gravitystorm/openstreetmap-carto/master/style/style.mss · .../style/landcover.mss · .../style/roads.mss · .../style/road-colors-generated.mss · https://raw.githubusercontent.com/gravitystorm/openstreetmap-carto/master/road-colors.yaml
- basemap.de Web Vektor Farbe: https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json
- basemap.de Web Vektor Grau: https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json
- basemap.de Produkt- und Katalogseiten: https://basemap.de/produkte-und-dienste/web-vektor/ · https://basemap.de/data/produkte/web_vektor/meta/bm_web_vektor_col_signaturenkatalog.html · https://basemap.de/data/produkte/web_vektor/meta/bm_web_vektor_gry_signaturenkatalog.html
- Google Maps Platform Style Reference: https://developers.google.com/maps/documentation/javascript/style-reference
- Google Maps Beispielstil „Night mode": https://developers.google.com/maps/documentation/javascript/examples/style-array
- Google Blog, „A more detailed, colorful map", 18.08.2020: https://blog.google/products-and-platforms/products/maps/more-detailed-colorful-map/

**Technik / Spezifikationen**
- MapLibre Style Spec, Layers (line-cap, line-join, line-miter-limit): https://maplibre.org/maplibre-style-spec/layers/
- PostGIS ST_Buffer (endcap, join, mitre_limit): https://postgis.net/docs/ST_Buffer.html
- Esri / Adventures in Mapping, „Make lines legible, and POP, with casing": https://adventuresinmapping.com/2026/01/14/make-lines-legible-and-pop-with-casing/
- Esri, „Primary Design Principles for Cartography": https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/primary-design-principles-for-cartography

**Farblehre / Kartografie**
- Cynthia A. Brewer, „Color Use Guidelines for Mapping and Visualization": https://web.natur.cuni.cz/~langhamr/lectures/vtfg1/mapinfo_2/barvy/colors.html
- Penn State GEOG 486, „Types of Color Schemes": https://courses.ems.psu.edu/geog486/node/878
- Penn State GEOG 486, „Making Choropleth Maps": https://www.e-education.psu.edu/geog486/node/881
- Harrower & Brewer, „ColorBrewer.org: An Online Tool for Selecting Colour Schemes for Maps" (PDF): https://www.cs.rpi.edu/~cutler/classes/visualization/S18/papers/colorbrewer.pdf
- Konica Minolta, „What Is Delta E (ΔE)?": https://sensing.konicaminolta.eu/mi-en/colourblogtop/colour-blog/whatisdeltae
- Wikipedia, „Figure-ground (cartography)": https://en.wikipedia.org/wiki/Figure-ground_(cartography)

**3D**
- 3DCityDB-Web-Map-Client: https://github.com/3dcitydb/3dcitydb-web-map · https://3dcitydb-docs.readthedocs.io/en/latest/webmap/
- LGL Baden-Württemberg, 3D-Gebäudemodell LoD2: https://www.lgl-bw.de/Produkte/3D-Produkte/3D-Gebaeudemodelle/LoD2/
- Cesium PostProcessStageCollection / PostProcessStageLibrary: https://cesium.com/learn/cesiumjs/ref-doc/PostProcessStageCollection.html · https://cesium.com/learn/ion-sdk/ref-doc/PostProcessStageLibrary.html
- Wikipedia, „Ambient occlusion" (mit Zitat Langer & Bülthoff, *Perception* 29(6), 2000, 649–660): https://en.wikipedia.org/wiki/Ambient_occlusion
- Wikipedia, „Lighting ratio": https://en.wikipedia.org/wiki/Lighting_ratio
- Rendimension, „How to prepare your project for stunning visualization results": https://rendimension.com/prepare-project-stunning-visualization/
- ArchiVinci, „Elevation Rendering: A Guide for Modern Architects": https://www.archivinci.com/blogs/elevation-rendering
- Apatero, „Best Architecture Visualization Prompts": https://apatero.com/blog/best-prompts-architecture-visualization-renderings-2025

**Offene Punkte / nicht belegbar**
- Google publiziert die **Standardfarben** seiner Karte nicht; belegbar sind nur Struktur (Feature-/Elementtypen) und die offiziellen Beispielstile.
- Die **aktuellen** Mapbox-Stile (Light/Dark v10+) sind nicht öffentlich; die Werte in 2.3 stammen aus einer Spiegelung älterer Fassungen.
- basemap.de führt **keine Radweg-Klasse**; Positron/Dark Matter führen keine getrennten Klassen für Platz, Fußgängerzone und Radweg. Für diese Klassen gibt es folglich keine Referenzwerte, sie sind in 5.4 aus den Nachbarklassen abgeleitet.
- Für 3D-Stadtmodelle existiert **keine publizierte Farbtabelle**; belegbar sind nur die Mechanismen (semantische Dach-/Wandmaterialien, AO, Schatten, Silhouette).
