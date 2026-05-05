# Cloudwave Deployment

Cloudwave now has two modes:

- Opening `index.html` directly: local demo mode. Registration stays on that browser only.
- Running `node server.js`: shared app mode. Multiple people can register and see shared listings.

## Run Locally

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:3000
```

## Host It

Use a Node hosting service, not static Netlify Drop. Static hosting cannot store shared users.

Recommended settings:

- Build command: leave blank
- Start command: `node server.js`
- Node version: 18 or newer

The app stores MVP data in:

```text
data/cloudwave-db.json
```

For a serious production launch, replace this JSON file with PostgreSQL, Supabase, Firebase, or another managed database.
