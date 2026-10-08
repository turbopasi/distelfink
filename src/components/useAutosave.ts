import { useEffect, useRef, useState } from "react";
import { askLoadExternal } from "../conflict";
import { registerSaver, SaveController, type SaveStatus, type WriteOutcome } from "../saving";
import { useStore } from "../store";

/**
 * Speichern für ein Dokument, das einer Ansicht gehört (Person/Ort, Mindboard):
 * ein `SaveController`, beim Store angemeldet, damit `flushAll` es mitschreibt.
 *
 * Wird die Ansicht abgebaut, wird Offenes noch geschrieben. Steht dann ein
 * Konflikt offen, fragt ein Dialog nach — das Banner ist ja nicht mehr zu
 * sehen, und stumm verwerfen soll die App die Arbeit nicht.
 *
 * `reload` läuft nach „Projekt neu laden“: das Backend kennt danach nur noch
 * den neuen Stand der Datei, ein veralteter Stand in der Ansicht würde beim
 * nächsten Speichern also ohne Konfliktmeldung darübergeschrieben. Mit offenem
 * Konflikt bleibt der eigene Stand stehen, bis entschieden ist.
 */
export function useAutosave<T>({
  what,
  delayMs,
  snapshot,
  write,
  reload,
}: {
  /** Für die Rückfrage beim Abbau, als Satzanfang („Das Dokument „Anna““). */
  what: string;
  delayMs: number;
  snapshot: () => T;
  write: (value: T, force: boolean) => Promise<WriteOutcome>;
  /** Liest den Stand von der Platte neu und übernimmt ihn per `saver.reset()`. */
  reload?: () => Promise<void>;
}) {
  const latest = useRef({ what, snapshot, write, reload });
  latest.current = { what, snapshot, write, reload };
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saver] = useState(
    () =>
      new SaveController<T>(
        {
          snapshot: () => latest.current.snapshot(),
          write: (value, force) => latest.current.write(value, force),
          onStatus: setStatus,
          onError: (e) => useStore.setState({ error: String(e) }),
        },
        delayMs,
      ),
  );

  useEffect(() => {
    const unregister = registerSaver(saver);
    return () => {
      unregister();
      void settleOnLeave(saver, latest.current.what);
    };
  }, [saver]);

  const reloadCount = useStore((s) => s.reloadCount);
  const seenReload = useRef(reloadCount);
  useEffect(() => {
    if (seenReload.current === reloadCount) return;
    seenReload.current = reloadCount;
    const run = latest.current.reload;
    if (!run || saver.state === "conflict") return;
    run().catch((e) => useStore.setState({ error: String(e) }));
  }, [reloadCount, saver]);

  return { status, saver };
}

async function settleOnLeave<T>(saver: SaveController<T>, what: string) {
  if (saver.state === "saved") return;
  // Den Stand jetzt festhalten: ein laufender Schreibvorgang oder die
  // Rückfrage lassen sonst Zeit, den Editor abzubauen.
  let value: { value: T };
  try {
    value = { value: saver.snapshot() };
  } catch (e) {
    useStore.setState({ error: String(e) });
    return;
  }
  if (saver.state !== "conflict") {
    await saver.flush(value);
    return;
  }
  if (!(await askLoadExternal(what))) await saver.overwrite(value);
}
