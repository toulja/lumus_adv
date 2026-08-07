# Sicherheits- und Datenschutzprüfung EventPlan3D

**Stand:** 07.08.2026 · **Prüfumfang:** `server/**`, `shared/**`, `scripts/**`, `web/**`, ausgeliefertes Bündel `dist/`
**Methode:** Quelltext gelesen (nicht geraten) + Live-Angriffe mit `curl` gegen den laufenden Dienst auf Port 4720 mit den Konten aus `scripts/seed.ts`.

---

## 1. Zusammenfassung (Ampel)

| Bereich | Vorher | Jetzt | Bemerkung |
|---|---|---|---|
| Authentifizierung (Verfahren) | 🟡 | 🟡 | scrypt korrekt, aber Kosten am unteren Rand; kein Schutz gegen Rateversuche |
| Sitzungsgeheimnis | 🔴 | 🟡 | Sitzungen waren fälschbar; Produktivbetrieb bricht jetzt ohne `HEINERFEST_SECRET` ab |
| Rechtemodell (Kern) | 🟢 | 🟢 | Rollenmatrix + Objektbindung greifen sauber |
| Rechtemodell (Lücken) | 🔴 | 🟢 | 2 schreibende Routen ganz ohne Prüfung — behoben |
| Pfad-Traversal | 🔴 | 🟢 | Unangemeldeter Dateizugriff außerhalb `data/` — behoben |
| Eingabeprüfung | 🔴 | 🟢 | Beliebige Geometrie zerstörte Berichte dauerhaft — behoben |
| DSGVO / KI-Kontext | 🟢 | 🟢 | **Keine** personenbezogenen Daten gehen an die Anthropic-API (empirisch belegt) |
| Geheimnisse im Code | 🟢 | 🟢 | Kein Schlüssel im Quelltext, keiner im Frontend-Bündel |
| Betriebsart | 🟡 | 🟡 | Bewusst lokale Installation — siehe Abschnitt 9 |

**Gesamtbild:** Das Rechtemodell ist gut entworfen — es gibt *eine* Wahrheit (`server/lib/rechte.ts`), und die zentrale Rollenauflösung funktioniert. Die gefundenen kritischen Fehler waren **keine Denkfehler im Modell, sondern Routen, die an diesem Modell vorbeigebaut waren**. Alle vier kritischen und wichtigen Befunde sind behoben und live nachgeprüft. Was bleibt, ist die Betriebsart: Diese Installation ist für den **lokalen Einzelplatzbetrieb** gebaut und trägt einen echten Mehrbenutzerbetrieb noch nicht (Abschnitt 9 und 10).

---

## 2. Authentifizierung (`server/lib/auth.ts`)

### 2.1 Passwortverfahren — Bewertung: **hinweis**

**Befund.** `passwortHashen` nutzt `crypto.scryptSync(pw, salt, 64)` mit 16 Byte Zufallssalz je Nutzer. Das Format ist `salt:hash` in Hex. Der Vergleich in `passwortPruefen` läuft über `crypto.timingSafeEqual` und prüft vorher die Länge — das ist korrekt gemacht und nicht durch Laufzeitmessung angreifbar.

Die Kostenparameter sind jedoch die **Node-Standardwerte** `N=16384, r=8, p=1`. Gemessen: rund **38 ms je Hash** auf diesem Rechner. Das ist der historische Mindestwert; heute üblich ist `N=2^17`. Die Parameter werden außerdem **nicht mitgespeichert** — eine spätere Erhöhung würde alle bestehenden Passwörter ungültig machen, weil `passwortPruefen` wieder mit den Standardwerten rechnet.

**Was getan wurde.** Nichts — eine Änderung der Kosten ohne Migrationspfad würde alle vorhandenen Konten aussperren. Das wäre ein Schaden, kein Gewinn.

**Vor Produktivbetrieb.** Hashformat auf ein selbstbeschreibendes Format umstellen (z. B. `scrypt$N$r$p$salt$hash`), beim Prüfen die Parameter aus dem gespeicherten Wert lesen, alte `salt:hash`-Werte weiter mit den Standardwerten verifizieren und beim nächsten erfolgreichen Anmelden transparent neu hashen. Danach `N` auf `131072` anheben.

### 2.2 Sitzungsgeheimnis — Bewertung: **kritisch** (behoben)

**Befund.** Fehlte `HEINERFEST_SECRET`, wurde das Signaturgeheimnis abgeleitet aus:

```
sha256("heinerfest-dev-" + process.cwd())
```

Der Installationspfad ist kein Geheimnis. Wer ihn kennt oder rät, berechnet das Geheimnis und signiert sich ein gültiges Sitzungscookie für **jeden beliebigen Nutzer**.

**Live belegt.** Ohne Kenntnis irgendeines Passworts wurde ein Cookie für den Plattform-Admin erzeugt; `GET /api/auth/ich` antwortete:

```json
{"id":"u_44dbeafd45e3a9a8","orgTyp":"plattform","name":"Plattform-Admin","email":"admin@eventplan3d.de","rolleInOrg":"admin"}
```

Plattform-Admin ist die höchste Rolle — sie darf laut Matrix alles in jedem Projekt.

