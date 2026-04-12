<script lang="ts">
import ScrollReveal from "./ScrollReveal.svelte";

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: FaqItem[] = [
  {
    question: "What AI tools does Synapse work with?",
    answer:
      "Synapse works with any AI tool that supports the Model Context Protocol (MCP), including Claude, ChatGPT, Cursor, Windsurf, and GitHub Copilot. If your tool supports MCP servers, it works with Synapse.",
  },
  {
    question: "Is my data encrypted?",
    answer:
      "Yes. All data is encrypted in transit with TLS. You can also enable end-to-end encryption with a passphrase, which means even we cannot read your files. Your passphrase never leaves your device.",
  },
  {
    question: "Can I use Synapse with my team?",
    answer:
      "Absolutely. The Plus plan supports team workspaces where multiple people can share context, decisions, and architecture notes. Every team member's AI tools stay in sync automatically.",
  },
  {
    question: "What happens when I hit the free tier limit?",
    answer:
      "The free tier includes 50 files and 3 connected devices. When you hit the limit, your existing files remain accessible. You just cannot create new ones until you upgrade to Plus or delete some files.",
  },
  {
    question: "How does the MCP server work?",
    answer:
      "The MCP server runs locally on your machine via npx. It exposes your Synapse workspace as a filesystem that AI tools can read from and write to. Setup takes one line in your tool's config file.",
  },
];

let openIndex = $state<number | null>(null);

function toggle(index: number) {
  openIndex = openIndex === index ? null : index;
}
</script>

<section class="faq">
  <div class="faq-bg" aria-hidden="true">
    <div class="faq-orb faq-orb-1"></div>
  </div>
  <div class="faq-inner">
    <ScrollReveal>
      <h2 class="faq-headline">Frequently asked questions</h2>
    </ScrollReveal>

    <div class="faq-list">
      {#each faqs as faq, i}
        <ScrollReveal delay={i * 80}>
          <div class="faq-item" class:open={openIndex === i}>
            <button
              class="faq-question"
              onclick={() => toggle(i)}
              aria-expanded={openIndex === i}
            >
              <span class="faq-q-text">{faq.question}</span>
              <span class="faq-chevron" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </button>
            <div class="faq-answer-wrapper">
              <div class="faq-answer">
                <p>{faq.answer}</p>
              </div>
            </div>
          </div>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .faq {
    position: relative;
    overflow: hidden;
    padding: 6rem 2rem;
    background: radial-gradient(ellipse 80% 70% at 60% 40%, rgba(232, 216, 196, 0.5) 0%, var(--color-cream) 70%);
  }

  .faq-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .faq-orb-1 {
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.05) 0%, transparent 70%);
    bottom: -10%;
    left: 15%;
    filter: blur(60px);
    animation: float-orb-reverse 20s ease-in-out infinite;
  }

  .faq-inner {
    position: relative;
    z-index: 1;
    max-width: 700px;
    margin: 0 auto;
    text-align: center;
  }

  .faq-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 3rem;
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
  }

  .faq-item {
    background: rgba(255, 253, 248, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 12px;
    overflow: hidden;
    transition: box-shadow 0.3s ease, border-color 0.3s ease;
  }

  .faq-item:hover {
    border-color: rgba(199, 183, 163, 0.5);
  }

  .faq-item.open {
    box-shadow: 0 8px 32px rgba(86, 28, 36, 0.08);
    border-color: rgba(199, 183, 163, 0.5);
  }

  .faq-question {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .faq-q-text {
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-burgundy);
    line-height: 1.4;
  }

  .faq-chevron {
    flex-shrink: 0;
    color: var(--color-burgundy);
    opacity: 0.4;
    transition: transform 0.3s ease, opacity 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .faq-item.open .faq-chevron {
    transform: rotate(180deg);
    opacity: 0.7;
  }

  .faq-answer-wrapper {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.35s ease;
  }

  .faq-item.open .faq-answer-wrapper {
    max-height: 300px;
  }

  .faq-answer {
    padding: 0 1.5rem 1.25rem;
  }

  .faq-answer p {
    font-size: 1rem;
    line-height: 1.7;
    color: var(--color-burgundy);
    opacity: 0.65;
    margin: 0;
  }

  @media (max-width: 768px) {
    .faq {
      padding: 4rem 1.5rem;
    }

    .faq-question {
      padding: 1rem 1.25rem;
    }

    .faq-answer {
      padding: 0 1.25rem 1rem;
    }
  }
</style>
