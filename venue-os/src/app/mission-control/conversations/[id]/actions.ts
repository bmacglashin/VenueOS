"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addOperatorNote,
  approveDraftAndSend,
  editDraftAndSend,
  regenerateDraft,
} from "@/src/services/operator-review";

function readFormValue(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function refreshMissionControlPaths(conversationId: string) {
  revalidatePath("/mission-control");
  revalidatePath("/mission-control/sandbox");
  revalidatePath(`/mission-control/conversations/${conversationId}`);
}

export async function approveDraftAndSendAction(formData: FormData) {
  const conversationId = readFormValue(formData.get("conversationId"));
  const tenantId = readFormValue(formData.get("tenantId"));
  const draftMessageId = readFormValue(formData.get("draftMessageId"));

  if (conversationId == null || tenantId == null) {
    throw new Error("Conversation id and tenant id are required.");
  }

  await approveDraftAndSend({
    tenantId,
    conversationId,
    draftMessageId,
  });

  refreshMissionControlPaths(conversationId);
  redirect(`/mission-control/conversations/${conversationId}?tenantId=${tenantId}`);
}

export async function editDraftAndSendAction(formData: FormData) {
  const conversationId = readFormValue(formData.get("conversationId"));
  const tenantId = readFormValue(formData.get("tenantId"));
  const draftMessageId = readFormValue(formData.get("draftMessageId"));
  const content = readFormValue(formData.get("content")) ?? "";

  if (conversationId == null || tenantId == null) {
    throw new Error("Conversation id and tenant id are required.");
  }

  await editDraftAndSend({
    tenantId,
    conversationId,
    draftMessageId,
    content,
  });

  refreshMissionControlPaths(conversationId);
  redirect(`/mission-control/conversations/${conversationId}?tenantId=${tenantId}`);
}

export async function regenerateDraftAction(formData: FormData) {
  const conversationId = readFormValue(formData.get("conversationId"));
  const tenantId = readFormValue(formData.get("tenantId"));
  const draftMessageId = readFormValue(formData.get("draftMessageId"));

  if (conversationId == null || tenantId == null) {
    throw new Error("Conversation id and tenant id are required.");
  }

  await regenerateDraft({
    tenantId,
    conversationId,
    draftMessageId,
  });

  refreshMissionControlPaths(conversationId);
  redirect(`/mission-control/conversations/${conversationId}?tenantId=${tenantId}`);
}

export async function addOperatorNoteAction(formData: FormData) {
  const conversationId = readFormValue(formData.get("conversationId"));
  const tenantId = readFormValue(formData.get("tenantId"));
  const note = readFormValue(formData.get("note")) ?? "";

  if (conversationId == null || tenantId == null) {
    throw new Error("Conversation id and tenant id are required.");
  }

  await addOperatorNote({
    tenantId,
    conversationId,
    note,
  });

  refreshMissionControlPaths(conversationId);
  redirect(`/mission-control/conversations/${conversationId}?tenantId=${tenantId}`);
}
