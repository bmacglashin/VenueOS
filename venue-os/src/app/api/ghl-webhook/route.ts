import { NextResponse } from "next/server";

import {
  conversationTurnRequestSchema,
  orchestrateConversationTurn,
} from "@/src/services/conversation-orchestrator";

type JsonValue = unknown;

async function parseJsonPayload(req: Request): Promise<JsonValue> {
  return await req.json();
}

function logWebhookPayload(payload: JsonValue) {
  console.log("Received GHL Webhook:", payload);
}

function acceptedWithoutTurnResponse() {
  return NextResponse.json(
    {
      success: true,
      accepted: false,
      message:
        "Webhook received without a supported conversation-turn envelope.",
    },
    { status: 202 }
  );
}

function orchestratedResponse(
  result: Awaited<ReturnType<typeof orchestrateConversationTurn>>
) {
  return NextResponse.json(
    {
      success: true,
      message: "Conversation turn orchestrated",
      conversationId: result.conversation.id,
      inboundMessageId: result.inboundMessage.id,
      aiDraftMessageId: result.aiDraftMessage.id,
      classification: result.classification,
      aiReply: result.aiReply,
    },
    { status: 200 }
  );
}

function errorResponse(error: unknown) {
  console.error("GHL Webhook error:", error);
  return NextResponse.json(
    { success: false, message: "Failed to process webhook" },
    { status: 500 }
  );
}

export async function POST(req: Request) {
  try {
    const payload = await parseJsonPayload(req);
    const parsedPayload = conversationTurnRequestSchema.safeParse(payload);

    if (!parsedPayload.success) {
      logWebhookPayload(payload);
      return acceptedWithoutTurnResponse();
    }

    const result = await orchestrateConversationTurn(parsedPayload.data);
    return orchestratedResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

