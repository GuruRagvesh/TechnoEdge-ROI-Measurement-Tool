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
          Sign in / Sign up
        </Link>
      </header>
      <main className="public-main">
        <span className="eyebrow">TECHNOEDGE LEARNING SERVICES</span>
        <h1>
          Assess the work.
          <br />
          Measure the progress.
        </h1>
        <p>
          A practical assessment platform for corporate teams. Establish your
          baseline before training, then measure performance across equivalent
          challenges after AI training.
        </p>
        <Link className="button primary" href="/login">
          Sign in to your workspace →
        </Link>
        <section className="stats-grid">
          <article className="panel">
            <h2>Base Camp</h2>
            <p>Before AI · Establish your baseline.</p>
          </article>
          <article className="panel">
            <h2>Summit</h2>
            <p>After AI · Measure observed improvement.</p>
          </article>
          <article className="panel">
            <h2>Evidence and results</h2>
            <p>
              Five fixed challenges. Choose three. Sixty minutes per round.
              Evaluated practical deliverables and verified MCQs.
            </p>
          </article>
        </section>
        <p className="help">
          Observed scores, elapsed time and work quality are reported separately
          from modeled financial ROI.
        </p>
      </main>
      <footer>TechnoEdge Learning Services · Assessment ROI</footer>
    </div>
  );
}
