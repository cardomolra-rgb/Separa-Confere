/* Separa & Confere — app conectado ao Supabase (projeto compartilhado, tabelas sc_) */
const SUPA_URL="https://mdcymhgqzvdrojasuxhb.supabase.co";
const SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kY3ltaGdxenZkcm9qYXN1eGhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1ODE1MTUsImV4cCI6MjA4NjE1NzUxNX0.r-f-G-PTnphI-H8zKWgXS5-UK1ftpJddLCv8kQ_Tf1M";
const sb=supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

const STATUS={aguardando:"Aguardando separação",separando:"Em separação",conferir:"Aguardando conferência",divergente:"Com divergência",concluido:"Pronto p/ expedição"};
const PAPEL={separacao:"Separação",conferencia:"Conferência",gerente:"Gerente"};
const LS={
  get(k,d){try{const v=localStorage.getItem("sc_"+k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem("sc_"+k,JSON.stringify(v))}catch(e){}},
  del(k){try{localStorage.removeItem("sc_"+k)}catch(e){}}
};
let S={pedidos:LS.get("cache",[]),filtro:LS.get("filtro","ativos"),fone:LS.get("fone",""),token:LS.get("token",null),eu:null,op:"",operadores:[],online:true};
let view={tela:"carregando",id:null,sel:0,msg:null};

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hora=iso=>{const d=new Date(iso);const hoje=new Date().toDateString()===d.toDateString();return hoje?d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})};
const fmt=n=>Number(n).toLocaleString("pt-BR",{maximumFractionDigits:2});
const ped=()=>S.pedidos.find(p=>p.id===view.id);
const ini=n=>String(n||"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
const papel=()=>S.eu?.papel;
const podeSep=()=>["separacao","gerente"].includes(papel());
const podeConf=()=>["conferencia","gerente"].includes(papel());
const gerente=()=>papel()==="gerente";
function log(p,m){(p.log||(p.log=[])).push({t:new Date().toISOString(),m})}
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2600)}
function beep(){try{const a=beep.c||(beep.c=new AudioContext());const o=a.createOscillator(),g=a.createGain();o.frequency.value=1250;g.gain.value=.06;o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.07)}catch(e){}}
function footer(html){$("#footerIn").innerHTML=html;$("#footer").hidden=false}

/* ---------------- servidor ---------------- */
const isNet=e=>/fetch|network|Failed|Load failed|NetworkError|timeout/i.test(e?.message||"")&&!/sem_permissao|sessao/.test(e?.message||"");
const ERROS={
  "sem_permissao:separacao":"Esta etapa é da separação. Entre com um usuário da separação ou gerente.",
  "sem_permissao:conferencia":"Esta etapa é da conferência. Entre com um usuário da conferência ou gerente.",
  "sem_permissao:gerente":"Só o gerente pode fazer isso.",
  "pin_invalido":"O PIN precisa ter de 4 a 6 números.",
  "pin_obrigatorio":"Informe um PIN para o novo operador.",
  "nome_obrigatorio":"Informe o nome.",
  "nome_repetido":"Já existe um operador com esse nome.",
  "nao_pode_rebaixar_a_si":"Você não pode tirar o seu próprio acesso de gerente.",
  "cliente_obrigatorio":"Informe o cliente.",
  "itens_obrigatorios":"A lista precisa de pelo menos um item.",
  "ja_configurado":"O app já foi configurado. Recarregue a página.",
  "pedido_nao_encontrado":"Esse pedido não existe mais."
};
const msgErro=e=>{const m=e?.message||"";const k=Object.keys(ERROS).find(k=>m.includes(k));return k?ERROS[k]:isNet(e)?"Sem conexão com a internet.":"Não deu certo: "+m};
async function rpc(fn,args={}){
  const {data,error}=await sb.rpc(fn,args);
  if(error){
    const e=new Error(error.message||String(error));
    if(e.message.includes("sessao_invalida")){sessaoExpirada();}
    throw e;
  }
  return data;
}
function setOnline(v){if(S.online===v)return;S.online=v;const n=$("#net");if(n)n.hidden=v}

/* fila de gravação: cada pedido alterado é enviado ao servidor com a versão que ele tinha */
const sujos=new Set(),enviando=new Set();let flushT=null,ocupado=false;
function save(p=ped()){if(p)sujos.add(p.id);LS.set("cache",S.pedidos);clearTimeout(flushT);flushT=setTimeout(flush,500)}
async function flush(){
  if(ocupado){clearTimeout(flushT);flushT=setTimeout(flush,300);return}
  ocupado=true;
  try{
    for(const id of [...sujos]){
      const p=S.pedidos.find(x=>x.id===id);sujos.delete(id);if(!p)continue;
      enviando.add(id);
      try{
        const r=await rpc("sc_salvar_pedido",{p_token:S.token,p_id:+id,p_versao:p.versao,p_doc:p});
        const atual=S.pedidos.find(x=>x.id===id);
        if(r.conflito){substituir(r.pedido);toast(`Pedido ${id}: outra pessoa alterou antes. Mostrando a versão mais recente.`);rerender(true)}
        else if(atual){atual.versao=r.pedido.versao;atual.atualizado=r.pedido.atualizado}
        setOnline(true);
      }catch(e){
        if(isNet(e)){sujos.add(id);setOnline(false);clearTimeout(flushT);flushT=setTimeout(flush,5000);break}
        if(!/sessao_invalida/.test(e.message)){toast(msgErro(e));await recarregar(true)}
      }finally{enviando.delete(id)}
    }
  }finally{ocupado=false;LS.set("cache",S.pedidos)}
}
async function salvarAgora(p){save(p);clearTimeout(flushT);await flush()}
function substituir(srv){const ix=S.pedidos.findIndex(x=>x.id===srv.id);if(ix>=0)S.pedidos[ix]=srv;else S.pedidos.push(srv)}
async function recarregar(forcar){
  if(!S.token)return;
  try{
    const lst=await rpc("sc_listar_pedidos",{p_token:S.token});
    const loc=new Map(S.pedidos.map(p=>[p.id,p]));
    S.pedidos=lst.map(sp=>(sujos.has(sp.id)||enviando.has(sp.id))&&loc.get(sp.id)?loc.get(sp.id):sp);
    LS.set("cache",S.pedidos);setOnline(true);rerender(forcar);
  }catch(e){if(isNet(e))setOnline(false)}
}
let pendRender=false;
function rerender(forcar){
  if(["carregando","login","setup","nova","operadores"].includes(view.tela))return;
  const a=document.activeElement;
  if(!forcar&&a&&$("#app").contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)){pendRender=true;return}
  pendRender=false;
  if(view.id&&!ped()&&view.tela!=="lista"){toast(`O pedido ${view.id} foi excluído.`);return go("lista",null)}
  render();
}
document.addEventListener("focusout",()=>setTimeout(()=>{if(pendRender)rerender()},50));
let rtLigado=false,rtT=null;
function ligarTempoReal(){
  if(rtLigado)return;rtLigado=true;
  try{sb.channel("sc_pedidos").on("broadcast",{event:"mudou"},()=>{clearTimeout(rtT);rtT=setTimeout(()=>recarregar(),350)}).subscribe()}catch(e){}
  setInterval(()=>{if(S.token&&document.visibilityState==="visible")recarregar()},20000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.token){flush();recarregar()}});
  addEventListener("online",()=>{flush();recarregar()});
}

