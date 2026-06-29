// IMPORTS
import 'dotenv/config'

import 'module-alias/register';

import path from 'path'
import fs from 'fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyView from '@fastify/view'
import nunjucks from 'nunjucks'
import { fileURLToPath, pathToFileURL } from 'url'

import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';

import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress'

import { loadStyles, startStyleReload } from './config.js';

import db from './db.js';
import { redis } from './middlewares/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
    logger: {
        level: 'info'
    },
    bodyLimit: 100 * 1024 * 1024
});

// await fastify.register(rateLimit, {
//     max: 300,
//     timeWindow: '1 minute',
//     errorResponseBuilder: (req, context) => ({
//         statusCode: 429,
//         error: 'Too Many Requests',
//         message: `Rate limit exceeded, retry in ${context.after}`
//     })
// });

await fastify.register(compress, { 
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate']
})

await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET,
  parseOptions: {}
});
fastify.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});
fastify.register(formbody);

fastify.decorate('db', db);
fastify.decorate('redis', redis);

// LOAD STYLES
await loadStyles(fastify);
startStyleReload(fastify, 5000);

// TEMPLATES
fastify.register(fastifyView, {
  engine: { nunjucks },
  root: path.join(__dirname, 'templates'),
  layout: false,
  options: {
    autoescape: true
  }
})

// STATIC
fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'static'),
    prefix: '/static/'
});

// CDN
fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'cdn'),
    prefix: '/cdn/',
    decorateReply: false
});

// WEB SOCKET
import fastifyWs from '@fastify/websocket'
await fastify.register(fastifyWs)

import chatPlugin from './websocket.js'
await fastify.register(chatPlugin)

// CONNECT ROUTES
async function autoRegister(dir, fastify, prefix = '') {
    if (!fs.existsSync(dir)) return;

    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            await autoRegister(fullPath, fastify, prefix);
        } else if (file.endsWith('.js')) {
            const moduleUrl = pathToFileURL(fullPath).href;
            const route = await import(moduleUrl);

            if (route.default) {
                if (prefix) {
                    fastify.register(route.default, { prefix });
                } else {
                    route.default(fastify);
                }
            }
        }
    }
}

const folders = [
    { path: path.join(__dirname, 'middlewares'), prefix: '' },
    { path: path.join(__dirname, 'api'), prefix: '/api' },
    { path: path.join(__dirname, 'admin'), prefix: '/admin' },
    { path: path.join(__dirname, 'council'), prefix: '/council' },
    { path: path.join(__dirname, 'pages'), prefix: '' },
    { path: path.join(__dirname, 'routers'), prefix: '' },
];

for (const folder of folders) {
    await autoRegister(folder.path, fastify, folder.prefix);
}

// ERRORS
fastify.setErrorHandler((error, req, reply) => {
    const status = error.statusCode || 500;

    if (status === 429) {
        return reply.status(429).view('errors/429.html', { url: req.url });
    }

    if (status === 500) {
        fastify.log.error(error);
        return reply.status(500).view('errors/500.html', { url: req.url });
    }

    reply.status(status).send({ statusCode: status, message: error.message });
});

fastify.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET') {
        return reply.code(404).send({ error: 'Not found' });
    }

    return reply.redirect('/');
});

// START
fastify.listen({
    port: 8001,
    host: '0.0.0.0'
}, (err, address) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
    fastify.log.info(`Server running at ${address}`);
});