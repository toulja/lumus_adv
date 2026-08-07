# Abnahmeprotokoll Phase 1 — EventPlan3D, Pilot „Heinerfest Darmstadt"

## 1. Gegenstand und Rahmen der Prüfung

| | |
|---|---|
| **Geprüft** | Die zehn Abnahmekriterien aus **Kapitel 12 des Lastenhefts**, end-to-end gegen den laufenden Server |
| **Prüfmittel** | `scripts/abnahme.ts` (59 einzelne Prüfpunkte, verteilt auf die 10 Kriterien) |
| **Durchgeführt am** | **07.08.2026, ca. 11:29 Uhr MESZ** |
| **Prüfling** | API `http://127.0.0.1:4720` (Server lief während des Laufs), Node ≥ 22.6 |
| **Angelegtes Testprojekt** | `prj_5bff82ddbf7d92a4` — „Heinerfest 2027", 30.000 Besucher, Zeitraum 01.–05.07.2027 |
| **Ergebnis** | **59 von 59 Prüfpunkten bestanden. Alle zehn Kriterien BESTANDEN. Exit-Code 0.** |

### Geprüfte Datenstände

**Regelwerk** — `config/regelwerk/he-mvstaettvo-2026.1.json`

| Feld | Wert |
|---|---|
| `id` | `he-mvstaettvo` |
| `version` | **2026.1** |
| `stand` | 2026-08-07 |
| `bezeichnung` | „Startregelsatz Hessen – Versammlungsstätten im Freien" |
| Regeln | **23** (R-001 … R-023) |
| davon `verifikation.status = "verifiziert"` | **17** |
| davon `verifikation.status = "zu_pruefen"` | **6** (siehe Abschnitt 4) |
| Quellenverzeichnis | 7 Einträge: MVStättVO, BayVStättV, H-VStättR, MRFlFw, DIN 14090, HBO, HLFS-Merkblatt |
| Haftungshinweis | 2.247 Zeichen, im Konformitätsbericht abgedruckt |

> **Rechtsstatus laut Regelwerksdatei:** In Hessen gilt **keine eigene Versammlungsstättenverordnung**. Maßgeblich ist die **Hessische Versammlungsstättenrichtlinie (H-VStättR)** vom 03.12.2015, heute Anhang HE 10 zu lfd. Nr. A 2.2.2.4 der H-VV TB. Die Zahlenwerte wirken über die H-VV TB und über Auflagen der Genehmigungsbehörde, nicht kraft unmittelbar geltender Landesverordnung. Für Märkte und Straßenfeste ohne Tribünen (das ist der Regelfall Heinerfest) ist der Anwendungsbereich der H-VStättR nach § 1 Abs. 1 Nr. 2 in der Regel **nicht** eröffnet; einschlägig sind dann HLFS-Merkblatt, HBO § 5 und MRFlFw, und die § 7-Werte wirken nur als Bemessungsorientierung.

**Objektbibliothek** — `shared/library/objekttypen.json`

| Feld | Wert |
|---|---|
| `version` | **1.0.0** |
| `stand` | 2026-08-07 |
| Objekttypen | **54** |
| Kategorien | gastronomie, verkauf, fahrgeschaeft, buehne, zelt, sanitaer, infrastruktur, einsatz, absperrung, moeblierung |

**Gelände** — `gel_83209f27a083ee94` „Heinerfest Darmstadt"

| Feld | Wert |
|---|---|
| Koordinatensystem | **EPSG:25832** (ETRS89 / UTM 32N) |
| Gebiet | E 474.700–475.900 / N 5.524.150–5.525.150 = **1.200 m × 1.000 m = 1,20 km²** |
| LoD2-Gebäude | **2.563** |
| ALKIS-Flurstücke | **800** (vereinfachtes Modell, ohne Eigentümerangaben) |
| Luftbildkacheln | **12 von 12** mit DOP20-Textur |
| Geländehöhen | **136,12 – 168,36 m ü. NHN** (Spanne 32,2 m) |
| `hoehenHerkunft` | **`lod2_interpoliert`** — siehe Einschränkung 4.3 |
| Quellennachweis | 4 Einträge, alle mit Abrufzeitpunkt 2026-08-07T08:36:38Z |

Quellennachweis im Detail (wird in der Oberfläche und in den PDF-Berichten geführt):

