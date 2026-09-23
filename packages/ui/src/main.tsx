import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type {
  AcknowledgeRecallOutput,
  BriefingOutput,
  CheckRecallsOutput,
  ListInventoryOutput,
  LogMaintenanceOutput,
  MaintenanceView,
  RecallDetailsOutput,
  RecallMatchView,
  WhatsDueOutput,
} from '@custodian/shared';
import {
  app,
  applyHost,
  callTool,
  expand,
  openLink,
  tellModel,
  widthClass,
  type ToolResult,
} from './host.js';
import { BriefingView } from './views/Briefing.js';
import { InventoryView } from './views/Inventory.js';
import { MaintenanceView_ } from './views/Maintenance.js';
import { RecallDetailView } from './views/RecallDetail.js';
import { RecallsView } from './views/Recalls.js';
import type { AckAction } from './views/RecallCard.js';
import './styles.css';

type View =
  | { kind: 'recalls'; data: CheckRecallsOutput }
  | { kind: 'detail'; data: RecallDetailsOutput; back?: View }
  | { kind: 'inventory'; data: ListInventoryOutput }
  | { kind: 'maintenance'; data: WhatsDueOutput }
  | { kind: 'briefing'; data: BriefingOutput }
  | { kind: 'error'; text: string }
  | { kind: 'loading' };

/** Picks the view from the calling tool's name, falling back to the payload's shape. */
function viewFor(toolName: string | undefined, result: ToolResult): View {
  if (result.isError)
    return {
      kind: 'error',
      text: result.content?.find((c) => c.type === 'text')?.text ?? 'Something went wrong.',
    };
  const d = (result.structuredContent ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'check_recalls':
      return { kind: 'recalls', data: d as unknown as CheckRecallsOutput };
    case 'get_recall_details':
      return { kind: 'detail', data: d as unknown as RecallDetailsOutput };
    case 'list_inventory':
      return { kind: 'inventory', data: d as unknown as ListInventoryOutput };
    case 'whats_due':
      return { kind: 'maintenance', data: d as unknown as WhatsDueOutput };
    case 'household_briefing':
      return { kind: 'briefing', data: d as unknown as BriefingOutput };
  }
  if ('new_recalls' in d) return { kind: 'briefing', data: d as unknown as BriefingOutput };
  if ('matches' in d) return { kind: 'recalls', data: d as unknown as CheckRecallsOutput };
  if ('recall' in d) return { kind: 'detail', data: d as unknown as RecallDetailsOutput };
  if ('items' in d) return { kind: 'inventory', data: d as unknown as ListInventoryOutput };
  if ('due' in d) return { kind: 'maintenance', data: d as unknown as WhatsDueOutput };
  return { kind: 'error', text: 'Nothing to show for this result.' };
}

