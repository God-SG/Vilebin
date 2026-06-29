import { getSessionUsername } from '../../middlewares/session.js'
import { getStatus, addLog } from '../../utils.js'

export default async function (fastify) {
    fastify.post('/settings', async (req, reply) => {
        const { action } = req.body;

        const username = await getSessionUsername(req);
        if (!username) return reply.send({ success: false, error: 'Unauthorized' });

        const status = await getStatus(req, username);
        if (!status || !["admin"].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        // SETTINGS
        if (action === "toggleSettings") {
            const { type } = req.body;

            if (type === "maintenance") {
                await fastify.db.query(`UPDATE config SET tech = NOT tech`);
                return reply.send({ success: true, type: "maintenance" });
            }

            if (type === "apply") {
                await fastify.db.query(`UPDATE config SET apply = NOT apply`);
                return reply.send({ success: true, type: "apply" });
            }

            return reply.send({ success: false, error: "Invalid toggle type" });
        };

        // CREATE GIFT
        if (action === "createGift") {
            const { name, role, amount } = req.body;

            if (!name || !role) {
                return reply.send({ success: false, error: "Missing fields" });
            }

            const [[existingGift]] = await fastify.db.query(
                'SELECT 1 FROM redeems WHERE name = ?',
                [name]
            );

            if (existingGift) {
                return reply.send({ success: false, error: 'A gift with this name already exists.' });
            }

            await fastify.db.query(`
                INSERT INTO redeems (name, role, col, claims, creator)
                VALUES (?, ?, ?, '', ?)
            `, [name, role, amount || 1, username]);

            await addLog(req, "admin", `created gift "${name}" with role "${role}" and amount activations "${amount || 1}"`, username);

            return reply.send({ success: true });
        };
        
        // DELETE GIFT
        if (action === "deleteGift") {
            const { id } = req.body;

            if (!id) {
                return reply.send({ success: false, error: "Missing id" });
            }

            const [[gift]] = await fastify.db.query(
                'SELECT name FROM redeems WHERE id = ?',
                [id]
            );

            if (!gift) {
                return reply.send({ success: false, error: "Gift not found" });
            }

            await fastify.db.query(
                'DELETE FROM redeems WHERE id = ?',
                [id]
            );

            await addLog(req, "admin", `deleted gift "${gift.name}"`, username);

            return reply.send({ success: true });
        };
    });
};