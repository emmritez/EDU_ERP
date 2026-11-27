// EDU_ERP/shared/merged-features.js
// Merged SHIKSHA Features for EDU_ERP (Mobile PWA + PC UI + Wearable Bridge)

const MF_NS = "edu_erp_v1";
const MF_OUTBOX_KEY = MF_NS + "_outbox";
const MF_ROLE_KEY = MF_NS + "_active_role";
const MF_USER_KEY = MF_NS + "_active_user";

function mfDeviceId() {
    let id = localStorage.getItem(MF_NS + "_device_id");
    if (!id) {
        id = "DEV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
        localStorage.setItem(MF_NS + "_device_id", id);
    }
    return id;
}

export function mfReadCol(col) {
    try {
        const arr = JSON.parse(localStorage.getItem(`${MF_NS}_col_${col}`) || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

export function mfWriteCol(col, rows) {
    localStorage.setItem(`${MF_NS}_col_${col}`, JSON.stringify(rows || []));
}

export function mfActiveRows(col) {
    return mfReadCol(col).filter((r) => Number(r.is_deleted || 0) === 0);
}

export function mfUpsert(col, item, idField = "id") {
    const list = mfReadCol(col);
    const idVal = String(item[idField] ?? "").trim();
    if (!idVal) throw new Error(`Missing ${idField} in ${col}`);

    const existing = list.find((r) => String(r[idField]).trim() === idVal);
    const rec = {
        ...(existing || {}),
        ...item,
        [idField]: idVal,
        id: String(item.id || idVal),
        updated_at: new Date().toISOString(),
        updated_by: mfDeviceId(),
        is_deleted: item.is_deleted ? 1 : 0,
        sync_status: 0
    };

    const idx = list.findIndex((r) => String(r[idField]).trim() === idVal);
    if (idx > -1) list[idx] = rec;
    else list.unshift(rec);
    mfWriteCol(col, list);

    let outbox = [];
    try {
        outbox = JSON.parse(localStorage.getItem(MF_OUTBOX_KEY) || "[]");
    } catch (_) {
        outbox = [];
    }
    outbox.push({
        op_id: "OP-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
        collection: col,
        id_field: idField,
        record: rec
    });
    localStorage.setItem(MF_OUTBOX_KEY, JSON.stringify(outbox));
    return rec;
}

// --- 1. Roles ---
export function setActiveEduRole(role, userMeta = {}) {
    const validRoles = ["admin", "teacher", "parent"];
    const cleanRole = validRoles.includes(role) ? role : "admin";
    localStorage.setItem(MF_ROLE_KEY, cleanRole);
    localStorage.setItem(MF_USER_KEY, JSON.stringify(userMeta || {}));
    return { role: cleanRole, user: userMeta || {} };
}

export function getActiveEduRole() {
    const role = localStorage.getItem(MF_ROLE_KEY) || "admin";
    let user = {};
    try {
        user = JSON.parse(localStorage.getItem(MF_USER_KEY) || "{}");
    } catch (_) {
        user = {};
    }
    return { role, user };
}

// --- 2. Behavior ---
export function addBehaviorRemark({ studentId, studentName, flag = "green", reason = "", teacherName = "Faculty" }) {
    const cleanFlag = flag === "red" ? "red" : "green";
    const today = new Date().toISOString().slice(0, 10);
    return mfUpsert("behavior_logs", {
        id: `BEH-${studentId}-${today}-${cleanFlag}`,
        studentId: String(studentId),
        studentName: studentName || String(studentId),
        flag: cleanFlag,
        reason: reason.trim() || (cleanFlag === "green" ? "Good participation" : "Needs attention"),
        teacherName,
        dateKey: today,
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    });
}

// --- 3. AI / PDF MCQ Parser & Test ---
export function parseMcqsFromText(rawText, maxCount = 50) {
    const normalized = String(rawText || "")
        .replace(/\r/g, "\n")
        .replace(/\s+(?=(?:Q\.?\s*\d+|\d+[\.\)])\s+)/g, "\n");

    const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
    const items = [];
    let cur = null;

    const qStart = /^(?:Q\.?\s*\d+|\d+)[\.\)\:\-]\s*(.+)/i;
    const optPattern = /\(?([a-dA-D])[\)\.]\s*([^\(\n]+?)(?=\s*\(?[b-dB-D][\)\.]|\s*(?:Ans|Answer)[\:\.\-]|$)/gi;
    const ansPattern = /(?:Ans|Answer|Correct)[\s\:\.\-]*\(?([a-dA-D])\)?/i;

    for (const line of lines) {
        const ansMatch = line.match(ansPattern);
        if (ansMatch && cur) cur.ans = ansMatch[1].toUpperCase();

        const qMatch = line.match(qStart);
        if (qMatch && !/^\(?[a-dA-D][\)\.]/.test(line)) {
            if (cur && cur.q) {
                items.push(cur);
                if (items.length >= maxCount) break;
            }
            cur = { q: qMatch[1].trim(), A: "", B: "", C: "", D: "", ans: "A" };
            let m;
            optPattern.lastIndex = 0;
            while ((m = optPattern.exec(qMatch[1])) !== null) {
                cur[m[1].toUpperCase()] = m[2].trim();
            }
            if (cur.A) cur.q = qMatch[1].split(/\(?[aA][\)\.]\s*/)[0].trim();
            continue;
        }

        if (cur) {
            let foundOpt = false;
            let m;
            optPattern.lastIndex = 0;
            while ((m = optPattern.exec(line)) !== null) {
                foundOpt = true;
                cur[m[1].toUpperCase()] = m[2].trim();
            }
            if (!foundOpt && !ansMatch && !cur.A) {
                cur.q += " " + line;
            }
        }
    }
    if (cur && cur.q && items.length < maxCount) items.push(cur);

    return items.slice(0, maxCount).map((it) => ({
        q: it.q,
        A: it.A || "Option A",
        B: it.B || "Option B",
        C: it.C || "Option C",
        D: it.D || "Option D",
        ans: ["A", "B", "C", "D"].includes(it.ans) ? it.ans : "A"
    }));
}

export async function generateAiMcqs({ apiKey = "", topic = "", cls = "8th", subject = "Science", rawText = "", count = 10 }) {
    const limit = Math.min(50, Math.max(1, Number(count) || 10));
    if (rawText && rawText.trim()) {
        const parsed = parseMcqsFromText(rawText, limit);
        if (parsed.length > 0) return parsed;
    }

    if (apiKey && apiKey.trim()) {
        const prompt = rawText && rawText.trim()
            ? `Extract up to ${limit} MCQs from this text for Class ${cls} ${subject}. Return ONLY JSON array with keys q, A, B, C, D, ans.`
            : `Create ${limit} MCQs for Class ${cls} ${subject} on topic "${topic || subject}". Return ONLY JSON array with keys q, A, B, C, D, ans.`;

        const parts = [{ text: prompt }];
        if (rawText && rawText.trim()) parts.push({ text: rawText.slice(0, 12000) });

        const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts }] })
            }
        );
        const data = await resp.json();
        const txt = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "")
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();
        const arr = JSON.parse(txt);
        if (Array.isArray(arr) && arr.length > 0) {
            return arr.slice(0, limit).map((x) => ({
                q: x.q || "Question",
                A: x.A || "Option A",
                B: x.B || "Option B",
                C: x.C || "Option C",
                D: x.D || "Option D",
                ans: ["A", "B", "C", "D"].includes(String(x.ans || "").toUpperCase()) ? String(x.ans).toUpperCase() : "A"
            }));
        }
    }

    // Offline fallback MCQs when no API key is given
    const baseTopic = topic || `${subject} Chapter`;
    return Array.from({ length: Math.min(limit, 5) }, (_, idx) => ({
        q: `${baseTopic} — Key Concept Question ${idx + 1} (Class ${cls})?`,
        A: `Core principle of ${baseTopic} (Set ${idx + 1})`,
        B: `Unrelated statement ${idx + 1}`,
        C: `Partial definition ${idx + 1}`,
        D: `None of the above`,
        ans: "A"
    }));
}

