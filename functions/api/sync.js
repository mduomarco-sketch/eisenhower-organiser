// Cloudflare Pages Function: POST /api/sync
// Starts the Claude Code routine right away (same as "Run now" on claude.ai).
//
// The routine's fire URL and token live ONLY in the Pages project's
// environment secrets (Settings -> Variables and Secrets):
//   ROUTINE_FIRE_URL  e.g. https://api.anthropic.com/v1/claude_code/routines/<trigger-id>/fire
//   ROUTINE_TOKEN     the token generated for that routine's API trigger
// They never reach the browser. The whole site, this endpoint included, sits
// behind Cloudflare Access, so only allowed emails can call it.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  // Only accept calls from the app's own pages.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, error: 'Forbidden origin.' }, 403);
  }

  if (!env.ROUTINE_FIRE_URL || !env.ROUTINE_TOKEN) {
    return json(
      {
        ok: false,
        error:
          'Sync is not set up yet: ROUTINE_FIRE_URL / ROUTINE_TOKEN secrets are missing.',
      },
      500,
    );
  }

  let res;
  try {
    res = await fetch(env.ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ROUTINE_TOKEN}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    return json({ ok: false, error: 'Could not reach Claude. Try again later.' }, 502);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON body: keep the empty object.
  }

  if (res.status === 429) {
    return json({ ok: false, error: 'Too many syncs, try later.' }, 429);
  }
  if (!res.ok) {
    const detail = data?.error?.message ? `: ${data.error.message}` : '';
    return json(
      { ok: false, error: `Claude refused the sync (${res.status})${detail}` },
      502,
    );
  }

  const sessionUrl =
    data.claude_code_session_url ||
    data.session_url ||
    data.sessionUrl ||
    data.url ||
    null;
  return json({ ok: true, sessionUrl });
}
