import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SidebarLayout } from "@/components/layout/layout";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ModelDiscovery } from "@/components/ModelDiscovery";

export const Route = createFileRoute("/models")({
  component: ModelsPage,
});

function ModelsPage() {
  const navigate = useNavigate();
  return (
    <SidebarLayout sidebar={<ChatSidebar currentChatId="" />}>
      <ModelDiscovery onBack={() => navigate({ to: "/" })} />
    </SidebarLayout>
  );
}