export function publishOnlineTest({ title, cls, subject, duration = 30, questions = [], assignedStudents = [], createdBy = "Admin" }) {
    return mfUpsert("online_tests", {
        id: "TEST-" + Date.now(),
        title: title.trim(),
        class: cls,
        subject,
        duration: Number(duration) || 30,
        questions,
        assignedStudents,
        createdBy,
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    });
}

export function submitOnlineTestScore({ testId, testTitle, studentId, studentName, studentClass, answersMap = {}, questions = [] }) {
    let score = 0;
    questions.forEach((q, i) => {
        if (answersMap[i] && answersMap[i] === q.ans) score++;
    });
    return mfUpsert("test_submissions", {
        id: `SUB-${testId}-${studentId}`,
        testId,
        testTitle,
        studentId: String(studentId),
        studentName: studentName || String(studentId),
        studentClass: studentClass || "",
        score,
        totalMarks: questions.length,
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    });
}

// --- 4. Direct Chat ---
export function sendDirectChat({ studentId, studentName, teacherPhone, senderRole, senderName, text }) {
    const cleanStudent = String(studentId).trim();
    const cleanTeacher = String(teacherPhone || "FACULTY").trim();
    const threadKey = `${cleanStudent}_${cleanTeacher}`;
    return mfUpsert("chat_messages", {
        id: "CHAT-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase(),
        threadKey,
        studentId: cleanStudent,
        studentName: studentName || cleanStudent,
        teacherPhone: cleanTeacher,
        senderRole,
        senderName,
        text: String(text || "").trim(),
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    });
}

// --- 5. Timetable, Leaves, Notes, Gallery ---
export function addTimetableSlot({ cls, day, startTime, endTime, subject, teacher = "" }) {
    return mfUpsert("timetable", {
        id: "TT-" + Date.now(),
        class: cls,
        day,
        startTime,
        endTime,
        subject: subject.trim(),
        teacher: teacher.trim()
    });
}

export function createLeaveApplication({ studentId, studentName, cls, fromDate, toDate, reason }) {
    return mfUpsert("leaves", {
        id: "LV-" + Date.now(),
        studentId: String(studentId),
        studentName,
        class: cls,
        fromDate,
        toDate,
        reason: reason.trim(),
        status: "Pending",
        submittedAt: new Date().toISOString()
    });
}

export function reviewLeaveApplication(leaveId, status, reviewedBy = "Admin") {
    const existing = mfReadCol("leaves").find((l) => String(l.id) === String(leaveId));
    if (!existing) return null;
    return mfUpsert("leaves", {
        ...existing,
        status,
        reviewedBy,
        reviewedAt: new Date().toISOString()
    });
}

export function addStudyNote({ title, cls, subject, link, author = "Faculty" }) {
    return mfUpsert("materials", {
        id: "NOTE-" + Date.now(),
        title: title.trim(),
        class: cls,
        subject,
        link: link.trim(),
        author,
        date: new Date().toLocaleDateString("en-IN")
    });
}

export function addGalleryMedia({ folder, title, type = "photo", url = "", privacy = "coaching" }) {
    return mfUpsert("gallery", {
        id: "GAL-" + Date.now(),
        folder: (folder || "General Campus").trim(),
        title: title.trim(),
        type,
        url,
        privacy,
        likes: 0,
        comments: [],
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    });
}