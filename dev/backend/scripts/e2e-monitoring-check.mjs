const backendBase = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:4000";
const modelBase = process.env.MODEL_BASE_URL ?? "http://127.0.0.1:8000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed (${res.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

async function main() {
  console.log(`Checking model service: ${modelBase}/health`);
  const modelHealth = await requestJson(`${modelBase}/health`);
  console.log("Model health:", modelHealth);

  const stamp = Date.now();
  const email = `queue.test.${stamp}@example.com`;
  const password = "ValidPass1!";

  console.log("Creating user...");
  await requestJson(`${backendBase}/bhoomi/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "queue_test", email, password })
  });

  console.log("Signing in...");
  const signin = await requestJson(`${backendBase}/bhoomi/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!signin?.token) {
    throw new Error("Signin response missing token");
  }

  const authHeaders = {
    "content-type": "application/json",
    token: signin.token
  };

  console.log("Creating AOI...");
  const aoiResp = await requestJson(`${backendBase}/bhoomi/aoi`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "Queue Test AOI",
      sourceType: "polygon",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [77.55, 30.34],
            [77.56, 30.34],
            [77.56, 30.35],
            [77.55, 30.35],
            [77.55, 30.34]
          ]
        ]
      },
      metadata: { createdBy: "e2e-script" }
    })
  });

  const aoiId = aoiResp?.aoi?.id;
  if (!aoiId) {
    throw new Error("AOI create response missing aoi.id");
  }

  console.log("Queueing monitoring run...");
  const runResp = await requestJson(`${backendBase}/bhoomi/monitoring/runs`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      aoiId,
      baselineMode: "rolling",
      baselineYears: 5,
      baselineLagYears: 2,
      configOverrides: {
        deforestationPct: 0.7,
        urbanExpPct: 1.1,
        waterDegPct: 0.2
      }
    })
  });

  const runId = runResp?.runId;
  if (!runId) {
    throw new Error("Run queue response missing runId");
  }

  console.log(`Polling run status for ${runId}...`);
  let finalRun = null;
  for (let i = 0; i < 20; i += 1) {
    const runStatusResp = await requestJson(`${backendBase}/bhoomi/monitoring/runs/${runId}`, {
      method: "GET",
      headers: { token: signin.token }
    });

    const status = runStatusResp?.run?.status;
    process.stdout.write(`Attempt ${i + 1}: ${status}\n`);

    if (status === "succeeded" || status === "failed") {
      finalRun = runStatusResp.run;
      break;
    }

    await sleep(1000);
  }

  if (!finalRun) {
    throw new Error("Run did not finish within polling window");
  }

  console.log("Final status:", finalRun.status);
  console.log("Threat metrics:", Array.isArray(finalRun.threatMetrics) ? finalRun.threatMetrics.length : 0);
  console.log("Has report:", !!finalRun.report);

  if (finalRun.status !== "succeeded") {
    throw new Error(`Run finished with status=${finalRun.status} error=${finalRun.errorMessage ?? ""}`);
  }

  console.log("E2E monitoring queue check passed.");
}

main().catch((err) => {
  console.error("E2E monitoring queue check failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