**Was getan wurde.** `server/lib/auth.ts`:
- Bei `NODE_ENV=production` **bricht der Start ab**, wenn `HEINERFEST_SECRET` fehlt, mit Klartextbegründung und Beispielbefehl zur Erzeugung.
- Ein gesetztes Geheimnis unter 32 Zeichen wird ebenfalls abgelehnt.
- Im lokalen Betrieb bleibt das abgeleitete Geheimnis erhalten (sonst überlebten Sitzungen keinen Neustart), **aber der Server warnt jetzt beim Start sichtbar**, dass Cookies fälschbar sind.

Nachgeprüft: `NODE_ENV=production node server/index.ts` bricht ab; mit gesetztem Geheimnis startet er.

### 2.3 Sitzungscookie — Bewertung: **hinweis** (teilweise behoben)

**Befund.** Gesetzt waren `httpOnly` ✔, `sameSite=lax` ✔, `path=/` ✔, Laufzeit **14 Tage**. Es fehlte `secure`. Die Signatur ist HMAC-SHA256 über eine base64url-Nutzlast, geprüft mit `timingSafeEqual` und vorheriger Längenprüfung — handwerklich sauber.

Zwei Eigenschaften bleiben systembedingt:
- Die Sitzung ist **zustandslos**. Es gibt keine serverseitige Widerrufsliste — ein abgegriffenes Cookie gilt bis zum Ablauf, „Abmelden“ löscht es nur im Browser. Ein Passwortwechsel macht alte Cookies **nicht** ungültig.
- 14 Tage sind für Behördendaten lang.

**Was getan wurde.** `secure` wird jetzt gesetzt, sobald `HEINERFEST_HTTPS=1` oder `NODE_ENV=production` gilt. Im lokalen HTTP-Betrieb bleibt es aus — sonst käme keine Anmeldung mehr zustande.

**Vor Produktivbetrieb.** Laufzeit auf 8–24 h senken mit stillschweigender Verlängerung bei Aktivität; eine Sitzungsversion je Nutzer einführen (Zähler im Nutzerdatensatz, in die Nutzlast aufnehmen), damit Passwortwechsel und „überall abmelden“ wirken.

### 2.4 Rateversuche und Nutzerauskunft — Bewertung: **wichtig** (offen)

**Befund.** `POST /api/auth/anmelden` hat **keinerlei Bremse**. Live geprüft: 12 Fehlversuche in Folge → 12 × HTTP 401, danach war das richtige Passwort sofort wieder gültig. Weder Verzögerung noch Sperre noch Protokollierung.

Bei den Startpasswörtern (`heiner1234`, `stand1234`, `amt12345` …) und ~38 ms je Prüfung ist das praktisch relevant.

Zusätzlich: `anmelden()` kehrt bei unbekannter E-Mail **vor** dem scrypt-Aufruf zurück. Der messbare Laufzeitunterschied verrät, welche E-Mail-Adressen existieren.

**Was getan wurde.** Nichts — eine Sperrlogik ist ein Entwurfsschritt (Wo zählen? Pro Konto oder pro Absender? Wie entsperren?) und gehört nicht als Schnellschuss in eine Prüfung. Der KI-Assistent hat mit `rateLimitPruefen` bereits ein Vorbild im Haus (`server/ai/assistent.ts`), an dem sich das ausrichten lässt.

**Vor Produktivbetrieb.** Verzögerung nach Fehlversuch, Sperre nach ~10 Versuchen je Konto und je Absenderadresse, Fehlversuche protokollieren. Für die Nutzerauskunft: auch bei unbekannter E-Mail einen scrypt-Vergleich gegen einen festen Blindwert rechnen.

### 2.5 Registrierung — Bewertung: **hinweis**

`POST /api/auth/registrieren` ist **offen**: Jeder kann sich ein Konto in einer **beliebigen** Organisation anlegen — auch bei „Polizeipräsidium Südhessen“ oder „EventPlan3D Betrieb“ (Plattform-Admin!). Mindestlänge Passwort: 8 Zeichen. Der Quelltext deklariert das als Absicht („im lokalen Betrieb offen, damit Rollen ausprobierbar sind“), und für einen Erprobungsstand ist das vertretbar. Im Netzbetrieb ist es ein direkter Weg zur höchsten Rolle.

**Vor Produktivbetrieb.** Selbstregistrierung abschalten oder auf Einladung mit Einmal-Kennung umstellen; Organisationszuordnung nie aus der Anfrage übernehmen.

---

## 3. Rechtemodell — Prüfung jeder schreibenden Route

Die Rollenauflösung sitzt zentral in `rolleFuer()` (`server/lib/rechte.ts`) und ist über `projektKontext()` (`server/routes/projekte.ts`) allen Projektrouten vorgeschaltet: Wer keine Rolle im Projekt hat, bekommt 403, bevor irgendein Code des Endpunkts läuft. Das ist die tragende Konstruktion und sie hält.

**Legende:** ✅ geprüft · ⚠️ nur Mitgliedschaft · ❌ Lücke (behoben)

### 3.1 `server/routes/projekte.ts`

