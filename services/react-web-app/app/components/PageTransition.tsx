import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation, Outlet } from "react-router";
import { transitions } from "~/lib/transitions";

export function PageTransition() {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <Outlet />;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={transitions.spring}
        style={{ minHeight: "100%" }}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}
