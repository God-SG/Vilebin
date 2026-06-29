import * as config from '../config.js';

import { getSessionUsername } from '../middlewares/session.js'
import { getStatus } from '../utils.js'

export default async function (fastify) {
    fastify.get('/claimGift', async (req, reply) => {
        const { giftID } = req.query;

        if (!giftID) {
            return reply.code(400).send({ error: "Gift id undefined." });
        }

        const username = await getSessionUsername(req);
        if (!username) {
            return reply.code(401).send({ error: "Please login." });
        }

        const [[redeem]] = await fastify.db.query(`
            SELECT role, col, claims FROM redeems WHERE name = ?
        `, [giftID]);

        if (!redeem) {
            return reply.code(404).send({ error: "Gift not found." });
        }

        const { role: role_required, col: max_activations, claims } = redeem;

        const claimsList = claims ? claims.split(',') : [];
        const current_activations = claimsList.length;

        if (claimsList.includes(username)) {
            return reply.code(400).send({ error: "You have already claimed this gift." });
        }

        if (current_activations >= max_activations) {
            return reply.code(400).send({ error: "Gift activation limit reached." });
        }

        if (role_required === "colorchanges") {
            const [[user]] = await fastify.db.query(`
                SELECT colorchanges FROM users WHERE username = ?
            `, [username]);

            if (user && user.colorchanges === 1) {
                return reply.code(400).send({ error: "You already have Color Changes." });
            }
        }

        const user_status = await getStatus(req, username);

        const current_role_level = config.statusHierarchy[user_status] || 0;
        const required_role_level = config.statusHierarchy[role_required] || 0;

        if (role_required !== "colorchanges" && current_role_level <= required_role_level) {
            return reply.code(403).send({ error: "Your role is too big to receive this gift." });
        }

        const updated_claims = claims
            ? `${claims},${username}`
            : username;

        await fastify.db.query(`
            UPDATE redeems SET claims = ? WHERE name = ?
        `, [updated_claims, giftID]);

        if (role_required === "colorchanges") {
            await fastify.db.query(`
                UPDATE users
                SET colorchanges = 1
                WHERE username = ?
            `, [username]);
        } else {
            await fastify.db.query(`
                UPDATE users
                SET status = ?
                WHERE username = ?
            `, [role_required, username]);
        }

        return reply.send({
            success: true,
            message: "Gift claimed successfully!"
        });
    });
};