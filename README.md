# Pearls Construction CRM

Files:
- index.html   the CRM (dashboard, leads, pipeline, analytics, team). The logo is built in.
- api/leads.js the server function that saves leads and the team in Upstash Redis
- logo.png     your logo, cropped (optional, already embedded in index.html)

Environment variables (Vercel > Project > Settings > Environment Variables):
- CRM_PASSWORD  the ADMIN password
- KV_REST_API_URL and KV_REST_API_TOKEN  added automatically when you connect Upstash Redis in the Storage tab
- ADMIN_NAME (optional)  the admin's name shown in activity logs, e.g. Galal. Default: Admin

## Signing in
- Admin: leave Email empty and type CRM_PASSWORD. The admin sees every lead, assigns leads and manages the team.
- Business development team: each person signs in with their own email and password.
  They see and edit only the leads assigned to them. Leads they add are assigned to them.

## Team and assigning leads
- Team page (admin only): add a person with name, email and password. Edit renames them or resets the password.
  Removing a person moves their leads back to Unassigned.
- Open a lead and choose "Assigned to". After saving, select "Email them" to open a ready email with the lead details.
- The Team page shows each person's leads, open value, wins, win rate and overdue follow-ups. Select a row to see their leads.
- Every activity entry records who did it.

Optional: to skip the login screen, put the admin password in index.html on the line
  const BUILT_IN_PASSWORD='';
Anyone who opens the page can read it there.
