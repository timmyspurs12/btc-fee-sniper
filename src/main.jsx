import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FeeSniper from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FeeSniper />
  </StrictMode>
);
