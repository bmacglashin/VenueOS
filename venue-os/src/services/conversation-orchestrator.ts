import "server-only";

import { routeInboundMessage } from "@/src/lib/llm/router";
import {
  findOrCreateConversation,
  getConversationById,
} from "@/src/services/conversations";
import { insertAuditLog } from "@/src/services/audit-logs";
import {
  fetchRecentMessages,
  insertInboundMessage,
  insertOutboundMessage,
} from "@/src/services/messages";
import {
  evaluateResponsePolicy,
} from "@/src/services/response-policy";
import {
  getResolvedOutboundModeForTenant,
} from "@/src/services/outbound-settings";
import {
  dispatchOutboundTransport,
} from "@/src/services/outbound-transport";
import {
  classifyCandidateResponseForSafeSend,
} from "@/src/services/safe-send-classifier";
import type {
  ConversationOrchestratorDependencies,
  ConversationTurnRequest,
} from "@/src/services/conversation-orchestrator-core";
import {
  createConversationOrchestrator as createConversationOrchestratorCore,
} from "@/src/services/conversation-orchestrator-core";

export {
  conversationTurnRequestSchema,
} from "@/src/services/conversation-orchestrator-core";
export type {
  ConversationOrchestratorDependencies,
  ConversationTurnRequest,
  OrchestrateConversationTurnResult,
} from "@/src/services/conversation-orchestrator-core";

async function resolveConversationRecord(input: ConversationTurnRequest) {
  if (input.conversation.id != null) {
    const conversation = await getConversationById(input.conversation.id);

    if (conversation == null) {
      throw new Error(
        `Conversation ${input.conversation.id} was not found for orchestration.`
      );
    }

    if (conversation.tenant_id !== input.tenantId) {
      throw new Error(
        `Conversation ${input.conversation.id} does not belong to tenant ${input.tenantId}.`
      );
    }

    return conversation;
  }

  return findOrCreateConversation({
    tenantId: input.tenantId,
    ghlContactId: input.conversation.ghlContactId ?? null,
    ghlConversationId: input.conversation.ghlConversationId ?? null,
    status: input.conversation.status,
  });
}

function buildConversationOrchestratorDependencies(
  overrides: Partial<ConversationOrchestratorDependencies> = {}
): ConversationOrchestratorDependencies {
  return {
    resolveConversation: resolveConversationRecord,
    fetchRecentMessages,
    routeInboundMessage,
    insertInboundMessage,
    insertOutboundMessage,
    insertAuditLog,
    classifyCandidateResponseForSafeSend,
    evaluateResponsePolicy,
    resolveOutboundMode: getResolvedOutboundModeForTenant,
    dispatchOutboundTransport,
    now: () => new Date(),
    ...overrides,
  };
}

export function createConversationOrchestrator(
  overrides: Partial<ConversationOrchestratorDependencies> = {}
) {
  return createConversationOrchestratorCore(
    buildConversationOrchestratorDependencies(overrides)
  );
}

export const orchestrateConversationTurn = createConversationOrchestrator();
