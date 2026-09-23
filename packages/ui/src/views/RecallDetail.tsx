import { useState } from 'preact/hooks';
import type { RecallDetailsOutput } from '@custodian/shared';
import { Badge, Button, Header, SEVERITY_LABEL, formatDate } from '../components/ui.js';
import type { AckAction } from './RecallCard.js';

export function RecallDetailView({
  data,
  onAck,
  onOpen,
  onBack,
}: {
  data: RecallDetailsOutput;
  onAck: (recallId: string, a: AckAction) => Promise<void>;
  onOpen: (url: string) => void;
  onBack?: () => void;
}) {
  const r = data.recall;
  const m = data.match;
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const closed = m && m.status !== 'new' && m.status !== 'seen';
  const ack = async (a: AckAction) => {
    setBusy(true);
    try {
      await onAck(r.id, a);
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };
  const source = { cpsc: 'CPSC', nhtsa: 'NHTSA', fda: 'FDA' }[r.source];
  return (
    <div class="frame detail">
      <Header
        title="Recall details"
        sub={`${source} · ${formatDate(r.published_on)}`}
        right={
          onBack ? (
            <Button small ghost onClick={onBack}>
              ← Back
            </Button>
          ) : undefined
        }
      />
      <div class="hero">
        <div class="media">
          {r.image_url ? (
            <img src={r.image_url} alt="" />
          ) : (
            <div class="ph" aria-hidden="true" style="font-size:3em;opacity:.5">
              ⚠️
            </div>
          )}
        </div>
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <Badge kind={r.severity}>{SEVERITY_LABEL[r.severity]}</Badge>
            {m && m.confidence < 0.8 && <Badge kind="possible">May affect yours</Badge>}
            {closed && <Badge kind="ok">Handled</Badge>}
          </div>
          <h2>{r.title}</h2>
          {m && (
            <div class="owned">
              Matched to your {m.item.name}
              {m.item.model ? ` · ${m.item.model}` : ''}
            </div>
          )}
          <dl class="kv">
            {r.products.length > 0 && (
              <>
                <dt>Affected</dt>
                <dd>
                  {r.products
                    .slice(0, 6)
                    .map((p) => [p.brand, p.name, p.model].filter(Boolean).join(' '))
                    .join('; ')}
                  {r.products.length > 6 ? ' …' : ''}
                </dd>
              </>
            )}
            {r.contact && (
              <>
                <dt>Contact</dt>
                <dd>{r.contact}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <div class="block danger">
        <h3>What's wrong</h3>
        <p>{r.hazard}</p>
      </div>
      <div class="block">
        <h3>What to do</h3>
        <p>{r.remedy}</p>
      </div>
      {r.summary && r.summary !== r.hazard && (
        <div class="block">
          <h3>Details</h3>
          <p>{r.summary}</p>
        </div>
      )}
      <div class="actions" style="padding:14px 0 0">
        {r.url && (
          <Button primary onClick={() => onOpen(r.url!)}>
            Open recall notice
          </Button>
        )}
        {m && !closed && !menu && <Button onClick={() => setMenu(true)}>Mark as handled</Button>}
        {m && !closed && menu && (
          <>
            <Button small disabled={busy} onClick={() => ack('remedy_requested')}>
              Requested remedy
            </Button>
            <Button small disabled={busy} onClick={() => ack('disposed')}>
              Threw it out
            </Button>
            <Button small disabled={busy} onClick={() => ack('not_affected')}>
              Not my model
            </Button>
            <Button small ghost onClick={() => setMenu(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
