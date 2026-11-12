import { useState } from "react";
import StardustStagePreloader from "@/components/ui/stardust-stage-preloader";

const SEEN_KEY = "kips.intro";

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The opening sequence, shown over the app once per browser session. The app
 * is already mounted underneath, so it is loaded by the time the gate lifts.
 */
export function Intro() {
  const [done, setDone] = useState(alreadySeen);
  if (done) return null;

  const finish = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Without storage the intro simply plays again on the next load.
    }
    setDone(true);
  };

  return (
    <div className="intro">
      <StardustStagePreloader
        className="intro-stage"
        word="KIPS"
        caption="KIPS on Robinhood Chain"
        height="100dvh"
        onComplete={finish}
        waitForClick
      />
    </div>
  );
}