| Route | Methode | geprüftes Recht | zusätzliche Bindung |
|---|---|---|---|
| `/api/projekte` | POST | ✅ Org-Typ `veranstalter`/`plattform` | Gelände muss existieren, `maxBesucher > 0` |
| `/api/projekte/:id` | PATCH | ✅ `projekt.aendern` | Feld-Weißliste; `maxBesucher > 0` mit Rücknahme |
| `/api/projekte/:id` | DELETE | ✅ `projekt.loeschen` | — |
| `/:id/einladen` | POST | ✅ `einladen` | Polizei kann nicht eingeladen werden |
| `/:id/beteiligte/:orgId` | DELETE | ✅ `einladen` | Veranstalter nicht entfernbar |
| `/:id/objekte` | POST | ✅ `element.anlegen` + nicht `feuerwehr` | Typ bekannt, **Position/Höhe geprüft (neu)** |
| `/:id/objekte/:oid` | PATCH | ✅ `darfObjektAendern` | **Standbetreiber nur eigene Objekte**; `felderFiltern`; Sperre; **Geometrie geprüft (neu)** |
| `/:id/objekte/:oid` | DELETE | ✅ `element.loeschen` + nicht `feuerwehr` | Sperre |
| `/:id/objekte/:oid/zuweisen` | POST | ✅ `zuweisen` | Ziel muss Org-Typ `betreiber` sein |
| `/:id/wege` | POST | ✅ `darfWegAendern(typ)` | **Polylinie/Breite geprüft (neu)** |
| `/:id/wege/:wid` | PATCH | ✅ `darfWegAendern` alt **und neu (neu)** | Sperre; **Geometrie geprüft (neu)** |
| `/:id/wege/:wid` | DELETE | ✅ `darfWegAendern` | keine Sperrprüfung (siehe 3.5) |
| `/:id/blockflaechen` | POST | ✅ `element.anlegen` | **Polygon geprüft (neu)** |
| `/:id/blockflaechen/:bid` | PATCH | ✅ `element.aendern` + nicht `standbetreiber` | Sperre; **Typ + Geometrie geprüft (neu)** |
| `/:id/blockflaechen/:bid` | DELETE | ✅ `element.loeschen` | keine Sperrprüfung |
| `/:id/einsatzstationen` | POST | ✅ `element.anlegen` | Kategorie gültig; **Punkt/Polygon geprüft (neu)** |
| `/:id/einsatzstationen/:sid` | PATCH | ✅ `element.aendern` + nicht `standbetreiber` | Sperre; **Kategorie + Geometrie geprüft (neu)** |
| `/:id/einsatzstationen/:sid` | DELETE | ✅ `element.loeschen` | keine Sperrprüfung |
| `/:id/objekttypen` | POST | ✅ `objekttyp.anlegen` | Maße > 0 |

### 3.2 `server/routes/kollaboration.ts`

| Route | Methode | geprüftes Recht | zusätzliche Bindung |
|---|---|---|---|
| `/:id/kommentare` | POST | ✅ `kommentar.schreiben` | — |
| `/:id/kommentare/:kid` | PATCH | ❌ **keines** → ✅ `darfKommentarAendern` **(behoben)** | Abhaken nur Verfasser oder Veranstalter/Behörde |
| `/:id/snapshots` | POST | ✅ `snapshot.anlegen` | Name Pflicht |
| `/:id/snapshots/:sid/freigabe` | POST | ✅ `freigabe.setzen` | Status-Weißliste; Begründungspflicht bei „mit Auflagen“ |
| `/:id/auflagen/:aid` | PATCH | ❌ **keines** → ✅ `darfAuflageAendern` **(behoben)** | nur `projekt.aendern` oder `freigabe.setzen` |
| `/:id/objekte/:oid/auflagen` | POST | ✅ `freigabe.setzen` | Text Pflicht |
| `/:id/neu-pruefen` | POST | ⚠️ nur Mitgliedschaft | rechnet nur, schreibt nichts ins Projekt |

### 3.3 `server/routes/gelaende.ts`, `pruefung.ts`, `ki.ts`, `auth.ts`, `index.ts`

| Route | Methode | geprüftes Recht | zusätzliche Bindung |
|---|---|---|---|
| `/api/gelaende/import` | POST | ✅ Org-Typ `veranstalter`/`plattform` | Gebietsgröße begrenzt |
| `/api/gelaende/import/pruefen` | POST | ⚠️ nur Anmeldung | reine Flächenrechnung |
| `/api/gelaende/:id/dgm` | POST | ✅ Org-Typ `veranstalter`/`plattform` | **keine Bindung an *dieses* Gelände** (siehe 3.5) |
| `/api/gelaende/:id` | DELETE | ✅ Org-Typ `plattform` | 409, wenn noch genutzt |
| `/:id/pruefung` | POST | ⚠️ nur Mitgliedschaft | rechnet nur |
| `/:id/ki/erklaeren` · `/ki/frage` | POST | ✅ `ki.nutzen` | Ratenbremse 20/10 min je Nutzer |
| `/:id/ki/platzieren` | POST | ✅ `ki.nutzen` **und** `element.anlegen` | schreibt bewusst nichts |
| `/api/auth/anmelden` · `/abmelden` · `/registrieren` | POST | öffentlich (Entwurf) | siehe 2.4 / 2.5 |
| `/api/auth/benachrichtigungen/gelesen` | POST | ✅ Anmeldung | nur eigene Benachrichtigungen |
| `/api/debug/snapshot` | POST | ❌ **keines** → ✅ Anmeldung **(behoben)** | nur außerhalb `NODE_ENV=production` |

### 3.4 Die beiden kritischen Lücken im Detail

#### ❌ `PATCH /:id/auflagen/:aid` — jeder Beteiligte konnte amtliche Auflagen abhaken

