import { getSessionUsername } from '../../middlewares/session.js';
import { addLog, sendTelegram, addNotify } from '../../utils.js';

export default function (fastify) {
    fastify.get('/managePasteType', async (req, reply) => {
        const { action, pasteID, reason = '', notify = false } = req.query;

        const username = await getSessionUsername(req);
        if (!username) return reply.code(401).send({ success: false, error: "Unauthorized" });

        const [[userRows]] = await fastify.db.query(
            `SELECT status FROM users WHERE username = ?`,
            [username]
        );
        const user_status = userRows?.status;

        if (!['admin', 'manager', 'mod'].includes(user_status)) {
            return reply.code(403).send({ success: false, error: "Permission denied." });
        }

        if (!['seal', 'unseal'].includes(action)) {
            return reply.code(400).send({ success: false, error: "Invalid action." });
        }

        const [[pasteRows]] = await fastify.db.query(
            `SELECT deleted, pastname, owner FROM pastes WHERE id = ?`,
            [pasteID]
        );
        if (!pasteRows) return reply.code(404).send({ success: false, error: "Paste not found." });

        const paste_status = pasteRows.deleted;
        const paste_title = pasteRows.pastname;
        const paste_owner = pasteRows.owner;

        if (action === 'seal') {
            if (paste_status) {
                return reply.code(400).send({ success: false, error: "Paste already sealed." });
            }

            const [[flagged]] = await fastify.db.query(
                `SELECT 1 FROM flags WHERE post = ? AND status = 'pending'`,
                [paste_title]
            );
            if (flagged) return reply.code(400).send({ success: false, error: "Currently paste flagged." });

            await fastify.db.query(`UPDATE pastes SET deleted = TRUE WHERE id = ?`, [pasteID]);
        } else if (action === 'unseal') {
            if (!paste_status) {
                return reply.code(400).send({ success: false, error: "Paste already unsealed." });
            }
            await fastify.db.query(`UPDATE pastes SET deleted = FALSE WHERE id = ?`, [pasteID]);
        }

        await addLog(req, "admin", `${action === 'seal' ? 'deleting' : 'restoring'} paste "${paste_title}" for reason "${reason.trim()}" (silent - ${notify ? 'True' : 'False'})`, username);

        if (notify && paste_owner && paste_owner !== 'Anonymous') {
            addNotify(req, paste_owner, `Your paste - "${paste_title}" was ${action === 'seal' ? 'deleted' : 'restored'} for the reason: "${reason.trim()}".`, action === 'seal' ? 1 : 0);
        }

        const file_url = paste_title.replace(/\s/g, '');
        const tg_message = `<b>Paste ${action === 'seal' ? 'Deletion' : 'Restoration'}!</b>\n\n` +
            `Paste - <tg-spoiler>https://vilebin.net/upload/${file_url}</tg-spoiler>\n` +
            `Admin - <b>${username}</b>\n` +
            `Reason - <b>${reason.trim()}</b>`;
        sendTelegram("-1002881608552", tg_message);

        return { success: true };
    });
}