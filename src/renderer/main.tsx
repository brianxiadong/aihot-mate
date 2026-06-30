import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MiniReader from "./MiniReader";
import PetApp from "./PetApp";
import "./styles.css";

const surface = new URLSearchParams(window.location.search).get("surface") || "main";
document.body.dataset.surface = surface;

function Root() {
  if (surface === "pet") return <PetApp />;
  if (surface === "mini") return <MiniReader />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
