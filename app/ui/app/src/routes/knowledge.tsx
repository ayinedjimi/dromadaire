import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Knowledge = lazy(() => import("@/components/Knowledge").then((m) => ({ default: m.default })));

export const Route = createFileRoute("/knowledge")({
  component: Knowledge,
});
