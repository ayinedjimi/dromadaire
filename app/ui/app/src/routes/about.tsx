import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const About = lazy(() => import("@/components/About").then((m) => ({ default: m.default })));

export const Route = createFileRoute("/about")({
  component: About,
});