**Bewertung: kritisch.** Auflagen sind die Forderungen der Behörde aus dem Freigabeverfahren. Die Route hatte **keine** Rechteprüfung — nur Projektmitgliedschaft.

Live belegt (vor der Behebung): Ein als **Gast** eingeladenes Konto (Rolle `gast`, besitzt ausschließlich `projekt.lesen`) setzte die vom Ordnungsamt erteilte Auflage

> „Rettungsweg W3 durchgaengig 3,00 m freihalten — Stand S8 verschieben“

auf **erledigt = true**. Ebenso gelang es dem Standbetreiber und der Polizei (jeweils HTTP 200).

**Behoben** in `server/routes/kollaboration.ts` mit neuer Prüfung `darfAuflageAendern()` in `server/lib/rechte.ts` (`projekt.aendern` oder `freigabe.setzen`).
**Nachgeprüft:** Gast 403 · Standbetreiber 403 · Polizei 403 · Veranstalter 200.

#### ❌ `PATCH /:id/kommentare/:kid` — Schleichweg an `POST` vorbei

**Bewertung: kritisch.** `POST /kommentare` prüfte `kommentar.schreiben` — `PATCH` prüfte gar nichts, konnte aber über das Feld `antwort` ebenfalls Text in den Faden schreiben und jeden fremden Kommentar als erledigt markieren.

Live belegt (vor der Behebung): Dasselbe Gastkonto wurde bei `POST` korrekt mit 403 abgewiesen und schrieb denselben Text anschließend per `PATCH` erfolgreich in den Kommentarfaden:

```
antworten = [('Einsatzplanung Suedhessen', 'Polizei-Antwort'),
             ('Sabine Kern',               'Gast schreibt trotzdem')]   erledigt = True
```

**Behoben** mit `darfKommentarAendern()`: setzt `kommentar.schreiben` voraus; das Abhaken bleibt zusätzlich dem Verfasser oder einer planungs-/freigabeberechtigten Rolle vorbehalten.
**Nachgeprüft:** Gast 403 · Standbetreiber (fremder Kommentar) 403 · Polizei-Antwort 200 · Veranstalter 200.

### 3.5 Verbleibende Beobachtungen — Bewertung: **hinweis**

- **Feuerwehr und Blockflächen/Einsatzstationen.** Für Wege ist die Feuerwehr sauber auf Feuerwehrzufahrten und Bewegungsflächen begrenzt (`darfWegAendern`). Für Blockflächen und Einsatzstationen gibt es keine solche Begrenzung — über `element.anlegen`/`element.aendern` darf sie dort alles. Das kann gewollt sein (vorbeugender Brandschutz), ist aber nirgends festgehalten. **Empfehlung:** im Lastenheft entscheiden und die Regel wie bei den Wegen in `rechte.ts` verankern.
- **`POST /:id/dgm` ohne Objektbindung.** Jede Veranstalter-Organisation darf die Höhendaten **jedes** Geländes überschreiben, auch eines fremden. Empfehlung: an `erstelltVon`/Eigentümer-Organisation binden.
- **Sperren nur bei PATCH.** Die kollaborative Sperre (`sperrePruefen`) wird bei `PATCH` geprüft, bei `DELETE` von Wegen, Blockflächen und Einsatzstationen nicht. Zwei Personen können sich so gegenseitig Elemente unter den Händen wegräumen. Kein Sicherheitsproblem, aber ein Datenverlustrisiko im Mehrbenutzerbetrieb.
- **Stiller Erfolg bei gefilterten Feldern.** Schickt ein Standbetreiber `position`, antwortet der Server 200, obwohl `felderFiltern` das Feld verworfen hat — die Position bleibt korrekt unverändert (live geprüft), aber der Client erfährt nicht, dass sein Wunsch ignoriert wurde. Besser wäre 403 mit Begründung.
- **Exporte.** `export/geojson`, `export/szene.glb` und `export/vadere` prüften nur die Mitgliedschaft; ein Gast konnte den vollständigen Plan herunterladen, obwohl ihm die PDF-Berichte (403) verwehrt waren. **Behoben:** alle drei verlangen jetzt `bericht.erzeugen` (nachgeprüft: Gast 3 × 403).

---

## 4. Die drei Leitfragen — mit Codepfad und Live-Beleg

### „Kann ein Standbetreiber fremde Objekte ändern?“ → **Nein.**

Zwei Schranken hintereinander:
1. `darfObjektAendern()` (`server/lib/rechte.ts`) vergleicht `objekt.betreiberOrgId` mit der Organisation des Nutzers und weist ab, wenn sie abweicht.
2. `felderFiltern()` beschränkt selbst am **eigenen** Objekt auf `BETREIBER_FELDER` = `masseOverride`, `notizen`, `status`, `standNummer`. Position, Rotation und Betreiberzuweisung sind nicht änderbar.

Live (Konto `wagner@schausteller.de`): fremdes Riesenrad verschieben **403** · fremdes Objekt löschen **403** · neues Objekt anlegen **403** · Weg anlegen **403** · Blockfläche anlegen **403** · Projektdaten ändern **403** · Planungsstand anlegen **403** · Freigabe setzen **403**.
Am **eigenen** Objekt: `notizen` **200** (übernommen); `position` **200**, aber der Wert blieb nachweislich `[475048, 5524930]` — die Filterung hat gehalten.

### „Kann die Polizei schreiben?“ → **Nein**, abgesehen von Kommentaren (so vorgesehen).

