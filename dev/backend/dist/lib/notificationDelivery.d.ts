export declare function selectAlertsForPreference<T extends {
    severity: string;
}>(alerts: T[], criticalOnly: boolean): T[];
export declare function sendRunAlertNotification(runId: string): Promise<void>;
//# sourceMappingURL=notificationDelivery.d.ts.map