# Bauwerksmodell — echte Höhen und Tiefen in der 3D-Welt

Entwurf vom 09.08.2026. Anlass: Nutzerbefund anhand von Bildschirmabzügen —
„hier funktioniert zu viel nicht … das sind immer grundlegende Probleme … wenn du
das besser machst, dann muss es überall besser sein … wir haben keine echten
Tiefen und echten Höhen, das muss sehr genau sein für spätere Simulationen".

Dieses Dokument beantwortet **nicht**, wie einzelne Fehler zu beheben sind. Es
beschreibt, warum die bisherige Bauweise diese Fehler zwangsläufig erzeugt, und
welches Modell an ihre Stelle tritt.

---

## 1. Befund — nachgemessen am Datenstand `gel_06b04a365922bbc1`

| Messung | Wert | Folge |
|---|---|---|
| Maschenweite des Höhengitters | **4,69 × 5,21 m** (65 × 65 Punkte je 300-m-Kachel) | Alles, was schmaler ist als 4,7 m, existiert im Gelände nicht: Bordstein, Stufe, Grabenkante, Bahnsteigkante, Böschung, Rampe. |
| Quelle der Höhen | DGM1 (1-m-Raster, 369.000 Punkte) — beim Import **auf 4,7 m umgerechnet** und dabei invers-distanzgewichtet über 8 Nachbarn geglättet (`dgmImportieren`, `HoehenFeld`) | Die amtliche Genauigkeit wird beim Einlesen weggeworfen. Das 1-m-Raster liegt vor (349 MB im Cache), wird aber nie gespeichert. |
| Größter Höhensprung im Gitter | 5,41 m auf 4,69 m | Der Schlossgraben ist nur noch eine Rampe. Eine 17-cm-Stufe ist mathematisch nicht darstellbar. |
| Höhenlage der Bodenflächen | 0,020–0,092 m über Gelände, gestaffelt in **2-mm-Schritten je Rang** (`palette.FLAECHEN_STIL`) | Fahrbahn und Gehweg liegen praktisch auf derselben Höhe. Der Unterschied ist Farbe, nicht Geometrie. |
| Kartierte Bordsteine | **16 Stück, 556 m** im ganzen Gebiet, alle mit Einheitshöhe 0,12 m | Bordsteine gibt es nur dort, wo OSM zufällig `barrier=kerb` führt. Die restlichen ~40 km Straßenkante haben keine Kante. |
| Treppenflächen | **137** — als flache, eingefärbte Polygone | Es gibt im Modell keine einzige Stufe. Für eine Fluchtwegrechnung ist eine Treppe damit eine Ebene. |
| Gleise | **73 Teilstücke**, 6.064 m, Median 55,6 m, kürzestes 3,6 m | Jeder OSM-Way wird für sich gezeichnet. |
| Gleisenden, die deckungsgleich auf einem anderen Gleisende liegen | **95 Paare von 146 Enden** | 95 der 146 Enden sind künstliche Schnitte. Genau das sieht man als „Schienen brechen einfach ab". |
| Als Rillenschiene erkannt | **73 von 73** (`eigenerBahnkoerper=false`) | Es wird derzeit **nirgends** ein Oberbau gezeichnet — weder Bett noch Schwelle. Übrig bleiben zwei 10 cm breite helle Streifen 12 mm über dem Belag. |

**Der gemeinsame Nenner:** Die Welt ist kein Körper, sondern ein **Stapel bemalter
Folien** über einem geglätteten Gelände. Jede Folie liegt 2 mm über der
darunterliegenden. Wo zwei Folien gleich hoch sind, flimmert es; wo das Gelände
zwischen zwei Stützpunkten durchstößt, entstehen die Farbflecken; wo eine Folie
endet, bricht das Bauwerk ab.

## 2. Warum Einzelkorrekturen das nicht beheben können

Die bisherigen Reparaturen — Ringverdichtung auf 2 m, Sehnenfehler-Ausgleich,
Höhenstapel-Tabelle, Rillenschiene 12 mm statt 5 mm über dem Sockel — sind
allesamt richtig gerechnet und behandeln alle **dasselbe** Symptom: einen
Millimeter-Wettstreit zwischen Flächen, die eigentlich unterschiedlich **hoch**
sein müssten. Solange Fahrbahn und Gehweg beide auf dem Gelände liegen, muss man
sie mit 2 mm auseinanderhalten, und jeder Interpolationsfehler von 6 cm frisst
diese 2 mm auf.

