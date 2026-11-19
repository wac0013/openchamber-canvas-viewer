// Páginas HTML do navegador (só visualização). O canvas do agente nunca é inserido no documento da
// casca: vai num iframe `srcdoc` com `sandbox="allow-scripts"` (origem opaca), como no painel.

export type ListedCanvas = { rootId: string; title: string; updatedAt: number };

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const BASE_STYLE =
  "body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#111;color:#eee}a{color:#8ab4ff}" +
  "main{max-width:720px;margin:0 auto;padding:24px}li{margin:6px 0}small{color:#999}";

export function indexPage(items: ListedCanvas[]): string {
  const rows = items
    .map((item) => `<li><a href="/s/${encodeURIComponent(item.rootId)}">${escapeHtml(item.title || item.rootId)}</a> <small>${escapeHtml(new Date(item.updatedAt).toISOString())}</small></li>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas</title><style>${BASE_STYLE}</style><main><h1>Canvas</h1><ul>${rows || "<li><small>Nenhum canvas ainda.</small></li>"}</ul></main>`;
}

/**
 * Casca de uma sessão. O script é fixo; o id entra só como JSON escapado. O HTML do agente nunca
 * passa por aqui: vem pronto de `GET /frame` (srcdoc montado no servidor) e vai num iframe sandbox.
 * Estado da visão (filtros, removidos) fica no `localStorage` deste navegador.
 */
export function shellPage(rootId: string): string {
  const id = JSON.stringify(rootId).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas</title>
<style>html,body{margin:0;height:100%;background:#16161a;color:#ececf1;font:13px system-ui,sans-serif}
#bar{display:flex;gap:10px;align-items:center;padding:6px 12px;border-bottom:1px solid #34343c;height:20px}
#bar h1{font-size:13px;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bar a,#bar button{color:#8ab4ff;background:none;border:0;font:inherit;cursor:pointer;text-decoration:none;padding:0}
#bar time{color:#9a9aa5}
#stage{position:relative;height:calc(100% - 33px)}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
iframe.loading{visibility:hidden}
#empty{position:absolute;inset:0;padding:40px 12px;text-align:center;color:#9a9aa5}</style>
<div id="bar"><a href="/">Canvases</a><h1 id="t">Canvas</h1><time id="u"></time><button id="r" hidden>Restaurar</button></div>
<div id="stage"><div id="empty">Carregando…</div></div>
<script>
const id=${id};
const KEY="cv:"+id;
const stage=document.getElementById("stage");
const empty=document.getElementById("empty");
const restore=document.getElementById("r");
let state={filters:[],removed:[]};
try{const v=JSON.parse(localStorage.getItem(KEY)||"null");if(v&&Array.isArray(v.filters)&&Array.isArray(v.removed))state={filters:v.filters.filter(x=>typeof x==="string").slice(0,20),removed:v.removed.filter(x=>typeof x==="string").slice(0,200)};}catch{}
let scroll=0,current=null,pending=null,seq=0;
function syncRestore(){restore.hidden=!(state.filters.length||state.removed.length);}
function save(){try{if(state.filters.length||state.removed.length)localStorage.setItem(KEY,JSON.stringify(state));else localStorage.removeItem(KEY);}catch{}syncRestore();}
function safeUrl(raw){try{const u=new URL(String(raw));return(u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password?u.href:null;}catch{return null;}}
async function load(){
  const mine=++seq;
  let j;
  try{
    const r=await fetch("/frame?session="+encodeURIComponent(id)+"&state="+encodeURIComponent(JSON.stringify({filters:state.filters,removed:state.removed}))+"&scroll="+Math.round(scroll),{credentials:"same-origin"});
    j=await r.json();
  }catch{return;}
  if(mine!==seq||!j||!j.ok)return;
  if(!j.srcdoc){if(current)current.remove();current=null;if(pending)pending.remove();pending=null;empty.textContent="Nenhum canvas ainda nesta conversa.";empty.hidden=false;document.title="Canvas";return;}
  document.title=j.title||"Canvas";
  document.getElementById("t").textContent=j.title||"Canvas";
  document.getElementById("u").textContent=new Date(j.updatedAt).toLocaleTimeString();
  if(pending)pending.remove();
  const f=document.createElement("iframe");
  f.className="loading";
  f.setAttribute("sandbox","allow-scripts");
  f.srcdoc=j.srcdoc;
  pending=f;
  stage.appendChild(f);
}
window.addEventListener("message",(e)=>{
  const fromPending=pending&&e.source===pending.contentWindow;
  const fromCurrent=current&&e.source===current.contentWindow;
  if(!fromPending&&!fromCurrent)return;
  const m=e.data;
  if(!m||typeof m!=="object"||m.cvCanvas!==1)return;
  if(m.k==="doc"&&fromPending){pending.classList.remove("loading");if(current)current.remove();current=pending;pending=null;empty.hidden=true;}
  else if(m.k==="state"&&fromCurrent&&Array.isArray(m.filters)&&Array.isArray(m.removed)){state={filters:m.filters.filter(x=>typeof x==="string").slice(0,20),removed:m.removed.filter(x=>typeof x==="string").slice(0,200)};save();}
  else if(m.k==="scroll"&&fromCurrent&&typeof m.y==="number"&&isFinite(m.y)&&m.y>=0)scroll=m.y;
  else if(m.k==="link"&&fromCurrent){const u=safeUrl(m.url);if(u)window.open(u,"_blank","noopener,noreferrer");}
});
restore.addEventListener("click",()=>{state={filters:[],removed:[]};save();load();});
syncRestore();
load();
const es=new EventSource("/events");
es.onmessage=(e)=>{try{if(JSON.parse(e.data).rootId===id)load();}catch{}};
</script>`;
}
