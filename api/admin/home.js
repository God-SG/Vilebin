import fs from "fs"
import path from "path"
import crypto from "crypto"
import { pipeline } from "stream/promises"

import { getSessionUsername } from "../../middlewares/session.js"
import { addLog, getStatus } from "../../utils.js"

const HOA_DIR = path.join(process.cwd(), "cdn", "hoa")

function randomName(ext = ".jpg") {
    return crypto.randomBytes(16).toString("hex") + ext
}

async function checkAdmin(req) {
    const username = await getSessionUsername(req)
    const status = await getStatus(req, username)

    if (!status || !['admin','founder','manager','mod'].includes(status)) {
        return null
    }
    return username
}

export default async function (fastify) {
    fastify.post("/addAnnouncement", async (req, reply) => {
        const username = await checkAdmin(req)
        if (!username) return reply.code(403).send({ success:false })

        const { message, color } = req.body
        if (!message) return reply.send({ success:false, error:"Message required" })

        const [result] = await fastify.db.query(
            `INSERT INTO announcements (text, color) VALUES (?, ?)`,
            [message, color || "#ffffff"]
        )
        const announcementID = result.insertId

        await addLog(req,"admin",`created announcement "${message}"`,username)

        return {
            success: true,
            announcement: { announcementID, message, color: color || "#ffffff" }
        }
    });
    fastify.post("/editAnnouncement", async (req, reply) => {
        const username = await checkAdmin(req)
        if (!username) return reply.code(403).send({ success:false })

        const { announcementID, message, color } = req.body
        if (!announcementID || !message) return reply.send({ success:false, error:"Invalid data" })

        await fastify.db.query(
            `UPDATE announcements SET text=?, color=? WHERE id=?`,
            [message, color || "#ffffff", announcementID]
        )

        await addLog(req,"admin",`edited announcement ${announcementID}`,username)

        return {
            success: true,
            announcement: { announcementID, message, color: color || "#ffffff" }
        }
    });
    fastify.post("/deleteAnnouncement", async (req, reply) => {
        const username = await checkAdmin(req)
        if (!username) return reply.code(403).send({ success:false })

        const { announcementID } = req.body
        if (!announcementID) return reply.send({ success:false })

        await fastify.db.query(`DELETE FROM announcements WHERE id=?`, [announcementID])
        await addLog(req,"admin",`deleted announcement ${announcementID}`,username)

        return { success:true }
    });

    fastify.post("/addHOA", async (req, reply) => {
        const username = await checkAdmin(req);
        if (!username) return reply.code(403).send({ success: false });

        const parts = req.parts();
        let title = "";
        let description = "";
        let imageName = null;

        for await (const part of parts) {
            if (part.type === "file") {
                const ext = path.extname(part.filename) || ".jpg";
                const name = randomName(ext);
                const filePath = path.join(HOA_DIR, name);
                await pipeline(part.file, fs.createWriteStream(filePath));
                imageName = name;
            }
            if (part.type === "field") {
                if (part.fieldname === "title") title = part.value;
                if (part.fieldname === "content") description = part.value;
            }
        }

        if (!title || !description) {
            return reply.send({ success: false, error: "Invalid data" });
        }

        const [result] = await fastify.db.query(
            `INSERT INTO hoa (title, description, image) VALUES (?, ?, ?)`,
            [title, description, imageName]
        );

        await addLog(req, "admin", `created HOA "${title}"`, username);

        return {
            success: true,
            hoa: {
                hoaID: result.insertId,
                name: title,
                description,
                image: imageName
            }
        };
    });
    fastify.post("/editHOA", async (req, reply) => {
        const username = await checkAdmin(req);
        if (!username) return reply.code(403).send({ success: false });

        const parts = req.parts();
        let hoaID = null;
        let title = "";
        let description = "";
        let imageName = null;

        for await (const part of parts) {
            if (part.type === "file") {
                const ext = path.extname(part.filename) || ".jpg";
                const name = randomName(ext);
                const filePath = path.join(HOA_DIR, name);
                await pipeline(part.file, fs.createWriteStream(filePath));
                imageName = name;
            }
            if (part.type === "field") {
                if (part.fieldname === "hoaID") hoaID = part.value;
                if (part.fieldname === "title") title = part.value;
                if (part.fieldname === "content") description = part.value;
            }
        }

        if (!hoaID) return reply.send({ success: false });

        if (imageName) {
            const [rows] = await fastify.db.query(`SELECT image FROM hoa WHERE id=?`, [hoaID]);
            if (rows.length && rows[0].image) {
                const oldFile = path.join(HOA_DIR, rows[0].image);
                if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            }

            await fastify.db.query(
                `UPDATE hoa SET title=?, description=?, image=? WHERE id=?`,
                [title, description, imageName, hoaID]
            );
        } else {
            await fastify.db.query(
                `UPDATE hoa SET title=?, description=? WHERE id=?`,
                [title, description, hoaID]
            );
        }

        await addLog(req, "admin", `edited HOA ${hoaID}`, username);

        return {
            success: true,
            hoa: {
                hoaID,
                name: title,
                description,
                image: imageName
            }
        };
    });
    fastify.post("/deleteHOA", async (req, reply) => {
        const username = await checkAdmin(req)
        if (!username) return reply.code(403).send({ success:false })

        const parts = req.parts()
        let hoaID=null
        for await (const part of parts) if (part.fieldname==="hoaID") hoaID = part.value
        if (!hoaID) return reply.send({ success:false })

        const [rows] = await fastify.db.query(`SELECT image FROM hoa WHERE id=?`, [hoaID])
        if (rows.length && rows[0].image) {
            const file = path.join(HOA_DIR, rows[0].image)
            if (fs.existsSync(file)) fs.unlinkSync(file)
        }

        await fastify.db.query(`DELETE FROM hoa WHERE id=?`, [hoaID])
        await addLog(req,"admin",`deleted HOA ${hoaID}`,username)

        return { success:true }
    });
}