Die Lösung ist nicht, die Millimeter besser zu verwalten. Die Lösung ist, dass
ein Gehweg **12 cm höher liegt als die Fahrbahn** — dann trennt sie die
Wirklichkeit, nicht ein Zeichentrick.

## 3. Das Modell — vier Ebenen, eine Wahrheit

Alle vier Ebenen liegen in `shared/`, laufen also unverändert im Server, im
Browser **und** in der Regelprüfung. Das ist dieselbe Entscheidung wie beim
Geometrie-Kern (ARCHITEKTUR.md, 1) und aus demselben Grund: Was der Editor
zeigt, muss das sein, was die Simulation rechnet.

### Ebene 0 — Urgelände (`Hoehenraster`)

Das gewachsene Gelände als **echtes Raster in Originalauflösung**: 1 m, im
Kernbereich 0,5 m. Gespeichert als binäres `Float32Array` mit Kopfsatz
(Ursprung, Zellgröße, Spalten, Zeilen) — **nicht** als JSON-Zahlenmatrix. Ein
1-km²-Gebiet sind 1 Mio. Zellen = 4 MB binär gegen rund 30 MB JSON-Text.

Dazu **Bruchkanten** (`breaklines`): Linien, an denen die Oberfläche einen Knick
oder Sprung hat — Bordsteinkante, Mauerfuß, Grabenkante, Bahnsteigkante,
Treppenwange. Ein Raster allein kann eine senkrechte Kante nicht führen, egal wie
fein es ist. Bruchkanten sind der Grund, warum Vermessung mit Dreiecksnetzen
arbeitet und nicht mit Rastern allein.

Ergebnis: statt eines Gitters wird ein **eingeschränktes Dreiecksnetz** gebaut
(Raster + Bruchkanten als Zwangskanten). Die Fläche darf dann an einer Kante
springen — ohne das ist eine 17-cm-Stufe grundsätzlich nicht darstellbar.

### Ebene 1 — Konstruktionshöhe (`Bauklasse`)

Jede Nutzungsfläche bekommt eine **Bauklasse** mit einer Höhenlage relativ zur
Bezugsfläche des Straßenraums, nicht zum Gelände:

```
Fahrbahn          ± 0,00 m   (Bezugsfläche)
Radweg            + 0,00 … + 0,12 m   (je nach Führung; Datenlage entscheidet)
Gehweg            + 0,12 m   Regelbordhöhe
Platz/Zone        + 0,12 m   (niveaugleich ausgebaut: ± 0,00, dann mit Rinne)
Bahnsteig Tram    + 0,24 m   (Kap) bzw. + 0,30 m
Gleistrog         − 0,03 m   Rillentiefe an der Fahrkante
Wasserfläche      Spiegel + Sohle (zwei Höhen, siehe unten)
Treppe            Lauf aus n Stufen zwischen zwei Höhen
```

**Die Zahlen sind hier Platzhalter und werden wie das Regelwerk behandelt:** als
versionierte Daten in `config/bauklassen/*.json`, jede mit Quelle (RASt 06,
EAÖ, BOStrab, DIN 18040-3) und `verifikation.status`. Nichts davon wird aus dem
Gedächtnis implementiert — dieselbe eiserne Regel, die für die H-VStättR gilt.

### Ebene 2 — Die Kante ist ein **Ergebnis**, keine Eingabe

Der entscheidende Satz des ganzen Entwurfs.

Heute wird ein Bordstein gezeichnet, wenn OSM einen führt (16 Mal). Künftig
entsteht ein Kantenkörper **überall dort, wo zwei benachbarte Flächen
unterschiedliche Konstruktionshöhen haben** — automatisch, aus der Geometrie:

- Δh ≤ 3 cm → Fuge (Rinne, Materialwechsel)
- 3 cm < Δh ≤ 30 cm → **Bordstein / Kante** mit Anlauf
- 30 cm < Δh ≤ 3 m → **Böschung oder Stützmauer** (je nach Platz: passt die
  Regelneigung zwischen die Flächen, wird geböscht, sonst gemauert)
- Δh > 3 m → Bauwerk (Mauer, Widerlager) — braucht Daten, wird nicht geraten

