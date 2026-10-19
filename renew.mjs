import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://hub.weirdhost.xyz';
const env = process.env;

const SERVER_URL = env.WEIRDHOST_SERVER_URL || BASE;          // 服务器详情页(续期按钮所在页面)
const LOGIN_URL = env.WEIRDHOST_LOGIN_URL || BASE;            // 登录页
const RENEW_RE = new RegExp(env.RENEW_BUTTON_TEXT || 'renew|extend|add time|续期|续费|연장|갱신|시간\\s*추가', 'i');
const CONFIRM_RE = new RegExp(env.CONFIRM_BUTTON_TEXT || '^(confirm|ok|yes|continue|确认|确定|확인|예)$', 'i');
const MAX_RETRY = 3;

fs.mkdirSync('screenshots', { recursive: true });

async function notify(text, photo) {
  console.log('[notify]', text);
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    const api = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}`;
    if (photo && fs.existsSync(photo)) {
      const form = new FormData();
      form.append('chat_id', env.TG_CHAT_ID);
      form.append('caption', text);
      form.append('photo', new Blob([fs.readFileSync(photo)]), 'shot.png');
      await fetch(`${api}/sendPhoto`, { method: 'POST', body: form });
    } else {
      await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text }),
      });
    }
  } catch (e) {
    console.log('Telegram 通知失败:', e.message);
  }
}

// 代理: http://user:pass@host:port / https://... / socks5://host:port
// 也可单独用 PROXY_USERNAME / PROXY_PASSWORD 提供账号密码
// 注意:Chromium 不支持带账号密码的 socks5,需要认证请用 http 代理
function parseProxy() {
  const raw = (env.PROXY_SERVER || env.HTTP_PROXY || env.http_proxy || '').trim();
  if (!raw) return undefined;
  const withScheme = /^[a-z0-9]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const u = new URL(withScheme);
  const proxy = { server: `${u.protocol}//${u.host}` };
  const username = decodeURIComponent(u.username) || env.PROXY_USERNAME;
  const password = decodeURIComponent(u.password) || env.PROXY_PASSWORD;
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  console.log(`使用代理: ${proxy.server}${username ? ' (带认证)' : ''}`);
  return proxy;
}

// 支持两种格式:Cookie-Editor 导出的 JSON 数组 / "a=b; c=d" 字符串
function parseCookies(raw) {
  raw = raw.trim();
  if (raw.startsWith('[')) {
    return JSON.parse(raw).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || 'hub.weirdhost.xyz',
      path: c.path || '/',
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
    }));
  }
  return raw.split(';').filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: 'hub.weirdhost.xyz', path: '/', secure: true };
  });
}

async function loginWithPassword(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const user = page.locator('input[type=email], input[name=email], input[name=username], input[name=user], input[type=text]').first();
  const pass = page.locator('input[type=password]').first();
  await user.fill(env.WEIRDHOST_EMAIL);
  await pass.fill(env.WEIRDHOST_PASSWORD);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.locator('button[type=submit], input[type=submit], button:has-text("Login"), button:has-text("Sign in"), button:has-text("登录"), button:has-text("로그인")').first().click(),
  ]);
  await page.waitForTimeout(3000);
}

async function runOnce(attempt) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    proxy: parseProxy(),
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const shot = (n) => `screenshots/${attempt}-${n}.png`;

  try {
    // 打印出口 IP,确认代理是否生效(失败不影响主流程)
    try {
      await page.goto('https://api.ipify.org', { timeout: 20000 });
      console.log('出口 IP:', (await page.locator('body').innerText()).trim());
    } catch (e) {
      console.log('出口 IP 检测失败:', e.message);
    }

    if (env.WEIRDHOST_COOKIE) {
      await context.addCookies(parseCookies(env.WEIRDHOST_COOKIE));
    } else if (env.WEIRDHOST_EMAIL && env.WEIRDHOST_PASSWORD) {
      await loginWithPassword(page);
    } else {
      throw new Error('请配置 WEIRDHOST_COOKIE,或 WEIRDHOST_EMAIL + WEIRDHOST_PASSWORD');
    }

    await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000); // 给 Cloudflare / SPA 渲染留时间
    await page.screenshot({ path: shot('1-page'), fullPage: true });

    const candidates = page.locator('button, a, [role=button], input[type=button], input[type=submit]').filter({ hasText: RENEW_RE });
    if ((await candidates.count()) === 0) {
      const all = await page.locator('button, a, [role=button]').allInnerTexts();
      console.log('页面上的按钮/链接文字(用来调整 RENEW_BUTTON_TEXT):\n', all.map((t) => t.trim()).filter(Boolean).join(' | '));
      throw new Error('没有找到续期按钮(可能未登录、被 Cloudflare 拦截,或按钮文字不匹配)');
    }

    const btn = candidates.first();
    console.log('点击续期按钮:', (await btn.innerText()).trim());
    await btn.click();
    await page.waitForTimeout(2500);

    // 若弹出二次确认
    const confirm = page.locator('button, [role=button]').filter({ hasText: CONFIRM_RE }).first();
    if (await confirm.isVisible().catch(() => false)) {
      console.log('点击确认按钮');
      await confirm.click();
      await page.waitForTimeout(2500);
    }

    await page.screenshot({ path: shot('2-after'), fullPage: true });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    await notify(`✅ Weirdhost 续期操作已执行\n页面提示: ${body}`, shot('2-after'));
    return true;
  } catch (e) {
    await page.screenshot({ path: shot('error'), fullPage: true }).catch(() => {});
    console.error(`第 ${attempt} 次失败:`, e.message);
    if (attempt === MAX_RETRY) await notify(`❌ Weirdhost 续期失败: ${e.message}`, shot('error'));
    return false;
  } finally {
    await browser.close();
  }
}

for (let i = 1; i <= MAX_RETRY; i++) {
  if (await runOnce(i)) process.exit(0);
  await new Promise((r) => setTimeout(r, 10000));
}
process.exit(1);
