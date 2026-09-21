export type NodeKind = "chapter" | "scene";

export type NodeStatus = "draft" | "revision" | "done";

export interface BinderNode {
  id: string;
  kind: NodeKind;
  title: string;
  synopsis?: string;
  status?: NodeStatus;
  color?: string | null;
  tags?: string[];
  /** Kartenbild fürs Corkboard: projektrelativer Pfad unter images/. */
  image?: string | null;
  children: BinderNode[];
}

export interface ProjectMeta {
  formatVersion: number;
  title: string;
  author: string;
  created: string;
  binder: BinderNode[];
}

export interface ProjectInfo {
  root: string;
  meta: ProjectMeta;
}

export type WriteResult = { status: "ok" } | { status: "conflict" };

export type EntityKind = "characters" | "locations";

export interface EntityField {
  label: string;
  value: string;
}

export interface Entity {
  id: string;
  name: string;
  description?: string;
  fields?: EntityField[];
  sceneIds?: string[];
  image?: string | null;
}

export interface NoteInfo {
  id: string;
  title: string;
}

/** Ein Eintrag im Papierkorb des Projekts. */
export interface TrashItem {
  key: string;
  /** "chapter" | "scene" | "note" | "characters" | "locations" */
  kind: string;
  id: string;
  title: string;
  /** ms seit Epoch. */
  deletedAt: number;
  files: { name: string; target: string }[];
  node?: BinderNode;
  parentId?: string | null;
  index: number;
}

export interface TimelineEvent {
  id: string;
  title: string;
  when?: string;
  description?: string;
  sceneIds?: string[];
  /** Personen, die im Ereignis vorkommen. */
  characterIds?: string[];
  /** Handlungsstrang; leer heißt „erster Strang" (Dateien vor den Strängen). */
  trackId?: string;
  /** Position auf der gemeinsamen Zeitachse. Gleicher Slot in zwei Strängen
   *  heißt „zur selben Zeit"; ausgelassene Slots sind gewollte Lücken. */
  slot?: number;
}

/** Ein Handlungsstrang. `color` ist ein Wert aus COLOR_PRESETS, "" = keine. */
export interface TimelineTrack {
  id: string;
  name: string;
  color?: string;
}

/** Stränge nebeneinander (Zeit läuft nach unten) oder untereinander (nach rechts). */
export type TimelineOrientation = "columns" | "rows";

/** Der ganze Zeitstrahl, so wie er in timeline.json steht. Die Reihenfolge im
 *  events-Array ist die Chronologie; ein Strang sieht davon seinen Anteil. */
export interface Timeline {
  tracks: TimelineTrack[];
  events: TimelineEvent[];
  orientation?: TimelineOrientation | "";
}

/** Fundstelle eines Planungs-Tags im Text (Rückverlinkung). */
export interface Mention {
  /** Dokumentart, in der der Tag steht. */
  source: "scene" | "note" | "character" | "location";
  sourceId: string;
  sourceTitle: string;
  /** Das getaggte Wort im Fließtext ("Er", "Seine", "Jonas", …). */
  label: string;
  /** Umgebender Text als Vorschau. */
  context: string;
}

export interface SearchHit {
  kind: "scene" | "note" | "character" | "location" | "event";
  id: string;
  title: string;
  snippet: string;
}

export interface VersionInfo {
  commitId: string;
  timestampMs: number;
  message: string;
}

export type ExportFormat = "docx" | "pdf" | "epub" | "markdown" | "txt";

export interface ExportTemplate {
  id: string;
  name: string;
  builtIn?: boolean;
  /** "times" | "georgia" | "arial" | "courier" */
  font: string;
  fontSizePt: number;
  lineSpacing: number;
  marginsMm: { top: number; bottom: number; left: number; right: number };
  /** Kopfzeile mit Platzhaltern {titel} {autor} {seite}; leer = keine. */
  header: string;
  sceneSeparator: string;
  chapterStartNewPage: boolean;
  includeSceneTitles: boolean;
  /** Grundausrichtung für Absätze ohne eigene Ausrichtung: "left" | "justify". */
  alignment: string;
  /** Silbentrennung im ePub (PDF und DOCX trennen nicht). */
  hyphenation: boolean;
  /** BCP-47-Sprachcode für ePub-Metadaten und xml:lang. */
  language: string;
}

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  docx: "Word (DOCX)",
  pdf: "PDF",
  epub: "ePub (E-Book)",
  markdown: "Markdown",
  txt: "Reiner Text (TXT)",
};

export const EXPORT_FONT_LABEL: Record<string, string> = {
  times: "Times New Roman",
  georgia: "Georgia",
  arial: "Arial",
  courier: "Courier New",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  draft: "Entwurf",
  revision: "Überarbeitung",
  done: "Fertig",
};

export const COLOR_PRESETS = [
  "#c0392b",
  "#e67e22",
  "#e6b33f",
  "#27ae60",
  "#4a6da7",
  "#8e5aa7",
];

/** Namen der Farbcodes — für Menüs, wo ein Punkt allein zu wenig sagt. */
export const COLOR_LABEL: Record<string, string> = {
  "#c0392b": "Rot",
  "#e67e22": "Orange",
  "#e6b33f": "Gelb",
  "#27ae60": "Grün",
  "#4a6da7": "Blau",
  "#8e5aa7": "Violett",
};
