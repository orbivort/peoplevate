import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(payload: { userId: string; role: string }): string {
  const options: SignOptions = {
    expiresIn: (env.JWT_ACCESS_EXPIRES_IN as unknown as SignOptions['expiresIn']) ?? '1h',
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function signRefreshToken(payload: { userId: string; role: string }): string {
  const options: SignOptions = {
    expiresIn: (env.JWT_REFRESH_EXPIRES_IN as unknown as SignOptions['expiresIn']) ?? '7d',
  };
  // Include a random `jti` so each issued refresh token is unique. Without it,
  // two tokens for the same user/role would sign to identical JWTs and collide
  // on the unique `token_hash` column used for rotation/reuse detection.
  return jwt.sign({ ...payload, jti: generateToken() }, env.JWT_SECRET, options);
}

export function verifyJwt(token: string): { userId: string; role: string } | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as { userId: string; role: string };
  } catch {
    return null;
  }
}

export function addHours(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

export function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
