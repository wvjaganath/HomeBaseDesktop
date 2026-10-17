/**
 * Manage HomeBase accounts from the PC (there is no sign-up or reset page).
 *
 *   docker compose exec hub node dist/scripts/users.js list
 *   docker compose exec hub node dist/scripts/users.js add <email> "<Name>"
 *   docker compose exec hub node dist/scripts/users.js reset-password <email>
 *   docker compose exec hub node dist/scripts/users.js reset-link <email>
 *
 * Passwords are typed at a hidden prompt (twice), never passed as arguments,
 * so they don't end up in shell history or the process list. Without a
 * terminal (piped input) the first line of stdin is used.
 */
import { AuthService } from '../auth.js';
import { openDb } from '../db.js';
import { loadEnv } from '../env.js';
import { createResetToken, createUser, listUsers, resetPassword, UserAdminError } from '../services/userAdmin.js';

const USAGE = `Usage:
  node dist/scripts/users.js list
  node dist/scripts/users.js add <email> "<Display name>"
  node dist/scripts/users.js reset-password <email>
  node dist/scripts/users.js reset-link <email>     (one-time link, 30 minutes)`;

let pipedLines: string[] | null = null;
async function readPiped(): Promise<string> {
  if (pipedLines === null) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  return pipedLines.shift() ?? '';
}

// Keystrokes that arrived after an Enter (e.g. both passwords pasted at once)
// carry over to the next prompt.
let ttyLeftover = '';

/** Prompt without echoing what's typed. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return readPiped();
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = '';
    const finish = (rest: string): void => {
      ttyLeftover = rest;
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    // Returns true once Enter was seen.
    const feed = (chunk: string): boolean => {
      // Code points are right here: each keystroke is one, and the password is
      // kept exactly as typed.
      const chars = Array.from(chunk);
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i] ?? '';
        if (ch === '\r' || ch === '\n') {
          finish(chars.slice(i + 1).join('').replace(/^\n/, ''));
          resolve(value);
          return true;
        }
        if (ch === '\u0003') {
          // Ctrl+C
          finish('');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
      return false;
    };
    const onData = (chunk: string): void => {
      feed(chunk);
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const pending = ttyLeftover;
    ttyLeftover = '';
    stdin.on('data', onData);
    if (!feed(pending)) stdin.resume();
  });
}

async function newPassword(): Promise<string> {
  const first = await askHidden('New password (10+ characters): ');
  if (!process.stdin.isTTY) return first;
  const second = await askHidden('Type it again: ');
  if (first !== second) throw new UserAdminError('The passwords didn’t match. Nothing was changed.');
  return first;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const env = loadEnv();
  const db = openDb(env.dbPath);
  const auth = new AuthService(db, env);
  try {
    if (cmd === 'list' && args.length === 0) {
      const users = listUsers(db);
      if (users.length === 0) console.log('No accounts yet.');
      for (const u of users) {
        console.log(`${u.email.padEnd(32)} ${u.displayName.padEnd(20)} created ${u.createdAt.slice(0, 10)}  ${u.activeSessions} signed-in session(s)`);
      }
    } else if (cmd === 'add' && args.length === 2) {
      const [email = '', displayName = ''] = args;
      const user = await createUser(db, auth, { email, displayName, password: await newPassword() });
      console.log(`Created ${user.email} (${user.displayName}). Sign in with it in the app or the browser.`);
    } else if (cmd === 'reset-password' && args.length === 1) {
      const [email = ''] = args;
      const ended = await resetPassword(db, auth, email, await newPassword());
      console.log(`Password changed for ${email.toLowerCase()}. Signed out of ${ended} session(s); sign in again with the new password.`);
    } else if (cmd === 'reset-link' && args.length === 1) {
      const [email = ''] = args;
      const { token, expiresAt } = createResetToken(db, auth, email);
      console.log(`One-time reset link for ${email.toLowerCase()} (works once, until ${new Date(expiresAt).toLocaleTimeString()}):\n`);
      console.log(`  https://<your hub address>/#/reset?t=${token}\n`);
      console.log('Replace <your hub address> with what you type in the browser, e.g. 192.168.1.20:8443.');
      console.log('Treat it like a password: anyone with it can set a new password for this account.');
    } else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof UserAdminError) {
      console.error(err.message);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    db.close();
  }
}

await main();
