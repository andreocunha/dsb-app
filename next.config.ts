import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Memoriza componentes e callbacks automaticamente (menos re-renders).
  reactCompiler: true,
  // Permite abrir o `next dev` pelo IP da rede local (ex.: testar no celular).
  allowedDevOrigins: ["192.168.*.*"],
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
