import { useState } from 'preact/hooks';
import type { MaintenanceView, WhatsDueOutput } from '@custodian/shared';
import { Button, CATEGORY_ICON, Empty, Header, Section, dueText, formatDate } from '../components/ui.js';

function Row({ v, onDone }: { v: MaintenanceView; onDone: (v: MaintenanceView) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const due = dueText(v.days_until_due);
  return (
    <div class="row">
      <div class="icon" aria-hidden="true">{CATEGORY_ICON[v.item.category] ?? '🔧'}</div>
      <div class="main">
        <div class="title">{v.label}</div>
        <div class="meta">{v.item.name} · {formatDate(v.next_due)}</div>
      </div>
      {done ? (
        <span class="due later">Logged ✓</span>
      ) : (
        <>
          <span class={`due ${due.cls}`}>{due.text}</span>
          <Button small disabled={busy} ariaLabel={`Mark ${v.label} done`} onClick={async () => { setBusy(true); try { await onDone(v); setDone(true); } finally { setBusy(false); } }}>Done</Button>
        </>
      )}
    </div>
  );
}

export function MaintenanceView_({ data, onDone }: { data: WhatsDueOutput; onDone: (v: MaintenanceView) => Promise<void> }) {
  return (
    <div class="frame">
      <Header title="Maintenance" sub={`Next ${data.horizon_days} days`} />
      {data.due.length === 0 && data.upcoming.length === 0 ? (
        <Empty icon="✅" title="All caught up" text={`Nothing due in the next ${data.horizon_days} days.`} />
      ) : (
        <>
          {data.due.length > 0 && (
            <Section title="Needs attention">
              <div class="list">{data.due.map((v) => <Row key={v.rule_id} v={v} onDone={onDone} />)}</div>
            </Section>
          )}
          {data.upcoming.length > 0 && (
            <Section title="Coming up">
              <div class="list">{data.upcoming.map((v) => <Row key={v.rule_id} v={v} onDone={onDone} />)}</div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
