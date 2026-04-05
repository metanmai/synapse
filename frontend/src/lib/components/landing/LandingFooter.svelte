<footer class="landing-footer">
  <div class="footer-inner">
    <div class="footer-columns">
      <div class="footer-col">
        <h4 class="footer-heading">Product</h4>
        <a href="#features" class="footer-link">Features</a>
        <a href="#how-it-works" class="footer-link">How It Works</a>
      </div>
      <div class="footer-col">
        <h4 class="footer-heading">Company</h4>
        <a href="mailto:metanmai@gmail.com" class="footer-link">Contact</a>
        <a href="https://linkedin.com/in/tanmai-niranjan" class="footer-link" target="_blank" rel="noopener noreferrer">LinkedIn</a>
      </div>
      <div class="footer-col">
        <h4 class="footer-heading">Legal</h4>
        <a href="/privacy" class="footer-link">Privacy</a>
        <a href="/terms" class="footer-link">Terms</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p class="footer-copy">&copy; 2026 Tantencity. All rights reserved.</p>
    </div>
  </div>
</footer>

<style>
  .landing-footer {
    background-color: #461620;
    padding: 4rem 2rem 2rem;
  }

  .footer-inner {
    max-width: 1000px;
    margin: 0 auto;
  }

  .footer-columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3rem;
    margin-bottom: 3rem;
  }

  .footer-col {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .footer-heading {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--color-cream);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 0.25rem;
  }

  .footer-link {
    font-size: 0.9375rem;
    color: var(--color-tan);
    text-decoration: none;
    transition: color 0.2s;
  }

  .footer-link:hover {
    color: var(--color-cream);
  }

  .footer-bottom {
    border-top: 1px solid var(--color-brown);
    padding-top: 1.5rem;
  }

  .footer-copy {
    font-size: 0.8125rem;
    color: var(--color-tan);
    margin: 0;
    text-align: center;
  }

  @media (max-width: 768px) {
    .landing-footer {
      padding: 3rem 1.5rem 1.5rem;
    }

    .footer-columns {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }
</style>
