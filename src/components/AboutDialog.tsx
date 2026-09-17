// „Über Distelfink" — Version, Lizenz und Herkunft an einer Stelle.
import { useEffect, useState } from "react";
import { getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import { Icon } from "./Icon";

const REPO = "https://github.com/turbopasi/distelfink";

export function AboutOverlay() {
  const open = useStore((s) => s.aboutOpen);
  if (!open) return null;
  return <AboutDialog />;
}

function AboutDialog() {
  const setAboutOpen = useStore((s) => s.setAboutOpen);
  const [version, setVersion] = useState("");
  const [tauri, setTauri] = useState("");

  useEffect(() => {
    // Aus der Anwendung selbst, nicht aus package.json — im Entwicklungsmodus
    // steht hier dieselbe Nummer wie im Installer.
    void getVersion().then(setVersion).catch(() => {});
    void getTauriVersion().then(setTauri).catch(() => {});
  }, []);

  return (
    <div className="quicknav-overlay" onMouseDown={() => setAboutOpen(false)}>
      <div className="history about-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="history-header">
          <h2>Über Distelfink</h2>
          <span className="spacer" />
          <button className="icon-button" title="Schließen" onClick={() => setAboutOpen(false)}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="about-body">
          <img className="app-mark" src="/brand/distelfink-icon.svg" alt="" width="64" height="64" />
          <span className="wordmark-mark" role="img" aria-label="Distelfink" />
          <p className="muted">Desktop-Schreibsoftware für Autoren</p>
          <dl className="about-facts">
            <dt>Version</dt>
            <dd>{version || "…"}</dd>
            <dt>Tauri</dt>
            <dd>{tauri || "…"}</dd>
            <dt>Lizenz</dt>
            <dd>Apache-2.0</dd>
            <dt>Copyright</dt>
            <dd>© 2026 Pascal Lamers</dd>
          </dl>
          <p className="small">
            <button className="link" onClick={() => void openUrl(REPO)}>
              {REPO}
            </button>
          </p>
          <p className="muted small">
            Die Lizenztexte der verwendeten Bibliotheken liegen als
            THIRD-PARTY-NOTICES.md neben der Anwendung.
          </p>
        </div>
      </div>
    </div>
  );
}
