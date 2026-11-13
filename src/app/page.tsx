import Link from "next/link";
export default function Home() {
  return (
    <div className="public-page">
      <header className="public-header">
        <Link className="brand" href="/">
          <span className="brand-mark">T</span>
          <span>
            TechnoEdge<small>ASSESSMENT ROI</small>
          </span>
        </Link>
        <Link className="button primary" href="/login">
          Sign in / Get started
        </Link>
      </header>
      <main className="public-main">
        <span className="eyebrow">TECHNOEDGE LEARNING SERVICES</span>
        <h1>AI Productivity Assessment</h1>
        <p>
          One timed, practical assessment for working professionals. You
          complete all five business challenges, work on the supplied files in
          your own tools, and upload what you produce.
        </p>
        <Link className="button primary" href="/login">
          Sign in / Get started →
        </Link>
        <section className="stats-grid">
          <article className="panel">
            <h2>60 minutes, one attempt</h2>
            <p>
              The clock starts when you confirm entry and keeps running if you
              close the page. An attempt cannot be restarted.
            </p>
          </article>
          <article className="panel">
            <h2>All five challenges</h2>
            <p>
              Email analysis, Excel consolidation, data cleaning, an Excel
              dashboard, or a Word-to-PowerPoint management review.
            </p>
          </article>
          <article className="panel">
            <h2>Download, work, upload</h2>
            <p>
              Download each challenge pack, answer four questions from your
              results, and upload your Excel or PowerPoint file as evidence.
            </p>
          </article>
        </section>
        <p className="help">
          You will need a laptop with Excel and PowerPoint, the room code from
          your coordinator, and an email inbox you can open to receive a sign-in
          code. Answers are saved as you work.
        </p>
      </main>
      <footer>TechnoEdge Learning Services · Assessment ROI</footer>
    </div>
  );
}