/* ---------------- sessão ---------------- */
function sessaoExpirada(){
  if(!S.token)return;
  S.token=null;S.eu=null;LS.del("token");LS.del("eu");
  toast("Sua sessão terminou. Entre de novo com seu PIN.");
  carregarInicio();
}
async function carregarInicio(){
  try{const r=await rpc("sc_inicio");S.operadores=r.operadores;if(!r.configurado)return go("setup");go("login")}
  catch(e){go("semrede")}
}
async function iniciar(){
  render();
  if(S.token){
    try{S.eu=await rpc("sc_eu",{p_token:S.token});S.op=S.eu.nome;LS.set("eu",S.eu);return entrarApp()}
    catch(e){
      if(isNet(e)&&LS.get("eu")){S.eu=LS.get("eu");S.op=S.eu.nome;setOnline(false);return entrarApp()}
      if(!/sessao_invalida/.test(e.message)){S.token=null;LS.del("token")}
    }
  }
  carregarInicio();
}
function entrarApp(){fillOps();$("#opBtn").hidden=false;go("lista",null);recarregar(true);ligarTempoReal()}
function logado(r){S.token=r.token;S.eu=r.operador;S.op=r.operador.nome;LS.set("token",S.token);LS.set("eu",S.eu);toast(`Olá, ${S.eu.nome}`);entrarApp()}
async function sair(){
  $("#toast").hidden=true;
  const t=S.token;S.token=null;S.eu=null;LS.del("token");LS.del("eu");$("#opBtn").hidden=true;$("#opSheet").hidden=true;
  if(sujos.size)toast("Alterações pendentes foram descartadas.");
  sujos.clear();try{if(t)await rpc("sc_sair",{p_token:t})}catch(e){}
  view.loginOp=null;carregarInicio();
}

/* ---------------- cabeçalho: usuário ---------------- */
const opBtn=$("#opBtn"),opSheet=$("#opSheet");
function fillOps(){
  if(!S.eu)return;
  opBtn.innerHTML=`<span class="av">${esc(ini(S.eu.nome))}</span><span class="nm">${esc(S.eu.nome)}</span><span class="chev">▼</span>`;
  $("#opList").innerHTML=`<div class="oprowsel" aria-pressed="true"><span class="av">${esc(ini(S.eu.nome))}</span><span class="t"><b>${esc(S.eu.nome)}</b><span>${PAPEL[S.eu.papel]}</span></span><span class="ck">✓</span></div>`;
  $("#opEdit").hidden=!gerente();
}
opBtn.onclick=()=>{fillOps();opSheet.hidden=false};
opSheet.onclick=e=>{if(e.target===opSheet)opSheet.hidden=true};
document.addEventListener("keydown",e=>{if(e.key==="Escape")opSheet.hidden=true});
$("#opEdit").onclick=()=>{opSheet.hidden=true;go("operadores",view.id)};
$("#opSair").onclick=()=>sair();

/* exclusão (gerente) */
$("#app").addEventListener("click",async e=>{
  const p=ped();if(!p)return;const id=e.target.id;
  if(id==="excluir"){view.del=true;render();$("#delBox")?.scrollIntoView({block:"center"})}
  if(id==="delNao"){view.del=false;render()}
  if(id==="delSim"){
    e.target.disabled=true;
    try{await rpc("sc_excluir_pedido",{p_token:S.token,p_id:+p.id});sujos.delete(p.id);S.pedidos=S.pedidos.filter(x=>x.id!==p.id);LS.set("cache",S.pedidos);toast(`Pedido ${p.id} excluído`);go("lista",null)}
    catch(err){toast(msgErro(err));e.target.disabled=false}
  }
});

function go(tela,id){view={tela,id:id===undefined?view.id:id,sel:0,msg:null,del:false,cur:null,edit:false,loginOp:null};render();scrollTo(0,0)}
function render(){
  $("#footer").hidden=true;
  const n=$("#net");if(n)n.hidden=S.online||!S.token;
  const t=view.tela;
  if(t==="carregando")return void($("#app").innerHTML=`<div class="spin">Carregando…</div>`);
  if(t==="semrede")return renderSemRede();
  if(t==="setup")return renderSetup();
  if(t==="login")return renderLogin();
  if(!S.eu)return;
  if(t==="lista")return renderLista();
  if(t==="nova")return renderNova();
  if(t==="operadores")return renderOperadores();
  const p=ped();if(!p)return go("lista",null);
  const fase=["aguardando","separando"].includes(p.status)?"separar":["conferir","divergente"].includes(p.status)?"conferir":"detalhe";
  if((t==="separar"||t==="conferir"||t==="detalhe")&&t!==fase){view.tela=fase;view.cur=null;view.edit=false}
  if(view.tela==="separar")return renderSeparar();
  if(view.tela==="conferir")return renderConferir();
  if(view.tela==="detalhe")return renderDetalhe();
  if(view.tela==="faltas")return renderFaltas();
}
const locTag=i=>i.loc?`<span class="loc">${esc(i.loc)}</span>`:"";

