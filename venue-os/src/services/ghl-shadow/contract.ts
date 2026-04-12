import {
  toGhlContactPayload,
  toGhlNotePayload,
  toGhlOpportunityPayload,
  toGhlOutboundMessagePayload,
  type ToGhlPayloadContext,
} from "./mappers";
import type {
  CanonicalContactDTO,
  CanonicalNoteDTO,
  CanonicalOpportunityDTO,
  CanonicalOutboundMessageDTO,
  GhlContactPayload,
  GhlNotePayload,
  GhlOpportunityPayload,
  GhlOutboundMessagePayload,
} from "./types";

export const GHL_SHADOW_OPERATION_ACTIONS = [
  "upsert",
  "create",
  "dispatch",
] as const;

export type GhlShadowOperationAction =
  (typeof GHL_SHADOW_OPERATION_ACTIONS)[number];

export interface GhlShadowPreparedOperation<
  TEntity extends "contact" | "opportunity" | "note" | "outboundMessage",
  TAction extends GhlShadowOperationAction,
  TPayload,
> {
  entity: TEntity;
  action: TAction;
  locationId: string;
  externalId: string | null;
  payload: TPayload;
}

export type PreparedContactUpsertOperation = GhlShadowPreparedOperation<
  "contact",
  "upsert",
  GhlContactPayload
>;

export type PreparedOpportunityUpsertOperation = GhlShadowPreparedOperation<
  "opportunity",
  "upsert",
  GhlOpportunityPayload
>;

export type PreparedNoteCreateOperation = GhlShadowPreparedOperation<
  "note",
  "create",
  GhlNotePayload
>;

export type PreparedOutboundDispatchOperation = GhlShadowPreparedOperation<
  "outboundMessage",
  "dispatch",
  GhlOutboundMessagePayload
>;

export interface GhlShadowProviderContract {
  readonly provider: "ghl-shadow";
  prepareContactUpsert(input: {
    contact: CanonicalContactDTO;
    context: ToGhlPayloadContext;
  }): PreparedContactUpsertOperation;
  prepareOpportunityUpsert(input: {
    opportunity: CanonicalOpportunityDTO;
    context: ToGhlPayloadContext;
  }): PreparedOpportunityUpsertOperation;
  prepareNoteCreate(input: {
    note: CanonicalNoteDTO;
    context: ToGhlPayloadContext;
  }): PreparedNoteCreateOperation;
  prepareOutboundDispatch(input: {
    message: CanonicalOutboundMessageDTO;
    context: ToGhlPayloadContext;
  }): PreparedOutboundDispatchOperation;
}

export function createGhlShadowMapperProvider(): GhlShadowProviderContract {
  return {
    provider: "ghl-shadow",
    prepareContactUpsert(input) {
      return {
        entity: "contact",
        action: "upsert",
        locationId: input.context.locationId,
        externalId: input.contact.externalId,
        payload: toGhlContactPayload(input),
      };
    },
    prepareOpportunityUpsert(input) {
      return {
        entity: "opportunity",
        action: "upsert",
        locationId: input.context.locationId,
        externalId: input.opportunity.externalId,
        payload: toGhlOpportunityPayload(input),
      };
    },
    prepareNoteCreate(input) {
      return {
        entity: "note",
        action: "create",
        locationId: input.context.locationId,
        externalId: input.note.externalId,
        payload: toGhlNotePayload(input),
      };
    },
    prepareOutboundDispatch(input) {
      return {
        entity: "outboundMessage",
        action: "dispatch",
        locationId: input.context.locationId,
        externalId: input.message.externalId,
        payload: toGhlOutboundMessagePayload(input),
      };
    },
  };
}