Damit hat jede Straße im gesamten Gebiet ihre Kante, nicht nur 556 m davon. Und
dieselbe Regel erzeugt Treppenwangen, Bahnsteigkanten, Grabenränder und
Beetkanten. **Eine Regel, überall.**

### Ebene 3 — Bauwerke als Querschnitt × Achse (`Profil`)

Alles Langgestreckte wird künftig gleich gebaut: ein **Querschnittsprofil** —
eine Kette aus (Querversatz q, Höhe z, Werkstoff) — wird entlang einer Achse
extrudiert. Ein einziger Extruder ersetzt den Sondercode für Gleisbett,
Schwellen, Schiene, Bordstein, Mauer, Zaun, Bahnsteig, Rinne, Rampe.

Für die Gleise heißt das konkret **zwei Profile statt eines Schalters**:

*Rillenschiene im Straßenraum* (Ph 37a o. ä.): Fahrkante, **Rille** (die
Vertiefung ist der Grund, warum man ein eingelassenes Gleis überhaupt sieht),
Schienenkopf bündig im Belag, beidseits der Anschlussstreifen des Belags. Kein
Bett, keine Schwelle — die gibt es dort wirklich nicht.

*Schotteroberbau auf eigenem Bahnkörper*: Bettungstrapez mit echter Böschung,
Schwelle als **Körper** (heute: ein flaches Viereck, also ein Aufkleber),
Vignolschiene mit Fuß/Steg/Kopf.

Dazwischen gibt es **Übergangsstücke** an den Knoten, an denen die Bauart
wechselt — heute springt sie hart an einer OSM-Way-Grenze.

Dasselbe Verfahren trägt später Rampen, Treppen (Profil = Stufe, wiederholt),
Rinnen, Leitplanken, Bahnsteigkanten.

### Ebene 4 — Netz statt Einzelwege (`Netz`)

OSM liefert Knoten-IDs mit. Sie werden bislang weggeworfen. Künftig:

1. **Graph bauen** — gleiche Knoten-ID = derselbe Knoten. Das ist exakt, kein
   Abstandsraten.
2. **Stränge bilden** — über jeden Knoten mit Grad 2 hinweg zusammenfassen. Aus
   73 Teilstücken werden die tatsächlichen Strecken; die 95 künstlichen Schnitte
   verschwinden, weil sie im Graph gar nicht existieren.
3. **Weichen und Kreuzungen** sind Knoten mit Grad ≥ 3 und bekommen ein eigenes
   Bauteil (Herzstück, Zungenvorrichtung) statt zweier sich durchdringender
   Bänder.
4. **Achsglättung** über den Strang: Kreisbogen/Klothoide mit Mindestradius statt
   Polygonzug. Eine Straßenbahnkurve mit 25 m Radius hat in OSM oft drei
   Stützpunkte — als Polygonzug knickt sie sichtbar.

Das Netz ist zugleich die Datengrundlage der Simulation: Kanten mit Länge,
Steigung, lichter Höhe und Breite. Der Vadere-Export bekommt damit erstmals
echte Steigungen und Stufen statt einer Ebene.

### Vertikale Lagen — Brücken, Tunnel, Unterführungen

`layer`, `bridge`, `tunnel`, `level` aus OSM ergeben je Bauwerk ein **Höhenband**
(Oberkante **und** Unterkante). Heute werden Tunnel verworfen (`stadtdetails.ts`)
und Brücken auf Geländehöhe gemalt. Künftig: Brücke mit Widerlager, Überbau und
lichter Höhe darunter; Unterführung mit Portal und Sohle. Das ist der Teil, den
der Nutzer „echte Tiefen" nennt — und es ist zugleich die Grundlage dafür, dass
eine Feuerwehrzufahrt unter einer Brücke ihre lichte Höhe **aus dem Modell**
bekommt statt aus einem Eingabefeld.

## 4. Was dadurch wegfällt

- Der gesamte Millimeter-Höhenstapel (`palette` rang × 2 mm, `verkehr.BODEN_STAPEL_M`,
  `darstellung.PLAN_*`). Flächen stoßen künftig an Kanten aneinander, statt sich
  zu überlagern. Kein Z-Fighting mehr, weil es keine koplanaren Flächen mehr gibt.
- `verdichteRing` / `verdichte` als Notbehelf: das Netz wird gegen die Kanten des
  Geländenetzes verschnitten, nicht darüber drapiert.
