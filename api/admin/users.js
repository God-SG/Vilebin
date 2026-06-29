import { randomUUID } from 'crypto'

import { getSessionUsername } from "../../middlewares/session.js";
import { getStatus, getId } from "../../utils.js";
import { updatePage } from "../../websocket.js"

import { statusHierarchy } from '../../config.js';


export default function (fastify) {
    fastify.get('/lockAccount', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, type, reason } = req.query
        if (!userID) return reply.send({ success: false, error: 'Missing userID' });

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const ban = type === 'lock' ? 1 : 0
        await fastify.db.query('UPDATE users SET ban = ?, banreason = ? WHERE id = ?', [ban, ban ? reason || null : null, userID])

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, ban ? 'Lock Account' : 'Unlock Account', ban ? reason || null : null, staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/deleteAccount', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, reason } = req.query
        if (!userID) return reply.send({ success: false, error: 'Missing userID' });

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Delete Account', reason || null, staff.id]
        )

        const keys = await fastify.redis.keys('session:*')
        for (const key of keys) {
            const data = await fastify.redis.get(key)
            if (data) {
                const session = JSON.parse(data)
                if (session.username === target.username) {
                    session.active = false
                    await fastify.redis.set(key, JSON.stringify(session))
                }
            }
        }

        await fastify.db.query('DELETE FROM users WHERE id = ?', [userID])

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/setRank', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, rank } = req.query
        if (!userID || !rank) return reply.send({ success: false, error: 'Missing params' })

        if (Number(userID) === 5365 && session_username !== 'Admin') return reply.status(403).send({success: false, error: 'You cannot interact with this user'})

        const staffRanks = ['mod', 'manager', 'admin']
        const allowedRanks = ['default', 'vip', 'criminal', 'rich', 'clique', 'founder','council', 'mod', 'manager', 'admin']
        if (!allowedRanks.includes(rank)) return reply.send({ success: false, error: 'Invalid rank' })
        
        
        if (rank === 'founder' && status !== 'admin') return reply.send({ success: false, error: 'Only admins can assign founder rank' })
        
        if (staffRanks.includes(rank) && status === 'mod') return reply.send({ success: false, error: 'Insufficient permissions' })
        if (rank === 'admin' && status !== 'admin') return reply.send({ success: false, error: 'Insufficient permissions' })

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const dbRank = rank === 'default' ? 'user' : rank
        const fromRank = target.status === 'user' ? 'default' : target.status

        if (target.status === dbRank) {
            return reply.send({ success: false, error: 'User already has this rank' })
        }

        await fastify.db.query('UPDATE users SET status = ? WHERE id = ?', [dbRank, userID])

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Set Rank', JSON.stringify({ from: fromRank, to: rank }), staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/upgradeRank', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, rank } = req.query
        if (!userID || !rank) return reply.send({ success: false, error: 'Missing params' })

        if (Number(userID) === 5365 && session_username !== 'Admin') return reply.status(403).send({success: false, error: 'You cannot interact with this user'})

        const hierarchy = { default: 0, vip: 1, criminal: 2, rich: 3 }
        if (!(rank in hierarchy)) return reply.send({ success: false, error: 'Invalid rank for upgrade' })

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const currentRank = target.status === 'user' ? 'default' : target.status
        const currentLevel = hierarchy[currentRank] ?? -1
        if (hierarchy[rank] <= currentLevel) return reply.send({ success: false, error: 'Rank must be higher than current' })

        await fastify.db.query('UPDATE users SET status = ? WHERE id = ?', [rank, userID])

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Upgrade Rank', JSON.stringify({ from: currentRank, to: rank }), staff.id]
        )

        const rankUsernameChanges = { vip: 1, criminal: 2, rich: 3 }
        await fastify.db.query(
            'UPDATE users SET status = ?, usernamechanges = ? WHERE id = ?',
            [rank, rankUsernameChanges[rank] ?? 0, userID]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/disableAccountTOTP', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, reason } = req.query
        if (!userID) return reply.send({ success: false, error: 'Missing userID' });

        const [[target]] = await fastify.db.query('SELECT id, username, status, totp_enabled FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        if (!target.totp_enabled) return reply.send({ success: false, error: 'TOTP is not enabled' })

        await fastify.db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [userID])

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Disable TOTP', reason || null, staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/resetPassword', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, reason } = req.query
        if (!userID) return reply.send({ success: false, error: 'Missing userID' });

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const code = randomUUID()

        await fastify.redis.set(`reset:${target.username}`, code, { EX: 60 * 60 * 24 })

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Reset Password', reason || null, staff.id]
        )

        return reply.send({ success: true, reset_link: `/reset/${target.username}/${code}` })
    })
    
    fastify.get('/terminateSession', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { sessionID, userID } = req.query
        if (!sessionID || !userID) return reply.send({ success: false, error: 'Missing params' })

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        const keys = await fastify.redis.keys('session:*')
        const userSessions = []
            for (const key of keys) {
                const data = await fastify.redis.get(key)
                if (data) {
                    const session = JSON.parse(data)
                    if (session.username === target.username) {
                        userSessions.push({ key, session })
                    }
                }
            }

        userSessions.sort((a, b) => new Date(a.session.login_at) - new Date(b.session.login_at))
        const idx = parseInt(sessionID) - 1
        if (idx < 0 || idx >= userSessions.length) return reply.send({ success: false, error: 'Session not found' })

        const { key, session } = userSessions[idx]
        if (!session.active) return reply.send({ success: false, error: 'Session already terminated' })

        session.active = false
        await fastify.redis.set(key, JSON.stringify(session))

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Terminated Session', sessionID, staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/changeEmail', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, email, reason } = req.query
        if (!userID) return reply.send({ success: false, error: 'Missing userID' });

        const [[target]] = await fastify.db.query('SELECT id, username, status FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        await fastify.db.query('UPDATE users SET email = ? WHERE id = ?', [email || null, userID])

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Change Email', reason || null, staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/changeUsername', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, username } = req.query
        if (!userID || !username) return reply.send({ success: false, error: 'Missing params' })

        const [[target]] = await fastify.db.query('SELECT id, username, status, datejoin FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        if (username === target.username) return reply.send({ success: false, error: 'Username is the same' })

        const [[existing]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [username])
        if (existing) return reply.send({ success: false, error: 'Username already taken' })

        const old_username = target.username
        const new_username = username

        const updates = [
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
            ['users', 'username'],
        ]
        for (const [table, column] of updates) {
            await fastify.db.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [new_username, old_username])
        }

        const old_safe = old_username.replace(/"/g, '\\"')
        const new_safe = new_username.replace(/"/g, '\\"')
        await fastify.db.query(`
            UPDATE users SET followers = JSON_SET(
                JSON_REMOVE(followers, '$."${old_safe}"'),
                '$."${new_safe}"',
                JSON_EXTRACT(followers, '$."${old_safe}"')
            ) WHERE JSON_CONTAINS_PATH(followers, 'one', '$."${old_safe}"')
        `)

        const [usersRows] = await fastify.db.query(
            `SELECT id, comments FROM users WHERE JSON_SEARCH(comments, 'one', ?, NULL, '$[*].login') IS NOT NULL`,
            [old_username]
        )
        for (const row of usersRows) {
            const data = row.comments ? JSON.parse(row.comments) : []
            for (const c of data) { if (c.login === old_username) c.login = new_username }
            await fastify.db.query('UPDATE users SET comments = ? WHERE id = ?', [JSON.stringify(data), row.id])
        }

        const keys = await fastify.redis.keys('session:*')
        for (const key of keys) {
            const data = await fastify.redis.get(key)
            if (data) {
                const session = JSON.parse(data)
                if (session.username === old_username) {
                    session.username = new_username
                    await fastify.redis.set(key, JSON.stringify(session))
                }
            }
        }

        const [historyCount] = await fastify.db.query('SELECT COUNT(*) as cnt FROM username_history WHERE user_id = ?', [userID])
        if (historyCount[0].cnt === 0) {
            const rawDate = target.datejoin ? target.datejoin.toString().trim() : null
            let parsedDate = new Date()
            if (rawDate) {
                const parts = rawDate.split(' ')[0].split('-')
                parsedDate = parts[0].length === 4
                    ? new Date(rawDate)
                    : new Date(`${parts[2]}-${parts[1]}-${parts[0]} ${rawDate.split(' ')[1] || '00:00:00'}`)
            }
            const dateStr = parsedDate.toISOString().slice(0, 19).replace('T', ' ')
            await fastify.db.query(
                'INSERT INTO username_history (user_id, username, date) VALUES (?, ?, ?)',
                [userID, old_username, dateStr]
            )
        }

        await fastify.db.query(
            'INSERT INTO username_history (user_id, username) VALUES (?, ?)',
            [userID, new_username]
        )

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Change Username', JSON.stringify({ from: old_username, to: new_username }), staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/forceChangeUsername', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.send({ success: false, error: 'Unauthorized' });
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager'].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const { userID, username } = req.query
        if (!userID || !username) return reply.send({ success: false, error: 'Missing params' })

        const [[target]] = await fastify.db.query('SELECT id, username, status, datejoin FROM users WHERE id = ?', [userID])
        if (!target) return reply.send({ success: false, error: 'User not found' });
        if ((statusHierarchy[status] ?? Infinity) >= (statusHierarchy[target.status] ?? Infinity) && session_username !== 'Admin') return reply.status(403).send({ success: false, error: "You cannot make this to selected user" });

        if (username === target.username) return reply.send({ success: false, error: 'Username is the same' })

        const [[existing]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [username])
        if (existing) return reply.send({ success: false, error: 'Username already taken' })

        const old_username = target.username
        const new_username = username

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
        ]
        for (const [table, column] of updates) {
            await fastify.db.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [new_username, old_username])
        }

        const old_safe = old_username.replace(/"/g, '\\"')
        const new_safe = new_username.replace(/"/g, '\\"')
        await fastify.db.query(`
            UPDATE users SET followers = JSON_SET(
                JSON_REMOVE(followers, '$."${old_safe}"'),
                '$."${new_safe}"',
                JSON_EXTRACT(followers, '$."${old_safe}"')
            ) WHERE JSON_CONTAINS_PATH(followers, 'one', '$."${old_safe}"')
        `)

        const [usersRows] = await fastify.db.query(
            `SELECT id, comments FROM users WHERE JSON_SEARCH(comments, 'one', ?, NULL, '$[*].login') IS NOT NULL`,
            [old_username]
        )
        for (const row of usersRows) {
            const data = row.comments ? JSON.parse(row.comments) : []
            for (const c of data) { if (c.login === old_username) c.login = new_username }
            await fastify.db.query('UPDATE users SET comments = ? WHERE id = ?', [JSON.stringify(data), row.id])
        }

        const keys = await fastify.redis.keys('session:*')
        for (const key of keys) {
            const data = await fastify.redis.get(key)
            if (data) {
                const session = JSON.parse(data)
                if (session.username === old_username) {
                    session.username = new_username
                    await fastify.redis.set(key, JSON.stringify(session))
                }
            }
        }

        const [historyCount] = await fastify.db.query('SELECT COUNT(*) as cnt FROM username_history WHERE user_id = ?', [userID])
        if (historyCount[0].cnt === 0) {
            const rawDate = target.datejoin ? target.datejoin.toString().trim() : null
            let parsedDate = new Date()
            if (rawDate) {
                const parts = rawDate.split(' ')[0].split('-')
                parsedDate = parts[0].length === 4
                    ? new Date(rawDate)
                    : new Date(`${parts[2]}-${parts[1]}-${parts[0]} ${rawDate.split(' ')[1] || '00:00:00'}`)
            }
            const dateStr = parsedDate.toISOString().slice(0, 19).replace('T', ' ')
            await fastify.db.query(
                'INSERT INTO username_history (user_id, username, date) VALUES (?, ?, ?)',
                [userID, old_username, dateStr]
            )
        }

        await fastify.db.query(
            'INSERT INTO username_history (user_id, username, note) VALUES (?, ?, ?)',
            [userID, new_username, session_username]
        )

        const [[staff]] = await fastify.db.query('SELECT id FROM users WHERE username = ?', [session_username])
        await fastify.db.query(
            'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
            [userID, 'Force Change Username', JSON.stringify({ from: old_username, to: new_username }), staff.id]
        )

        await updatePage(target.username);

        return reply.send({ success: true })
    })

    fastify.get('/grantPackage', async (req, reply) => {
        const adminUsername = await getSessionUsername(req);
        if (!adminUsername) return reply.code(401).send({ success: false, error: 'Unauthorized' });

        const status = await getStatus(req, adminUsername);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.code(401).send({ success: false, error: 'Unauthorized' });

        const targetID = req.query.userID;
        const pkg = req.query.package;
        const action = req.query.action === '1' ? 1 : 0;

        if (!targetID || pkg !== 'changeUsernameColor') {
            return reply.code(400).send({ success: false, error: 'Invalid parameters' });
        }

        try {
            const [rows] = await fastify.db.query(
                'SELECT username, colorchanges FROM users WHERE id = ?',
                [targetID]
            );

            if (!rows.length) {
                return reply.code(404).send({ success: false, error: 'User not found' });;
            }

            const currentValue = rows[0].colorchanges;

            if (currentValue === action) {
                return reply.send({
                    success: false,
                    error: action === 1 ? 'User already has the package' : 'User does not have the package'
                });
            }

            await fastify.db.query(
                'UPDATE users SET colorchanges = ? WHERE id = ?',
                [action, targetID]
            );

            const [[staff]] = await fastify.db.query(
                'SELECT id FROM users WHERE id = ?',
                [await getId(req, adminUsername)]
            );

            const actionText = action === 1 ? 'Granted Package' : 'Revoked Package';

            await fastify.db.query(
                'INSERT INTO audit_log (user_id, type, data, staff_id) VALUES (?, ?, ?, ?)',
                [targetID, actionText, 'Change Username Color', staff.id]
            );

            await updatePage(rows[0].username);

            return reply.send({ success: true, newValue: action });
        } catch (err) {
            console.error(err);
            return reply.code(500).send({ success: false, error: 'Internal server error' });
        }
    });
}