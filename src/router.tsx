import { createHashRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./App";
import { RecallSection } from "./features/recall/RecallSection";
import { HooklabSection } from "./features/hooklab/HooklabSection";
import { BlastSection } from "./features/blast/BlastSection";
import { PulseSection } from "./features/pulse/PulseSection";
import { SettingsSection } from "./features/settings/SettingsSection";

/**
 * Hash routing (#/recall) rather than history routing: GitHub Pages serves
 * static files only, so a deep link like /Creators-Stack/recall would 404 on
 * refresh without a redirect hack. Hashes need no server cooperation.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/recall" replace /> },
      { path: "recall", element: <RecallSection /> },
      { path: "hooklab", element: <HooklabSection /> },
      { path: "blast", element: <BlastSection /> },
      { path: "pulse", element: <PulseSection /> },
      { path: "settings", element: <SettingsSection /> },
      { path: "*", element: <Navigate to="/recall" replace /> },
    ],
  },
]);
