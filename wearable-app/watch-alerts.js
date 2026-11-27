// EDU_ERP/wearable-app/watch-alerts.js
// Wearable OS Companion & Push Alert Dispatcher for SHIKSHA Unified (EDU_ERP)

import {
    getEduDeviceId,
    getActiveEduRecords,
    syncEduWithCloud,
    eduToMs
} from "../shared/sync-engine.js";

const SHIKSHA_UNIFIED_URL =
    "https://script.google.com/macros/s/AKfycbwkUDVo7oMZ0K_MR6RLoUu5d9tMiXU358cfPesCIEXQVHCsGyUZVbbgcDfLK9qsHeRm_w/exec";

const SEEN_ALERTS_KEY = "edu_erp_v1_watch_seen_alerts";
const WATCH_LOG_KEY = "edu_erp_v1_watch_alert_history";
const WATCH_DEVICE_ID = getEduDeviceId("WCH");

function readSeenSet() {
    try {
        const arr = JSON.parse(localStorage.getItem(SEEN_ALERTS_KEY) || "[]");
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
        return new Set();
    }
}

function writeSeenSet(setObj) {
    const trimmed = Array.from(setObj).slice(-500);
    localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(trimmed));
}

export function readWatchAlertHistory() {
    try {
        const arr = JSON.parse(localStorage.getItem(WATCH_LOG_KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function appendWatchHistory(alertItem) {
    const list = readWatchAlertHistory();
    list.unshift(alertItem);
    localStorage.setItem(WATCH_LOG_KEY, JSON.stringify(list.slice(0, 50)));
}

export async function requestWatchNotificationPermission() {
    if (!("Notification" in window)) {
        return { granted: false, reason: "Browser does not support Notifications" };
    }
    if (Notification.permission === "granted") {
        return { granted: true, permission: "granted" };
    }
    const perm = await Notification.requestPermission();
    return { granted: perm === "granted", permission: perm };
}

export function triggerSmartwatchPushAlert({
    id,
    category = "ALERT",
    title = "SHIKSHA Unified",
    body = "New update received",
    tag = "shiksha-unified-watch"
}) {
    const alertId = String(id || `WCH-${Date.now()}`);
    const seen = readSeenSet();
    if (seen.has(alertId)) {
        return { dispatched: false, duplicate: true };
    }
    seen.add(alertId);
    writeSeenSet(seen);

    const record = {
        id: alertId,
        category,
        title,
        body,
        device_id: WATCH_DEVICE_ID,
        triggered_at: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })
    };
    appendWatchHistory(record);

    // Haptic vibration pattern for phone -> smartwatch notification bridge
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
            navigator.vibrate([180, 80, 180]);
        } catch (_) {}
    }

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            const n = new Notification(`${category}: ${title}`, {
                body,
                tag,
                renotify: true
            });
            n.onclick = () => {
                window.focus();
                n.close();
            };
        } catch (_) {}
    }

    return { dispatched: true, duplicate: false, record };
}

// Convert synced SHIKSHA Unified records into wearable push alerts
export function dispatchAlertsFromSyncedData(sinceMs = 0) {
    const dispatched = [];

    const notices = getActiveEduRecords("notices");
    for (const n of notices) {
        if (eduToMs(n.updated_at) >= sinceMs) {
            const res = triggerSmartwatchPushAlert({
                id: `NOTICE-${n.id}-${n.updated_at || ""}`,
                category: "NOTICE",
                title: n.title || "Institute Notice",
                body: n.desc || "New notice posted on SHIKSHA Unified",
                tag: "shiksha-notice"
            });
            if (res.dispatched) dispatched.push(res.record);
        }
    }

    const homework = getActiveEduRecords("homework");
    for (const h of homework) {
        if (eduToMs(h.updated_at) >= sinceMs) {
            const res = triggerSmartwatchPushAlert({
                id: `HW-${h.id}-${h.updated_at || ""}`,
                category: "HOMEWORK",
                title: `${h.subject || "Subject"} (Class ${h.class || "-"})`,
                body: h.title || "New homework assigned",
                tag: "shiksha-homework"
            });
            if (res.dispatched) dispatched.push(res.record);
        }
    }

    const fees = getActiveEduRecords("fees");
    for (const f of fees) {
        if (eduToMs(f.updated_at) >= sinceMs) {
            const res = triggerSmartwatchPushAlert({
                id: `FEE-${f.id}-${f.updated_at || ""}`,
                category: "FEE RECEIPT",
                title: `${f.student_name || f.student_id} — Rs ${Number(f.amount_paid || 0)}`,
                body: `Mode: ${f.payment_mode || "Cash"} | Date: ${f.payment_date || ""}`,
                tag: "shiksha-fee"
            });
            if (res.dispatched) dispatched.push(res.record);
        }
    }

    const chats = getActiveEduRecords("chat_messages");
    for (const c of chats) {
        if (eduToMs(c.updated_at) >= sinceMs) {
            const res = triggerSmartwatchPushAlert({
                id: `CHAT-${c.id}-${c.updated_at || ""}`,
                category: "CHAT",
                title: c.senderName || "Direct Message",
                body: c.text || "New message received",
                tag: "shiksha-chat"
            });
            if (res.dispatched) dispatched.push(res.record);
        }
    }

    return dispatched;
}

export async function syncAndPushToWatch(endpointUrl = SHIKSHA_UNIFIED_URL) {
    const prevSyncMs = eduToMs(localStorage.getItem("edu_erp_v1_last_sync") || 0);
    const syncRes = await syncEduWithCloud(endpointUrl, { deviceId: WATCH_DEVICE_ID });
    const newAlerts = dispatchAlertsFromSyncedData(prevSyncMs || 0);
    return {
        syncRes,
        newAlerts,
        history: readWatchAlertHistory()
    };
}