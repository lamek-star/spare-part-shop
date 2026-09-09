"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="boot">
      <h1>Unable to display this workspace</h1>
      <p>
        An unexpected error interrupted the page. Your last successfully saved
        demo data remains in this browser.
      </p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
