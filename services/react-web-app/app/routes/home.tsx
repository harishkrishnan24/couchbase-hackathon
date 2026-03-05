import type { Route } from "./+types/home";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { transitions } from "~/lib/transitions";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "React Router + Bun Template" },
    { name: "description", content: "A modern React app template with React Router, Bun, and shadcn/ui" },
  ];
}

const badgeContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.15 },
  },
};

const badgeItem = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.spring,
  },
};

const BADGES = [
  "React 19",
  "React Router 7",
  "Bun Runtime",
  "shadcn/ui Components",
  "Tailwind CSS",
  "TypeScript",
  "Polytope Containerization",
];

export default function Home() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.spring}
        className="max-w-2xl w-full"
      >
        <Card className="w-full">
          <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold mb-2">
            React Router + Bun Template
          </CardTitle>
          <CardDescription className="text-lg">
            A modern, production-ready template for building React applications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              This template includes everything you need to start building:
            </p>
            {shouldReduceMotion ? (
              <div className="flex flex-wrap gap-2 justify-center">
                {BADGES.map((label) => (
                  <Badge key={label} variant="secondary">{label}</Badge>
                ))}
              </div>
            ) : (
              <motion.div
                className="flex flex-wrap gap-2 justify-center"
                variants={badgeContainer}
                initial="hidden"
                animate="visible"
              >
                {BADGES.map((label) => (
                  <motion.span key={label} variants={badgeItem}>
                    <Badge variant="secondary">{label}</Badge>
                  </motion.span>
                ))}
              </motion.div>
            )}
          </div>
          
          <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-white">
              Adding Dependencies
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Use the polytope module to add new packages:
            </p>
            <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-800 dark:text-gray-200">
              polytope run {`react-web-app`}-add --packages "package-name"
            </code>
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Start building your application by editing the routes in the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">app/</code> directory.
            </p>
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </div>
  );
}
