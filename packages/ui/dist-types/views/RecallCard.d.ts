import type { MatchStatus, RecallMatchView } from '@custodian/shared';
export type AckAction = Exclude<MatchStatus, 'new' | 'seen'>;
export declare function RecallCard({ m, onDetails, onAck, compact }: {
    m: RecallMatchView;
    onDetails: (m: RecallMatchView) => void;
    onAck: (m: RecallMatchView, action: AckAction) => Promise<void>;
    compact?: boolean;
}): import("preact").JSX.Element;
