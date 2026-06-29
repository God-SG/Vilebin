import { getSessionUsername } from '../../middlewares/session.js'
import { getStatus, addLog } from '../../utils.js'

export default function (fastify) {
    fastify.get('/changeViews', async (req, reply) => {
        const username = await getSessionUsername(req)
        if (!username) {
            return reply.redirect('/home');
        }

        const sessionStatus = await getStatus(req, username)
        if (!sessionStatus || sessionStatus !== 'admin') {
            return reply.redirect('/home');
        }

        const pasteID = req.query.pasteID
        let value = req.query.value

        if (!pasteID) {
            return reply.code(400).send({ success: false, error: "Invalid data" });
        }

        value = parseInt(value)
        if (isNaN(value) || value < 0) {
            return reply.code(400).send({ success: false, error: "Views must be a non-negative integer" });
        }

        const [[pasteCheckRows]] = await fastify.db.query(
            `SELECT pastname FROM pastes WHERE id = ?`,
            [pasteID]
        )
        const pasteCheck = pasteCheckRows
        if (!pasteCheck) {
            return reply.code(404).send({ success: false, error: "Paste not found." });
        }

        await fastify.db.query(
            `UPDATE pastes SET view = ? WHERE id = ?`,
            [value, pasteID]
        )

        await addLog(req, "admin", `set new views "${value}" to post "${pasteCheck.pastname}"`, username)

        return { success: true }
    })
}