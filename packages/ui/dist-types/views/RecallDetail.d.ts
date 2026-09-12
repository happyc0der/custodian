import type { RecallDetailsOutput } from '@custodian/shared';
import type { AckAction } from './RecallCard.js';
export declare function RecallDetailView({ data, onAck, onOpen, onBack }: {
    data: RecallDetailsOutput;
    onAck: (recallId: string, a: AckAction) => Promise<void>;
    onOpen: (url: string) => void;
    onBack?: () => void;
}): import("preact").JSX.Element;
