import type { ComponentChildren } from 'preact';
import type { RecallSeverity } from '@custodian/shared';
export declare function Badge({ kind, children }: {
    kind: RecallSeverity | 'ok' | 'muted' | 'possible';
    children: ComponentChildren;
}): import("preact").JSX.Element;
export declare function Button({ children, onClick, primary, ghost, small, disabled, ariaLabel }: {
    children: ComponentChildren;
    onClick?: () => void;
    primary?: boolean;
    ghost?: boolean;
    small?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
}): import("preact").JSX.Element;
export declare function Empty({ icon, title, text }: {
    icon: string;
    title: string;
    text?: string;
}): import("preact").JSX.Element;
export declare function Section({ title, children }: {
    title: string;
    children: ComponentChildren;
}): import("preact").JSX.Element;
export declare function Header({ title, sub, right }: {
    title: string;
    sub?: string;
    right?: ComponentChildren;
}): import("preact").JSX.Element;
export declare function Stat({ n, label, tone }: {
    n: number | string;
    label: string;
    tone?: 'alert' | 'good';
}): import("preact").JSX.Element;
export declare const SEVERITY_LABEL: Record<RecallSeverity, string>;
export declare const CATEGORY_ICON: Record<string, string>;
export declare function dueText(days: number): {
    text: string;
    cls: 'over' | 'soon' | 'later';
};
export declare function formatDate(iso: string): string;
