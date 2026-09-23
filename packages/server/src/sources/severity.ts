import type { RecallSeverity } from '@custodian/shared';

const CRITICAL = /\b(death|deaths|fatal|fatalit|lead poisoning|carbon monoxide|asphyxi)/i;
const HIGH =
  /\b(serious injur|fire|burn|explos|chok|strangul|suffocat|entrap|fall hazard|crash|electrocut|shock hazard|laceration hazard|amputat|drown)/i;
const MODERATE = /\b(injur|lacerat|cut|bruis|impact|tip.?over|pinch)/i;

/** Severity from free-text hazard language (CPSC titles read like "…Due to Risk of Serious Injury or Death from Fire"). */
export function severityFromText(...texts: Array<string | undefined>): RecallSeverity {
  const joined = texts.filter(Boolean).join(' ');
  if (CRITICAL.test(joined)) return 'critical';
  if (HIGH.test(joined)) return 'high';
  if (MODERATE.test(joined)) return 'moderate';
  return 'low';
}