1. **3D-Gebäudemodell LoD2** — CityGML, © HVBG, Datenlizenz Deutschland – Zero 2.0, CRS `urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH`
2. **Geländehöhen** — abgeleitet aus LoD2-Bodenhöhen (Attribut `AbsoluteHoehe`), © HVBG, dl-de/zero-2-0
3. **Digitale Orthophotos DOP20** — WMS `he_dop20_rgb` (EPSG:25832), © HVBG, Open Data
4. **ALKIS Liegenschaftskarte (vereinfachtes Modell)** — WFS `ave:Flurstueck`, © HVBG, dl-de/zero-2-0

---

## 2. Die zehn Kriterien im Einzelnen

### Kriterium 1 — BESTANDEN (10/10)

> **Wortlaut:** „Gebiet in Darmstadt laden — 3D-Gelände mit realen Höhen und Luftbild, Quellennachweis sichtbar"

**Was der Test tut:** Lädt die Geländeliste, holt das Gelände im Volldatensatz und misst Gebäudezahl, Anteil der Gebäude mit echter Traufhöhe, Höhenspanne, Texturabdeckung, Flurstückszahl und Vollständigkeit des Quellennachweises. Anschließend lädt er eine echte Luftbildkachel über die API. Zum Schluss durchsucht er das reale Stadtgebiet rasterförmig nach der größten bebauungsfreien Fläche und dem längsten freien Korridor — die Aufbauorte für die folgenden Kriterien werden **gemessen, nicht geraten**.

**Gemessen:**

- 1 Gelände vorhanden
- **2.563** amtliche LoD2-Gebäude im Gelände
- **2.562** Gebäude mit echter Traufhöhe = **100 %**
- Geländehöhen **136,12–168,36 m ü. NHN**, Spanne **32,2 m**
- **12 von 12** Kacheln mit Luftbildtextur
- **800** ALKIS-Flurstücke
- Quellennachweis mit **4** Einträgen (gefordert ≥ 3)
- Luftbildkachel abrufbar: **406 kB, `image/jpeg`**
- Freiflächensuche: größter Abstand zur Bebauung **60,0 m** bei E 474.932 / N 5.525.038; freier Korridor **472 m** lang, Richtung **135 Grad**
- **60** freie Standplätze mit mindestens 12 m Abstand zur Bebauung gefunden

### Kriterium 2 — BESTANDEN (1/1)

> **Wortlaut:** „Projekt ‚Heinerfest 2027' anlegen, max. Besucher 30.000"

**Was der Test tut:** `POST /api/projekte` mit Name, Geländebezug, Zeitraum, Besucherobergrenze und Regelwerk-ID; prüft die Rückgabe.

**Gemessen:** Projekt angelegt: „Heinerfest 2027", **30.000** Besucher, Regelwerk `he-mvstaettvo`, ID `prj_5bff82ddbf7d92a4`.

### Kriterium 3 — BESTANDEN (4/4)

> **Wortlaut:** „Riesenrad (33 m / H 38 m) platzieren, 45 Grad drehen, Einstieg nach Süden"

**Was der Test tut:** Sucht den Objekttyp `riesenrad` in der Bibliothek, prüft die hinterlegten Maße, platziert das Objekt auf einem gemessenen Standplatz (mit Rücksicht auf den 16,5-m-Radius), dreht es per PATCH auf 45 Grad und rechnet anschließend aus der lokalen Einstiegsrichtung die Objektdrehung aus, bei der der Einstieg in Weltrichtung 180 Grad (Süden) zeigt.

**Gemessen:**

- Objekttyp „Riesenrad" vorhanden, **54** Typen gesamt in der Bibliothek
- Maße laut Bibliothek: Durchmesser **33 m**, Höhe **38 m**, Form **kreis**
- Riesenrad um **45 Grad** gedreht (bestätigt durch die API-Antwort)
- Einstieg zeigt nach **180 Grad** (= Süden) bei Objektdrehung **180 Grad**

### Kriterium 4 — BESTANDEN (7/7)

> **Wortlaut:** „20 weitere Objekte platzieren, 5 einem Standbetreiber zuweisen — dieser darf nur diese bearbeiten"

**Was der Test tut:** Platziert 20 Objekte aus zehn verschiedenen Typen, weist fünf davon der Organisation „Schaustellerbetrieb Wagner" zu und prüft dann als angemeldeter Standbetreiber vier Rechtefälle: Rolle, Leseumfang, Schreibrecht am eigenen Objekt, Schreibverbot am fremden Objekt, Verbot des Anlegens von Wegen.

**Gemessen:**

- **20** weitere Objekte platziert, **Gesamt 21**
- **5** Objekte an „Schaustellerbetrieb Wagner" zugewiesen
- Standbetreiber sieht das Projekt in der Rolle **`standbetreiber`**
- Standbetreiber sieht das **gesamte** Projekt lesend: **21** Objekte
- Änderung am eigenen zugewiesenen Objekt: **HTTP 200**
- Änderung an fremdem Objekt: **HTTP 403**
- Anlegen eines Weges: **HTTP 403**

