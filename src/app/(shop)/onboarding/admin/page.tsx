"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { markOnboardingDone, safeNext } from "@/lib/onboarding/complete";
import { ADMIN_ONBOARDING } from "@/lib/onboarding/flows";

function AdminOnboardingContent() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"), "/admin");

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
      title={ADMIN_ONBOARDING.title}
      subtitle={ADMIN_ONBOARDING.subtitle}
      steps={ADMIN_ONBOARDING.steps}
      finishLabel={ADMIN_ONBOARDING.finishLabel}
      onFinish={finish}
      onSkip={skip}
      persistProgress={sp.get("force") !== "1"}
    />
  );
}

export default function AdminOnboardingPage() {
  return (
    <Suspense>
      <AdminOnboardingContent />
    </Suspense>
  );
}
