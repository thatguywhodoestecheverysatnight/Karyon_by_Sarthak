import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Karyon Studio",
    short_name: "Karyon",
    description: "Nucleus segmentation and IHC scoring that runs entirely in your browser.",
    start_url: "/studio",
    display: "standalone",
    background_color: "#0b0c11",
    theme_color: "#4b4acf",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
