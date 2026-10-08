/** Einheitliche Frage, wenn eine Datei außerhalb der App verändert wurde,
 *  während hier ungespeicherte Änderungen bestehen — für Szenen, Personen/Orte
 *  und Mindboards gleich. */
export function ConflictBanner({
  what,
  onReload,
  onOverwrite,
}: {
  /** Was betroffen ist, als Satzanfang („Dieses Dokument", „Das Mindboard …"). */
  what: string;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div className="banner warning">
      <span>
        {what} wurde außerhalb der App verändert (z. B. durch Sync). Wie möchtest du fortfahren?
      </span>
      <button onClick={onReload}>Externe Version laden (eigene Änderungen verwerfen)</button>
      <button onClick={onOverwrite}>Eigene Version behalten (extern überschreiben)</button>
    </div>
  );
}
