import type { BriefingOutput, MaintenanceView, RecallMatchView } from '@custodian/shared';
import { Button, CATEGORY_ICON, Empty, Header, Section, Stat, dueText } from '../components/ui.js';
import { RecallCard, type AckAction } from './RecallCard.js';

export function BriefingView({
  data,
  onDetails,
  onAck,
  onDone,
  onExpand,
  fullscreen,
}: {
  data: BriefingOutput;
  onDetails: (m: RecallMatchView) => void;
  onAck: (m: RecallMatchView, a: AckAction) => Promise<void>;
  onDone: (v: MaintenanceView) => Promise<void>;
  onExpand: () => void;
  fullscreen: boolean;
}) {
  const quiet = data.new_recalls.length === 0 && data.due_maintenance.length === 0;
  return (
    <div class="frame">
      <Header
        title="Household briefing"
        sub={
          data.last_sweep_at
            ? `Recalls checked ${new Date(data.last_sweep_at).toLocaleString()}`
            : 'Custodian is watching your home'
        }
        right={
          !fullscreen && !quiet ? (
            <Button small ghost onClick={onExpand} ariaLabel="Expand">
              ⤢ Expand
            </Button>
          ) : undefined
        }
      />
      <div class="stats">
        <Stat n={data.item_count} label="items tracked" />
        <Stat
          n={data.open_recalls}
          label="open recalls"
          tone={data.open_recalls ? 'alert' : 'good'}
        />
        <Stat
          n={data.due_maintenance.length}
          label="due soon"
          tone={data.due_maintenance.some((d) => d.overdue) ? 'alert' : undefined}
        />
      </div>
      {quiet && (
        <Empty
          icon="🛡️"
          title="All clear"
          text={
            data.item_count
              ? 'No new recalls and nothing due.'
              : 'Tell Custodian what you own to start watching.'
          }
        />
      )}
      {data.new_recalls.length > 0 && (
        <Section title="New recalls">
          <div class="grid cards">
            {data.new_recalls.map((m) => (
              <RecallCard
                key={m.match_id}
                m={m}
                onDetails={onDetails}
                onAck={onAck}
                compact={!fullscreen}
              />
            ))}
          </div>
        </Section>
      )}
      {data.due_maintenance.length > 0 && (
        <Section title="Due soon">
          <div class="list">
            {data.due_maintenance.map((v) => {
              const d = dueText(v.days_until_due);
              return (
                <div class="row" key={v.rule_id}>
                  <div class="icon" aria-hidden="true">
                    {CATEGORY_ICON[v.item.category] ?? '🔧'}
                  </div>
                  <div class="main">
                    <div class="title">{v.label}</div>
                    <div class="meta">{v.item.name}</div>
                  </div>
                  <span class={`due ${d.cls}`}>{d.text}</span>
                  <Button small onClick={() => onDone(v)} ariaLabel={`Mark ${v.label} done`}>
                    Done
                  </Button>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
