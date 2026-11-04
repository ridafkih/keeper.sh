const GOOGLE_REGIONAL_TLDS = [
  "ad", "ae", "com.af", "com.ag", "al", "am", "co.ao", "com.ar", "as", "at", "com.au", "az", "ba",
  "com.bd", "be", "bf", "bg", "com.bh", "bi", "bj", "com.bn", "com.bo", "com.br", "bs", "bt",
  "co.bw", "by", "com.bz", "ca", "cd", "cf", "cg", "ch", "ci", "co.ck", "cl", "cm", "cn", "com.co",
  "co.cr", "com.cu", "cv", "com.cy", "cz", "de", "dj", "dk", "dm", "com.do", "dz", "com.ec", "ee",
  "com.eg", "es", "com.et", "fi", "com.fj", "fm", "fr", "ga", "ge", "gg", "com.gh", "com.gi", "gl",
  "gm", "gr", "com.gt", "gy", "com.hk", "hn", "hr", "ht", "hu", "co.id", "ie", "co.il", "im",
  "co.in", "iq", "is", "it", "je", "com.jm", "jo", "co.jp", "co.ke", "com.kh", "ki", "kg", "co.kr",
  "com.kw", "kz", "la", "com.lb", "li", "lk", "co.ls", "lt", "lu", "lv", "com.ly", "co.ma", "md",
  "me", "mg", "mk", "ml", "com.mm", "mn", "com.mt", "mu", "mv", "mw", "com.mx", "com.my", "co.mz",
  "com.na", "com.ng", "com.ni", "ne", "nl", "no", "com.np", "nr", "nu", "co.nz", "com.om",
  "com.pa", "com.pe", "com.pg", "com.ph", "com.pk", "pl", "pn", "com.pr", "ps", "pt", "com.py",
  "com.qa", "ro", "ru", "rw", "com.sa", "com.sb", "sc", "se", "com.sg", "sh", "si", "sk", "com.sl",
  "sn", "so", "sm", "sr", "st", "com.sv", "td", "tg", "co.th", "com.tj", "tl", "tm", "tn", "to",
  "com.tr", "tt", "com.tw", "co.tz", "com.ua", "co.ug", "co.uk", "com.uy", "co.uz", "com.vc",
  "co.ve", "co.vi", "com.vn", "vu", "ws", "rs", "co.za", "co.zm", "co.zw", "cat",
] as const;

const googleTagManagerHost = "https://www.googletagmanager.com";

const googleRegionalHosts = GOOGLE_REGIONAL_TLDS.map((tld) => `https://*.google.${tld}`);

const googleTagScriptHosts = [
  googleTagManagerHost,
  "https://www.googleadservices.com",
  "https://www.google.com",
  "https://googleads.g.doubleclick.net",
  "https://ad.doubleclick.net",
  "https://pagead2.googlesyndication.com",
];

const googleTagImageHosts = [
  googleTagManagerHost,
  "https://*.google-analytics.com",
  "https://*.google.com",
  "https://*.g.doubleclick.net",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://pagead2.googlesyndication.com",
  "https://ad.doubleclick.net",
  "https://www.google.com",
  ...googleRegionalHosts,
];

const googleTagConnectHosts = [
  googleTagManagerHost,
  "https://*.google-analytics.com",
  "https://*.google.com",
  "https://*.g.doubleclick.net",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://pagead2.googlesyndication.com",
  "https://ad.doubleclick.net",
  "https://www.google.com",
  ...googleRegionalHosts,
];

const googleTagFrameHosts = [googleTagManagerHost];

export {
  googleTagConnectHosts,
  googleTagFrameHosts,
  googleTagImageHosts,
  googleTagScriptHosts,
};
