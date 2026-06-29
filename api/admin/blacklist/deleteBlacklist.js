import { getSessionUsername } from "../../../middlewares/session.js";
import { getStatus, addLog } from "../../../utils.js";

export default async function(fastify) {
    fastify.get('/deleteBlacklist', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) {
            return reply.redirect('/home');
        }

        const status = await getStatus(req, username);

        if (!status || !['admin', 'manager'].includes(status)) {
            return reply.redirect('/home');
        }

        const id = parseInt(req.query.id, 10);

        if (!id) {
            return reply.status(400).send({ success: false, error: "Invalid ID" });
        }

        try {
            if ([4].includes(id)) {
                return reply.status(400).send({ success: false, error: "Invalid ID" });
            }

            const [rows] = await fastify.db.query('SELECT contact_info FROM blacklist WHERE id = ?', [id]);

            if (!rows.length) {
                return reply.status(404).send({ success: false, error: "Entry not found" });
            }

            await fastify.db.query('DELETE FROM blacklist WHERE id = ?', [id]);

            await addLog(req, "admin", `delete with contact info "${rows[0].contact_info}" from blacklist`, username);

            return reply.send({ success: true });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: "Server error" });
        }
    });
}