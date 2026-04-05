<script>
import Comparison from "$lib/components/landing/Comparison.svelte";
import CtaSection from "$lib/components/landing/CtaSection.svelte";
import Faq from "$lib/components/landing/Faq.svelte";
import FeatureCards from "$lib/components/landing/FeatureCards.svelte";
import Hero from "$lib/components/landing/Hero.svelte";
import HowItWorks from "$lib/components/landing/HowItWorks.svelte";
import LandingFooter from "$lib/components/landing/LandingFooter.svelte";
import LandingNav from "$lib/components/landing/LandingNav.svelte";
import ProblemSection from "$lib/components/landing/ProblemSection.svelte";
import SetupGuide from "$lib/components/landing/SetupGuide.svelte";
import ToolBar from "$lib/components/landing/ToolBar.svelte";

let { data } = $props();
const loggedIn = $derived(!!data.user);
</script>

<LandingNav {loggedIn} />
<Hero />
<ToolBar />
<ProblemSection />
<HowItWorks />
<SetupGuide />
<FeatureCards />
<Comparison />
<Faq />
<CtaSection {loggedIn} />
<LandingFooter />
