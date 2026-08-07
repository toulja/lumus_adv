/**
 * Export F9.1 / F10.4 — Personenstrom-Szenario fuer Vadere.
 *
 * Format geprueft gegen das offizielle Repository (gitlab.lrz.de/vadere/vadere,
 * Release 4.0, Datei Scenarios/ModelTests/TestOSM/scenarios/chicken_floorfield_ok.scenario
 * sowie die OSM-Demos mit POLYGON-Formen). Aufbau:
 *
 *   { name, description, release, commithash, processWriters,
 *     scenario: { mainModel, attributesModel, attributesSimulation,
 *                 attributesPsychology, topography, stimulusInfos } }
 *
 * Vadere rechnet in einem LOKALEN, kartesischen Meter-System mit y nach oben
 * und dem Ursprung links unten. Darum wird der Plan von EPSG:25832 nur
 * VERSCHOBEN (nicht gedreht, nicht skaliert): lokal = welt - ursprung. Der
 * Rueckweg steht im Szenario selbst unter
 * topography.attributes.referenceCoordinateSystem (epsgCode + translation) —
 * das ist genau die Struktur, die Vadere fuer Georeferenzierung vorsieht.
 */

import type {
  Gelaende,
  ObjektTyp,
  ProjektInhalt,
  Punkt,
  Ring,
  Weg,
} from '../../shared/domain/types.ts';
import { STATION_LABEL, WEGE_TYP_LABEL } from '../../shared/domain/types.ts';
import { bezeichnung, grundriss, zugaengeWelt } from '../../shared/domain/objekte.ts';
import {
  bboxVonPunkten,
  gegenUhrzeiger,
  punktInRing,
  rechteckRing,
  richtungsVektor,
  ringNormalisieren,
  wegKorridor,
} from '../../shared/geo/geometry.ts';

export type VadereSzenarioArt = 'normalbetrieb' | 'evakuierung' | 'weg_blockiert';

export interface VadereOpts {
  inhalt: ProjektInhalt;
  gelaende: Gelaende | null;
  typen: Map<string, ObjektTyp>;
  szenario: VadereSzenarioArt;
  /** Nur bei szenario === 'weg_blockiert': welcher Weg faellt aus. */
  blockierterWegId?: string;
}

/** Freier Rand zwischen aeusserstem Element und Gebietsgrenze (Meter). */
const RAND = 2.0;
/** Breite der Wand, die Vadere selbst am Gebietsrand zieht. */
const RANDWAND = 0.5;
/** Bis zu diesem Abstand gilt ein Wegende als "am Gebietsrand". */
const RANDNAEHE = 8.0;
/** Kantenlaenge der Quell-/Zielquadrate um einen Punkt (Meter). */
const QUELL_SEITE = 3.0;
const ZIEL_SEITE = 6.0;

// ---------------------------------------------------------------------------
// Interne Zwischendarstellung: alles zunaechst als Ring in Weltkoordinaten
// ---------------------------------------------------------------------------

interface RohElement {
  rolle: 'obstacle' | 'source' | 'target';
  ring: Ring;
  bezeichnung: string;
  /** Fuer die Legende in der Beschreibung. */
  herkunft: string;
}

interface SzenarioKonfiguration {
  finishTime: number;
  /** Ab wann Personen erscheinen. */
  startZeit: number;
  /** Bis wann Personen erscheinen (== startZeit -> alle auf einen Schlag). */
  endZeit: number;
  /** Sekunden zwischen zwei Erzeugungsschritten. */
  frequenz: number;
  beschreibung: string;
}

function konfiguration(art: VadereSzenarioArt): SzenarioKonfiguration {
  if (art === 'normalbetrieb') {
    return {
      finishTime: 600,
      startZeit: 0,
      endZeit: 480,
      frequenz: 2,
      beschreibung:
        'Normalbetrieb: Die Besucher stroemen ueber die volle Simulationsdauer verteilt in das ' +
        'Gebiet. Gesucht sind Dauerstaus an Engstellen, nicht die Raeumzeit.',
    };
  }
  if (art === 'evakuierung') {
    return {
      finishTime: 1200,
      startZeit: 0,
      endZeit: 0,
      frequenz: 1,
      beschreibung:
        'Evakuierung: Alle Personen starten gleichzeitig zum Zeitpunkt 0 und laufen die ' +
        'Sammelplaetze und Notausgangspunkte an. Ergebnisgroesse ist die Raeumzeit.',
    };
  }
  return {
    finishTime: 1200,
    startZeit: 0,
    endZeit: 0,
    frequenz: 1,
    beschreibung:
      'Evakuierung mit blockiertem Weg: wie die Evakuierung, aber der Korridor eines Weges ist ' +
      'zusaetzlich als Hindernis eingetragen. Zeigt, wie stark der Ausfall dieses Weges wirkt.',
  };
}

