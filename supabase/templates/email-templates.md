# Supabase Email Templates

Paste these into Supabase → Authentication → Email Templates.

---

## Confirm Signup

**Subject:** Confirm your Synapse account

```html
<div style="max-width: 480px; margin: 0 auto; font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #E8D8C4; padding: 40px 24px; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #561C24; font-size: 24px; font-weight: 900; margin: 0;">Synapse</h1>
  </div>
  <div style="background-color: #FFFDF8; border-radius: 12px; padding: 32px 24px; border: 1px solid #C7B7A3;">
    <h2 style="color: #561C24; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Welcome aboard</h2>
    <p style="color: #561C24; opacity: 0.7; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
      Click the button below to confirm your email and start giving your AI tools persistent memory.
    </p>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; background-color: #6D2932; color: #E8D8C4; padding: 14px 32px; border-radius: 9999px; font-size: 15px; font-weight: 700; text-decoration: none;">Confirm Email</a>
    </div>
    <p style="color: #C7B7A3; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
      If you didn't create a Synapse account, you can safely ignore this email.
    </p>
  </div>
  <div style="text-align: center; margin-top: 24px;">
    <p style="color: #561C24; opacity: 0.4; font-size: 12px; margin: 0;">synapsesync.app</p>
  </div>
</div>
```

---

## Magic Link

**Subject:** Your Synapse login link

```html
<div style="max-width: 480px; margin: 0 auto; font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #E8D8C4; padding: 40px 24px; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #561C24; font-size: 24px; font-weight: 900; margin: 0;">Synapse</h1>
  </div>
  <div style="background-color: #FFFDF8; border-radius: 12px; padding: 32px 24px; border: 1px solid #C7B7A3;">
    <h2 style="color: #561C24; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Sign in to Synapse</h2>
    <p style="color: #561C24; opacity: 0.7; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
      Click the button below to sign in. This link expires in 10 minutes.
    </p>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; background-color: #6D2932; color: #E8D8C4; padding: 14px 32px; border-radius: 9999px; font-size: 15px; font-weight: 700; text-decoration: none;">Sign In</a>
    </div>
    <p style="color: #C7B7A3; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
      If you didn't request this link, you can safely ignore this email.
    </p>
  </div>
  <div style="text-align: center; margin-top: 24px;">
    <p style="color: #561C24; opacity: 0.4; font-size: 12px; margin: 0;">synapsesync.app</p>
  </div>
</div>
```

---

## Reset Password

**Subject:** Reset your Synapse password

```html
<div style="max-width: 480px; margin: 0 auto; font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #E8D8C4; padding: 40px 24px; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #561C24; font-size: 24px; font-weight: 900; margin: 0;">Synapse</h1>
  </div>
  <div style="background-color: #FFFDF8; border-radius: 12px; padding: 32px 24px; border: 1px solid #C7B7A3;">
    <h2 style="color: #561C24; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Reset your password</h2>
    <p style="color: #561C24; opacity: 0.7; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
      Click the button below to reset your password. This link expires in 1 hour.
    </p>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; background-color: #6D2932; color: #E8D8C4; padding: 14px 32px; border-radius: 9999px; font-size: 15px; font-weight: 700; text-decoration: none;">Reset Password</a>
    </div>
    <p style="color: #C7B7A3; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
      If you didn't request a password reset, you can safely ignore this email.
    </p>
  </div>
  <div style="text-align: center; margin-top: 24px;">
    <p style="color: #561C24; opacity: 0.4; font-size: 12px; margin: 0;">synapsesync.app</p>
  </div>
</div>
```

---

## Invite User

**Subject:** You've been invited to Synapse

```html
<div style="max-width: 480px; margin: 0 auto; font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #E8D8C4; padding: 40px 24px; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #561C24; font-size: 24px; font-weight: 900; margin: 0;">Synapse</h1>
  </div>
  <div style="background-color: #FFFDF8; border-radius: 12px; padding: 32px 24px; border: 1px solid #C7B7A3;">
    <h2 style="color: #561C24; font-size: 20px; font-weight: 700; margin: 0 0 12px;">You're invited</h2>
    <p style="color: #561C24; opacity: 0.7; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
      You've been invited to join Synapse — a shared context layer for AI tools. Click below to accept and create your account.
    </p>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; background-color: #6D2932; color: #E8D8C4; padding: 14px 32px; border-radius: 9999px; font-size: 15px; font-weight: 700; text-decoration: none;">Accept Invite</a>
    </div>
    <p style="color: #C7B7A3; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
      If you weren't expecting this invite, you can safely ignore this email.
    </p>
  </div>
  <div style="text-align: center; margin-top: 24px;">
    <p style="color: #561C24; opacity: 0.4; font-size: 12px; margin: 0;">synapsesync.app</p>
  </div>
</div>
```
