import{j as e}from"./jsx-runtime-0DLF9kdB.js";import{c as y,d as f,e as x,f as j,r as n,_ as S,g as a,u as g,M as w,L as k,O as M,S as v}from"./components-CPqbnSvQ.js";/**
 * @remix-run/react v2.17.5
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */let l="positions";function L({getKey:t,...c}){let{isSpaMode:p}=y(),r=f(),h=x();j({getKey:t,storageKey:l});let u=n.useMemo(()=>{if(!t)return null;let s=t(r,h);return s!==r.key?s:null},[]);if(p)return null;let d=((s,m)=>{if(!window.history.state||!window.history.state.key){let o=Math.random().toString(32).slice(2);window.history.replaceState({key:o},"")}try{let i=JSON.parse(sessionStorage.getItem(s)||"{}")[m||window.history.state.key];typeof i=="number"&&window.scrollTo(0,i)}catch(o){console.error(o),sessionStorage.removeItem(s)}}).toString();return n.createElement("script",S({},c,{suppressHydrationWarning:!0,dangerouslySetInnerHTML:{__html:`(${d})(${a(JSON.stringify(l))}, ${a(JSON.stringify(u))})`}}))}function _(){const{apiKey:t}=g();return e.jsxs("html",{lang:"en",children:[e.jsxs("head",{children:[e.jsx("meta",{charSet:"utf-8"}),e.jsx("meta",{name:"viewport",content:"width=device-width,initial-scale=1"}),e.jsx("meta",{name:"shopify-api-key",content:t}),e.jsx("script",{src:"https://cdn.shopify.com/shopifycloud/app-bridge.js"}),e.jsx("link",{rel:"icon",type:"image/png",sizes:"32x32",href:"/favicon-32.png"}),e.jsx("link",{rel:"apple-touch-icon",href:"/apple-touch-icon.png"}),e.jsx("link",{rel:"preconnect",href:"https://cdn.shopify.com/"}),e.jsx("link",{rel:"stylesheet",href:"https://cdn.shopify.com/static/fonts/inter/v4/styles.css"}),e.jsx(w,{}),e.jsx(k,{})]}),e.jsxs("body",{children:[e.jsx(M,{}),e.jsx(L,{}),e.jsx(v,{})]})]})}export{_ as default};
