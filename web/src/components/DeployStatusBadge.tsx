import { LoaderCircle } from "lucide-react";
import type { DeployStatus } from "@ensure/core/api";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const LOOK: Record<DeployStatus, { label: string; variant: BadgeProps["variant"] }> = {
  queued: { label: "Queued", variant: "neutral" },
  running: { label: "Deploying", variant: "blue" },
  live: { label: "Live", variant: "success" },
  preview: { label: "On preview", variant: "blue" },
  built: { label: "Dry run", variant: "neutral" },
  superseded: { label: "Superseded", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

export function DeployStatusBadge({ status }: { status: DeployStatus }) {
  const { label, variant } = LOOK[status];
  return <Badge variant={variant}>{(status === "queued" || status === "running") && <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />}{label}</Badge>;
}
