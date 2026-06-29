import { createClient } from 'redis';
import crypto from 'crypto';

import { getIP } from '../utils.js'

const SESSION_COOKIE_NAME = 'session';
const TWOFA_SESSION_COOKIE_NAME = 'twofa_session';
const ONE_YEAR = 60 * 60 * 24 * 365;
const ONE_DAY = 60 * 60 * 24;

export const redis = createClient({ 
    socket: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT) },
    password: process.env.REDIS_PASSWORD
});
await redis.connect();

export async function setSession(req, reply, username) {
  const sessionData = {
    username,
    login_at: new Date().toISOString(),
    first_seen: new Date().toISOString(),
    ip: await getIP(req),
    active: true
  };
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  await redis.setEx(`session:${sessionToken}`, ONE_YEAR, JSON.stringify(sessionData));

  reply
    .setCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ONE_YEAR,
      path: '/'
    });
}

export async function getSessionUsername(req) {
  const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;
  
  const data = await redis.get(`session:${sessionToken}`);
  if (!data) return null;
  
  const sessionData = JSON.parse(data);
  if (!sessionData.active) return null;
  
  return sessionData.username;
}

export async function clearSession(req, reply) {
  const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (sessionToken) {
    await redis.del(`session:${sessionToken}`);
  }
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export async function setTwofaSession(req, reply, username) {
  const sessionData = {
    username,
    login_at: new Date().toISOString(),
    ip: await getIP(req),
    active: true
  };
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  await redis.setEx(`twofa_session:${sessionToken}`, ONE_DAY, JSON.stringify(sessionData));

  reply
    .setCookie(TWOFA_SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ONE_DAY,
      path: '/'
    });
}

export async function getTwofaSessionUsername(req) {
  const sessionToken = req.cookies?.[TWOFA_SESSION_COOKIE_NAME];
  if (!sessionToken) return null;
  
  const data = await redis.get(`twofa_session:${sessionToken}`);
  if (!data) return null;
  
  const sessionData = JSON.parse(data);
  if (!sessionData.active) return null;
  
  return sessionData.username;
}

export async function clearTwofaSession(req, reply) {
  const sessionToken = req.cookies?.[TWOFA_SESSION_COOKIE_NAME];
  if (sessionToken) {
    await redis.del(`twofa_session:${sessionToken}`);
  }
  reply.clearCookie(TWOFA_SESSION_COOKIE_NAME, { path: '/' });
}