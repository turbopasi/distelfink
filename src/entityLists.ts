// Personen-/Ortslisten, geteilt zwischen Sidebar und Recherche-Bereich. Die
// Sidebar lädt sie ohnehin beim Öffnen des Projekts — der Bereich kann den
// gewählten Eintrag dann sofort zeigen, statt beim Wechsel (etwa von einer
// Szene zu einer Person) erst auf die Liste zu warten.

import { api } from "./api";
import type { Entity, EntityKind } from "./types";

const lists = new Map<string, Entity[]>();

const keyOf = (root: string | undefined, kind: EntityKind) => `${root ?? ""}|${kind}`;

/** Zuletzt geladene Liste dieses Projekts, falls schon bekannt. */
export function cachedEntities(root: string | undefined, kind: EntityKind): Entity[] | undefined {
  return lists.get(keyOf(root, kind));
}

/** Lädt die Liste frisch und legt sie im Cache ab. */
export async function loadEntities(root: string | undefined, kind: EntityKind): Promise<Entity[]> {
  const list = await api.listEntities(kind);
  lists.set(keyOf(root, kind), list);
  return list;
}
