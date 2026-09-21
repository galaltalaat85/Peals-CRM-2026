# Pearls Construction CRM

Files:
- index.html   the CRM (dashboard, leads, pipeline, analytics). The logo is built in.
- api/leads.js the server function that saves leads in Upstash Redis
- logo.png     your logo, cropped (optional, already embedded in index.html)

Environment variables (Vercel > Project > Settings > Environment Variables):
- CRM_PASSWORD  the password people type to open the CRM
- KV_REST_API_URL and KV_REST_API_TOKEN  added automatically when you connect Upstash Redis in the Storage tab

Optional: to skip the login screen, put the password in index.html on the line
  const BUILT_IN_PASSWORD='';
Anyone who opens the page can read it there.
