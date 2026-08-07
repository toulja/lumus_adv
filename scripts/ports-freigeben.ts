/**
 * Gibt die Ports der Anwendung frei.
 * Aufruf:  npm run ports:frei
 *
 * Unter Windows bleibt nach einem harten Abbruch regelmaessig ein Node-Prozess
 * auf 4720 oder 5273 liegen. Der naechste Start scheitert dann mit EADDRINUSE,
 * und die Fehlermeldung nennt nur den Port, nicht den Schuldigen.
 */

import { execFileSync } from 'node:child_process';

const PORTS = [4720, 5273];

function belegtVon(port: number): number[] {
  try {
    const ausgabe =
      process.platform === 'win32'
        ? execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
        : execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
    if (process.platform !== 'win32') {
      return ausgabe.split(/\s+/).filter(Boolean).map(Number);
    }
    const pids = new Set<number>();
    for (const zeile of ausgabe.split(/\r?\n/)) {
      // Nur lauschende Sockets auf genau diesem Port
      const m = new RegExp(`\\s\\S*[:.]${port}\\s+\\S+\\s+(?:LISTENING|ABH\\S*REN)\\s+(\\d+)`, 'i').exec(zeile);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function beenden(pid: number): boolean {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

let gesamt = 0;
for (const port of PORTS) {
  const pids = belegtVon(port);
  if (!pids.length) {
    console.log(`Port ${port}: frei.`);
    continue;
  }
  for (const pid of pids) {
    const ok = beenden(pid);
    gesamt += ok ? 1 : 0;
    console.log(`Port ${port}: Prozess ${pid} ${ok ? 'beendet' : 'liess sich NICHT beenden (Rechte?)'}.`);
  }
}
console.log(gesamt ? `\n${gesamt} Prozess(e) beendet. Jetzt \`npm run dev\` starten.` : '\nAlle Ports waren bereits frei.');
