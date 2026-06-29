import { styles, captchaKey, telegramBot } from './config.js';

export async function getStatus(req, username) {
  const [rows] = await req.server.db.query(
    "SELECT status FROM users WHERE username = ?",
    [username]
  );
  return rows.length ? rows[0].status : 'anonymous';
}

export async function getColor(req, username) {
  const [rows] = await req.server.db.query(
    "SELECT color FROM users WHERE username = ?",
    [username]
  );
  return rows.length ? rows[0].color : "";
}

export async function getId(req, username) {
  const [rows] = await req.server.db.query(
    "SELECT id FROM users WHERE username = ?",
    [username]
  );
  return rows.length ? rows[0].id : null;
}

export async function get2faStatus(req, username) {
  const [rows] = await req.server.db.query(
    "SELECT totp_enabled FROM users WHERE username = ?",
    [username]
  );
  return rows.length ? !!rows[0].totp_enabled : false;
}

export async function checkCaptcha(cf_turnstile_response) {
    const data = new URLSearchParams();
    data.append('secret', captchaKey);
    data.append('response', cf_turnstile_response);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: data,
        timeout: 10000
    });

    const result = await response.json();
    return !!result.success;
}

export function getIP(req) {
    if (req.headers['cf-connecting-ip']) {
        return req.headers['cf-connecting-ip'];
    } else if (req.headers['x-forwarded-for']) {
        return req.headers['x-forwarded-for'].split(',')[0].trim();
    } else {
        return req.ip || req.socket.remoteAddress;
    }
}

const activeViewBots = new Set();
const runningLocks = new Map();
export function incrementViews(fastify, pasteTitle) {
    if (activeViewBots.has(pasteTitle)) return;

    activeViewBots.add(pasteTitle);

    const maxViews = Math.floor(Math.random() * (220 - 80 + 1)) + 80;
    let current = 0;

    async function tick() {
        if (current >= maxViews) {
            activeViewBots.delete(pasteTitle);
            runningLocks.delete(pasteTitle);
            return;
        }

        if (runningLocks.get(pasteTitle)) {
            setTimeout(tick, 1000);
            return;
        }

        runningLocks.set(pasteTitle, true);

        try {
            const [result] = await fastify.db.query(
                `UPDATE pastes 
                 SET view = view + 1 
                 WHERE pastname = ? 
                 AND deleted = 0 
                 AND (type = 'public' OR type = 'unlisted')`,
                [pasteTitle]
            );

            if (result.affectedRows === 0) {
                activeViewBots.delete(pasteTitle);
                runningLocks.delete(pasteTitle);
                return;
            }

            current++;

        } catch (err) {
            if (err.code === 'ER_LOCK_WAIT_TIMEOUT') {
                console.log(`Lock timeout, retrying for ${pasteTitle}...`);
                runningLocks.delete(pasteTitle);

                setTimeout(tick, 1000);
                return;
            }

            console.error(err);
        }

        runningLocks.delete(pasteTitle);

        const delay = Math.floor(Math.random() * 15000) + 5000;
        setTimeout(tick, delay);
    }

    tick();
}

export async function getStatusStyle(status) {
    const style = styles?.[status] || {};
    const result = {};

    if (style.rankColor != null) result.rankColor = style.rankColor;
    if (style.rankHighlightColor != null) result.rankHighlightColor = style.rankHighlightColor;
    if (style.rankStyle != null) result.rankStyle = style.rankStyle;
    if (style.suffix != null) result.suffix = style.suffix;

    return result;
}

export async function getStatusStyleChat(status) {
    const style = (styles?.[status]) || {};

    return {
        rankColor: style.rankColor,
        rankHighlightColor: style.rankHighlightColor,
        rankStyle: style.rankStyle,
        suffix: style.suffix
    };
}

export async function addNotify(req, username, message, danger) {
    const conn = await req.server.db.getConnection();

    const now = new Date();
    const moscow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));

    const pad = n => String(n).padStart(2, '0');

    const currentTime =
        `${moscow.getFullYear()}-${pad(moscow.getMonth() + 1)}-${pad(moscow.getDate())} ` +
        `${pad(moscow.getHours())}:${pad(moscow.getMinutes())}:${pad(moscow.getSeconds())}`;

    try {
        await conn.query(
            'INSERT INTO notifications (username, message, date, danger, `read`) VALUES (?, ?, ?, ?, ?)',
            [username, message, currentTime, danger, 'unread']
        );
    } finally {
        conn.release();
    }
}

export async function addBadge(req, username, name, color, fas, priority) {
    const conn = await req.server.db.getConnection();
    try {
        const [rows] = await conn.query('SELECT badges FROM users WHERE username = ?', [username]);
        let badges = rows[0] ? JSON.parse(rows[0].badges) : [];
        if (badges.some(b => b.name === name)) return;

        badges.push({ name, color, fas, priority });
        await conn.query('UPDATE users SET badges = ? WHERE username = ?', [JSON.stringify(badges), username]);
    } finally {
        conn.release();
    }
}