- Der Sonderfall-Code je Bauteil in `verkehr.ts` (rund 1.200 Zeilen) —
  ersetzt durch Profile als Daten.
- Die Heuristik `eigenerBahnkoerper` als Ja/Nein-Schalter für ein ganzes
  Teilstück; die Bauart wird abschnittsweise am Netz geführt.

## 5. Umsetzung in Stufen, jede für sich prüfbar

| Stufe | Inhalt | Prüfkriterium |
|---|---|---|
| 1 ✅ | `Hoehenraster` binär, DGM1 in 1 m durchreichen, Bruchkanten-Datenstruktur | Querschnitt zeigt die echte Tiefe (siehe Ergebnis unten) |
| 2 ✅ | `Bauklassen` als versionierte Daten + Konstruktionshöhen | Gehweg liegt messbar 12 cm über der Fahrbahn |
| 3 ✅ | Kantenregel (Ebene 2) | Bordsteinlänge im Gebiet steigt von 556 m auf die tatsächliche Straßenkantenlänge |
| 4 | `Profil`-Extruder + zwei Gleisprofile | Rillengleis in der Rheinstraße und Schotteroberbau sehen unterschiedlich und beide richtig aus |
| 5 | `Netz` mit Strangbildung und Weichen | 73 Teilstücke → durchgehende Stränge, 0 künstliche Schnitte |
| 6 | Vertikale Lagen (Brücke/Tunnel/Treppe als Körper) | 137 Treppenflächen werden zu Läufen mit Stufen |
| 7 | Regel-Engine und Vadere-Export lesen Höhen und Netz | Rettungsweglänge berücksichtigt Steigung; Vadere bekommt Stufen |

Stufen 1–3 sind die Grundlage; ohne sie ist jede weitere Stufe wieder ein
Zeichentrick. Stufe 4–5 ist das, was der Nutzer an den Schienen sieht.

## 6. Ergebnis Stufe 1 (09.08.2026, umgesetzt und nachgemessen)

Gelände `gel_ad45e0355427cc23`, Pilotgebiet Darmstadt.

| Messung | vorher | nachher |
|---|---|---|
| Höhenauflösung | 4,69 × 5,21 m (76.050 Stützstellen) | **1,00 m** (1.478.400 Zellen) |
| Speicherform | Zahlen im Gelände-JSON | eigene Binärdatei `hoehen.bin`, 5,64 MB |
| Geländenetz | 98.000 Dreiecke, gleichmäßig | **282.430 Dreiecke, fehlergesteuert** — fein an Kanten, grob in der Ebene |
| Querschnitt an der steilsten Stelle (474815/5524637) | 138,8 → 136,5 m (sanfter Hang) | **138,9 → 132,4 m** (echte 6,4-m-Kante) |
| Verhältnis gezeichnete zu gerechneter Fläche | zwei getrennte Auswertungen | **dieselbe Fläche** (`GelaendeFlaeche.hoeheBei`) |

Zur **Dateigröße**: Die ursprüngliche Erwartung „kleiner als heute" war falsch und wird
hier korrigiert. Bei 19-facher Auflösung wird die Datei größer — 5,64 MB binär gegen
0,5 MB für das grobe Gitter. Der Gewinn liegt woanders: dieselben Werte als JSON wären
rund 10 MB Text, die der Browser zeichenweise zerlegen müsste; als Binärdatei holt er
sie in einem Stück und legt eine `Float32Array` darüber. Die Gelände-Datei selbst ist
dabei von 11,1 auf 9,4 MB **geschrumpft**, weil die Höhen aus ihr heraus sind.

Neu und geprüft: `shared/geo/raster.ts`, `shared/geo/gelaendenetz.ts`,
`server/geodata/geotiff.ts` (LZW + Prädiktor, gegen die amtliche Kachel verifiziert),
`server/geodata/dgm.ts`. Gefundener und behobener Fehler beim Bau: Die Bintree-Zerlegung
startete mit einer Kathete als Hypotenuse — dadurch entstanden entartete Dreiecke und
331 m² Löcher je Kachel. Nachgemessen ist das Netz jetzt dicht (Fläche exakt, jede
Innenkante genau zweimal belegt, keine Mehrfachkanten).

## 7. Ergebnis Stufe 2 und 3 (09.08.2026, umgesetzt und nachgemessen)

Gelände `gel_28cbf2d861bb2cf2`.

