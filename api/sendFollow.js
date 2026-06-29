import { getSessionUsername } from "../middlewares/session.js";

export default function (fastify) {
    fastify.get('/sendFollow', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username)
            return reply.code(401).send({ success: false, error: "Unauthorized" });

        const { followingID } = req.query;
        if (!followingID)
            return reply.send({ success: false, error: "Missing followingID" });

        const [[target]] = await fastify.db.query(
            "SELECT id, username, followers FROM users WHERE id = ?",
            [followingID]
        );

        if (!target)
            return reply.code(404).send({ success: false, error: "User not found" });

        if (session_username === target.username)
            return reply.code(400).send({ success: false, error: "You cannot follow yourself" });

        let followers = {};
        try {
            followers = target.followers ? JSON.parse(target.followers) : {};
        } catch {}

        let following;

        if (followers[session_username]) {
            delete followers[session_username];
            following = false;
        } else {
            followers[session_username] = true;
            following = true;
        }

        await fastify.db.query(
            "UPDATE users SET followers = ? WHERE id = ?",
            [JSON.stringify(followers), followingID]
        );

        const [rows] = await fastify.db.query(
            "SELECT followers FROM users"
        );

        let followingCount = 0;

        for (const row of rows) {
            if (!row.followers) continue;

            try {
                const followers_dict = JSON.parse(row.followers);
                if (followers_dict[target.username]) followingCount++;
            } catch {}
        }

        return reply.send({
            success: true,
            following,
            followersCount: Object.keys(followers).length,
            followingCount
        });
    });
}