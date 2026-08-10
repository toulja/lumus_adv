/**
 * PALETTE AUS CIELAB RECHNEN — damit kein Farbwert von Hand gewaehlt ist.
 *
 * Eingabe sind die Sollwerte (L*, a*, b*) der Stufenleiter aus
 * scripts/palette-leiter.ts. Ausgabe sind die sRGB-Hexwerte und eine
 * Kontrolltabelle. Die Rueckrechnung Hex -> L*a*b* steht daneben: liegt ein
 * Wert ausserhalb des sRGB-Farbraums, wird er beim Umrechnen beschnitten, und
 * genau dann stimmt das Ist nicht mehr mit dem Soll. Das muss auffallen, statt
 * still eine andere Farbe zu erzeugen.
 *
 * Aufruf: node scripts/palette-rechnen.ts
 */

const WEISS: [number, number, number] = [95.047, 100.0, 108.883];

function labNachRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const g = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = (g(fx) * WEISS[0]) / 100;
  const Y = (L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27)) * (WEISS[1] / 100);
  const Z = (g(fz) * WEISS[2]) / 100;
  const lin = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
  return lin.map((c) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  }) as [number, number, number];
}

function hexAus(L: number, a: number, b: number): string {
  return '#' + labNachRgb(L, a, b).map((v) => v.toString(16).padStart(2, '0')).join('');
}

