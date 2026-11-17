# UDD 网页版 / 多账号远程访问

`server.js` 现在支持三种运行模式：

| 模式 | 启动方式 | 认证 | 数据目录 |
| --- | --- | --- | --- |
| 桌面版 | Electron 主进程 fork | 无（仅 127.0.0.1） | 项目目录 / 用户「文档」 |
| 单用户网页版 | `UDD_PASS=... node server.js` | HTTP Basic | `UDD_ROOT` |
| 多账号网页版 | `UDD_MULTIUSER=1 node server.js` | 前台注册/登录 | `~/UDD-Data` |

本机当前运行的是**多账号网页版**。

## 快速开始

打开：

```
http://<本机局域网 IP>:8080/login
```

或公网地址（见 `~/Library/Logs/UDD/远程访问地址.txt`）。

1. 点「注册」
2. 填用户名、密码（≥ 8 位）、邀请码
3. 注册成功自动登录，进入自己的文档空间

邀请码获取方式见下一节。注册后左下角有「账号：xxx / 退出」浮层。

## 账号与数据

```
~/UDD-Data/
  accounts.json          账号与邀请码（权限 600，密码只存 scrypt 哈希）
  users/
    <用户名>/            该账号的独立文档空间（文件 API 的沙箱边界）
```

- 每个账号只能读写自己的 `users/<用户名>/`，`../`、绝对路径、符号链接逃逸都会被 403。
- 新账号首次创建时会自动放入一份 `使用说明书.udd`。
- 密码使用 `scrypt(N=16384, r=8, p=1)` + 随机盐，服务端不保存明文。
- 登录状态是 HttpOnly + SameSite=Lax 的会话 Cookie，有效期 30 天；服务重启后需要重新登录。
- 同一浏览器切换账号时，登录页会清空上一个账号的 IndexedDB/localStorage 缓存，避免串数据。

## 个人空间操作

多账号模式下，左侧「仓库」显示为「我的空间」，根目录固定为
`~/UDD-Data/users/<用户名>/`：

- 只能看到和操作自己的目录；路径不可编辑，到达根目录后「上级」按钮隐藏。
- 服务端对每个文件 API 再做一次沙箱校验，直接构造越权路径也会返回 403。
- 仓库栏的「＋文件夹」可在当前目录新建文件夹。
- 网页版新建文档后点「保存」或「另存为」会弹出保存面板：
  选择/新建文件夹 → 填文件名 → 保存到空间；保存后 Ctrl+S 直接写回该文件。
- 同名文件会先询问是否覆盖。
- 桌面版的保存仍使用系统文件对话框，不受影响。

## 邀请码管理

首次以多账号模式启动时，如果没有账号且没有任何邀请码，会自动生成一个并打印在日志：

```bash
tail -n 30 ~/Library/Logs/UDD/web.log
```

手动生成 / 查看 / 改密码：

```bash
cd /Volumes/data1/project/node
node accounts-admin.js list                       # 用户 + 未使用邀请码
node accounts-admin.js invite 3                   # 生成 3 个一次性邀请码
node accounts-admin.js passwd 用户名              # 交互式改密码
node accounts-admin.js passwd 用户名 新密码       # 非交互（会留在 shell 历史里）
```

邀请码默认一次性，注册成功后变为已使用。也可以设置 `UDD_INVITE_CODES=AAA,BBB`
提供可重复使用的邀请码（适合内部测试，不建议长期开启）。

## 本机部署结构

项目源码在 `/Volumes/data1/project/node`，但 launchd 后台进程默认没有非系统卷的
访问权限（会报 `Operation not permitted`）。因此后台服务运行的是用户目录下的副本：

```
~/Library/Application Support/UDD-Web/app/   ← 网页版运行文件
~/UDD-Data/                                  ← 账号与文档数据
```

更新源码后：

```bash
cd /Volumes/data1/project/node
./deploy-web.sh
launchctl kickstart -k gui/$(id -u)/com.udd.web
```

