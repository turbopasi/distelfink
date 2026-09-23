// Planungs-Tags: Verweise auf Personen und Orte mitten im Fließtext.
//
// Gespeichert als Markdown-Link mit eigenem Schema:
//
//   Am Abend kam [Er](person:jonas-3f2a1b) zurück.
//
// Bewusst ein Link und kein HTML-Block: pulldown-cmark (Export) verwirft die
// Link-Auszeichnung und behält den sichtbaren Text — Manuskript-Exporte
// enthalten also automatisch nur "Er". Die Volltextsuche indiziert das rohe
// Markdown, findet damit sowohl das Wort als auch die Entity-ID.

import type { PaneResearchKind } from "./store";

export type PlanTagKind = "person" | "location";

export const PLAN_TAG_KINDS: PlanTagKind[] = ["person", "location"];

export const PLAN_TAG_LABEL: Record<PlanTagKind, string> = {
  person: "Person",
  location: "Ort",
};

export const PLAN_TAG_ICON: Record<PlanTagKind, string> = {
  person: "👤",
  location: "📍",
};

/** Tag-Art → Recherche-Bereich (Ordner im Projekt, Pane-Inhalt). */
export const PLAN_TAG_RESEARCH: Record<PlanTagKind, PaneResearchKind> = {
  person: "characters",
  location: "locations",
};

/** IDs kommen aus `make_id` im Backend und sind immer [a-z0-9-]. */
const HREF_PATTERN = /^(person|location):([a-z0-9-]+)$/;

/** "person:jonas-3f2a1b" → Tag-Daten; null bei fremden Links (http, mailto, …). */
export function parsePlanTagHref(
  href: string | null | undefined,
): { kind: PlanTagKind; id: string } | null {
  const match = HREF_PATTERN.exec(href ?? "");
  if (!match) return null;
  return { kind: match[1] as PlanTagKind, id: match[2] };
}

export function planTagHref(kind: PlanTagKind, id: string): string {
  return `${kind}:${id}`;
}
