import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchOpenReviewsReviewFirst } from './src/lib/review-first.mjs';

const source = readFileSync('netlify/functions/reviews.mjs', 'utf8');
assert.match(source, /await fetchOpenReviewsReviewFirst\(/);
assert.doesNotMatch(source, /await fetchOpenReviews\(/);
assert.match(source, /requireDashboardAccess\(req\)/);
assert.match(source, /addReviewImageEvidence\(items\)/);

const fakePage = (i, round='round-south-7', overrides={}) => ({
  review_id: i,
  message_record_id: `message-${i}`,
  summary_group_id: 'SOUTH', summary_group_round_id: round,
  line_group_id:'line-1', line_group_name:'South one',
  message_type: i===25405?'image':'text',
  has_image_evidence:i===25405,
  review_created_at: i===25405 ? '2026-10-16T04:41:17Z' : '2026-10-16T04:40:17Z',
  parse_status:'PARTIAL',reason_codes:['OCR_REQUIRED'],warnings:[],
  raw_text: 'A 01=10',ocr_text:'A 01=10',
  ...overrides,
});
const rows = [fakePage(25405),fakePage(25406, 'wrong-round'),fakePage(25407)];
const calls = [];
function query(table) {
  const filters=[];
  return {
    select(cols) { calls.push([table,'select',cols]);return this; },
    eq(field,value) {filters.push([field,value]);return this;},
    in(field,values) {filters.push([field,values]);return this;},
    then(resolve,reject) {
      calls.push([table,'read',filters]);
      const data=table==='settlement_line_group_config'
       ? [{line_group_id:'line-1',summary_group_id:'SOUTH'}]
       : table==='messages' ? [{id:'message-25405',image_storage_path:'safe/evidence.png'}] : [];
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }
  };
}
const client = {
  from: query,
  async rpc(name,args) {
    calls.push(['rpc',name,args]);
    assert.equal(name,'staff_workbench_open_reviews');
    assert.equal(args.p_settlement_session_id,'session-current');
    assert.deepEqual(args.p_line_group_ids,['line-1']);
    assert.equal(args.p_summary_group_id,'SOUTH');
    const data=rows.slice(args.p_offset,args.p_offset+args.p_limit);
    return {data,error:null};
  },
};
const result=await fetchOpenReviewsReviewFirst({client,settlementSessionId:'session-current',summaryGroupId:'SOUTH',roundIds:['round-south-7'],rounds:[{id:'round-south-7',business_date:'2026-10-16'}],pageSize:2});
assert.equal(result.length,2,'wrong Round must be excluded');
assert.deepEqual(result.map(x=>x.id),[25405,25407]);
assert.equal(result[0].image_storage_path,'safe/evidence.png');
assert.equal(result[0].parse_status,'PARTIAL');
assert.equal(result[0].business_date,'2026-10-16');
assert.equal(result[0].source_text,'A 01=10');
assert.deepEqual(calls.filter(c=>c[0]==='rpc').map(c=>c[2].p_offset),[0,2]);
assert.ok(!calls.some(c=>c[0]==='messages' && c[2]?.some?.(f=>f[0]==='id' && f[1]?.length > 1)), 'only image IDs can be fetched');
assert.ok(calls.some(c=>c[0]==='messages'&&c[1]==='read'&&c[2].some(f=>f[0]==='unsent'&&f[1]===false)));
const empty=await fetchOpenReviewsReviewFirst({client,settlementSessionId:'session-current',summaryGroupId:'SOUTH',roundIds:[]});
assert.deepEqual(empty,[]);
console.log('PASS: review-first pages OPEN-only RPC, filters Round, preserves image scope and Review editor contract');
