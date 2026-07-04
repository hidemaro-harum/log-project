import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "もぐレコ",
    short_name: "もぐレコ",
    description: "行った店・行きたい店・食べた料理を写真と一緒に記録する個人用PWA",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f1",
    theme_color: "#4b5f43",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