function linear(k: number): number {
  const c = k / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labAus(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(h.slice(i, i + 2), 16)));
  const X = ((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100) / WEISS[0];
  const Y = ((0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100) / WEISS[1];
  const Z = ((0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100) / WEISS[2];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 841) / 108 + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Relative Leuchtdichte nach WCAG 2.x — fuer die Kontrastprobe der Konturen. */
function leuchtdichte(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const la = leuchtdichte(a);
  const lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Eintrag {
  name: string;
  stufe: number;
  L: number;
  a: number;
  b: number;
  familie: string;
  kontur?: string;
}

/**
 * Stufenleiter. Fuenf Stufen (Ergebnis von scripts/palette-leiter.ts).
 *
 * SOLLABSTAND 9,5 STATT 9,0 — und das ist kein Rundungskosmetik, sondern
 * noetig: Gefordert sind MINDESTENS 9 L*. Rechnet man den Sollwert nach sRGB
 * und aus dem 8-Bit-Hexwert wieder zurueck, verschiebt sich L* um bis zu
 * 0,15 Einheiten. Bei exakt 9,0 Sollabstand landeten acht gemessene
 * Nachbarpaare bei 8,78 bis 8,99 — die Vorgabe waere um Hundertstel gerissen.
 * Mit 9,5 bleibt nach der Quantisierung ueberall ein echtes „>= 9" stehen.
 *
 * DECKEL: 92,8 statt 93,0, aus demselben Grund — 93,0 als Soll ergab nach der
 * Rueckrechnung 93,02 und damit einen Deckelverstoss.
 */
const L_STUFE = [92.8, 83.3, 73.8, 64.3, 54.8];

const FLAECHEN: Eintrag[] = [
  { name: 'fahrbahn', stufe: 0, L: L_STUFE[0], a: 0, b: -1, familie: 'Verkehr kuehl', kontur: 'HAUPT' },
  { name: 'landwirtschaft', stufe: 0, L: L_STUFE[0], a: -5, b: 12, familie: 'Vegetation', kontur: 'LANDW' },
  { name: 'platz', stufe: 1, L: L_STUFE[1], a: 0.2, b: -0.5, familie: 'Verkehr neutral', kontur: 'HAUPT' },
  { name: 'gruen', stufe: 1, L: L_STUFE[1], a: -9, b: 10, familie: 'Vegetation', kontur: 'GRUEN' },
  { name: 'gehweg', stufe: 2, L: L_STUFE[2], a: 0, b: -2, familie: 'Verkehr kuehl', kontur: 'NEBEN' },
  { name: 'fussgaengerzone', stufe: 2, L: L_STUFE[2], a: -5, b: 1, familie: 'Verkehr Mint', kontur: 'HAUPT' },
  { name: 'radweg', stufe: 2, L: L_STUFE[2], a: 8, b: 5, familie: 'Verkehr Ziegel', kontur: 'NEBEN' },
  { name: 'treppe', stufe: 2, L: L_STUFE[2], a: 1, b: 4, familie: 'Verkehr Beton', kontur: 'NEBEN' },
  // Die Platte traegt bewusst nur die schwache Blockkante, keine Hauptkontur:
  // sonst laeuft entlang jeder Strasse eine zweite dunkle Linie (Plattenrand
  // UND Fahrbahnrand) und die Strasse wird zum Liniengeflecht
  // (KARTENDESIGN 5.2). Sie zaehlt deshalb bei der Konturpruefung als
  // Flaechenklasse (>= 10 L*), nicht als Verkehrsflaeche.
  { name: 'platte', stufe: 3, L: L_STUFE[3], a: -0.5, b: -2, familie: 'Verkehr Buehne', kontur: 'BLOCK' },
  { name: 'weg', stufe: 3, L: L_STUFE[3], a: 2, b: 6, familie: 'Verkehr warm', kontur: 'NEBEN' },
  { name: 'wald', stufe: 3, L: L_STUFE[3], a: -13, b: 14, familie: 'Vegetation', kontur: 'WALD' },
  { name: 'wasser', stufe: 3, L: L_STUFE[3], a: -5, b: -9, familie: 'Wasser', kontur: 'WASSER' },
  { name: 'bebauung', stufe: 4, L: L_STUFE[4], a: 1, b: 3, familie: 'Grund warm', kontur: 'BLOCK' },
  { name: 'sonstige', stufe: 4, L: L_STUFE[4], a: 1, b: 3, familie: 'Grund warm (= bebauung)' },
  { name: 'bahn', stufe: 4, L: L_STUFE[4], a: 0, b: -4, familie: 'Verkehr hart', kontur: 'BAHN' },
];

const KONTUREN: Record<string, { L: number; a: number; b: number; zweck: string }> = {
  HAUPT: { L: 30, a: 0, b: -1, zweck: 'Fahrbahn, Platz, Fussgaengerzone' },
  NEBEN: { L: 32, a: 0, b: -1.5, zweck: 'Gehweg, Radweg, Weg, Treppe (der WEG bestimmt die Grenze)' },
  BAHN: { L: 22, a: 0, b: -1, zweck: 'Bahnflaeche — das dunkelste Basiselement' },
  GRUEN: { L: 62, a: -8, b: 9, zweck: 'Gruenflaeche' },
  WALD: { L: 50, a: -11, b: 12, zweck: 'Wald' },
  WASSER: { L: 50, a: -5, b: -10, zweck: 'Uferlinie' },
  BLOCK: { L: 43, a: 1, b: 2, zweck: 'Bauflaeche und Platte — die schwache Blockkante' },
  LANDW: { L: 78, a: -5, b: 12, zweck: 'Ackerkante' },
};

const GEBAEUDE: Eintrag[] = [
  { name: 'wand', stufe: -1, L: 80, a: 0.3, b: 1.2, familie: 'Gebaeude' },
  { name: 'dach', stufe: -1, L: 70, a: 2.3, b: 3.7, familie: 'Gebaeude' },
  { name: 'dachFirst', stufe: -1, L: 52, a: 1.9, b: 3.1, familie: 'Gebaeude' },
  { name: 'sockel', stufe: -1, L: 62, a: 0.9, b: 2.1, familie: 'Gebaeude' },
  { name: 'kante', stufe: -1, L: 45, a: 0, b: 0, familie: 'Gebaeude' },
];

const HIMMEL = { L: 94, a: -1.5, b: -4.9 };

console.log('FLAECHENTOENE (Soll -> Hex -> Ist)\n');
console.log('Klasse            Stufe  L*soll  Hex       L*ist   a*ist   b*ist   Familie');
console.log('-'.repeat(88));
const hexJeName: Record<string, string> = {};
for (const e of FLAECHEN) {
  const hex = hexAus(e.L, e.a, e.b);
  hexJeName[e.name] = hex;
  const ist = labAus(hex);
  const warn = Math.abs(ist[0] - e.L) > 0.6 || Math.abs(ist[1] - e.a) > 0.6 || Math.abs(ist[2] - e.b) > 0.6 ? '  <-- ausserhalb sRGB!' : '';
  console.log(
    `${e.name.padEnd(17)} ${String(e.stufe).padStart(4)}  ${String(e.L).padStart(6)}  ${hex}  ` +
      `${ist[0].toFixed(2).padStart(6)}  ${ist[1].toFixed(2).padStart(6)}  ${ist[2].toFixed(2).padStart(6)}  ${e.familie}${warn}`,
  );
}

console.log('\nKONTURTOENE\n');
console.log('Name     L*soll  Hex       L*ist   Zweck');
console.log('-'.repeat(78));
const konturHex: Record<string, string> = {};
for (const [k, v] of Object.entries(KONTUREN)) {
  const hex = hexAus(v.L, v.a, v.b);
  konturHex[k] = hex;
  console.log(`${k.padEnd(8)} ${String(v.L).padStart(6)}  ${hex}  ${labAus(hex)[0].toFixed(2).padStart(6)}  ${v.zweck}`);
}

console.log('\nGEBAEUDE UND HIMMEL\n');
for (const e of GEBAEUDE) {
  const hex = hexAus(e.L, e.a, e.b);
  console.log(`${e.name.padEnd(12)} ${hex}  L* ${labAus(hex)[0].toFixed(2)}`);
}
console.log(`${'HIMMEL'.padEnd(12)} ${hexAus(HIMMEL.L, HIMMEL.a, HIMMEL.b)}  L* ${HIMMEL.L}`);

console.log('\nPROBE 1 — Abstand innerhalb einer Stufe (muss ueber Farbtemperatur tragen: Dab >= 5)\n');
for (let s = 0; s <= 4; s++) {
  const gruppe = FLAECHEN.filter((e) => e.stufe === s);
  for (let i = 0; i < gruppe.length; i++) {
    for (let j = i + 1; j < gruppe.length; j++) {
      const A = gruppe[i];
      const B = gruppe[j];
      if (A.a === B.a && A.b === B.b) {
        console.log(`  L* ${A.L}: ${A.name} = ${B.name} (bewusst EINE Zeichenklasse)`);
        continue;
      }
      const dab = Math.hypot(A.a - B.a, A.b - B.b);
      console.log(`  L* ${A.L}: ${A.name.padEnd(16)} <-> ${B.name.padEnd(16)} Dab ${dab.toFixed(2).padStart(6)}  ${dab >= 5 ? 'ok' : 'ZU NAH'}`);
    }
  }
}

console.log('\nPROBE 2 — Fuellung gegen ihre eigene Kontur\n');
console.log('Klasse            DL*    Ziel   WCAG-Kontrast (>= 3:1 fuer grafische Objekte)');
console.log('-'.repeat(80));
for (const e of FLAECHEN) {
  if (!e.kontur) continue;
  const f = hexJeName[e.name];
  const k = konturHex[e.kontur];
  const dl = labAus(f)[0] - labAus(k)[0];
  const verkehr = ['fahrbahn', 'platz', 'fussgaengerzone', 'gehweg', 'radweg', 'weg', 'treppe', 'bahn'].includes(e.name);
  const ziel = e.name === 'fahrbahn' ? 40 : verkehr ? 30 : 10;
  const c = kontrast(f, k);
  console.log(
    `${e.name.padEnd(17)} ${dl.toFixed(1).padStart(5)}  >= ${String(ziel).padStart(2)}   ${c.toFixed(2)}:1  ` +
      `${dl >= ziel ? 'ok' : 'ZU SCHWACH'}${c >= 3 ? '' : '  (WCAG 1.4.11 nicht erfuellt)'}`,
  );
}
