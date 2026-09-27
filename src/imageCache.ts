// Zwischenspeicher für Dokument-Bilder als data-URL (rel. Pfad → URL).
//
// Die URLs sind base64 und damit rund ein Drittel größer als das Bild selbst.
// Ohne Obergrenze wüchse der Speicher mit jedem angesehenen Screenshot über
// die ganze Sitzung — und über Projektwechsel hinweg, bei denen derselbe
// relative Pfad obendrein ein anderes Bild meinen kann.

/** Höchstens so viele Bilder bleiben zwischengespeichert. */
const MAX_ENTRIES = 40;

const cache = new Map<string, string>();

export function getCachedImage(rel: string): string | undefined {
  const url = cache.get(rel);
  if (url !== undefined) {
    // Zuletzt benutzt nach hinten — Map behält die Einfügereihenfolge.
    cache.delete(rel);
    cache.set(rel, url);
  }
  return url;
}

export function cacheImage(rel: string, url: string) {
  cache.delete(rel);
  cache.set(rel, url);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Beim Projektwechsel: Pfade gelten nur innerhalb eines Projekts. */
export function clearImageCache() {
  cache.clear();
}
