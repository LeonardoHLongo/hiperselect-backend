/**
 * Decision Logger
 * Registra decisões da IA de atendimento no banco de dados
 */

import { createClient } from '@supabase/supabase-js';
import type { SafeClassificationResult } from './safe-classifier';
import type { SafetyGateResult } from './safety-gate';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export type DecisionLogInput = {
  conversationId: string;
  messageId: string;
  classification: SafeClassificationResult;
  safetyGateResult?: SafetyGateResult;
  replyPreview?: string;
};

/**
 * Registra uma decisão da IA de atendimento no banco
 */
export async function logAttendantDecision(input: DecisionLogInput): Promise<void> {
  if (!supabase) {
    console.log('[DecisionLogger] ⚠️  Supabase not configured - skipping log');
    return;
  }

  try {
    const { error } = await supabase
      .from('ai_attendant_decisions')
      .insert({
        conversation_id: input.conversationId,
        message_id: input.messageId,
        intent: input.classification.intent,
        is_safe: input.classification.isSafe,
        blocked_reason: input.classification.isSafe ? null : input.classification.reason,
        reply_preview: input.replyPreview ? input.replyPreview.substring(0, 200) : null,
        classification_reason: input.classification.reason,
        safety_gate_approved: input.safetyGateResult?.approved ?? null,
        safety_gate_reason: input.safetyGateResult?.reason || input.safetyGateResult?.blockedReason || null,
      });

    if (error) {
      console.error('[DecisionLogger] ❌ Error logging decision:', error);
    } else {
      console.log('[DecisionLogger] ✅ Decision logged successfully');
    }
  } catch (error) {
    console.error('[DecisionLogger] ❌ Error in logAttendantDecision:', error);
  }
}

