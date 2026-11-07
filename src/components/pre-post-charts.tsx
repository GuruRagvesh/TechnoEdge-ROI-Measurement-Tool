type Values = {
  minutes: number | null;
  score: number | null;
  maximum?: number;
  accuracy: number | null;
  quality: number | null;
};
export function PrePostCharts({ pre, post }: { pre: Values; post: Values }) {
  return (
    <div
      className="comparison-charts"
      aria-label="Pre and Post assessment charts"
    >
      {(
        [
          { key: "minutes", label: "Elapsed time", unit: "min" },
          {
            key: "score",
            label: "Final score",
            unit: "/" + (pre.maximum || 100),
          },
          { key: "accuracy", label: "MCQ accuracy", unit: "%" },
          { key: "quality", label: "Practical quality", unit: "%" },
        ] as const
      ).map(({ key, label, unit }) => {
        const maximum =
          key === "minutes"
            ? Math.max(pre.minutes || 0, post.minutes || 0, 1)
            : key === "score"
              ? pre.maximum || 100
              : 100;
        return (
          <figure key={key}>
            <figcaption>{label}</figcaption>
            {[
              { label: "Base Camp", v: pre[key], color: "#7771e8" },
              { label: "Summit", v: post[key], color: "#20b7ab" },
            ].map((x) => (
              <div className="comparison-bar" key={x.label}>
                <span>{x.label}</span>
                <div>
                  <i
                    style={{
                      width: `${((x.v || 0) / maximum) * 100}%`,
                      background: x.color,
                    }}
                  />
                </div>
                <strong>
                  {x.v === null
                    ? "Pending"
                    : `${Math.round(x.v * 10) / 10} ${unit}`}
                </strong>
              </div>
            ))}
          </figure>
        );
      })}
    </div>
  );
}
