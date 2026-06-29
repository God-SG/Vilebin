import { getSessionUsername } from '../../middlewares/session.js'
import { addLog, getStatus, addNotify } from '../../utils.js'

export default async function (fastify) {
    fastify.get('/reviewEdit', async (req, reply) => {
        const { reviewID, action } = req.query;

        const username = await getSessionUsername(req);
        if (!username) return reply.code(401).send({ error: 'Unauthorized' });

        const status = await getStatus(req, username);
        if (!['admin', 'manager', 'mod'].includes(status)) return reply.code(401).send({ error: 'Unauthorized' });

        const [[editRow]] = await fastify.db.query(
            "SELECT id, post ,post_c, newcontent, status, editor FROM edits WHERE id = ? LIMIT 1",
            [reviewID]
        );
        if (!editRow || editRow.status !== 'pending') {
            return reply.code(400).send({ error: 'Edit not found or already processed' });
        }

        const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');

        if (Number(action) === 1) {
            await fastify.db.query(
                "UPDATE pastes SET past = ? WHERE pastname_c = ?",
                [editRow.newcontent, editRow.post_c]
            );

            await fastify.db.query(
                "UPDATE edits SET status = 'approved', moderator = ?, checkdate = ? WHERE id = ?",
                [username, currentTime, reviewID]
            );

            await addLog(req, "mod", `approved edit for paste "${editRow.post_c}"`, username);
            addNotify(req, editRow.editor, `Your edit for paste - "${editRow.post}" was approved.`, 0);
        } else if (Number(action) === 0) {
            await fastify.db.query(
                "UPDATE edits SET status = 'denied', moderator = ?, checkdate = ? WHERE id = ?",
                [username, currentTime, reviewID]
            );

            await addLog(req, "mod", `denied edit for paste "${editRow.post_c}"`, username);
            addNotify(req, editRow.editor, `Your edit for paste - "${editRow.post}" was denied.`, 1);
        } else {
            return reply.code(400).send({ error: 'Invalid action' });
        }

        return reply.send({ success: true });
    });
}