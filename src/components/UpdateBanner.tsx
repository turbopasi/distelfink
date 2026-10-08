import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { hasOpenConflict, useStore } from "../store";

type Phase = "available" | "downloading" | "ready" | "failed";

/** true (und Hinweis), wenn ein Bereich einen ungelösten Schreibkonflikt hat. */
function blockedByConflict(): boolean {
  if (!hasOpenConflict(useStore.getState())) return false;
  useStore.setState({
    error: "Bitte vor dem Update zuerst den offenen Schreibkonflikt lösen.",
  });
  return true;
}

/** Prüft beim Start einmal auf eine neue Version und bietet das Update an.
 *
 *  Die Prüfung fragt `latest.json` aus dem jeweils neuesten GitHub-Release ab
 *  (Endpoint und Signaturschlüssel stehen in `tauri.conf.json`). Schlägt sie
 *  fehl — kein Netz, GitHub nicht erreichbar, noch gar kein Release —, bleibt
 *  das bewusst stumm: ein Schreibprogramm soll beim Start nicht meckern.
 *
 *  Im Entwicklungsmodus ist der Updater nicht eingebunden, dort passiert nichts.
 *
 *  `floating` setzt den Hinweis als Karte in die obere Leiste des Startbildschirms,
 *  neben den Einstellungsknopf; ohne die Angabe bleibt er ein Balken im Fluss. */
export function UpdateBanner({ floating = false }: { floating?: boolean }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("available");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void check()
      .then((found) => {
        if (!cancelled && found) setUpdate(found);
      })
      .catch((e) => console.warn("Update-Prüfung fehlgeschlagen:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  const install = async () => {
    if (blockedByConflict()) return;
    setPhase("downloading");
    setProgress(0);
    try {
      let total = 0;
      let done = 0;
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total > 0) setProgress(Math.round((done / total) * 100));
        }
      });
      // Unter Windows startet der Installer und beendet die App ohne
      // Rückfrage — also vorher alles Offene sichern. Erst nach dem Download,
      // damit währenddessen Getipptes auch dabei ist.
      setPhase("ready");
      await useStore.getState().flushForExit("vor Update");
      // Ein Bereich mit Schreibkonflikt wird nicht gespeichert; der
      // Installer beendete die App, und die Änderungen wären weg.
      if (blockedByConflict()) {
        setPhase("available");
        return;
      }
      await update.install();
      // Der Neustart greift für den Fall, dass die App danach noch läuft.
      await relaunch();
    } catch (e) {
      console.error("Update fehlgeschlagen:", e);
      setPhase("failed");
    }
  };

  const cls = (kind: string) => `banner ${kind} update-banner${floating ? " floating" : ""}`;

  if (phase === "downloading") {
    return (
      <div className={cls("info")}>
        <span>
          <strong>Version {update.version}</strong> wird geladen
          {progress > 0 ? ` — ${progress} %` : "…"}
        </span>
        <span className="update-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className={cls("info")}>
        <span>
          <strong>Version {update.version}</strong> ist installiert. Distelfink startet neu…
        </span>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className={cls("warning")}>
        <span>
          Das Update auf <strong>Version {update.version}</strong> hat nicht geklappt. Du
          kannst es erneut versuchen oder die Version später von Hand herunterladen.
        </span>
        <button className="primary" onClick={() => void install()}>
          Erneut versuchen
        </button>
        <button onClick={() => setDismissed(true)}>Später</button>
      </div>
    );
  }

  return (
    <div className={cls("info")}>
      <span>
        <strong>Version {update.version}</strong> ist verfügbar (installiert:{" "}
        {update.currentVersion}).
      </span>
      <button className="primary" onClick={() => void install()}>
        Jetzt aktualisieren
      </button>
      <button onClick={() => setDismissed(true)}>Später</button>
    </div>
  );
}
