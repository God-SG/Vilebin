import speakeasy from "speakeasy";

import { getSessionUsername } from "../../middlewares/session.js";
import { getStatus, addLog } from "../../utils.js";

export default async function (fastify) {
    fastify.get("/disableTOTP/:code", async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const code = req.params.code;
        const status = await getStatus(req, username);

        const [rows] = await fastify.db.query(
            "SELECT totp_enabled, totp_secret FROM users WHERE username = ?",
            [username]
        );

        if (!rows.length || !rows[0].totp_enabled) {
            return reply.code(400).send({ success: false, error: "2FA not enabled" });
        }

        const { totp_secret } = rows[0];

        if (!totp_secret) {
            return reply.code(400).send({ success: false, error: "TOTP not initialized" });
        }

        const verified = speakeasy.totp.verify({
            secret: totp_secret,
            encoding: "base32",
            token: code,
            window: 1
        });

        if (!verified) {
            return reply.code(400).send({ success: false, error: "Invalid code" });
        }

        // if (['admin', 'manager', 'mod', 'council'].includes(status)) {
        //     return reply.code(400).send({
        //         success: false,
        //         error: "Error, contact to manager"
        //     });
        // }

        await fastify.db.query(
            "UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE username = ?",
            [username]
        );

        await addLog(req, "user", "2FA disabled", username);

        return { success: true };
    });
}