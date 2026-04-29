import{c as l,r as a,j as m}from"./app-B04fo2yp.js";/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=l("Monitor",[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]);/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=l("Moon",[["path",{d:"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",key:"a7tn18"}]]);/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w=l("SunMedium",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 3v1",key:"1asbbs"}],["path",{d:"M12 20v1",key:"1wcdkc"}],["path",{d:"M3 12h1",key:"lp3yf2"}],["path",{d:"M20 12h1",key:"1vloll"}],["path",{d:"m18.364 5.636-.707.707",key:"1hakh0"}],["path",{d:"m6.343 17.657-.707.707",key:"18m9nf"}],["path",{d:"m5.636 5.636.707.707",key:"1xv1c5"}],["path",{d:"m17.657 17.657.707.707",key:"vl76zb"}]]),h="ui_theme_preference",i=["system","light","dark"];function T(){return typeof window>"u"||!window.matchMedia?"light":window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function f(){if(typeof window>"u")return"system";const e=window.localStorage.getItem(h);return i.includes(e)?e:"system"}function g(e,o){typeof document>"u"||(document.documentElement.dataset.uiThemePreference=e,document.documentElement.dataset.uiTheme=o,document.body.dataset.uiThemePreference=e,document.body.dataset.uiTheme=o)}function b(){const[e,o]=a.useState(f),[d,u]=a.useState(T);a.useEffect(()=>{if(typeof window>"u"||!window.matchMedia)return;const t=window.matchMedia("(prefers-color-scheme: dark)"),n=y=>{u(y.matches?"dark":"light")};return u(t.matches?"dark":"light"),t.addEventListener("change",n),()=>t.removeEventListener("change",n)},[]),a.useEffect(()=>{if(typeof window>"u")return;const t=n=>{n.key===h&&o(f())};return window.addEventListener("storage",t),()=>window.removeEventListener("storage",t)},[]);const r=a.useMemo(()=>e==="system"?d:e,[e,d]);a.useEffect(()=>{g(e,r)},[e,r]);const s=a.useCallback(t=>{const n=i.includes(t)?t:"system";o(n),typeof window<"u"&&window.localStorage.setItem(h,n)},[]),c=a.useCallback(()=>{const t=i.indexOf(e),n=i[(t+1)%i.length];s(n)},[s,e]);return{themePreference:e,resolvedTheme:r,isDark:r==="dark",setThemePreference:s,cycleTheme:c}}function x(e){return e==="dark"?"Oscuro":e==="light"?"Claro":"Sistema"}function M(e){return e==="dark"?p:e==="light"?w:k}function v({themePreference:e,onCycle:o,className:d="",labelClassName:u="",iconClassName:r=""}){const s=M(e),c=x(e);return m.jsxs("button",{type:"button",onClick:o,className:d,title:`Tema: ${c}. Toca para cambiar.`,"aria-label":`Tema actual ${c}. Toca para cambiar`,children:[m.jsx(s,{size:16,className:r}),m.jsx("span",{className:u,children:c})]})}export{v as T,b as u};
