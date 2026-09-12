import type { CheckRecallsOutput, RecallMatchView } from '@custodian/shared';
import { type AckAction } from './RecallCard.js';
export declare function RecallsView({ data, onDetails, onAck, onExpand, fullscreen }: {
    data: CheckRecallsOutput;
    onDetails: (m: RecallMatchView) => void;
    onAck: (m: RecallMatchView, a: AckAction) => Promise<void>;
    onExpand: () => void;
    fullscreen: boolean;
}): import("preact").JSX.Element;
