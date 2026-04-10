import { NextResponse } from "next/server";

type JsonValue = unknown;

async function parseJsonPayload(req: Request): Promise<JsonValue> {
  return await req.json();
}

function logWebhookPayload(payload: JsonValue) {
  console.log("Received GHL Webhook:", payload);
}

function okResponse() {
  return NextResponse.json(
    { success: true, message: "Webhook received" },
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
    logWebhookPayload(payload);
    return okResponse();
  } catch (error) {
    return errorResponse(error);
  }
}

