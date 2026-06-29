import { DateTime } from "luxon";
import { diff_match_patch } from 'diff-match-patch';

import { getSessionUsername } from '../middlewares/session.js';
import { getStatus, getColor } from '../utils.js';

const dmp = new diff_match_patch();
dmp.Diff_Timeout = 0.5;

function buildHighlights(oldText, newText) {
    const diffs = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(diffs);

    let added = '';
    let removed = '';

    for (const [op, text] of diffs) {
        if (op === 1) {
            added += `<highlight>${text}</highlight>`;
        } else if (op === -1) {
            removed += `<highlight>${text}</highlight>`;
        } else {
            added += text;
            removed += text;
        }
    }

    return { added, removed };
}

export default function(fastify) {
    fastify.get('/edits', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!['admin','founder','manager','mod','editor'].includes(status)) return reply.redirect('/home');

        const [editsRows] = await fastify.db.query(`
            SELECT e.id, e.post, e.oldcontent, e.newcontent, e.reason, e.editor, e.date, e.checkdate, e.status,
                   u.color AS editorcolor, u.status AS editorstatus
            FROM edits e
            LEFT JOIN users u ON u.username = e.editor
            WHERE e.status = 'pending'
            ORDER BY e.id DESC
        `);

        const now = DateTime.now().setZone("Europe/Moscow");
        const editorsSet = new Set(editsRows.map(e => e.editor).filter(Boolean));

        const editorColors = {};
        await Promise.all([...editorsSet].map(async editor => {
            editorColors[editor] = await getColor(req, editor);
        }));

        const edits = editsRows.map(edit => {
            let humanDate = edit.date;
            try {
                const dt = DateTime.fromJSDate(new Date(edit.date), { zone: "Europe/Moscow" });
                humanDate = dt.toRelative({ base: now, locale: "en" });
            } catch {}

            return {
                id: edit.id,
                pastname: edit.post,
                oldcontent: edit.oldcontent,
                newcontent: edit.newcontent,
                reason: edit.reason,
                owner: edit.editor,
                ownercolor: editorColors[edit.editor] || edit.editorcolor,
                ownerstatus: edit.editorstatus,
                date: humanDate,
                checkdate: edit.checkdate,
                status: edit.status
            };
        });

        return reply.view('admin/edits/index.html', { edits });
    });

    fastify.get('/edits/:id', async (req, reply) => {
        const editID = req.params.id;

        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!['admin','founder', 'manager', 'mod'].includes(status)) return reply.redirect('/home');

        const [[existingEditRow]] = await fastify.db.query(
            "SELECT * FROM edits WHERE id = ? AND status = 'pending' LIMIT 1",
            [editID]
        );
        if (!existingEditRow) return reply.redirect('/admin/edits');

        const [[resultRow]] = await fastify.db.query(
            `SELECT id, post, post_c, editor, date, oldcontent, newcontent, reason, moderator, checkdate, status
             FROM edits WHERE id = ? AND status='pending' LIMIT 1`,
            [editID]
        );
        if (!resultRow) return reply.redirect('/admin/edits');

        const [[postRow]] = await fastify.db.query(
            "SELECT view FROM pastes WHERE pastname_c = ? LIMIT 1",
            [resultRow.post_c]
        );
        if (!postRow) return reply.redirect('/admin/edits');

        let formattedDate;
        try {
            const d = new Date(resultRow.date);
            formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        } catch {
            formattedDate = resultRow.date;
        }

        const [editsRows] = await fastify.db.query(
            "SELECT * FROM edits WHERE post = ? AND status = 'pending'",
            [resultRow.post]
        );
        const edit = editsRows[0] || null;

        let nextEdit = null;
        if (edit) {
            const [[nextEditRow]] = await fastify.db.query(
                "SELECT id FROM edits WHERE id > ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
                [edit.id]
            );
            if (nextEditRow) {
                nextEdit = nextEditRow.id;
            } else {
                const [[firstEditRow]] = await fastify.db.query(
                    "SELECT id FROM edits WHERE status = 'pending' ORDER BY id ASC LIMIT 1"
                );
                if (firstEditRow) nextEdit = firstEditRow.id;
            }
        }

        const editorLogin = edit ? edit.editor : resultRow.editor;

        const [[memoRow], editorStatus, editorColor] = await Promise.all([
            fastify.db.query(
                "SELECT * FROM pastes_memos WHERE paste_id = ? AND type = 'priority' LIMIT 1",
                [resultRow.id]
            ).then(([rows]) => rows),
            getStatus(req, editorLogin),
            getColor(req, editorLogin)
        ]);

        const oldText = resultRow.oldcontent || '';
        const newText = resultRow.newcontent || '';
        const highlight = buildHighlights(oldText, newText);

        const contents = {
            newContentHighlight: highlight.added,
            currentContentHighlight: highlight.removed,
            newContent: newText,
            currentContent: oldText
        };

        return reply.view('admin/edits/check.html', {
            id: resultRow.id,
            title: resultRow.post,
            editor: {
                login: editorLogin,
                status: editorStatus,
                color: editorColor
            },
            formatted_date: formattedDate,
            oldcontent: resultRow.oldcontent,
            newcontent: resultRow.newcontent,
            reason: existingEditRow.reason,
            moderator: resultRow.moderator,
            checkdate: resultRow.checkdate,
            status: resultRow.status,
            edit: edit,
            nextEdit: nextEdit,
            views: postRow.view,
            activeMemo: Boolean(memoRow),
            contentsJSON: JSON.stringify(contents).replace(/<\/script>/gi, '<\\/script>')
        });
    });
};