| Messung | vorher | nachher |
|---|---|---|
| Höhenlage der Bodenflächen | 2,0–9,2 cm, gestaffelt in 2-mm-Rangstufen | **Konstruktionshöhe der Bauklasse** — Fahrbahn 0, Gehweg/Platz 12 cm, Radweg/Weg 6 cm |
| Flächen mit Höhe | — | 2.074 von 2.225 (die übrigen 151 sind Wasser und Treppen, die **keine eine** Höhe haben) |
| Bordsteine | 16 Stück, **556 m** (nur wo OSM sie führt) | **1.175 Stück, 38.987 m** — abgeleitet, nicht erfasst |
| Bezugsniveau der Körper | pauschal: Boden 0,02–0,09 / Verkehr 0,10 / Plan 0,30 m | **eine** Auskunft: `hoehen.bauOben()` — Gelände plus Aufbau der Fläche, auf der man steht |
| Bildrate (1,33 Mio. Geländedreiecke, Altstadtblick) | — | 3,5 ms je Bild (≈ 280 fps) — die Auflösung kostet nichts |

**Die entscheidende Messung** betraf die Gefahr, die Stufe doppelt zu zählen: Das DGM1 ist
ein *Gelände*modell und enthält Fahrbahn und Gehweg. Wäre die Bordsteinstufe darin schon
abgebildet, würde die Konstruktionshöhe sie ein zweites Mal aufschlagen. Gemessen über alle
gefundenen Kanten (DGM links gegen DGM rechts): **Median −0,2 cm**. Das Höhenmodell trägt
von der Stufe also nichts — bei 1 m Maschenweite gegen 15 cm Kantenbreite auch nicht zu
erwarten. Die Konstruktionshöhe wird deshalb voll aufgelegt. Der Messwert läuft weiter im
Auftragsprotokoll mit: Käme später ein feineres Modell, das die Stufe selbst trägt, müsste
abgezogen statt aufgedoppelt werden.

Neu: `config/bauklassen/de-strassenraum-2026.1.json` (jede Zahl mit Fundstelle und
`verifikation.status`; fünf Werte stehen ausdrücklich als **Annahme** drin, weil RASt 06
nicht vorliegt), `server/geodata/bauwerk.ts`, `shared/geo/bauhoehe.ts`,
`web/src/scene/kanten.ts`.

**Nicht in dieser Stufe erledigt:** Treppen und Wasserflächen tragen zwar Angaben in den
Bauklassen (Stufenmaß 17/29 cm, Spiegel und Sohle), bekommen aber noch keine Körper — die
137 Treppenflächen sind weiterhin ebene Flächen. Das ist Stufe 6.

## 8. Ergebnis Stufe 4 und 5 (09.08.2026, umgesetzt und nachgemessen)

| Messung | vorher | nachher |
|---|---|---|
| Gleisführung | 75 Einzelstücke, jedes für sich gezeichnet | **41 durchgehende Stränge**, 34 künstliche Schnitte geheilt, **19 Weichen/Kreuzungen** als solche erkannt |
| Querschnitt | flaches Bett + flache Vierecke als „Schwellen" + 10-cm-Streifen | **zwei echte Profile**: Rillenschiene mit Rille im Belag (5.599 m) und Schotteroberbau mit Bettungstrapez, Vignolschiene und **1.071 Schwellen als Körper** (664 m) |
| Kurven | Polygonzug (sichtbare Knicke) | Chaikin-Glättung innerhalb der eigenen konvexen Hülle — die Achse wandert nie neben die Trasse |
| Aufwand | — | 149.236 Dreiecke, Aufbau 1,9 s |

Neu: `shared/geo/netz.ts` (Topologie), `shared/geo/profil.ts` (Extruder — trägt künftig
auch Bordstein, Rinne, Rampe, Treppenlauf), `shared/bau/oberbau.ts` (Maße mit
Verifikationsstatus), `web/src/scene/gleise.ts`.