Die Matrix gibt der Rolle `polizei` nur `projekt.lesen`, `kommentar.schreiben`, `bericht.erzeugen`, `betreiberliste.lesen`, `kontaktdaten.sehen`.

Live (Konto `einsatz@polizei-suedhessen.de`): Objekt anlegen **403** · Objekt ändern **403** · Objekt löschen **403** · Projekt ändern **403** · Projekt löschen **403** · Weg anlegen **403** · Freigabe setzen **403** · einladen **403**.
Vor der Behebung konnte die Polizei jedoch **Auflagen abhaken** (Abschnitt 3.4) — jetzt ebenfalls 403.

### „Kann jemand ohne Mitgliedschaft ein fremdes Projekt lesen?“ → **Nein** — außer der Polizei, und das ist ausdrückliche Vorgabe.

`rolleFuer()` gibt `null` zurück, wenn weder Plattform-Org noch Veranstalter noch Polizei noch Mitgliedschaft zutrifft; `projektKontext()` macht daraus 403.

Live: Konto `kern@sonnenschein.de` (Imbissbetrieb Sonnenschein, keine Mitgliedschaft) auf ein fremdes Projekt → `{"fehler":"Kein Zugriff auf dieses Projekt."}`.
Gegenprobe Polizei ohne Einladung → **200** mit `rolle: "polizei"` und ausschließlich lesenden Rechten. Gegenprobe Feuerwehr **ohne** Mitgliedschaft im Projekt → **403**; die Sonderstellung gilt also wirklich nur der Polizei.

Der WebSocket-Kanal (`server/index.ts`) prüft dieselbe Funktion vor dem Beitritt und schließt die Verbindung ohne Rolle.

---

## 5. Datenschutz (DSGVO)

### 5.1 Wo personenbezogene Daten liegen

| Ort | Daten | Bemerkung |
|---|---|---|
| `data/nutzer.json` | Name, E-Mail, **scrypt-Hash**, Organisation, letzter Besuch | Klartextdatei ohne Zugriffsschutz auf Dateiebene |
| `data/organisationen.json` | Firmenname, Anschrift | teils personenbezogen bei Einzelunternehmen |
| `data/projekte/*/events.jsonl` | `nutzerName` je Änderung, dauerhaft | Änderungsprotokoll, **append-only, keine Löschfunktion** |
| `data/projekte/*/projekt.json` | Kommentare mit `autorName`, Auflagen mit `von` | — |
| `data/benachrichtigungen.json` | Namen und Kommentartexte in Klartext | auf 5000 Einträge begrenzt |
| Konsolenausgabe | `[Benachrichtigung] an <id>: <Titel> — <Text>` | landet im Terminalprotokoll |

### 5.2 Wird `kontaktSichtbar` überall beachtet? — **Ja, an allen vier Ausgabewegen.**

| Ausgabeweg | Umsetzung |
|---|---|
| Betreiberliste CSV | `betreiberZeilen(..., kontaktSichtbar(rolle))` → Felder werden durch `"gesperrt (DSGVO)"` ersetzt |
| Betreiberliste PDF | ebenso, zusätzlich Hinweistext und geänderter Untertitel |
| Betreiberliste JSON | ebenso |
| Einsatzmappe PDF | `kontaktSichtbar`-Schalter an drei Stellen (`server/reports/einsatzmappe.ts`) |
| Lagebild Polizei | `veranstalterKontakt` nur bei `kontaktSichtbar(rolle)`, sonst leeres Feld |

Gut gelöst: Gesperrte Felder werden **als gesperrt ausgewiesen** statt geleert — niemand hält sie für fehlende Daten.

**Ehrliche Einschränkung (hinweis):** Mit der aktuellen Rollenmatrix läuft dieser Schutz praktisch **nie an**. Jede Rolle, die `betreiberliste.lesen` oder `bericht.erzeugen` besitzt (Veranstalter, Ordnungsamt, Feuerwehr, Polizei, Plattform-Admin), besitzt auch `kontaktdaten.sehen`. Rollen ohne Kontaktrecht (Standbetreiber, Gast) kommen an die Listen gar nicht erst heran. Der Schalter ist also korrekt verdrahtet, aber gegenwärtig totes Sicherheitsnetz — er greift erst, wenn künftig eine Rolle die Liste ohne Kontaktdaten sehen darf. Das ist kein Fehler, sollte aber niemanden in falscher Sicherheit wiegen.

### 5.3 KI-Kontext — geht etwas an die Anthropic-API? — **Nein.** Bewertung: **kein Befund**

Das war die wichtigste Einzelfrage, deshalb nicht nur gelesen, sondern **gemessen**. Der reale Projektkontext wurde erzeugt und gegen sämtliche Stammdaten geprüft:

```
Kontextlaenge: 9444 Zeichen
Personenbezogene Treffer: [ 'ADRESSE: Darmstadt' ]
--- enthaelt "notizen"? --- false
```

Der einzige Treffer ist der Ortsname **„Darmstadt“** — er stammt aus dem Geländenamen „Heinerfest Darmstadt“ und ist als Anschriftsfeld einer Organisation nur zufällig identisch. Es ist keine personenbezogene Angabe.

Konkret **nicht** im Kontext: Nutzernamen, E-Mail-Adressen, Passwort-Hashes, Organisationsanschriften, Kommentare, Objekt-Notizen, `erstelltVon`. Betreiber erscheinen ausschließlich als **undurchsichtige Organisations-Kennung** (`org_04ebae…`), nie als Firma oder Person:

