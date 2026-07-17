import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Settings = lazy(() => import("@/components/Settings").then((m) => ({ default: m.default })));

export const Route = createFileRoute("/settings")({
  component: Settings,
});
