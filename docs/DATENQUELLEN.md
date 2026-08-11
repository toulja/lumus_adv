# Datenquellen-Register — EventPlan3D / Heinerfest

Verbindliches Verzeichnis aller Geodaten-, Karten- und Rechtsquellen der Plattform.
Jede Zahl und jeder Endpunkt in diesem Dokument ist entweder belegt oder ausdrücklich als Annahme gekennzeichnet.

**Stand: 07.08.2026**

## Legende

| Zeichen | Bedeutung |
|---|---|
| ✅ | **Verifiziert** — mit Datum und Methode am Eintrag vermerkt (curl-Abruf, GetCapabilities, GetFeature, Range-GET) |
| 🔧 | **Offen** — noch nicht geprüft, oder Angabe stammt aus Sekundärquelle und braucht eine Primärprüfung |
| ❌ | **Negativbefund** — geprüft und nachweislich nicht vorhanden / nicht nutzbar |
| ⚠ | **Fallstrick** — funktioniert, aber nur unter einer nicht offensichtlichen Bedingung |

Prüfmethoden-Kürzel: `GC` = GetCapabilities, `GM` = GetMap, `GF` = GetFeature, `DFT` = DescribeFeatureType, `RG` = Range-GET (`curl -r 0-99`).

---

## Amtliche Geobasisdaten Hessen

