// What fits the account's plan, checked against the caps stage_begin answers with
// (`limits`: max_file_bytes, max_total_bytes, max_files) before anything is uploaded.
// Pure; unit-tested.

const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * The files that fit the account's plan (stage_begin's `limits`). An optional file (a
 * picture's full-size original beside the lighter copy the page shows) is left out
 * when it doesn't fit; a file the page needs that doesn't fit stops the move, before
 * anything is uploaded, saying which file and what the plan holds.
 * → { keep, dropped }
 */
export function fitToPlan(files, limits = {}, plan = null) {
  const maxFile = Number(limits.max_file_bytes) || Infinity;
  const maxTotal = Number(limits.max_total_bytes) || Infinity;
  const maxFiles = Number(limits.max_files) || Infinity;
  const planName = plan ? `the ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` : "your plan";
  const dropped = [];
  let keep = [];
  for (const f of files) {
    if (f.blob.size <= maxFile) keep.push(f);
    else if (f.optional) dropped.push(f.path);
    else throw Object.assign(new Error(`${f.path} is ${mb(f.blob.size)}, and ${planName} takes files up to ${mb(maxFile)}.`), { code: "too_big" });
  }
  let total = keep.reduce((n, f) => n + f.blob.size, 0);
  if (total > maxTotal) {
    for (const f of [...keep].filter((x) => x.optional).sort((a, b) => b.blob.size - a.blob.size)) {
      if (total <= maxTotal) break;
      keep = keep.filter((x) => x !== f);
      dropped.push(f.path);
      total -= f.blob.size;
    }
    if (total > maxTotal) throw Object.assign(new Error(`These files add up to ${mb(total)}, and ${planName} holds up to ${mb(maxTotal)} in one space.`), { code: "too_big" });
  }
  if (keep.length > maxFiles) throw Object.assign(new Error(`That's ${keep.length} files, and ${planName} holds up to ${maxFiles} in one space.`), { code: "too_big" });
  return { keep, dropped };
}