function Root() {
  const [host, setHost] = useState<McpUiHostContext | undefined>(undefined);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [pendingResult, setPendingResult] = useState<ToolResult | undefined>(undefined);

  useEffect(() => {
    app.ontoolresult = (result) => setPendingResult(result);
    app.onhostcontextchanged = (params) => setHost((prev) => ({ ...(prev ?? {}), ...params }));
    void app.connect().then(() => {
      setHost(app.getHostContext());
      app.setupSizeChangedNotifications();
    });
  }, []);

  // Resolve the view once both the result and (ideally) the tool name are known.
  useEffect(() => {
    if (!pendingResult) return;
    setView(viewFor(host?.toolInfo?.tool?.name, pendingResult));
  }, [pendingResult, host?.toolInfo?.tool?.name]);

  useEffect(() => applyHost(host), [host]);

  const rootClass = useMemo(() => {
    const cls = ['root', widthClass(host), `mode-${host?.displayMode ?? 'inline'}`];
    if (host?.theme === 'dark') cls.push('dark');
    return cls.join(' ');
  }, [host]);
  const insets = host?.safeAreaInsets;
  const style = insets
    ? `--safe-top:${insets.top}px;--safe-right:${insets.right}px;--safe-bottom:${insets.bottom}px;--safe-left:${insets.left}px`
    : undefined;
  const fullscreen = host?.displayMode === 'fullscreen';

  const notify = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(undefined), 2600);
  };

  const patchMatch = (recallId: string, patch: Partial<RecallMatchView>) =>
    setView((v) => {
      if (v.kind === 'recalls')
        return {
          ...v,
          data: {
            ...v.data,
            matches: v.data.matches.map((m) => (m.recall.id === recallId ? { ...m, ...patch } : m)),
          },
        };
      if (v.kind === 'briefing')
        return {
          ...v,
          data: {
            ...v.data,
            new_recalls: v.data.new_recalls.map((m) =>
              m.recall.id === recallId ? { ...m, ...patch } : m,
            ),
            open_recalls: Math.max(0, v.data.open_recalls - 1),
          },
        };
      if (v.kind === 'detail' && v.data.match?.recall.id === recallId)
        return { ...v, data: { ...v.data, match: { ...v.data.match, ...patch } } };
      return v;
    });

  const onAck = async (recallId: string, title: string, itemName: string, action: AckAction) => {
    const r = await callTool<AcknowledgeRecallOutput>('acknowledge_recall', {
      recall_id: recallId,
      action,
    });
    if (r.isError) return notify(r.speech || 'Could not update that recall.');
    patchMatch(recallId, { status: action });
    tellModel(
      `On screen, the customer marked the recall "${title}" for their ${itemName} as ${action.replace('_', ' ')}.`,
    );
    notify(r.speech);
  };

  const onDetails = async (m: RecallMatchView) => {
    const back = view;
    setView({ kind: 'loading' });
    const r = await callTool<RecallDetailsOutput>('get_recall_details', { recall_id: m.recall.id });
    if (r.isError || !r.data.recall) {
      setView(back);
      return notify(r.speech || 'Could not load details.');
    }
    setView({ kind: 'detail', data: r.data, back });
    tellModel(`The customer opened the details of the recall "${m.recall.title}" on screen.`);
  };

  const onDone = async (v: MaintenanceView) => {
    const r = await callTool<LogMaintenanceOutput>('log_maintenance', {
      item_name: v.item.name,
      task: v.kind,
    });
    if (r.isError) return notify(r.speech || 'Could not log that.');
    tellModel(`On screen, the customer logged "${v.label}" as done for their ${v.item.name}.`);
    notify(r.speech);
  };

  let body;
  switch (view.kind) {
    case 'loading':
      body = <div class="loading">Loading…</div>;
      break;
    case 'error':
      body = (
        <div class="frame">
          <div class="empty">
            <div class="big" aria-hidden="true">
              😕
            </div>
            <h2>{view.text}</h2>
          </div>
        </div>
      );
      break;
    case 'recalls':
      body = (
        <RecallsView
          data={view.data}
          fullscreen={fullscreen}
          onExpand={expand}
          onDetails={onDetails}
          onAck={(m, a) => onAck(m.recall.id, m.recall.title, m.item.name, a)}
        />
      );
      break;
    case 'detail':
      body = (
        <RecallDetailView
          data={view.data}
          onOpen={openLink}
          onBack={view.back ? () => setView(view.back!) : undefined}
          onAck={(id, a) =>
            onAck(id, view.data.recall.title, view.data.match?.item.name ?? 'item', a)
          }
        />
      );
      break;
    case 'inventory':
      body = <InventoryView data={view.data} />;
      break;
    case 'maintenance':
      body = <MaintenanceView_ data={view.data} onDone={onDone} />;
      break;
    case 'briefing':
      body = (
        <BriefingView
          data={view.data}
          fullscreen={fullscreen}
          onExpand={expand}
          onDetails={onDetails}
          onDone={onDone}
          onAck={(m, a) => onAck(m.recall.id, m.recall.title, m.item.name, a)}
        />
      );
      break;
  }

  return (
    <div class={rootClass} style={style}>
      {body}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

render(<Root />, document.getElementById('root')!);
