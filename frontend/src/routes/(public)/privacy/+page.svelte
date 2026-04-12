<svelte:head>
  <title>Privacy Policy — Synapse</title>
  <meta name="description" content="Synapse privacy policy: what data we collect, how we use it, and your rights." />
</svelte:head>

<div class="legal-page">
  <div class="legal-container">
    <h1>Privacy Policy</h1>
    <p class="last-updated">Last updated: March 29, 2026</p>

    <h2>What Synapse Is</h2>
    <p>Synapse is a context management tool that stores knowledge as files in a cloud workspace. It has a web application, a backend API, and an MCP server for AI tool integration.</p>

    <h2>Data We Collect</h2>
    <h3>Account Information</h3>
    <p>When you sign up, we collect your email address and authentication credentials. If you sign in with Google or GitHub, we receive your email and basic profile information from those providers.</p>

    <h3>Workspace Content</h3>
    <p>Files, notes, decisions, and other content you store in your Synapse workspace. This includes file paths, tags, and content you create or import.</p>

    <h3>Conversation Data (Plus plan)</h3>
    <p>If you use conversation sync, we store conversation transcripts and associated media that you choose to sync.</p>

    <h3>Activity Logs</h3>
    <p>We log actions within your workspace (file creation, edits, deletions, sharing) for the activity feed feature. Logs include the action type, timestamp, and source (web or MCP).</p>

    <h3>Usage Data</h3>
    <p>We use Plausible Analytics for anonymous, cookie-free page view tracking. No personal data is sent to Plausible.</p>

    <h2>Encryption & Data Access</h2>
    <p>Synapse supports optional end-to-end encryption using AES-256-GCM. When enabled with a passphrase, your content is encrypted client-side before reaching our servers. We cannot read encrypted content — this is zero-knowledge encryption. Your passphrase is never transmitted or stored.</p>
    <p><strong>We do not read, access, or inspect your workspace content — encrypted or not.</strong> Your data is stored solely to provide the service back to you. We have no internal tools, dashboards, or processes that display user content. Our backend uses a service key for API operations, but no human at Synapse views your files, conversations, or insights.</p>

    <h2>How We Use Your Data</h2>
    <ul>
      <li>To provide and maintain the Synapse service</li>
      <li>To authenticate you and manage your account</li>
      <li>To process payments and manage subscriptions</li>
      <li>To display activity feeds within your projects</li>
      <li>To improve the service based on anonymous usage patterns</li>
    </ul>
    <p>We do not sell your data. We do not use your workspace content to train AI models.</p>

    <h2>Third-Party Services</h2>
    <ul>
      <li><strong>Supabase</strong> — Database and authentication. Your data is stored in Supabase-managed PostgreSQL. <a href="https://supabase.com/privacy" target="_blank" rel="noopener">Supabase Privacy Policy</a></li>
      <li><strong>Cloudflare</strong> — Backend hosting and CDN. <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Cloudflare Privacy Policy</a></li>
      <li><strong>Creem</strong> — Payment processing. We do not store your payment card details. <a href="https://creem.io/privacy" target="_blank" rel="noopener">Creem Privacy Policy</a></li>
      <li><strong>Plausible</strong> — Privacy-focused, cookie-free web analytics. <a href="https://plausible.io/data-policy" target="_blank" rel="noopener">Plausible Data Policy</a></li>
    </ul>

    <h2>Data Retention</h2>
    <p>Your workspace content is retained as long as your account is active. Activity logs are retained indefinitely for the activity feed feature. If you delete your account, all associated data (workspace content, activity logs, API keys, subscriptions) is permanently deleted.</p>

    <h2>Your Rights</h2>
    <ul>
      <li><strong>Export</strong> — You can export your entire workspace as a ZIP file at any time.</li>
      <li><strong>Delete</strong> — You can delete individual files, or delete your entire account from the account settings page. Account deletion is permanent and irreversible.</li>
      <li><strong>Access</strong> — All your data is visible to you in the application.</li>
    </ul>

    <h2>Security</h2>
    <p>We use HTTPS for all connections, enforce rate limiting on API endpoints, hash API keys with SHA-256, and support optional end-to-end encryption. Access to your workspace requires authentication via JWT or API key.</p>

    <h2>Changes to This Policy</h2>
    <p>We may update this policy from time to time. Changes will be posted on this page with an updated "Last updated" date.</p>

    <h2>Contact</h2>
    <p>Questions about this policy? Email <a href="mailto:metanmai@gmail.com">metanmai@gmail.com</a> or reach out on <a href="https://linkedin.com/in/tanmai-niranjan" target="_blank" rel="noopener noreferrer">LinkedIn</a>.</p>
  </div>
</div>

<style>
  .legal-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }

  .legal-container {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: 24px;
    padding: 3rem;
    box-shadow: var(--glass-shadow);
  }

  h1 {
    font-size: 2rem;
    font-weight: 900;
    margin-bottom: 0.25rem;
    color: var(--color-burgundy);
  }

  .last-updated {
    font-size: 0.85rem;
    color: var(--color-brown);
    opacity: 0.7;
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin-top: 2rem;
    margin-bottom: 0.5rem;
    color: var(--color-burgundy);
  }

  h3 {
    font-size: 1rem;
    font-weight: 700;
    margin-top: 1rem;
    margin-bottom: 0.25rem;
    color: var(--color-brown);
  }

  p, li {
    font-size: 0.95rem;
    line-height: 1.7;
    color: var(--color-burgundy);
    opacity: 0.85;
  }

  ul {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  li {
    margin-bottom: 0.35rem;
  }

  a {
    color: var(--color-brown);
    text-decoration: underline;
  }

  a:hover {
    opacity: 0.7;
  }
</style>
