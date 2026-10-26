// Candidate only. Dependency-injected, read-only HTTP core. No production wiring here.
export const CATEGORIES = Object.freeze(['A','B','E','F','H','L']);
const GROUP_RE = /^[A-Z0-9_-]{1,64}$/;
const LINE_RE = /^[A-Za-z0-9_-]{1,100}$/;
const CODE_RE = /^\d{1,3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_GROUPS = 64;
const PAGE_SIZE = 50;
const json = (value, status=200) => new Response(JSON.stringify(value), {
  status,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
});
const bad = (code,status) => json({ok:false,error:code},status);
function parseCursor(encoded) {
  if (!encoded) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(encoded)) throw Error('INVALID_CURSOR');
  let c;
  try { c = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')); }
  catch { throw Error('INVALID_CURSOR'); }
  if (!c || !Number.isSafeInteger(c.quantity) || c.quantity <= 0 ||
      typeof c.event_timestamp !== 'string' || !TIME_RE.test(c.event_timestamp) ||
      !Number.isFinite(Date.parse(c.event_timestamp)) ||
      typeof c.message_record_id !== 'string' || !UUID_RE.test(c.message_record_id) ||
      Object.keys(c).sort().join(',') !== 'event_timestamp,message_record_id,quantity') {
    throw Error('INVALID_CURSOR');
  }
  return c;
}
export function encodeCursor(cursor) { return Buffer.from(JSON.stringify(cursor),'utf8').toString('base64url'); }
export function createCodeAuditReadHandler({authenticate, getLineGroups, getSummary, getDetail}) {
  return async function handle(req,kind) {
    if (req.method !== 'GET') return bad('METHOD_NOT_ALLOWED',405);
    try {
      const url = new URL(req.url);
      const auth = await authenticate(req);
      if (!auth?.ok) return bad('UNAUTHORIZED',auth?.status === 403 ? 403 : 401);
      if (auth.actor?.kind !== 'STAFF' ||
          !auth.actor?.staff_id ||
          !['ADMIN','SUPERVISOR'].includes(String(auth.actor?.role).toUpperCase())) return bad('FORBIDDEN',403);
      const assignments = await getLineGroups(auth.actor);
      if (!Array.isArray(assignments)) throw Error('INVALID_SCOPE');
      const eligible = assignments.filter(x=>GROUP_RE.test(String(x.summary_group_id||'')) && LINE_RE.test(String(x.line_group_id||'')));
      if (!eligible.length) return bad('NO_AUTHORIZED_LINE_GROUPS',403);
      const validGroups = [...new Set(eligible.map(x=>x.summary_group_id))].sort();
      const requested = url.searchParams.getAll('group');
      if (requested.length > MAX_GROUPS || requested.some(x=>!GROUP_RE.test(x)) ||
          new Set(requested).size !== requested.length || requested.some(x=>!validGroups.includes(x))) return bad('INVALID_GROUP_SCOPE',400);
      const groups = requested.length ? requested : validGroups;
      if (groups.length > MAX_GROUPS) return bad('SCOPE_TOO_LARGE',400);
      const lineSelection = url.searchParams.getAll('line_group');
      if (lineSelection.length > 1 || (lineSelection.length && !LINE_RE.test(lineSelection[0]))) return bad('INVALID_LINE_GROUP',400);
      const lines = [...new Set(eligible.filter(x=>groups.includes(x.summary_group_id)).map(x=>x.line_group_id))].sort();
      if (lineSelection.length && !lines.includes(lineSelection[0])) return bad('INVALID_LINE_GROUP_SCOPE',403);
      const selectedLines = lineSelection.length ? lineSelection : lines;
      if (!selectedLines.length) return bad('NO_AUTHORIZED_LINE_GROUPS',403);
      if (kind==='detail' && (url.searchParams.getAll('category').length !== 1 || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('cursor').length > 1)) return bad('INVALID_CODE',400);
      const {category,code} = Object.fromEntries(['category','code'].map(k=>[k,url.searchParams.get(k)]));
      if (kind==='detail' && (!CATEGORIES.includes(category) || !CODE_RE.test(code||''))) return bad('INVALID_CODE',400);
      if (kind!=='detail' && kind!=='summary') return bad('INVALID_API_KIND',404);
      if (kind==='summary' && (url.searchParams.has('cursor') || url.searchParams.has('category') || url.searchParams.has('code'))) return bad('INVALID_SUMMARY_PARAMS',400);
      const cursor = kind==='detail' ? parseCursor(url.searchParams.get('cursor')) : null;
      const args = {groups,lines:selectedLines,category,code,cursor,pageSize:PAGE_SIZE};
      const data = kind==='summary' ? await getSummary(args) : await getDetail(args);
      if (!data || !Array.isArray(data.rows) || (kind==='detail' && (typeof data.has_more!=='boolean' || data.rows.length>PAGE_SIZE))) throw Error('INVALID_READ_MODEL');
      const next = kind==='detail' && data.has_more ? data.next_cursor : null;
      if (next && (!Number.isSafeInteger(next.quantity)|| !UUID_RE.test(String(next.message_record_id)) || !TIME_RE.test(String(next.event_timestamp)))) throw Error('INVALID_READ_MODEL');
      return json({ok:true,scope:{summary_groups:groups,line_groups:selectedLines},...data,
        ...(kind==='detail'?{next_cursor:next ? encodeCursor(next):null}:{}),
      });
    } catch (error) {
      if (error?.message === 'INVALID_CURSOR') return bad('INVALID_CURSOR',400);
      // Never send database or authentication exceptions to browsers.
      return bad('CODE_AUDIT_READ_UNAVAILABLE',503);
    }
  };
}
