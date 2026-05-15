import { DurableObject } from "cloudflare:workers";
import { createSupabaseClient } from "../db/client";
import { getConversation } from "../db/queries/conversations";
import { getActiveSubscription } from "../db/queries/subscriptions";
import type { Env } from "../lib/env";
import { aggregateProjectContext, compactConversation } from "../lib/llm/compact";

const IDLE_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class CompactionScheduler extends DurableObject<Env> {
  private conversationId: string | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/schedule" && request.method === "POST") {
      const body = (await request.json()) as { conversationId: string };
      this.conversationId = body.conversationId;

      await this.ctx.storage.setAlarm(Date.now() + IDLE_DELAY_MS);
      await this.ctx.storage.put("conversationId", body.conversationId);

      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const conversationId =
      this.conversationId ?? ((await this.ctx.storage.get("conversationId")) as string | undefined);
    if (!conversationId) return;

    const db = createSupabaseClient(this.env);

    try {
      const conversation = await getConversation(db, conversationId);
      if (!conversation) return;

      const sub = await getActiveSubscription(db, conversation.user_id);
      const tier = sub?.status === "active" || sub?.status === "past_due" ? "plus" : "free";
      if (tier !== "plus") return;

      const needsCompaction =
        !conversation.compacted_summary ||
        !conversation.compacted_at ||
        new Date(conversation.updated_at) > new Date(conversation.compacted_at);
      if (!needsCompaction) return;

      const apiKey = this.env.COMPACTION_LLM_KEY;
      if (!apiKey) {
        console.error("[compaction] COMPACTION_LLM_KEY not configured, skipping");
        return;
      }

      const model = this.env.COMPACTION_LLM_MODEL ?? "claude-haiku-4-5-20251001";

      const result = await compactConversation(db, conversationId, conversation.title, apiKey, model);
      console.log(
        `[compaction] Compacted conversation ${conversationId}: ${result.messageCount} messages -> ${result.summary.length} chars`,
      );

      await aggregateProjectContext(db, conversation.project_id, apiKey, model);
      console.log(`[compaction] Re-aggregated project context for ${conversation.project_id}`);
    } catch (err) {
      console.error(`[compaction] Failed for ${conversationId}:`, err);
    }
  }
}