/* ---------------- sem conexão / configuração / entrada ---------------- */
function renderSemRede(){
  $("#app").innerHTML=`<div class="gate"><h1>Sem conexão</h1><p class="hint">Não foi possível falar com o servidor. Confira a internet do aparelho e tente de novo.</p><button class="btn tag" id="tenta">Tentar de novo</button></div>`;
  $("#tenta").onclick=()=>{go("carregando");iniciar()};
}
function renderSetup(){
  $("#app").innerHTML=`<div class="gate">
    <div><div class="lbl">Primeiro acesso</div><h1>Configurar o app</h1></div>
    <p class="hint">Crie o usuário do gerente. Depois, no menu do seu nome, você cadastra o pessoal da separação e da conferência, cada um com seu PIN.</p>
    <div class="panel" style="margin:0">
      <div class="field"><label class="lbl" for="gNome">Nome do gerente</label><input id="gNome" autocomplete="name" placeholder="Seu nome"></div>
      <div class="field"><label class="lbl" for="gPin">PIN (4 a 6 números)</label><input id="gPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label class="lbl" for="gPin2">Repita o PIN</label><input id="gPin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="pinerr" id="gErr"></div>
      <button class="btn tag" id="gCriar" style="width:100%">Criar gerente e entrar</button>
    </div></div>`;
  $("#gCriar").onclick=async()=>{
    const nome=$("#gNome").value.trim(),pin=$("#gPin").value,pin2=$("#gPin2").value,er=$("#gErr");
    if(!nome)return er.textContent="Informe o nome.";
    if(!/^\d{4,6}$/.test(pin))return er.textContent="O PIN precisa ter de 4 a 6 números.";
    if(pin!==pin2)return er.textContent="Os dois PINs estão diferentes.";
    $("#gCriar").disabled=true;
    try{logado(await rpc("sc_criar_primeiro_gerente",{p_nome:nome,p_pin:pin}))}catch(e){er.textContent=msgErro(e);$("#gCriar").disabled=false}
  };
}
let pin="";
function renderLogin(){
  const o=S.operadores.find(x=>x.id===view.loginOp);
  if(!o){
    $("#app").innerHTML=`<div class="gate"><div><div class="lbl">Entrar</div><h1>Quem é você?</h1></div>
      ${S.operadores.length?`<div class="opgrid">${S.operadores.map(x=>`<button class="opcard" data-op="${x.id}"><span class="av">${esc(ini(x.nome))}</span><b>${esc(x.nome)}</b><span>${PAPEL[x.papel]}</span></button>`).join("")}</div>`:`<p class="hint">Nenhum operador ativo. Peça ao gerente para cadastrar.</p>`}
    </div>`;
    document.querySelectorAll("[data-op]").forEach(b=>b.onclick=()=>{view.loginOp=b.dataset.op;pin="";render()});
    return;
  }
  const dots=Array.from({length:6},(_,k)=>`<i class="${k<pin.length?"on":k>=4?"opt":""}"></i>`).join("");
  $("#app").innerHTML=`<div class="gate">
    <button class="back" id="trocar" style="padding:0">← Trocar pessoa</button>
    <div class="pinwho"><span class="av">${esc(ini(o.nome))}</span><div><h1 style="font-size:28px">${esc(o.nome)}</h1><div class="hint" style="margin:0">${PAPEL[o.papel]}</div></div></div>
    <div><div class="lbl" style="text-align:center">Digite seu PIN</div><div class="pindots" aria-live="polite" aria-label="${pin.length} números digitados">${dots}</div></div>
    <div class="pinerr" id="pinErr">${esc(view.pinErr||"")}</div>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(d=>`<button data-d="${d}">${d}</button>`).join("")}<button data-d="del" aria-label="Apagar">⌫</button><button data-d="0">0</button><button class="ok" id="pinOk" ${pin.length<4?"disabled":""}>Entrar</button></div>
  </div>`;
  $("#trocar").onclick=()=>{view.loginOp=null;view.pinErr="";pin="";render()};
  document.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>teclaPin(b.dataset.d));
  $("#pinOk").onclick=entrarPin;
}
function teclaPin(d){if(d==="del")pin=pin.slice(0,-1);else if(pin.length<6)pin+=d;view.pinErr="";render()}
document.addEventListener("keydown",e=>{
  if(view.tela!=="login"||!view.loginOp)return;
  if(/^\d$/.test(e.key))teclaPin(e.key);else if(e.key==="Backspace")teclaPin("del");else if(e.key==="Enter"&&pin.length>=4)entrarPin();
});
async function entrarPin(){
  const b=$("#pinOk");if(b)b.disabled=true;
  try{
    const r=await rpc("sc_entrar",{p_operador:view.loginOp,p_pin:pin});
    pin="";
    if(r.erro==="pin_incorreto"){view.pinErr=`PIN incorreto. ${r.restam>0?`Restam ${r.restam} tentativa${r.restam>1?"s":""}.`:""}`;return render()}
    if(r.erro==="bloqueado"){view.pinErr=`Muitas tentativas. Tente de novo em ${r.minutos} min.`;return render()}
    view.pinErr="";logado(r);
  }catch(e){pin="";view.pinErr=msgErro(e);render()}
}

/* ---------------- operadores (gerente) ---------------- */
let opsLista=null,opEdit=null;
async function renderOperadores(){
  if(!gerente())return go("lista");
  if(!opsLista){
    $("#app").innerHTML=`<div class="spin">Carregando operadores…</div>`;
    try{opsLista=await rpc("sc_operadores_listar",{p_token:S.token})}catch(e){toast(msgErro(e));return go("lista")}
    if(view.tela!=="operadores")return;
  }
  const e=opEdit;
  $("#app").innerHTML=`<button class="back" id="voltar">← Voltar</button>
  <h1>Operadores</h1>
  <p class="hint">Cada pessoa entra com o próprio nome e PIN. O nome aparece no histórico dos pedidos.</p>
  ${e?`<div class="panel">
    <h2>${e.id?"Editar operador":"Novo operador"}</h2>
    <div class="field"><label class="lbl" for="oNome">Nome</label><input id="oNome" value="${esc(e.nome||"")}" placeholder="Nome e sobrenome"></div>
    <div class="field"><span class="lbl">Função</span><div class="seg" role="group" aria-label="Função">${Object.entries(PAPEL).map(([k,v])=>`<button data-pp="${k}" aria-pressed="${e.papel===k}">${v}</button>`).join("")}</div>
      <p class="hint">Separação separa os pedidos. Conferência confere e aprova. Gerente faz tudo, exclui pedidos e cadastra pessoas.</p></div>
    <div class="field"><label class="lbl" for="oPin">${e.id?"Novo PIN (deixe em branco para manter)":"PIN (4 a 6 números)"}</label><input id="oPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
    ${e.id?`<label class="check" for="oAtivo"><input type="checkbox" id="oAtivo" ${e.ativo!==false?"checked":""}> Ativo (desmarque para bloquear o acesso)</label>`:""}
    <div class="pinerr" id="oErr" style="text-align:left"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="oCancel">Cancelar</button><button class="btn tag" id="oSalvar" style="flex:1">Salvar</button></div>
  </div>`:""}
  <div class="panel">
    ${opsLista.map(o=>`<button class="oprow2" data-ed="${o.id}"><span class="av ${o.ativo?"":"off"}">${esc(ini(o.nome))}</span><span class="t"><b>${esc(o.nome)}${o.id===S.eu.id?" (você)":""}</b><span>${PAPEL[o.papel]}${o.ativo?"":" · inativo"}</span></span><span class="ed" style="color:var(--info);font-weight:600;font-size:13px">Editar</span></button>`).join("")}
  </div>`;
  footer(`<button class="btn tag" id="oNovo">+ Novo operador</button>`);
  $("#voltar").onclick=()=>{opsLista=null;opEdit=null;go(view.id?"separar":"lista")};
  $("#oNovo").onclick=()=>{opEdit={papel:"separacao"};render();scrollTo(0,0)};
  document.querySelectorAll("[data-ed]").forEach(b=>b.onclick=()=>{opEdit={...opsLista.find(o=>o.id===b.dataset.ed)};render();scrollTo(0,0)});
  if(!e)return;
  document.querySelectorAll("[data-pp]").forEach(b=>b.onclick=()=>{e.nome=$("#oNome").value;e.papel=b.dataset.pp;render()});
  $("#oCancel").onclick=()=>{opEdit=null;render()};
  $("#oSalvar").onclick=async()=>{
    const nome=$("#oNome").value.trim(),p=$("#oPin").value,at=$("#oAtivo")?$("#oAtivo").checked:true,er=$("#oErr");
    if(!nome)return er.textContent="Informe o nome.";
    if(p&&!/^\d{4,6}$/.test(p))return er.textContent="O PIN precisa ter de 4 a 6 números.";
    if(!e.id&&!p)return er.textContent="Informe um PIN para o novo operador.";
    $("#oSalvar").disabled=true;
    try{
      await rpc("sc_operador_salvar",{p_token:S.token,p_id:e.id||null,p_nome:nome,p_papel:e.papel,p_pin:p||null,p_ativo:at});
      if(e.id===S.eu.id){S.eu.nome=nome;S.op=nome;LS.set("eu",S.eu);fillOps()}
      toast(e.id?"Operador atualizado":`${nome} cadastrado`);opEdit=null;opsLista=null;render();
    }catch(err){er.textContent=msgErro(err);$("#oSalvar").disabled=false}
  };
}

