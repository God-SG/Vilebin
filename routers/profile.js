import sanitizeHtml from 'sanitize-html';
import fs from 'fs'
import path from 'path'
import mime from 'mime-types'
import { fileURLToPath } from 'url'

import { getSessionUsername } from '../middlewares/session.js'

import { styles } from '../config.js'
import { getStatus, getColor, getIP } from '../utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function (fastify) {
    fastify.get('/user/:username', async (req, reply) => {
        let { username } = req.params;
        let { page = 1 } = req.query;

        page = parseInt(page);
        if (page < 1) page = 1;

        const sessionUsername = await getSessionUsername(req);
        const sessionStatus = await getStatus(req, sessionUsername);
        const isStaff = ['admin', 'manager', 'mod'].includes(sessionStatus)

        const limit = 5;
        const offset = (page - 1) * limit;

        // ---------------- USER ----------------

        const [userRows] = await fastify.db.query(
            "SELECT * FROM users WHERE username = ?",
            [username]
        );

        if (!userRows.length) {
            return reply.redirect('/home');
        }

        let result = userRows[0];

        // ---------------- PASTES ----------------

        let query;
        if (!isStaff && username.toLowerCase() !== (sessionUsername || '').toLowerCase()) {
            query = "SELECT * FROM pastes WHERE owner = ? AND type = 'public'";
        } else {
            query = "SELECT * FROM pastes WHERE owner = ?";
        }

        if (!isStaff) {
            query += " AND (deleted IS NULL OR deleted != TRUE)";
        }

        query += " ORDER BY id DESC";
        query += " LIMIT ? OFFSET ?";

        const [pastes] = await fastify.db.query(query, [username, limit, offset]);

        // ---------------- COUNT ----------------

        let countQuery;
        if (!isStaff &&
            username !== sessionUsername) {
            countQuery = "SELECT COUNT(*) as count FROM pastes WHERE owner = ? AND type = 'public'";
        } else {
            countQuery = "SELECT COUNT(*) as count FROM pastes WHERE owner = ?";
        }

        if (!isStaff) {
            countQuery += " AND (deleted IS NULL OR deleted != TRUE)";
        }

        const [[countRow]] = await fastify.db.query(countQuery, [username]);
        const pasteCount = countRow?.count || 0;

        // ---------------- COMMENTS PER PASTE ----------------

        let totalComments = 0
        
        const [allPasteIds] = await fastify.db.query(
            `SELECT id FROM pastes WHERE owner = ? ${!isStaff ? 'AND (deleted IS NULL OR deleted != TRUE)' : ''}`,
            [username]
        )

        if (allPasteIds.length > 0) {
            const ids = allPasteIds.map(p => p.id)
            const placeholders = ids.map(() => '?').join(',')
            const [totalCommentRows] = await fastify.db.query(
                `SELECT COUNT(*) AS count FROM pastes_comments 
                WHERE paste_id IN (${placeholders}) ${!isStaff ? 'AND (deleted = 0 OR deleted IS NULL)' : ''}`,
                ids
            )
            totalComments = totalCommentRows[0]?.count || 0
        }

        let pasteCommentsCount = {}
        let userPostsList = []
        let formattedDate = null

        for (const paste of pastes) {
            if (paste.deleted === true && !isStaff) continue
            if (paste.type !== 'public' && paste.owner?.toLowerCase() !== (sessionUsername || '').toLowerCase() && !isStaff) continue

            const [commentRows] = await fastify.db.query(
                `SELECT COUNT(*) AS count FROM pastes_comments 
                WHERE paste_id = ? ${!isStaff ? 'AND (deleted = 0 OR deleted IS NULL)' : ''}`,
                [paste.id]
            )
            const commentCount = commentRows[0]?.count || 0
            pasteCommentsCount[paste.id] = commentCount

            try {
                const dt = new Date(paste.created_at)
                formattedDate = dt.toLocaleDateString('en-US', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric'
                })
            } catch {
                formattedDate = paste.created_at
            }

            const postData = [...Object.values(paste)]
            postData.push(formattedDate)
            userPostsList.push(postData)
        }

        userPostsList.sort((a, b) => b[0] - a[0])

        // ---------------- FOLLOWERS ----------------

        const followers = result.followers ? JSON.parse(result.followers) : {};
        const followersCount = Object.keys(followers).length;
        const isFollowing = sessionUsername && followers[sessionUsername];

        let followingCount = 0;
        const [allUsers] = await fastify.db.query("SELECT followers FROM users");

        for (const row of allUsers) {
            if (row.followers) {
                const f = JSON.parse(row.followers);
                if (f[username]) followingCount++;
            }
        }

        // ---------------- PROFILE COMMENTS ----------------

        let profileComments = [];

        if (result.comments) {
            try {
                const parsed = typeof result.comments === 'string'
                    ? JSON.parse(result.comments)
                    : result.comments;

                profileComments = Array.isArray(parsed) ? parsed : [];
            } catch (err) {
                profileComments = [];
            }
        }

        const commentLogins = [...new Set(profileComments.map(c => c.login))];

        let userInfoMap = {};

        if (commentLogins.length > 0) {
            const placeholders = commentLogins.map(() => '?').join(',');

            const [userRows] = await fastify.db.query(
                `SELECT username, status, color FROM users WHERE username IN (${placeholders})`,
                commentLogins
            );

            userRows.forEach(u => {
                userInfoMap[u.username] = {
                    status: u.status,
                    color: u.color
                };
            });
        }

        profileComments = profileComments.map(c => ({
            ...c,
            status: userInfoMap[c.login]?.status || 'user',
            color: userInfoMap[c.login]?.color || null,
            is_visible: !c.deleted
        }));

        profileComments = profileComments.filter(c =>
            !c.deleted ||
            username === sessionUsername ||
            isStaff
        );

        let profileCommentsCount = profileComments.length;

        // ---------------- BADGES ----------------

        const badges = result.badges
            ? JSON.parse(result.badges)
            : [];

        // ---------------- VIEWS ----------------

        let views = result.views ? JSON.parse(result.views) : {};
        const viewerId = sessionUsername
            ? `user:${sessionUsername}`
            : `ip:${await getIP(req)}`;

        if (!views[viewerId]) {
            views[viewerId] = true;
            await fastify.db.query(
                "UPDATE users SET views = ? WHERE username = ?",
                [JSON.stringify(views), username]
            );
        }

        const viewsCount = Object.keys(views).length;

        // ---------------- AJAX ----------------

        const hasNext = (page * limit) < pasteCount;
        const hasPrev = page > 1;

        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
            const html = await fastify.view('profile/table.html', {
                pastes: userPostsList,
                paste_comments_count: pasteCommentsCount,
                has_next: hasNext,
                has_prev: hasPrev,
                page,
                paste_count: pasteCount,
                status: await getStatus(req, sessionUsername),
                color: await getColor(req, sessionUsername),
                statusu: result.status,
                login: result.username,
                logincolor: result.color,
                followers_count: followersCount,
                following_count: followingCount,
                styles: styles
            });

            return {
                html,
                paste_count: pasteCount,
                has_next: hasNext,
                has_prev: hasPrev
            };
        }

        // ---------------- BIO META --------------

        const cleanBio = sanitizeHtml(result.bio, {
            allowedTags: [],
            allowedAttributes: {}
        });

        // ---------------- RENDER ----------------

        return reply.view("profile/index.html", {
            login: result.username,
            logincolor: result.color,
            statusu: result.status,
            userid: result.id,
            joined: result.datejoin,
            avatar: result.avatar,
            banner: result.banner,
            bio: result.bio,
            cleanBio: cleanBio,
            paste_count: pasteCount,
            pastes: userPostsList,
            comments: totalComments,
            paste_comments_count: pasteCommentsCount,
            username: sessionUsername,
            has_next: hasNext,
            has_prev: hasPrev,
            page,
            formatted_date: formattedDate,
            is_following: isFollowing,
            followers_count: followersCount,
            following_count: followingCount,
            profile_comments: profileComments,
            profile_comments_count: profileCommentsCount,
            banned: result.ban === 1,
            banned_reason: result.banreason || "",
            badges,
        });
    });
    
    fastify.get('/user/:username/avatar', async (req, reply) => {
        const { username } = req.params

        const [rows] = await fastify.db.query(
            'SELECT avatar, ban FROM users WHERE username = ?',
            [username]
        )

        const user = rows?.[0]

        if (!user || user.ban === 1) {
            const filePath = path.join(__dirname, '../static/default.jpg')
            reply.type('image/jpeg')
            return fs.createReadStream(filePath)
        }

        const avatar = user.avatar

        if (!avatar) {
            const filePath = path.join(__dirname, '../static/default.jpg')
            reply.type('image/jpeg')
            return fs.createReadStream(filePath)
        }

        const filePath = path.join(__dirname, '../cdn/avatars', avatar)

        if (!fs.existsSync(filePath)) {
            const filePath = path.join(__dirname, '../static/default.jpg')
            reply.type('image/jpeg')
            return fs.createReadStream(filePath)
        }

        reply.type(mime.lookup(filePath) || 'image/jpeg')
        return fs.createReadStream(filePath)
    });
    fastify.get('/user/:username/banner', async (req, reply) => {
        const { username } = req.params

        const [rows] = await fastify.db.query(
            'SELECT banner, ban FROM users WHERE username = ?',
            [username]
        )

        const user = rows?.[0]

        if (!user || user.ban === 1) {
            return reply.code(404).send({ error: 'Banner not found' })
        }

        const banner = user.banner

        if (!banner) {
            return reply.code(404).send({ error: 'Banner not found' })
        }

        const filePath = path.join(__dirname, '../cdn/banners', banner)

        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({ error: 'Banner file not found' })
        }

        reply.type(mime.lookup(filePath) || 'image/jpeg')
        return fs.createReadStream(filePath)
    });
}