import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/demo.tsx"),
  route("home", "routes/home.tsx"),
] satisfies RouteConfig;
