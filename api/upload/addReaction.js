import { getSessionUsername } from '../../middlewares/session.js';

export default function(fastify) {
    fastify.get('/addReaction', async (req, reply) => {
        const pasteID = Number(req.query.pasteID);
        const reactionType = Number(req.query.reactionType);

        const username = await getSessionUsername(req);
        if (!username) {
            return reply.status(401).send({ error: "UNAUTHENTICATED" });
        }

        if (![0, 1].includes(reactionType)) {
            return reply.status(400).send({ error: "Invalid reaction type" });
        }

        const [rows] = await fastify.db.query(
            "SELECT id, reactions FROM pastes WHERE id = ?",
            [pasteID]
        );
        const paste = rows[0];
        if (!paste) {
            return reply.status(404).send({ error: "Paste not found" });
        }

        let reactions = {};
        if (paste.reactions) {
            try {
                reactions = JSON.parse(paste.reactions);
            } catch {
                reactions = {};
            }
        }

        const newReaction = reactionType === 1 ? "like" : "dislike";
        const currentReaction = reactions[username];

        if (currentReaction === newReaction) {
            delete reactions[username];
        } else {
            reactions[username] = newReaction;
        }

        const likes = Object.values(reactions).filter(v => v === "like").length;
        const dislikes = Object.values(reactions).filter(v => v === "dislike").length;

        await fastify.db.query(
            "UPDATE pastes SET reactions = ? WHERE id = ?",
            [JSON.stringify(reactions), pasteID]
        );

        return reply.send({ success: true, likes, dislikes });
    });
}