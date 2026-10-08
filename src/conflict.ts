import { ask } from "@tauri-apps/plugin-dialog";

/** Fragt nach, wenn eine Ansicht mit offenem Schreibkonflikt geschlossen wird
 *  und ihr Banner deshalb nicht mehr zu sehen ist (siehe `useAutosave`).
 *  true = externe Version laden.
 *
 *  Schließen des Dialogs zählt als „eigene Version behalten": so verhielt sich
 *  die App vor der Konfliktprüfung, und die eigene Arbeit liegt sichtbar vor
 *  einem — die externe Version steht notfalls noch im Verlauf. */
export function askLoadExternal(what: string): Promise<boolean> {
  return ask(
    `${what} wurde außerhalb der App verändert (z. B. durch Sync von einem anderen Rechner). ` +
      "Welche Version soll gelten?",
    {
      title: "Extern geändert",
      kind: "warning",
      okLabel: "Externe Version laden",
      cancelLabel: "Eigene Version behalten",
    },
  );
}
