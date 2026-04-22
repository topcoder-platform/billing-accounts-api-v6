import { BadRequestException } from "@nestjs/common";

export const BUDGET_ENTRY_EXTERNAL_TYPES = ["CHALLENGE", "ENGAGEMENT"] as const;

export type BudgetEntryExternalTypeValue =
  (typeof BUDGET_ENTRY_EXTERNAL_TYPES)[number];

export const DEFAULT_BUDGET_ENTRY_EXTERNAL_TYPE: BudgetEntryExternalTypeValue =
  "CHALLENGE";

export interface BudgetEntryReferenceInput {
  externalId?: string;
  externalType?: BudgetEntryExternalTypeValue;
  challengeId?: string;
}

export interface BudgetEntryReference {
  externalId: string;
  externalType: BudgetEntryExternalTypeValue;
}

/**
 * Builds the stable map key used when joining external budget entries to
 * resolved display names.
 *
 * @param reference Typed external budget-entry reference.
 * @returns Composite string key for map lookups.
 */
export function getBudgetEntryReferenceKey(
  reference: BudgetEntryReference,
): string {
  return `${reference.externalType}:${reference.externalId}`;
}

/**
 * Resolves a budget-entry request into the canonical typed external reference.
 *
 * `challengeId` is accepted only as a compatibility alias for legacy challenge
 * callers; new callers should send `externalId` and optionally `externalType`.
 *
 * @param input Incoming lock/consume request reference fields.
 * @returns Canonical external id and external type.
 * @throws BadRequestException When the reference is missing or ambiguous.
 */
export function resolveBudgetEntryReference(
  input: BudgetEntryReferenceInput,
): BudgetEntryReference {
  const externalId = input.externalId?.trim();
  const challengeId = input.challengeId?.trim();

  if (externalId && challengeId && externalId !== challengeId) {
    throw new BadRequestException(
      "externalId and challengeId must match when both are provided",
    );
  }

  const resolvedExternalId = externalId || challengeId;

  if (!resolvedExternalId) {
    throw new BadRequestException("externalId is required");
  }

  return {
    externalId: resolvedExternalId,
    externalType: input.externalType ?? DEFAULT_BUDGET_ENTRY_EXTERNAL_TYPE,
  };
}
