// EDU_ERP/shared/sync-engine.js
// Conflict-free Local-First + Outbox Sync Engine (Zero overlap with old keys)

const EDU_SYNC_CONFIG = {
    namespace: 'edu_erp_v1',
    deviceIdKey: 'edu_erp_v1_device_id',
    outboxKey: 'edu_erp_v1_outbox',
    lastSyncKey: 'edu_erp_v1_last_sync',
    collections: [
        'students',
        'teachers',
        'fees',
        'attendance',
        'exams',
        'exam_marks',
        'homework',
        'timetable',
        'leaves',
        'notices',
        'materials',
        'gallery',
        'online_tests',
        'test_submissions',
        'chat_messages',
        'behavior_logs',
        'holidays'
    ]
};

export function getEduDeviceId(prefix = 'WEB') {
    let id = localStorage.getItem(EDU_SYNC_CONFIG.deviceIdKey);
    if (!id) {
        const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
        id = `${prefix}-${rand}`;
        localStorage.setItem(EDU_SYNC_CONFIG.deviceIdKey, id);
    }
    return id;
}

export function eduNowIso() {
    return new Date().toISOString();
}

export function eduToMs(ts) {
    const ms = Date.parse(ts || 0);
    return Number.isNaN(ms) ? 0 : ms;
}

function colStorageKey(collectionName) {
    return `${EDU_SYNC_CONFIG.namespace}_col_${collectionName}`;
}

export function readEduCollection(collectionName) {
    try {
        const raw = localStorage.getItem(colStorageKey(collectionName));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

export function writeEduCollection(collectionName, rows) {
    localStorage.setItem(colStorageKey(collectionName), JSON.stringify(rows || []));
}

export function getActiveEduRecords(collectionName) {
    return readEduCollection(collectionName).filter(
        (item) => Number(item.is_deleted || 0) === 0
    );
}

export function readEduOutbox() {
    try {
        const raw = localStorage.getItem(EDU_SYNC_CONFIG.outboxKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

export function writeEduOutbox(queue) {
    localStorage.setItem(EDU_SYNC_CONFIG.outboxKey, JSON.stringify(queue || []));
}

export function upsertEduRecord(collectionName, rawItem, options = {}) {
    const idField = options.idField || 'id';
    const deviceId = options.deviceId || getEduDeviceId('WEB');
    const idValue = String(rawItem[idField] ?? '').trim();
    if (!idValue) {
        throw new Error(`Missing ${idField} for collection ${collectionName}`);
    }

    const list = readEduCollection(collectionName);
    const existing = list.find((r) => String(r[idField]).trim() === idValue);

    const record = {
        ...(existing || {}),
        ...rawItem,
        [idField]: idValue,
        updated_at: eduNowIso(),
        updated_by: deviceId,
        is_deleted: rawItem.is_deleted ? 1 : 0,
        sync_status: 0
    };

    const idx = list.findIndex((r) => String(r[idField]).trim() === idValue);
    if (idx > -1) list[idx] = record;
    else list.unshift(record);

    writeEduCollection(collectionName, list);

    const queue = readEduOutbox();
    queue.push({
        op_id: 'OP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
        collection: collectionName,
        id_field: idField,
        record
    });
    writeEduOutbox(queue);

    return record;
}

export function softDeleteEduRecord(collectionName, idValue, options = {}) {
    const idField = options.idField || 'id';
    const list = readEduCollection(collectionName);
    const target = list.find((r) => String(r[idField]).trim() === String(idValue).trim());
    if (!target) return null;

    return upsertEduRecord(
        collectionName,
        { ...target, is_deleted: 1 },
        options
    );
}

export function mergeEduCollectionConflictFree(localRows, remoteRows, idField = 'id') {
    const mergedMap = new Map();

    for (const row of (localRows || [])) {
        const key = String(row[idField] ?? '').trim();
        if (key) mergedMap.set(key, { ...row });
    }

    for (const incoming of (remoteRows || [])) {
        const key = String(incoming[idField] ?? '').trim();
        if (!key) continue;

        const current = mergedMap.get(key);
        if (!current) {
            mergedMap.set(key, { ...incoming, sync_status: 1 });
            continue;
        }

        const incMs = eduToMs(incoming.updated_at);
        const curMs = eduToMs(current.updated_at);

        if (incMs > curMs) {
            mergedMap.set(key, { ...current, ...incoming, sync_status: 1 });
        } else if (incMs === curMs) {
            const incDev = String(incoming.updated_by || '');
            const curDev = String(current.updated_by || '');
            if (incDev > curDev) {
                mergedMap.set(key, { ...current, ...incoming, sync_status: 1 });
            }
        }
    }

    return Array.from(mergedMap.values());
}

export async function syncEduWithCloud(endpointUrl, options = {}) {
    const deviceId = options.deviceId || getEduDeviceId('WEB');
    if (!endpointUrl) {
        return {
            ok: false,
            offline: true,
            pending: readEduOutbox().length,
            message: 'No cloud sync URL configured'
        };
    }

    const queue = readEduOutbox();
    if (queue.length > 0) {
        try {
            const pushResp = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'eduSyncBatch',
                    namespace: EDU_SYNC_CONFIG.namespace,
                    device_id: deviceId,
                    pushed_at: eduNowIso(),
                    operations: queue
                })
            });
            const pushJson = await pushResp.json();
            if (pushJson && pushJson.status === 'success') {
                const ackSet = new Set(pushJson.acked_op_ids || queue.map((q) => q.op_id));
                const remaining = queue.filter((q) => !ackSet.has(q.op_id));
                writeEduOutbox(remaining);

                for (const op of queue) {
                    if (ackSet.has(op.op_id)) {
                        const list = readEduCollection(op.collection);
                        const idField = op.id_field || 'id';
                        const idx = list.findIndex(
                            (r) => String(r[idField]).trim() === String(op.record[idField]).trim()
                        );
                        if (idx > -1) {
                            list[idx].sync_status = 1;
                            writeEduCollection(op.collection, list);
                        }
                    }
                }
            }
        } catch (err) {
            return {
                ok: false,
                offline: true,
                pending: readEduOutbox().length,
                message: err.message || 'Offline push error'
            };
        }
    }

    try {
        const sep = endpointUrl.includes('?') ? '&' : '?';
        const pullUrl = `${endpointUrl}${sep}action=eduGetAll&namespace=${encodeURIComponent(EDU_SYNC_CONFIG.namespace)}&_t=${Date.now()}`;
        const pullResp = await fetch(pullUrl);
        const pullJson = await pullResp.json();

        if (pullJson && pullJson.status === 'success') {
            for (const col of EDU_SYNC_CONFIG.collections) {
                if (Array.isArray(pullJson[col])) {
                    const merged = mergeEduCollectionConflictFree(
                        readEduCollection(col),
                        pullJson[col],
                        'id'
                    );
                    writeEduCollection(col, merged);
                }
            }
            const syncedAt = eduNowIso();
            localStorage.setItem(EDU_SYNC_CONFIG.lastSyncKey, syncedAt);
            return {
                ok: true,
                offline: false,
                pending: readEduOutbox().length,
                synced_at: syncedAt,
                message: 'Synced successfully'
            };
        }

        return {
            ok: false,
            offline: false,
            pending: readEduOutbox().length,
            message: 'Unexpected cloud response'
        };
    } catch (err) {
        return {
            ok: false,
            offline: true,
            pending: readEduOutbox().length,
            message: err.message || 'Offline pull error'
        };
    }
}
