import { getSessionUsername } from "../middlewares/session.js";
import { getStatus, getColor } from "../utils.js";

export default async function (fastify) {
    fastify.get('/blacklist', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!status || !['admin', 'founder','manager'].includes(status)) return reply.redirect('/home');

        const [rows] = await fastify.db.query(`
            SELECT 
                id, 
                word, 
                created_by, 
                contact_info, 
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
            FROM blacklist
            WHERE id != 4
            ORDER BY created_at DESC
        `);

        const enriched_entries = [];

        for (const row of rows) {
            enriched_entries.push({
                id: row.id,
                word: row.word,
                created_by: row.created_by,
                contact_info: row.contact_info,
                created_at: row.created_at,
                created_by_status: await getStatus(req, row.created_by),
                created_by_color: await getColor(req, row.created_by),
            });
        }

        return reply.view('admin/blacklist.html', {
            blacklist_entries: enriched_entries
        });
    });
}