```
- [obj_d3d022e4fc8ef397] Imbissstand (Gastronomie), Stand S1, 3,00 x 2,50 x 3,00 m,
  Pos E 475048 / N 5524930, Drehung 0 Grad, Betreiber org_04ebae6747d59cb5, Status geplant
```

Das ist in `server/ai/kontext.ts` bewusst so gebaut (Kostenkontrolle) und hat als Nebenwirkung eine saubere Datenminimierung. **Zu beachten:** Die vom Nutzer selbst getippten Felder — `frage`, `befehl`, `verlauf` — gehen unverändert mit. Wer dort einen Namen hineinschreibt, sendet ihn. Das ist unvermeidbar, gehört aber in die Datenschutzerklärung.

**Vor Produktivbetrieb.** Auftragsverarbeitungsvertrag mit Anthropic; Nutzerhinweis am Eingabefeld, keine personenbezogenen Daten einzutippen; Verarbeitungsverzeichnis; Löschkonzept für das append-only-Ereignisprotokoll (Art. 17 DSGVO ist mit einem reinen Anhänge-Protokoll ohne Löschpfad nicht erfüllbar).

---

## 6. Geheimnisse — Bewertung: **kein Befund**

Vollständige Suche über das Projekt (ohne `node_modules`, `dist/cesium`, `package-lock.json`) nach `sk-ant-…`, `ANTHROPIC_API_KEY`, `x-api-key`:

- **Kein Schlüssel im Quelltext.** Kein `.env` im Projekt vorhanden.
- `x-api-key` erscheint **genau einmal**: `server/ai/anthropic.ts:174`, serverseitig, gespeist aus `process.env.ANTHROPIC_API_KEY`.
- Im Frontend-Bündel `dist/assets/index-*.js` kommt `ANTHROPIC_API_KEY` nur als **Anzeigetext** vor („Kein ANTHROPIC_API_KEY gesetzt — es antwortet der lokale, regelbasierte Assistent“). Kein Schlüsselmaterial.
- `/api/status` gibt lediglich `kiVerfuegbar: true/false` preis — den Schlüssel selbst nie.
- Das Modul trägt einen ausdrücklichen Warnhinweis im Kopf. Vorbildlich.

**Startpasswörter** (`scripts/seed.ts`) stehen erwartungsgemäß im Klartext und werden beim Anlegen sofort gehasht. Für eine Erprobungsinstallation richtig; die Datei benennt das selbst.

**Aber — Bewertung: wichtig:** Es gibt **keine `.gitignore`**. Ein `git add .` würde `data/nutzer.json` samt Passwort-Hashes, alle Projektdaten und ein künftiges `.env` mit versionieren. Aktuell ist nichts eingecheckt (das Verzeichnis hat noch keinen Commit), aber der erste Commit würde es tun.

**Vor Produktivbetrieb.** `.gitignore` mit mindestens `node_modules/`, `dist/`, `data/`, `.env*` anlegen — vor dem ersten Commit.

---

## 7. Eingabeprüfung — Bewertung: **wichtig** (behoben)

**Befund.** Die `PATCH`-Routen übernahmen Geometriefelder **ungeprüft** in die Projektdatei. Live belegt (vor der Behebung, als Veranstalter):

| Angriff | Antwort vorher |
|---|---|
| `position: {"a":1}` | **200** — gespeichert |
| `position: ["abc", null]` | **200** |
| `position: [5]` (ein Wert) | **200** |
| `rotation: "links"` | **200** |
| Weg mit Textkoordinaten | **201** |
| Weg mit `breite: 1e12` | **201** |
| Blockfläche mit `[null,null]` | **201** |
| Weg mit **300 000** Stützpunkten (7,2 MB) | **201** |

Danach stand im Objekt tatsächlich `position = {'a': 1}`, `rotation = 'links'`. Folge — ebenfalls gemessen:

```
berichte/lageplan.pdf       500   {"fehler":"unsupported number: NaN"}
berichte/konformitaet.pdf   500
berichte/einsatzmappe.pdf   500
export/geojson              500
```

Das ist mehr als ein Schönheitsfehler: Der Schaden wird **mitgespeichert** und überlebt jeden Neustart. Ein einziger fehlerhafter Aufruf — versehentlich oder absichtlich — macht sämtliche Behördendokumente eines Projekts dauerhaft unerzeugbar. Die 300 000-Punkte-Polylinie legte zusätzlich jede Prüfung und PDF-Erzeugung lahm (Löschversuche liefen in Zeitüberschreitungen).

**Was getan wurde.** Neues Modul `server/lib/eingabe.ts` mit `pruefePunkt`, `pruefePunktfolge`, `pruefeMeter`, `pruefeWinkel`, `pruefeGeometriePatch`. Angewandt auf alle Objekt-, Weg-, Blockflächen- und Einsatzstationsrouten (POST **und** PATCH). Regeln: Koordinaten müssen endliche Zahlen im Bereich ±10 000 000 sein; Längen > 0 und ≤ 10 000 m; höchstens **5000 Stützpunkte** je Geometrie. Fehler kommen als HTTP 400 mit deutschem Klartext.

**Nachgeprüft:** alle acht Angriffe oben jetzt **400**, gültige Eingaben weiterhin **201/200**:

