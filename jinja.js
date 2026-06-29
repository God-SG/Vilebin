import nunjucks from 'nunjucks';
import path from 'path';
import { URLSearchParams } from 'url';
import { fileURLToPath } from 'url';
import * as config from './config.js';

function wrap(obj) {
    if (obj && typeof obj === 'object') {
        return new Proxy(obj, {
            get(target, prop) {
                if (prop === 'get') {
                    return key => wrap(target[key] ?? {});
                }
                return target[prop];
            }
        });
    } else {
        return obj;
    }
}

export class Jinja2Templates {
    constructor(templatePath) {
        this.env = nunjucks.configure(templatePath, {
            autoescape: true,
            noCache: false,
            watch: false
        });

        this.env.addGlobal('make_request', (req) => ({
            path: {
                startswith: prefix => req.url.startsWith(prefix),
                endswith: suffix => req.url.endsWith(suffix),
                contains: s => req.url.includes(s),
                value: req.url
            },
            url: req.url,
            method: req.method
        }));

        this.env.addGlobal('url_for', (routeName, params = {}) => {
            let url = `/${routeName}`;
            const query = new URLSearchParams(params).toString();
            if (query) url += `?${query}`;
            return url;
        });

        this.env.addGlobal('styles', {
            get: key => wrap(config.styles[key] ?? {})
        });
    }

    async render(template, context = {}) {
        return new Promise((resolve, reject) => {
            this.env.render(template, context, (err, res) => {
                if (err) reject(err);
                else resolve(res);
            });
        });
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const templates = new Jinja2Templates(path.join(__dirname, 'templates'));