import { promisify } from 'util';
import { scrypt, timingSafeEqual, randomBytes } from 'crypto';

import { getSessionUsername } from '../../middlewares/session.js'
import { getStatus, addLog } from '../../utils.js'

const scryptAsync = promisify(scrypt);

const ONE_YEAR = 60 * 60 * 24 * 365;

export default function(fastify) {
    fastify.get('/updateProfile', async (req, reply) => {
        const {
            email = null,
            username = null,
            bio = null,
            currentPassword = null,
            password = null,
            usernameColor = null,
            comments = null
        } = req.query;

        const session_username = await getSessionUsername(req);
        if (!session_username) {
            return reply.send({ success: false, error: 'Unauthorized' });
        }

        const userStatus = await getStatus(req, session_username);
        const fieldsToUpdate = {};

        const [[target]] = await fastify.db.query(
            'SELECT id, username, email, bio, color, colorchanges, usernamechanges, datejoin FROM users WHERE username = ?',
            [session_username]
        );

        if (!target) return reply.send({ success: false, error: 'User not found' });

        if (email !== null) {
            const trimmedEmail = email.trim();
            if (!trimmedEmail) {
                fieldsToUpdate.email = null;
            } else if (
                trimmedEmail.length <= 50 &&
                /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmedEmail)
            ) {
                fieldsToUpdate.email = trimmedEmail;
            } else {
                return reply.send({ success: false, error: 'Invalid email' });
            }
        }

        if (username && username !== target.username) {
            const hasUnlimitedChanges = ['admin', 'manager'].includes(userStatus);
            
            if (!hasUnlimitedChanges && target.usernamechanges <= 0) {
                return reply.send({ success: false, purchase: true, error: 'No username changes available' })
            }

            if (username === target.username) return reply.send({ success: false, error: 'Username is the same' })

            const [[existing]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [username]);
            if (existing) return reply.send({ success: false, error: 'Username already taken' });

            if (!hasUnlimitedChanges) {
                await fastify.db.query('UPDATE users SET usernamechanges = usernamechanges - 1 WHERE id = ?', [target.id])
            }

            const old_username = target.username;
            const new_username = username;

            const updates = [
                ['users', 'username'],
                ['activity', 'username'],
                ['applications', 'username'],
                ['blacklist', 'created_by'],
                ['edits', 'editor'],
                ['edits', 'moderator'],
                ['flags', 'reporter'],
                ['flags', 'moderator'],
                ['logs', 'login'],
                ['mailer', 'author'],
                ['mailer', 'moderator'],
                ['notifications', 'username'],
                ['pastes', 'owner'],
                ['pastes_memos', 'created_by'],
                ['redeems', 'creator'],
                ['pastes_comments', 'owner'],
            ];

            for (const [table, column] of updates) {
                await fastify.db.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [new_username, old_username]);
            }

            const old_safe = old_username.replace(/"/g, '\\"');
            const new_safe = new_username.replace(/"/g, '\\"');
            await fastify.db.query(`
                UPDATE users SET followers = JSON_SET(
                    JSON_REMOVE(followers, '$."${old_safe}"'),
                    '$."${new_safe}"',
                    JSON_EXTRACT(followers, '$."${old_safe}"')
                ) WHERE JSON_CONTAINS_PATH(followers, 'one', '$."${old_safe}"')
            `);

            const [usersRows] = await fastify.db.query(
                `SELECT id, comments FROM users WHERE JSON_SEARCH(comments, 'one', ?, NULL, '$[*].login') IS NOT NULL`,
                [old_username]
            );
            for (const row of usersRows) {
                const data = row.comments ? JSON.parse(row.comments) : [];
                for (const c of data) { if (c.login === old_username) c.login = new_username; }
                await fastify.db.query('UPDATE users SET comments = ? WHERE id = ?', [JSON.stringify(data), row.id]);
            }

            const keys = await fastify.redis.keys('session:*');
            for (const key of keys) {
                const data = await fastify.redis.get(key);
                if (data) {
                    const session = JSON.parse(data);
                    if (session.username === old_username) {
                        session.username = new_username;
                        await fastify.redis.set(key, JSON.stringify(session));
                    }
                }
            }

            const [historyCount] = await fastify.db.query('SELECT COUNT(*) as cnt FROM username_history WHERE user_id = ?', [target.id]);
            if (historyCount[0].cnt === 0) {
                const rawDate = target.datejoin ? target.datejoin.toString().trim() : null;
                let parsedDate = new Date();
                if (rawDate) {
                    const parts = rawDate.split(' ')[0].split('-');
                    parsedDate = parts[0].length === 4
                        ? new Date(rawDate)
                        : new Date(`${parts[2]}-${parts[1]}-${parts[0]} ${rawDate.split(' ')[1] || '00:00:00'}`);
                }
                const dateStr = parsedDate.toISOString().slice(0, 19).replace('T', ' ');
                await fastify.db.query(
                    'INSERT INTO username_history (user_id, username, date) VALUES (?, ?, ?)',
                    [target.id, old_username, dateStr]
                );
            }
            await fastify.db.query('INSERT INTO username_history (user_id, username) VALUES (?, ?)', [target.id, new_username]);

            fieldsToUpdate.username = new_username;
        }

        if (bio !== null) {
            const trimmedBio = bio.trim();
            if (!trimmedBio) {
                fieldsToUpdate.bio = null;
            } else if (!['admin','manager','mod','council'].includes(userStatus) && trimmedBio.length > 50) {
                return reply.send({ success: false, error: 'Bio too long' });
            } else {
                fieldsToUpdate.bio = trimmedBio;
            }
        }

        if (currentPassword && password) {
            if (currentPassword === password) {
                return reply.send({ success: false, error: 'New password cannot be the same as current' });
            }
            if (password.length < 3) {
                return reply.send({ success: false, error: 'Password must be at least 3 characters' });
            }

            const [rows] = await fastify.db.query('SELECT password FROM users WHERE username = ?', [session_username]);
            const user = rows[0];
            if (!user) return reply.send({ success: false, error: 'Incorrect current password' });

            const parts = user.password.split('$');
            const params = parts[0].split(':');
            const N = parseInt(params[1]), r = parseInt(params[2]), p = parseInt(params[3]);
            const salt = parts[1], savedKey = Buffer.from(parts[2], 'hex');
            const inputKey = await scryptAsync(currentPassword, salt, savedKey.length, { N, r, p, maxmem: 128*1024*1024 });
            if (!timingSafeEqual(savedKey, inputKey)) {
                return reply.send({ success: false, error: 'Incorrect current password' });
            }

            const newN = 16384, newR = 8, newP = 1, newSalt = randomBytes(16).toString('hex');
            const derivedKey = await scryptAsync(password, newSalt, 64, { N: newN, r: newR, p: newP, maxmem: 128*1024*1024 });
            const hashed = `scrypt:${newN}:${newR}:${newP}$${newSalt}$${derivedKey.toString('hex')}`;

            const keys = await fastify.redis.keys('session:*');
            for (const key of keys) {
                const sessionDataJson = await fastify.redis.get(key);
                if (sessionDataJson) {
                    const sessionData = JSON.parse(sessionDataJson);
                    if (sessionData.username === session_username) {
                        sessionData.active = false;
                        await fastify.redis.set(key, JSON.stringify(sessionData), 'EX', ONE_YEAR);
                    }
                }
            }

            await addLog(req, 'user', 'change password (settings)', session_username);
            fieldsToUpdate.password = hashed;
        }

        if (usernameColor !== null) {
            const { color, colorchanges } = target;
            if (colorchanges === 0 && !['admin','manager','mod','council'].includes(userStatus)) {
                return reply.send({ success: false, purchase: true, error: 'No color changes available' });
            }
            if (color === usernameColor) return reply.send({ success: false, error: 'Color is already set' });
            const allowedColors = new Set(['', '#BB71E4','#4B2E83','#FEC8D8','#BB1E64','#FFFFFF','#365DDA','#F96D31','#FFFE71','#B83C26','#C5C6D3','#94FAAC','#964B00','#000080','#FF69B4','#FFD580','#601EF9','#30D5C8','#9999FF','#4C4CFF','#FFD700']);
            if (!allowedColors.has(usernameColor.trim())) return reply.send({ success: false, error: 'Invalid color' });
            fieldsToUpdate.color = usernameColor.trim();
        }

        if (Object.keys(fieldsToUpdate).length === 0) {
            return reply.send({ success: false, error: 'Nothing to update' });
        }

        const sets = Object.keys(fieldsToUpdate).map(f => `${f} = ?`).join(', ');
        const values = [...Object.values(fieldsToUpdate), session_username];
        await fastify.db.query(`UPDATE users SET ${sets} WHERE username = ?`, values);

        return reply.send({ success: true, message: 'Profile updated successfully' });
    });
}