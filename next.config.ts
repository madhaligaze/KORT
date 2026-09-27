import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
  // KORT выделен из раздела «Финансы» (/finance) PDF-CONVERTER. Разосланные
  // ссылки-приглашения вида /finance?phone=… должны приводить ко входу:
  // адрес меняется, параметры остаются.
  async redirects() {
    return [{ source: "/finance", destination: "/", permanent: false }];
  },
};

export default nextConfig;
