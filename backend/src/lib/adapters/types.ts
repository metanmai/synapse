import type { CanonicalMessage, FidelityMode } from "../../db/types";

export type { CanonicalMessage, FidelityMode } from "../../db/types";
export type { ToolInteraction, MessageSource, MediaAttachment } from "../../db/types";

export interface AgentAdapter {
  name: string;
  detect(raw: unknown): boolean;
  toCanonical(raw: unknown): CanonicalMessage[];
  fromCanonical(messages: CanonicalMessage[], fidelity: FidelityMode): unknown;
}
