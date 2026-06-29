import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus, addLog } from '../../utils.js';

export default function (fastify) {
    fastify.get('/cancelFlag', async (req, reply) => {
        const username = await getSessionUsername(req);
        const { flagID } = req.query;

        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const status = await getStatus(req, username);

        if (!status || status !== "council") {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const [rows] = await fastify.db.query(
            "SELECT id, pastname FROM pastes WHERE id = ?",
            [flagID]
        );

        const paste = rows[0];

        if (!paste) {
            return reply.code(404).send({
                success: false,
                error: "Paste not found"
            });
        }

        const { pastname } = paste;

        const [flagRows] = await fastify.db.query(
            `SELECT 1 FROM flags
            WHERE post = ? AND reporter = ? AND status = 'pending'`,
            [pastname, username]
        );

        if (!flagRows.length) {
            return reply.code(404).send({
                success: false,
                message: "Flag not found"
            });
        }

        await addLog(req, "admin", `cancel flag paste "${pastname}"`, username);

        const current_time = new Date().toLocaleString('sv-SE', {timeZone: 'Europe/Moscow', hour12: false}).replace(',', '');

        await fastify.db.query(
            `UPDATE flags
            SET status = 'cancelled',
                moderator = ?,
                checkdate = ?
            WHERE post = ?
            AND reporter = ?
            AND status = 'pending'`,
            [username, current_time, pastname, username]
        );

        return reply.send({
            success: true,
            message: "Flag canceled"
        });
    });
}