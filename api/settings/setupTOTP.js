import speakeasy from "speakeasy";
import QRCode from "qrcode";

import { getSessionUsername } from "../../middlewares/session.js";
import { addLog } from "../../utils.js";

export default async function (fastify) {
    fastify.get("/setupTOTP", async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const [rows] = await fastify.db.query(
            "SELECT totp_enabled FROM users WHERE username = ?",
            [username]
        );

        if (rows.length && rows[0].totp_enabled) {
            return reply.code(400).send({ success: false, error: "2FA enabled" });
        }

        const secret = speakeasy.generateSecret({
            length: 20,
            name: `Vilebin:${username}`,
            issuer: "Vilebin"
        });

        const qr_url = await QRCode.toDataURL(secret.otpauth_url);

        await fastify.db.query(
            "UPDATE users SET totp_secret = ? WHERE username = ?",
            [secret.base32, username]
        );

        return {
            success: true,
            secret: secret.base32,
            qr_url
        };
    });
    fastify.get("/setupTOTP/:code", async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) {
            return reply.code(401).send({ success: false, error: "Unauthorized" });
        }

        const code = req.params.code;

        const [rows] = await fastify.db.query(
            "SELECT totp_enabled, totp_secret FROM users WHERE username = ?",
            [username]
        );

        if (!rows.length) {
            return reply.code(400).send({ success: false, error: "User not found" });
        }

        const { totp_enabled, totp_secret } = rows[0];

        if (totp_enabled) {
            return reply.code(400).send({ success: false, error: "2FA enabled" });
        }

        if (!totp_secret) {
            return reply.code(400).send({ success: false, error: "TOTP not initialized" });
        }

        const verified = speakeasy.totp.verify({
            secret: totp_secret,
            encoding: "base32",
            token: code,
            window: 1
        });

        if (verified) {
            await fastify.db.query(
                "UPDATE users SET totp_enabled = 1 WHERE username = ?",
                [username]
            );

            await addLog(req, "user", "2FA enabled", username);

            return { success: true };
        }

        return reply.code(400).send({ success: false, error: "Invalid TOTP code" });
    });
}