/* ---------------- nova lista ---------------- */
const UN={m:"m",mt:"m",mts:"m",metro:"m",metros:"m",pc:"pç","pç":"pç",pcs:"pç","pçs":"pç",peca:"pç","peça":"pç",pecas:"pç","peças":"pç",un:"un",und:"un",unid:"un",rl:"rl",rolo:"rl",rolos:"rl",cx:"cx",caixa:"cx",caixas:"cx",kg:"kg",br:"br",barra:"br",barras:"br",jg:"jg",jogo:"jg",kit:"kit",par:"par",pares:"par",lt:"lt",l:"lt"};
const UNRE="(m|mts?|metros?|p[cç]s?|pe[cç]as?|un|und|unid|rl|rolos?|cx|caixas?|kg|br|barras?|jg|jogo|kit|par|pares|lt|l)";
function parseLista(txt){
  return txt.split(/\n/).map(l=>l.replace(/^\s*[-•*·>]+\s*/,"").replace(/^\s*\d+[.)]\s+(?=\d)/,"").trim()).filter(Boolean).map(l=>{
    let loc="";const lm=l.match(/\s*@\s*([\w\-]+)\s*$/);if(lm){loc=lm[1].toUpperCase();l=l.slice(0,lm.index).trim()}
    let m=l.match(new RegExp("^(\\d+(?:[.,]\\d+)?)\\s*"+UNRE+"?\\.?\\s*(?:x\\s+|de\\s+)?[-–:]?\\s*(.+)$","i"));
    if(m&&m[3])return {qtd:+m[1].replace(",","."),un:UN[(m[2]||"un").toLowerCase()]||"un",desc:m[3].trim(),loc};
    m=l.match(new RegExp("^(.+?)\\s*[-–:x=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*"+UNRE+"?\\.?$","i"));
    if(m)return {qtd:+m[2].replace(",","."),un:UN[(m[3]||"un").toLowerCase()]||"un",desc:m[1].replace(/[-–:x=]\s*$/,"").trim(),loc};
    return {qtd:0,un:"un",desc:l,loc,erro:true};
  });
}
let rascunho=LS.get("rascunho",{cliente:"",cidade:"",entrega:"",urgente:false,texto:""});
function renderNova(){
  const r=rascunho,guarda=()=>LS.set("rascunho",r);
  $("#app").innerHTML=`<button class="back" id="voltar">← Pedidos</button>
  <h1>Nova lista para separar</h1>
  <div class="panel">
    <div class="field"><label class="lbl" for="nCli">Cliente</label><input id="nCli" value="${esc(r.cliente)}" placeholder="Nome do cliente ou obra"></div>
    <div class="grid2">
      <div class="field"><label class="lbl" for="nCid">Cidade</label><input id="nCid" value="${esc(r.cidade)}" placeholder="Palmas-TO"></div>
      <div class="field"><label class="lbl" for="nEnt">Entrega</label><input id="nEnt" value="${esc(r.entrega)}" placeholder="Hoje 17h"></div>
    </div>
    <label class="check" for="nUrg"><input type="checkbox" id="nUrg" ${r.urgente?"checked":""}> Urgente</label>
  </div>
  <div class="panel">
    <div class="field"><label class="lbl" for="nTxt">Itens · um por linha</label>
    <textarea id="nTxt" class="paste" placeholder="300 m Cabo alumínio 2 AWG @C-01-1&#10;24 pç Isolador pino 15 kV&#10;Cruzeta concreto 2.000 mm - 6">${esc(r.texto)}</textarea></div>
    <p class="hint">Cole direto do WhatsApp, e-mail ou planilha. Aceita "300 m Cabo…" ou "Cabo… - 300". Para indicar o endereço no estoque, termine a linha com @A-03-2.</p>
  </div>
  <div class="panel"><h2 id="pvT"></h2><div style="overflow-x:auto"><table class="prev" id="pv"></table></div></div>`;
  const pv=()=>{
    const it=parseLista(r.texto),errs=it.filter(i=>i.erro).length;
    $("#pvT").textContent=`Conferência da leitura · ${it.length} itens`;
    $("#pv").innerHTML=it.length?it.map(i=>`<tr class="${i.erro?"err":""}"><td class="n">${i.erro?"?":fmt(i.qtd)} ${i.erro?"":i.un}</td><td>${esc(i.desc)}${i.erro?" <small>· sem quantidade, corrija a linha</small>":""}</td><td class="mono">${esc(i.loc)}</td></tr>`).join(""):`<tr><td class="empty">Cole ou digite os itens acima.</td></tr>`;
    const b=$("#criar");if(b){b.disabled=!it.length||errs>0||!r.cliente.trim();b.textContent=errs?`Corrija ${errs} linha${errs>1?"s":""}`:!r.cliente.trim()?"Informe o cliente":it.length?`Criar pedido com ${it.length} itens`:"Adicione os itens"}
  };
  footer(`<button class="btn tag" id="criar">Criar pedido</button>`);
  $("#voltar").onclick=()=>go("lista");
  $("#nCli").oninput=e=>{r.cliente=e.target.value;guarda();pv()};
  $("#nCid").oninput=e=>{r.cidade=e.target.value;guarda()};
  $("#nEnt").oninput=e=>{r.entrega=e.target.value;guarda()};
  $("#nUrg").onchange=e=>{r.urgente=e.target.checked;guarda()};
  $("#nTxt").oninput=e=>{r.texto=e.target.value;guarda();pv()};
  pv();
  $("#criar").onclick=async()=>{
    const b=$("#criar");b.disabled=true;b.textContent="Criando…";
    const itens=parseLista(r.texto).map((i,n)=>({ref:String(n+1).padStart(2,"0"),desc:i.desc,un:i.un,qtd:i.qtd,loc:i.loc,sep:0,conf:0,falta:false}));
    const doc={cliente:r.cliente.trim(),cidade:r.cidade.trim()||"—",entrega:r.entrega.trim()||"a combinar",urgente:r.urgente,volumes:0,obs:"",log:[],itens};
    log(doc,`${S.op} criou a lista com ${itens.length} itens`);
    try{
      const p=await rpc("sc_criar_pedido",{p_token:S.token,p_doc:doc});
      substituir(p);LS.set("cache",S.pedidos);
      rascunho={cliente:"",cidade:"",entrega:"",urgente:false,texto:""};LS.del("rascunho");
      toast(`Pedido ${p.id} criado`);podeSep()?go("separar",p.id):go("lista",null);
    }catch(e){toast(msgErro(e));pv()}
  };
}

