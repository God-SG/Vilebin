import { getSessionUsername } from "../middlewares/session.js";

export default function (fastify) {
    fastify.get('/upgrades', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) {
            return reply.view('upgrades.html', {
                colorchanges: 0
            });
        }

        const [rows] = await req.server.db.query(
            "SELECT colorchanges FROM users WHERE username = ?",
            [username]
        );

        return reply.view('upgrades.html', {
            colorchanges: rows.length ? rows[0].colorchanges : 0
        });
    });
}