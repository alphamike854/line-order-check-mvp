import {CATEGORIES, REVIEW_KEY, personalActor, summaryRows, breakdownRows, detailRows, reviewTarget, formatTotal} from './code-audit-model.mjs';
const $=id=>document.getElementById(id);
const state={key:'', identity:null, selected:new Set(), summary:null, activeCode:null, activeLine:null, pageCursors:[null], pageIndex:0, currentRequest:null, version:0};
function el(tag,text,cls=''){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
function status(s,isError=false){$('status').textContent=s;$('status').classList.toggle('error',isError);}
function cancelRequest(){if(state.currentRequest)state.currentRequest.abort();state.currentRequest=null;state.version++;}
function clearBelow(level){if(level<=2){$('breakdown').classList.add('hidden');$('breakdownRows').replaceChildren();state.activeCode=null;}if(level<=3){$('details').classList.add('hidden');$('detailRows').replaceChildren();state.activeLine=null;}}
async function api(path,signal){
  if(!state.key)throw Error('UNAUTHORIZED');
  const resp=await fetch(path,{method:'GET',headers:{'x-staff-key':state.key},cache:'no-store',signal});
  let body;try{body=await resp.json();}catch{throw Error(`HTTP_${resp.status}`);}
  if(!resp.ok||body?.ok!==true)throw Error(body?.error||`HTTP_${resp.status}`);
  return body;
}
async function loadWithGuard(path,consume){
  cancelRequest();const version=state.version;const controller=new AbortController();state.currentRequest=controller;
  try {const payload=await api(path,controller.signal);if(version!==state.version)return;consume(payload);status('อ่านข้อมูลล่าสุดสำเร็จ');}
  catch(err){if(version!==state.version||err.name==='AbortError')return;status(`อ่านข้อมูลไม่สำเร็จ: ${err.message}`,true);}
  finally{if(state.currentRequest===controller)state.currentRequest=null;}
}
function selectedGroups(){return [...state.selected].sort();}
function scopedQuery(){const p=new URLSearchParams();for(const id of selectedGroups())p.append('group',id);return p;}
function currentLineIds(){return state.identity.lineGroups.filter(x=>state.selected.has(x.summary_group_id)).map(x=>x.line_group_id);}
function showGroups(){const root=$('groups');root.replaceChildren();for(const id of state.identity.summaryGroups){const label=el('label',undefined,'pill');const cb=document.createElement('input');cb.type='checkbox';cb.checked=state.selected.has(id);cb.addEventListener('change',()=>{if(cb.checked)state.selected.add(id);else state.selected.delete(id);clearBelow(2);loadSummary();});label.append(cb,document.createTextNode(id));root.append(label);}}
function showCoverage(result){
  const isAdmin=state.identity.actor.role==='ADMIN';
  const notes=[];
  if(!isAdmin)notes.push('แสดงเฉพาะ LINE Group ที่ได้รับมอบหมาย ไม่สามารถยืนยันว่าเท่ากับยอดรวมทั้งหมดของ Supervisor');
  if(!result.completeRoundScope)notes.push('ไม่พบรอบล่าสุดที่ใช้ได้ครบทุกกลุ่มสรุปที่เลือก — ยอดอาจไม่ครบ');
  const dates=[...new Set(result.roundScope.map(x=>String(x.business_date||'')))].filter(Boolean);
  if(dates.length>1)notes.push('กลุ่มที่เลือกมี Business Date ต่างกัน: '+dates.join(', '));
  $('coverage').textContent=notes.join('\n')||'แสดงยอดจากรอบล่าสุดของกลุ่มสรุปที่เลือกและ LINE Group ที่มีสิทธิ์ (ยังไม่ใช่การยืนยัน Numerical Parity กับ Production Supervisor)';
}
function makeTable(headings){const wrap=el('div',undefined,'table-wrap');const table=document.createElement('table');const thead=document.createElement('thead'),tr=document.createElement('tr');for(const [name,isNum] of headings){const th=el('th',name,isNum?'num':'');tr.append(th);}thead.append(tr);table.append(thead,document.createElement('tbody'));wrap.append(table);return {wrap,tbody:table.tBodies[0]};}
function makeButton(title,fn){const b=el('button',title);b.type='button';b.addEventListener('click',fn);return b;}
function renderSummary(){
  const root=$('summarySections');root.replaceChildren();
  const rows=state.summary.rows;
  const previewLimit = 20;
  for(const cat of CATEGORIES){
    const panel=el('section',undefined,'panel');
    panel.append(el('h2','หมวด '+cat));
    const {wrap,tbody}=makeTable([['ลำดับ'],['รหัส'],['รวมออเดอร์',true],['ตรวจ']]);
    const list=rows.filter(x=>x.category===cat);
    const showRows=limit=>{
      tbody.replaceChildren();
      list.slice(0,limit).forEach((r,i)=>{
        const tr=document.createElement('tr');
        tr.append(el('td',i+1),el('td',r.code),el('td',formatTotal(r.order_total),'num'));
        const action=document.createElement('td');
        action.append(makeButton('ตรวจ',()=>loadBreakdown(cat,r.code,r.order_total)));
        tr.append(action);tbody.append(tr);
      });
      if(!list.length){
        const tr=document.createElement('tr'),td=el('td','ไม่มีรายการ');
        td.colSpan=4;tr.append(td);tbody.append(tr);
      }
    };
    showRows(previewLimit);
    panel.append(wrap);
    if(list.length>previewLimit){
      let expanded=false;
      const button=makeButton(`แสดงเพิ่มเติมอีก ${list.length-previewLimit} รหัส`,()=>{
        expanded=!expanded;
        showRows(expanded?list.length:previewLimit);
        button.textContent=expanded
          ?'ยุบรายการ — แสดง 20 แถวแรก'
          :`แสดงเพิ่มเติมอีก ${list.length-previewLimit} รหัส`;
      });
      button.style.marginTop='8px';
      panel.append(button);
    }
    root.append(panel);
  }
  $('summaryMeta').textContent=`${rows.length} รหัส · กลุ่มสรุป ${selectedGroups().join(', ')} · ${state.summary.fetchedAt?new Date(state.summary.fetchedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'ไม่ทราบเวลา'}`;
}
async function loadSummary(){
  cancelRequest();clearBelow(2);state.summary=null;$('summarySections').replaceChildren();
  if(!selectedGroups().length){showGroups();status('ต้องเลือกอย่างน้อยหนึ่งกลุ่มสรุป',true);return;}
  showGroups();status('กำลังอ่านยอดรวม...');
  await loadWithGuard('/api/code-audit-v02-summary?'+scopedQuery().toString(),payload=>{
    const allowed=selectedGroups();if(payload.scope?.summary_groups?.slice().sort().join('|')!==allowed.join('|'))throw Error('SUMMARY_AUTHORIZED_SCOPE_MISMATCH');
    if(payload.scope?.line_groups?.slice().sort().join('|')!==[...new Set(currentLineIds())].sort().join('|'))throw Error('SUMMARY_LINE_SCOPE_MISMATCH');
    const result=summaryRows(payload,selectedGroups());state.summary=result;showCoverage(result);renderSummary();
  });
}
async function loadBreakdown(category,code,total){
  clearBelow(2);state.activeCode={category,code,total};
  $('breakdown').classList.remove('hidden');$('breakdownTitle').textContent=`ระดับ 2 · หมวด ${category} รหัส ${code}`;
  $('breakdownMeta').textContent='กำลังแจกแจงยอดตามกลุ่มสรุปและกลุ่ม LINE';$('breakdownRows').replaceChildren();
  const p=scopedQuery();p.set('category',category);p.set('code',code);
  await loadWithGuard('/api/code-audit-v02-breakdown?'+p.toString(),payload=>{
    const rows=breakdownRows(payload,category,code,total,selectedGroups(),currentLineIds());
    const {wrap,tbody}=makeTable([['กลุ่มสรุป'],['กลุ่ม LINE'],['รวมออเดอร์',true],['ข้อความ',true],['ตรวจ']]);
    rows.forEach(r=>{const tr=document.createElement('tr');tr.append(el('td',r.summary_group_id),el('td',r.line_group_name),el('td',formatTotal(r.order_total),'num'),el('td',formatTotal(r.message_count),'num'));const c=document.createElement('td');c.append(makeButton('ตรวจ',()=>openDetails(r)));tr.append(c);tbody.append(tr);});
    if(!rows.length){const tr=document.createElement('tr'),td=el('td','ไม่มีรายการ');td.colSpan=5;tr.append(td);tbody.append(tr);} $('breakdownRows').replaceChildren(wrap);
    $('breakdownMeta').textContent=`รวม ${formatTotal(total)} ออเดอร์จาก ${rows.length} กลุ่ม LINE — ตรงกับ Summary ภายในขอบเขตสิทธิ์เดียวกัน`;
    $('breakdown').scrollIntoView({block:'start',behavior:'smooth'});
  });
}
async function openDetails(line){state.activeLine=line;state.pageCursors=[null];state.pageIndex=0;$('details').classList.remove('hidden');$('detailTitle').textContent=`ระดับ 3 · ${state.activeCode.category}${state.activeCode.code} / ${line.summary_group_id} / ${line.line_group_name}`;await loadDetails();}
async function loadDetails(){
  const row=state.activeLine, code=state.activeCode;if(!row||!code)return;
  const p=new URLSearchParams();p.append('group',row.summary_group_id);p.set('line_group',row.line_group_id);p.set('category',code.category);p.set('code',code.code);
  const cursor=state.pageCursors[state.pageIndex];if(cursor)p.set('cursor',cursor);
  $('detailRows').replaceChildren();$('detailMeta').textContent='กำลังอ่านรายการข้อความ...';
  await loadWithGuard('/api/code-audit-v02-detail?'+p.toString(),payload=>{
    const data=detailRows(payload,code.category,code.code,row.summary_group_id,row.line_group_id);
    const root=$('detailRows');root.replaceChildren();data.rows.forEach((m,i)=>{
      const block=el('div',undefined,'detail-row');const wrap=el('div',undefined,'detail-meta');
      wrap.append(el('strong',`#${state.pageIndex*50+i+1} · ${formatTotal(m.quantity)} ออเดอร์`),el('span',new Date(m.event_timestamp).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})),el('span',`ที่มา: ${m.truth_source}`));block.append(wrap);
      block.append(el('p',`Message ID: ${m.message_record_id}`,'small'));
      if(m.first_order_code)block.append(el('p',`รหัสแรกที่ยืนยัน: ${m.first_order_code}`,'small'));
      block.append(makeButton('เปิดตรวจ / แก้ไขในระบบเดิม',()=>{
        const target=reviewTarget(m);sessionStorage.setItem(REVIEW_KEY,JSON.stringify(target));window.location.assign('/');
      }));root.append(block);
    });
    if(!data.rows.length)root.append(el('p','ไม่พบข้อความในหน้านี้','muted'));
    $('detailMeta').textContent=`${row.summary_group_id} / ${row.line_group_name} · แสดงเฉพาะรหัส ${code.category}${code.code} · 50 ข้อความต่อหน้า`;
    $('pageLabel').textContent=`หน้า ${state.pageIndex+1}`;
    $('prevPage').disabled=state.pageIndex===0;$('nextPage').disabled=!data.hasMore;
    $('nextPage').onclick=()=>{if(!data.nextCursor)return;state.pageCursors=state.pageCursors.slice(0,state.pageIndex+1);state.pageCursors.push(data.nextCursor);state.pageIndex++;void loadDetails();};
    $('prevPage').onclick=()=>{if(state.pageIndex===0)return;state.pageIndex--;void loadDetails();};
    $('details').scrollIntoView({block:'start',behavior:'smooth'});
  });
}
$('loginForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const key=$('accessKey').value.trim();if(!key)return;
  cancelRequest();status('กำลังตรวจสิทธิ์...');
  try {
    const resp=await fetch('/api/staff-me',{headers:{'x-staff-key':key},cache:'no-store'});const p=await resp.json();if(!resp.ok)throw Error('UNAUTHORIZED');
    const identity=personalActor(p);if(!identity.summaryGroups.length)throw Error('NO_ASSIGNED_LINE_GROUP');
    state.key=key;state.identity=identity;state.selected=new Set(identity.summaryGroups);sessionStorage.setItem('lineOrderAccessKey',key);
    $('accessKey').value='';$('loginPanel').classList.add('hidden');$('workspace').classList.remove('hidden');showGroups();await loadSummary();
  }catch(err){status(`เข้าสู่ระบบไม่ได้: ${err.message}`,true);}
});
$('refresh').addEventListener('click',()=>loadSummary());
$('closeBreakdown').addEventListener('click',()=>{cancelRequest();clearBelow(2);});
$('closeDetails').addEventListener('click',()=>{cancelRequest();clearBelow(3);});
const saved=sessionStorage.getItem('lineOrderAccessKey');if(saved){$('accessKey').value=saved;$('loginForm').requestSubmit();}
