import type { Metadata } from "next";
import { SiteHeader } from "@/components/brand";
import { Studio } from "@/components/studio/Studio";

export const metadata: Metadata = {
  title: "Studio",
  description: "Segment and measure nuclei in H&E and IHC images. Runs locally in your browser with WebGPU or WebAssembly.",
};

export default function StudioPage() {
  return (
    <>
      <SiteHeader compact />
      <Studio />
    </>
  );
}
