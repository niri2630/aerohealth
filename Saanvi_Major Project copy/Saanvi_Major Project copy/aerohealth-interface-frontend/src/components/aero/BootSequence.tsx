import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { EASE } from "@/lib/aero/ui";

const LINES = [
  "calibrating sensors",
  "reading local air",
  "modelling personal risk",
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const total = reduced ? 400 : 1700;
    const timers = LINES.map((_, i) =>
      setTimeout(() => setStep(i), (total / LINES.length) * i),
    );
    const end = setTimeout(() => {
      setVisible(false);
      onDone();
    }, total);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
    };
  }, [onDone, reduced]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          exit={{ opacity: 0, filter: "blur(10px)" }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <motion.div
            initial={{ opacity: 0, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, letterSpacing: "0.32em" }}
            transition={{ duration: 0.9, ease: EASE }}
            className="num text-sm text-foreground uppercase"
          >
            aerohealth
          </motion.div>

          <div className="mt-6 h-px w-56 overflow-hidden bg-hairline">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: reduced ? 0.35 : 1.6, ease: EASE }}
            />
          </div>

          <div className="mt-4 h-4">
            <AnimatePresence mode="wait">
              <motion.p
                key={step}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="label-glyph"
              >
                {LINES[step]}
              </motion.p>
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}