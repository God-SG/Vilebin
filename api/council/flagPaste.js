import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus, addLog, sendTelegram } from '../../utils.js';

export default function (fastify) {
    fastify.get('/flagPaste', async (req, reply) => {
        const username = await getSessionUsername(req);
        const { pasteID, reason } = req.query;

        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const status = await getStatus(req, username);
        if (!status || status !== "council") {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const [rows] = await fastify.db.query(
            "SELECT id, pastname FROM pastes WHERE id = ? AND deleted = 0",
            [pasteID]
        );

        const paste = rows[0];

        if (!paste) {
            return reply.code(404).send({ success: false, error: "Paste not found" });
        }

        const { id: paste_id, pastname } = paste;
        const file_url = pastname.replace(/\s/g, "");

        const [existing] = await fastify.db.query(
            "SELECT 1 FROM flags WHERE post = ? AND status = 'pending'",
            [pastname]
        );

        if (existing.length) {
            return reply.code(409).send({
                success: false,
                error: "Already flagged this paste"
            });
        }

        await addLog(req, "admin", `flag paste "${pastname}" for reason "${reason.trim()}"`, username);

        const [result] = await fastify.db.query(
            `INSERT INTO flags (post, post_c, reason, reporter, status)
            VALUES (?, ?, ?, ?, 'pending')`,
            [pastname, file_url, reason.trim(), username]
        );
        const flagId = result.insertId;

        const tg_message =
            `<b>New Paste Flagged!</b>\n\n` +
            `Paste - <tg-spoiler>https://vilebin.net/admin/flags/${flagId}</tg-spoiler>\n` +
            `Council - <b>${username}</b>\n` +
            `Reason - <b>${reason.trim()}</b>`;

        sendTelegram("-1002881608552", tg_message, 4656).catch(console.error);

        return reply.send({ success: true });
    });
}