```
{"fehler":"position: Die Koordinaten muessen Zahlen sein."}
{"fehler":"polylinie: Hoechstens 5000 Stuetzpunkte sind zulaessig (300000 uebergeben)."}
```

**Nutzlastgrenzen.** `express.json` 25 MB, `express.text` 80 MB (für den DGM-Import). Beides sind bewusste Werte, aber es gibt keine Begrenzung der Anfragen pro Zeit — ein angemeldeter Nutzer kann den Speicher wiederholt füllen. Zusätzlich steht `server.requestTimeout = 0` (kein Zeitlimit je Anfrage), was langsame Verbindungen offen hält.

**Vor Produktivbetrieb.** Anfragenbremse pro Nutzer für schreibende Routen; `requestTimeout` auf einen endlichen Wert; Textgrenze auf das für DGM wirklich Nötige senken.

---

## 8. Pfad-Traversal (`server/routes/gelaende.ts`) — Bewertung: **kritisch** (behoben)

**Befund.** Die Texturauslieferung lautete:

```ts
router.get('/:id/textur/:datei', (req, res) => {
  const p = gelaendeStore.texturPfad(req.params.id, req.params.datei);
```

Zwei Fehler auf einmal:
1. **Keine Anmeldepflicht** — die Route war die einzige unter `/api/gelaende` ohne `anmeldungNoetig`.
2. `texturPfad()` sicherte mit `path.basename()` nur den **Dateinamen** ab, nicht die **Gelände-Kennung**. Express entschlüsselt `%2f`/`%5c` erst nach der Zuordnung, sodass `:id` sehr wohl Pfadtrenner enthalten konnte.

**Live belegt** (vor der Behebung). Testdatei außerhalb des Geländeordners angelegt, dann **ohne jede Anmeldung**:

```
GET /api/gelaende/..%2fPWNTEST/textur/beweis.png
→ HTTP 200, Content-Type: image/png
GEHEIM-INHALT-ausserhalb-des-Gelaendeordners
```

`..%5c…` (Windows-Trenner) und `%2e%2e%2f…` funktionierten ebenso. Die Ausnutzbarkeit war dadurch begrenzt, dass der Pfad auf `<irgendwas>/textur/<name>` enden muss — der Ausbruch aus dem Datenverzeichnis war aber real und unangemeldet.

**Was getan wurde.**
- `texturPfad()` in `server/lib/store.ts`: `path.basename()` jetzt auf **beide** Bestandteile, anschließend `path.resolve` + Nachweis, dass das Ergebnis unterhalb des Geländeverzeichnisses liegt (`basename('..')` ist wieder `'..'` — Basename allein genügt nicht).
- Route: `anmeldungNoetig` ergänzt, Kennung gegen `^[A-Za-z0-9_-]+$` geprüft, `Cache-Control` von `public` auf `private` geändert.

**Nachgeprüft:** alle drei Traversal-Varianten **400** · ohne Anmeldung **401** · reguläre Kachel angemeldet **200**.

---

## 9. Was „lokale Installation“ konkret bedeutet

Das ist keine Randnotiz, sondern die Kernaussage dieser Prüfung.

**Was gut ist:** Der API-Dienst lauscht ausdrücklich nur auf `127.0.0.1` (`server.listen(PORT, '127.0.0.1')`), der Vite-Entwicklungsserver ebenso. **Von außen ist der Dienst nicht erreichbar** — das entschärft praktisch jeden der oben beschriebenen Befunde auf dem Einzelplatzrechner erheblich, einschließlich der Sitzungsfälschung.

**Was das trägt:** Ein Rechner, ein bis wenige Personen, die einander vertrauen, Erprobung und Abnahme. Dafür ist der Aufbau angemessen und die Entscheidungen sind im Quelltext ehrlich begründet.

**Was das nicht trägt:**
- **Kein echter Mandantenschutz auf Dateiebene.** Alle Daten liegen als lesbares JSON in `data/`. Wer Zugriff auf das Verzeichnis hat, liest alle Projekte, alle Kontaktdaten und alle Passwort-Hashes — am Rechtemodell vorbei. Das Rechtemodell schützt die *API*, nicht die *Platte*.
- **Kein Transportschutz.** HTTP ohne TLS. Im Netzbetrieb wäre das Sitzungscookie mitlesbar.
- **Keine Nebenläufigkeitssicherung.** Der Dateispeicher schreibt zwar atomar, aber Lese-Ändern-Schreiben-Abläufe sind nicht gegen gleichzeitige Zugriffe abgesichert.
- **Kein Sicherungs- und Löschkonzept.** Kein Backup, keine Aufbewahrungsfristen, keine Löschung — DSGVO-Betroffenenrechte sind so nicht bedienbar.
- **Kein Betriebsprotokoll.** Fehlanmeldungen und Rechteverstöße werden nirgends festgehalten; ein Angriff bliebe unbemerkt.
- **Sobald der Dienst auf `0.0.0.0` gelegt oder hinter einen Reverse-Proxy gestellt wird, gelten alle Befunde dieser Prüfung sofort in voller Schärfe.**

---

## 10. Vor dem Produktivbetrieb zwingend

Reihenfolge nach Dringlichkeit. Punkte 1–7 sind erledigt, 8–20 stehen aus.

**Erledigt in dieser Prüfung**

