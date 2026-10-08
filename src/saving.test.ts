// Gemeinsames Speichern: Verzögern, Reihenfolge, Weitertippen während des
// Schreibens, Konflikte.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveController, type WriteOutcome } from "./saving";

/** Ein Ziel, dessen Schreibvorgänge der Test von Hand beendet. */
function harness() {
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
      onStatus: () => {},
      onError: (e) => errors.push(e),
    },
    5,
  );
  return {
    c,
    writes,
    errors,
    edit: () => {
      value++;
      c.markDirty();
    },
    maxActive: () => maxActive,
  };
}

/** Lässt anstehende Promise-Fortsetzungen laufen. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("SaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("speichert erst nach der Pause, einmal für mehrere Änderungen", async () => {
    const h = harness();
    h.edit();
    h.edit();
    h.edit();
    expect(h.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].value).toBe(3);
    h.writes[0].finish("ok");
    await settle();
    expect(h.c.state).toBe("saved");
  });

  it("schreibt nie zweimal gleichzeitig", async () => {
    const h = harness();
    h.edit();
    const first = h.c.flush();
    await settle();
    h.edit();
    const second = h.c.flush();
    await settle();
    expect(h.writes).toHaveLength(1);
    h.writes[0].finish("ok");
    await first;
    await settle();
    expect(h.writes).toHaveLength(2);
    h.writes[1].finish("ok");
    await second;
    expect(h.maxActive()).toBe(1);
    expect(h.c.state).toBe("saved");
  });

  it("bleibt ungespeichert, wenn während des Schreibens weitergetippt wurde", async () => {
    const h = harness();
    h.edit();
    const run = h.c.flush();
    await settle();
    h.edit();
    h.writes[0].finish("ok");
    await run;
    expect(h.c.state).toBe("dirty");
  });

  it("hält den Stand beim Start des Schreibens fest", async () => {
    const h = harness();
    h.edit();
    const run = h.c.flush();
    h.edit(); // nach dem Start: gehört nicht mehr zu diesem Schreibvorgang
    await settle();
    expect(h.writes[0].value).toBe(1);
    h.writes[0].finish("ok");
    await run;
  });

  it("schreibt bei offenem Konflikt nichts, bis entschieden ist", async () => {
    const h = harness();
    h.edit();
    const run = h.c.flush();
    await settle();
    h.writes[0].finish("conflict");
    await run;
    expect(h.c.state).toBe("conflict");

    h.edit();
    await h.c.flush();
    expect(h.writes).toHaveLength(1);
    expect(h.c.state).toBe("conflict");

    const resolve = h.c.overwrite();
    await settle();
    expect(h.writes[1].force).toBe(true);
    h.writes[1].finish("ok");
    await resolve;
    expect(h.c.state).toBe("saved");
  });

  it("verwirft bei reset Offenes und spätere Antworten zum alten Stand", async () => {
    const h = harness();
    h.edit();
    const run = h.c.flush();
    await settle();
    h.c.reset();
    h.writes[0].finish("conflict");
    await run;
    expect(h.c.state).toBe("saved");
    await h.c.flush();
    expect(h.writes).toHaveLength(1);
  });

  it("bleibt bei einem Fehler ungespeichert und meldet ihn", async () => {
    const errors: unknown[] = [];
    const c = new SaveController<number>(
      {
        snapshot: () => 1,
        write: async () => {
          throw new Error("Platte voll");
        },
        onStatus: () => {},
        onError: (e) => errors.push(e),
      },
      5,
    );
    c.markDirty();
    await c.flush();
    expect(c.state).toBe("dirty");
    expect(errors).toHaveLength(1);
  });
});
