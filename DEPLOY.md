# Cloudwave Deploy Notes

## Render

Use this start command:

```sh
node server.js
```

Set these environment variables:

```sh
NODE_ENV=production
ADMIN_CODE=your-private-admin-code
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=Cloudwave <onboarding@resend.dev>
APP_URL=https://your-render-app.onrender.com
```

`RESEND_API_KEY` enables real password reset emails. `FROM_EMAIL` must be a sender that Resend allows. For first tests, Resend's default onboarding sender may only send to your own verified email; for real users, verify your domain in Resend and use that domain.
