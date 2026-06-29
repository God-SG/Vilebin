import { getSessionUsername } from "../../middlewares/session.js";
import { getStatus, addLog, sendTelegram } from "../../utils.js";

export default async function(fastify) {
    fastify.post('/editPaste', async (req, reply) => {
        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);

        const pasteID = req.query.pasteID;

        const { content, reason } = req.body;

        if (!content || !pasteID) return reply.status(400).send({ success: false, error: "Missing content" });
        if (reason && reason.length > 25) return reply.status(404).send({ success: false, error: "Maximum characters in the reason - 25" });
        if (content.length < 10 || content.length > 500000) return reply.status(404).send({ success: false, error: "Content must be between 10 and 500,000 characters" });

        const [pasteRows] = await fastify.db.query("SELECT owner, deleted, past, pastname, edit FROM pastes WHERE id = ?", [pasteID]);
        const paste = pasteRows[0];

        if (!paste) return reply.status(404).send({ success: false, error: "Paste not found" });

        const [owner, deleted, past_content, pastname, edit_enabled] = [paste.owner, paste.deleted, paste.past, paste.pastname, paste.edit];

        if (deleted && !['admin', 'manager', 'mod'].includes(status)) return reply.status(404).send({ success: false, error: "Paste not found" });
        if ((owner || "").toLowerCase() !== (username || "").toLowerCase()) return reply.status(403).send({ success: false, error: "You are not the owner of this paste" });
        if (!edit_enabled) return reply.status(403).send({ success: false, error: "Edit is disabled for this paste" });
        if (content === past_content) return reply.status(400).send({ success: false, error: "Nothing has changed" });

        if (!['admin', 'manager', 'mod'].includes(status)) {
            const [activeEditRows] = await fastify.db.query("SELECT id FROM edits WHERE post_c = ? AND status = 'pending' LIMIT 1", [pastname.replace(/\s/g, '')]);
            if (activeEditRows.length) return reply.status(409).send({ success: false, error: "There is already an active request of edit for this paste" });

            const file_url = pastname.replace(/\s/g, '');
            await fastify.db.query(
                "INSERT INTO edits (post, post_c, oldcontent, newcontent, reason, editor) VALUES (?, ?, ?, ?, ?, ?)",
                [pastname, file_url, past_content, content, reason || null, username]
            );

            let editmessage = `sent paste "${pastname}" for edit review`;
            if (reason) editmessage += ` (reason: ${reason})`;
            await addLog(req, "user", editmessage, username);

            const tg_message = `<b>New Edit Request!</b>\n\nPaste - <tg-spoiler>https://vilebin.net/admin/edits/${file_url}</tg-spoiler>\nEditor - <b>${username}</b>\nReason - <b>${reason?.trim() || 'No reason provided'}</b>`;
            sendTelegram("-1002881608552", tg_message, 4658);
        } else {
            let editmessage = `edit paste "${pastname}"`;
            if (reason) editmessage += ` (reason: ${reason})`;
            await addLog(req, "user", editmessage, username);

            await fastify.db.query("UPDATE pastes SET past = ? WHERE id = ?", [content, pasteID]);
        }

        return reply.send({ success: true });
    });
};