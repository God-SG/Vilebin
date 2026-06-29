import { getSessionUsername } from "../../../middlewares/session.js";
import { getStatus, addLog } from "../../../utils.js";

export default async function(fastify) {
    fastify.get('/addBlacklist', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) {
            return reply.redirect('/home');
        }

        const status = await getStatus(req, username);
        if (!status || !['admin', 'manager'].includes(status)) {
            return reply.redirect('/home');
        }

        const wordsRaw = (req.query.words || '').trim();
        const contactInfo = (req.query.contact_info || '').trim();

        let words = '';
        if (wordsRaw) {
            words = wordsRaw
                .split("\n")
                .map(w => w.trim())
                .filter(Boolean)
                .join(", ");
        }

        if (words && contactInfo) {
            try {
                await fastify.db.query(
                    'INSERT INTO blacklist (word, created_by, contact_info) VALUES (?, ?, ?)',
                    [words, username, contactInfo]
                );

                await addLog(req, "admin", `added new info to blacklist with contact info "${contactInfo || 'N/A'}"`, username);
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ success: false, error: "Server error" });
            }
        }

        return reply.send({ success: true });
    });
}