/* ---------------- faltantes / WhatsApp ---------------- */
function faltantes(p){
  const usaConf=["divergente","concluido"].includes(p.status);
  return rota(p).map(i=>{const tem=usaConf?i.conf:i.sep;return {...i,tem,falta:i.qtd-tem}}).filter(i=>i.falta>0);
}
function textoFaltas(p){
  const f=faltantes(p),d=new Date().toLocaleDateString("pt-BR");
  return `*Itens em falta · Pedido ${p.id}*\nCliente: ${p.cliente}\nData: ${d}\n\n`+
    f.map(i=>`• ${fmt(i.falta)} ${i.un} – ${i.desc}${i.tem>0?` (pedido ${fmt(i.qtd)}, separado ${fmt(i.tem)})`:` (pedido ${fmt(i.qtd)}, nada em estoque)`}`).join("\n")+
    `\n\nTotal: ${f.length} ${f.length>1?"itens":"item"} com falta.`+(p.volumes?`\nSeguem ${p.volumes} volume${p.volumes>1?"s":""} com o restante.`:"");
}
function waLink(txt){const n=(S.fone||"").replace(/\D/g,"");const num=n.length>=10&&n.length<=11?"55"+n:n;return `https://wa.me/${num}?text=${encodeURIComponent(txt)}`}
function renderFaltas(){
  const p=ped(),f=faltantes(p);
  $("#app").innerHTML=cabecalho(p,"Lista de faltantes")+(f.length?`
  <div class="panel"><h2>${f.length} ${f.length>1?"itens":"item"} com falta</h2>
    ${f.map(i=>`<div class="falta-row"><div><div style="font-weight:600">${esc(i.desc)}</div><div class="hint">Pedido ${fmt(i.qtd)} ${i.un} · ${i.tem>0?`separado ${fmt(i.tem)}`:"sem estoque"}</div></div><b>${fmt(i.falta)}<small style="font-size:14px"> ${i.un}</small></b></div>`).join("")}
  </div>
  <div class="panel">
    <div class="field"><label class="lbl" for="fone">WhatsApp de quem recebe (opcional)</label><input id="fone" inputmode="tel" value="${esc(S.fone||"")}" placeholder="(63) 99999-0000"></div>
    <p class="hint">Deixe em branco para escolher o contato ou grupo no próprio WhatsApp. O número fica salvo neste aparelho.</p>
    <div class="lbl" style="margin-top:12px">Mensagem</div>
    <div class="msgbox" id="msg">${esc(textoFaltas(p))}</div>
  </div>`:`<div class="panel empty">Nenhum item em falta neste pedido.</div>`);
  footer(f.length?`<button class="btn ghost" id="copiar">Copiar texto</button><a class="btn wa" id="wa" href="${waLink(textoFaltas(p))}" target="_blank" rel="noopener">Enviar no WhatsApp</a>`:`<button class="btn" id="ok">Voltar aos pedidos</button>`);
  $("#voltar").onclick=()=>go("lista");
  const ok=$("#ok");if(ok)ok.onclick=()=>go("lista");
  if(!f.length)return;
  $("#fone").oninput=e=>{S.fone=e.target.value;LS.set("fone",S.fone);$("#wa").href=waLink(textoFaltas(p))};
  $("#wa").onclick=()=>{log(p,`${S.op} enviou a lista de faltantes por WhatsApp`);save(p)};
  $("#copiar").onclick=()=>{
    const t=textoFaltas(p);
    const sel=()=>{const r=document.createRange();r.selectNodeContents($("#msg"));const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Texto selecionado, copie manualmente")};
    try{navigator.clipboard.writeText(t).then(()=>toast("Texto copiado"),sel)}catch(e){sel()}
  };
}

/* ---------------- lista de pedidos ---------------- */
function renderLista(){
  const c=k=>S.pedidos.filter(p=>p.status===k).length;
  const filtros={ativos:"Em aberto",aguardando:"Separar",conferir:"Conferir",divergente:"Divergência",concluido:"Prontos"};
  let lista=S.pedidos.filter(p=>S.filtro==="ativos"?p.status!=="concluido":S.filtro==="aguardando"?["aguardando","separando"].includes(p.status):p.status===S.filtro);
  lista.sort((a,b)=>(b.urgente?1:0)-(a.urgente?1:0)||String(a.criado).localeCompare(String(b.criado)));
  $("#app").innerHTML=`
  <div class="flow">
    <div><b>${c("aguardando")}</b><span>A separar</span></div>
    <div><b>${c("separando")}</b><span>Separando</span></div>
    <div><b>${c("conferir")+c("divergente")}</b><span>A conferir</span></div>
    <div><b>${c("concluido")}</b><span>Prontos</span></div>
  </div>
  <div class="tabs" role="group" aria-label="Filtro">${Object.entries(filtros).map(([k,v])=>`<button data-f="${k}" aria-pressed="${S.filtro===k}">${v}</button>`).join("")}</div>
  ${lista.length?lista.map(p=>{
    const tot=p.itens.reduce((s,i)=>s+i.qtd,0),sep=p.itens.reduce((s,i)=>s+Math.min(i.sep,i.qtd),0);
    const quem=p.status==="separando"&&p.separador?` · ${esc(p.separador)}`:"";
    return `<button class="order" data-id="${p.id}">
      <div class="ticket"><small>PEDIDO</small>${p.id}</div>
      <div class="cli">${esc(p.cliente)}</div>
      <div class="right"><span class="pill s-${p.status}">${STATUS[p.status]}</span><div class="bar" title="${sep}/${tot} separados"><i style="width:${tot?sep/tot*100:0}%"></i></div></div>
      <div class="meta">${p.itens.length} itens · ${esc(p.cidade)} · <span class="${p.urgente?"urg":""}">Entrega ${esc(p.entrega)}</span>${quem}</div>
    </button>`}).join(""):`<div class="empty">${S.pedidos.length?"Nenhum pedido neste filtro.":"Nenhum pedido ainda. Toque em “Nova lista para separar” para criar o primeiro."}</div>`}`;
  document.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{S.filtro=b.dataset.f;LS.set("filtro",S.filtro);render()});
  document.querySelectorAll(".order").forEach(b=>b.onclick=()=>abrir(b.dataset.id));
  footer(`<button class="btn tag" id="nova">+ Nova lista para separar</button>`);
  $("#nova").onclick=()=>go("nova",null);
}
function abrir(id){
  const p=S.pedidos.find(x=>x.id===id);
  if(["aguardando","separando"].includes(p.status))go("separar",id);
  else if(["conferir","divergente"].includes(p.status))go("conferir",id);
  else go("detalhe",id);
}
function cabecalho(p,etapa){
  return `<button class="back" id="voltar">← Pedidos</button>
  <div class="headcard">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
      <div><div class="lbl">${etapa}</div><h1>Pedido ${p.id}</h1></div>
      <span class="pill s-${p.status}">${STATUS[p.status]}</span>
    </div>
    <div class="row">
      <div><div class="lbl">Cliente</div>${esc(p.cliente)}</div>
      <div><div class="lbl">Entrega</div><span class="${p.urgente?"urg":""}">${esc(p.entrega)}</span></div>
      ${p.separador?`<div><div class="lbl">Separado por</div>${esc(p.separador)}</div>`:""}
      ${p.conferente?`<div><div class="lbl">Conferido por</div>${esc(p.conferente)}</div>`:""}
    </div>
    ${gerente()?`<div><button class="linkbtn" id="excluir">Excluir pedido</button></div>`:""}
  </div>${delBox(p)}`;
}
const delBox=p=>view.del?`<div class="panel delbox" id="delBox" role="alert"><b>Excluir o pedido ${p.id} de ${esc(p.cliente)}?</b><p class="hint">Os itens, as contagens e o histórico serão apagados para todos. Não dá para desfazer.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="delNao">Cancelar</button><button class="btn bad" id="delSim">Excluir pedido</button></div></div>`:"";
function rota(p){return [...p.itens].sort((a,b)=>String(a.loc||"").localeCompare(String(b.loc||""),"pt-BR",{numeric:true}))}
function somenteLeitura(p,etapa,msg){
  $("#app").innerHTML=cabecalho(p,etapa)+`<div class="ro">${msg}</div>
  <div class="panel"><h2>Itens</h2>${rota(p).map(i=>`<div class="item"><div><div class="desc">${esc(i.desc)}</div><div class="sub">${locTag(i)}</div></div><div class="qty"><div class="lbl">Separado</div><div class="big">${fmt(i.sep)}<small>/${fmt(i.qtd)} ${i.un}</small></div></div></div>`).join("")}</div>`;
  $("#voltar").onclick=()=>go("lista");
}

