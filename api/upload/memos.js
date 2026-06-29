import { styles } from '../../config.js';
import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus, getColor, addLog } from '../../utils.js';

export default function(fastify) {
    fastify.get('/fetchMemos', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.status(401).send({ success: false, error: "Unauthorized" });

        const sessionStatus = await getStatus(req, username);
        if (!['admin','manager','mod'].includes(sessionStatus)) {
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        }

        const pasteID = req.query.pasteID;
        if (!pasteID) return reply.status(400).send({ error: "PasteID undefined." });

        const [pasteRows] = await fastify.db.query(
            "SELECT pastname FROM pastes WHERE id = ?",
            [pasteID]
        );
        if (!pasteRows[0]) return reply.status(404).send({ success: false, error: "Paste not found." });

        const [memoRows] = await fastify.db.query(
            "SELECT memo_id, type, value, created_by, created_at FROM pastes_memos WHERE paste_id = ?",
            [pasteID]
        );

        const result = await Promise.all(memoRows.map(async memo => {
            const userStatus = await getStatus(req, memo.created_by);
            const style = styles[userStatus] || styles.user;
            return {
                id: memo.memo_id,
                type: memo.type,
                value: memo.value,
                username: memo.created_by,
                created_at: memo.created_at instanceof Date ? memo.created_at.toISOString().slice(0,19).replace('T',' ') : memo.created_at,
                rankStyle: style.rankStyle,
                usernameColor: await getColor(req, memo.created_by) || style.rankColor,
                suffix: style.suffix || ''
            };
        }));

        return reply.send({ success: true, memos: result });
    });

    fastify.get('/addMemo', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.status(401).send({ success: false, error: "Unauthorized" });

        const sessionStatus = await getStatus(req, username);
        if (!['admin','manager','mod'].includes(sessionStatus)) {
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        }

        const { pasteID, type: memoType, value } = req.query;
        if (!pasteID || !value) return reply.status(400).send({ success: false, error: "Invalid data" });

        const [pasteRows] = await fastify.db.query(
            "SELECT pastname FROM pastes WHERE id = ?",
            [pasteID]
        );
        if (!pasteRows[0]) return reply.status(404).send({ success: false, error: "Paste not found." });

        const typeToInsert = memoType === 'priority' ? 'priority' : null;

        const [insertResult] = await fastify.db.query(
            "INSERT INTO pastes_memos (paste_id, type, value, created_by) VALUES (?, ?, ?, ?)",
            [pasteID, typeToInsert, value, username]
        );

        await addLog(req, "admin", `adding memo "${value}" to post "${pasteRows[0].pastname}"`, username);

        return reply.send({ success: true, memoID: insertResult.insertId });
    });

    fastify.get('/deleteMemo', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.status(401).send({ success: false, error: "Unauthorized" });

        const sessionStatus = await getStatus(req, username);
        if (!['admin','manager','mod'].includes(sessionStatus)) {
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        }

        const memoID = req.query.memoID;
        if (!memoID) return reply.status(400).send({ error: "MemoID undefined." });

        const [memoRows] = await fastify.db.query(
            "SELECT memo_id, paste_id, value, created_by FROM pastes_memos WHERE memo_id = ?",
            [memoID]
        );
        const memo = memoRows[0];
        if (!memo) return reply.status(404).send({ error: "Memo not found." });

        const [pasteRows] = await fastify.db.query(
            "SELECT pastname FROM pastes WHERE id = ?",
            [memo.paste_id]
        );
        if (!pasteRows[0]) return reply.status(404).send({ success: false, error: "Paste not found." });

        const canDelete = memo.created_by === username || ['admin','manager','mod'].includes(sessionStatus);
        if (!canDelete) return reply.status(401).send({ success: false, error: "Unauthorized" });

        await fastify.db.query(
            "DELETE FROM pastes_memos WHERE memo_id = ?",
            [memoID]
        );

        await addLog(req, "admin", `deleting memo "${memo.value}" to post "${pasteRows[0].pastname}"`, username);

        return reply.send({ success: true, message: "Memo deleted successfully." });
    });
}