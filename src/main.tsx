import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Das Kontextmenü der WebView („Neu laden", „Untersuchen" …) hat in einer
// Desktop-App nichts verloren. Wo die App ein eigenes Menü hat, hat sie es
// ohnehin schon abgefangen; übrig bleiben leere Flächen. Nur in Textfeldern
// bleibt es stehen — dort bringt es Rechtschreibvorschläge und Einfügen.
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Letzte Rettung, falls etwas außerhalb der einzelnen Bereiche scheitert. */}
    <ErrorBoundary label="Distelfink">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
