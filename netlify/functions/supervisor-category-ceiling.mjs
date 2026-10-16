import { authenticateWorkbenchActor } from '../../src/lib/staff-access.mjs';
import { supabase as supervisorAuthClient } from '../../src/lib/dashboard-api.mjs';
import { canReadSupervisorCategoryCeiling } from '../../src/lib/supervisor-category-access.mjs';
import { timingSafeEqual } from 'node:crypto';
import { json, supabase, bangkokToday } from '../../src/lib/dashboard-api.mjs';

const CATEGORIES = ['A', 'B', 'E', 'F'];
const READ_TIMEOUT_MS = 9000;

function safeEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function checkedQuantity(raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw Error('UNSAFE_ORDER_TOTAL');
  return value;
}

function checkedMoney(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw Error('UNSAFE_NET_TOTAL');
  return value;
}

async function query(signal, makeQuery) {
  const result = await makeQuery().abortSignal(signal);
  if (result.error) throw result.error;
  return result.data || [];
}

async function readReport(date, requestedIds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    // Three bounded metadata reads / one category aggregate RPC on explicit page refresh.
    const availableGroups = await query(controller.signal, () => supabase.from('summary_groups')
      .select('id,name').eq('enabled', true).order('id'));
    const validIds = new Set(availableGroups.map(g => g.id));
    if (requestedIds !== null && (!requestedIds.length || requestedIds.some(id => !validIds.has(id)))) {
      const error = new Error('INVALID_SUMMARY_GROUP_SELECTION');
      error.httpStatus = 400;
      throw error;
    }
    const selectedSet = new Set(requestedIds === null
      ? availableGroups.map(g => g.id) : requestedIds);
    const groups = availableGroups.filter(g => selectedSet.has(g.id));
    const selectedIds = groups.map(g => g.id);
    const [cursors, rawCodes] = await Promise.all([
      query(controller.signal, () => supabase.from('summary_group_round_runtime_state')
        .select('summary_group_id,latest_round_id,latest_business_date')),
      query(controller.signal, () => supabase.rpc(
        'supervisor_category_ceiling_report_v4',
        { p_summary_group_ids: selectedIds }
      )),
    ]);
    const latest = new Map(cursors.map(row => [row.summary_group_id, row]));
    const ids = groups.map(g => latest.get(g.id)?.latest_round_id).filter(Boolean);
    const rounds = ids.length ? await query(controller.signal, () => supabase
      .from('settlement_summary_group_rounds')
      .select('id,summary_group_id,settlement_session_id,business_date,status')
      .in('id', ids)) : [];
    const byId = new Map(rounds.map(row => [row.id, row]));
    const scope = groups.map(g => {
      const cursor = latest.get(g.id);
      const round = byId.get(cursor?.latest_round_id);
      return {
        id: g.id, name: g.name,
        round_status: round?.status || null,
        business_date: round?.business_date || null,
        included: Boolean(cursor && round && cursor.latest_business_date === round.business_date &&
          round.summary_group_id === g.id &&
          ['OPEN', 'CLOSED'].includes(round.status)),
      };
    });
    const includedIds = new Set(scope.filter(s => s.included).map(s => s.id));
    const selected = rounds.filter(r => includedIds.has(r.summary_group_id) &&
      latest.get(r.summary_group_id)?.latest_round_id === r.id);
    const sessionIds = [...new Set(selected.map(r => r.settlement_session_id))];
    const profiles = sessionIds.length ? await query(controller.signal, () => supabase
      .from('settlement_point_profiles')
      .select('settlement_session_id,category,special_multiplier,max_special_codes')
      .in('settlement_session_id', sessionIds)
      .in('category', CATEGORIES)) : [];
    const profileMap = {};
    for (const category of CATEGORIES) {
      const found = profiles.filter(p => p.category === category);
      const keys = new Set(found.map(p => `${p.special_multiplier}|${p.max_special_codes}`));
      const good = found.length === sessionIds.length && keys.size === 1 &&
        Number(found[0]?.special_multiplier) > 0 &&
        Number.isSafeInteger(Number(found[0]?.max_special_codes)) &&
        Number(found[0]?.max_special_codes) > 0;
      profileMap[category] = {
        status: good ? 'READY' : found.length === sessionIds.length && keys.size > 1
          ? 'PROFILE_CONFLICT' : 'PROFILE_UNAVAILABLE',
        multiplier: good ? Number(found[0].special_multiplier) : null,
        max_special_codes: good ? Number(found[0].max_special_codes) : null,
      };
    }
    const selectedDates = [...new Set(scope.filter(s => s.included && s.business_date)
      .map(s => s.business_date))].sort();
    return {
      ok: true,
      business_date: selectedDates.length === 1 ? selectedDates[0] : date,
      business_dates: selectedDates,
      mixed_business_dates: selectedDates.length > 1,
      fetched_at: new Date().toISOString(),
      available_groups: availableGroups,
      selected_group_ids: selectedIds,
      scope,
      complete_scope: scope.length > 0 && scope.every(row => row.included),
      profiles: profileMap,
      rows: rawCodes.map(row => ({
        category: row.category,
        code: String(row.code),
        order_total: checkedQuantity(row.order_total),
        net_total: checkedMoney(row.net_total),
        summary_group_count: checkedQuantity(row.summary_group_count),
      })),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);
  try {
    // Reuse the existing Dashboard/Staff credential classification on the server.
    // Empty reviewer code avoids an optional staff_accounts query for Dashboard key.
    const auth = await authenticateWorkbenchActor(req, {
      client: supervisorAuthClient,
      dashboardReviewerStaffCode: '',
    });
    if (!auth.ok) {
      return json({ ok:false, error:auth.error }, auth.status);
    }
    if (!canReadSupervisorCategoryCeiling(auth.actor)) {
      return json({ ok:false, error:'FORBIDDEN' }, 403);
    }
    const queryParams = new URL(req.url).searchParams;
    const requested = queryParams.getAll('group');
    if (requested.length > 64 || requested.some(id => !/^[A-Z0-9_-]{1,64}$/.test(id)) ||
        new Set(requested).size !== requested.length) {
      return json({ ok:false, error:'INVALID_SUMMARY_GROUP_SELECTION' }, 400);
    }
    return json(await readReport(bangkokToday(), requested.length ? requested : null));
  } catch (error) {
    if (error?.httpStatus === 400) return json({ok:false,error:'INVALID_SUMMARY_GROUP_SELECTION'},400);
    console.error('supervisor category ceiling report failed', error?.message || error);
    return json({ ok:false, error:'SUPERVISOR_CATEGORY_REPORT_UNAVAILABLE' }, 503);
  }
}

export const config = { path:'/api/supervisor-category-ceiling', region:'sin' };