### Kriterium 5 — BESTANDEN (8/8)

> **Wortlaut:** „Rettungsweg 3,00 m quer über den Platz — Stand hineinschieben, Engstelle und Regelverstoß mit Ist/Soll"

**Was der Test tut:** Legt einen Rettungsweg mit 3,00 m Planbreite auf der gemessenen Freiflächenachse an, misst die freie Durchgangsbreite im Ausgangszustand, schiebt dann Stand S8 um 0,9 m quer in den Weg, misst erneut, lässt den vollständigen Prüfbericht rechnen, liest Ist/Soll, Fundstelle und Handlungsempfehlung aus, holt die KI-Erklärung ab und macht schließlich die **Gegenprobe**: Empfehlung anwenden, erneut messen.

**Gemessen:**

- Rettungsweg „Rettungsweg W3": **3,00 m** breit, **464 m** lang
- Ausgangszustand durchgängig frei: **3,00 m**
- Nach dem Hineinschieben: freie Durchgangsbreite **0,00 m** bei 3,00 m Planbreite, **11** eingeschnürte Querschnitte
- Regelverstoß gemeldet: **R-008 — Ist 0,00 m / Soll 3,00 m**
- Fundstelle: *R-008 — H-VStättR § 7 Abs. 4 Satz 2 und Satz 3* mit wörtlichem Zitat
- Handlungsempfehlung: „Stand S8 (Losbude) um mindestens **4,25 m nach Süden** verschieben, dann ist Rettungsweg W3 wieder 3,00 m breit."
- KI-Panel liefert Verschiebe-Empfehlung, Quelle **`lokal`** (siehe Einschränkung 4.4), mit Stationsangabe „bei Station 232,7 m"
- **Gegenprobe:** nach der empfohlenen Verschiebung wieder **3,00 m** frei

### Kriterium 6 — BESTANDEN (3/3)

> **Wortlaut:** „Blockfläche ‚nur Einsatzkräfte', Laufrichtung auf zwei Besucherwegen, vier Einsatzstationen"

**Was der Test tut:** Legt eine 24 × 20 m große Blockfläche vom Typ `nur_einsatzkraefte` mit Begründung an, zwei Besucherwege à 5,00 m mit gegenläufiger Einbahnrichtung sowie vier Einsatzstationen unterschiedlicher Kategorie. Zusätzlich wird eine Feuerwehrzufahrt (3,50 m breit, 3,50 m lichte Höhe) angelegt, damit die Erreichbarkeitsregeln überhaupt prüfbar werden.

**Gemessen:**

