<svelte:head>
  <title>Terms of Service — Synapse</title>
  <meta name="description" content="Synapse terms of service: acceptable use, subscriptions, and limitations." />
</svelte:head>

<div class="legal-page">
  <div class="legal-container">
    <h1>Terms of Service</h1>
    <p class="last-updated">Last updated: March 29, 2026</p>

    <h2>Agreement</h2>
    <p>By using Synapse ("the Service"), you agree to these terms. If you do not agree, do not use the Service.</p>

    <h2>The Service</h2>
    <p>Synapse is a context management tool that lets you store, organize, and sync knowledge across AI tools and devices. It includes a web application, a backend API, and an MCP server package (<code>synapsesync-mcp</code>).</p>

    <h2>Accounts</h2>
    <ul>
      <li>You must provide a valid email address to create an account.</li>
      <li>You are responsible for keeping your account credentials and API keys secure.</li>
      <li>You must be at least 13 years old to use the Service.</li>
      <li>One person or entity per account. Shared team access is available through project membership.</li>
    </ul>

    <h2>Subscriptions & Billing</h2>
    <ul>
      <li><strong>Free plan</strong> — Up to 50 files, 3 connections, 2 project members. No payment required.</li>
      <li><strong>Plus plan</strong> — Expanded limits and additional features including conversation sync. Billed monthly via Creem.</li>
      <li>You can cancel your subscription at any time from the account settings page. Access continues until the end of the current billing period.</li>
      <li>Refunds are handled on a case-by-case basis. Contact us if you believe you were charged in error.</li>
    </ul>

    <h2>Your Content</h2>
    <ul>
      <li>You own everything you store in Synapse. We do not claim any rights to your content.</li>
      <li>You grant us the limited right to store, process, and transmit your content solely to provide the Service.</li>
      <li>If you enable end-to-end encryption, your content is encrypted before reaching our servers and we cannot access it.</li>
      <li>You can export or delete your content at any time.</li>
    </ul>

    <h2>Acceptable Use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>Use the Service for any illegal purpose</li>
      <li>Attempt to gain unauthorized access to the Service or other users' accounts</li>
      <li>Interfere with or disrupt the Service infrastructure</li>
      <li>Exceed rate limits or abuse API endpoints</li>
      <li>Resell access to the Service without permission</li>
      <li>Store content that violates applicable laws</li>
    </ul>

    <h2>API & MCP Usage</h2>
    <ul>
      <li>API access is subject to rate limiting (120 requests per minute per key).</li>
      <li>API keys should be kept secret. If a key is compromised, revoke it immediately from the account settings.</li>
      <li>We may suspend API access if usage patterns suggest abuse.</li>
    </ul>

    <h2>Availability</h2>
    <p>We aim to keep Synapse available at all times, but we do not guarantee uptime. The Service is provided "as is" without warranties of any kind. We are not liable for data loss — while we take reasonable measures to protect your data, you are responsible for maintaining your own backups.</p>

    <h2>Termination</h2>
    <ul>
      <li>You can delete your account at any time from the account settings page. This permanently deletes all your data.</li>
      <li>We may suspend or terminate accounts that violate these terms, with notice where possible.</li>
    </ul>

    <h2>Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, Synapse and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, or goodwill arising from your use of the Service.</p>

    <h2>Changes to These Terms</h2>
    <p>We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the new terms. Material changes will be communicated via the email on your account.</p>

    <h2>Contact</h2>
    <p>Questions about these terms? Email <a href="mailto:metanmai@gmail.com">metanmai@gmail.com</a> or reach out on <a href="https://linkedin.com/in/tanmai-niranjan" target="_blank" rel="noopener noreferrer">LinkedIn</a>.</p>
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

  code {
    background: rgba(86, 28, 36, 0.08);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  a {
    color: var(--color-brown);
    text-decoration: underline;
  }

  a:hover {
    opacity: 0.7;
  }
</style>
