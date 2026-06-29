import { DateTime } from 'luxon';

import { getSessionUsername } from '../../middlewares/session.js';
import { checkCaptcha, getIP, addLog, sendTelegram, incrementViews, getStatus } from '../../utils.js';
import { AiCheckPaste } from '../../openai.js';

export default function(fastify) {
    fastify.post('/uploadPaste', async (req, reply) => {
        const parts = {};
        for await (const part of req.parts()) {
            parts[part.fieldname] = part.value;
        }
        
        const { 
            title, 
            content = '', 
            password = null, 
            type = null, 
            'cf-recaptcha-response': cf_recaptcha_response 
        } = parts;
        
        if (!(await checkCaptcha(cf_recaptcha_response))) {
            return reply.send({ success: false, error: 'Captcha verification failed.' });
        }

        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);
        const ip_address = await getIP(req);

        const cleanedTitle = title.replace(/\s/g, '');

        if (!/^[A-Za-z0-9]{3,34}$/.test(cleanedTitle)) {
            return reply.send({ success: false, error: 'Title must be between 3 and 34 characters.' });
        }

        if (content.length < 10 || content.length > 500_000) {
            return reply.send({ success: false, error: 'Content must be between 10 and 500,000 characters.' });
        }
        
        const now = DateTime.now().setZone('Europe/Moscow').toJSDate();

        if (['unlisted', 'private'].includes(type) || password) {
            if (
                (['unlisted', 'private'].includes(type) && !['admin','manager','mod','council','clique','rich','criminal'].includes(status)) ||
                (password && !['admin','manager','mod','council','clique','rich'].includes(status))
            ) {
                return reply.send({ success: false, error: 'Permission denied.' });
            }
        }

        const [blacklistRows] = await fastify.db.query('SELECT word FROM blacklist');
        for (const row of blacklistRows) {
            for (const word of row.word.split(', ')) {
                if (title.toLowerCase().includes(word.toLowerCase()) || content.toLowerCase().includes(word.toLowerCase())) {
                    return reply.send({
                        success: false,
                        error: 'The data is blacklisted, if you try to bypass it you will get a permanent account lock.'
                    });
                }
            }
        }

        const blacklistPromise = fastify.db.query('SELECT word FROM blacklist');
        const existingPromise = fastify.db.query('SELECT 1 FROM pastes WHERE pastname_c = ?', [cleanedTitle]);
        const lastPromise = fastify.db.query('SELECT created_at FROM pastes WHERE ip = ? ORDER BY created_at DESC LIMIT 1', [ip_address]);
        const maxIdPromise = fastify.db.query('SELECT MAX(id) as maxId FROM pastes');

        const [[blacklistRowsParallel], [existingRowsParallel], [lastRowsParallel], [[lastRowParallel]]] = await Promise.all([
            blacklistPromise,
            existingPromise,
            lastPromise,
            maxIdPromise
        ]);

        for (const row of blacklistRowsParallel) {
            for (const word of row.word.split(', ')) {
                if (title.toLowerCase().includes(word.toLowerCase()) || content.toLowerCase().includes(word.toLowerCase())) {
                    return reply.send({
                        success: false,
                        error: 'The data is blacklisted, if you try to bypass it you will get a permanent account lock.'
                    });
                }
            }
        }

        if (existingRowsParallel.length > 0) {
            return reply.send({ success: false, error: 'This title is already taken. Please choose a different title.' });
        }

        if (lastRowsParallel.length > 0) {
            const lastDT = DateTime.fromJSDate(lastRowsParallel[0].created_at).setZone('Europe/Moscow');
            const diffSeconds = (now.getTime() - lastDT.toJSDate().getTime()) / 1000;
            if (diffSeconds < 180 && ['user','anonymous','criminal'].includes(status)) {
                return reply.send({ success: false, error: `Cooldown! Please wait ${Math.ceil(180 - diffSeconds)} seconds.` });
            }
        }

        const finalPassword = password === '' ? null : password;
        const newId = (lastRowParallel.maxId || 0) + 1;

        let finalType = type || 'public';
        
        try {
            const aiResult = await AiCheckPaste(content);
            if (!aiResult.error && aiResult.violation !== null && ['anonymous', 'user'].includes(status)) {
                finalType = 'unlisted';

                await fastify.db.query(`
                    INSERT INTO spam (post, post_c, violation, confidence, reason, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    title,
                    cleanedTitle,
                    aiResult.violation,
                    aiResult.confidence,
                    aiResult.reason,
                    'pending'
                ]);
            }
        } catch (err) {
        }

        await fastify.db.query(`
            INSERT INTO pastes (id, owner, pastname, pastname_c, created_at, view, pin, ip, past, type, password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            newId,
            username || 'Anonymous',
            title,
            cleanedTitle,
            now,
            0,
            false,
            ip_address,
            content,
            finalType,
            finalPassword
        ])

        await addLog(req, 'user', `creating a paste with the title "${title}"`, username || 'anonymous');

        sendTelegram("-1002881608552", `<b>New Paste!</b>\n\nLink - <tg-spoiler>https://vilebin.net/upload/${cleanedTitle}</tg-spoiler>\nType - <b>${type}</b>`);

        if (finalType === 'public' || finalType === 'unlisted') {
            incrementViews(fastify, title);
        }

        return reply.send({ success: true, redirect: `/upload/${cleanedTitle}` });
    });
}