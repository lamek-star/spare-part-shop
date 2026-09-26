import { BASE_PATH } from "@/lib/basePath";
export default function NotFound() {
  return (
    <main className="boot">
      <h1>Page not found</h1>
      <p>This address is not part of the spare-parts workspace.</p>
      <a href={`${BASE_PATH}/`} className="button">
        Open workspace
      </a>
    </main>
  );
}
