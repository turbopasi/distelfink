// PNG-Export eines Mindboards: zeichnet Formen, Linien und Notizen neu auf
// ein Canvas — in den Farben des aktuellen Themes. Der Text kommt aus den
// angezeigten Notizen selbst, damit Verweise ihre Namen tragen wie auf dem
// Board.

import { api } from "../../api";
import type { MindNode, Mindboard } from "../../types";
import { bounds, edgeLine, type Point, type Rect } from "./geometry";
import { IMAGE_DEFAULT_WIDTH } from "./NoteView";

const PAD = 32;
const SCALE = 2;
/** Obergrenze je Kante; größere Boards werden verkleinert. */
const MAX_EDGE = 12000;
/** Innenabstand der Notizen — wie .mb-note in mindboard.css. */
const NOTE_PAD_X = 10;
const NOTE_PAD_Y = 6;

/** Theme-Variable als Farbe, die ein Canvas versteht. */
function resolveColor(host: HTMLElement, value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function mix(host: HTMLElement, color: string, percent: number, base: string): string {
  return resolveColor(host, `color-mix(in srgb, ${color} ${percent}%, ${base})`);
}

async function loadImage(rel: string): Promise<HTMLImageElement | null> {
  const url = await api.readDocImage(rel).catch(() => null);
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next.trimEnd()).width > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
}

function arrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 8;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - 0.45), to.y - size * Math.sin(angle - 0.45));
  ctx.lineTo(to.x - size * Math.cos(angle + 0.45), to.y - size * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Liefert das PNG als base64 (ohne data:-Präfix); null bei leerem Board. */
export async function exportBoardPng(
  board: Mindboard,
  rectOf: (n: MindNode) => Rect,
  host: HTMLElement,
): Promise<string | null> {
  const rects = new Map(board.nodes.map((n) => [n.id, rectOf(n)]));
  const all = bounds([...rects.values(), ...board.shapes]);
  if (!all) return null;

  const style = getComputedStyle(host);
  const bg = resolveColor(host, "var(--surface-app)");
  const card = resolveColor(host, "var(--surface-card)");
  const text = resolveColor(host, "var(--text)");
  const muted = resolveColor(host, "var(--text-muted)");
  const border = resolveColor(host, "var(--border-strong)");
  const font = style.fontFamily;
  const baseSize = parseFloat(style.fontSize) || 14;

  const width = all.w + PAD * 2;
  const height = all.h + PAD * 2;
  const scale = Math.min(SCALE, MAX_EDGE / width, MAX_EDGE / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(PAD - all.x, PAD - all.y);
  ctx.fillStyle = bg;
  ctx.fillRect(all.x - PAD, all.y - PAD, width, height);
  ctx.textBaseline = "top";

  // Formen
  for (const s of board.shapes) {
    const color = s.color || border;
    ctx.fillStyle = mix(host, color, 10, "transparent");
    ctx.strokeStyle = mix(host, color, 60, "transparent");
    ctx.lineWidth = 1;
    roundRect(ctx, s, 10);
    ctx.fill();
    ctx.stroke();
    if (s.title) {
      ctx.fillStyle = s.color ? mix(host, s.color, 80, text) : muted;
      ctx.font = `600 ${baseSize - 1}px ${font}`;
      ctx.fillText(s.title, s.x + 10, s.y + 8, s.w - 20);
    }
  }

  // Verbindungen
  ctx.strokeStyle = muted;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1.25;
  for (const e of board.edges) {
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b) continue;
    const line = edgeLine(a, b);
    if (!line) continue;
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
    if (e.arrow === "end" || e.arrow === "both") arrowHead(ctx, line.a, line.b);
    if (e.arrow === "both") arrowHead(ctx, line.b, line.a);
    if (e.label) {
      const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
      ctx.font = `${baseSize - 2}px ${font}`;
      const w = ctx.measureText(e.label).width + 10;
      ctx.fillStyle = bg;
      ctx.fillRect(mid.x - w / 2, mid.y - 9, w, 18);
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.fillText(e.label, mid.x, mid.y - 7);
      ctx.textAlign = "start";
      ctx.fillStyle = muted;
    }
  }

  // Notizen
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    board.nodes
      .filter((n) => n.kind === "image" && n.image)
      .map(async (n) => images.set(n.id, await loadImage(n.image!))),
  );
  for (const n of board.nodes) {
    const r = rects.get(n.id)!;
    if (n.kind === "image") {
      const img = images.get(n.id);
      if (img) {
        const w = n.w || IMAGE_DEFAULT_WIDTH;
        ctx.drawImage(img, r.x, r.y, w, (img.naturalHeight / img.naturalWidth) * w);
      }
      continue;
    }
    const border = n.border || "none";
    const accent = n.color || "";
    if (accent || border !== "none") {
      ctx.fillStyle = accent ? mix(host, accent, 14, card) : card;
      roundRect(ctx, r, border === "cloud" ? r.h / 2 : border === "rounded" ? 8 : 2);
      ctx.fill();
      if (border !== "none") {
        ctx.strokeStyle = accent || border;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    }
    const size = n.fontSize || baseSize;
    ctx.font = `${n.bold ? 600 : 400} ${size}px ${font}`;
    ctx.fillStyle = accent ? mix(host, accent, 70, text) : text;
    const el = host.querySelector<HTMLElement>(`[data-node-id="${n.id}"]`);
    const label = n.kind === "text" ? (n.text ?? "") : (el?.innerText.trim() ?? "");
    const lineHeight = size * 1.35;
    const lines = wrap(ctx, label, r.w - NOTE_PAD_X * 2 + 1);
    lines.forEach((l, i) =>
      ctx.fillText(l, r.x + NOTE_PAD_X, r.y + NOTE_PAD_Y + i * lineHeight),
    );
  }

  const url = canvas.toDataURL("image/png");
  return url.slice(url.indexOf(",") + 1);
}
