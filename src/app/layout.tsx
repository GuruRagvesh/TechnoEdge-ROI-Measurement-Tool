import type { Metadata } from "next";
import "./globals.css";
import "./corporate.css";
export const metadata: Metadata = {
  title: "TechnoEdge · Assessment ROI",
  description:
    "Practical skills. Measured progress. An assessment workspace for AI productivity.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
