"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { markOnboardingDone, safeNext } from "@/lib/onboarding/complete";
import { CUSTOMER_ONBOARDING } from "@/lib/onboarding/flows";

function CustomerOnboardingContent() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"), "/products");

  async function finish() {
    await markOnboardingDone("completed");
    window.location.assign(next);
  }

  async function skip() {
    await markOnboardingDone("skipped");
    window.location.assign(next);
  }

  return (
    <OnboardingFlow
      title={CUSTOMER_ONBOARDING.title}
      subtitle={CUSTOMER_ONBOARDING.subtitle}
      steps={CUSTOMER_ONBOARDING.steps}
      finishLabel={CUSTOMER_ONBOARDING.finishLabel}
      onFinish={finish}
      onSkip={skip}
      persistProgress={sp.get("force") !== "1"}
    />
  );
}

export default function CustomerOnboardingPage() {
  return (
    <Suspense>
      <CustomerOnboardingContent />
    </Suspense>
  );
}
