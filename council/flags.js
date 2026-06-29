import { DateTime } from "luxon";

import { getSessionUsername } from '../middlewares/session.js'
import { getStatus } from '../utils.js'

export default function (fastify) {
    fastify.get("/", async (request, reply) => {
        const username = await getSessionUsername(request)

        if (!username) {
            return reply.redirect("/home")
        }

        const status = await getStatus(request, username)

        if (!status || status !== "council") {
            return reply.redirect("/home")
        }

        return reply.view("council/index.html")
    })


    fastify.get("/flags", async (request, reply) => {
        const username = await getSessionUsername(request)

        if (!username) {
            return reply.redirect("/home")
        }

        const status = await getStatus(request, username)

        if (!status || status !== "council") {
            return reply.redirect("/home")
        }

        const [rows] = await fastify.db.query(`
            SELECT id, post, reason, reporter, date, moderator, checkdate, status
            FROM flags
            WHERE reporter = ?
        `, [username])

        const flags = rows.map(row => ({
            id: row.id,
            post: row.post,
            reason: row.reason,
            reporter: row.reporter,
            date: row.date,
            moderator: row.moderator,
            checkdate: row.checkdate,
            status: row.status
        }))

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        const flags7Days = flags.filter(f => new Date(f.date) > sevenDaysAgo)

        const approvedCount = flags.filter(f => f.status === "approved").length
        const deniedCount = flags.filter(f => f.status === "denied").length

        for (const flag of flags) {

            if (flag.date) {
                const d = new Date(flag.date)
                flag.date_formatted = d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                })
            }

            if (flag.checkdate) {
                const isoString = flag.checkdate.replace(" ", "T");
                const dt = DateTime.fromISO(isoString, { zone: "Europe/Moscow" });
                const now = DateTime.now().setZone("Europe/Moscow");

                if (dt.isValid) {
                    flag.checkdate_formatted = dt.toRelative({ base: now, locale: 'en' });
                }
            } else {
                flag.checkdate_formatted = null;
            }
            
            if (flag.moderator) {

                const [modRows] = await fastify.db.query(
                    "SELECT status, color FROM users WHERE username = ?",
                    [flag.moderator]
                )

                if (modRows.length) {
                    flag.moderator_status = modRows[0].status
                    flag.moderator_color = modRows[0].color
                } else {
                    flag.moderator_status = "anonymous"
                    flag.moderator_color = ""
                }

            } else {
                flag.moderator_status = "anonymous"
                flag.moderator_color = ""
            }
        }

        return reply.view("council/flags.html", {
            flags,
            flags_7_days: flags7Days.length,
            approved_count: approvedCount,
            denied_count: deniedCount
        });
    });
};