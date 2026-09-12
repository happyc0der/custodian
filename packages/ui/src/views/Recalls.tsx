import type { CheckRecallsOutput, RecallMatchView } from '@custodian/shared';
import { Button, Empty, Header } from '../components/ui.js';
import { RecallCard, type AckAction } from './RecallCard.js';

export function RecallsView({ data, onDetails, onAck, onExpand, fullscreen }: { data: CheckRecallsOutput; onDetails: (m: RecallMatchView) => void; onAck: (m: RecallMatchView, a: AckAction) => Promise<void>; onExpand: () => void; fullscreen: boolean }) {
  const open = data.matches.filter((m) => m.status === 'new' || m.status === 'seen');
  const title = data.scope === 'item' && data.item ? `Recalls: ${data.item.name}` : 'Recalls';
  const sub = data.matches.length
    ? `${open.length} open · ${data.checked_items} item${data.checked_items === 1 ? '' : 's'} checked`
    : `${data.checked_items} item${data.checked_items === 1 ? '' : 's'} checked`;
  return (
    <div class="frame">
      <Header title={title} sub={sub} right={!fullscreen && data.matches.length > 1 ? <Button small ghost onClick={onExpand} ariaLabel="Expand">⤢ Expand</Button> : undefined} />
      {data.matches.length === 0 ? (
        <Empty icon="🛡️" title="No open recalls" text={data.last_sweep_at ? `Last checked ${new Date(data.last_sweep_at).toLocaleString()}` : 'Custodian keeps checking in the background.'} />
      ) : (
        <div class="grid cards">
          {data.matches.map((m) => (
            <RecallCard key={m.match_id} m={m} onDetails={onDetails} onAck={onAck} />
          ))}
        </div>
      )}
    </div>
  );
}
