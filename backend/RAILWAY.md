# Railway backend deployment

Use the original GitHub repository, branch `main`, and service Root Directory
`/backend`. Railway should detect `Dockerfile`; remove any old build/start
command overrides. The container starts Chroma on loopback port 8001, then
FastAPI on Railway's PORT and the ingestion worker. Keep one replica.

Add these service variables using the existing backend environment values:
SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY,
OPENROUTER_API_KEY, PAPERPILOT_COOKIE_SECURE=true.
Never commit their values or put them in frontend VITE variables.

Mount a persistent volume at `/data` for Chroma and graph files. Without a
volume, processing results can disappear on redeploy. Existing local indexes
are not included in the image; papers must be ingested on the deployment.
Volume availability and usage depend on the Railway plan; this setup does not
guarantee zero cost. API and worker each load models, so measure actual memory.

Generate a public service domain. Use `/health` for the health check and allow
time for first model downloads. A successful health response does not prove
ingestion works: upload a PDF, wait for ready status, then ask a question and
verify its citations. Check worker logs if processing stalls.

The dependency versions mirror the local Python environment. A Linux Docker
build is still required to verify wheel availability and compatibility.

Frontend integration is a subsequent step. Current SameSite=Lax cookies need
a same-origin API proxy or a carefully tested authentication configuration;
setting a cross-site API URL alone is insufficient.
