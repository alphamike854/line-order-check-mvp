import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('public/app.js', 'utf8');
const begin = code.indexOf('async function loadAbAdvisoryPreviewReadOnly()');
const end = code.indexOf('async function loadDashboard({', begin);
assert.ok(begin >= 0 && end > begin, 'A/B helper boundaries');
const src = code.slice(begin, end);
assert.match(src, /state\.settlement\?\.open_session/);
assert.match(src, /state\.dashboard\?\.settlement_session/);
assert.match(src, /LIVE_AB_ADVISORY_UNAVAILABLE/);
assert.match(src, /calculation_status: "ERROR"/);
assert.match(src, /\/api\/ab-advisory-preview/);
assert.ok(src.indexOf('state.settlement?.open_session') < src.indexOf('await api('), 'live guard before preview query');
assert.ok(src.indexOf('return;', src.indexOf('const visibleDashboard')) < src.indexOf('await api('), 'guard returns before preview API');

async function run({group='SOUTH', settlement=null, dashboard=null, apiFails=false}={}) {
  const calls=[]; const renders=[];
  const context={
    summaryGroupSelect:{value:group},
    state:{settlement,dashboard},
    api:async url=>{
      calls.push(url);
      if(apiFails)throw Error('DB_STATEMENT_TIMEOUT');
      return {generated_at:'2026-10-16T07:00:00Z',ab_advisory:{calculation_status:'READY',summary_groups:[{summary_group_id:group}],line_groups:[]}};
    },
    renderAbAdvisoryPreview:payload=>renders.push(payload),
    encodeURIComponent, Date,
    console:{warn:()=>{}},
  };
  vm.runInNewContext(src+'\nthis.testFn=loadAbAdvisoryPreviewReadOnly;',context);
  await context.testFn();
  return {calls,renders,state:context.state};
}

// HTTP-200 incident-mode dashboard omits both settlement_session and advisory.
const incompleteDashboard={incident_mode:true,partial_data:true,settlement_session:null,ab_advisory:null,metrics:{gross_received:0}};
const open={open_session:{id:'OPEN_LIVE_ROUND'}};
const first=await run({settlement:open,dashboard:incompleteDashboard});
assert.equal(first.calls.length,0,'an open Round must never re-run heavy preview');
assert.equal(first.renders.length,1);
assert.equal(first.renders[0].dashboard.ab_advisory.calculation_status,'ERROR');
assert.equal(first.renders[0].dashboard.ab_advisory.calculation_error,'LIVE_AB_ADVISORY_UNAVAILABLE');
assert.equal(first.state.dashboard.ab_advisory,null,'do not corrupt authoritative dashboard state');
assert.deepEqual(first.state.dashboard,incompleteDashboard,'do not fabricate risk data');

// Normal live path preserves already calculated authoritative A/B plan.
const ready={settlement_session:{id:'LIVE'},ab_advisory:{calculation_status:'READY',summary_groups:[{summary_group_id:'SOUTH'}]}};
const second=await run({settlement:open,dashboard:ready});
assert.equal(second.calls.length,0);
assert.equal(second.renders[0].dashboard,ready);

// If settlement read fails, a dashboard-confirmed OPEN session still suppresses duplicate.
const third=await run({dashboard:{settlement_session:{id:'LIVE'},ab_advisory:null}});
assert.equal(third.calls.length,0);
assert.equal(third.renders[0].dashboard.ab_advisory.calculation_status,'ERROR');

// Closed/latest-round historical preview behavior must remain intact.
const historical=await run({settlement:{open_session:null},dashboard:{settlement_session:null,ab_advisory:null}});
assert.deepEqual(historical.calls,['/api/ab-advisory-preview?group=SOUTH']);
assert.equal(historical.state.dashboard.ab_advisory.calculation_status,'READY');

// Previous historical read error still yields unambiguous not-ready status.
const historicalError=await run({settlement:{open_session:null},dashboard:null,apiFails:true});
assert.equal(historicalError.calls.length,1);
assert.equal(historicalError.renders[0].dashboard.ab_advisory.calculation_status,'ERROR');

const all=await run({group:'ALL',settlement:open,dashboard:ready});
assert.equal(all.calls.length,0);
assert.equal(all.renders.length,1);

console.log('PASS: active session with incident 200/partial payload never runs A/B preview RPC');
console.log('PASS: missing live advisory displays unavailable without fabricating a zero plan');
console.log('PASS: authoritative live advisory reused unchanged and secondary open-session guard works');
console.log('PASS: historical closed-round read and error handling stay intact');
console.log('PASS: ALL group remains read-only, no network request');