/* ---------------- separação: um item por vez ---------------- */
function renderSeparar(){
  const p=ped();
  if(!podeSep())return somenteLeitura(p,"Separação","Este pedido está na separação. Só quem é da separação ou o gerente pode mexer nele.");
  if(p.status==="aguardando"){
    $("#app").innerHTML=cabecalho(p,"Separação")+`
    <div class="panel"><h2>Rota de coleta</h2><p class="hint">Itens ordenados pelo endereço do estoque, para andar menos.</p>
    ${rota(p).map(i=>`<div class="item"><div><div class="desc">${esc(i.desc)}</div><div class="sub">${locTag(i)}</div></div><div class="qty"><div class="big">${fmt(i.qtd)}<small> ${i.un}</small></div></div></div>`).join("")}</div>`;
    footer(`<button class="btn tag" id="iniciar">Iniciar separação</button>`);
    $("#iniciar").onclick=async()=>{p.status="separando";p.separador=S.op;log(p,`${S.op} iniciou a separação`);render();await salvarAgora(p)};
    $("#voltar").onclick=()=>go("lista");return;
  }
  const itens=rota(p),n=itens.length;
  const pronto=i=>i.sep>=i.qtd||i.falta;
  if(view.cur==null){view.cur=itens.findIndex(i=>!pronto(i));if(view.cur<0)view.cur=n}
  view.cur=Math.max(0,Math.min(n,view.cur));
  const feitos=itens.filter(pronto).length;
  const outro=p.separador&&p.separador!==S.op?`<div class="ro" style="margin-top:8px">Separação iniciada por ${esc(p.separador)}. O que você fizer aqui aparece para ele também.</div>`:"";
  const trilha=`<div class="trail" role="group" aria-label="Itens do pedido">${itens.map((i,ix)=>{
      const st=i.falta&&i.sep<i.qtd?"short":i.sep>i.qtd?"over":i.sep>=i.qtd?"done":i.sep>0?"partial":"";
      return `<button class="dot ${st} ${ix===view.cur?"on":""}" data-go="${ix}" aria-label="Item ${ix+1}: ${esc(i.desc)}">${ix+1}</button>`}).join("")}
      <button class="dot end ${view.cur===n?"on":""}" data-go="${n}" aria-label="Fechamento">✓</button></div>`;
  const topo=`<button class="back" id="voltar">← Pedidos</button>
    <div class="sephead"><div><div class="lbl">Pedido ${p.id} · ${esc(p.cliente)}</div>
    <div class="progress"><div class="bar"><i style="width:${feitos/n*100}%"></i></div><span class="mono">${feitos}/${n}</span></div></div>${gerente()?`<button class="linkbtn" id="excluir">Excluir</button>`:""}</div>
    ${delBox(p)}${outro}${trilha}`;

  if(view.cur===n){
    const pend=itens.filter(i=>!pronto(i));
    $("#app").innerHTML=topo+`
    <div class="focus">
      <div class="lbl">Fechamento</div>
      <h1>${pend.length?`${pend.length>1?"Faltam":"Falta"} ${pend.length} ${pend.length>1?"itens":"item"}`:"Todos os itens passados"}</h1>
      <div class="sumlist">${itens.map((i,ix)=>{const st=i.falta&&i.sep<i.qtd?"bad":i.sep>i.qtd?"bad":i.sep>=i.qtd?"ok":"warn";
        return `<button class="sumrow" data-go="${ix}"><span class="mono">${ix+1}</span><span class="d">${esc(i.desc)}</span><span class="note ${st}">${fmt(i.sep)}/${fmt(i.qtd)} ${i.un}</span><span class="ed">Editar</span></button>`}).join("")}</div>
      <div class="field"><label class="lbl" for="vol">Volumes (caixas, amarrados, paletes)</label><input id="vol" type="number" min="1" inputmode="numeric" value="${p.volumes||""}" placeholder="0"></div>
      <div class="field"><label class="lbl" for="obs">Observação para a conferência</label><textarea id="obs" rows="2" placeholder="Ex.: cruzetas no pátio, ao lado do portão 2">${esc(p.obs)}</textarea></div>
    </div>`;
    footer(`<button class="btn ghost nav" id="ant">← Voltar</button><button class="btn tag" id="fim" ${pend.length?"disabled":""}>${pend.length?`${pend.length>1?"Faltam":"Falta"} ${pend.length}`:"Enviar p/ conferência"}</button>`);
    bindSep();
    $("#obs").oninput=e=>{p.obs=e.target.value;save(p)};
    $("#vol").oninput=e=>{p.volumes=+e.target.value||0;save(p)};
    $("#fim").onclick=async()=>{
      if(!p.volumes){toast("Informe quantos volumes foram montados");$("#vol").focus();return}
      const faltas=p.itens.filter(i=>i.sep<i.qtd);
      p.status="conferir";log(p,`${S.op} finalizou a separação · ${p.volumes} volume${p.volumes>1?"s":""}${faltas.length?` · ${faltas.length} item(ns) com falta`:""}`);
      $("#fim").disabled=true;await salvarAgora(p);
      toast("Enviado para conferência");go(faltas.length?"faltas":"lista");
    };
    return;
  }

  const i=itens[view.cur];
  const st=i.falta&&i.sep<i.qtd?"short":i.sep>i.qtd?"over":i.sep>=i.qtd?"done":i.sep>0?"partial":"";
  if(view.edit){
    $("#app").innerHTML=topo+`
    <div class="focus">
      <div class="lbl">Editar item ${view.cur+1} de ${n}</div>
      <div class="field"><label class="lbl" for="eDesc">Descrição</label><input id="eDesc" value="${esc(i.desc)}"></div>
      <div class="grid2">
        <div class="field"><label class="lbl" for="eQtd">Quantidade do pedido</label><input id="eQtd" type="number" min="0" step="any" inputmode="decimal" value="${i.qtd}"></div>
        <div class="field"><label class="lbl" for="eUn">Unidade</label><input id="eUn" value="${esc(i.un)}"></div>
        <div class="field"><label class="lbl" for="eSep">Quantidade separada</label><input id="eSep" type="number" min="0" step="any" inputmode="decimal" value="${i.sep}"></div>
        <div class="field"><label class="lbl" for="eLoc">Endereço no estoque</label><input id="eLoc" value="${esc(i.loc)}" placeholder="A-03-2"></div>
      </div>
      <label class="check" for="eFalta"><input type="checkbox" id="eFalta" ${i.falta?"checked":""}> Sem estoque (vai para a lista de faltantes)</label>
    </div>`;
    footer(`<button class="btn ghost" id="eCancel">Cancelar</button><button class="btn tag" id="eSalvar">Salvar alterações</button>`);
    $("#voltar").onclick=()=>go("lista");
    bindTrail();
    $("#eCancel").onclick=()=>{view.edit=false;render()};
    $("#eSalvar").onclick=()=>{
      const d=$("#eDesc").value.trim(),q=+$("#eQtd").value,sp=+$("#eSep").value;
      if(!d){toast("A descrição não pode ficar vazia");return}
      if(!(q>0)){toast("A quantidade do pedido precisa ser maior que zero");return}
      const mud=[];
      if(d!==i.desc)mud.push("descrição");if(q!==i.qtd)mud.push(`qtd ${fmt(i.qtd)}→${fmt(q)}`);if(sp!==i.sep)mud.push(`separado ${fmt(i.sep)}→${fmt(sp||0)}`);
      const loc=$("#eLoc").value.trim().toUpperCase();if(loc!==(i.loc||""))mud.push(`endereço ${loc||"—"}`);
      i.desc=d;i.qtd=q;i.sep=Math.max(0,sp||0);i.un=$("#eUn").value.trim()||i.un;i.loc=loc;i.falta=$("#eFalta").checked;
      if(mud.length)log(p,`${S.op} editou o item ${i.ref}: ${mud.join(", ")}`);
      view.edit=false;view.msg={c:"ok",t:"Item atualizado"};save(p);render();
    };
    return;
  }
  $("#app").innerHTML=topo+`
  <div class="focus ${st}">
    <div class="fhead"><span class="lbl">Item ${view.cur+1} de ${n}</span><button class="linkbtn plain" id="editar">Editar item</button></div>
    ${i.loc?`<div class="goto"><span class="lbl">Ir até</span><span class="locbig">${esc(i.loc)}</span></div>`:`<div class="goto none"><span class="lbl">Endereço não informado</span></div>`}
    <h1 class="fdesc">${esc(i.desc)}</h1>
    <div class="pick">
      <div><div class="lbl">Pegar</div><div class="huge">${fmt(i.qtd)}<small> ${i.un}</small></div></div>
      <div class="sep"><div class="lbl">Separado</div><div class="huge ${st}">${fmt(i.sep)}</div></div>
    </div>
    <div class="counter">
      <button class="step" id="menos" aria-label="Diminuir">−</button>
      <input id="qsep" type="number" min="0" step="any" inputmode="decimal" value="${i.sep}" aria-label="Quantidade separada">
      <button class="step" id="mais" aria-label="Aumentar">+</button>
    </div>
    <div class="feedback ${view.msg?.c||""}" aria-live="polite">${view.msg?.t||(st==="short"?`Marcado sem estoque · falta ${fmt(i.qtd-i.sep)} ${i.un}`:st==="over"?`${fmt(i.sep-i.qtd)} ${i.un} a mais que o pedido`:"")}</div>
    <div class="acts">
      ${st==="short"?`<button class="btn ghost" id="desfalta">Desfazer "sem estoque"</button>`:`<button class="btn bad" id="falta">Sem estoque${i.sep>0?` (falta ${fmt(Math.max(0,i.qtd-i.sep))})`:""}</button>`}
      <button class="btn tag" id="tudo">Peguei ${fmt(i.qtd)} ${i.un} →</button>
    </div>
  </div>`;
  footer(`<button class="btn ghost nav" id="ant" ${view.cur===0?"disabled":""}>← Voltar</button><button class="btn nav" id="prox">${view.cur===n-1?"Fechamento →":"Próximo →"}</button>`);
  bindSep();
  const set=v=>{i.sep=Math.max(0,v);if(i.sep>=i.qtd)i.falta=false;view.msg=null;save(p);render()};
  $("#mais").onclick=()=>set(i.sep+1);
  $("#menos").onclick=()=>set(i.sep-1);
  $("#qsep").onchange=e=>set(+e.target.value||0);
  $("#qsep").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur()}};
  $("#tudo").onclick=()=>{i.sep=i.qtd;i.falta=false;beep();save(p);avancar(itens,`✓ ${i.desc}`)};
  $("#editar").onclick=()=>{view.edit=true;view.msg=null;render()};
  const fb=$("#falta");if(fb)fb.onclick=()=>{i.falta=true;log(p,`${S.op} marcou falta: ${i.desc} (${fmt(i.sep)}/${fmt(i.qtd)})`);save(p);avancar(itens,`Sem estoque: ${i.desc}`,"warn")};
  const df=$("#desfalta");if(df)df.onclick=()=>{i.falta=false;view.msg=null;save(p);render()};
}
function avancar(itens,msg,c="ok"){
  const n=itens.length,pr=i=>i.sep>=i.qtd||i.falta;
  let nx=itens.findIndex((i,ix)=>ix>view.cur&&!pr(i));
  if(nx<0)nx=itens.findIndex(i=>!pr(i));
  if(nx<0)nx=n;
  view.cur=nx;view.msg={c,t:msg+" · próximo item"};render();scrollTo(0,0);
}
function bindTrail(){document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{view.cur=+b.dataset.go;view.edit=false;view.msg=null;render();scrollTo(0,0)})}
function bindSep(){
  $("#voltar").onclick=()=>go("lista");
  bindTrail();
  const a=$("#ant");if(a)a.onclick=()=>{view.cur--;view.msg=null;render();scrollTo(0,0)};
  const x=$("#prox");if(x)x.onclick=()=>{view.cur++;view.msg=null;render();scrollTo(0,0)};
}

