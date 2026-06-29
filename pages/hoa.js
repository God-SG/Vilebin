import sanitizeHtml from 'sanitize-html'

import fs from "fs";
import path from "path";

export default function(fastify) {
    fastify.get('/hoa', async (req, reply) => {
        const [rows] = await fastify.db.query(`
            SELECT id, title, image, description
            FROM hoa
            ORDER BY id DESC
        `);

        const hoa_data = rows.map(post => ({
                id: post.id,
                title: sanitizeHtml(post.title, { 
                    allowedTags: [], 
                    allowedAttributes: {} 
                }),
            image: post.image,
            description: sanitizeHtml(post.description, {
                allowedTags: ['a', 'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
                allowedAttributes: {
                    a: ['href', 'target', 'rel', 'style']
                },
                allowedSchemes: ['http', 'https', 'mailto'],
                transformTags: {
                    'a': sanitizeHtml.simpleTransform('a', {
                        target: '_blank',
                        rel: 'noopener noreferrer'
                    })
                }
            })
        }));

        return reply.view('hoa.html', {
            hoa_data
        });
    });

    fastify.get('/hoa/:id', async (req, reply) => {
        const { id } = req.params

        const [rows] = await fastify.db.query(
            `SELECT image FROM hoa WHERE id=?`,
            [id]
        )

        const HOA_DIR = path.join(process.cwd(), "cdn", "hoa");

        if (!rows.length || !rows[0].image) {
            return reply.code(404).send();
        }

        const filePath = path.join(HOA_DIR, rows[0].image);

        if (!fs.existsSync(filePath)) {
            return reply.code(404).send();
        }

        return reply.sendFile(rows[0].image, HOA_DIR);
    })
}