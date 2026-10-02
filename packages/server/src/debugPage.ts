/** Plain-text live event log (milestone M1 acceptance page). */
export const DEBUG_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Clawd Base — debug</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{background:#111;color:#ddd;font:12px/1.45 ui-monospace,Menlo,monospace;margin:0;padding:12px}
  h1{font-size:14px;margin:0 0 8px;color:#f6a77e}
  #status{color:#8c8}#stats{color:#aaa;white-space:pre;margin:6px 0 10px}
  #log{white-space:pre-wrap;word-break:break-word}
  .hook{color:#9cf}.transcript{color:#cfc}.sim{color:#fc9}.server{color:#ccc}
  a{color:#f6a77e}
</style></head><body>
<h1>Clawd Base — flux d'événements (debug) · <a href="/">tableau de bord</a></h1>
<div id="status">connexion…</div><div id="stats"></div><div id="log"></div>
<script>
const logEl=document.getElementById('log'),st=document.getElementById('status'),statsEl=document.getElementById('stats');
const sessions=new Map(),agents=new Map();let tools=0,files=0;
function fmt(t){return new Date(t).toLocaleTimeString('fr-FR',{hour12:false})}
function line(l){const d=document.createElement('div');d.className=l.source;d.textContent=fmt(l.at)+' ['+l.source+'] '+l.sessionId.slice(0,8)+' '+l.kind.padEnd(14)+' '+l.summary;logEl.prepend(d);while(logEl.childNodes.length>1500)logEl.lastChild.remove()}
function tok(n){return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n)}
function render(){let out='';for(const s of sessions.values()){const as=[...agents.values()].filter(a=>a.sessionId===s.id);const u=as.reduce((a,x)=>({i:a.i+x.usage.input,o:a.o+x.usage.output,cc:a.cc+x.usage.cacheCreate,cr:a.cr+x.usage.cacheRead,t:a.t+x.usage.total}),{i:0,o:0,cc:0,cr:0,t:0});
out+=s.status.padEnd(7)+' '+s.title+'  ['+s.id.slice(0,8)+'] modèle='+(s.model||'?')+'  tokens in='+tok(u.i)+' out='+tok(u.o)+' cache+='+tok(u.cc)+' cache='+tok(u.cr)+' total='+tok(u.t)+'  agents='+(as.length-1)+'\\n';
for(const a of as)if(a.kind==='sub')out+='    └ '+a.status.padEnd(8)+' '+a.type+' '+a.id.slice(0,10)+' '+(a.currentTool||'')+' tok='+tok(a.usage.total)+' +'+a.added+'/-'+a.removed+(a.workflowId?' wf='+a.workflowId.slice(-8)+' étape '+a.stepIndex:'')+'  '+(a.description||'')+'\\n'}
statsEl.textContent=out+'outils='+tools+' fichiers='+files}
function upsert(c){if(c.kind==='session')sessions.set(c.data.id,c.data);else if(c.kind==='agent')agents.set(c.data.id,c.data);else if(c.kind==='tool')tools++;else if(c.kind==='file')files++}
const es=new EventSource('/api/stream');
es.onopen=()=>{st.textContent='connecté'};es.onerror=()=>{st.textContent='déconnecté — reconnexion…'};
es.addEventListener('snapshot',e=>{const s=JSON.parse(e.data);sessions.clear();agents.clear();logEl.textContent='';s.sessions.forEach(x=>sessions.set(x.id,x));s.agents.forEach(x=>agents.set(x.id,x));tools=s.tools.length;files=s.files.length;s.logs.forEach(line);render()});
es.addEventListener('patch',e=>{const b=JSON.parse(e.data);for(const c of b.changes){if(c.op==='upsert')upsert(c);else if(c.kind==='agent')agents.delete(c.id);else if(c.kind==='session')sessions.delete(c.id)}b.logs.forEach(line);render()});
</script></body></html>`;
