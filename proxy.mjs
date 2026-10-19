// 把 PROXY_NODE(节点链接)转换成 sing-box 配置,输出到 sing-box.json
// 支持: vless:// vmess:// trojan:// ss:// socks5:// http(s)://
import fs from 'node:fs';

const LISTEN_PORT = Number(process.env.PROXY_LOCAL_PORT || 1080);
const link = (process.env.PROXY_NODE || '').trim();
if (!link) {
  console.error('PROXY_NODE 为空');
  process.exit(1);
}

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function buildTls(q, host, force = false) {
  const security = q.get('security') || '';
  if (!force && security !== 'tls' && security !== 'reality') return undefined;
  const tls = {
    enabled: true,
    server_name: q.get('sni') || q.get('host') || host,
    insecure: q.get('allowInsecure') === '1' || q.get('insecure') === '1',
  };
  if (q.get('alpn')) tls.alpn = q.get('alpn').split(',');
  const fp = q.get('fp');
  if (fp || security === 'reality') tls.utls = { enabled: true, fingerprint: fp || 'chrome' };
  if (security === 'reality') {
    tls.reality = { enabled: true, public_key: q.get('pbk') || '', short_id: q.get('sid') || '' };
  }
  return tls;
}

function buildTransport(q) {
  const type = q.get('type') || 'tcp';
  const path = q.get('path') ? decodeURIComponent(q.get('path')) : '/';
  const host = q.get('host') || undefined;
  if (type === 'ws') {
    const t = { type: 'ws', path };
    if (host) t.headers = { Host: host };
    return t;
  }
  if (type === 'grpc') return { type: 'grpc', service_name: q.get('serviceName') || '' };
  if (type === 'httpupgrade') return { type: 'httpupgrade', path, host };
  return undefined; // tcp
}

function parse(raw) {
  if (raw.startsWith('vmess://')) {
    const j = JSON.parse(b64(raw.slice(8)));
    const q = new URLSearchParams({
      type: j.net || 'tcp',
      path: j.path || '/',
      host: j.host || '',
      security: j.tls === 'tls' ? 'tls' : '',
      sni: j.sni || '',
      fp: j.fp || '',
      alpn: j.alpn || '',
    });
    const o = {
      type: 'vmess',
      tag: 'proxy',
      server: j.add,
      server_port: Number(j.port),
      uuid: j.id,
      alter_id: Number(j.aid || 0),
      security: j.scy || 'auto',
    };
    const tls = buildTls(q, j.add);
    const tr = buildTransport(q);
    if (tls) o.tls = tls;
    if (tr) o.transport = tr;
    return o;
  }

  if (raw.startsWith('ss://')) {
    let body = raw.slice(5).split('#')[0];
    let method, password, server, port;
    if (body.includes('@')) {
      const [userinfo, hostpart] = body.split('@');
      const decoded = userinfo.includes(':') ? decodeURIComponent(userinfo) : b64(userinfo);
      [method, password] = [decoded.slice(0, decoded.indexOf(':')), decoded.slice(decoded.indexOf(':') + 1)];
      const hp = hostpart.split('?')[0];
      [server, port] = [hp.slice(0, hp.lastIndexOf(':')), hp.slice(hp.lastIndexOf(':') + 1)];
    } else {
      const decoded = b64(body.split('?')[0]);
      const m = decoded.match(/^(.+?):(.+)@(.+):(\d+)$/);
      [, method, password, server, port] = m;
    }
    return { type: 'shadowsocks', tag: 'proxy', server, server_port: Number(port), method, password };
  }

  const u = new URL(raw);
  const q = u.searchParams;
  const server = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port);

  switch (u.protocol) {
    case 'vless:': {
      const o = {
        type: 'vless',
        tag: 'proxy',
        server,
        server_port: port,
        uuid: decodeURIComponent(u.username),
        packet_encoding: 'xudp',
      };
      if (q.get('flow')) o.flow = q.get('flow');
      const tls = buildTls(q, server);
      const tr = buildTransport(q);
      if (tls) o.tls = tls;
      if (tr) o.transport = tr;
      return o;
    }
    case 'trojan:': {
      const o = { type: 'trojan', tag: 'proxy', server, server_port: port, password: decodeURIComponent(u.username) };
      o.tls = buildTls(q, server, true);
      const tr = buildTransport(q);
      if (tr) o.transport = tr;
      return o;
    }
    case 'socks5:':
    case 'socks:': {
      const o = { type: 'socks', tag: 'proxy', server, server_port: port, version: '5' };
      if (u.username) {
        o.username = decodeURIComponent(u.username);
        o.password = decodeURIComponent(u.password);
      }
      return o;
    }
    case 'http:':
    case 'https:': {
      const o = { type: 'http', tag: 'proxy', server, server_port: port };
      if (u.username) {
        o.username = decodeURIComponent(u.username);
        o.password = decodeURIComponent(u.password);
      }
      if (u.protocol === 'https:') o.tls = { enabled: true, server_name: server };
      return o;
    }
    default:
      throw new Error(`不支持的协议: ${u.protocol}`);
  }
}

const outbound = parse(link);
const config = {
  log: { level: 'warn' },
  inbounds: [{ type: 'mixed', tag: 'in', listen: '127.0.0.1', listen_port: LISTEN_PORT }],
  outbounds: [outbound, { type: 'direct', tag: 'direct' }],
  route: { final: 'proxy' },
};

fs.writeFileSync('sing-box.json', JSON.stringify(config, null, 2));
console.log(`已生成 sing-box.json (协议: ${outbound.type}, 本地端口: ${LISTEN_PORT})`);
