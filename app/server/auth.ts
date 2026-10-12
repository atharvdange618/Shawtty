import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { magicLink } from 'better-auth/plugins';
import { Resend } from 'resend';
import { ROOT_DIR } from './config';

const dbDir = path.join(ROOT_DIR, 'data');
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'auth.db');

const secret =
  process.env.BETTER_AUTH_SECRET ||
  crypto.randomBytes(32).toString('hex');
const baseURL = process.env.BETTER_AUTH_URL || 'https://shawtty.spacebuilder.in';
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFrom = process.env.RESEND_FROM || 'Shawtty <no-reply@luqe.in>';

export const auth = betterAuth({
  database: new DatabaseSync(dbPath),
  secret,
  baseURL,
  trustedOrigins: [
    'http://localhost:3000',
    'https://shawtty.spacebuilder.in',
    'http://shawtty.spacebuilder.in',
    'http://localhost:8000',
  ],
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      console.log(`\n========================================================`);
      console.log(`[AUTH] 🔑 PASSWORD RESET REQUESTED for: ${user.email}`);
      console.log(`[AUTH] 🔗 Reset URL: ${url}`);
      console.log(`========================================================\n`);

      if (resendApiKey) {
        try {
          const resend = new Resend(resendApiKey);
          const { data, error } = await resend.emails.send({
            from: resendFrom,
            to: user.email,
            subject: 'Reset your Shawtty password',
            html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0d12; color: #eceef3; margin: 0; padding: 40px 16px; }
    .card { max-width: 480px; margin: 0 auto; background: #11141b; border: 1px solid #232836; border-radius: 12px; padding: 32px; }
    h1 { font-size: 22px; color: #eceef3; margin: 0 0 12px; font-weight: 500; }
    p { color: #a3a9b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    .btn { display: inline-block; background: #f2d45c; color: #0b0d12 !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .link-box { background: #0b0d12; border: 1px solid #232836; border-radius: 6px; padding: 10px; word-break: break-all; font-size: 12px; color: #58c4dd; margin-top: 14px; }
    .footer { margin-top: 28px; border-top: 1px solid #232836; padding-top: 16px; font-size: 12px; color: #6b7284; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Reset Your Password</h1>
    <p>We received a request to reset your password for Shawtty. Click the button below to choose a new password:</p>
    <div>
      <a href="${url}" class="btn">Reset Password →</a>
    </div>
    <div class="link-box">
      <a href="${url}" style="color: #58c4dd; text-decoration: none;">${url}</a>
    </div>
    <div class="footer">
      If you did not request a password reset, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`,
            text: `Reset your Shawtty password:\n\n${url}\n\nIf you did not request this, please ignore this email.`,
          });

          if (error) {
            console.error('[AUTH] ❌ Resend password reset error:', error.message || error);
          } else {
            console.log('[AUTH] ✅ Resend password reset email sent. ID:', data?.id);
          }
        } catch (err) {
          console.error('[AUTH] ❌ Resend exception:', err);
        }
      } else {
        console.warn('[AUTH] ⚠️ RESEND_API_KEY is not set.');
      }
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        console.log(`\n========================================================`);
        console.log(`[AUTH] ⚡ MAGIC LINK REQUESTED for: ${email}`);
        console.log(`[AUTH] 🔗 Direct Link: ${url}`);
        console.log(`========================================================\n`);

        if (resendApiKey) {
          try {
            const resend = new Resend(resendApiKey);
            const { data, error } = await resend.emails.send({
              from: resendFrom,
              to: email,
              subject: 'Your Shawtty Magic Link ⚡',
              html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0d12; color: #eceef3; margin: 0; padding: 40px 16px; }
    .card { max-width: 480px; margin: 0 auto; background: #11141b; border: 1px solid #232836; border-radius: 12px; padding: 32px; }
    h1 { font-size: 22px; color: #eceef3; margin: 0 0 12px; font-weight: 500; }
    p { color: #a3a9b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    .btn { display: inline-block; background: #f2d45c; color: #0b0d12 !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .link-box { background: #0b0d12; border: 1px solid #232836; border-radius: 6px; padding: 10px; word-break: break-all; font-size: 12px; color: #58c4dd; margin-top: 14px; }
    .footer { margin-top: 28px; border-top: 1px solid #232836; padding-top: 16px; font-size: 12px; color: #6b7284; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign In to Shawtty</h1>
    <p>Click the button below to sign in instantly to your Shawtty account. No password needed.</p>
    <div>
      <a href="${url}" class="btn">Launch Shawtty Studio →</a>
    </div>
    <div class="link-box">
      <a href="${url}" style="color: #58c4dd; text-decoration: none;">${url}</a>
    </div>
    <div class="footer">
      This link expires in 10 minutes. If you did not request this email, you can safely ignore it.
    </div>
  </div>
</body>
</html>`,
              text: `Sign in to Shawtty Studio:\n\n${url}\n\nThis link expires in 10 minutes.`,
            });

            if (error) {
              console.error('[AUTH] ❌ Resend magic link error:', error.message || error);
            } else {
              console.log('[AUTH] ✅ Resend magic link dispatched. ID:', data?.id);
            }
          } catch (err) {
            console.error('[AUTH] ❌ Resend exception:', err);
          }
        } else {
          console.warn('[AUTH] ⚠️ RESEND_API_KEY is not set.');
        }
      },
    }),
  ],
});

export async function initAuth() {
  try {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    console.log('[AUTH] SQLite migrations applied successfully.');
  } catch (err) {
    console.error('[AUTH] Migration error:', err);
  }
}
