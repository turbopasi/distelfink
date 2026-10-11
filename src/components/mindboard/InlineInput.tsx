// Einzeiliges Eingabefeld direkt auf der Fläche (Formtitel, Beschriftung
// einer Verbindung). Enter und Escape beenden, beides übernimmt den Text —
// wie das Verlassen des Felds.

import type { CSSProperties } from "react";

export function InlineInput({
  initial,
  placeholder,
  className,
  style,
  onDone,
}: {
  initial: string;
  placeholder: string;
  className: string;
  style?: CSSProperties;
  /** Getrimmter Text, sobald das Feld verlassen wird. */
  onDone: (value: string) => void;
}) {
  return (
    <input
      autoFocus
      className={className}
      style={style}
      defaultValue={initial}
      placeholder={placeholder}
      // Klicks ins Feld sind kein Ziehen oder Auswählen auf der Fläche.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Tastenkürzel der Fläche (Entf, Strg+Z …) gelten hier nicht.
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      onBlur={(e) => onDone(e.currentTarget.value.trim())}
    />
  );
}
