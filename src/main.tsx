import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "@/App";
import "@/index.css";

// Hash routing, deliberately: it is the one mode that works unchanged both on
// GitHub Pages (no server to rewrite deep links) and under Electron's file://
// protocol. Browser-history routing would need a redirect hack on one and
// breaks outright on the other.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
