import{c as n}from"./app-DfH0pUtL.js";/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=n("Target",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]]),l=[{key:"province",share:.7,feeKey:"default_fee"},{key:"capital",share:.25,feeKey:"capital_fee"},{key:"special",share:.05,feeKey:"special_fee"}];function i(o,e={}){const s=Number(o||0);return s<=0?[]:l.map(a=>{const c=Number((e==null?void 0:e[a.feeKey])||0);if(!c)return null;const t=s*a.share,r=t/c;return{...a,fee:c,targetAmount:t,exactSessions:r,sessions:r>0?Math.max(1,Math.ceil(r)):0}}).filter(Boolean)}export{y as T,i as b};
