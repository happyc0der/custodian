import type { ComponentChildren } from 'preact';
import type { RecallSeverity } from '@custodian/shared';

export function Badge({ kind, children }: { kind: RecallSeverity | 'ok' | 'muted' | 'possible'; children: ComponentChildren }) {
  const cls = kind === 'ok' || kind === 'muted' || kind === 'possible' ? kind : `sev-${kind}`;
  return <span class={`badge ${cls}`}>{children}</span>;
}

export function Button({ children, onClick, primary, ghost, small, disabled, ariaLabel }: { children: ComponentChildren; onClick?: () => void; primary?: boolean; ghost?: boolean; small?: boolean; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button type="button" class={`btn${primary ? ' primary' : ''}${ghost ? ' ghost' : ''}${small ? ' small' : ''}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div class="empty" role="status">
      <div class="big" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Header({ title, sub, right }: { title: string; sub?: string; right?: ComponentChildren }) {
  return (
    <header class="header">
      <div class="brand">
        <div class="logo" aria-hidden="true">C</div>
        <div>
          <h1>{title}</h1>
          {sub && <div class="sub">{sub}</div>}
        </div>
      </div>
      {right}
    </header>
  );
}

export function Stat({ n, label, tone }: { n: number | string; label: string; tone?: 'alert' | 'good' }) {
  return (
    <div class={`stat${tone ? ` ${tone}` : ''}`}>
      <div class="n">{n}</div>
      <div class="l">{label}</div>
    </div>
  );
}

export const SEVERITY_LABEL: Record<RecallSeverity, string> = { critical: 'Critical', high: 'High risk', moderate: 'Moderate', low: 'Low risk' };

export const CATEGORY_ICON: Record<string, string> = {
  car_seat: '🪑', stroller: '🍼', crib: '🛏️', toy: '🧸', appliance: '🔌', electronics: '💻', furniture: '🪑', vehicle: '🚗', food: '🥗',
  medication: '💊', medical_device: '🩺', tool: '🔧', heater: '🔥', smoke_detector: '🚨', water_filter: '💧', hvac_filter: '🌬️', other: '📦',
};

export function dueText(days: number): { text: string; cls: 'over' | 'soon' | 'later' } {
  if (days < 0) return { text: `${-days === 1 ? '1 day' : `${-days} days`} overdue`, cls: 'over' };
  if (days === 0) return { text: 'Due today', cls: 'soon' };
  if (days <= 14) return { text: `Due in ${days === 1 ? '1 day' : `${days} days`}`, cls: 'soon' };
  return { text: `Due in ${days} days`, cls: 'later' };
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
