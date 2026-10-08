import { ask } from "@tauri-apps/plugin-dialog";

/** Fragt nach, wenn eine Datei seit dem Laden von außen geändert wurde und
 *  kein Banner (mehr) zu sehen ist: beim Zeitstrahl, und wenn eine Ansicht mit
 *  offenem Konflikt geschlossen wird (siehe `useAutosave`).
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