**Ein Befund, der eine Entscheidung braucht:** Maßstabstreue macht das Gleis *unauffälliger*,
nicht auffälliger. Der alte Streifen war 10 cm breit und hell; die wirkliche Fahrkante ist
5,6 cm, die Rille 4,2 cm. Aus 50 m Entfernung ist das unter einem Bildpunkt. Die Geometrie
ist jetzt richtig — die Lesbarkeit ist damit aber schlechter geworden. Kartografie löst das
über eine Mindestzeichenbreite (Straßen werden in jeder Karte breiter gezeichnet als
maßstäblich). Diese Entscheidung gehört dem Auftraggeber, nicht dem Programm: entweder
maßstabstreu (richtig für die Simulation, schwer zu sehen) oder mit einer ausgewiesenen
Mindestbreite fürs Auge, die dann als Zeichenhilfe gekennzeichnet ist und **nie** in eine
Messung eingeht.

## 9. Ergebnis Stufe 6 — Treppen (09.08.2026, umgesetzt und nachgemessen)

| Messung | vorher | nachher |
|---|---|---|
| Treppenflächen | 172 ebene, eingefärbte Polygone | **85 Läufe mit 751 Stufen** als Körper |
| als Podest/Rampe erkannt | — | 87 (unter 30 cm Steigung — dort wäre eine Treppe erfunden) |
| höchster Lauf | — | **6,93 m auf 29 m Länge, 41 Stufen** |
| Aufwand | — | 92 ms |

Die Stufenzahl folgt der **gemessenen** Höhendifferenz aus dem Geländemodell — an welchem
Ende die Treppe oben ist, wird also ermittelt und nicht geraten. Das Stufenmaß (17 cm)
bleibt eine Annahme der Bauklassen; OSM führt `step_count` nur selten, und vermessen hat
die Treppen niemand. Die Laufrichtung kommt aus der Hauptträgheitsachse der Fläche, nicht
aus der längsten Kante: Treppenpolygone sind oft in viele kurze Kanten zerlegt, und dann
zeigt die längste Kante quer statt längs.

Neu: `shared/bau/treppe.ts`, `web/src/scene/treppen.ts`.

**Noch offen in Stufe 6:** Wasserflächen haben ihren Spiegel (aus dem Import), aber noch
keine Sohle — ein Bach liegt weiterhin auf dem Ufer statt darin. Brücken und Tunnel tragen
ihr Höhenband noch nicht; Tunnel werden beim Import weiterhin verworfen.

## 10. Offen — zu belegen, bevor es implementiert wird

- Regelbordhöhe, Rillentiefe, Bahnsteighöhen, Schwellenmaße, Böschungsneigungen:
  jede Zahl braucht eine Fundstelle (RASt 06, EAÖ, BOStrab §, DIN 18040-3). Bis
  dahin stehen sie als `zu_pruefen` in den Bauklassen-Daten und werden in der
  Oberfläche als Annahme gekennzeichnet — wie beim Regelwerk.
- Ob das DGM1 für das gesamte Zielgebiet in 1 m vorliegt (Darmstadt: ja, im
  Cache; andere Kreise: zu prüfen).
- Ob die Bruchkanten aus ALKIS (`Bauwerke`, `Böschung`, `Mauer`) verfügbar sind
  oder aus dem DGM abgeleitet werden müssen (Kantenerkennung im Raster).

---

## 8. Nachtrag 09.08.2026 — vier Ursachen aus dem erweiterten Gebiet

Beim Ausbau auf Innenstadt + Mathildenhöhe (1,81 km², bbox 474700/5524150 –
476510/5525150) wurden vier Fehler sichtbar. Alle vier waren **Ursachen**, keine
Symptome; alle sind an der Wurzel behoben und nachgemessen.

### 8.1 Erfundenes Gelände außerhalb des Gebiets

**Befund:** 217 m nördlich und 114 m östlich der Gebietskante lag Gelände — eben,
auf 162,5 m, ohne jede Struktur. Das ist die *Ersatzhöhe* (Mittelwert), nicht eine
Messung.

**Ursache:** Die Kacheln sind quadratisch und am Raster ausgerichtet (die
Bintree-Teilung verlangt gleiche Schenkel), also 8 × 256 m = 2048 m breit bei
1810 m Gebiet. Das Höhenraster wurde aber nur für das GEBIET + 60 m gebaut. Im
Überhang lieferte `hoeheOder(...)` folglich die Ersatzhöhe.

**Behebung:** `kachelHuelle()` (shared/geo/gelaendenetz.ts) bestimmt die Hülle auf
einem **global verankerten** 256-m-Raster; das Höhenraster wird für diese Hülle
angefordert, nicht für das Gebiet. Nachgemessen: Rasterausdehnung und Kachelhülle
sind deckungsgleich (474624/5523968 – 476672/5525248, 2048 × 1280 Zellen à 1 m).
Der Saum von 76–182 m trägt jetzt echtes DGM1-Relief.

