import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus, addLog } from '../../utils.js';

export default function (fastify) {
    fastify.get('/manageCommentType', async (req, reply) => {
        const { action, commentID } = req.query;

        const username = await getSessionUsername(req);
        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const user_status = await getStatus(req, username)

        if (!['admin', 'manager', 'mod', 'council'].includes(user_status)) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        if (!['seal', 'unseal'].includes(action)) {
            return reply.code(400).send({ success: false, error: "Invalid action." });
        }

        const [[comment]] = await fastify.db.query(
            `SELECT paste_id, content, deleted, owner FROM pastes_comments WHERE id = ?`,
            [commentID]
        );

        const [[paste]] = await fastify.db.query(
            `SELECT pastname FROM pastes WHERE id = ?`,
            [comment.paste_id]
        );

        if (!comment) {
            return reply.code(404).send({ success: false, error: "Comment not found." });
        }

        if (action === 'seal') {
            if (comment.deleted) {
                return reply.code(400).send({ success: false, error: "Comment already deleted." });
            }

            await fastify.db.query(
                `UPDATE pastes_comments SET deleted = 1 WHERE id = ?`,
                [commentID]
            );

            await addLog(req, "admin", `seal comment "${comment.content}" from "${comment.owner}" under paste "${paste.pastname}"`, username);
        } else if (action === 'unseal') {
            if (!comment.deleted) {
                return reply.code(400).send({ success: false, error: "Comment already active." });
            }

            await fastify.db.query(
                `UPDATE pastes_comments SET deleted = 0 WHERE id = ?`,
                [commentID]
            );

            await addLog(req, "admin", `unseal comment "${comment.content}" from "${comment.owner}" under paste "${paste.pastname}"`, username);
        }

        return { success: true };
    });
}