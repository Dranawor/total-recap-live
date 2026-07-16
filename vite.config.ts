import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/total-recap-live/",
  plugins: [react()],
});