*Nebenwirkung mit Absicht:* Weil das Kachelraster global verankert ist, stoßen
zwei benachbarte Importe kantengenau aneinander — Voraussetzung für das
Zusammensetzen größerer Gebiete.

### 8.2 Objekte, die das Gebiet nur berührten, kamen in voller Länge mit

**Befund:** 174 von 2060 Flächen ragten über das Gebiet hinaus, die längste um
**863 m**. Außerhalb des Geländes lagen sie auf der Ersatzhöhe und standen als
schwebende helle Bänder in der Luft.

**Ursache:** ALKIS und OSM liefern GANZE Objekte, sobald ihre Geometrie die Bbox
schneidet. Beschnitten wurde nie.

**Behebung:** `amGebietSchneiden()` schneidet die Bodenflächen, 
`linienAmGebietSchneiden()` die Linienobjekte am bestellten Gebiet ab. Gebäude
werden bewusst NICHT geschnitten — eine Straße ist eine Oberfläche und darf an
der Kante enden, ein halbiertes Gebäude wäre eine Falschaussage. Nachgemessen:
Überstand 863 m → 18 m (8 Flächen mit entarteten Ringen, die der Schnitt
unverändert durchlässt), Linien 0 m.

### 8.3 Der Seegrund stand im Wasser

**Befund:** Im Großen Woog schwankte das Gelände innerhalb der ALKIS-Wasserfläche
um **1,83 m** und stieg stellenweise 1,1 m über das Ufer — sichtbar als weiße
Erhebung mitten im See. Das amtliche Luftbild zeigt dort offenes Wasser.

**Ursache:** Ein Laserscanner bekommt von Wasser kaum ein Echo. Was das DGM1
innerhalb eines Gewässers führt, ist interpoliert, nicht gemessen.

**Behebung:** `wasserEinebnen()` legt jede Gewässerfläche im **Höhenmodell** auf
ihren Wasserspiegel (Hydro-Flattening) — nicht in der Zeichnung, damit Gebäude,
Bäume und jede spätere Simulation dieselbe Oberfläche sehen. Der Spiegel kommt
aus dem Ufer: ruhendes Gewässer waagerecht auf das untere Viertel der
Uferhöhen, Wasserlauf über eine ausgeglichene Ebene durch das untere Drittel
(dann folgt sie dem Gefälle). Unterschieden wird über die Gedrungenheit
4πA/U² < 0,15. Nachgemessen im Woog: 5-, 50- und 95-Prozent-Wert alle 156,63 m.

### 8.4 Die Wasseroberfläche hing zwischen den Ufern durch

**Befund:** Selbst nach 8.3 blieben helle Zacken im See.

**Ursache:** Die Wasserfläche bekam ihre Höhen an den RINGPUNKTEN, also am Ufer
(Spanne 2,17 m), und Cesium spannt das Innere linear dazwischen. Zwischen zwei
verschieden hohen Ufern sackt die Fläche durch — bis unter den eingeebneten
Seegrund, der dann durchsticht. Ausgeschlossen wurden vorher durch Einzeltests:
das Loch in der Fläche, die Ringverdichtung und die Triangulierung selbst — alle
drei zeichnen fehlerfrei.

**Behebung:** Der Wasserspiegel wird beim Import an der Fläche vermerkt
(`GelaendeFlaeche.wasserspiegelM`) und die Fläche als EBENE gezeichnet.

Zusätzlich `NETZ_TOLERANZ_M` 8 cm → **2 cm**: die Toleranz muss unter dem
kleinsten Höhenversatz der Bodenstaffel (2,0 cm) liegen, sonst sticht das
vereinfachte Gelände grundsätzlich durch die Bodenflächen. Speicherbedarf im
Browser danach 159 MB.

### 8.5 Offen

- **`maxFeatures: 800`** in `config/geodata.hessen.json` kappt den ALKIS-Abruf
  still: der Import holte genau 800 Flurstücke für 1,81 km². Richtig wäre
  Seitenabruf (`startIndex`) oder Kachelung, bis die Antwort unter der Grenze
  liegt. Betrifft die Flurstücksebene, nicht die 3D-Welt.
