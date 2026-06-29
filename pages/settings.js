import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSessionUsername } from '../middlewares/session.js';
import { getStatus, getId, allowedFile } from '../utils.js';

export default function (fastify) {
    fastify.get('/settings', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) {
            return reply.redirect('/home');
        }

        const [rows] = await fastify.db.query('SELECT * FROM users WHERE username = ?', [username]);
        const result = rows[0];

        if (!result) {
            return reply.redirect('/home');
        }

        return reply.view('profile/settings.html', {
            userid: result.id,
            joined: result.datejoin,
            avatar: result.avatar,
            banner: result.banner,
            bio: result.bio,
            email: result.email,
            totp: result.totp_enabled,
            error: ''
        });
    });

    fastify.post('/settings', async (req, reply) => {
        let parts = {};
        let files = {};

        if (req.isMultipart()) {
            for await (const part of req.parts()) {
                if (part.file) {
                    const buffer = await part.toBuffer();
                    files[part.fieldname] = {
                        filename: part.filename,
                        buffer
                    };
                } else {
                    parts[part.fieldname] = part.value;
                }
            }
        } else {
            parts = req.body || {};
        }

        const username = await getSessionUsername(req);
        if (!username) {
            return reply.redirect('/home');
        }

        const userStatus = await getStatus(req, username);
        if (!userStatus) {
            return reply.redirect('/home');
        }

        if (files.image && await allowedFile(files.image.filename)) {
            const namefile = uuidv4().replace(/-/g, '').slice(0, 20);
            const ext = files.image.filename.split('.').pop().toLowerCase();

            if (ext === 'gif' && !['admin','manager','mod','council','clique','rich','criminal','vip'].includes(userStatus)) {
                return reply.redirect('/settings');
            }

            const filename = `${namefile}.${ext}`;
            const filePath = path.join('cdn/avatars', filename);

            fs.writeFileSync(filePath, files.image.buffer);

            await fastify.db.query(
                'UPDATE users SET avatar = ? WHERE username = ?',
                [filename, username]
            );
        }

        if (files.banner && await allowedFile(files.banner.filename)) {
            const namefile = uuidv4().replace(/-/g, '').slice(0, 20);
            const ext = files.banner.filename.split('.').pop().toLowerCase();

            if (ext === 'gif' && !['admin','manager','mod','council','clique','rich','criminal','vip'].includes(userStatus)) {
                return reply.redirect('/settings');
            }

            const filename = `${namefile}.${ext}`;
            const filePath = path.join('cdn/banners', filename);

            fs.writeFileSync(filePath, files.banner.buffer);

            await fastify.db.query(
                'UPDATE users SET banner = ? WHERE username = ?',
                [filename, username]
            );
        }

        if (parts['remove-avatar'] === '1') {
            const [rows] = await fastify.db.query(
                'SELECT avatar FROM users WHERE username = ?',
                [username]
            );

            const avatarRow = rows[0];

            if (avatarRow?.avatar) {
                const avatarPath = path.join('cdn/avatars', avatarRow.avatar);
                if (fs.existsSync(avatarPath)) {
                    fs.unlinkSync(avatarPath);
                }
            }

            await fastify.db.query(
                'UPDATE users SET avatar = NULL WHERE username = ?',
                [username]
            );
        }

        if (parts['remove-banner'] === '1') {
            const [rows] = await fastify.db.query(
                'SELECT banner FROM users WHERE username = ?',
                [username]
            );

            const bannerRow = rows[0];

            if (bannerRow?.banner) {
                const bannerPath = path.join('cdn/banners', bannerRow.banner);
                if (fs.existsSync(bannerPath)) {
                    fs.unlinkSync(bannerPath);
                }
            }

            await fastify.db.query(
                'UPDATE users SET banner = NULL WHERE username = ?',
                [username]
            );
        }

        return reply.redirect('/settings');
    });
}