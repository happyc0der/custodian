import type { BriefingOutput, MaintenanceView, RecallMatchView } from '@custodian/shared';
import { type AckAction } from './RecallCard.js';
export declare function BriefingView({ data, onDetails, onAck, onDone, onExpand, fullscreen }: {
    data: BriefingOutput;
    onDetails: (m: RecallMatchView) => void;
    onAck: (m: RecallMatchView, a: AckAction) => Promise<void>;
    onDone: (v: MaintenanceView) => Promise<void>;
    onExpand: () => void;
    fullscreen: boolean;
}): import("preact").JSX.Element;
