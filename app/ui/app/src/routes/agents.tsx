import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const AgentsGallery = lazy(() => import("@/components/AgentsGallery"));

export const Route = createFileRoute("/agents")({
  component: AgentsGallery,
});
