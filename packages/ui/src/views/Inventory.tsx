import type { ItemSummary, ListInventoryOutput } from '@custodian/shared';
import { Badge, CATEGORY_ICON, Empty, Header, Section, formatDate } from '../components/ui.js';

const LABEL: Record<string, string> = {
  car_seat: 'Car seats', stroller: 'Strollers', crib: 'Cribs & beds', toy: 'Toys', appliance: 'Appliances', electronics: 'Electronics', furniture: 'Furniture',
  vehicle: 'Vehicles', food: 'Food', medication: 'Medication', medical_device: 'Medical devices', tool: 'Tools', heater: 'Heaters', smoke_detector: 'Smoke & CO detectors',
  water_filter: 'Water filters', hvac_filter: 'Air filters', other: 'Other',
};

export function InventoryView({ data }: { data: ListInventoryOutput }) {
  const groups = new Map<string, ItemSummary[]>();
  for (const i of data.items) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  const recalls = data.open_recalls_by_item ?? {};
  return (
    <div class="frame">
      <Header title="Your inventory" sub={`${data.total} item${data.total === 1 ? '' : 's'}${data.open_recalls ? ` · ${data.open_recalls} open recall${data.open_recalls === 1 ? '' : 's'}` : ''}`} />
      {data.items.length === 0 ? (
        <Empty icon="📦" title="Nothing on file yet" text='Say "Alexa, I just bought a …" to start tracking.' />
      ) : (
        [...groups.entries()].map(([cat, items]) => (
          <Section key={cat} title={LABEL[cat] ?? cat}>
            <div class="list">
              {items.map((i) => (
                <div class="row" key={i.id}>
                  <div class="icon" aria-hidden="true">{CATEGORY_ICON[i.category] ?? '📦'}</div>
                  <div class="main">
                    <div class="title">{i.name}{i.quantity > 1 ? ` ×${i.quantity}` : ''}</div>
                    <div class="meta">{[i.brand, i.model, i.vehicle ? `${i.vehicle.year} ${i.vehicle.make} ${i.vehicle.model}` : undefined, i.purchased_on ? `bought ${formatDate(i.purchased_on)}` : undefined].filter(Boolean).join(' · ') || 'No details yet'}</div>
                  </div>
                  {recalls[i.id] ? <Badge kind="high">{recalls[i.id]} recall{recalls[i.id] === 1 ? '' : 's'}</Badge> : <Badge kind="ok">Clear</Badge>}
                </div>
              ))}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}
