import { useState } from 'preact/hooks';
import type { MatchStatus, RecallMatchView } from '@custodian/shared';
import { Badge, Button, SEVERITY_LABEL } from '../components/ui.js';

export type AckAction = Exclude<MatchStatus, 'new' | 'seen'>;

export function RecallCard({ m, onDetails, onAck, compact }: { m: RecallMatchView; onDetails: (m: RecallMatchView) => void; onAck: (m: RecallMatchView, action: AckAction) => Promise<void>; compact?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const closed = m.status !== 'new' && m.status !== 'seen';
  const ack = async (action: AckAction) => {
    setBusy(true);
    try {
      await onAck(m, action);
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };
  return (
    <article class="card" aria-label={m.recall.title}>
      {!compact && (
        <div class="media">
          {m.recall.image_url ? <img src={m.recall.image_url} alt="" loading="lazy" /> : <div class="ph" aria-hidden="true">⚠️</div>}
        </div>
      )}
      <div class="body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <Badge kind={m.recall.severity}>{SEVERITY_LABEL[m.recall.severity]}</Badge>
          {m.confidence < 0.8 && <Badge kind="possible">May affect yours</Badge>}
          {closed && <Badge kind="ok">{m.status === 'remedy_requested' ? 'Remedy requested' : m.status === 'disposed' ? 'Disposed' : 'Not affected'}</Badge>}
        </div>
        <h2>{m.recall.title}</h2>
        <div class="owned">Your {m.item.name}{m.item.quantity > 1 ? ` (×${m.item.quantity})` : ''}</div>
        <p class={compact ? 'clamp2' : 'clamp3'}>{m.recall.hazard}</p>
        {!compact && m.recall.remedy_options.length > 0 && (
          <div class="remedy"><span aria-hidden="true">✅</span><span>{m.recall.remedy_options.join(' · ')}</span></div>
        )}
      </div>
      <div class="actions">
        <Button primary onClick={() => onDetails(m)}>Details</Button>
        {!closed && !menu && <Button ghost onClick={() => setMenu(true)}>I've handled it</Button>}
        {!closed && menu && (
          <>
            <Button small disabled={busy} onClick={() => ack('remedy_requested')}>Requested remedy</Button>
            <Button small disabled={busy} onClick={() => ack('disposed')}>Threw it out</Button>
            <Button small disabled={busy} onClick={() => ack('not_affected')}>Not my model</Button>
            <Button small ghost onClick={() => setMenu(false)}>Cancel</Button>
          </>
        )}
      </div>
    </article>
  );
}