| Produkt | Inhalt für EventPlan3D | Zugang (URL + Parameter) | Status |
|---|---|---|---|
| **Liegenschaftskarte (ALKIS-Präsentation)** | Flurstücksgrenzen, Gebäudegrundrisse, Verkehrs- und Platzflächen als Kartenbild — Grundlage für Standflächen-Layout auf Marktplatz/Luisenplatz/Friedensplatz | `https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-maps.ows`<br>`SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`<br>Layer: `he_alk` (farbig), `he_alk_grau`, `he_alk_t` (transparent)<br>Maßstabsfenster laut GC: 1 : 1 bis 1 : 10.000 | ✅ 07.08.2026 (GC) — Endpunkt und Layernamen bestätigt |
| **Topographische Karten (DTK / ÜK)** | Kartenhintergrund für Übersichtsmaßstäbe (Anfahrt, Sperrkreise, Rettungsanfahrt aus dem Umland) | Gleicher Endpunkt.<br>`he_dtk25` (1 : 1–50.000), `he_dtk50` (1 : 20.000–100.000), `he_dtk100` (1 : 50.000–250.000), `he_uek200` (1 : 10–800.000), `he_uek` (Gruppenlayer), `he_uek1000` (bis 1 : 4 Mio.) | ✅ 07.08.2026 (GC) — Maßstabsgrenzen aus `MinScaleDenominator`/`MaxScaleDenominator` der Capabilities |
| ⚠ Sammellayer `he_dtk`, `he_uek` | — | `he_dtk` (1 : 1–100.000) und `he_uek` sind **Gruppenlayer**; sie mischen in großen Maßstäben andere Inhalte ein bzw. haben Lücken | 🔧 In EventPlan3D **nur explizite Layer** verwenden (Erfahrungswert aus dem Schwesterprojekt LUMUS, für Heinerfest nicht erneut vermessen) |
| **Präsentationsgraphiken (PG)** | Alternative, plakativere Kartendarstellung für Ausdrucke/Behördenmappen | Gleicher Endpunkt. `he_pg4` (≤1 : 5.000), `he_pg10`, `he_pg25`, `he_pg50`, `he_pg100` | ✅ 07.08.2026 (GC) — vorhanden; Eignung für Berichte noch nicht bewertet 🔧 |
| **Digitale Orthophotos DOP20** | Luftbild für Bestandsaufnahme (Baumstandorte, Möblierung, Belag) und für die Plausibilisierung der 3D-Szene | `https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows`<br>`SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=he_dop20_rgb&FORMAT=image/jpeg&CRS=EPSG:25832`<br>Maßstabsfenster 1 : 1–9.000; grobere Stufen: `el_dop320_rgb` (1 : 9.000–80.000), `el_dop5000_rgb`, Sammellayer `he_dop_rgb`.<br>Infrarot: `he_dop20_cir` | ✅ 07.08.2026 (GM) — 1000×1000 px, BBOX `475300,5522300,475800,5522800` → HTTP 200, `image/jpeg`, 279 kB |
| ⚠ **DOP nur in EPSG:25832** | — | Der Wurzellayer bewirbt zwar 20 CRS, **jeder DOP-Layer listet in den Capabilities ausschließlich `EPSG:25832`**. Anfragen in 4326/3857 liefern HTTP 200 mit Leerbild — kein Fehler, nur leer. | ✅ 07.08.2026 (GC + GM): CRS-Liste je Layer = `['EPSG:25832']`. **Konsequenz:** Kacheln serverseitig aus 25832 umprojizieren, nie direkt in 4326 anfragen. |
| ⚠ **WMS-Kachelgrenze** | — | `MaxWidth`/`MaxHeight` = **3000 px** für beide HVBG-WMS | ✅ 07.08.2026 (GC) |
| **WMTS Orthophotos** | Vorgekachelte DOP-Auslieferung (schneller als WMS für Karten-Panning) | `https://www.gds-srv.hessen.de/wmts-dop/wmts/1.0.0/WMTSCapabilities.xml` | 🔧 URL aus der HVBG-Dienstübersicht übernommen, **noch nicht abgerufen** |
| **ALKIS vereinfacht (WFS)** | Amtliche Flurstücks- und Gebäudegeometrie — **die einzige geometrische Wahrheit** für Flächenberechnung, Abstände, Rettungswegbreiten | `https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs`<br>`SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ave:Flurstueck&SRSNAME=urn:ogc:def:crs:EPSG::25832&BBOX=...` | ✅ 07.08.2026 (GC) |
| ↳ FeatureTypes | Flurstücke, Gebäude/Bauwerke, tatsächliche Nutzung | `ave:Flurstueck`, `ave:FlurstueckPunkt`, `ave:GebaeudeBauwerk`, `ave:KatasterBezirk`, `ave:Nutzung`, `ave:NutzungFlurstueck`, `ave:VerwaltungsEinheit` | ✅ 07.08.2026 (GC) — die Capabilities führen **sieben** FeatureTypes, nicht nur die drei ursprünglich notierten |
| ↳ CRS | — | DefaultCRS `urn:ogc:def:crs:EPSG::25832`; OtherCRS `::25833`, `::4258`, `::4326` | ✅ 07.08.2026 (GC) |
| ↳ Ausgabeformate | — | GML 3.1.1 / GML 3.2.1 (`application/gml+xml; version=3.2`) sowie **`application/x-zip-shapefile`** bei GetFeature. **Kein GeoJSON.** | ✅ 07.08.2026 (GC) |
| ⚠ **BBOX-Achsenreihenfolge** | — | Bei `urn:ogc:def:crs:EPSG::25832` steht der **Rechtswert zuerst** (E,N), bei `urn:ogc:def:crs:EPSG::4326` die **Breite zuerst** (lat,lon). Vertauschen liefert stumm 0 Treffer statt einer Fehlermeldung. | ✅ 07.08.2026 (GF) |
| ⚠ **Kein Result-Paging** | — | `ImplementsResultPaging = FALSE`, `CountDefault = 100000`. Große Abfragen müssen räumlich (BBOX-Kacheln) zerlegt werden, nicht über `STARTINDEX`. | ✅ 07.08.2026 (GC) |
| **LoD2-Gebäudemodelle** | Gebäudekörper mit amtlichen Höhen — Sichtachsen von der Bühne, Verschattung, Windschatten, Höhenkontext für Aufbauten, **und die Geländehöhe** (siehe Abschnitt „Geländehöhen ohne DGM1") | Downloadcenter-Direktlink-Muster:<br>`https://gds.hessen.de/downloadcenter/<JJJJMMTT>/3D-Daten/3D-Geb%C3%A4udemodelle/3D-Geb%C3%A4udemodelle%20LoD2/<Kreis>/<Datei>.zip` | ✅ 07.08.2026 (RG) — mit Kreis `Kreisfreie Stadt Darmstadt`, Datei `Darmstadt-LoD2.zip` → HTTP 206, `application/zip`, 159 MB (entpackt ca. 1,56 GB CityGML 1.0) |
| ↳ CRS + Attribute | — | `urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH`; Attribute u. a. `MittlereTraufHoehe`, `Firsthoehe`, `AbsoluteHoehe`, `Dachneigung` | ✅ 07.08.2026 (Datei geprüft) |
| ⚠ **HEAD verboten** | — | Der Downloadserver antwortet auf `HEAD` mit **405**. Existenzprüfung nur per `GET`/Range-GET. | ✅ 07.08.2026 |
| ⚠ **Ordnerpfade sind nicht listbar** | — | `GET` auf einen Ordner (auch auf den *bekannt existierenden* LoD2-Ordner `3D-Daten/3D-Geb%C3%A4udemodelle/`) liefert **404**. Ein 404 auf einem Ordner beweist daher **nicht**, dass der Ordner fehlt — nur exakte Dateipfade funktionieren. | ✅ 07.08.2026 (RG, drei Ordnerpfade getestet, alle 404) |
| **DGM1 (Geländehöhen)** | Höhenmodell für Rampen, Gefälle, Barrierefreiheit, Bühnenpodest-Ausgleich, Geländesenken (Schlossgraben) | ✅ **KORREKTUR 08.08.2026 — doch voll skriptbar.** Der Negativbefund vom 07.08. beruhte auf falscher Schreibweise (Ordner mit Umlaut+Klammern, Datei mit Leerzeichen um den Bindestrich):<br>`https://gds.hessen.de/downloadcenter/<JJJJMMTT>/3D-Daten/Digitales%20Gel%C3%A4ndemodell%20(DGM1)/<Kreis>/<Gemeinde>%20-%20DGM1.zip`<br>Darmstadt: 333 MB ZIP, 160 Kacheln `dgm1_32_<Ekm>_<Nkm>_1_he.tif` (1 km², GeoTIFF float32, 1 m, EPSG:25832, NoData −9999). Skriptbarer JSON-Index: `https://gds.hessen.de/INTERSHOP/rest/WFS/HLBG-Geodaten-Site/-/downloadcenter?path=3D-Daten%2FDigitales+Gel%C3%A4ndemodell+%28DGM1%29%2F<Kreis>` (liefert gültige Downloadpfade inkl. Tagesdatum). Datum im Pfad: nur heute/gestern gültig. | ✅ 08.08.2026 (RG: HTTP 206, `application/zip`, 349.300.412 B; eine Kachel entpackt und geprüft: Werte 127,6–154,1 m ü. NHN, plausibel) |
| **Baumkataster Darmstadt (Stadtbäume)** | Amtlich gemessene Einzelbäume (Position, Höhe, Kronendurchmesser, Art) — im Pilotgebiet 1.690 Stadtbäume + 392 Topobäume gegenüber nur ~531 OSM-Bäumen | 3d.darmstadt.de (PlexMap, Vermessungsamt): Cesium-3D-Tiles-Layer „Stadtbäume_2025", Tileset `https://3d.darmstadt.de/static/tiles/942da2a0-5b49-4130-8f19-0666dbae7864_6/tileset.json`, i3dm-Kacheln je 1 km²; Position aus RTC_CENTER (ECEF→UTM32), KronenD = scale_x [m], Höhe = scale_y·1,5 [m] (an der Attribut-API `…/api/v2/cesium/mesh-properties-by-jwt` verifiziert). Extrakt liegt in `data/cache/baumkataster/darmstadt_stadtbaeume.json`. | ✅ 08.08.2026 (Tileset+i3dm abgerufen, 3 Stichproben gegen Attribut-API exakt) / ⚠ Lizenz: Nutzung mit Quellenvermerk üblich (OSM-Freigabe der Stadt dokumentiert), formales Open-Data-Label fehlt — Freigabe des Vermessungsamts einholen 🔧 |
| **DGM-Schummerung (WMS)** | Nur Reliefbild, **keine Höhenwerte** | `.../ogc-free-maps.ows` Layer `he_dgm` (1 : 1–5 Mio.) | ✅ 07.08.2026 (GC) — Layer existiert; liefert ein Bild, keine Z-Werte |
| **Suchdienst / Geokodierung (amtlich!)** | Adresssuche „Straße Hausnummer" → amtliche Koordinate; Flurstücks- und Lagesuche | `https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-data.ows`<br>`SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:hako&SRSNAME=urn:ogc:def:crs:EPSG::25832`<br>FeatureTypes: `ms:hako` (amtliche Hauskoordinaten), `ms:flst` (Flurstücksangaben aus ALKIS), `ms:lage` (Lageangaben aus ALKIS) | ✅ 07.08.2026 (GC, DFT, GF) — **funktioniert**: POST-GetFeature mit `PropertyIsLike HA_STR = 'Wilhelm-Gl*'` → 4 Treffer, u. a. Hausnr. 18/19/20/22, `GD_GDBEZ = Darmstadt`, Position `475126.60 / 5523981.54` (EPSG:25832) |
| ↳ Attribute `ms:hako` | — | `HA_ID, HA_QUAL, HA_LAND, HA_BEZIRK, HA_KREIS, HA_GEMEINDE, HA_OTEIL, HA_STRNR, HA_HAUSNR, HA_HAUSNRZU, HA_RWERT, HA_HWERT, HA_STR, HA_PLZ, HA_PORT, HA_PZUSATZ, GD_GDBEZ` | ✅ 07.08.2026 (DFT) |
| ↳ Attribute `ms:flst` | — | `FS_GKNR, FS_FLNR, FS_FSZ, FS_FSN, FS_FSSTATUS, GK_GKBEZ, FS_ID` | ✅ 07.08.2026 (DFT) |
| ⚠ **DefaultCRS ist Gauß-Krüger** | — | Alle drei FeatureTypes haben **DefaultCRS `urn:ogc:def:crs:EPSG::31467`** (GK Zone 3). `SRSNAME=urn:ogc:def:crs:EPSG::25832` muss **immer** mitgegeben werden, sonst kommen GK3-Koordinaten zurück. | ✅ 07.08.2026 (GC + GF) |
| ⚠ **`HA_RWERT`/`HA_HWERT` bleiben GK3** | — | Auch bei `SRSNAME=…25832` liefert die **Geometrie** UTM32, die **Attribute** `HA_RWERT`/`HA_HWERT` aber weiterhin GK3-Werte (Beispielwert `3532112.261`). Immer die `gml:pos`-Geometrie auswerten, nie die Attribute. | ✅ 07.08.2026 (GF, Vergleich Attribut vs. `gml:pos`) |
| ⚠ **`CQL_FILTER` wird ignoriert** | — | Ein `CQL_FILTER`-Parameter führt zu **keinem Fehler**, wird aber wirkungslos durchgereicht — die Antwort enthält beliebige Datensätze. Filter **nur** als OGC-`fes:Filter` (POST-XML oder `FILTER=`-Parameter). | ✅ 07.08.2026 (GF, Gegenprobe: gefilterte Anfrage lieferte fachfremde Straßennamen) |
| ⚠ **`PropertyIsEqualTo` mit Umlaut-Volltreffer schlug fehl** | — | `PropertyIsEqualTo HA_STR = 'Wilhelm-Glässing-Straße'` → 0 Treffer; `PropertyIsLike 'Wilhelm-Gl*'` → 4 Treffer. Die Antwort selbst ist sauber UTF-8. Ursache nicht geklärt. **Empfehlung: für die Adresssuche grundsätzlich `PropertyIsLike` mit Wildcard verwenden.** | ✅ 07.08.2026 (GF) / 🔧 Ursache offen |
| **Hauskoordinaten (WMS)** | Punktdarstellung der Hausnummern im Kartenbild | `.../ogc-free-maps.ows` Layer `he_hako` (1 : 1–10.000) | ✅ 07.08.2026 (GC) |
| **Bodenrichtwerte BORIS Hessen** | Für EventPlan3D nachrangig (ggf. Standgeld-/Flächenwert-Kontext) | `.../ogc-free-maps.ows` Layer `hboris_zonen`, `hboris_zonen_t`, `hboris_feature`, `hboris_label`; Jahrgänge 2020/2022/2024/2026 als eigene Layer.<br>WFS: `https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs` | ✅ 07.08.2026 (GC für WMS-Layer) / 🔧 BORIS-WFS nicht abgerufen |
| **basemap.de Web Raster (BKG)** | Bundesweiter, einheitlicher Kartenhintergrund außerhalb Hessens und für Fernmaßstäbe | `https://sgx.geodatenzentrum.de/wms_basemapde`<br>`SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`<br>Layer: `de_basemapde_web_raster_farbe`, `de_basemapde_web_raster_grau` | ✅ 07.08.2026 (GC) — genau diese zwei Layer, `MaxWidth`/`MaxHeight` = **6000** |
| ↳ CRS | — | `CRS:84, EPSG:3857, EPSG:25832, EPSG:25833, EPSG:4326, EPSG:4258, EPSG:3035, EPSG:3034, EPSG:3044, EPSG:3045, EPSG:4647, EPSG:5650` | ✅ 07.08.2026 (GC) — EPSG:25832 nativ |
| **Weitere HVBG-Dienste (nicht eingebunden)** | Historische Luftbilder, Sentinel-2-Monatsmosaike, Flurbereinigung, Verwaltungseinheiten, Basis-DLM | `.../cgi-bin/hdop/he-hdop.ows`, `.../cgi-bin/sentinel/he-sen2.ows`, `.../cgi-bin/flurbv/he-flurbv.ows`, `.../cgi-bin/verweinh/he-verwaltungseinheiten.ows`, `https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/atkis-bdlm/sf/wfs` | 🔧 URLs aus der HVBG-Dienstübersicht, **nicht abgerufen** |
| **OSM Nominatim** | Entwicklungs-Geocoder (Fallback / Freitextsuche) | `https://nominatim.openstreetmap.org/search?q=…&format=jsonv2&countrycodes=de` | 🔧 Policy-gebunden: **max. 1 Anfrage/s**, eigener `User-Agent` Pflicht, kein Bulk-Geocoding. **Für den Produktivbetrieb durch den amtlichen Suchdienst (`ogc-free-data.ows`) ersetzen.** |

**Quellen der Dienst-URL-Liste:** HVBG, „Geodatendienste im originären Format" — https://hvbg.hessen.de/geoinformation/geodateninfrastruktur/geoportal-hessen/geodatendienste-im-originaeren-format

---

## Lizenzen und Quellenvermerke

### HVBG (alle Hessen-Geobasisdaten: ALKIS, DOP20, DTK/ÜK, LoD2, DGM1, Hauskoordinaten, Suchdienst)

Rechtsgrundlage der Kostenfreiheit, wörtlich aus dem `<Fees>`-Element der GetCapabilities (abgerufen 07.08.2026):

> „Der automatisierte Abruf und die Nutzung der Geobasisdaten und der zugehörigen Metadaten sind kostenfrei. (§ 24 Hessisches Vermessungs- und Geoinformationsgesetz – HVGG)"

Rechtsgrundlage der Nutzung, wörtlich aus `<AccessConstraints>` (abgerufen 07.08.2026):

> „Jede Nutzung der Geobasisdaten und zugehörigen Metadaten ist ohne Einschränkung oder Bedingung erlaubt. Die bereitgestellten Geobasisdaten und Metadaten dürfen für die kommerzielle und nicht kommerzielle Nutzung insbesondere 1. vervielfältigt, ausgedruckt, präsentiert, verändert, bearbeitet sowie an Dritte übermittelt werden, 2. mit eigenen Daten und Daten anderer zusammengeführt und zu selbstständigen neuen Datensätzen verbunden werden, 3. in interne und externe Geschäftsprozesse, Produkte und Anwendungen in öffentlichen und nicht öffentlichen elektronischen Netzwerken eingebunden werden. Wird bei der Nutzung der Geobasisdaten oder deren Metadaten ein Quellenvermerk beigegeben, ist in diesem auf Veränderungen, Bearbeitungen, neue Gestaltungen oder sonstige Abwandlungen der Daten oder Metadaten hinzuweisen. (§ 18 Hessisches Vermessungs- und Geoinformationsgesetz – HVGG)."

Beim Kartendienst (`ogc-free-maps.ows`) ist derselbe Text zusätzlich um die Bodenrichtwerte und `§ 1 Abs. 2 Gutachterausschusskostengesetz` bzw. `§ 17 Abs. 4 BauGB-AV` ergänzt (✅ 07.08.2026, GC).

**Wichtig — was das juristisch bedeutet:** Ein Quellenvermerk ist bei der HVBG **nicht zwingend vorgeschrieben**. *Wenn* einer beigegeben wird, muss er auf Veränderungen/Bearbeitungen hinweisen. Die HVBG-Seite „Einführung von Open Data zum 01.02.2022" (https://hvbg.hessen.de/geoinformation/open-data) nennt ebenfalls keinen vorgeschriebenen Wortlaut.

Auf opendata.hessen.de bzw. MetaVer ist das DGM1 zusätzlich unter **„Datenlizenz Deutschland – Zero – Version 2.0"** (https://www.govdata.de/dl-de/zero-2-0) ausgewiesen — dl-de/zero-2-0 kennt **keine** Namensnennungspflicht.
Quelle: MetaVer-Metadatensatz ATKIS-DGM 1, https://metaver.de/trefferanzeige?docuuid=dbf48a95-b44d-48b3-a5b4-981e4c1bd8e6 (abgerufen 07.08.2026).
🔧 Zu prüfen, ob dl-de/zero-2-0 auch für ALKIS/DOP/LoD2 im Metadatensatz steht — bislang nur für DGM1 gesehen.

**Von der HVBG selbst verwendete Formulierung** (aus dem `<Abstract>` beider WMS, ✅ 07.08.2026):

> Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation

### basemap.de (BKG)

Wörtlich aus dem `<Fees>`-Element von `https://sgx.geodatenzentrum.de/wms_basemapde` (abgerufen 07.08.2026):

> „Die Daten sind urheberrechtlich geschützt. Die Daten werden geldleistungsfrei gemäß der Creative Commons Namensnennung 4.0 International Lizenz (https://creativecommons.org/licenses/by/4.0/) zur Verfügung gestellt. Daten, die unter der Lizenz CC BY 4.0 stehen, dürfen unter einer Namensnennung geteilt, vervielfältigt und bearbeitet werden. Die Namensnennung ist im Quellenvermerk enthalten. Der Quellenvermerk ist zu beachten. || Quellenvermerk: **© GeoBasis-DE / BKG (Jahr des letzten Datenbezugs) CC BY 4.0**"

**Korrektur zur bisherigen Projektnotiz:** Die primäre Lizenz ist **CC BY 4.0**, nicht dl-de/by-2-0. Laut den offiziellen Nutzungsbedingungen (https://sgx.geodatenzentrum.de/web_public/gdz/lizenz/deu/nutzungsbedingungen_basemapde.pdf) ist dl-de/by-2-0 nur eine **Alternative**, falls CC BY 4.0 nicht verwendbar ist. Der Quellenvermerk ist hier — anders als bei der HVBG — **verpflichtend**.

### OpenStreetMap / Nominatim

ODbL 1.0; Quellenvermerk „© OpenStreetMap-Mitwirkende". Nutzungsrichtlinie: https://operations.osmfoundation.org/policies/nominatim/
🔧 Solange Nominatim genutzt wird, muss der OSM-Vermerk in jedem Export erscheinen, in dem eine per Nominatim ermittelte Koordinate steckt.

**Bezugsweg seit 11.08.2026: Ortsauszug statt Overpass-API.** Die Wege-, Flächen- und Detaildaten kommen aus dem Geofabrik-Auszug `europe/germany/hessen-latest.osm.pbf` (https://download.geofabrik.de/europe/germany/hessen.html), nicht mehr aus der Overpass-API. Grund ist nicht Bequemlichkeit, sondern die Nutzungsregel: 26 Stadtkacheln × 10 Abfragen sind ein Massenabruf, und die Overpass-Betreiber weisen Massenabrufe ausdrücklich ab und verweisen auf Auszüge. In der Praxis kostete das zwei Stadtläufe (25 von 26 Kacheln durch Dienstausfall verloren).

Der Auszug ist zugleich der **ehrlichere Nachweis**: Er hat einen festen Datenstand, den man nachschlagen und wiederherstellen kann. „Overpass API, abgerufen am …" sagt nur, wann gefragt wurde — dieselbe Abfrage liefert morgen etwas anderes. Der Quellennachweis jedes Geländes trägt darum Dateiname und Datenstand des Auszugs.

Holen: `node scripts/osm-auszug-holen.ts` (prüft die MD5-Summe von Geofabrik). Gegenprobe gegen gespeicherte Overpass-Antworten: `node scripts/auszug-gegenprobe.ts` — am 11.08.2026 über 57 Abfragen: 21.992 gemeinsame Objekte, 100,00 % geometrisch identisch, 0 verloren, 33 zusätzlich (Auszug einen Tag alt, Antworten mehrere).

⚠️ **Nicht jede Overpass-Instanz führt den Planeten.** `overpass.osm.ch` antwortete am 11.08.2026 als einzige zuverlässig — mit HTTP 200 in 0,2 s und **0 Gebäuden** für 1 km² Darmstadt (Bern zur selben Abfrage: 1.675). Es ist ein Schweiz-Auszug. Eine technisch einwandfreie, inhaltlich leere Antwort ist die teuerste Fehlerart dieses Projekts; der Import bricht deshalb ab, wenn eine **erfolgreiche** Abfrage für ein Gebiet ab 0,25 km² null Wegflächen liefert (`server/geodata/gelaende.ts`). Die naheliegende Gegenprobe `is_in` taugt dafür nicht — der Schweiz-Auszug führt Darmstadts grobe Verwaltungsgrenzen sehr wohl.

### Verbindlicher Quellenvermerk-Block für Berichte, PDF-Mappen und Kartenexporte

```
Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG),
Datenstand <JJJJ-MM-TT>; bearbeitet und in EventPlan3D weiterverarbeitet.
Kartengrundlage: © GeoBasis-DE / BKG <Jahr des letzten Datenbezugs> CC BY 4.0
[nur falls Nominatim-Koordinaten enthalten:] Geokodierung © OpenStreetMap-Mitwirkende (ODbL)
```

Der Zusatz „bearbeitet und … weiterverarbeitet" ist bei HVBG-Daten **nicht optional**, sobald ein Quellenvermerk gesetzt wird (§ 18 HVGG, s. o.) — EventPlan3D verändert die Daten immer (Umprojektion, Umfärbung, Höhenableitung).

---

## Geländehöhen ohne DGM1

### Der Negativbefund (07.08.2026)

Es existiert **kein skriptbarer, öffentlicher Direktlink** auf DGM1-Rasterdaten für Hessen. Geprüft und ergebnislos:

| Geprüft | Ergebnis |
|---|---|
| Downloadcenter-Direktlink-Muster mit `3D-Daten/Digitales Gelaendemodell (DGM1)/…`, `Digitale Gelaendemodelle (DGM1)/…`, `Gelaendemodelle/DGM1/…`, `DGM1/…`, `Digitales Gelaendemodell DGM1/…` | ❌ alle HTTP 404 |
| `ogc-free-images.ows?service=WCS` | ❌ HTTP 400 |
| `ogc-free-dgm.ows` | ❌ HTTP 404 |
| opendata.hessen.de-Datensatz „atkis-dgm-1" | ❌ als Schnittstelle nur ein WMS gelistet (Schummerungsbild, keine Höhenwerte) |
| MetaVer-Metadatensatz ATKIS-DGM 1 | Einzige Ressource ist eine **HTML-Seite** des Downloadcenters: `https://gds.hessen.de/INTERSHOP/web/WFS/HLBG-Geodaten-Site/de_DE/-/EUR/ViewDownloadcenter-Start?path=3D-Daten/Digitales%20Gel%C3%A4ndemodell%20(DGM1)` — kein Datei-Link |
| Diese Downloadcenter-Seite direkt per curl | ❌ HTTP 200, 13 kB Intershop-Rahmenseite, **keine Datei-Links im HTML** (session-/JavaScript-getrieben) |
| INSPIRE-ATOM-Feed „Elevation" für Hessen | 🔧 nicht gefunden. ATOM-Feeds existieren im Geoportal Hessen (`mod_inspireDownloadFeed.php`) und unter `https://www.gds-srv.hessen.de/atomfeed/…` (belegt für Verwaltungsgrenzen: `DigVGr-epsg25832-shp.zip`), ein Elevation-Feed konnte aber nicht belegt werden |

**Ehrliche Einordnung:** Der Ordner *existiert* mit hoher Wahrscheinlichkeit — die Metadaten verlinken ihn. Weil der Server auf Ordnerpfaden **grundsätzlich 404 liefert** (nachgewiesen auch am bekannt existierenden LoD2-Ordner, s. o.), lässt sich der exakte Dateiname nicht erraten. Der offizielle Weg ist die **manuelle Selbstentnahme im Downloadcenter bzw. Shop von Geodaten online** (https://gds.hessen.de) — kostenfrei, aber nicht automatisierbar.

Format laut HVBG (https://hvbg.hessen.de/landesvermessung/geotopographie/3d-daten/digitale-gelaendemodelle, abgerufen 07.08.2026): **GeoTIFF, 32 bit, Float, Komprimierung LZW**, Georeferenzierung **ETRS89 / UTM 32N und DHHN2016_NH**. Andere Rasterweiten, Höhenlinien (Shape) und Schummerungen sind nur kostenpflichtig auf Anfrage erhältlich. XYZ-Text gibt es nur noch für Altdaten.

### Der hier gewählte Weg: Höhen aus den LoD2-Bodenflächen

Jedes LoD2-Gebäude trägt eine **amtliche Bodenhöhe** (`AbsoluteHoehe` bzw. die z-Werte der `GroundSurface`). In einem Innenstadt-Festgelände wie dem Heinerfest-Bereich steht in jeder Richtung binnen weniger Dutzend Meter ein Gebäude — die Bodenflächen liefern also ein dichtes, amtlich belegtes Höhen-Stützpunktnetz.

Verfahren:

1. **Stützpunkte gewinnen:** aus `Darmstadt-LoD2.zip` je Gebäude die Bodenpolygon-Stützpunkte mit ihren z-Werten extrahieren (ETRS89/UTM32, Höhenbezug DHHN2016 NH).
2. **Ausreißer verwerfen:** Gebäude mit stark schwankenden Bodenpunkten (Hanglage, Tiefgarageneinfahrten, modellierte Sockel) über die Streuung der z-Werte je Gebäude filtern. 🔧 Schwellenwert noch festzulegen — **Annahme, nicht belegt – zu prüfen**: Verwerfen ab Spannweite > 1,0 m innerhalb einer Bodenfläche.
3. **Interpolieren:** zwischen den Stützpunkten ein Höhenraster erzeugen (Delaunay/TIN oder IDW), Rasterweite 1 m im Festgelände.
4. **Plausibilisieren:** das Ergebnis qualitativ gegen den WMS-Layer `he_dgm` (Schummerung) halten — er zeigt Reliefkanten, auch wenn er keine Zahlen liefert.

**Grenzen dieses Verfahrens, offen ausgesprochen:**
- Freiflächen ohne Randbebauung (große Plätze, Parkanlagen) werden nur über die Ränder gestützt; lokale Senken und Rampen mitten auf der Fläche sind darin **nicht** enthalten.
- Die Genauigkeit ist eine Interpolationsgenauigkeit, keine Messgenauigkeit. Für Barrierefreiheits-Nachweise (Gefälle, Rampenneigung) ist sie **nicht ausreichend**. 🔧 Solche Nachweise brauchen echtes DGM1 oder Örtliches.

⚠ **Höhenbezug-Fallstrick:** LoD2 und DGM1 liefern **physikalische Höhen (DHHN2016 NH, Normalhöhen)**. Eine 3D-Web-Szene auf WGS84-Ellipsoid braucht **ellipsoidische Höhen**. Die Differenz ist die Quasigeoid-Undulation aus dem amtlichen Modell **GCG2016** (BKG). Sie ist in Südhessen zweistellig und darf nicht ignoriert werden. 🔧 Der konkrete Wert für den Heinerfest-Bereich ist **noch nicht ermittelt** — er muss aus GCG2016 gezogen und im Konfigurationsfile hinterlegt werden. **Keine geschätzte Zahl in den Code schreiben.**

### Fallback: manueller DGM1-Import

Die Plattform bekommt einen Importpfad für eine vom Nutzer selbst aus dem Downloadcenter geholte DGM1-Datei:

- akzeptierte Formate: **GeoTIFF** (32 bit Float, LZW — das amtliche Format) und **XYZ**-Text (Altdaten und Fremdländer-Lieferungen)
- erwartetes CRS: EPSG:25832, Höhenbezug DHHN2016 NH — beim Import abfragen, nicht raten
- Ablage unter `data/dgm/<gemeinde>/`, Registrierung in der Landeskonfiguration
- 🔧 Importer noch nicht implementiert

---

## Rechtsgrundlagen

| Regelwerk | Relevanz für EventPlan3D | Fundstelle | Status |
|---|---|---|---|
| **MVStättV** (Muster-Versammlungsstättenverordnung) | Muster der Bauministerkonferenz, Fassung Juni 2005, zuletzt geändert durch die Fachkommission Bauaufsicht Juli 2014. **Gilt in Hessen nicht unmittelbar** — nur als Vorlage. | Bauministerkonferenz / IS-ARGEBAU | ✅ Rolle als bloßes Muster belegt (s. nächste Zeile) |
| **H-VStättR** — Hessische Versammlungsstättenrichtlinie | **Das in Hessen tatsächlich einschlägige Regelwerk.** Anwendungsbereich u. a.: Versammlungsstätten im Freien mit Szenenflächen und Freisportanlagen mit Tribünen für **mehr als 1.000 Besucher**. Liefert die Kernparameter für Flucht- und Rettungswegbreiten, Besucherkapazität, Bestuhlungs-/Standflächenpläne. | PDF: https://wirtschaft.hessen.de/sites/wirtschaft.hessen.de/files/2022-01/Hessische%20Versammlungsst%C3%A4ttenrichtlinie%20(H-VSt%C3%A4ttR).pdf<br>Erlassen 03.12.2015 (StAnz), geändert 13.06.2018 und 03.03.2021; als Technische Baubestimmung in die **H-VV TB, Anlage 24** übernommen | 🔧 **Wichtige Korrektur:** In Hessen gibt es **keine** „HVStättVO" und keine unmittelbar geltende MVStättVO — nur die **Richtlinie H-VStättR**. Die Datei `config/regelwerk/he-mvstaettvo-2026.1.json` ist damit **falsch benannt**; die Inhalte müssen gegen die H-VStättR in der aktuellen H-VV TB-Ausgabe geprüft werden. Aktuelle H-VV TB-Ausgabe (2023-09 gesehen) 🔧 noch nicht gegen 2026 verifiziert. |
| **HBO** — Hessische Bauordnung vom 28.05.2018 | **§ 78 Fliegende Bauten**: Bühnen, Zelte, Tribünen, Fahrgeschäfte des Heinerfests sind ganz überwiegend Fliegende Bauten. Anzeige bei der Bauaufsicht des Aufstellungsorts mit Prüfbuch mindestens drei Tage vor Ingebrauchnahme; Ausnahmen u. a. Zelte bis 75 m² Grundfläche, Fliegende Bauten bis 5 m Höhe ohne Besucherbereich, Bühnen inkl. Überdachung bis 5 m Höhe und 100 m² Grundfläche. **§ 73 Abweichungen** für Abweichungen von Technischen Baubestimmungen. | Broschüre HBO 2018: https://wirtschaft.hessen.de/sites/wirtschaft.hessen.de/files/2025-01/hbo_broschuere_stand_juli_2023.pdf<br>Volltext: https://www.rv.hessenrecht.hessen.de | 🔧 Paragrafennummern (§ 78, § 73) und die genannten Schwellenwerte stammen aus Sekundärquellen und dem Broschürentext — **vor jeder Implementierung gegen den amtlichen Volltext in der zum Projektzeitpunkt gültigen Fassung prüfen.** Die HBO wurde am 14.10.2025 novelliert; die verlinkte Broschüre hat Stand Juli 2023. |
| **DIN 14090:2024-02** — Flächen für die Feuerwehr auf Grundstücken | Bestimmt die freizuhaltenden Korridore im Standflächen-Layout. Zufahrt: Fahrbahn **mindestens 3,5 m** Breite. Aufstellfläche für Hubrettungsfahrzeuge: **mindestens 5,5 m × 11 m**. | Ausgabe Februar 2024, 20 Seiten: https://www.dinmedia.de/en/standard/din-14090/374362010 | 🔧 Maße aus Sekundärquellen (DGWZ, Feuertrutz, Baunormenlexikon) — die Norm ist **kostenpflichtig**. Vor Implementierung im Original nachlesen; die Norm kennt Sonderfälle (Kurvenradien, Wendehämmer, Tragfähigkeit), die hier nicht erfasst sind. |
| **HVGG** — Hessisches Vermessungs- und Geoinformationsgesetz | § 18 (Nutzung), § 24 (Kostenfreiheit) — Grundlage der Datenlizenz, s. o. | https://www.rv.hessenrecht.hessen.de | ✅ 07.08.2026 — Paragrafen wörtlich aus den GetCapabilities beider HVBG-WMS zitiert |

⚠ **Eiserne Regel:** Rechtsregeln werden **nie aus dem Gedächtnis** implementiert. Jede in Code gegossene Zahl (Wegbreite, Besucherzahl, Abstand) braucht eine Fundstelle im amtlichen Text und einen Eintrag in `config/regelwerk/`.

---

## Bewusst nicht genutzt

| Quelle | Grund |
|---|---|
| **Google Photorealistic 3D Tiles / Google Earth / Google Maps** | Die Google-Maps-Plattform-Nutzungsbedingungen untersagen das Extrahieren, Ableiten, Zwischenspeichern und **Vermessen** von Inhalten sowie deren Nutzung zur Erzeugung eigener Geodatensätze. Für eine Plattform, die aus der Szene amtliche Maße ableitet und Behördenunterlagen erzeugt, ist das **nicht lizenzkonform**. Es werden weder Geometrien noch Höhen noch Texturen aus Google-Diensten übernommen. Bezug: Google Maps Platform Terms of Service, „Restrictions Against Misusing the Services". 🔧 Konkreter Abschnittsverweis der jeweils gültigen ToS-Fassung noch nachzutragen. |
| **Bing Maps / Mapbox / Apple Maps als Datenquelle** | Gleiche Problematik (abgeleitete Werke, Caching-Verbote) und keine amtliche Geometrie. Als reiner Kartenhintergrund nicht nötig — dafür gibt es basemap.de und die HVBG-Karten. |
| **Nominatim im Produktivbetrieb** | Nutzungsrichtlinie erlaubt kein Bulk-/Produktiv-Geocoding auf der öffentlichen Instanz. Ersatz: amtlicher HVBG-Suchdienst `ogc-free-data.ows` (verifiziert, s. o.). |
| **Screenshot-/Bildschirmvermessung** | Alle Maße kommen aus ALKIS-Geometrie (EPSG:25832), nie aus Bildschirmkoordinaten. |

---

## Weitere Bundesländer

EventPlan3D ist auf Hessen angesetzt, aber die Pipeline ist **landesagnostisch** gebaut: Jedes Bundesland bekommt eine eigene **Konfigurationsdatei** unter `config/laender/<kürzel>.json`. Der Code enthält keine hessenspezifischen URLs.

Vorgesehene Felder je Land (🔧 Schema noch nicht implementiert):

```jsonc
{
  "land": "HE",
  "name": "Hessen",
  "crs": "EPSG:25832",
  "hoehenbezug": "DHHN2016_NH",
  "karteWms":     { "url": "…/ogc-free-maps.ows",   "layerKaskade": ["he_alk", "he_dtk25", "he_dtk50", "he_dtk100", "he_uek200"] },
  "luftbildWms":  { "url": "…/ogc-free-images.ows", "layer": "he_dop20_rgb", "nurCrs": "EPSG:25832" },
  "alkisWfs":     { "url": "…/alkis/vereinf/wfs", "flurstueck": "ave:Flurstueck", "gebaeude": "ave:GebaeudeBauwerk", "format": "gml32", "achsen": "EN" },
  "geocoder":     { "typ": "wfs", "url": "…/ogc-free-data.ows", "featureType": "ms:hako", "strasseFeld": "HA_STR", "hausnrFeld": "HA_HAUSNR", "filter": "PropertyIsLike" },
  "lod2":         { "typ": "downloadcenter", "muster": "https://gds.hessen.de/downloadcenter/<JJJJMMTT>/…" },
  "dgm":          { "typ": "manuell", "format": "geotiff-f32", "hinweis": "kein Direktlink, Selbstentnahme im Downloadcenter" },
  "lizenz":       { "kurz": "HVGG §18/§24", "quellenvermerk": "Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation" },
  "regelwerk":    ["h-vstaettr", "hbo-2018", "din-14090-2024"]
}
```

Pro Land neu zu klären sind mindestens: WMS-/WFS-Endpunkte, das native CRS (25832 west-, 25833 ostdeutsch), das LoD2-Bezugsschema, der Höhenbezug, der **Quellenvermerk-Wortlaut** (der unterscheidet sich je Land erheblich) und das jeweilige Landes-Versammlungsstättenrecht — die MVStättV ist in den Ländern **unterschiedlich** umgesetzt: mal als Verordnung, in Hessen als Richtlinie.

---

---

## Normen und Regelwerke der Bauteilmaße (Stand 10.08.2026)

Diese Werte stehen **als Daten** in `config/bauklassen/de-strassenraum-2026.2.json`
und `config/elementquellen.json`, nicht im Programmtext. Jeder trägt dort eine
`verifikation` mit `status`, `geprueftAm` und `beleg`.

**Alle hier genannten Normen sind kostenpflichtig und lagen nicht im Volltext
vor.** Die Werte stammen aus übereinstimmenden Sekundärquellen; sie tragen
darum durchweg `verifikation.status = "zu_pruefen"`. Wer sie belastbar braucht,
muss den amtlichen Text beschaffen — das ist ausdrücklich **nicht** erledigt.

| Regelwerk | Wofür im Modell | Werte | Status |
|---|---|---|---|
| **EN 14811** (Rillenschienen) | Rillenbreite und Fahrkantenbreite der im Pflaster liegenden Schiene | Rille **36,35 mm**, Fahrkante **55,83 mm** (Profil 60R2) | verifiziert gegen Profiltabellen mehrerer Walzwerke |
| **DIN 18065** (Gebäudetreppen) | zulässiges Stufenmaß, an dem eine Ableitung scheitern darf | Steigung **0,12–0,21 m**, Auftritt **0,26–0,37 m**, Schrittmaß 0,59–0,65 m | zu prüfen (Sekundärquellen) |
| **DIN 18040-3** (Barrierefreiheit, öffentlicher Verkehrsraum) | Geländer an Treppen, beidseitig | Höhe 0,90 m | zu prüfen (Sekundärquellen) |
| **DIN 14090** (Flächen für die Feuerwehr) | lichte Höhe und Breite, die unter einem Bauwerk frei bleiben muss | lichte Höhe **3,50 m**, Breite 3,00 m (3,50 m zwischen Bauteilen), Bewegungsfläche 7 × 12 m | zu prüfen (Sekundärquellen: Merkblatt Berliner Feuerwehr, Landkreis Wittmund, baunetzwissen) |
| **GaV Hessen § 4** (Garagenverordnung, in Kraft seit 22.05.2024) | Rampenneigung einer Tiefgarageneinfahrt | höchstens **15 %**; vor Rampen über 10 % eine mindestens 3 m lange Fläche mit höchstens 5 % | Wortlaut aus Sekundärquellen (haufe.de, bfb-barrierefrei-bauen.de); **die im Modell angesetzten 12 % sind eine Annahme und durch nichts belegt** |
| **GaV Hessen** (lichte Höhe) | Sohle einer Tiefgarage unter der Straße | lichte Höhe **2,20 m** (2,05 m unter Unterzügen) — vorgeschrieben allerdings nur für die Erschließungsbereiche **barrierefreier** Stellplätze | zu prüfen; die Verwendung als untere Schranke für die Geschosshöhe geht über den Wortlaut hinaus, die Geschosshöhe 2,90 m ist eine reine Annahme |
| **RE-ING / ARS** (Brückendurchfahrtshöhe) | Regellichthöhe über Straßen | **4,50 m**, Neubau 4,70 m | zu prüfen (Sekundärquellen); amtlicher Text lag nicht vor |

### OpenStreetMap — welches Merkmal was aussagt

Die drei Abgrenzungen, an denen das Höhenband im ersten Lauf gescheitert ist
(Belege abgerufen 10.08.2026):

- **Key:layer** — „Layer provides absolutely no information about relative or
  absolute height difference." Ein `layer=-1` sagt nur, *was über was* liegt.
  <https://wiki.openstreetmap.org/wiki/Key:layer>
- **Key:covered** — überdeckt, nicht unterirdisch: „covered=yes … usually open
  at least on one side". Eine Arkade ist ein Dach über einem Gehweg.
  <https://wiki.openstreetmap.org/wiki/Key:covered>
- **Key:tunnel**, Wert `building_passage` — eine Durchfahrt **durch** ein Haus
  auf Straßenniveau. <https://wiki.openstreetmap.org/wiki/Key:tunnel>

Belegwerte, die das Modell **übernimmt statt abzuleiten**: `step_count`,
`incline`, `maxheight`, `level`, `gauge`, `embedded`, `surface`.

### Hydro-Flattening — warum das DGM im Wasser nichts misst

Ein Laserscanner bekommt von einer Wasseroberfläche kaum ein Echo zurück; was
ein DGM innerhalb eines Sees führt, ist interpoliert. Im Großen Woog schwankte
es um **1,83 m** und stieg stellenweise **1,1 m über das Ufer** (nachgeprüft am
Luftbild, 09.08.2026). Die Bezeichnung für die übliche Nachbearbeitung lautet
*hydro-flattening*; sie ist in den USGS-LiDAR-Basisspezifikationen definiert und
in den deutschen DGM1-Produkten **nicht durchgängig** angewandt.

### DGM1 ist ein Geländemodell — Brücken stehen darin

Nachgemessen im Pilotgebiet (10.08.2026): Bei **allen 11** Brücken lag die
Geländehöhe darunter exakt auf der Verbindungslinie der Widerlager. Ein
Bauwerk, das im Höhenmodell als Boden steht, kann nichts überspannen — deshalb
gibt das Modell dort **keine** lichte Höhe aus, sondern meldet eine Datenlücke.
Belastbar wäre nur OSM `maxheight` oder ein Höhenmodell mit
Bauwerksfreistellung (bDOM/DOM-Differenz).

---

## Elementquellen — Quellenketten als Daten (`config/elementquellen.json`)

Bisher stand in jedem Importmodul fest verdrahtet, woher ein Baum, eine Laterne
oder eine Bank kommt. Damit war weder prüfbar, ob eine bessere Quelle übergangen
wurde, noch ob die gelieferte Menge überhaupt plausibel ist.

Jetzt führt `config/elementquellen.json` für **10 Elementarten** je eine
**geordnete Kette** — Kataster vor OpenStreetMap vor Klassenannahme — mit der
Güte je Stufe (`gemessen` / `erfasst` / `annahme`). Der Loader weist eine
ungeordnete Kette und eine fehlende `verifikation` beim Start **zurück**; eine
neue Stadt braucht einen Eintrag in dieser Datei und **keinen Programmtext**.

### Ortsgebundene Auszüge sagen ihr Gebiet an

Der eigentliche Fehler beim Ausbau auf den Großen Woog: Ein Baumkataster-Auszug
deckt einen **Ausschnitt** ab, nicht die Stadt. Lag das Zielgebiet daneben,
lieferte der Import still weniger. Jeder Katastereintrag trägt darum jetzt ein
`gebiet` — bei Dateiauszügen `"aus_datei"`, dann wird es beim Laden aus den
enthaltenen Punkten bestimmt und mit dem Zielgebiet verglichen.

Hinterlegt (Stand 10.08.2026): **Darmstadt** (Stadtbäume und Topobäume über
`3d.darmstadt.de`, PlexMap/Cesium-3D-Tiles), **Frankfurt am Main**
(Grünflächenamt), **Offenbach**. Recherchiert und als Kandidaten notiert, aber
noch nicht angebunden: Köln, Bonn, Düsseldorf, Münster, Leipzig, Dresden,
Hamburg, Berlin, München, Stuttgart, Karlsruhe, Mannheim, Wiesbaden, Kassel.

### Abdeckungsprüfung — zwei Fragen, zwei Antworten

1. **Relativ**: Gibt es 250-m-Zellen, die weniger als 25 % der sonst üblichen
   Dichte haben? Das ist der Fingerabdruck eines ortsgebundenen Auszugs, der
   nicht das ganze Gebiet abdeckt.
2. **Absolut**: Liegt die mittlere Dichte unter der Erwartung? Die Erwartung ist
   eine **Annahme** (`verifikation.status = "zu_pruefen"`) und keine Norm; sie
   sagt nur, dass jemand hinsehen sollte.

Beides steht in der Ebenen-Anzeige als **Datenlücke** über dem
Quellennachweis — dort, wo es jemand sieht, bevor er den Plan weitergibt. Im
Pilotgebiet meldet der Import z. B.: „Baum: 1 von 17 Zellen (250 m) haben
weniger als 25 % der üblichen Dichte — betroffen sind 9,4 ha Bezugsfläche.
Üblich sind 105,6 Baum/ha, dort sind es 9,3."

### Flächenangabe für ortsgebundene Auszüge

Ein Auszug, der 40 % des Gebiets abdeckt, ist keine Fehlmenge, sondern ein
Auszug — solange **dabeisteht**, welche Fläche er abdeckt. Genau diese Angabe
macht `extraktGebiet()`, und sie steht im Quellennachweis.


---

## Änderungsprotokoll

| Datum | Was |
|---|---|
| 10.08.2026 | Normen der Bauteilmaße (EN 14811, DIN 18065, DIN 18040-3, DIN 14090, GaV Hessen, RE-ING) als Daten mit Verifikationsstatus erfasst — **alle kostenpflichtig, keiner im Volltext geprüft**. OSM-Schlüssel `layer` / `covered` / `tunnel` belegt abgegrenzt. Quellenketten für 10 Elementarten nach `config/elementquellen.json` ausgelagert, Baumkataster Darmstadt/Frankfurt/Offenbach mit Gebietsangabe. Befund: DGM1 führt Brückenbauwerke als Boden — 0 von 11 Brücken mit messbarer lichter Höhe. |
| 07.08.2026 | Erstfassung. Verifiziert: beide HVBG-WMS (GC), DOP20-GetMap, ALKIS-vereinfacht-WFS (GC), LoD2-Downloadlink (Range-GET), basemap.de-WMS (GC). Neu entdeckt und verifiziert: **amtlicher HVBG-Suchdienst** `ogc-free-data.ows` (ersetzt Nominatim). Negativbefund DGM1 bestätigt und um MetaVer-/Downloadcenter-Prüfung erweitert. Korrekturen: basemap.de ist primär **CC BY 4.0** (nicht dl-de/by-2-0); Hessen hat **keine** Versammlungsstättenverordnung, sondern die **H-VStättR**. |
