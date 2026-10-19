# Weirdhost 自动续期(GitHub Actions + Playwright)

定时用无头浏览器登录 https://hub.weirdhost.xyz,打开服务器页面并点击"续期"按钮,可选 Telegram 通知,每次运行都会保存截图。

## 使用步骤

1. 新建一个**私有**仓库,把本目录所有文件(含 `.github/workflows/renew.yml`)推上去。
2. 仓库 **Settings → Secrets and variables → Actions** 添加 Secrets:

| 名称 | 必填 | 说明 |
|---|---|---|
| `WEIRDHOST_COOKIE` | 二选一 | 浏览器登录后导出的 Cookie(Cookie-Editor 导出 JSON,或 `a=b; c=d` 字符串)。推荐,可绕过验证码 / OAuth 登录 |
| `WEIRDHOST_EMAIL` / `WEIRDHOST_PASSWORD` | 二选一 | 账号密码登录(站点有验证码或第三方登录时不可用) |
| `WEIRDHOST_SERVER_URL` | 建议 | 你的服务器详情页完整 URL(续期按钮所在页面);不填则打开首页 |
| `WEIRDHOST_LOGIN_URL` | 否 | 登录页 URL,默认首页 |
| `PROXY_NODE` | 否 | 代理节点链接,支持 `vless://`(含 Reality / WS / gRPC / TLS)、`vmess://`、`trojan://`、`ss://`、`socks5://`、`http://`。workflow 会下载 sing-box 在本地起 SOCKS5(127.0.0.1:1080),浏览器走它;启动后先测连通性,不通则直接失败并打印 sing-box 日志。配置后优先于 `PROXY_SERVER` |
| `PROXY_SERVER` | 否 | 代理地址,支持 `http://` `https://` `socks5://`,可带账号密码:`http://user:pass@host:port`。不填则直连 |
| `PROXY_USERNAME` / `PROXY_PASSWORD` | 否 | 代理账号密码(不想写进 URL 时单独填) |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | 否 | Telegram 通知 |

3. (可选)**Variables** 中添加 `RENEW_BUTTON_TEXT`(正则),默认匹配 `renew|extend|add time|续期|续费|연장|갱신|시간 추가`。
4. 进入 **Actions → Weirdhost Auto Renew → Run workflow** 手动跑一次。

## 第一次跑失败怎么办

脚本找不到按钮时,日志会打印页面上所有按钮/链接文字,同时 Artifacts 里有截图:

- 按日志里真实的按钮文字设置 `RENEW_BUTTON_TEXT`;
- 如果有二次确认弹窗且没被点到,设置 `CONFIRM_BUTTON_TEXT`;
- 截图是登录页 → Cookie 失效,重新导出;
- 截图是 Cloudflare 验证 → 配置 `PROXY_SERVER`,或改在自己的机器 / VPS 上用 cron 运行同一脚本。

## 注意

- 定时周期(`cron`)请按站点实际的续期窗口调整,过于频繁没有意义。
- Cookie 属于登录凭证,务必放在 Secrets 里,不要提交到仓库。
- 使用前请确认站点规则允许自动化操作。
