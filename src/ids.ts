// IDs für Dinge, die das Frontend anlegt (Mindboard, Zeitstrahl).
//
// Vergibt das Frontend sie gleich beim Anlegen, gibt es keinen Zwischenstand
// mit leerer ID, bis die Antwort vom Speichern da ist — schon im nächsten
// Schritt kann etwas auf das Neue zeigen.

/** Kurze, zufällige ID mit Präfix, z. B. "n-3f9a1c0b2e". */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
