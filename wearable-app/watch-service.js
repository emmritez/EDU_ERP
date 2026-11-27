// EDU_ERP/wearable-app/watch-service.js
// Background Alert Runner & Wrist Notification Formatter for SHIKSHA Unified

import {
    syncAndPushToWatch,
    requestWatchNotificationPermission,
    triggerSmartwatchPushAlert,
    readWatchAlertHistory
} from "./watch-alerts.js";

const SHIKSHA_UNIFIED_URL =
    "https://script.google.com/macros/s/AKfycbwkUDVo7oMZ0K_MR6RLoUu5d9tMiXU358cfPesCIEXQVHCsGyUZVbbgcDfLK9qsHeRm_w/exec";

let watchTimerId = null;

export function formatWristNotification(rawAlert) {
    const category = String(rawAlert.category || "ALERT").toUpperCase();
    const title = String(rawAlert.title || "SHIKSHA Unified").slice(0, 42);
    const body = String(rawAlert.body || "").slice(0, 110);
    return {
        id: rawAlert.id || `WCH-${Date.now()}`,
        category,
        title,
        body,
        tag: `shiksha-${category.toLowerCase().replace(/\s+/g, "-")}`
    };
}

export function startWatchAlertLoop({
    intervalMs = 30000,
    endpointUrl = SHIKSHA_UNIFIED_URL,
    onUpdate = null
} = {}) {
    stopWatchAlertLoop();

    const tick = async () => {
        try {
            const result = await syncAndPushToWatch(endpointUrl);
            if (typeof onUpdate === "function") {
                onUpdate(result);
            }
        } catch (err) {
            if (typeof onUpdate === "function") {
                onUpdate({ error: err.message || String(err), history: readWatchAlertHistory() });
            }
        }
    };

    tick();
    watchTimerId = setInterval(tick, Math.max(10000, Number(intervalMs) || 30000));
    return () => stopWatchAlertLoop();
}

export function stopWatchAlertLoop() {
    if (watchTimerId !== null) {
        clearInterval(watchTimerId);
        watchTimerId = null;
    }
}

export async function enableWristAlertsAndTest() {
    const perm = await requestWatchNotificationPermission();
    const wristAlert = formatWristNotification({
        id: "WRIST-READY-" + Date.now(),
        category: "WEARABLE READY",
        title: "SHIKSHA Unified Watch",
        body: "Live sync & smartwatch push notifications active."
    });
    triggerSmartwatchPushAlert(wristAlert);
    return { permission: perm, alert: wristAlert, history: readWatchAlertHistory() };
}