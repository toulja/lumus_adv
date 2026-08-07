-- ===========================================================================
-- EventPlan3D — Relationales Schema fuer den Produktivbetrieb
-- PostgreSQL 14+ mit PostGIS 3.x
-- ===========================================================================
--
-- WOFUER DIESES SCHEMA DA IST
-- ---------------------------
-- Das Lastenheft (Kap. 5 "Technische Anforderungen") verlangt fuer den
-- Produktivbetrieb PostgreSQL + PostGIS, alle Geometrien in ETRS89 / UTM 32N
-- (EPSG:25832) in Metern, und die Versionierung als Event-Log-Tabelle
-- (Kap. 9 "Nachvollziehbarkeit": das Audit-Log ist unveraenderlich).
-- Diese Datei ist genau dieses Schema.
--
-- WARUM DIE LOKALE INSTALLATION TROTZDEM DATEIEN NUTZT
-- ----------------------------------------------------
-- Die ausgelieferte Installation speichert NICHT hier, sondern im
-- dateibasierten Speicher (server/lib/store.ts, Verzeichnis `data/`).
-- Begruendung steht im Kopf jener Datei und kurz gefasst hier:
--   * Die Plattform muss laut Auftrag lokal ohne Docker startbar sein.
--   * Alle Geometrie-Rechnungen laufen im gemeinsamen Kern (shared/geo),
--     damit Editor, Pruefung und Bericht identisch rechnen. PostGIS wuerde
--     dieselben Rechnungen ein zweites Mal, aber anders runden.
--   * Die geforderte Versionierung ist ohnehin append-only; die Datei
--     `events.jsonl` ist das direkte Abbild von `aenderungs_event`.
-- Die Feldnamen hier sind feldgleich zu shared/domain/types.ts (Kap. 7),
-- nur in snake_case statt camelCase.
--
-- WIE DIE MIGRATION ABLIEFE
-- -------------------------
--  1. Leere Datenbank anlegen, `psql -f db/postgis/schema.sql` einspielen.
--  2. Stammdaten uebertragen (Reihenfolge wegen der Fremdschluessel):
--     organisationen.json -> organisation
--     nutzer.json         -> nutzer
--     config/regelwerk/*  -> regelwerk, regelwerk_quelle, regel
--     shared/library/objekttypen.json + objekttypen-eigen.json
--                         -> bibliothek, objekt_typ, objekt_typ_zugang
--  3. Je Gelaende `data/gelaende/<id>/gelaende.json` aufteilen auf
--     gelaende, gelaende_patch, gelaende_gebaeude, gelaende_flurstueck,
--     quellennachweis. Ringe (erster Punkt NICHT wiederholt) beim Import
--     schliessen: ST_MakePolygon(ST_AddPoint(linie, ST_StartPoint(linie))).
--     Texturdateien bleiben im Dateisystem, nur der Pfad wandert mit.
--  4. Je Projekt `data/projekte/<id>/projekt.json` aufteilen auf projekt,
--     objekt_instanz, auflage, weg, blockflaeche, einsatzstation, kommentar,
--     kommentar_antwort, freigabe. `letzteSeq` wandert nach projekt.letzte_seq.
--  5. `events.jsonl` zeilenweise nach aenderungs_event laden — VOR dem Anlegen
--     der Append-Only-Trigger (Abschnitt 12), sonst sperrt der Import sich
--     selbst aus. Danach `SELECT setval(...)` fuer die Sequenz nachziehen.
--  6. `snapshots/*.json` nach snapshot; `inhalt` bleibt als JSONB unveraendert
--     (eingefrorener Stand, absichtlich NICHT normalisiert).
--  7. Gegenprobe: Zeilenzahlen je Tabelle gegen die Objektzahlen der JSON-
--     Dateien, und `ST_IsValid` ueber alle Flaechen laufen lassen.
--
-- Alles, was beim Umstieg Aufmerksamkeit braucht, steht gesammelt ganz am
-- Ende unter "-- Abweichungen zum Dateispeicher".
-- ===========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

-- Alle Geometriespalten dieses Schemas: EPSG:25832, Einheit Meter.
-- WGS84 gibt es ausschliesslich fuer die Anzeige (shared/geo/proj.ts).


-- ===========================================================================
-- 1. Organisationen, Nutzer, Rollen (Lastenheft Kap. 4)
-- ===========================================================================

CREATE TABLE organisation (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  typ                     TEXT NOT NULL
    CONSTRAINT organisation_typ_gueltig CHECK (typ IN (
      'plattform', 'veranstalter', 'betreiber',
      'behoerde_ordnungsamt', 'behoerde_feuerwehr', 'polizei')),
  adresse                 TEXT,
  zustaendigkeitsgebiet   TEXT,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  organisation IS 'Veranstalter, Standbetreiber, Behoerden, Polizei.';
COMMENT ON COLUMN organisation.adresse IS
  'DSGVO: Bei Einzelunternehmen faktisch eine Wohnanschrift — personenbezogen.';
COMMENT ON COLUMN organisation.zustaendigkeitsgebiet IS
  'Nur Behoerden/Polizei: Gebiet mit automatischem Lesezugriff.';


CREATE TABLE nutzer (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL
    REFERENCES organisation (id) ON DELETE RESTRICT,
  name                    TEXT NOT NULL,
  email                   TEXT NOT NULL,
  passwort_hash           TEXT NOT NULL,
  rolle_in_org            TEXT NOT NULL
    CONSTRAINT nutzer_rolle_in_org_gueltig CHECK (rolle_in_org IN ('admin', 'mitglied')),
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now(),
  letzter_besuch          TIMESTAMPTZ,
  CONSTRAINT nutzer_email_eindeutig UNIQUE (email)
);

COMMENT ON COLUMN nutzer.name IS
  'DSGVO: Klarname. Beim Loeschen anonymisieren (siehe dsgvo_nutzer_anonymisieren).';
COMMENT ON COLUMN nutzer.email IS
  'DSGVO: Personenbezogen und Anmeldekennung. Beim Loeschen durch Platzhalter ersetzen.';
COMMENT ON COLUMN nutzer.passwort_hash IS
  'DSGVO: Authentifizierungsgeheimnis (scrypt, Format <salt-hex>:<hash-hex>). Nie exportieren, beim Loeschen leeren.';
COMMENT ON COLUMN nutzer.letzter_besuch IS
  'DSGVO: Nutzungsverhalten (Zeitstempel). Beim Loeschen auf NULL setzen.';

CREATE INDEX ix_nutzer_org ON nutzer (org_id);


CREATE TABLE mitgliedschaft (
  projekt_id              TEXT NOT NULL,
  org_id                  TEXT NOT NULL
    REFERENCES organisation (id) ON DELETE RESTRICT,
  rolle                   TEXT NOT NULL
    CONSTRAINT mitgliedschaft_rolle_gueltig CHECK (rolle IN (
      'plattform_admin', 'veranstalter', 'standbetreiber',
      'ordnungsamt', 'feuerwehr', 'polizei', 'gast')),
  automatisch             BOOLEAN NOT NULL DEFAULT false,
  eingeladen_von          TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  eingeladen_am           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projekt_id, org_id)
);

COMMENT ON COLUMN mitgliedschaft.automatisch IS
  'true = kraft Zustaendigkeit (Polizei/Behoerde), nicht per Einladung.';
COMMENT ON COLUMN mitgliedschaft.eingeladen_von IS
  'DSGVO: Nutzer-ID (Pseudonym) — wer eingeladen hat.';

CREATE INDEX ix_mitgliedschaft_org ON mitgliedschaft (org_id);
CREATE INDEX ix_mitgliedschaft_projekt ON mitgliedschaft (projekt_id);
CREATE INDEX ix_mitgliedschaft_eingeladen_von ON mitgliedschaft (eingeladen_von);
-- Fremdschluessel mitgliedschaft.projekt_id -> projekt wird in Abschnitt 4
-- nachgereicht, weil `projekt` erst dort entsteht.


-- ===========================================================================
-- 2. Gelaende (F1) — digitaler Zwilling des Platzes
-- ===========================================================================

CREATE TABLE gelaende (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  polygon                 geometry(Polygon, 25832) NOT NULL,
  bbox_min_e              DOUBLE PRECISION NOT NULL,
  bbox_min_n              DOUBLE PRECISION NOT NULL,
  bbox_max_e              DOUBLE PRECISION NOT NULL,
  bbox_max_n              DOUBLE PRECISION NOT NULL,
  epsg                    INTEGER NOT NULL DEFAULT 25832
    CONSTRAINT gelaende_epsg_25832 CHECK (epsg = 25832),
  hoehe_mittel            DOUBLE PRECISION NOT NULL,
  hoehe_min               DOUBLE PRECISION NOT NULL,
  hoehe_max               DOUBLE PRECISION NOT NULL,
  hoehen_herkunft         TEXT NOT NULL
    CONSTRAINT gelaende_hoehen_herkunft_gueltig CHECK (hoehen_herkunft IN (
      'dgm1', 'lod2_interpoliert', 'flach')),
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now(),
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  CONSTRAINT gelaende_bbox_sortiert CHECK (bbox_min_e <= bbox_max_e AND bbox_min_n <= bbox_max_n),
  CONSTRAINT gelaende_hoehen_sortiert CHECK (hoehe_min <= hoehe_max)
);

COMMENT ON TABLE  gelaende IS 'Importiertes Gebiet: Umgrenzung, Hoehenlage, Herkunftsnachweis.';
COMMENT ON COLUMN gelaende.polygon IS 'Umgrenzung des importierten Gebiets (EPSG:25832, Meter).';
COMMENT ON COLUMN gelaende.hoehen_herkunft IS 'Nachweispflicht: wie die Hoehen entstanden sind.';
COMMENT ON COLUMN gelaende.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym) des Importierenden.';

CREATE INDEX gix_gelaende_polygon ON gelaende USING GIST (polygon);
CREATE INDEX ix_gelaende_erstellt_von ON gelaende (erstellt_von);


CREATE TABLE gelaende_patch (
  id                      TEXT PRIMARY KEY,
  gelaende_id             TEXT NOT NULL
    REFERENCES gelaende (id) ON DELETE CASCADE,
  bbox_min_e              DOUBLE PRECISION NOT NULL,
  bbox_min_n              DOUBLE PRECISION NOT NULL,
  bbox_max_e              DOUBLE PRECISION NOT NULL,
  bbox_max_n              DOUBLE PRECISION NOT NULL,
  hoehen                  JSONB NOT NULL,
  spalten                 INTEGER NOT NULL CHECK (spalten > 0),
  zeilen                  INTEGER NOT NULL CHECK (zeilen > 0),
  textur_datei            TEXT
);

COMMENT ON TABLE  gelaende_patch IS 'Gelaende-Kachel mit eigenem Hoehengitter und eigener Orthophoto-Textur.';
COMMENT ON COLUMN gelaende_patch.hoehen IS
  'Hoehengitter number[][] (Zeilen Sued->Nord, Spalten West->Ost), m ue. NHN. Bewusst JSONB, nicht Raster.';
COMMENT ON COLUMN gelaende_patch.textur_datei IS
  'Relativer Pfad unter /api/gelaende/:id/textur/... — die Bilddatei bleibt im Dateisystem.';

CREATE INDEX ix_gelaende_patch_gelaende ON gelaende_patch (gelaende_id);


CREATE TABLE gelaende_gebaeude (
  id                      TEXT PRIMARY KEY,
  gelaende_id             TEXT NOT NULL
    REFERENCES gelaende (id) ON DELETE CASCADE,
  grundriss               geometry(Polygon, 25832) NOT NULL,
  boden_hoehe             DOUBLE PRECISION NOT NULL,
  trauf_hoehe             DOUBLE PRECISION,
  first_hoehe             DOUBLE PRECISION,
  dachform                TEXT,
  funktion                TEXT,
  quelle                  TEXT NOT NULL
    CONSTRAINT gelaende_gebaeude_quelle_gueltig CHECK (quelle IN ('lod2', 'alkis', 'manuell'))
);

COMMENT ON COLUMN gelaende_gebaeude.boden_hoehe IS 'Gelaendehoehe am Gebaeudefuss, m ue. NHN.';
COMMENT ON COLUMN gelaende_gebaeude.trauf_hoehe IS 'Absolute Traufhoehe (m ue. NHN), NULL = unbekannt (k. A.).';
COMMENT ON COLUMN gelaende_gebaeude.first_hoehe IS 'Absolute Firsthoehe (m ue. NHN), NULL = unbekannt (k. A.).';

CREATE INDEX gix_gelaende_gebaeude_grundriss ON gelaende_gebaeude USING GIST (grundriss);
CREATE INDEX ix_gelaende_gebaeude_gelaende ON gelaende_gebaeude (gelaende_id);


CREATE TABLE gelaende_flurstueck (
  id                      TEXT PRIMARY KEY,
  gelaende_id             TEXT NOT NULL
    REFERENCES gelaende (id) ON DELETE CASCADE,
  kennzeichen             TEXT NOT NULL,
  polygon                 geometry(Polygon, 25832) NOT NULL,
  flaeche                 DOUBLE PRECISION NOT NULL
);

COMMENT ON TABLE  gelaende_flurstueck IS 'ALKIS-Flurstuecke des Gebiets (Anzeige + Flaechenbezug).';
COMMENT ON COLUMN gelaende_flurstueck.flaeche IS
  'Amtliche Flaeche in m2 — NICHT aus der Geometrie nachrechnen, das Kataster ist die Wahrheit.';

CREATE INDEX gix_gelaende_flurstueck_polygon ON gelaende_flurstueck USING GIST (polygon);
CREATE INDEX ix_gelaende_flurstueck_gelaende ON gelaende_flurstueck (gelaende_id);


CREATE TABLE quellennachweis (
  id                      BIGSERIAL PRIMARY KEY,
  gelaende_id             TEXT NOT NULL
    REFERENCES gelaende (id) ON DELETE CASCADE,
  datensatz               TEXT NOT NULL,
  dienst                  TEXT NOT NULL,
  url                     TEXT NOT NULL,
  abgerufen_am            TIMESTAMPTZ NOT NULL,
  lizenz                  TEXT NOT NULL,
  quellenvermerk          TEXT NOT NULL,
  hinweis                 TEXT
);

COMMENT ON TABLE quellennachweis IS
  'Lizenz- und Herkunftsnachweis je verwendetem Datensatz. Wandert unveraendert in jeden Bericht.';

CREATE INDEX ix_quellennachweis_gelaende ON quellennachweis (gelaende_id);


-- ===========================================================================
-- 3. Objektbibliothek (F3)
-- ===========================================================================

CREATE TABLE bibliothek (
  id                      TEXT PRIMARY KEY,
  version                 TEXT NOT NULL,
  stand                   TEXT NOT NULL
);

COMMENT ON TABLE bibliothek IS
  'Ausgelieferte Objektbibliothek als Ganzes (Version + Stand). Eigene Typen der Veranstalter haengen an keiner Bibliothek.';


CREATE TABLE objekt_typ (
  id                      TEXT PRIMARY KEY,
  bibliothek_id           TEXT REFERENCES bibliothek (id) ON DELETE RESTRICT,
  kategorie               TEXT NOT NULL
    CONSTRAINT objekt_typ_kategorie_gueltig CHECK (kategorie IN (
      'gastronomie', 'verkauf', 'fahrgeschaeft', 'buehne', 'zelt',
      'sanitaer', 'infrastruktur', 'einsatz', 'absperrung', 'moeblierung')),
  name                    TEXT NOT NULL,
  geometrie_typ           TEXT NOT NULL
    CONSTRAINT objekt_typ_geometrie_typ_gueltig CHECK (geometrie_typ IN ('box', 'gltf', 'parametrisch')),
  form                    TEXT NOT NULL
    CONSTRAINT objekt_typ_form_gueltig CHECK (form IN ('rechteck', 'kreis')),
  masse_laenge            DOUBLE PRECISION NOT NULL,
  masse_breite            DOUBLE PRECISION NOT NULL,
  masse_hoehe             DOUBLE PRECISION NOT NULL,
  parametrisierbar        BOOLEAN NOT NULL DEFAULT false,
  min_laenge              DOUBLE PRECISION NOT NULL,
  max_laenge              DOUBLE PRECISION NOT NULL,
  min_breite              DOUBLE PRECISION NOT NULL,
  max_breite              DOUBLE PRECISION NOT NULL,
  min_hoehe               DOUBLE PRECISION NOT NULL,
  max_hoehe               DOUBLE PRECISION NOT NULL,
  flaechenbedarf_zusatz   DOUBLE PRECISION NOT NULL DEFAULT 0,
  technik_strom_kw        DOUBLE PRECISION NOT NULL DEFAULT 0,
  technik_wasser          BOOLEAN NOT NULL DEFAULT false,
  technik_gasflaschen     BOOLEAN NOT NULL DEFAULT false,
  personenkapazitaet      INTEGER,
  quelle_masse            TEXT NOT NULL,
  farbe                   TEXT NOT NULL,
  hinweis                 TEXT,
  gltf_datei              TEXT,
  eigen                   BOOLEAN NOT NULL DEFAULT false,
  eigentuemer_org_id      TEXT REFERENCES organisation (id) ON DELETE RESTRICT,
  CONSTRAINT objekt_typ_masse_in_grenzen CHECK (
    min_laenge <= max_laenge AND min_breite <= max_breite AND min_hoehe <= max_hoehe),
  CONSTRAINT objekt_typ_gltf_datei_noetig CHECK (geometrie_typ <> 'gltf' OR gltf_datei IS NOT NULL),
  CONSTRAINT objekt_typ_eigen_hat_eigentuemer CHECK (eigen = false OR eigentuemer_org_id IS NOT NULL)
);

COMMENT ON COLUMN objekt_typ.flaechenbedarf_zusatz IS 'Zusaetzlich freizuhaltender Umlauf in Metern.';
COMMENT ON COLUMN objekt_typ.personenkapazitaet IS 'NULL = keine Kapazitaetsangabe (k. A.), nicht 0.';
COMMENT ON COLUMN objekt_typ.quelle_masse IS 'Belegstelle fuer die Masse — Pflicht, damit Berichte zitierfaehig bleiben.';

CREATE INDEX ix_objekt_typ_bibliothek ON objekt_typ (bibliothek_id);
CREATE INDEX ix_objekt_typ_eigentuemer ON objekt_typ (eigentuemer_org_id);
CREATE INDEX ix_objekt_typ_kategorie ON objekt_typ (kategorie);


CREATE TABLE objekt_typ_zugang (
  id                      BIGSERIAL PRIMARY KEY,
  typ_id                  TEXT NOT NULL
    REFERENCES objekt_typ (id) ON DELETE CASCADE,
  pos_x                   DOUBLE PRECISION NOT NULL,
  pos_y                   DOUBLE PRECISION NOT NULL,
  breite                  DOUBLE PRECISION NOT NULL CHECK (breite > 0),
  richtung                DOUBLE PRECISION NOT NULL,
  typ                     TEXT NOT NULL
    CONSTRAINT objekt_typ_zugang_typ_gueltig CHECK (typ IN ('einstieg', 'ausstieg', 'notausgang'))
);

COMMENT ON TABLE  objekt_typ_zugang IS 'Ein-/Ausstiege eines Objekttyps (Domaenentyp Zugang).';
COMMENT ON COLUMN objekt_typ_zugang.pos_x IS 'Lokales Objektsystem in Metern, Ursprung = Objektmitte. KEINE Weltkoordinate.';
COMMENT ON COLUMN objekt_typ_zugang.richtung IS 'Grad, 0 = +Y (Objektvorderseite), im Uhrzeigersinn.';

CREATE INDEX ix_objekt_typ_zugang_typ ON objekt_typ_zugang (typ_id);


-- ===========================================================================
-- 4. Projekt und platzierte Elemente
-- ===========================================================================

CREATE TABLE projekt (
  id                      TEXT PRIMARY KEY,
  gelaende_id             TEXT NOT NULL
    REFERENCES gelaende (id) ON DELETE RESTRICT,
  veranstalter_org_id     TEXT NOT NULL
    REFERENCES organisation (id) ON DELETE RESTRICT,
  name                    TEXT NOT NULL,
  zeitraum_von            TIMESTAMPTZ NOT NULL,
  zeitraum_bis            TIMESTAMPTZ NOT NULL,
  max_besucher            INTEGER NOT NULL CHECK (max_besucher >= 0),
  status                  TEXT NOT NULL DEFAULT 'entwurf'
    CONSTRAINT projekt_status_gueltig CHECK (status IN (
      'entwurf', 'eingereicht', 'freigegeben', 'abgeschlossen')),
  regelwerk_id            TEXT NOT NULL,
  beschreibung            TEXT,
  letzte_seq              BIGINT NOT NULL DEFAULT 0,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now(),
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  geaendert_am            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projekt_zeitraum_sortiert CHECK (zeitraum_von <= zeitraum_bis)
);

COMMENT ON COLUMN projekt.letzte_seq IS
  'Zaehler fuer aenderungs_event.projekt_seq (entspricht ProjektDatei.letzteSeq im Dateispeicher).';
COMMENT ON COLUMN projekt.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX ix_projekt_gelaende ON projekt (gelaende_id);
CREATE INDEX ix_projekt_veranstalter ON projekt (veranstalter_org_id);
CREATE INDEX ix_projekt_regelwerk ON projekt (regelwerk_id);
CREATE INDEX ix_projekt_erstellt_von ON projekt (erstellt_von);

-- Nachgereichter Fremdschluessel (die Zieltabelle entstand erst jetzt):
ALTER TABLE mitgliedschaft
  ADD CONSTRAINT mitgliedschaft_projekt_fk
  FOREIGN KEY (projekt_id) REFERENCES projekt (id) ON DELETE CASCADE;


CREATE TABLE objekt_instanz (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  typ_id                  TEXT NOT NULL
    REFERENCES objekt_typ (id) ON DELETE RESTRICT,
  "position"              geometry(Point, 25832) NOT NULL,
  rotation                DOUBLE PRECISION NOT NULL DEFAULT 0,
  masse_override_laenge   DOUBLE PRECISION,
  masse_override_breite   DOUBLE PRECISION,
  masse_override_hoehe    DOUBLE PRECISION,
  hoehe_ueber_gelaende    DOUBLE PRECISION NOT NULL DEFAULT 0,
  betreiber_org_id        TEXT REFERENCES organisation (id) ON DELETE RESTRICT,
  stand_nummer            TEXT,
  status                  TEXT NOT NULL DEFAULT 'geplant'
    CONSTRAINT objekt_instanz_status_gueltig CHECK (status IN ('geplant', 'bestaetigt', 'aufgebaut')),
  notizen                 TEXT,
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  objekt_instanz IS 'Platziertes Objekt im Projekt (Stand, Fahrgeschaeft, Buehne, ...).';
COMMENT ON COLUMN objekt_instanz."position" IS 'Mittelpunkt in EPSG:25832 — einzige geometrische Wahrheit, nie aus Bildschirmkoordinaten.';
COMMENT ON COLUMN objekt_instanz.rotation IS 'Grad im Uhrzeigersinn, 0 = Objekt-+Y zeigt nach Norden.';
COMMENT ON COLUMN objekt_instanz.notizen IS
  'DSGVO: Freitext — kann Namen und Telefonnummern von Standpersonal enthalten. Beim Loeschen der Betreiber-Org pruefen.';
COMMENT ON COLUMN objekt_instanz.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX gix_objekt_instanz_position ON objekt_instanz USING GIST ("position");
CREATE INDEX ix_objekt_instanz_projekt ON objekt_instanz (projekt_id);
CREATE INDEX ix_objekt_instanz_typ ON objekt_instanz (typ_id);
CREATE INDEX ix_objekt_instanz_betreiber ON objekt_instanz (betreiber_org_id);
CREATE INDEX ix_objekt_instanz_erstellt_von ON objekt_instanz (erstellt_von);


CREATE TABLE weg (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  typ                     TEXT NOT NULL
    CONSTRAINT weg_typ_gueltig CHECK (typ IN (
      'besucherweg', 'rettungsweg', 'feuerwehrzufahrt',
      'feuerwehrbewegungsflaeche', 'versorgungsweg')),
  polylinie               geometry(LineString, 25832) NOT NULL,
  breite                  DOUBLE PRECISION NOT NULL CHECK (breite > 0),
  lichte_hoehe            DOUBLE PRECISION,
  richtung                TEXT NOT NULL DEFAULT 'beide'
    CONSTRAINT weg_richtung_gueltig CHECK (richtung IN ('vorwaerts', 'rueckwaerts', 'beide')),
  name                    TEXT,
  entfluchtung_fuer_personen INTEGER,
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN weg.breite IS 'Soll-Breite in Metern; die Flaeche entsteht als Puffer beidseitig je breite/2.';
COMMENT ON COLUMN weg.lichte_hoehe IS 'Nur bei Feuerwehrzufahrten relevant, sonst NULL.';
COMMENT ON COLUMN weg.entfluchtung_fuer_personen IS 'Fuer die Kapazitaetsrechnung: Personenzahl, die dieser Weg entfluchtet.';
COMMENT ON COLUMN weg.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX gix_weg_polylinie ON weg USING GIST (polylinie);
CREATE INDEX ix_weg_projekt ON weg (projekt_id);
CREATE INDEX ix_weg_erstellt_von ON weg (erstellt_von);


CREATE TABLE blockflaeche (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  typ                     TEXT NOT NULL
    CONSTRAINT blockflaeche_typ_gueltig CHECK (typ IN (
      'gesperrt', 'nicht_bebaubar', 'nur_einsatzkraefte')),
  polygon                 geometry(Polygon, 25832) NOT NULL,
  begruendung             TEXT NOT NULL,
  name                    TEXT,
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN blockflaeche.begruendung IS 'Pflicht — eine Sperrung ohne Begruendung ist im Bericht nicht vertretbar.';
COMMENT ON COLUMN blockflaeche.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX gix_blockflaeche_polygon ON blockflaeche USING GIST (polygon);
CREATE INDEX ix_blockflaeche_projekt ON blockflaeche (projekt_id);
CREATE INDEX ix_blockflaeche_erstellt_von ON blockflaeche (erstellt_von);


CREATE TABLE einsatzstation (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  kategorie               TEXT NOT NULL
    CONSTRAINT einsatzstation_kategorie_gueltig CHECK (kategorie IN (
      'sanitaet', 'feuerwehr', 'polizei', 'ordnungsdienst',
      'einsatzleitung', 'sammelplatz', 'loeschwasser', 'notausgangspunkt')),
  geom                    geometry(Geometry, 25832) NOT NULL
    CONSTRAINT einsatzstation_geom_punkt_oder_flaeche
      CHECK (GeometryType(geom) IN ('POINT', 'POLYGON')),
  name                    TEXT NOT NULL,
  besetzt_von_org_id      TEXT REFERENCES organisation (id) ON DELETE RESTRICT,
  notizen                 TEXT,
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  erstellt_am             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN einsatzstation.geom IS
  'Punkt ODER Flaeche (Domaene: punkt? / polygon?). Der CHECK laesst genau diese beiden Typen zu.';
COMMENT ON COLUMN einsatzstation.notizen IS
  'DSGVO: Freitext — kann Namen und Funkrufnamen von Einsatzkraeften enthalten.';
COMMENT ON COLUMN einsatzstation.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX gix_einsatzstation_geom ON einsatzstation USING GIST (geom);
CREATE INDEX ix_einsatzstation_projekt ON einsatzstation (projekt_id);
CREATE INDEX ix_einsatzstation_org ON einsatzstation (besetzt_von_org_id);
CREATE INDEX ix_einsatzstation_erstellt_von ON einsatzstation (erstellt_von);


-- ===========================================================================
-- 5. Kommentare (F5)
-- ===========================================================================

CREATE TABLE kommentar (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  element_art             TEXT
    CONSTRAINT kommentar_element_art_gueltig CHECK (element_art IS NULL OR element_art IN (
      'objekt', 'weg', 'blockflaeche', 'einsatzstation', 'projekt', 'kommentar', 'objekttyp')),
  element_id              TEXT,
  punkt                   geometry(Point, 25832),
  "text"                  TEXT NOT NULL,
  autor_id                TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  autor_name              TEXT NOT NULL,
  autor_org_id            TEXT REFERENCES organisation (id) ON DELETE RESTRICT,
  erledigt                BOOLEAN NOT NULL DEFAULT false,
  erwaehnungen            TEXT[] NOT NULL DEFAULT '{}',
  am                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kommentar_element_ref_vollstaendig
    CHECK ((element_art IS NULL) = (element_id IS NULL)),
  CONSTRAINT kommentar_verankert
    CHECK (element_art IS NOT NULL OR punkt IS NOT NULL)
);

COMMENT ON TABLE  kommentar IS 'Verankert an einem Element ODER frei im Plan (dann punkt).';
COMMENT ON COLUMN kommentar."text" IS
  'DSGVO: Freitext von Behoerden und Betreibern — kann personenbezogene Angaben enthalten.';
COMMENT ON COLUMN kommentar.autor_id IS 'DSGVO: Nutzer-ID (Pseudonym).';
COMMENT ON COLUMN kommentar.autor_name IS 'DSGVO: Klarname des Autors, denormalisiert. Beim Loeschen anonymisieren.';
COMMENT ON COLUMN kommentar.erwaehnungen IS 'DSGVO: Nutzer-IDs der Erwaehnten. Beim Loeschen die betroffene ID entfernen.';

CREATE INDEX gix_kommentar_punkt ON kommentar USING GIST (punkt);
CREATE INDEX ix_kommentar_projekt ON kommentar (projekt_id);
CREATE INDEX ix_kommentar_autor ON kommentar (autor_id);
CREATE INDEX ix_kommentar_autor_org ON kommentar (autor_org_id);
CREATE INDEX ix_kommentar_element ON kommentar (element_art, element_id);
CREATE INDEX gin_kommentar_erwaehnungen ON kommentar USING GIN (erwaehnungen);


CREATE TABLE kommentar_antwort (
  id                      TEXT PRIMARY KEY,
  kommentar_id            TEXT NOT NULL
    REFERENCES kommentar (id) ON DELETE CASCADE,
  "text"                  TEXT NOT NULL,
  autor_id                TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  autor_name              TEXT NOT NULL,
  am                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN kommentar_antwort."text" IS 'DSGVO: Freitext, kann personenbezogene Angaben enthalten.';
COMMENT ON COLUMN kommentar_antwort.autor_name IS 'DSGVO: Klarname des Autors, denormalisiert. Beim Loeschen anonymisieren.';

CREATE INDEX ix_kommentar_antwort_kommentar ON kommentar_antwort (kommentar_id);
CREATE INDEX ix_kommentar_antwort_autor ON kommentar_antwort (autor_id);


-- ===========================================================================
-- 6. Versionierung, Snapshots, Freigaben (F6)
-- ===========================================================================

-- APPEND ONLY. Lastenheft Kap. 9: "Audit-Log unveraenderlich".
-- Der Schutz steht als Trigger in Abschnitt 12 — beim Erstimport bewusst
-- zuletzt anlegen, sonst blockiert er den Import.
CREATE TABLE aenderungs_event (
  seq                     BIGSERIAL PRIMARY KEY,
  id                      TEXT NOT NULL UNIQUE,
  projekt_id              TEXT NOT NULL,
  projekt_seq             BIGINT NOT NULL,
  nutzer_id               TEXT NOT NULL,
  nutzer_name             TEXT NOT NULL,
  org_id                  TEXT NOT NULL,
  zeit                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  aktion                  TEXT NOT NULL
    CONSTRAINT aenderungs_event_aktion_gueltig CHECK (aktion IN ('anlegen', 'aendern', 'loeschen')),
  element_art             TEXT NOT NULL
    CONSTRAINT aenderungs_event_element_art_gueltig CHECK (element_art IN (
      'objekt', 'weg', 'blockflaeche', 'einsatzstation', 'projekt', 'kommentar', 'objekttyp')),
  element_id              TEXT NOT NULL,
  bezeichnung             TEXT NOT NULL,
  diff_json               JSONB NOT NULL DEFAULT '[]'::jsonb,
  ki_vorschlag_prompt     TEXT,
  ki_vorschlag_bestaetigt_von TEXT,
  CONSTRAINT aenderungs_event_projekt_seq_eindeutig UNIQUE (projekt_id, projekt_seq),
  CONSTRAINT aenderungs_event_ki_vollstaendig
    CHECK ((ki_vorschlag_prompt IS NULL) = (ki_vorschlag_bestaetigt_von IS NULL))
);

COMMENT ON TABLE  aenderungs_event IS
  'Append-only-Protokoll aller Aenderungen (Lastenheft Kap. 9). UPDATE/DELETE/TRUNCATE sind per Trigger gesperrt. Bewusst OHNE Fremdschluessel — das Protokoll muss jede Bereinigung ueberleben.';
COMMENT ON COLUMN aenderungs_event.seq IS 'Globale, physikalische Schreibreihenfolge (BIGSERIAL).';
COMMENT ON COLUMN aenderungs_event.projekt_seq IS
  'Fortlaufend JE PROJEKT — das ist das Feld `seq` aus dem Domaenenmodell und der Cursor fuer snapshot.event_cursor.';
COMMENT ON COLUMN aenderungs_event.diff_json IS 'FeldDiff[]: [{feld, vorher, nachher}]. Lange Geometrien sind gekuerzt ("[n Punkte]").';
COMMENT ON COLUMN aenderungs_event.nutzer_id IS 'DSGVO: Nutzer-ID (Pseudonym) — bleibt als Nachweis stehen.';
COMMENT ON COLUMN aenderungs_event.nutzer_name IS
  'DSGVO: Klarname. EINZIGE Spalte dieser Tabelle, die anonymisiert werden darf (siehe Abschnitt 12/13).';
COMMENT ON COLUMN aenderungs_event.ki_vorschlag_bestaetigt_von IS
  'DSGVO: Nutzer-ID (Pseudonym) — wer den KI-Vorschlag bestaetigt hat. Nachweis der menschlichen Freigabe.';

CREATE INDEX ix_aenderungs_event_projekt ON aenderungs_event (projekt_id, projekt_seq);
CREATE INDEX ix_aenderungs_event_nutzer ON aenderungs_event (nutzer_id);
CREATE INDEX ix_aenderungs_event_org ON aenderungs_event (org_id);
CREATE INDEX ix_aenderungs_event_zeit ON aenderungs_event (zeit);
CREATE INDEX ix_aenderungs_event_element ON aenderungs_event (element_art, element_id);


CREATE TABLE snapshot (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  zeit                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_cursor            BIGINT NOT NULL DEFAULT 0,
  erstellt_von            TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  inhalt                  JSONB NOT NULL,
  bemerkung               TEXT
);

COMMENT ON TABLE  snapshot IS 'Eingefrorener Projektstand als Grundlage von Einreichung und Freigabe.';
COMMENT ON COLUMN snapshot.event_cursor IS
  'Letzte enthaltene aenderungs_event.projekt_seq (NICHT die globale seq).';
COMMENT ON COLUMN snapshot.inhalt IS
  'Vollstaendiger ProjektInhalt als JSONB. Absichtlich NICHT normalisiert: ein Snapshot muss unveraendert bleiben, auch wenn sich das Schema weiterentwickelt. DSGVO: enthaelt Notizen und Nutzer-IDs.';
COMMENT ON COLUMN snapshot.erstellt_von IS 'DSGVO: Nutzer-ID (Pseudonym).';

CREATE INDEX ix_snapshot_projekt ON snapshot (projekt_id, zeit DESC);
CREATE INDEX ix_snapshot_erstellt_von ON snapshot (erstellt_von);


CREATE TABLE freigabe (
  id                      TEXT PRIMARY KEY,
  snapshot_id             TEXT NOT NULL
    REFERENCES snapshot (id) ON DELETE CASCADE,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  behoerden_org_id        TEXT NOT NULL
    REFERENCES organisation (id) ON DELETE RESTRICT,
  behoerden_org_name      TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'offen'
    CONSTRAINT freigabe_status_gueltig CHECK (status IN (
      'freigegeben', 'mit_auflagen', 'abgelehnt', 'offen')),
  kommentar               TEXT NOT NULL DEFAULT '',
  am                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  von_nutzer_id           TEXT REFERENCES nutzer (id) ON DELETE SET NULL,
  CONSTRAINT freigabe_je_snapshot_und_behoerde UNIQUE (snapshot_id, behoerden_org_id)
);

COMMENT ON TABLE  freigabe IS 'Stellungnahme einer Behoerde zu genau einem Snapshot.';
COMMENT ON COLUMN freigabe.behoerden_org_name IS 'Denormalisiert, damit der Bescheid auch nach Umbenennung lesbar bleibt.';
COMMENT ON COLUMN freigabe.von_nutzer_id IS 'DSGVO: Nutzer-ID (Pseudonym) der zeichnenden Person.';

CREATE INDEX ix_freigabe_projekt ON freigabe (projekt_id);
CREATE INDEX ix_freigabe_snapshot ON freigabe (snapshot_id);
CREATE INDEX ix_freigabe_org ON freigabe (behoerden_org_id);
CREATE INDEX ix_freigabe_nutzer ON freigabe (von_nutzer_id);


-- Auflagen haengen entweder an einem Objekt oder an einer Freigabe.
CREATE TABLE auflage (
  id                      TEXT PRIMARY KEY,
  objekt_id               TEXT REFERENCES objekt_instanz (id) ON DELETE CASCADE,
  freigabe_id             TEXT REFERENCES freigabe (id) ON DELETE CASCADE,
  "text"                  TEXT NOT NULL,
  von                     TEXT NOT NULL,
  von_org                 TEXT NOT NULL,
  am                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  erledigt                BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT auflage_genau_ein_traeger
    CHECK ((objekt_id IS NOT NULL)::int + (freigabe_id IS NOT NULL)::int = 1)
);

COMMENT ON TABLE  auflage IS 'Behoerdliche Auflage — am Objekt (ObjektInstanz.auflagen) oder an der Freigabe (Freigabe.auflagen).';
COMMENT ON COLUMN auflage.von IS
  'DSGVO: Klarname der verfuegenden Person (Domaenenfeld ohne Nutzer-ID, siehe Abweichungen). Beim Loeschen anonymisieren.';
COMMENT ON COLUMN auflage.von_org IS 'Name der verfuegenden Organisation (denormalisiert).';

CREATE INDEX ix_auflage_objekt ON auflage (objekt_id);
CREATE INDEX ix_auflage_freigabe ON auflage (freigabe_id);


-- ===========================================================================
-- 7. Regelwerk und Pruefung (F8)
-- ===========================================================================

CREATE TABLE regelwerk (
  id                      TEXT PRIMARY KEY,
  bundesland              TEXT NOT NULL,
  version                 TEXT NOT NULL,
  stand                   TEXT NOT NULL,
  bezeichnung             TEXT NOT NULL,
  haftungshinweis         TEXT NOT NULL
);

COMMENT ON TABLE  regelwerk IS 'Versionierte Regelsammlung je Bundesland (z. B. he-mvstaettvo-2026.1).';
COMMENT ON COLUMN regelwerk.haftungshinweis IS
  'Pflichttext, der in jedem Bericht erscheint. Die Pruefung ersetzt keine behoerdliche Entscheidung.';

CREATE INDEX ix_regelwerk_bundesland ON regelwerk (bundesland, version);

ALTER TABLE projekt
  ADD CONSTRAINT projekt_regelwerk_fk
  FOREIGN KEY (regelwerk_id) REFERENCES regelwerk (id) ON DELETE RESTRICT;


CREATE TABLE regelwerk_quelle (
  id                      BIGSERIAL PRIMARY KEY,
  regelwerk_id            TEXT NOT NULL
    REFERENCES regelwerk (id) ON DELETE CASCADE,
  kuerzel                 TEXT NOT NULL,
  titel                   TEXT NOT NULL,
  fassung                 TEXT,
  url                     TEXT
);

CREATE INDEX ix_regelwerk_quelle_regelwerk ON regelwerk_quelle (regelwerk_id);


CREATE TABLE regel (
  id                      TEXT PRIMARY KEY,
  regelwerk_id            TEXT NOT NULL
    REFERENCES regelwerk (id) ON DELETE CASCADE,
  titel                   TEXT NOT NULL,
  quelle_kuerzel          TEXT NOT NULL,
  quelle_paragraf         TEXT NOT NULL,
  quelle_zitat            TEXT,
  quelle_url              TEXT,
  geltung_bundesland      TEXT NOT NULL,
  geltung_umgebung        TEXT NOT NULL DEFAULT '*'
    CONSTRAINT regel_geltung_umgebung_gueltig CHECK (geltung_umgebung IN ('draussen', 'drinnen', '*')),
  pruef_typ               TEXT NOT NULL
    CONSTRAINT regel_pruef_typ_gueltig CHECK (pruef_typ IN (
      'wegbreite_min', 'wegbreite_staffelung', 'rettungsweg_engstelle',
      'rettungsweglaenge_max', 'abstand_objekt_objekt', 'abstand_objekt_gebaeude',
      'feuerwehrzufahrt_breite', 'feuerwehrzufahrt_hoehe', 'feuerwehr_erreichbarkeit',
      'feuerwehr_bewegungsflaeche', 'einausstieg_wegangebunden',
      'kapazitaet_vs_wegbreite', 'einsatzstation_erreichbarkeit', 'blockflaeche_frei')),
  parameter               JSONB NOT NULL DEFAULT '{}'::jsonb,
  schwellwerte            JSONB NOT NULL DEFAULT '{}'::jsonb,
  meldungstext            TEXT NOT NULL,
  schweregrad             TEXT NOT NULL
    CONSTRAINT regel_schweregrad_gueltig CHECK (schweregrad IN ('fehler', 'warnung', 'hinweis')),
  verifikation_status     TEXT NOT NULL DEFAULT 'zu_pruefen'
    CONSTRAINT regel_verifikation_status_gueltig CHECK (verifikation_status IN ('verifiziert', 'zu_pruefen')),
  verifikation_geprueft_am TEXT NOT NULL DEFAULT '',
  verifikation_beleg      TEXT NOT NULL DEFAULT '',
  aktiv                   BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE  regel IS 'Einzelregel mit Paragrafenbezug. Rechtsregeln werden nie aus dem Gedaechtnis gepflegt — quelle_* ist Pflicht.';
COMMENT ON COLUMN regel.schwellwerte IS 'Zahlenwerte der Regel, z. B. {"min_breite": 3.5}. Bewusst JSONB: je Prueftyp anders.';
COMMENT ON COLUMN regel.verifikation_beleg IS 'Fundstelle, an der der Wert amtlich nachgelesen wurde.';

CREATE INDEX ix_regel_regelwerk ON regel (regelwerk_id);
CREATE INDEX ix_regel_prueftyp ON regel (pruef_typ);


CREATE TABLE pruefbericht (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  snapshot_id             TEXT REFERENCES snapshot (id) ON DELETE SET NULL,
  regelwerk_id            TEXT NOT NULL
    REFERENCES regelwerk (id) ON DELETE RESTRICT,
  regelwerk_version       TEXT NOT NULL,
  zeit                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  zus_fehler              INTEGER NOT NULL DEFAULT 0,
  zus_warnungen           INTEGER NOT NULL DEFAULT 0,
  zus_hinweise            INTEGER NOT NULL DEFAULT 0,
  zus_ok                  INTEGER NOT NULL DEFAULT 0,
  zus_nicht_pruefbar      INTEGER NOT NULL DEFAULT 0,
  haftungshinweis         TEXT NOT NULL
);

COMMENT ON TABLE  pruefbericht IS 'Ergebnis eines Pruefdurchlaufs. Ohne snapshot_id = Zwischenstand im Editor.';
COMMENT ON COLUMN pruefbericht.regelwerk_version IS 'Denormalisiert: der Bericht muss zeigen, gegen welche Fassung geprueft wurde.';

CREATE INDEX ix_pruefbericht_projekt ON pruefbericht (projekt_id, zeit DESC);
CREATE INDEX ix_pruefbericht_snapshot ON pruefbericht (snapshot_id);
CREATE INDEX ix_pruefbericht_regelwerk ON pruefbericht (regelwerk_id);


CREATE TABLE pruefergebnis (
  id                      TEXT PRIMARY KEY,
  bericht_id              TEXT NOT NULL
    REFERENCES pruefbericht (id) ON DELETE CASCADE,
  regel_id                TEXT NOT NULL,
  regel_titel             TEXT NOT NULL,
  pruef_typ               TEXT NOT NULL
    CONSTRAINT pruefergebnis_pruef_typ_gueltig CHECK (pruef_typ IN (
      'wegbreite_min', 'wegbreite_staffelung', 'rettungsweg_engstelle',
      'rettungsweglaenge_max', 'abstand_objekt_objekt', 'abstand_objekt_gebaeude',
      'feuerwehrzufahrt_breite', 'feuerwehrzufahrt_hoehe', 'feuerwehr_erreichbarkeit',
      'feuerwehr_bewegungsflaeche', 'einausstieg_wegangebunden',
      'kapazitaet_vs_wegbreite', 'einsatzstation_erreichbarkeit', 'blockflaeche_frei')),
  status                  TEXT NOT NULL
    CONSTRAINT pruefergebnis_status_gueltig CHECK (status IN ('ok', 'verstoss', 'nicht_pruefbar')),
  schweregrad             TEXT NOT NULL
    CONSTRAINT pruefergebnis_schweregrad_gueltig CHECK (schweregrad IN ('fehler', 'warnung', 'hinweis')),
  meldung                 TEXT NOT NULL,
  ist_wert                DOUBLE PRECISION,
  soll_wert               DOUBLE PRECISION,
  einheit                 TEXT NOT NULL DEFAULT '',
  elemente_json           JSONB NOT NULL DEFAULT '[]'::jsonb,
  ort                     geometry(Point, 25832),
  geometrie               geometry(Polygon, 25832),
  fundstelle              TEXT NOT NULL DEFAULT '',
  empfehlung_text         TEXT,
  empfehlung_element_id   TEXT,
  empfehlung_element_art  TEXT
    CONSTRAINT pruefergebnis_empfehlung_element_art_gueltig
      CHECK (empfehlung_element_art IS NULL OR empfehlung_element_art IN (
        'objekt', 'weg', 'blockflaeche', 'einsatzstation', 'projekt', 'kommentar', 'objekttyp')),
  empfehlung_d_e          DOUBLE PRECISION,
  empfehlung_d_n          DOUBLE PRECISION,
  empfehlung_meter        DOUBLE PRECISION,
  empfehlung_richtung     TEXT
);

COMMENT ON COLUMN pruefergebnis.regel_id IS
  'Bewusst OHNE Fremdschluessel: ein Bericht bleibt lesbar, auch wenn die Regel spaeter aus dem Regelwerk faellt.';
COMMENT ON COLUMN pruefergebnis.elemente_json IS 'ElementRef[]: [{art, id}] — betroffene Elemente, Klick springt im 3D dorthin.';
COMMENT ON COLUMN pruefergebnis.ort IS 'Ort des Verstosses (EPSG:25832) fuer "Sprung zum Ort".';
COMMENT ON COLUMN pruefergebnis.geometrie IS 'Optionale Hilfsgeometrie zum Einblenden, z. B. die Engstelle.';
COMMENT ON COLUMN pruefergebnis.empfehlung_d_e IS 'Deterministischer Verschiebevorschlag in Metern (Rechtswert).';

CREATE INDEX gix_pruefergebnis_ort ON pruefergebnis USING GIST (ort);
CREATE INDEX gix_pruefergebnis_geometrie ON pruefergebnis USING GIST (geometrie);
CREATE INDEX ix_pruefergebnis_bericht ON pruefergebnis (bericht_id);
CREATE INDEX ix_pruefergebnis_regel ON pruefergebnis (regel_id);


-- ===========================================================================
-- 8. Kollaboration / Realtime
-- ===========================================================================
-- Beides ist fluechtig: UNLOGGED spart WAL, ein Neustart darf den Inhalt
-- verlieren. Im Dateispeicher lebt dieser Zustand nur im Arbeitsspeicher.

CREATE UNLOGGED TABLE sperre (
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  element_art             TEXT NOT NULL
    CONSTRAINT sperre_element_art_gueltig CHECK (element_art IN (
      'objekt', 'weg', 'blockflaeche', 'einsatzstation', 'projekt', 'kommentar', 'objekttyp')),
  element_id              TEXT NOT NULL,
  nutzer_id               TEXT NOT NULL
    REFERENCES nutzer (id) ON DELETE CASCADE,
  nutzer_name             TEXT NOT NULL,
  seit                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  laeuft_ab_um            TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (projekt_id, element_art, element_id)
);

COMMENT ON TABLE  sperre IS 'Bearbeitungssperre je Element. Verfaellt nach 5 min ohne Aktivitaet (Lastenheft Kap. 5).';
COMMENT ON COLUMN sperre.nutzer_name IS 'DSGVO: Klarname, nur fuer die Anzeige "wird bearbeitet von ...". Fluechtig.';

CREATE INDEX ix_sperre_nutzer ON sperre (nutzer_id);
CREATE INDEX ix_sperre_ablauf ON sperre (laeuft_ab_um);


CREATE UNLOGGED TABLE praesenz (
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  nutzer_id               TEXT NOT NULL
    REFERENCES nutzer (id) ON DELETE CASCADE,
  nutzer_name             TEXT NOT NULL,
  org_name                TEXT NOT NULL,
  farbe                   TEXT NOT NULL,
  "cursor"                geometry(Point, 25832),
  auswahl_json            JSONB NOT NULL DEFAULT '[]'::jsonb,
  zuletzt                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projekt_id, nutzer_id)
);

COMMENT ON TABLE  praesenz IS 'Wer ist gerade im Projekt, wo steht sein Zeiger. Rein fluechtig.';
COMMENT ON COLUMN praesenz.nutzer_name IS 'DSGVO: Klarname (Anzeige der Mitarbeitenden).';
COMMENT ON COLUMN praesenz."cursor" IS
  'DSGVO: Zeigerposition auf dem Gelaende (EPSG:25832) — Verhaltensdaten. Nie ueber die Sitzung hinaus aufbewahren.';

CREATE INDEX gix_praesenz_cursor ON praesenz USING GIST ("cursor");
CREATE INDEX ix_praesenz_nutzer ON praesenz (nutzer_id);


CREATE TABLE benachrichtigung (
  id                      TEXT PRIMARY KEY,
  nutzer_id               TEXT NOT NULL
    REFERENCES nutzer (id) ON DELETE CASCADE,
  projekt_id              TEXT REFERENCES projekt (id) ON DELETE CASCADE,
  art                     TEXT NOT NULL
    CONSTRAINT benachrichtigung_art_gueltig CHECK (art IN (
      'einladung', 'einreichung', 'statuswechsel', 'erwaehnung', 'auflage')),
  titel                   TEXT NOT NULL,
  "text"                  TEXT NOT NULL,
  am                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  gelesen                 BOOLEAN NOT NULL DEFAULT false,
  link                    TEXT
);

COMMENT ON TABLE  benachrichtigung IS 'Postfach eines Nutzers. Beim Loeschen des Nutzers ersatzlos entfernen.';
COMMENT ON COLUMN benachrichtigung."text" IS 'DSGVO: Kann Klarnamen Dritter enthalten ("X hat Sie erwaehnt").';

CREATE INDEX ix_benachrichtigung_nutzer ON benachrichtigung (nutzer_id, am DESC);
CREATE INDEX ix_benachrichtigung_projekt ON benachrichtigung (projekt_id);


-- ===========================================================================
-- 9. KI-Dialog (F7)
-- ===========================================================================

CREATE TABLE ki_nachricht (
  id                      TEXT PRIMARY KEY,
  projekt_id              TEXT NOT NULL
    REFERENCES projekt (id) ON DELETE CASCADE,
  nutzer_id               TEXT NOT NULL
    REFERENCES nutzer (id) ON DELETE CASCADE,
  rolle                   TEXT NOT NULL
    CONSTRAINT ki_nachricht_rolle_gueltig CHECK (rolle IN ('nutzer', 'assistent')),
  "text"                  TEXT NOT NULL,
  am                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  vorschlaege_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  quelle                  TEXT
    CONSTRAINT ki_nachricht_quelle_gueltig CHECK (quelle IS NULL OR quelle IN ('anthropic', 'lokal'))
);

COMMENT ON TABLE  ki_nachricht IS
  'Dialogverlauf mit dem Assistenten. Vorschlaege sind reine Vorschlaege — wirksam werden sie erst als bestaetigtes aenderungs_event.';
COMMENT ON COLUMN ki_nachricht."text" IS
  'DSGVO: Freitext des Nutzers bzw. Antwort des Modells. Beim Loeschen des Nutzers ersatzlos entfernen.';
COMMENT ON COLUMN ki_nachricht.vorschlaege_json IS 'KiVorschlag[]: platzieren / verschieben / weg_aendern samt Begruendung.';

CREATE INDEX ix_ki_nachricht_projekt ON ki_nachricht (projekt_id, am);
CREATE INDEX ix_ki_nachricht_nutzer ON ki_nachricht (nutzer_id);


-- ===========================================================================
-- 10. Sichten
-- ===========================================================================

-- Betreiberliste je Projekt: Standnummer, Objekt, Betreiberfirma, Kontakt.
-- Grundlage der Standliste im Genehmigungsordner.
CREATE VIEW v_betreiberliste AS
SELECT
  p.id                        AS projekt_id,
  p.name                      AS projekt_name,
  oi.stand_nummer,
  oi.id                       AS objekt_id,
  ot.name                     AS objekt,
  ot.kategorie                AS objekt_kategorie,
  oi.status                   AS objekt_status,
  betr.id                     AS betreiber_org_id,
  betr.name                   AS betreiberfirma,
  betr.adresse                AS betreiber_adresse,
  kontakt.name                AS kontakt_name,
  kontakt.email               AS kontakt_email,
  ST_X(oi."position")         AS position_e,
  ST_Y(oi."position")         AS position_n
FROM objekt_instanz oi
JOIN projekt     p    ON p.id  = oi.projekt_id
JOIN objekt_typ  ot   ON ot.id = oi.typ_id
LEFT JOIN organisation betr ON betr.id = oi.betreiber_org_id
LEFT JOIN LATERAL (
  SELECT n.name, n.email
  FROM nutzer n
  WHERE n.org_id = betr.id
  ORDER BY (n.rolle_in_org = 'admin') DESC, n.erstellt_am
  LIMIT 1
) kontakt ON true;

COMMENT ON VIEW v_betreiberliste IS
  'Standliste je Projekt. Kontakt = Admin der Betreiber-Organisation, sonst deren aeltester Zugang. DSGVO: enthaelt Klarname und E-Mail — nur an berechtigte Behoerden ausgeben.';


-- ===========================================================================
-- 11. Hilfssichten fuer die Geometrie-Gegenprobe
-- ===========================================================================

-- Zeigt ungueltige Flaechen. Sollte im Betrieb immer leer sein.
CREATE VIEW v_geometrie_pruefung AS
SELECT 'gelaende'          AS tabelle, id, ST_IsValidReason(polygon)   AS grund FROM gelaende            WHERE NOT ST_IsValid(polygon)
UNION ALL
SELECT 'gelaende_gebaeude' AS tabelle, id, ST_IsValidReason(grundriss) AS grund FROM gelaende_gebaeude   WHERE NOT ST_IsValid(grundriss)
UNION ALL
SELECT 'gelaende_flurstueck', id, ST_IsValidReason(polygon)            FROM gelaende_flurstueck WHERE NOT ST_IsValid(polygon)
UNION ALL
SELECT 'blockflaeche',        id, ST_IsValidReason(polygon)            FROM blockflaeche        WHERE NOT ST_IsValid(polygon)
UNION ALL
SELECT 'einsatzstation',      id, ST_IsValidReason(geom)               FROM einsatzstation      WHERE NOT ST_IsValid(geom);

COMMENT ON VIEW v_geometrie_pruefung IS 'Gegenprobe nach dem Import: sollte keine Zeile liefern.';


-- ===========================================================================
-- 12. Append-Only-Schutz fuer aenderungs_event (Lastenheft Kap. 9)
-- ===========================================================================
-- WICHTIG: Beim Erstimport diese Trigger erst NACH dem Laden anlegen, oder
-- vorher mit ALTER TABLE aenderungs_event DISABLE TRIGGER USER; abschalten.

CREATE OR REPLACE FUNCTION aenderungs_event_unveraenderlich()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'aenderungs_event ist append-only (Lastenheft Kap. 9): DELETE ist nicht erlaubt (seq=%)', OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Einzige Ausnahme: DSGVO-Anonymisierung des Klarnamens. Sie muss sich
  -- ausdruecklich anmelden und darf ausschliesslich nutzer_name aendern.
  IF coalesce(current_setting('heinerfest.dsgvo_loeschung', true), '') <> 'an' THEN
    RAISE EXCEPTION
      'aenderungs_event ist append-only (Lastenheft Kap. 9): UPDATE ist nicht erlaubt (seq=%)', OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.seq, NEW.id, NEW.projekt_id, NEW.projekt_seq, NEW.nutzer_id, NEW.org_id, NEW.zeit,
      NEW.aktion, NEW.element_art, NEW.element_id, NEW.bezeichnung, NEW.diff_json,
      NEW.ki_vorschlag_prompt, NEW.ki_vorschlag_bestaetigt_von)
     IS DISTINCT FROM
     (OLD.seq, OLD.id, OLD.projekt_id, OLD.projekt_seq, OLD.nutzer_id, OLD.org_id, OLD.zeit,
      OLD.aktion, OLD.element_art, OLD.element_id, OLD.bezeichnung, OLD.diff_json,
      OLD.ki_vorschlag_prompt, OLD.ki_vorschlag_bestaetigt_von)
  THEN
    RAISE EXCEPTION
      'DSGVO-Anonymisierung darf ausschliesslich nutzer_name aendern (seq=%)', OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION aenderungs_event_unveraenderlich() IS
  'Sperrt UPDATE und DELETE auf dem Audit-Log. Laesst nur die angemeldete DSGVO-Anonymisierung von nutzer_name durch.';

CREATE TRIGGER trg_aenderungs_event_unveraenderlich
  BEFORE UPDATE OR DELETE ON aenderungs_event
  FOR EACH ROW
  EXECUTE FUNCTION aenderungs_event_unveraenderlich();


CREATE OR REPLACE FUNCTION aenderungs_event_kein_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'aenderungs_event ist append-only (Lastenheft Kap. 9): TRUNCATE ist nicht erlaubt'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_aenderungs_event_kein_truncate
  BEFORE TRUNCATE ON aenderungs_event
  FOR EACH STATEMENT
  EXECUTE FUNCTION aenderungs_event_kein_truncate();


-- Bequemlichkeit: projekt_seq automatisch aus projekt.letzte_seq ziehen,
-- damit der Zaehler nicht in der Anwendung verloren gehen kann.
CREATE OR REPLACE FUNCTION aenderungs_event_seq_vergeben()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.projekt_seq IS NULL OR NEW.projekt_seq = 0 THEN
    UPDATE projekt
       SET letzte_seq = letzte_seq + 1
     WHERE id = NEW.projekt_id
    RETURNING letzte_seq INTO NEW.projekt_seq;
    IF NEW.projekt_seq IS NULL THEN
      RAISE EXCEPTION 'Unbekanntes Projekt % im Aenderungsprotokoll', NEW.projekt_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aenderungs_event_seq
  BEFORE INSERT ON aenderungs_event
  FOR EACH ROW
  EXECUTE FUNCTION aenderungs_event_seq_vergeben();


-- ===========================================================================
-- 13. DSGVO — Loeschanweisungen
-- ===========================================================================
--
-- Grundsatz: Der Nachweis, DASS eine Aenderung stattfand, ist Teil der
-- Veranstaltungsdokumentation und bleibt bestehen. Geloescht bzw. ersetzt
-- wird alles, was die Person IDENTIFIZIERBAR macht; die Nutzer-ID bleibt als
-- Pseudonym stehen.
--
-- Betroffene Zeilen beim Loeschen eines NUTZERS:
--   anonymisieren : nutzer.name, nutzer.email, nutzer.passwort_hash,
--                   nutzer.letzter_besuch
--                   kommentar.autor_name, kommentar_antwort.autor_name
--                   aenderungs_event.nutzer_name  (einzige erlaubte Aenderung
--                                                  am Audit-Log, s. Abschnitt 12)
--   bereinigen    : kommentar.erwaehnungen (ID entfernen)
--   loeschen      : benachrichtigung, ki_nachricht, sperre, praesenz
--   unveraendert  : alle *_erstellt_von / autor_id / von_nutzer_id /
--                   nutzer_id (Pseudonyme, Nachweisfunktion)
--   NICHT automatisch erfasst (manuell pruefen, Freitext):
--                   objekt_instanz.notizen, einsatzstation.notizen,
--                   weg.name, blockflaeche.name, auflage.text, auflage.von,
--                   snapshot.inhalt (eingefrorenes JSONB)
--
-- Betroffene Zeilen beim Loeschen einer ORGANISATION:
--   Voraussetzung : keine Projekte, Mitgliedschaften, Freigaben, Objekte oder
--                   Einsatzstationen mehr verknuepft (ON DELETE RESTRICT
--                   verhindert das Loeschen sonst). Zuerst alle Nutzer der
--                   Organisation anonymisieren.
--   anonymisieren : organisation.name, organisation.adresse
--                   freigabe.behoerden_org_name (denormalisierter Klarname)
--                   auflage.von_org
--   unveraendert  : organisation.id, aenderungs_event.org_id (Pseudonyme)

CREATE OR REPLACE FUNCTION dsgvo_nutzer_anonymisieren(p_nutzer_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_platzhalter TEXT := 'Geloeschter Nutzer';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nutzer WHERE id = p_nutzer_id) THEN
    RAISE EXCEPTION 'Unbekannter Nutzer %', p_nutzer_id;
  END IF;

  -- Fuer diese Transaktion die Audit-Ausnahme anmelden (siehe Abschnitt 12).
  PERFORM set_config('heinerfest.dsgvo_loeschung', 'an', true);

  UPDATE nutzer
     SET name           = v_platzhalter,
         email          = 'geloescht+' || p_nutzer_id || '@invalid',
         passwort_hash  = '',
         letzter_besuch = NULL
   WHERE id = p_nutzer_id;

  UPDATE aenderungs_event SET nutzer_name = v_platzhalter WHERE nutzer_id = p_nutzer_id;
  UPDATE kommentar         SET autor_name = v_platzhalter WHERE autor_id  = p_nutzer_id;
  UPDATE kommentar_antwort SET autor_name = v_platzhalter WHERE autor_id  = p_nutzer_id;

  UPDATE kommentar
     SET erwaehnungen = array_remove(erwaehnungen, p_nutzer_id)
   WHERE erwaehnungen @> ARRAY[p_nutzer_id];

  DELETE FROM benachrichtigung WHERE nutzer_id = p_nutzer_id;
  DELETE FROM ki_nachricht     WHERE nutzer_id = p_nutzer_id;
  DELETE FROM sperre           WHERE nutzer_id = p_nutzer_id;
  DELETE FROM praesenz         WHERE nutzer_id = p_nutzer_id;

  PERFORM set_config('heinerfest.dsgvo_loeschung', 'aus', true);

  RAISE NOTICE 'Nutzer % anonymisiert. Freitexte (Notizen, Auflagen, snapshot.inhalt) manuell pruefen.', p_nutzer_id;
END;
$$;

COMMENT ON FUNCTION dsgvo_nutzer_anonymisieren(TEXT) IS
  'Anonymisiert alle personenbezogenen Klartextfelder eines Nutzers. Pseudonyme IDs bleiben als Nachweis erhalten.';


CREATE OR REPLACE FUNCTION dsgvo_organisation_anonymisieren(p_org_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_platzhalter TEXT := 'Geloeschte Organisation';
  v_nutzer_id   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organisation WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Unbekannte Organisation %', p_org_id;
  END IF;

  FOR v_nutzer_id IN SELECT id FROM nutzer WHERE org_id = p_org_id LOOP
    PERFORM dsgvo_nutzer_anonymisieren(v_nutzer_id);
  END LOOP;

  UPDATE organisation
     SET name    = v_platzhalter,
         adresse = NULL
   WHERE id = p_org_id;

  UPDATE freigabe SET behoerden_org_name = v_platzhalter WHERE behoerden_org_id = p_org_id;
  UPDATE auflage  SET von_org            = v_platzhalter
   WHERE freigabe_id IN (SELECT id FROM freigabe WHERE behoerden_org_id = p_org_id);

  RAISE NOTICE 'Organisation % anonymisiert. Verknuepfte Projekte bleiben bestehen (Nachweispflicht).', p_org_id;
END;
$$;

COMMENT ON FUNCTION dsgvo_organisation_anonymisieren(TEXT) IS
  'Anonymisiert eine Organisation samt ihrer Nutzer. Loescht keine Projektinhalte — dafuer gilt ON DELETE RESTRICT.';

COMMIT;


-- ===========================================================================
-- Abweichungen zum Dateispeicher
-- ===========================================================================
-- Diese Punkte brauchen beim Umstieg Aufmerksamkeit — hier weicht das
-- relationale Modell bewusst vom JSON-Speicher (server/lib/store.ts) ab:
--
--  1. seq ist zweigeteilt. Im Domaenenmodell ist AenderungsEvent.seq je
--     Projekt fortlaufend. Hier: `projekt_seq` = dieses Feld, `seq` =
--     globaler BIGSERIAL. snapshot.event_cursor zeigt auf projekt_seq.
--     Wer beim Import blind auf `seq` mappt, verschiebt alle Snapshots.
--
--  2. Projekte lassen sich nicht mehr loeschen. aenderungs_event traegt
--     absichtlich KEINEN Fremdschluessel und ist DELETE-gesperrt; ein Projekt
--     wird auf status='abgeschlossen' gesetzt und archiviert. Der
--     Dateispeicher loescht dagegen den ganzen Ordner (projekte.loeschen).
--
--  3. Ringe werden zu Polygonen. Die Domaene fuehrt Ringe OHNE wiederholten
--     Schlusspunkt, PostGIS verlangt ihn. Beim Import schliessen, beim Export
--     den letzten Punkt wieder abschneiden — sonst wachsen die Ringe bei
--     jedem Rundlauf um einen Punkt.
--
--  4. Zeiten werden zu TIMESTAMPTZ. Die Domaene speichert ISO-Strings.
--     Ausnahmen: regel.verifikation_geprueft_am und bibliothek.stand bleiben
--     TEXT — dort stehen auch unscharfe Angaben wie "Okt 2025".
--
--  5. Verschachtelte Objekte wurden zu eigenen Tabellen: Gelaende.patches /
--     .gebaeude / .flurstuecke / .quellennachweis, ObjektTyp.einAusstiege,
--     ObjektInstanz.auflagen und Freigabe.auflagen (gemeinsame Tabelle
--     `auflage` mit CHECK auf genau einen Traeger), Kommentar.antworten,
--     Regelwerk.quellen / .regeln, Pruefbericht.ergebnisse.
--
--  6. Bewusst JSONB geblieben: gelaende_patch.hoehen (Hoehengitter),
--     regel.parameter / .schwellwerte, pruefergebnis.elemente_json,
--     aenderungs_event.diff_json, ki_nachricht.vorschlaege_json und vor allem
--     snapshot.inhalt. Ein Snapshot muss unveraendert bleiben, auch wenn das
--     Schema sich weiterentwickelt — er darf NICHT normalisiert werden.
--
--  7. Zusammengesetzte Werte wurden flachgeklopft: BBox -> bbox_min_e/_min_n/
--     _max_e/_max_n, Masse -> masse_laenge/_breite/_hoehe, minMax -> min_*/max_*,
--     technik -> technik_*, ElementRef -> element_art + element_id,
--     RegelQuelle -> quelle_*, Verifikation -> verifikation_*,
--     Empfehlung -> empfehlung_*, Zusammenfassung -> zus_*.
--
--  8. Neue Felder ohne Entsprechung in der Domaene: projekt.letzte_seq
--     (= ProjektDatei.letzteSeq), pruefbericht.id, bibliothek.id,
--     objekt_typ.bibliothek_id, sperre.projekt_id, praesenz.projekt_id,
--     ki_nachricht.id/.projekt_id/.nutzer_id. Diese muss der Importer setzen.
--
--  9. Auflage.von ist ein Klarname OHNE Nutzer-ID. Die DSGVO-Anonymisierung
--     kann diese Spalte darum nicht automatisch treffen. Beim Umstieg eine
--     Spalte `von_nutzer_id` ergaenzen und die Domaene nachziehen.
--
-- 10. `position`, `text` und `cursor` sind in SQL heikle Bezeichner und stehen
--     darum in Anfuehrungszeichen. Jede Abfrage muss sie ebenfalls quoten.
--
-- 11. sperre und praesenz sind UNLOGGED — nach einem Absturz sind sie leer.
--     Das ist gewollt (im Dateispeicher leben sie nur im Arbeitsspeicher),
--     aber der Realtime-Hub muss den leeren Zustand vertragen.
--
-- 12. Gelaende-Texturen und glTF-Dateien bleiben im Dateisystem; in der
--     Datenbank steht nur der Pfad (gelaende_patch.textur_datei,
--     objekt_typ.gltf_datei). Ein Datenbank-Dump allein ist kein Backup.
--
-- 13. Sitzungen liegen weiterhin im signierten Cookie (server/lib/auth.ts),
--     es gibt bewusst keine Sitzungstabelle.
--
-- 14. Die Geometrie-Rechnungen bleiben im gemeinsamen Kern (shared/geo).
--     PostGIS dient hier der Speicherung, der Indizierung und der Vorauswahl
--     (ST_DWithin, &&) — NICHT der Bemassung im Bericht. Sonst weichen
--     Editor und Bericht in der letzten Nachkommastelle voneinander ab.
-- ===========================================================================
