import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "もぐレコ", short_name: "もぐレコ", description: "行った店・行きたい店・食べた料理を記録する個人用PWA", start_url: "/", display: "standalone", background_color: "#fff7ed", theme_color: "#f97316", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
