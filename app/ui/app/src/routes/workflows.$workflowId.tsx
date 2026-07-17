import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const WorkflowBuilder = lazy(() => import("@/components/WorkflowBuilder"));

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowBuilder,
});