/* ---------------- conferência ---------------- */
function renderConferir(){
  const p=ped();
  if(!podeConf())return somenteLeitura(p,"Conferência","Este pedido está na conferência. Só quem é da conferência ou o gerente pode mexer nele.");
  const itens=rota(p);
  const ok=itens.filter(i=>i.conf===i.qtd).length;
  $("#app").innerHTML=cabecalho(p,"Conferência")+`
  ${p.obs?`<div class="panel"><div class="lbl">Recado do separador</div>${esc(p.obs)}</div>`:""}
  ${faltantes(p).length?`<button class="btn wa" id="verF" style="width:100%;margin-top:12px">Ver lista de faltantes · WhatsApp</button>`:""}
  <div class="panel" style="display:flex;gap:18px;flex-wrap:wrap">
    <div><div class="lbl">Volumes informados</div><span class="mono" style="font-size:20px;font-weight:700">${p.volumes||0}</span></div>
    <div><div class="lbl">Itens batendo</div><span class="mono" style="font-size:20px;font-weight:700">${ok}/${itens.length}</span></div>
  </div>
  <p class="hint">Confira contando de novo, sem olhar o que foi separado. A quantidade separada só aparece depois que você conta. Use + e − ou "Conferi tudo".</p>
  <div class="feedback ${view.msg?.c||""}" aria-live="polite">${view.msg?.t||""}</div>
  ${itens.map((i,ix)=>{
    const st=i.conf===0?"":i.conf===i.qtd?"done":i.conf>i.qtd?"over":"partial";
    const difSep=i.conf>0&&i.conf!==i.sep;
    return `<div class="item ${st} ${ix===view.sel?"current":""}" data-ix="${ix}">
      <div><div class="desc">${esc(i.desc)}</div><div class="sub">${locTag(i)}</div></div>
      <div class="qty"><div class="big">${fmt(i.conf)}<small>/${fmt(i.qtd)} ${i.un}</small></div></div>
      <div class="ctrl">
        <button class="step" data-a="menos" aria-label="Diminuir">−</button>
        <button class="step" data-a="mais" aria-label="Aumentar">+</button>
        <button class="btn ghost" data-a="tudo">Conferi tudo</button>
        <span class="grow"></span>
        ${i.conf===0?`<span class="note" style="color:var(--muted)">Não conferido</span>`:
          st==="done"?`<span class="note ok">✓ Confere</span>`:
          `<span class="note bad">${i.conf>i.qtd?`${fmt(i.conf-i.qtd)} a mais`:`Faltam ${fmt(i.qtd-i.conf)}`}</span>`}
        ${difSep?`<span class="note warn">Separador marcou ${fmt(i.sep)}</span>`:""}
      </div></div>`}).join("")}`;
  const conferidos=itens.every(i=>i.conf>0||i.sep===0);
  const div=itens.filter(i=>i.conf!==i.qtd);
  footer(div.length?
    `<button class="btn ghost" id="devolver">Devolver p/ separação</button><button class="btn bad" id="fimdiv" ${conferidos?"":"disabled"}>Registrar divergência</button>`:
    `<button class="btn tag" id="aprovar">Aprovar · pronto p/ expedição</button>`);
  $("#voltar").onclick=()=>go("lista");
  document.querySelectorAll(".item[data-ix]").forEach(el=>{
    const i=itens[+el.dataset.ix];
    el.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.a;view.sel=+el.dataset.ix;view.msg=null;
      if(a==="mais")i.conf++;
      if(a==="menos")i.conf=Math.max(0,i.conf-1);
      if(a==="tudo")i.conf=i.qtd;
      save(p);render();
    });
  });
  const vf=$("#verF");if(vf)vf.onclick=()=>go("faltas");
  const ap=$("#aprovar");if(ap)ap.onclick=async()=>{ap.disabled=true;p.status="concluido";p.conferente=S.op;log(p,`${S.op} conferiu sem divergências`);await salvarAgora(p);toast(`Pedido ${p.id} liberado`);go("lista")};
  const fd=$("#fimdiv");if(fd)fd.onclick=async()=>{fd.disabled=true;p.status="divergente";p.conferente=S.op;log(p,`${S.op} registrou divergência: `+div.map(i=>`${i.desc} ${fmt(i.conf)}/${fmt(i.qtd)}`).join(", "));await salvarAgora(p);toast("Divergência registrada");go(faltantes(p).length?"faltas":"lista")};
  const dv=$("#devolver");if(dv)dv.onclick=async()=>{dv.disabled=true;p.status="separando";p.itens.forEach(i=>{i.conf=0;i.falta=false});log(p,`${S.op} devolveu para a separação`);await salvarAgora(p);toast("Pedido voltou para a separação");go("lista")};
}

/* ---------------- resumo (pronto) ---------------- */
function renderDetalhe(){
  const p=ped();
  $("#app").innerHTML=cabecalho(p,"Resumo")+`
  <div class="panel"><h2>Itens</h2>
  ${rota(p).map(i=>`<div class="item ${i.conf===i.qtd?"done":"short"}"><div><div class="desc">${esc(i.desc)}</div></div><div class="qty"><div class="big">${fmt(i.conf)}<small>/${fmt(i.qtd)} ${i.un}</small></div></div></div>`).join("")}</div>
  ${faltantes(p).length?`<button class="btn wa" id="verF" style="width:100%;margin-top:12px">Lista de faltantes · WhatsApp</button>`:""}
  <div class="panel"><h2>Histórico</h2><ul class="log">${(p.log||[]).map(l=>`<li><time>${hora(l.t)}</time><span>${esc(l.m)}</span></li>`).join("")}</ul></div>`;
  $("#voltar").onclick=()=>go("lista");
  const vf=$("#verF");if(vf)vf.onclick=()=>go("faltas");
}

/* ---------------- app instalável ---------------- */
if("serviceWorker" in navigator&&location.protocol==="https:"){addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))}
iniciar();
