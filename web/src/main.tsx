import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { followKeyboard } from "./lib/keyboard";

// Sheets sit above the on-screen keyboard (#264).
followKeyboard();

// A copy of the page for when there's no connection (see public/sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
