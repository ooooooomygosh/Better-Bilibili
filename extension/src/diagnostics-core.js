/* Diagnostic output sanitization. No network, storage or clipboard side effects. */
(function(root){
  'use strict';
  function redact(input) {
    return String(input).slice(0,100000)
      .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
        try {
          const u=new URL(raw);
          if (/(?:^|\.)(?:bilivideo\.com|bilivideo\.cn|akamaized\.net|mcdn\.bilivideo\.cn)$/.test(u.hostname)||/\.(?:m4s|mp4|flv|m3u8|ts)(?:$|[?#])/i.test(u.pathname))return '[媒体地址已隐藏]';
          return u.origin+u.pathname;
        } catch (_) { return '[地址已隐藏]'; }
      })
      .replace(/("(?:cookie|authorization|password|token|access_token|upsig|w_rid)"\s*:\s*)"[^"\n]*"/gi,'$1"[已隐藏]"');
  }
  root.__BTR_DIAGNOSTICS_CORE__=Object.freeze({redact});
  if(typeof module==='object')module.exports=root.__BTR_DIAGNOSTICS_CORE__;
})(globalThis);
