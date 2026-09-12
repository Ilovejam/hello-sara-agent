import "./globals.css";

export const metadata = {
  title: "Deferred Intent · Timed Agent",
  description: "OpenAI for language. Runtime for the clock.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
