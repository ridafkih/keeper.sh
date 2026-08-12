import { CONSENT_COOKIE } from "./analytics";
import { GDPR_COOKIE, GDPR_COOKIE_MAX_AGE, GDPR_ENDPOINT, GDPR_PROMISE_KEY } from "./gdpr-consent";
import { SESSION_COOKIE } from "./session-cookie";

const clientStateScript = [
  "(function(){",
  'var c="; "+document.cookie;',
  'var has=function(p){return c.indexOf("; "+p)>-1};',
  "var r=document.documentElement;",
  `r.setAttribute("data-session",has("${SESSION_COOKIE}")?"authed":"anon");`,
  `var chose=has("${CONSENT_COOKIE}=granted")||has("${CONSENT_COOKIE}=denied");`,
  `var known=has("${GDPR_COOKIE}=1")||has("${GDPR_COOKIE}=0");`,
  `if(chose||has("${GDPR_COOKIE}=0")){r.setAttribute("data-consent","resolved");}`,
  "if(known){return;}",
  `window.${GDPR_PROMISE_KEY}=fetch("${GDPR_ENDPOINT}",{headers:{accept:"application/json"}})`,
  ".then(function(res){return res.json()})",
  ".then(function(data){",
  'if(typeof data.gdprApplies!=="boolean"){',
  'throw new Error("Region lookup returned no boolean gdprApplies field.");',
  "}",
  `document.cookie="${GDPR_COOKIE}="+(data.gdprApplies?"1":"0")+"; path=/; max-age=${GDPR_COOKIE_MAX_AGE}; samesite=lax";`,
  'if(!data.gdprApplies&&!chose){r.setAttribute("data-consent","resolved");}',
  "return data.gdprApplies;",
  "});",
  "})();",
].join("");

export { clientStateScript };