// ---------------------------------------------------------------------------
// Geometrie-Helfer
// ---------------------------------------------------------------------------

function quadrat(mitte: Punkt, seite: number): Ring {
  return rechteckRing(mitte, seite, seite, 0);
}

/**
 * Schiebt einen Punkt entlang rv so weit, bis er ausserhalb des Hindernisses
 * liegt, und danach um `extra` weiter. Noetig bei Fahrgeschaeften: die
 * Ein-/Ausstiege liegen im Typ INNERHALB des Grundrisses (z. B. Riesenrad),
 * eine Quelle dort waere von Vadere nicht bespielbar.
 */
function ausHindernisSchieben(start: Punkt, rv: Punkt, hindernis: Ring, extra: number): Punkt {
  let t = 0;
  for (let i = 0; i < 400; i++) {
    const p: Punkt = [start[0] + rv[0] * t, start[1] + rv[1] * t];
    if (!punktInRing(p, hindernis)) return [p[0] + rv[0] * extra, p[1] + rv[1] * extra];
    t += 0.5;
  }
  return [start[0] + rv[0] * extra, start[1] + rv[1] * extra];
}

function nahAmRand(
  p: Punkt,
  b: { minE: number; minN: number; maxE: number; maxN: number },
  toleranz: number,
): boolean {
  const d = Math.min(p[0] - b.minE, b.maxE - p[0], p[1] - b.minN, b.maxN - p[1]);
  return d <= toleranz;
}

