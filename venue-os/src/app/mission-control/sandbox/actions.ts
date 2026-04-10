"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { runMissionControlSandboxTurn } from "@/src/services/mission-control";

function readFormValue(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function submitMissionControlSandboxMessage(formData: FormData) {
  const tenantId = readFormValue(formData.get("tenantId"));
  const conversationId = readFormValue(formData.get("conversationId"));
  const message = readFormValue(formData.get("message")) ?? "";
  const result = await runMissionControlSandboxTurn({
    tenantId,
    conversationId,
    message,
  });

  revalidatePath("/mission-control");
  revalidatePath("/mission-control/sandbox");
  revalidatePath(`/mission-control/conversations/${result.conversation.id}`);

  redirect(
    `/mission-control/sandbox?tenantId=${result.conversation.tenant_id}&conversationId=${result.conversation.id}`
  );
}
