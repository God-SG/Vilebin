export const statusHierarchy = {
    admin: 1,
    manager: 2,
    mod: 3,
    council: 4,
    founder: 5,
    clique: 6,
    rich: 7,
    criminal: 8,
    vip: 9,
    user: 10,
    anonymous: 11
};

export class StylesWrapper {
    constructor(stylesObj = {}) {
        this.stylesObj = stylesObj;
    }

    get(key) {
        return this.stylesObj[key] || null;
    }
}

export let styles = new StylesWrapper({});

function wrapObj(obj) {
    if (obj && typeof obj === 'object') {
        return new Proxy(obj, {
            get(target, prop) {
                if (prop === 'get') {
                    return key => (target[key] !== undefined && target[key] !== null)
                        ? wrapObj(target[key])
                        : null;
                }
                return target[prop];
            }
        });
    } else {
        return obj;
    }
}
export async function loadStyles(fastify) {
    try {
        const [rows] = await fastify.db.query('SELECT * FROM styles');
        const obj = {};
        for (const row of rows) {
            obj[row.role] = row;
        }
        styles = wrapObj(obj);
    } catch (err) {
        fastify.log.error('Error loading styles:', err);
    }
}

export function startStyleReload(fastify, interval = 1000) {
    setInterval(() => {
        loadStyles(fastify).catch(err => fastify.log.error(err));
    }, interval);
}

export const captchaKey = '0x4......'; // CAPTCHA CF

export const telegramBot = '8474887042:....'; // TELEGRAM BOT TOKEN FOR LOGS (STAFF CHAT)
export const telegramBotManage = '8563194816:....'; // TELEGRAM BOT TOKEN FOR MANAGE
export const telegramBotAccess = [12312]; // OWNER IDS