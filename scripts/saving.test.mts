// Headless-Test fürs gemeinsame Speichern (src/saving.ts): Verzögern,
// Reihenfolge, Weitertippen während des Schreibens, Konflikte.
// Aufruf: npx tsx scripts/saving.test.mts
import assert from "node:assert/strict";
import { SaveController, type SaveStatus, type WriteOutcome } from "../src/saving";

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`JA    ${name}`);
  } catch (e) {
    failed++;
    console.log(`NEIN  ${name}\n      ${(e as Error).message}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ein Ziel, dessen Schreibvorgänge der Test von Hand beendet. */
function harness() {
  const statuses: SaveStatus[] = [];
  const writes: { force: boolean; value: number; finish: (o: WriteOutcome) => void }[] = [];
  const errors: unknown[] = [];
  let value = 0;
  let active = 0;
  let maxActive = 0;
  const c = new SaveController<number>(
    {
      snapshot: () => value,
      write: (snap, force) =>
        new Promise<WriteOutcome>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          writes.push({
            force,
            value: snap,
            finish: (o) => {
              active--;
              resolve(o);
            },
          });
        }),
      onStatus: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
    },
    5,
  );
  return {
    c,
    statuses,
    writes,
    errors,
    edit: () => {
      value++;
      c.markDirty();
    },
    maxActive: () => maxActive,
  };
}

await check("speichert erst nach der Pause, einmal für mehrere Änderungen", async () => {
  const h = harness();
  h.edit();
  h.edit();
  h.edit();
  assert.equal(h.writes.length, 0);
  await sleep(20);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].value, 3);
  h.writes[0].finish("ok");
  await sleep(0);
  assert.equal(h.c.state, "saved");
});

await check("nie zwei Schreibvorgänge gleichzeitig", async () => {
  const h = harness();
  h.edit();
  const first = h.c.flush();
  await sleep(0);
  h.edit();
  const second = h.c.flush();
  await sleep(0);
  assert.equal(h.writes.length, 1, "zweiter wartet auf den ersten");
  h.writes[0].finish("ok");
  await first;
  await sleep(0);
  assert.equal(h.writes.length, 2);
  h.writes[1].finish("ok");
  await second;
  assert.equal(h.maxActive(), 1);
  assert.equal(h.c.state, "saved");
});

await check("weitergetippt während des Schreibens → bleibt ungespeichert", async () => {
  const h = harness();
  h.edit();
  const run = h.c.flush();
  await sleep(0);
  h.edit();
  h.writes[0].finish("ok");
  await run;
  assert.equal(h.c.state, "dirty");
  h.c.cancelTimer();
});

await check("Konflikt blockiert weiteres Speichern bis zur Entscheidung", async () => {
  const h = harness();
  h.edit();
  const run = h.c.flush();
  await sleep(0);
  h.writes[0].finish("conflict");
  await run;
  assert.equal(h.c.state, "conflict");
  h.edit();
  await h.c.flush();
  assert.equal(h.writes.length, 1, "kein Schreiben im Konflikt");
  assert.equal(h.c.state, "conflict", "Weitertippen hebt den Konflikt nicht auf");

  const resolve = h.c.overwrite();
  await sleep(0);
  assert.equal(h.writes[1].force, true);
  h.writes[1].finish("ok");
  await resolve;
  assert.equal(h.c.state, "saved");
});

await check("reset verwirft Offenes und spätere Antworten des alten Stands", async () => {
  const h = harness();
  h.edit();
  const run = h.c.flush();
  await sleep(0);
  h.c.reset();
  h.writes[0].finish("conflict");
  await run;
  assert.equal(h.c.state, "saved", "alter Konflikt zählt nicht für das neue Dokument");
  await h.c.flush();
  assert.equal(h.writes.length, 1, "nach reset ist nichts offen");
});

await check("Stand wird beim Start des Schreibens festgehalten", async () => {
  const h = harness();
  h.edit();
  const run = h.c.flush();
  h.edit(); // nach dem Start: gehört nicht mehr zu diesem Schreibvorgang
  await sleep(0);
  assert.equal(h.writes[0].value, 1);
  h.writes[0].finish("ok");
  await run;
  h.c.cancelTimer();
});

await check("Fehler beim Schreiben: bleibt ungespeichert und wird gemeldet", async () => {
  const h = harness();
  const c = new SaveController<number>(
    {
      snapshot: () => 1,
      write: async () => {
        throw new Error("Platte voll");
      },
      onStatus: () => {},
      onError: (e) => h.errors.push(e),
    },
    5,
  );
  c.markDirty();
  await c.flush();
  assert.equal(c.state, "dirty");
  assert.equal(h.errors.length, 1);
});

if (failed) {
  console.log(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Prüfungen bestanden.");