/** Verteilt eine Gesamtzahl moeglichst gleichmaessig auf n Toepfe. */
function verteile(gesamt: number, n: number): number[] {
  if (n <= 0) return [];
  const g = Math.max(0, Math.round(gesamt));
  const basis = Math.floor(g / n);
  const rest = g - basis * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(basis + (i < rest ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Szenario aufbauen
// ---------------------------------------------------------------------------

export function vadereSzenario(o: VadereOpts): Record<string, unknown> {
  const { inhalt, gelaende, typen } = o;
  const konf = konfiguration(o.szenario);
  const elemente: RohElement[] = [];
  const anmerkungen: string[] = [];

  // -- 1. Hindernisse ------------------------------------------------------
  for (const inst of inhalt.objekte) {
    const typ = typen.get(inst.typId);
    if (!typ) continue;
    const ring = ringNormalisieren(grundriss(typ, inst));
    if (ring.length < 3) continue;
    elemente.push({
      rolle: 'obstacle',
      ring,
      bezeichnung: bezeichnung(typ, inst),
      herkunft: `objekt:${inst.id}`,
    });
  }

  if (gelaende) {
    for (const g of gelaende.gebaeude) {
      const ring = ringNormalisieren(g.grundriss);
      if (ring.length < 3) continue;
      elemente.push({
        rolle: 'obstacle',
        ring,
        bezeichnung: g.funktion ? `Bestandsgebaeude (${g.funktion})` : 'Bestandsgebaeude',
        herkunft: `gebaeude:${g.id}`,
      });
    }
  }

  for (const b of inhalt.blockflaechen) {
    const ring = ringNormalisieren(b.polygon);
    if (ring.length < 3) continue;
    elemente.push({
      rolle: 'obstacle',
      ring,
      bezeichnung: b.name ?? `Blockflaeche (${b.typ})`,
      herkunft: `blockflaeche:${b.id}`,
    });
  }

  let blockierterWeg: Weg | null = null;
  if (o.szenario === 'weg_blockiert') {
    blockierterWeg = inhalt.wege.find((w) => w.id === o.blockierterWegId) ?? null;
    if (!blockierterWeg) {
      anmerkungen.push(
        `Szenario "weg_blockiert" angefordert, aber kein Weg mit der Kennung ` +
          `"${o.blockierterWegId ?? 'k. A.'}" gefunden — es wurde KEIN zusaetzliches Hindernis eingefuegt.`,
      );
    } else {
      let teile = 0;
      for (const r of wegKorridor(blockierterWeg.polylinie, blockierterWeg.breite)) {
        const ring = ringNormalisieren(r);
        if (ring.length < 3) continue;
        teile++;
        elemente.push({
          rolle: 'obstacle',
          ring,
          bezeichnung: `Sperrung ${blockierterWeg.name ?? WEGE_TYP_LABEL[blockierterWeg.typ]}`,
          herkunft: `sperrung:${blockierterWeg.id}`,
        });
      }
      anmerkungen.push(
        `Blockiert: ${blockierterWeg.name ?? WEGE_TYP_LABEL[blockierterWeg.typ]} ` +
          `(${blockierterWeg.id}), Korridor als ${teile} Hindernis-Teilflaechen eingetragen.`,
      );
    }
  }

  // -- 2. Bezugsrahmen fuer "am Gebietsrand" -------------------------------
  const kernPunkte: Punkt[] = [];
  for (const e of elemente) for (const p of e.ring) kernPunkte.push(p);
  for (const w of inhalt.wege) for (const p of w.polylinie) kernPunkte.push(p);
  if (gelaende) for (const p of gelaende.polygon) kernPunkte.push(p);
  for (const s of inhalt.einsatzstationen) {
    if (s.polygon) for (const p of s.polygon) kernPunkte.push(p);
    else if (s.punkt) kernPunkte.push(s.punkt);
  }
  const kernBbox = kernPunkte.length
    ? bboxVonPunkten(kernPunkte)
    : { minE: 0, minN: 0, maxE: 10, maxN: 10 };

  // -- 3. Quellen ----------------------------------------------------------
  for (const inst of inhalt.objekte) {
    const typ = typen.get(inst.typId);
    if (!typ || typ.kategorie !== 'fahrgeschaeft') continue;
    const ring = grundriss(typ, inst);
    for (const z of zugaengeWelt(typ, inst)) {
      const rv = richtungsVektor(z.weltRichtung);
      const seite = Math.min(Math.max(QUELL_SEITE, z.breite + 1), 8);
      const mitte = ausHindernisSchieben(z.welt, rv, ring, 1.0 + seite / 2);
      elemente.push({
        rolle: 'source',
        ring: quadrat(mitte, seite),
        bezeichnung: `${bezeichnung(typ, inst)} — ${z.typ}`,
        herkunft: `zugang:${inst.id}:${z.index}`,
      });
    }
  }

  const wegQuellen: RohElement[] = [];
  const besucherwege = inhalt.wege.filter((w) => w.typ === 'besucherweg' && w.polylinie.length >= 2);
  for (const w of besucherwege) {
    const enden: Punkt[] = [w.polylinie[0], w.polylinie[w.polylinie.length - 1]];
    for (let i = 0; i < enden.length; i++) {
      if (!nahAmRand(enden[i], kernBbox, RANDNAEHE)) continue;
      const seite = Math.max(2, Math.min(w.breite, 8));
      wegQuellen.push({
        rolle: 'source',
        ring: quadrat(enden[i], seite),
        bezeichnung: `${w.name ?? WEGE_TYP_LABEL[w.typ]} — Zustrom ${i === 0 ? 'Anfang' : 'Ende'}`,
        herkunft: `wegende:${w.id}:${i}`,
      });
    }
  }
  if (!wegQuellen.length && besucherwege.length) {
    // Kein Besucherweg endet am Gebietsrand. Ohne Zustrom waere das Szenario
    // wertlos — darum ersatzweise alle Wegenden, aber offen dokumentiert.
    for (const w of besucherwege) {
      const enden: Punkt[] = [w.polylinie[0], w.polylinie[w.polylinie.length - 1]];
      for (let i = 0; i < enden.length; i++) {
        const seite = Math.max(2, Math.min(w.breite, 8));
        wegQuellen.push({
          rolle: 'source',
          ring: quadrat(enden[i], seite),
          bezeichnung: `${w.name ?? WEGE_TYP_LABEL[w.typ]} — Zustrom ${i === 0 ? 'Anfang' : 'Ende'}`,
          herkunft: `wegende:${w.id}:${i}`,
        });
      }
    }
    anmerkungen.push(
      'Kein Besucherweg endet am Gebietsrand. Ersatzweise wurden ALLE Enden der Besucherwege ' +
        'als Quellen gesetzt — die Zustromrichtung ist damit eine Annahme und zu pruefen.',
    );
  }
  for (const q of wegQuellen) elemente.push(q);

  // -- 4. Ziele ------------------------------------------------------------
  for (const s of inhalt.einsatzstationen) {
    if (s.kategorie !== 'sammelplatz' && s.kategorie !== 'notausgangspunkt') continue;
    let ring: Ring | null = null;
    if (s.polygon && ringNormalisieren(s.polygon).length >= 3) ring = ringNormalisieren(s.polygon);
    else if (s.punkt) ring = quadrat(s.punkt, ZIEL_SEITE);
    if (!ring) continue;
    elemente.push({
      rolle: 'target',
      ring,
      bezeichnung: `${s.name} (${STATION_LABEL[s.kategorie]})`,
      herkunft: `einsatzstation:${s.id}`,
    });
  }

  // -- 5. Ursprung und Gebietsgrenzen --------------------------------------
  const allePunkte: Punkt[] = [];
  for (const e of elemente) for (const p of e.ring) allePunkte.push(p);
  const bb = allePunkte.length ? bboxVonPunkten(allePunkte) : { minE: 0, minN: 0, maxE: 10, maxN: 10 };
  const ursprung: Punkt = [bb.minE - RAND, bb.minN - RAND];
  const breite = +(bb.maxE - bb.minE + 2 * RAND).toFixed(3);
  const hoehe = +(bb.maxN - bb.minN + 2 * RAND).toFixed(3);

  const lokal = (p: Punkt): { x: number; y: number } => ({
    x: +(p[0] - ursprung[0]).toFixed(3),
    y: +(p[1] - ursprung[1]).toFixed(3),
  });
  const form = (ring: Ring) => ({
    type: 'POLYGON',
    points: gegenUhrzeiger(ringNormalisieren(ring)).map(lokal),
  });

  // -- 6. Vadere-Objekte ---------------------------------------------------
  let naechsteId = 1;
  const legende: string[] = [];
  const obstacles: Record<string, unknown>[] = [];
  const targets: Record<string, unknown>[] = [];
  const quellRohe: { id: number; el: RohElement }[] = [];

  for (const e of elemente.filter((x) => x.rolle === 'obstacle')) {
    const vid = naechsteId++;
    obstacles.push({ id: vid, shape: form(e.ring), visible: true });
    legende.push(`obstacle ${vid} = ${e.bezeichnung} [${e.herkunft}]`);
  }
  for (const e of elemente.filter((x) => x.rolle === 'target')) {
    const vid = naechsteId++;
    targets.push({
      id: vid,
      shape: form(e.ring),
      visible: true,
      absorber: { enabled: true, deletionDistance: 0.1 },
      waiter: { enabled: false, distribution: null, individualWaiting: true },
      leavingSpeed: -1,
      parallelEvents: 0,
    });
    legende.push(`target ${vid} = ${e.bezeichnung} [${e.herkunft}]`);
  }
  const zielIds = targets.map((t) => t.id as number);

  const quellElemente = elemente.filter((x) => x.rolle === 'source');
  for (const e of quellElemente) {
    quellRohe.push({ id: naechsteId++, el: e });
  }

  const anteile = verteile(inhalt.projekt.maxBesucher, quellRohe.length);
  const sources: Record<string, unknown>[] = quellRohe.map((q, i) => {
    legende.push(`source ${q.id} = ${q.el.bezeichnung} [${q.el.herkunft}], ${anteile[i]} Personen`);
    return {
      id: q.id,
      shape: form(q.el.ring),
      visible: true,
      targetIds: zielIds,
      spawner: {
        type: 'org.vadere.state.attributes.spawner.AttributesRegularSpawner',
        constraintsElementsMax: -1,
        constraintsTimeStart: konf.startZeit,
        constraintsTimeEnd: konf.endZeit,
        eventPositionRandom: true,
        eventPositionGridCA: false,
        eventPositionFreeSpace: true,
        eventElementCount: anteile[i],
        eventElement: null,
        distribution: {
          type: 'org.vadere.state.attributes.distributions.AttributesConstantDistribution',
          updateFrequency: konf.frequenz,
        },
      },
      groupSizeDistribution: [1],
    };
  });

  if (!quellRohe.length) {
    anmerkungen.push(
      'Keine Quellen erzeugbar: es gibt weder Fahrgeschaefte mit Ein-/Ausstiegen noch Besucherwege. ' +
        'Das Szenario laeuft ohne Personen.',
    );
  }
  if (!zielIds.length) {
    anmerkungen.push(
      'Keine Ziele erzeugbar: im Projekt sind keine Sammelplaetze und keine Notausgangspunkte ' +
        'eingetragen. Vadere braucht mindestens ein Ziel — bitte im Plan ergaenzen.',
    );
  }

  // -- 7. Auswertung -------------------------------------------------------
  const raeumung = o.szenario !== 'normalbetrieb';
  const dateien: Record<string, unknown>[] = [
    {
      type: 'org.vadere.simulator.projects.dataprocessing.outputfile.EventtimePedestrianIdOutputFile',
      filename: 'postvis.traj',
      processors: [1, 2],
    },
  ];
  const prozessoren: Record<string, unknown>[] = [
    { type: 'org.vadere.simulator.projects.dataprocessing.processor.FootStepProcessor', id: 1 },
    { type: 'org.vadere.simulator.projects.dataprocessing.processor.FootStepTargetIDProcessor', id: 2 },
    { type: 'org.vadere.simulator.projects.dataprocessing.processor.PedestrianOverlapProcessor', id: 3 },
  ];
  dateien.push({
    type: 'org.vadere.simulator.projects.dataprocessing.outputfile.TimestepPedestrianIdOverlapOutputFile',
    filename: 'ueberlappungen.txt',
    processors: [3],
  });
  if (raeumung) {
    prozessoren.push(
      { type: 'org.vadere.simulator.projects.dataprocessing.processor.PedestrianStartTimeProcessor', id: 4 },
      {
        type: 'org.vadere.simulator.projects.dataprocessing.processor.PedestrianEvacuationTimeProcessor',
        id: 5,
        attributesType:
          'org.vadere.state.attributes.processor.AttributesPedestrianEvacuationTimeProcessor',
        attributes: { pedestrianStartTimeProcessorId: 4 },
      },
      {
        type: 'org.vadere.simulator.projects.dataprocessing.processor.EvacuationTimeProcessor',
        id: 6,
        attributesType: 'org.vadere.state.attributes.processor.AttributesEvacuationTimeProcessor',
        attributes: { pedestrianEvacuationTimeProcessorId: 5 },
      },
    );
    dateien.push(
      {
        type: 'org.vadere.simulator.projects.dataprocessing.outputfile.PedestrianIdOutputFile',
        filename: 'raeumzeit_je_person.txt',
        processors: [5],
      },
      {
        type: 'org.vadere.simulator.projects.dataprocessing.outputfile.NoDataKeyOutputFile',
        filename: 'raeumzeit_gesamt.txt',
        processors: [6],
      },
    );
  }

  // -- 8. Beschreibung -----------------------------------------------------
  const beschreibung = [
    `EventPlan3D-Export fuer ${inhalt.projekt.name}.`,
    konf.beschreibung,
    `Personen gesamt (maxBesucher): ${inhalt.projekt.maxBesucher}, verteilt auf ${quellRohe.length} Quellen.`,
    `Lokales System: Ursprung = untere linke Ecke, Einheit Meter, y nach Norden.`,
    `Weltbezug: EPSG:25832, lokal = welt - (E ${ursprung[0].toFixed(3)} / N ${ursprung[1].toFixed(3)}).`,
    ...(anmerkungen.length ? ['', 'Hinweise:', ...anmerkungen.map((a) => `- ${a}`)] : []),
    '',
    'Zuordnung Vadere-Kennung zu Planelement:',
    ...legende,
  ].join('\n');

  return {
    name: `${inhalt.projekt.name} — ${o.szenario}`,
    description: beschreibung,
    release: '4.0',
    commithash: '',
    processWriters: {
      files: dateien,
      processors: prozessoren,
      isTimestamped: true,
      isWriteMetaData: false,
    },
    scenario: {
      mainModel: 'org.vadere.simulator.models.osm.OptimalStepsModel',
      attributesModel: {
        'org.vadere.state.attributes.models.AttributesFloorField': {
          createMethod: 'HIGH_ACCURACY_FAST_MARCHING',
          potentialFieldResolution: 0.1,
          obstacleGridPenalty: 0.1,
          targetAttractionStrength: 1,
          cacheType: 'NO_CACHE',
          cacheDir: '',
          timeCostAttributes: {
            standardDeviation: 0.7,
            type: 'UNIT',
            obstacleDensityWeight: 3.5,
            pedestrianSameTargetDensityWeight: 3.5,
            pedestrianOtherTargetDensityWeight: 3.5,
            pedestrianWeight: 3.5,
            queueWidthLoading: 1,
            pedestrianDynamicWeight: 6,
            loadingType: 'CONSTANT',
            width: 0.2,
            height: 1,
          },
        },
        'org.vadere.state.attributes.models.AttributesOSM': {
          stepCircleResolution: 18,
          numberOfCircles: 1,
          optimizationType: 'NELDER_MEAD',
          varyStepDirection: true,
          movementType: 'ARBITRARY',
          stepLengthIntercept: 0.4625,
          stepLengthSlopeSpeed: 0.2345,
          stepLengthSD: 0.036,
          movementThreshold: 0,
          minStepLength: 0.4625,
          minimumStepLength: true,
          maxStepDuration: 1.7976931348623157e308,
          dynamicStepLength: true,
          updateType: 'EVENT_DRIVEN',
          seeSmallWalls: false,
          targetPotentialModel: 'org.vadere.simulator.models.potential.fields.PotentialFieldTargetGrid',
          pedestrianPotentialModel:
            'org.vadere.simulator.models.potential.PotentialFieldPedestrianCompactSoftshell',
          obstaclePotentialModel:
            'org.vadere.simulator.models.potential.PotentialFieldObstacleCompactSoftshell',
          submodels: [],
        },
        'org.vadere.state.attributes.models.AttributesPotentialCompactSoftshell': {
          pedPotentialIntimateSpaceWidth: 0.45,
          pedPotentialPersonalSpaceWidth: 1.2,
          pedPotentialHeight: 50,
          obstPotentialWidth: 0.8,
          obstPotentialHeight: 6,
          intimateSpaceFactor: 1.2,
          personalSpacePower: 1,
          intimateSpacePower: 1,
        },
      },
      attributesSimulation: {
        finishTime: konf.finishTime,
        simTimeStepLength: 0.4,
        realTimeSimTimeRatio: 0,
        writeSimulationData: true,
        visualizationEnabled: true,
        printFPS: false,
        digitsPerCoordinate: 2,
        useFixedSeed: true,
        fixedSeed: 1,
        simulationSeed: 1,
      },
      attributesPsychology: {
        usePsychologyLayer: false,
        psychologyLayer: {
          perception: 'SimplePerceptionModel',
          cognition: 'CooperativeCognitionModel',
          attributesModel: {
            'org.vadere.state.attributes.models.psychology.perception.AttributesSimplePerceptionModel': {
              priority: {
                '1': 'InformationStimulus',
                '2': 'ChangeTargetScripted',
                '3': 'ChangeTarget',
                '4': 'Threat',
                '5': 'Wait',
                '6': 'WaitInArea',
                '7': 'DistanceRecommendation',
              },
            },
            'org.vadere.state.attributes.models.psychology.cognition.AttributesCooperativeCognitionModel': {},
          },
        },
      },
      topography: {
        attributes: {
          bounds: { x: 0, y: 0, width: breite, height: hoehe },
          boundingBoxWidth: RANDWAND,
          bounded: true,
          referenceCoordinateSystem: {
            epsgCode: 'EPSG:25832',
            description: 'ETRS89 / UTM Zone 32N — internes Bezugssystem von EventPlan3D',
            translation: { x: +ursprung[0].toFixed(3), y: +ursprung[1].toFixed(3) },
          },
        },
        obstacles,
        measurementAreas: [],
        stairs: [],
        targets,
        targetChangers: [],
        absorbingAreas: [],
        aerosolClouds: [],
        droplets: [],
        sources,
        dynamicElements: [],
        attributesPedestrian: {
          shape: { x: 0, y: 0, width: 1, height: 1, type: 'RECTANGLE' },
          visible: true,
          radius: 0.195,
          densityDependentSpeed: false,
          speedDistributionMean: 1.34,
          speedDistributionStandardDeviation: 0.26,
          minimumSpeed: 0.5,
          maximumSpeed: 2.2,
          acceleration: 2,
          footstepHistorySize: 4,
          searchRadius: 1,
          walkingDirectionSameIfAngleLessOrEqual: 45,
          walkingDirectionCalculation: 'BY_TARGET_CENTER',
        },
        teleporter: null,
      },
      stimulusInfos: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Pruefung
// ---------------------------------------------------------------------------

function istObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function istZahl(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

interface FormPunkte {
  punkte: Punkt[];
  anzahl: number;
  fehler: string | null;
}

/** Holt die Eckpunkte einer Vadere-Form (POLYGON oder RECTANGLE). */
function formPunkte(shape: unknown): FormPunkte {
  if (!istObj(shape)) return { punkte: [], anzahl: 0, fehler: 'shape fehlt oder ist kein Objekt' };
  const typ = shape.type;
  if (typ === 'POLYGON') {
    const pts = shape.points;
    if (!Array.isArray(pts)) return { punkte: [], anzahl: 0, fehler: 'POLYGON ohne points-Liste' };
    const out: Punkt[] = [];
    for (const p of pts) {
      if (!istObj(p) || !istZahl(p.x) || !istZahl(p.y)) {
        return { punkte: out, anzahl: pts.length, fehler: 'POLYGON mit ungueltigem Punkt' };
      }
      out.push([p.x, p.y]);
    }
    return { punkte: out, anzahl: out.length, fehler: null };
  }
  if (typ === 'RECTANGLE') {
    if (!istZahl(shape.x) || !istZahl(shape.y) || !istZahl(shape.width) || !istZahl(shape.height)) {
      return { punkte: [], anzahl: 0, fehler: 'RECTANGLE ohne vollstaendige Masse' };
    }
    const x = shape.x;
    const y = shape.y;
    const w = shape.width;
    const h = shape.height;
    if (w <= 0 || h <= 0) return { punkte: [], anzahl: 0, fehler: 'RECTANGLE ohne positive Ausdehnung' };
    return {
      punkte: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      anzahl: 4,
      fehler: null,
    };
  }
  if (typ === 'CIRCLE') {
    const z = shape.center;
    if (!istObj(z) || !istZahl(z.x) || !istZahl(z.y) || !istZahl(shape.radius)) {
      return { punkte: [], anzahl: 0, fehler: 'CIRCLE ohne center/radius' };
    }
    const r = shape.radius;
    return {
      punkte: [
        [z.x - r, z.y - r],
        [z.x + r, z.y - r],
        [z.x + r, z.y + r],
        [z.x - r, z.y + r],
      ],
      anzahl: 4,
      fehler: null,
    };
  }
  return { punkte: [], anzahl: 0, fehler: `unbekannter shape.type "${String(typ)}"` };
}

export function validiereVadere(s: unknown): { gueltig: boolean; fehler: string[]; warnungen: string[] } {
  const fehler: string[] = [];
  const warnungen: string[] = [];

  if (!istObj(s)) {
    return { gueltig: false, fehler: ['Das Szenario ist kein JSON-Objekt.'], warnungen };
  }

  for (const feld of ['name', 'description', 'release', 'processWriters', 'scenario']) {
    if (s[feld] === undefined) fehler.push(`Top-Level-Feld "${feld}" fehlt.`);
  }
  if (typeof s.name === 'string' && !s.name.trim()) warnungen.push('Das Feld "name" ist leer.');

  const szenario = s.scenario;
  if (!istObj(szenario)) {
    fehler.push('Feld "scenario" fehlt oder ist kein Objekt.');
    return { gueltig: false, fehler, warnungen };
  }
  for (const feld of ['mainModel', 'attributesModel', 'attributesSimulation', 'topography']) {
    if (szenario[feld] === undefined) fehler.push(`Feld "scenario.${feld}" fehlt.`);
  }

  const topo = szenario.topography;
  if (!istObj(topo)) {
    fehler.push('Feld "scenario.topography" fehlt oder ist kein Objekt.');
    return { gueltig: false, fehler, warnungen };
  }

  // -- bounds --------------------------------------------------------------
  const attrs: Record<string, unknown> = istObj(topo.attributes) ? topo.attributes : {};
  if (!istObj(topo.attributes)) fehler.push('scenario.topography.attributes fehlt.');
  const rohBounds = attrs.bounds;
  let grenzen: { x: number; y: number; width: number; height: number } | null = null;
  if (!istObj(rohBounds)) {
    fehler.push('scenario.topography.attributes.bounds fehlt.');
  } else if (
    !istZahl(rohBounds.x) ||
    !istZahl(rohBounds.y) ||
    !istZahl(rohBounds.width) ||
    !istZahl(rohBounds.height)
  ) {
    fehler.push('bounds ist kein Rechteck mit den Zahlen x, y, width, height.');
  } else if (rohBounds.width <= 0 || rohBounds.height <= 0) {
    fehler.push(
      `bounds hat keine positive Ausdehnung (width ${rohBounds.width}, height ${rohBounds.height}).`,
    );
  } else {
    grenzen = { x: rohBounds.x, y: rohBounds.y, width: rohBounds.width, height: rohBounds.height };
  }
  const randWand = istZahl(attrs.boundingBoxWidth) ? attrs.boundingBoxWidth : 0;

  // -- Listen holen --------------------------------------------------------
  const liste = (name: string): Record<string, unknown>[] => {
    const v = topo[name];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      fehler.push(`scenario.topography.${name} ist keine Liste.`);
      return [];
    }
    const out: Record<string, unknown>[] = [];
    for (const e of v) {
      if (istObj(e)) out.push(e);
      else fehler.push(`Eintrag in ${name} ist kein Objekt.`);
    }
    return out;
  };

  const obstacles = liste('obstacles');
  const targets = liste('targets');
  const sources = liste('sources');
  const weitere = [...liste('measurementAreas'), ...liste('stairs'), ...liste('absorbingAreas')];

  if (!targets.length) {
    warnungen.push('Das Szenario hat kein einziges Ziel — die Personen haben nichts anzulaufen.');
  }
  if (!sources.length) {
    warnungen.push('Das Szenario hat keine Quelle — es werden keine Personen erzeugt.');
  }

  // -- Formen und Punktlage ------------------------------------------------
  const alleFormen: { gruppe: string; id: unknown; form: FormPunkte }[] = [];
  const pruefeForm = (gruppe: string, e: Record<string, unknown>, mindestPunkte: number) => {
    const f = formPunkte(e.shape);
    alleFormen.push({ gruppe, id: e.id, form: f });
    const kennung = `${gruppe} ${String(e.id ?? 'ohne id')}`;
    if (f.fehler) {
      fehler.push(`${kennung}: ${f.fehler}.`);
      return;
    }
    if (f.anzahl < mindestPunkte) {
      fehler.push(`${kennung}: shape hat nur ${f.anzahl} Punkte, mindestens ${mindestPunkte} noetig.`);
    }
  };
  for (const e of obstacles) pruefeForm('obstacle', e, 3);
  for (const e of targets) pruefeForm('target', e, 3);
  for (const e of sources) pruefeForm('source', e, 3);

  if (grenzen) {
    const tol = 1e-6;
    const x1 = grenzen.x;
    const y1 = grenzen.y;
    const x2 = grenzen.x + grenzen.width;
    const y2 = grenzen.y + grenzen.height;
    let ausserhalb = 0;
    let inWand = 0;
    for (const f of alleFormen) {
      for (const p of f.form.punkte) {
        if (p[0] < x1 - tol || p[0] > x2 + tol || p[1] < y1 - tol || p[1] > y2 + tol) {
          if (ausserhalb < 5) {
            fehler.push(
              `${f.gruppe} ${String(f.id ?? 'ohne id')}: Punkt (${p[0]}, ${p[1]}) liegt ausserhalb der bounds.`,
            );
          }
          ausserhalb++;
        } else if (
          randWand > 0 &&
          (p[0] < x1 + randWand || p[0] > x2 - randWand || p[1] < y1 + randWand || p[1] > y2 - randWand)
        ) {
          inWand++;
        }
      }
    }
    if (ausserhalb > 5) fehler.push(`... insgesamt ${ausserhalb} Punkte ausserhalb der bounds.`);
    if (inWand > 0) {
      warnungen.push(
        `${inWand} Punkte liegen in der ${randWand} m breiten Randwand, die Vadere selbst zieht — ` +
          'dort koennen Personen weder erzeugt werden noch laufen.',
      );
    }
  }

  // -- Kennungen -----------------------------------------------------------
  const gesehen = new Map<number, string>();
  const pruefeId = (gruppe: string, e: Record<string, unknown>) => {
    const v = e.id;
    if (!istZahl(v)) {
      fehler.push(`${gruppe}: Kennung "id" fehlt oder ist keine Zahl.`);
      return;
    }
    if (v < 0) {
      warnungen.push(`${gruppe} mit id ${v}: negative Kennungen bedeuten in Vadere "nicht gesetzt".`);
      return;
    }
    const vorher = gesehen.get(v);
    if (vorher !== undefined) fehler.push(`Kennung ${v} doppelt vergeben (${vorher} und ${gruppe}).`);
    else gesehen.set(v, gruppe);
  };
  for (const e of obstacles) pruefeId('obstacle', e);
  for (const e of targets) pruefeId('target', e);
  for (const e of sources) pruefeId('source', e);
  for (const e of weitere) pruefeId('sonstiges Element', e);

  // -- Quellen zeigen auf vorhandene Ziele ---------------------------------
  const zielIds = new Set<number>();
  for (const t of targets) if (istZahl(t.id)) zielIds.add(t.id);
  for (const q of sources) {
    const kennung = `source ${String(q.id ?? 'ohne id')}`;
    const ids = q.targetIds;
    if (ids === undefined) {
      fehler.push(`${kennung}: Feld "targetIds" fehlt.`);
      continue;
    }
    if (!Array.isArray(ids)) {
      fehler.push(`${kennung}: "targetIds" ist keine Liste.`);
      continue;
    }
    if (!ids.length) {
      warnungen.push(`${kennung}: keine targetIds — die Personen bekommen kein Ziel zugewiesen.`);
      continue;
    }
    for (const z of ids) {
      if (!istZahl(z)) fehler.push(`${kennung}: targetId "${String(z)}" ist keine Zahl.`);
      else if (!zielIds.has(z)) fehler.push(`${kennung}: targetId ${z} zeigt auf kein vorhandenes Ziel.`);
    }
  }

  return { gueltig: fehler.length === 0, fehler, warnungen };
}

// ---------------------------------------------------------------------------
// Dateiname
// ---------------------------------------------------------------------------

const UMLAUTE: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'ae',
  Ö: 'oe',
  Ü: 'ue',
  ß: 'ss',
  é: 'e',
  è: 'e',
  ê: 'e',
  á: 'a',
  à: 'a',
  â: 'a',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  í: 'i',
  ì: 'i',
  î: 'i',
  ç: 'c',
  ñ: 'n',
};

function kennung(text: string): string {
  const ersetzt = [...text].map((z) => UMLAUTE[z] ?? z).join('');
  return ersetzt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Dateiname fuer ein Vadere-Szenario, immer mit der Endung .scenario. */
export function vadereDateiname(projektName: string, szenario: string): string {
  const p = kennung(projektName) || 'projekt';
  const s = kennung(szenario) || 'szenario';
  return `${p}_${s}.scenario`;
}