- Blockfläche „nur Einsatzkräfte" angelegt: `blk_5d221bde6860abe2`
- Zwei Besucherwege mit Laufrichtung: „Besucherweg A (Einbahn)" = **vorwärts**, „Besucherweg B (Einbahn)" = **rückwärts** (keiner „beide")
- **4** Einsatzstationen gesetzt: **sanitaet, polizei, einsatzleitung, sammelplatz**

### Kriterium 7 — BESTANDEN (9/9)

> **Wortlaut:** „Polizei (nicht eingeladen) sieht das Projekt automatisch, exportiert Betreiberliste als CSV, erzeugt Einsatzmappe"

**Was der Test tut:** Stellt zunächst fest, dass die Polizei **nicht** unter den Beteiligten des Projekts steht, meldet sich dann als Polizei an und ruft die Zuständigkeitsübersicht, das Lagebild, den CSV-Export und die Einsatzmappe ab. Zum Schluss ein Schreibversuch, der scheitern muss.

**Gemessen:**

- Beteiligte des Projekts: **veranstalter, betreiber** — die Polizei wurde **nicht** eingeladen
- Polizei sieht „Heinerfest 2027" trotzdem; Zuständigkeit: **Südhessen (Darmstadt, Darmstadt-Dieburg, Odenwaldkreis, Bergstraße, Groß-Gerau)**
- Lagebild: **4** Einsatzstationen mit Erreichbarkeitsangabe, z. B. „Sanitätsstation Nord": **10,3 m**
- Betreiberliste als CSV: **22 Zeilen, 2.706 Bytes**, mit UTF-8-BOM, semikolongetrennt, „Wagner" enthalten
- Einsatzmappe: **49 kB PDF**, gültiger `%PDF-`-Kopf
- Schreibversuch der Polizei: **HTTP 403** (reiner Lesezugriff)

### Kriterium 8 — BESTANDEN (5/5)

> **Wortlaut:** „Planungsstand ‚Einreichung', Ordnungsamt setzt ‚mit Auflagen' + Kommentar, Veranstalter sieht die Aufgabe"

**Was der Test tut:** Lädt das Ordnungsamt ein, friert einen Planungsstand als Snapshot ein und reicht ihn ein. Das Ordnungsamt setzt daraufhin den Freigabestatus `mit_auflagen` mit Kommentar und zwei Auflagen. Danach wird geprüft, ob der Veranstalter die Auflagen als Aufgabenliste sieht, eine davon abhaken kann und über den Statuswechsel benachrichtigt wurde.

**Gemessen:**

- Planungsstand „Einreichung Ordnungsamt 01.03." festgehalten, **Ereignis-Stand 42**
- Ordnungsamt setzt **`mit_auflagen`** mit **2** Auflagen
- Veranstalter sieht **2** Auflagen als Aufgabenliste, erste: „Rettungsweg W3 durchgängig 3,00 m freihalten — Stand S8 versetzen."
- Auflage lässt sich als **erledigt** abhaken (Zustand nach dem PATCH bestätigt)
- Veranstalter benachrichtigt: **5** Nachrichten, zuletzt „Ordnungsamt Darmstadt: mit Auflagen", Art `statuswechsel`

### Kriterium 9 — BESTANDEN (7/7)

> **Wortlaut:** „Konformitätsbericht und maßstäblicher Lageplan 1:1000 als PDF, KI beantwortet die Rettungswegfrage"

**Was der Test tut:** Erzeugt den Konformitätsbericht und die Lagepläne in zwei Maßstäben als PDF (Kopfbytes und Größe werden geprüft), stellt der KI die Frage „Reichen die Rettungswegbreiten für 30.000 Besucher?" und verlangt eine Antwort mit erkennbarem Regelbezug. Danach wird der Prüfbericht neu gerechnet und die Kapazitätsregel sowie der Haftungshinweis ausgelesen.

**Gemessen:**

- Konformitätsbericht: **778 kB** PDF
- Lageplan **1:1000**: **15 kB** PDF
- Lageplan **1:500**: **11 kB** PDF
- KI-Antwort (Quelle **`lokal`**) mit Regelbezug: „Rettungswege (1): Rettungsweg W3 3,00 m breit, 464,0 m lang. Geplante Wegbreiten: …"
- **Kapazitätsregel gerechnet: Summe Rettungswegbreiten 3,00 m / erforderlich 60,00 m bei 30.000 Besuchern** — der Testaufbau ist damit bewusst weit unterbemessen (siehe 4.5)
- Prüfbericht: **27 Fehler, 63 Warnungen, 11 ohne Beanstandung, 3 nicht prüfbar**
- Haftungshinweis vorhanden: **2.247 Zeichen**

### Kriterium 10 — BESTANDEN (5/5)

> **Wortlaut:** „Vadere-Szenario-Export erzeugt eine gültige Datei (Struktur-Check)"

**Was der Test tut:** Exportiert die Szenarien `normalbetrieb` und `evakuierung` je einmal mit eingeschalteter Strukturprüfung (`?pruefen=1`), schreibt die Evakuierungsdatei auf Platte und prüft zusätzlich die weiteren Exporte aus Lastenheft F10.4: GeoJSON-Gesamtexport und glTF-Szene (Magic Bytes und Version).

**Gemessen:**

- Szenario **`normalbetrieb`**: **gültig**, 0 Warnungen
- Szenario **`evakuierung`**: **gültig**, 0 Warnungen
- Vadere-Datei geschrieben: **1.830 kB**
- GeoJSON-Gesamtexport: **2.598 Features**
- glTF-Export der Szene: **7.034 kB, Version 2**

---

## 3. Erzeugte Nachweise

Verzeichnis: `C:\Users\Mitarbeiter\Desktop\QWEN\Heinerfest\data\abnahme`
Alle Dateien wurden nach dem Lauf **einzeln geöffnet und auf Kopfbytes, Struktur und Inhalt geprüft** — die folgenden Werte sind gemessen, nicht aus dem Testlauf übernommen.

| Datei | Größe | Prüfung am Dateiinhalt | Was sie belegt |
|---|---|---|---|
| `betreiberliste.csv` | **2.706 B** | Erste Bytes `EF BB BF` = **UTF-8-BOM**; **22 Zeilen**; **9 Semikolon-Trenner** in der Kopfzeile; Kopfzeile: `Stand-Nr.;Objekt;Kategorie;Masse (L x B x H);Position (EPSG:25832);Betreiber;Ansprechpartner;E-Mail;Telefon;Status`; Zeile 2: `R1;Riesenrad;Fahrgeschaeft;33,00 x 33,00 x 38,00 m;E 475030, N 5524912;nicht zugewiesen;k. A.;k. A.;k. A.;Geplant` | Kriterium 7: Behördenexport der Standbetreiber, in deutschem Excel direkt lesbar. Fehlende Angaben stehen ehrlich als „k. A." |
| `einsatzmappe.pdf` | **49.843 B** | Kopf `%PDF-1.3`, Datei endet auf `%%EOF`, **32 Seitenobjekte** | Kriterium 7: Einsatzunterlage der Polizei, ohne Einladung erzeugt |
| `konformitaetsbericht.pdf` | **797.136 B** | Kopf `%PDF-1.3`, `%%EOF` vorhanden, **327 Seitenobjekte** | Kriterium 9: vollständige Regelprüfung inkl. Ist/Soll je Befund, Fundstellen und 2.247-Zeichen-Haftungshinweis |
| `lageplan_1zu1000.pdf` | **14.923 B** | Kopf `%PDF-1.3`, `%%EOF`, **3 Seitenobjekte** | Kriterium 9: maßstäblicher Lageplan 1:1000 |
| `lageplan_1zu500.pdf` | **11.729 B** | Kopf `%PDF-1.3`, `%%EOF`, **3 Seitenobjekte** | Kriterium 9: derselbe Plan in 1:500, belegt die freie Maßstabswahl |
| `projekt.geojson` | **2.556.961 B** | `type: FeatureCollection`, **2.598 Features**; aufgeschlüsselt: 2.563 `gebaeude`, 21 `objekt`, 4 `weg`, 4 `wegkorridor`, 4 `einsatzstation`, 1 `blockflaeche`, 1 `gelaendegrenze`; Zusatzfelder `koordinatensystem`, `erzeugtAm`, `erzeugtVon`, `projekt`, `gelaende`, `bbox` | Lastenheft F10.4: GIS-Export der gesamten Planung inkl. Bestandsgebäuden und Metadaten |
| `szene.glb` | **7.202.304 B** | Magic **`glTF`**, Version **2**, Längenangabe im Kopf **7.202.304 B = Dateigröße** (konsistent); Chunk 0 = `JSON`, 1.552.580 B; **2.588 Meshes, 2.588 Nodes, 15 Materialien**; `asset.generator` = „EventPlan3D Export F10.4" | Lastenheft F10.4: 3D-Szene als glTF-Binary, in jedem Standard-Viewer öffenbar |
| `vadere_evakuierung.scenario` | **1.873.689 B** | Gültiges JSON; Top-Level `name, description, release, commithash, processWriters, scenario`; `release` = **4.0**; `name` = „Heinerfest 2027 — evakuierung"; Topographie: **2.585 obstacles, 17 sources, 1 target, 0 measurementAreas**; `attributesModel` enthält `AttributesFloorField`, `AttributesOSM`, `AttributesPotentialCompactSoftshell` | Kriterium 10: strukturell gültiges Vadere-Szenario nach Release-4.0-Format. **Die Simulation selbst wird nicht ausgeführt** — siehe 4.1 |

**Summe der Nachweise:** 8 Dateien, rund 12,4 MB.

---

## 4. Bekannte Einschränkungen

Der Testlauf ist vollständig bestanden. Das heißt **nicht**, dass alles fertig ist. Die folgenden Punkte sind bewusst offen und dürfen bei einem produktiven Einsatz nicht übersehen werden.

### 4.1 Die Personenstromsimulation selbst ist Phase 2

Kriterium 10 heißt im Lastenheft ausdrücklich „**Struktur-Check**". Die Plattform **erzeugt** ein Vadere-Szenario und **validiert dessen Aufbau** — sie **rechnet es nicht**. Konkret fehlt in Phase 1:

- **Kein Simulationslauf.** Es gibt keinen Solver, keinen Vadere-Aufruf, keine Java-Anbindung. Die `.scenario`-Datei muss außerhalb der Plattform in Vadere geladen und dort gerechnet werden.
- **Kein Ergebnisrückweg.** Dichtekarten, Evakuierungszeiten, Stauzonen und Fundamentaldiagramme werden weder importiert noch dargestellt. `processWriters` ist im Export gesetzt, aber die entstehenden Ausgabedateien liest niemand wieder ein.
- **Keine Messflächen.** Das exportierte Szenario enthält **0 `measurementAreas`** — Auswertungsflächen für Personendichte müssen in Vadere manuell ergänzt werden.
- **Keine Kalibrierung.** Die Modellparameter (OSM, Floorfield, PotentialCompactSoftshell) stehen auf den Vadere-Standardwerten und sind nicht an das Heinerfest kalibriert.
- **Formatrisiko.** Der Exporter ist gegen **Vadere Release 4.0** entwickelt (Belege in `docs/VADERE.md`). Die offizielle Formatdokumentation im Vadere-Repo ist nachweislich veraltet; die Struktur wurde deshalb aus echten Szenariodateien und den Java-Attributklassen abgeleitet. Bei einem Vadere-Versionswechsel ist der Exporter neu zu prüfen.

Aussagen zu Evakuierungszeiten oder Personendichten dürfen aus Phase 1 **nicht** abgeleitet werden.

### 4.2 Sechs Regelwerte tragen noch `verifikation.status = "zu_pruefen"`

Von den **23** Regeln in `he-mvstaettvo-2026.1.json` sind **17 verifiziert** und **6 zu prüfen**. Alle sechs sind bewusst auf `warnung` oder `hinweis` gesetzt, keine davon meldet einen harten Fehler.

| Regel-ID | Titel | Schwellwert | Schwere | Begründung des Status |
|---|---|---|---|---|
| **R-002** | Mindestbreite von Besucherwegen im Veranstaltungsgelände | 1,20 m | warnung | Der Zahlenwert 1,20 m ist belegt (H-VStättR § 7 Abs. 4 Satz 3). **Nicht belegt ist die Übertragung auf jeden Besucherweg**: ob ein konkreter Besucherweg zum Rettungsweg zählt, legt die Genehmigungsbehörde im Lageplan fest. (Ein früher hier geführtes Zitat zu § 6 Abs. 1 Satz 1 war ein Falschzitat und wurde am 07.08.2026 korrigiert.) |
| **R-010** | Maximale Gesamtlänge des Rettungsweges bis ins Freie | 60 m | warnung | **Der 60-m-Wert ist für Veranstaltungen im Freien nicht belegt.** § 7 Abs. 1 Satz 3 nennt 60 m zwar wörtlich, meint damit aber die Obergrenze der Verlängerung bei hohen Versammlungsräumen, nicht eine addierte Gesamtlänge im Freien. Für Veranstaltungen im Freien enthält der Normtext keine Gesamtlängenbegrenzung — die wird im Sicherheitskonzept festgelegt. Bleibt unbelegter Richtwert, vor produktivem Einsatz mit der Bauaufsicht abzustimmen. |
| **R-011** | Schutzstreifen zwischen aneinandergebauten Ständen, Buden und Zelten | 5 m | warnung | 5 m und das 40-m-Raster sind wörtlich aus dem HLFS-Merkblatt belegt. **Nicht belegt ist die gewählte Abbildung als paarweiser Mindestabstand zwischen allen Objekten** — die Norm fordert Schutzstreifen im 40-m-Raster. Die Regel ist damit strenger als der Normtext und meldet zwangsläufig auch zulässige geschlossene Budenzeilen. Vor produktivem Einsatz auf eine 40-m-Rasterprüfung umstellen. |
| **R-016** | Baurechtliche Mindestbreite von Zu- und Durchfahrten, Zusatzbreite in Kurven | 3,00 m | hinweis | 3,00 m, die 12-m-/3,50-m-Regel und die 11-m-Übergangsbereiche sind wörtlich aus MRFlFw Nr. 2 und Nr. 3 belegt; die Kurventabelle wurde am Normtext **DIN 14090:2003-05** gelesen und bestätigt. **Offen:** die aktuelle Ausgabe **DIN 14090:2024-02** ist kostenpflichtig und wurde nicht geprüft; sie ist laut Bekanntmachung technisch umfassend überarbeitet, die Werte können abweichen. Außerdem prüft die Regel Kurvenradien derzeit ohnehin nicht. |
| **R-020** | Ein- und Ausstiege müssen an einen Rettungsweg angebunden sein | max. 2,0 m Versatz | warnung | Die Pflicht zur lückenlosen Wegeführung ist belegt (H-VStättR § 6 Abs. 1). **Der Zahlenwert 2,0 m ist dagegen eine Annahme** — eine reine Modellierungstoleranz für Ungenauigkeiten der Planzeichnung. Im Normtext gibt es keinen zulässigen Versatz; fachlich richtig wäre 0 m. Vor produktivem Einsatz mit der Genehmigungsbehörde bzw. der Zeichengenauigkeit der Plattform abgleichen. |
| **R-022** | Erreichbarkeit von Sanitäts-, Feuerwehr- und Einsatzleitungsstationen | max. 50 m | warnung | Die 50 m sind als Raster für Bewegungsflächen belegt (HLFS-Merkblatt, deckungsgleich mit HBO § 5 Abs. 1 Satz 4). **Die Übertragung auf die Anbindung von Sanitäts- und Einsatzleitungsstationen ist eine Annahme** — für sie gibt es keine hessische Normvorgabe; ihre Lage wird im Sanitätsdienst- und Sicherheitskonzept mit dem Träger des Rettungsdienstes und der Gefahrenabwehrbehörde festgelegt. |

Zusätzlich gilt der oben zitierte **Anwendungsbereichsvorbehalt**: Für ein Straßenfest ohne Tribünen ist die H-VStättR in der Regel nicht unmittelbar einschlägig; ihre § 7-Werte wirken dann nur als Bemessungsorientierung über die Auflagen der Genehmigungsbehörde.

### 4.3 Der Geländehöhen-Weg ist eine Näherung

`hoehenHerkunft` steht auf **`lod2_interpoliert`** — es liegt **kein DGM1** zugrunde. Konkret:

- Die Höhen stammen aus den **Bodenhöhen der 2.562 LoD2-Gebäude** (CityGML-Attribut `AbsoluteHoehe`), die als Stützpunkte dienen. Dazwischen wird **invers-distanzgewichtet interpoliert**.
- Vor der Interpolation verwirft der Importer Bodenhöhen, die nicht zu ihrer Nachbarschaft passen (einzelne LoD2-Objekte tragen fehlerhafte oder auf ein anderes Bezugsniveau bezogene Werte; ein einziger solcher Punkt würde großflächig durchschlagen).
- **Damit ist das Ergebnis kein Geländemodell, sondern ein aus Gebäudefußpunkten aufgespanntes Ersatzrelief.** Genau dort, wo für ein Volksfest gebaut wird — auf großen gebäudefreien Flächen wie Herrngarten, Luisenplatz, Karolinenplatz —, gibt es **keine** Stützpunkte; die Höhe wird aus dem umliegenden Bebauungsrand extrapoliert. Geländekanten, Böschungen, Treppen und Rampen innerhalb solcher Flächen sind im Modell **nicht** enthalten.
- Höhen sind auf 1 cm gerundet; die gemessene Spanne 136,12–168,36 m ü. NHN ist plausibel für die Darmstädter Innenstadt, aber nicht als Höhennachweis belastbar.
- **Der saubere Weg ist vorhanden, aber ungenutzt:** `dgmImportieren()` (Route für DGM1-Import als XYZ oder ESRI-ASCII) setzt `hoehenHerkunft` auf `dgm1` und hat dann Vorrang. Der Import ist als Fallback im Lastenheft (F1) vorgesehen, weil Hessen für DGM1 keine Direktlinks anbietet — er wurde für diese Abnahme **nicht** durchgeführt.

Alles, was aus den Höhen folgt (Neigungen, Sichtbeziehungen, Aufstellflächen-Ebenheit, Barrierefreiheitsaussagen), steht damit unter Vorbehalt.

### 4.4 Die KI lief im lokalen Ersatzmodus, nicht über die Anthropic-API

Sowohl die Verschiebe-Empfehlung in Kriterium 5 als auch die Antwort auf die Rettungswegfrage in Kriterium 9 tragen `quelle: "lokal"`. Während des Laufs war **keine `ANTHROPIC_API_KEY` gesetzt**, deshalb griff der deterministische Fallback (`server/ai/assistent.ts`). Bestanden ist damit: der Ersatzweg liefert eine fachlich korrekte, regelbezogene Antwort und stürzt nicht ab. **Nicht** geprüft wurde in diesem Lauf die Qualität der Antworten über das Sprachmodell. Die Rechenhoheit liegt ohnehin bewusst in der Regel-Engine, nicht in der KI — die Zahlen (4,25 m Verschiebung, 0,00 m Ist / 3,00 m Soll) stammen aus der Engine, nicht aus dem Modell.

### 4.5 Der Testaufbau ist eine Prüffigur, kein genehmigungsfähiger Plan

Die 27 Fehler und 63 Warnungen im Prüfbericht sind **gewollt**: Der Test schiebt am Ende von Kriterium 5 den störenden Stand absichtlich wieder in den Rettungsweg zurück, damit der Konformitätsbericht eine echte Beanstandung zeigt. Ebenso deutlich: Bei 30.000 Besuchern verlangt die Kapazitätsregel **60,00 m** Summe der Rettungswegbreiten, geplant sind **3,00 m**. Der Testaufbau ist eine Prüffigur für die Funktionsfähigkeit der Werkzeuge — er ist kein Entwurf und keine Aussage über ein reales Heinerfest.

### 4.6 Weitere Randbedingungen

- Die **Standorte im Test werden gemessen, nicht fachlich gewählt**: Die Freiflächensuche nimmt den Punkt mit dem größten Abstand zur Bebauung und den längsten freien Korridor. Der so gefundene 464-m-Rettungsweg quer durch die Innenstadt ist geometrisch korrekt, aber planerisch beliebig.
- Die **ALKIS-Flurstücke** stammen aus dem *vereinfachten Modell* (ohne Eigentümerangaben) — für Genehmigungsunterlagen mit Eigentümerbezug reicht das nicht.
- Der **Quellennachweis für LoD2** verweist auf eine lokale CityGML-Datei im LUMUS-Bestand, nicht auf einen Live-Dienst. Für einen Produktivbetrieb sollte der Bezugsweg auf den amtlichen Dienst umgestellt und der Datenstand versioniert werden.
- Die im Lastenheft geführten **Besucherzahlen des Heinerfests** (700.000 gesamt, 200.000 Spitzentag, 60.000 gleichzeitig) sind laut `config/heinerfest.json` teils Presseangaben, teils Herleitungen — ausdrücklich als „Annahme, nicht belegt – zu prüfen" gekennzeichnet.

---

## 5. Wiederholung des Tests

**Voraussetzung:** Node ≥ 22.6, Abhängigkeiten installiert (`npm install` — für den Test selbst werden **keine** zusätzlichen Pakete gebraucht).

```bash
# 1. In das Projektverzeichnis wechseln
cd "C:/Users/Mitarbeiter/Desktop/QWEN/Heinerfest"

# 2. Server starten (API auf Port 4720, Oberflaeche auf 5273) -- in einem eigenen Fenster
npm run dev
#    Nur die API genuegt fuer den Abnahmetest:
#    npm run dev:api

# 3. Falls noch kein Gelaende geladen ist (einmalig, laedt Darmstadt aus den HVBG-Diensten)
npm run gelaende:heinerfest

# 4. Abnahmetest ausfuehren
npm run abnahme
#    gleichwertig:
#    node scripts/abnahme.ts
```

**Abweichende API-Adresse** (z. B. anderer Rechner oder Port):

```bash
HEINERFEST_API=http://127.0.0.1:4720 node scripts/abnahme.ts
```

**Rückgabewerte des Testprogramms**

| Exit-Code | Bedeutung |
|---|---|
| `0` | alle Prüfpunkte bestanden |
| `1` | mindestens ein Prüfpunkt fehlgeschlagen (die offenen Punkte werden am Ende einzeln aufgelistet) |
| `2` | Abbruch — Ausnahme, Stacktrace auf stderr (typisch: Server läuft nicht, kein Gelände geladen) |

**Erwartete Ausgabe des dokumentierten Laufs:**

```
Ergebnis: 59 von 59 Pruefpunkten bestanden.
```

**Nachweise prüfen** — der Testlauf schreibt alle Dateien nach `data/abnahme` neu:

```bash
ls -la "C:/Users/Mitarbeiter/Desktop/QWEN/Heinerfest/data/abnahme"
```

**Hinweise zur Reproduzierbarkeit:**

- Jeder Lauf legt ein **neues** Projekt an (neue `prj_…`-ID) und lässt es stehen — die Projekt-ID wird am Ende ausgegeben, damit man den Aufbau in der Oberfläche auf Port 5273 ansehen kann. Bei wiederholten Läufen sammeln sich Testprojekte in `data/projekte/`.
- Die Aufbauorte werden bei jedem Lauf neu **gemessen**. Solange dasselbe Gelände geladen ist, sind sie deterministisch; nach einem Neuimport des Geländes können sich Koordinaten und Korridorlänge geringfügig ändern.
- Die Zahlen in diesem Protokoll stammen aus dem Lauf vom **07.08.2026** gegen Regelwerk **2026.1**, Objektbibliothek **1.0.0** und Gelände `gel_83209f27a083ee94`.

---

*Protokoll erstellt am 07.08.2026 auf Basis des tatsächlichen Testlaufs. Alle Messwerte sind der Konsolenausgabe von `scripts/abnahme.ts` bzw. der direkten Prüfung der erzeugten Dateien entnommen.*