`deploy-web.sh` 同步 `udd-app.html`、`login.html`、`account-ui.js`、`css/`、`js/`、
`server.js`、`accounts-lib.js`、`accounts-admin.js` 和启动脚本。

## 开机自启（launchd）

| 服务 | 作用 | 日志 |
| --- | --- | --- |
| `com.udd.web` | 网页服务器，保持常驻 | `~/Library/Logs/UDD/web.log` |
| `com.udd.tunnel` | 公网隧道，保持常驻 | `~/Library/Logs/UDD/tunnel.log` |

```bash
launchctl print gui/$(id -u)/com.udd.web        # 状态
launchctl kickstart -k gui/$(id -u)/com.udd.web # 重启
launchctl bootout gui/$(id -u)/com.udd.web      # 停止并取消自启
rm ~/Library/LaunchAgents/com.udd.web.plist
```

隧道同理，把 `com.udd.web` 换成 `com.udd.tunnel`。

## 公网访问（Cloudflare 快速隧道）

```bash
./start-tunnel.sh
```

地址会写入 `~/Library/Logs/UDD/远程访问地址.txt`。

- 快速隧道域名**每次重启都会变**。
- 需要固定域名：`cloudflared tunnel login` 后创建命名隧道并绑定自己的域名。
- 流量经过 Cloudflare，TLS 在 Cloudflare 终止；登录密码不要与重要账号相同。
- 不用公网时停掉 `com.udd.tunnel` 即可回到纯局域网模式。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UDD_MULTIUSER` | – | `1` 启用多账号模式 |
| `UDD_DATA_ROOT` | `~/UDD-Data` | 账号与用户空间根目录 |
| `UDD_PORT` | `8080` | 监听端口 |
| `UDD_HOST` | `0.0.0.0`（start-web.sh） | 监听地址 |
| `UDD_INVITE_CODES` | – | 额外可复用邀请码，逗号分隔 |
| `UDD_MAX_UPLOAD_MB` | `1024` | 单次上传上限 |
| `UDD_USER` / `UDD_PASS` | – | 单用户模式的 Basic 认证 |
| `UDD_ROOT` | 项目目录 | 单用户模式的数据目录 |
| `UDD_SANDBOX` | – | 单用户模式 `1` 启用目录沙箱 |

## 安全措施

- 密码 scrypt 哈希 + 随机盐；不存在用户也执行一次 scrypt，降低用户名枚举。
- 登录 10 次/10 分钟、注册 5 次/10 分钟按来源 IP 限流。
- 会话 Cookie：HttpOnly、SameSite=Lax，HTTPS 下自动加 Secure。
- 注册/登录 POST 校验 Origin，配合 SameSite 防 CSRF。
- 每个账号的路径沙箱独立；符号链接逃逸、目录穿越都会被拦截。
- 远程模式不发送 `Access-Control-Allow-Origin: *`。
- 非本机监听且无任何认证时会拒绝启动。
- 旧版单用户的 `~/.udd-web-auth` 在多账号模式下不再使用，可以删除。

## 备份

```bash
# 账号 + 所有用户文档（建议定期）
rsync -a ~/UDD-Data/ /path/to/backup/UDD-Data-$(date +%F)/
```

旧单用户目录 `~/UDD-Web` 不再参与多账号服务；需要的话把里面的 `.udd`
拷到对应账号的 `~/UDD-Data/users/<用户名>/` 即可。

## 微信登录（暂未接入）

微信扫码登录需要：

1. 微信开放平台注册「网站应用」，完成开发者资质认证（约 300 元/次，以官方当前政策为准）
2. 一个已 ICP 备案的固定域名
3. 配置授权回调域名，走 OAuth2 授权码流程

当前 Cloudflare 快速隧道是随机域名、且未备案，无法作为微信回调地址。
可以先用账号密码登录；以后有固定域名和开放平台应用时，在现有会话体系上加一个
`/api/auth/wechat/callback` 换取账号即可，不需要改动用户空间结构。
