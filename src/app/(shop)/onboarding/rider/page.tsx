"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { markOnboardingDone, safeNext } from "@/lib/onboarding/complete";
import { RIDER_ONBOARDING } from "@/lib/onboarding/flows";

function RiderOnboardingContent() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"), "/rider-portal");

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
      title={RIDER_ONBOARDING.title}
      subtitle={RIDER_ONBOARDING.subtitle}
      steps={RIDER_ONBOARDING.steps}
      finishLabel={RIDER_ONBOARDING.finishLabel}
      onFinish={finish}
      onSkip={skip}
      persistProgress={sp.get("force") !== "1"}
    />
  );
}

export default function RiderOnboardingPage() {
  return (
    <Suspense>
      <RiderOnboardingContent />
    </Suspense>
  );
}
