import {
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

// Legacy -background filename deliberately selects Netlify asynchronous
// invocation (202) with extended background execution time.
// All work is sourced from the durable, Round-scoped cleanup queue; the
// OPEN operation itself is already committed and is never retried here.
export default async function handler(req) {
  const denied = requireDashboardAccess(req);
  if (denied) throw new Error("CLEANUP_UNAUTHORIZED");
  if (req.method !== "POST") throw new Error("CLEANUP_METHOD_NOT_ALLOWED");
  const body = await req.json();
  const group = String(body?.summary_group_id || "").trim();
  const retiringRound = String(body?.retiring_round_id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(group)
    || !/^[0-9a-fA-F-]{36}$/.test(retiringRound)) {
    throw new Error("INVALID_CLEANUP_SCOPE");
  }
  // Only remove explicitly queued objects from the retired Round.
  // Each successful bucket deletion clears its corresponding queue rows.
  const started = Date.now();
  let deleted = 0;
  let batches = 0;
  while (Date.now() - started < 8 * 60_000) {
    const { data: jobs, error } = await supabase
      .from("settlement_round_storage_cleanup_queue")
      .select("id,storage_bucket,storage_path")
      .eq("summary_group_id", group)
      .eq("round_id", retiringRound)
      .in("status", ["PENDING", "FAILED"])
      .order("queued_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    if (!(jobs || []).length) {
      console.log("ROUND_STORAGE_CLEANUP_PASS", group, retiringRound,
        "objects=" + deleted, "batches=" + batches);
      return;
    }
    const byBucket = new Map();
    for (const job of jobs) {
      if (!job.storage_path || !job.storage_bucket) continue;
      if (!byBucket.has(job.storage_bucket)) byBucket.set(job.storage_bucket, []);
      byBucket.get(job.storage_bucket).push(job);
    }
    if (byBucket.size === 0) throw new Error("CLEANUP_INVALID_QUEUE_ROWS");
    for (const [bucket, bucketJobs] of byBucket) {
      const paths = [...new Set(bucketJobs.map(j => j.storage_path))];
      const ids = bucketJobs.map(j => j.id);
      const { error: removeError } = await supabase.storage
        .from(bucket).remove(paths);
      if (removeError) {
        const { error: recordError } = await supabase
          .from("settlement_round_storage_cleanup_queue")
          .update({
            status: "FAILED",
            attempted_at: new Date().toISOString(),
            last_error: String(removeError.message || removeError).slice(0, 1000),
          })
          .in("id", ids);
        if (recordError) console.error("cleanup failure record failed", recordError);
        throw removeError;
      }
      const { error: deleteError } = await supabase
        .from("settlement_round_storage_cleanup_queue")
        .delete().in("id", ids);
      if (deleteError) throw deleteError;
      deleted += paths.length;
    }
    batches += 1;
  }
  // Netlify background execution retry resumes using remaining queue rows.
  throw new Error("CLEANUP_TIME_BUDGET_RETRY");
}

export const config = {
  path: "/api/settlement-storage-cleanup-background",
  region: "sin",
};
