import { getSessionUsername, getTwofaSessionUsername, setSession, setTwofaSession, clearSession, clearTwofaSession } from '../middlewares/session.js';
import {addLog, getIP, checkCaptcha } from '../utils.js';

import { promisify } from 'util';
import { scrypt, timingSafeEqual, randomBytes } from 'crypto';

const scryptAsync = promisify(scrypt);

export default function(fastify) {
    // GET
    fastify.get('/login', async (req, reply) => {
        const username = await getSessionUsername(req);
        const username2fa = await getTwofaSessionUsername(req);

        if (username) {
            return reply.redirect('/home');
        }

        if (username2fa) {
            return reply.redirect('/login/two');
        }

        return reply.view('auth/login.html', {
            error: null
        });
    });

    fastify.get('/register', async (req, reply) => {
        const username = await getSessionUsername(req);
        const username2fa = await getTwofaSessionUsername(req);

        if (username) {
            return reply.redirect('/home');
        }

        if (username2fa) {
            return reply.redirect('/login/two');
        }

        return reply.view('auth/register.html', {
            error: null
        });
    });

    fastify.get('/login/two', async (req, reply) => {
        const username = await getSessionUsername(req);
        const username2fa = await getTwofaSessionUsername(req);

        if (username) {
            return reply.redirect('/home');
        }

        if (!username2fa) {
            return reply.redirect('/home');
        }

        return reply.view('auth/2fa.html', {
            verify: true,
            error: null
        });
    });

    fastify.get('/logout', async (req, reply) => {
        const username = await getSessionUsername(req);
        const username2fa = await getTwofaSessionUsername(req);

        if (!username && !username2fa) {
            return reply.redirect('/home');
        }

        if (username) {
            await addLog(req, 'user', 'logout account', username);
            const response = reply.redirect('/home');
            await clearSession(req, response);
            return response;
        }

        if (username2fa) {
            const response = reply.redirect('/home');
            await clearTwofaSession(req, response);
            return response;
        }
    });
    
    // POST
    fastify.post('/login', async (req, reply) => {
        const { username, password, 'cf-recaptcha-response': captcha } = req.body;

        const sessionUser = await getSessionUsername(req);
        const session2fa = await getTwofaSessionUsername(req);

        if (sessionUser) return reply.redirect('/home');
        if (session2fa) return reply.redirect('/login/two');

        if (!(await checkCaptcha(captcha))) {
            return reply.view('auth/login.html', {
                error: 'CAPTCHA verification failed. Please try again.'
            });
        }

        const [rows] = await fastify.db.query(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        const user = rows[0];

        if (!user) {
            return reply.view('auth/login.html', {
                error: 'Invalid credentials. Please try again.'
            });
        }

        const parts = user.password.split('$');
        const params = parts[0].split(':');
        const N = parseInt(params[1]);
        const r = parseInt(params[2]);
        const p = parseInt(params[3]);
        const salt = Buffer.from(parts[1], 'utf8');
        const savedKey = Buffer.from(parts[2], 'hex');
        
        const inputKey = await scryptAsync(password, salt, savedKey.length, {
            N, r, p,
            maxmem: 128 * 1024 * 1024
        });
        if (!timingSafeEqual(savedKey, inputKey)) {
            return reply.view('auth/login.html', {
                error: 'Invalid credentials. Please try again.'
            });
        }

        if (user.ban) {
            const msg = user.banreason
                ? `Your account has been suspended! Reason: ${user.banreason}`
                : 'Your account has been suspended!';

            return reply.view('auth/login.html', {
                error: msg
            });
        }

        if (!user.totp_enabled) {
            await addLog(req, 'user', 'account authorization', user.username);

            await setSession(req, reply, user.username);
            return reply.redirect('/home');
        }

        await addLog(req, 'user', 'first step authorization', user.username);

        await setTwofaSession(req, reply, user.username);
        return reply.redirect('/login/two');
    });

    fastify.post('/register', async (req, reply) => {
        const { username, password, password_confirm, email, 'cf-recaptcha-response': captcha} = req.body;

        const sessionUser = await getSessionUsername(req);
        const session2fa = await getTwofaSessionUsername(req);

        if (sessionUser) return reply.redirect('/home');
        if (session2fa) return reply.redirect('/login/two');

        if (!(await checkCaptcha(captcha))) {
            return reply.view('auth/register.html', {
                error: 'CAPTCHA verification failed. Please try again.'
            });
        }

        if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) {
            return reply.view('auth/register.html', {
                error: 'Username must contain only English letters, numbers, and underscores, and be 1–20 characters long.'
            });
        }

        if ((username || '').toLowerCase() === 'anonymous') {
            return reply.view('auth/register.html', {
                error: 'This nickname is prohibited.'
            });
        }

        if (password !== password_confirm) {
            return reply.view('auth/register.html', {
                error: 'Passwords do not match.'
            });
        }

        const ip = await getIP(req);

        const [ipRows] = await fastify.db.query(
            'SELECT id FROM users WHERE ip_address = ?',
            [ip]
        );

        if (ipRows.length) {
            return reply.view('auth/register.html', {
                error: 'An account is already registered with this IP address.'
            });
        }

        const [userRows] = await fastify.db.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER(?)',
            [username]
        );

        if (userRows.length) {
            return reply.view('auth/register.html', {
                error: 'Username already exists.'
            });
        }

        const N = 16384, r = 8, p = 1;
        const salt = randomBytes(16).toString('hex');
        const derivedKey = await scryptAsync(password, salt, 64, {
            N, r, p,
            maxmem: 128 * 1024 * 1024
        });
        const hashed = `scrypt:${N}:${r}:${p}$${salt}$${derivedKey.toString('hex')}`;

        await fastify.db.query(`
            INSERT INTO users (username, password, ip_address, datejoin, email)
            VALUES (?, ?, ?, NOW(), ?)
        `, [username, hashed, ip, email]);

        await addLog(req, 'user', 'account registration', username);

        await setSession(req, reply, username);
        return reply.redirect('/home');
    });

    // RESET
    fastify.get('/reset/:username/:code', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (session_username) return reply.redirect('/home');

        const { username, code } = req.params

        const storedCode = await fastify.redis.get(`reset:${username}`)
        if (!storedCode || storedCode !== code) return reply.redirect('/home');

        return reply.view('auth/reset.html');
    })
    fastify.post('/reset/:username/:code', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (session_username) return reply.redirect('/home')

        const { username, code } = req.params
        const { NewPassword } = req.body

        const storedCode = await fastify.redis.get(`reset:${username}`)
        if (!storedCode || storedCode !== code) return reply.code(404).send('Invalid or expired reset link.')

        if (!NewPassword) return reply.code(400).send('Password required.')

        await fastify.redis.del(`reset:${username}`)

        const N = 16384, r = 8, p = 1
        const salt = randomBytes(16).toString('hex')
        const derivedKey = await scryptAsync(NewPassword, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 })
        const hashed = `scrypt:${N}:${r}:${p}$${salt}$${derivedKey.toString('hex')}`

        await fastify.db.query('UPDATE users SET password = ? WHERE username = ?', [hashed, username])

        const keys = await fastify.redis.keys('session:*')
        for (const key of keys) {
            const data = await fastify.redis.get(key)
            if (data) {
                const session = JSON.parse(data)
                if (session.username === username) {
                    session.active = false
                    await fastify.redis.set(key, JSON.stringify(session))
                }
            }
        }

        return reply.redirect('/login')
    })
}