export async function checkBadge(req, username, name) {
    const conn = await req.server.db.getConnection();
    try {
        const [rows] = await conn.query('SELECT badges FROM users WHERE username = ?', [username]);
        const badges = rows[0] ? JSON.parse(rows[0].badges) : [];
        return badges.some(b => b.name === name);
    } finally {
        conn.release();
    }
}

export async function badgeOld5m(app) {
    while (true) {
        const conn = await app.db.getConnection();
        try {
            const [users] = await conn.query('SELECT username, datejoin, badges FROM users');
            for (const user of users) {
                const username = user.username;
                const dateJoin = new Date(user.datejoin + 'Z'); // ensure UTC
                const badges = user.badges ? JSON.parse(user.badges) : [];

                const diffMs = Date.now() - dateJoin.getTime();
                const fiveMonthsMs = 5 * 30 * 24 * 60 * 60 * 1000;

                if (diffMs > fiveMonthsMs && !badges.some(b => b.name === 'Old')) {
                    await addNotify(null, app, username, 
                        'You been with us for over 5 months! Thanks for being part of the community!', 
                        false
                    );

                    badges.push({
                        name: 'Old',
                        color: 'red',
                        fas: 'fa-solid fa-clock',
                        priority: 100
                    });

                    await conn.query('UPDATE users SET badges = ? WHERE username = ?', [JSON.stringify(badges), username]);
                }
            }
        } finally {
            conn.release();
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

export async function addLog(req, type, deys, login) {
    const conn = await req.server.db.getConnection();
    const ip = getIP(req);

    const now = new Date();
    const moscow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));

    const pad = n => String(n).padStart(2, '0');

    const currentTime =
        `${moscow.getFullYear()}-${pad(moscow.getMonth()+1)}-${pad(moscow.getDate())} ` +
        `${pad(moscow.getHours())}:${pad(moscow.getMinutes())}:${pad(moscow.getSeconds())}`;

    try {
        await conn.query(
            'INSERT INTO logs (type, deys, login, date, ipadr) VALUES (?, ?, ?, ?, ?)',
            [type, deys, login, currentTime, ip]
        );
    } finally {
        conn.release();
    }
}

export async function addProgress(req, userId, taskCode, amount = 1) {
    const conn = await req.server.db.getConnection();
    try {
        const [taskRows] = await conn.query(
            'SELECT id, goal, reward, final_date FROM tasks WHERE code = ?',
            [taskCode]
        );
        if (!taskRows.length) throw new Error(`Task '${taskCode}' not found`);

        const task = taskRows[0];
        const nowMsk = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow' });
        if (task.final_date && new Date(task.final_date) <= new Date(nowMsk)) {
            throw new Error(`Task '${taskCode}' is expired`);
        }

        let rewardValue = String(task.reward).trim();
        let numericReward = parseInt(rewardValue);
        const isNumericReward = !isNaN(numericReward);

        const [userTaskRows] = await conn.query(
            'SELECT id, progress, completed FROM user_tasks WHERE user_id = ? AND task_id = ?',
            [userId, task.id]
        );

        let newProgress, completed;
        if (!userTaskRows.length) {
            newProgress = amount;
            completed = newProgress >= task.goal;
            await conn.query(
                'INSERT INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)',
                [userId, task.id, newProgress, completed]
            );
        } else {
            const userTask = userTaskRows[0];
            if (userTask.completed) return;
            newProgress = userTask.progress + amount;
            completed = newProgress >= task.goal;
            await conn.query(
                'UPDATE user_tasks SET progress = ?, completed = ?, last_update = NOW() WHERE id = ?',
                [newProgress, completed, userTask.id]
            );
        }

        if (completed) {
            if (isNumericReward) {
                await conn.query('UPDATE users SET gc = gc + ? WHERE id = ?', [numericReward, userId]);
            } else {
                const [userRows] = await conn.query('SELECT status FROM users WHERE id = ?', [userId]);
                const currentStatus = userRows[0]?.status || 'user';
                if ((statusHierarchy[rewardValue] || 0) > (statusHierarchy[currentStatus] || 0)) {
                    await conn.query('UPDATE users SET status = ? WHERE id = ?', [rewardValue, userId]);
                }
            }
        }
    } finally {
        conn.release();
    }
}

export async function sendTelegram(chatId, message, themeId = 7) {
    const url = `https://api.telegram.org/bot${telegramBot}/sendMessage`;
    const data = new URLSearchParams({
        chat_id: chatId,
        message_thread_id: themeId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: 'true'
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: data,
            timeout: 60000
        });

        if (!response.ok) {
            const text = await response.text();
            console.log(`TELEGRAM LOG | Error: ${response.status} | ${text}`);
        }
    } catch (err) {
        console.log(`TELEGRAM LOG | Exception: ${err.message}`);
    }
}

export async function allowedFile(filename) {
    return filename.includes('.') &&
        ['png', 'jpg', 'jpeg', 'gif'].includes(
            filename.split('.').pop().toLowerCase()
        );
}