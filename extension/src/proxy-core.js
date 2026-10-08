/* Proxy is optional and only set from the extension-owned options page after consent. */
(function(root){
  'use strict';
  function parse(raw){
    if(typeof raw!=='string'||raw.length>400)throw new Error('请输入代理地址');
    let u;try{u=new URL(raw.trim());}catch(_){throw new Error('格式应为 http://127.0.0.1:7890、https://主机:端口 或 socks5://主机:端口');}
    if(!['http:','https:','socks5:'].includes(u.protocol))throw new Error('仅支持 HTTP、HTTPS 和 SOCKS5');
    if(u.username||u.password||u.search||u.hash||(u.pathname&&u.pathname!=='/'))throw new Error('不要输入账号密码、订阅链接、路径或查询参数');
    const host=u.hostname;
    if(!/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[a-f0-9:]+\])$/i.test(host))throw new Error('代理主机名不合法');
    const port=Number(u.port)||(u.protocol==='https:'?443:u.protocol==='http:'?80:1080);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口应为 1–65535');
    return {scheme:u.protocol.slice(0,-1),host,port};
  }
  function pac(raw){
    const p=typeof raw==='string'?parse(raw):parse(`${raw.scheme}://${raw.host}:${raw.port}`);
    const directive=({http:'PROXY',https:'HTTPS',socks5:'SOCKS5'})[p.scheme]+' '+p.host+':'+p.port;
    return `function FindProxyForURL(url, host) {\n host = host.toLowerCase();\n var domains = ["bilibili.com", "bilivideo.com", "bilivideo.cn", "bilivideo.net"];\n for (var i=0; i<domains.length; i++) { var d=domains[i]; if (host===d || host.slice(-(d.length+1))==="."+d) return ${JSON.stringify(directive)}; }\n if (/^upos-[a-z0-9-]+\\.akamaized\\.net$/.test(host)) return ${JSON.stringify(directive)};\n return "DIRECT";\n}`;
  }
  const api=Object.freeze({parse,pac});root.__BTR_PROXY_CORE__=api;if(typeof module==='object')module.exports=api;
})(globalThis);
