import type { AIAnalysis, AIDecision } from './types';

export class AIDecisionEngine {
  decide(analysis: AIAnalysis, hasCompanyContext: boolean, isAiEnabled: boolean): AIDecision {
    if (!isAiEnabled) {
      return {
        action: 'CREATE_TICKET',
        reason: 'AI is disabled for this conversation',
        analysis,
      };
    }

    if (!hasCompanyContext) {
      return {
        action: 'CREATE_TICKET',
        reason: 'Company context is missing',
        analysis,
      };
    }

    const canAutoRespond = this.canAutoRespond(analysis);

    if (canAutoRespond) {
      return {
        action: 'AUTO_RESPOND',
        reason: 'Message meets all safety criteria for auto-response',
        analysis,
      };
    }

    return {
      action: 'CREATE_TICKET',
      reason: this.getTicketReason(analysis),
      analysis,
    };
  }

  private canAutoRespond(analysis: AIAnalysis): boolean {
    const isInformational = analysis.intent === 'informational';
    const isNeutralOrPositive =
      analysis.sentiment === 'neutral' || analysis.sentiment === 'positive';
    const isLowUrgency = analysis.urgency === 'low';
    const hasNoRisk = analysis.riskLevel === 'none' || analysis.riskLevel === 'low';

    return isInformational && isNeutralOrPositive && isLowUrgency && hasNoRisk;
  }

  private getTicketReason(analysis: AIAnalysis): string {
    const reasons: string[] = [];

    if (analysis.intent === 'complaint') {
      reasons.push('Complaint detected');
    }

    if (analysis.sentiment === 'negative' || analysis.sentiment === 'angry') {
      reasons.push(`Negative sentiment (${analysis.sentiment})`);
    }

    if (analysis.urgency === 'high' || analysis.urgency === 'critical') {
      reasons.push(`High urgency (${analysis.urgency})`);
    }

    if (analysis.riskLevel === 'medium' || analysis.riskLevel === 'high') {
      reasons.push(`Reputational risk (${analysis.riskLevel})`);
    }

    if (analysis.intent !== 'informational') {
      reasons.push(`Non-informational intent (${analysis.intent})`);
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Does not meet auto-response criteria';
  }
}

