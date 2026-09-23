// Vorschaudaten für Planungs-Tags im Text (Name + Bild beim Überfahren).
//
// Namen kommen aus dem Plan-Index im Store (ohnehin geladen), Bilder werden
// einmal pro Sitzung nachgeladen. Bewusst nur Metadaten: das Freitext-Dokument
// zu lesen würde beim bloßen Hovern die Konflikterkennung zurücksetzen.

import { api } from "../api";
import { PLAN_TAG_RESEARCH, type PlanTagKind } from "../planTags";
import type { PlanIndex } from "../store";

const avatarCache = new Map<string, string | null>();

/** Nach Änderungen an den Recherche-Daten (siehe `refreshPlanIndex`). */
export function clearPlanTagAvatars() {
  avatarCache.clear();
}

function cacheKey(kind: PlanTagKind, id: string) {
  return `${kind}:${id}`;
}

/** Name des Ziels; null = Eintrag existiert nicht (mehr), der Tag zeigt ins Leere. */
export function planTagName(
  kind: PlanTagKind,
  id: string,
  index: PlanIndex,
): string | null {
  return index[PLAN_TAG_RESEARCH[kind]].find((e) => e.id === id)?.name ?? null;
}

/** Schon geladenes Bild (für den ersten Render ohne Flackern). */
export function cachedPlanTagAvatar(kind: PlanTagKind, id: string): string | null {
  return avatarCache.get(cacheKey(kind, id)) ?? null;
}

/** Lädt das Bild nach; null, wenn es keins gibt oder es nicht lesbar ist. */
export async function loadPlanTagAvatar(
  kind: PlanTagKind,
  id: string,
  index: PlanIndex,
): Promise<string | null> {
  const key = cacheKey(kind, id);
  if (avatarCache.has(key)) return avatarCache.get(key) ?? null;

  const research = PLAN_TAG_RESEARCH[kind];
  if (!index[research].find((e) => e.id === id)?.hasImage) {
    avatarCache.set(key, null);
    return null;
  }
  try {
    const avatar = await api.getEntityImage(research, id);
    avatarCache.set(key, avatar);
    return avatar;
  } catch {
    avatarCache.set(key, null);
    return null;
  }
}
