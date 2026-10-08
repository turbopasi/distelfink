// Gemeinsames Speichern für alles, was die App selbst schreibt: Szenen,
// Personen-/Orts-Dokumente, Mindboards. Ein Ablauf statt einer eigenen
// Variante je Ansicht — damit Verzögern, Reihenfolge und Konflikte überall
// gleich funktionieren:
//
// - Änderungen werden gesammelt und nach einer kurzen Pause geschrieben.
// - Nie zwei Schreibvorgänge gleichzeitig: ein langsamer älterer könnte sonst
//   nach einem neueren fertig werden und dessen Stand überschreiben.
// - Ein Zähler merkt, ob während des Schreibens weiter bearbeitet wurde —
//   dann ist der Stand danach noch nicht gesichert.
// - Meldet das Backend eine Änderung von außen, steht der Konflikt, bis ihn
//   jemand entscheidet. Bis dahin wird nichts geschrieben.

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict";
export type WriteOutcome = "ok" | "conflict";

/** Anzeige des Status in den Statusleisten. */
export const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: "Gespeichert",
  dirty: "Ungespeichert …",
  saving: "Speichert …",
  conflict: "Konflikt",
};

export interface SaveTarget<T> {
  /** Aktueller Stand, synchron abgegriffen — beim Abbau einer Ansicht ist der
   *  Editor kurz danach nicht mehr da. */
  snapshot: () => T;
  /** Schreibt `value`; `force` = auch über eine Änderung von außen. */
  write: (value: T, force: boolean) => Promise<WriteOutcome>;
  onStatus: (status: SaveStatus) => void;
  onError: (e: unknown) => void;
}

export class SaveController<T = unknown> {
  private status: SaveStatus = "saved";
  private edits = 0;
  private savedEdits = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /** Erhöht sich bei `reset`: Ergebnisse älterer Schreibvorgänge zählen nicht mehr. */
  private generation = 0;

  constructor(
    private readonly target: SaveTarget<T>,
    private readonly delayMs: number,
  ) {}

  get state(): SaveStatus {
    return this.status;
  }

  /** Es wurde bearbeitet: gleich (nach der Pause) speichern. */
  markDirty() {
    this.edits++;
    // Ein offener Konflikt bleibt stehen, bis er entschieden ist.
    if (this.status === "saved" || this.status === "saving") this.setStatus("dirty");
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /** Schreibt Offenes sofort; wartet einen laufenden Schreibvorgang ab. Bei
   *  offenem Konflikt passiert nichts. `value` wie bei `overwrite`. */
  async flush(value?: { value: T }) {
    this.clearTimer();
    while (this.inFlight) await this.inFlight;
    if (this.status === "conflict" || this.edits === this.savedEdits) return;
    await this.run(false, value);
  }

  /** Konflikt zugunsten der eigenen Version auflösen. `value` = vorher
   *  abgegriffener Stand (siehe `snapshot`), sonst der aktuelle. */
  async overwrite(value?: { value: T }) {
    this.clearTimer();
    while (this.inFlight) await this.inFlight;
    await this.run(true, value);
  }

  /** Aktueller Stand, wie er geschrieben würde. */
  snapshot(): T {
    return this.target.snapshot();
  }

  /** Neuer Inhalt steht da (anderes Dokument, externe Version übernommen):
   *  nichts mehr offen, kein Konflikt. */
  reset() {
    this.clearTimer();
    this.generation++;
    this.savedEdits = this.edits;
    this.setStatus("saved");
  }

  /** Von außen erkannter Konflikt (etwa beim Abgleich mit der Platte, nachdem
   *  schon bearbeitet wurde): nichts schreiben, bis entschieden ist. */
  raiseConflict() {
    this.clearTimer();
    this.setStatus("conflict");
  }

  /** Verwirft einen geplanten Schreibvorgang (Ansicht wird abgebaut). */
  cancelTimer() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(next: SaveStatus) {
    if (next === this.status) return;
    this.status = next;
    this.target.onStatus(next);
  }

  private async run(force: boolean, given?: { value: T }) {
    const generation = this.generation;
    const seq = this.edits;
    let value: T;
    try {
      value = given ? given.value : this.target.snapshot();
    } catch (e) {
      this.target.onError(e);
      return;
    }
    this.setStatus("saving");
    const job = (async () => {
      try {
        const outcome = await this.target.write(value, force);
        if (generation !== this.generation) return;
        if (outcome === "conflict") {
          this.setStatus("conflict");
          return;
        }
        this.savedEdits = seq;
        this.setStatus(this.edits === seq ? "saved" : "dirty");
      } catch (e) {
        if (generation === this.generation) this.setStatus("dirty");
        this.target.onError(e);
      }
    })();
    this.inFlight = job;
    try {
      await job;
    } finally {
      this.inFlight = null;
    }
  }
}

/** Dokumente, die einer Ansicht gehören (Personen/Orte, Mindboards). Der Store
 *  schreibt sie bei `flushAll` mit — vor Schließen, Sicherungspunkt, Update —
 *  und prüft sie auf offene Konflikte. */
const registered = new Set<Pick<SaveController, "state" | "flush">>();

export function registerSaver(c: Pick<SaveController, "state" | "flush">): () => void {
  registered.add(c);
  return () => {
    registered.delete(c);
  };
}

export async function flushRegistered() {
  for (const c of [...registered]) await c.flush();
}

export function registeredConflict(): boolean {
  return [...registered].some((c) => c.state === "conflict");
}
