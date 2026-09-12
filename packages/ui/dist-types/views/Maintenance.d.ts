import type { MaintenanceView, WhatsDueOutput } from '@custodian/shared';
export declare function MaintenanceView_({ data, onDone }: {
    data: WhatsDueOutput;
    onDone: (v: MaintenanceView) => Promise<void>;
}): import("preact").JSX.Element;