1. ✅ `PATCH /:id/auflagen/:aid` — Rechteprüfung ergänzt (`darfAuflageAendern`).
2. ✅ `PATCH /:id/kommentare/:kid` — Rechte- und Verfasserprüfung ergänzt (`darfKommentarAendern`).
3. ✅ Pfad-Traversal der Texturauslieferung geschlossen; Route ist jetzt anmeldepflichtig.
4. ✅ Geometrieprüfung für alle Objekt-, Weg-, Blockflächen- und Stationsrouten (`server/lib/eingabe.ts`), inkl. Obergrenze von 5000 Stützpunkten.
5. ✅ `POST /api/debug/snapshot` anmeldepflichtig; absoluter Serverpfad nicht mehr in der Antwort.
6. ✅ Exportrouten (GeoJSON, glTF, Vadere) verlangen `bericht.erzeugen`.
7. ✅ Feuerwehr kann eine Feuerwehrzufahrt nicht mehr in einen Besucherweg umwidmen.

**Ausstehend — ohne diese Punkte kein Produktivbetrieb**

8. **`HEINERFEST_SECRET` setzen** (≥ 32 zufällige Zeichen). Der Start bricht bei `NODE_ENV=production` jetzt ab, wenn es fehlt — dieser Abbruch ist Absicht und darf nicht umgangen werden.
9. **TLS erzwingen** und `HEINERFEST_HTTPS=1` bzw. `NODE_ENV=production` setzen, damit das Sitzungscookie `secure` trägt.
10. **Anmeldebremse**: Verzögerung und Sperre nach ~10 Fehlversuchen je Konto und Absender; Fehlversuche protokollieren.
11. **Selbstregistrierung abschalten** oder auf Einladung umstellen — derzeit kann sich jeder als Plattform-Admin-Organisation eintragen.
12. **Startpasswörter ersetzen**, Seed-Konten in der Produktion löschen.
13. **scrypt-Kosten anheben** (`N=131072`) mit selbstbeschreibendem Hashformat und stiller Neuberechnung beim Anmelden.
14. **Sitzungslaufzeit** von 14 Tagen auf 8–24 h senken; Sitzungsversion je Nutzer für Widerruf und Passwortwechsel.
15. **`.gitignore` anlegen** (`node_modules/`, `dist/`, `data/`, `.env*`) — **vor dem ersten Commit**.
16. **Daten im Ruhezustand schützen**: Dateisystemrechte auf `data/`, verschlüsselter Datenträger, oder Umzug auf das beiliegende PostGIS-Schema mit Datenbankkonten.
17. **Auftragsverarbeitungsvertrag mit Anthropic**, Verarbeitungsverzeichnis, Hinweis am KI-Eingabefeld.
18. **Lösch- und Aufbewahrungskonzept** für Ereignisprotokoll, Benachrichtigungen und Nutzerkonten (Art. 17 DSGVO); Sicherungskonzept.
19. **Anfragenbremse für schreibende Routen**; `server.requestTimeout` auf einen endlichen Wert.
20. **Offene Entwurfsfragen entscheiden und in `rechte.ts` verankern**: Darf die Feuerwehr Blockflächen und Einsatzstationen bearbeiten? Soll `POST /:id/dgm` an das eigene Gelände gebunden sein? Sollen Sperren auch beim Löschen gelten?

---

## Anhang: geänderte Dateien

| Datei | Änderung |
|---|---|
| `server/lib/eingabe.ts` | **neu** — Geometrie- und Maßprüfung für alle schreibenden Routen |
| `server/lib/rechte.ts` | `darfAuflageAendern()`, `darfKommentarAendern()` ergänzt |
| `server/lib/auth.ts` | `HEINERFEST_SECRET` im Produktivbetrieb erzwungen, Mindestlänge, Startwarnung, `secure`-Flag |
| `server/lib/store.ts` | `texturPfad()` gegen Pfad-Traversal abgesichert |
| `server/routes/kollaboration.ts` | Rechteprüfung für `PATCH /auflagen/:aid` und `PATCH /kommentare/:kid` |
| `server/routes/projekte.ts` | Eingabeprüfung in allen Geometrierouten; Typprüfung beim Umwidmen von Wegen |
| `server/routes/gelaende.ts` | Texturroute anmeldepflichtig, Kennung geprüft, `Cache-Control: private` |
| `server/routes/berichte.ts` | Exportrouten verlangen `bericht.erzeugen` |
| `server/index.ts` | `/api/debug/snapshot` anmeldepflichtig, kein Serverpfad in der Antwort |

**Regressionsprüfung:** `npm run abnahme` → **59 von 59 Prüfpunkten bestanden**. Anschließender Rauchtest über Projektansicht, Prüfung, Editorstatus, Auflagen, Kommentare, Planungsstände, Ereignisse, alle vier PDF-Berichte, CSV, GeoJSON, glTF und Texturauslieferung: durchgehend HTTP 200. `npx tsc --noEmit` weist in den geänderten Dateien keine neuen Fehler aus (die verbleibenden Meldungen bestehen unverändert seit vor der Prüfung).

**Testdaten:** Sämtliche während der Live-Prüfung erzeugten Objekte, Wege, Blockflächen, Kommentare, Mitgliedschaften und Dateien wurden wieder entfernt; die abgehakte Auflage steht wieder auf offen, das verschobene Riesenrad wieder auf `[475030, 5524912]` mit 180°.
